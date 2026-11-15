import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Webhook } from 'standardwebhooks';
import { normalizeHandle, type Config, type Role } from './config.js';

export type PhotonConnection = Pick<Config, 'photonProject' | 'photonKey'>;

const messageSchema = z.object({
  id: z.string(),
  status: z.string(),
  platform: z.string(),
  space: z.object({ id: z.string(), kind: z.string() }),
  sentBy: z.object({ handle: z.string(), kind: z.string() }),
  receivedBy: z.object({ id: z.string(), kind: z.string() }).optional(),
  content: z.unknown(),
});

export const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ projectId: z.string(), object: z.unknown() }),
});

export function verifyEvent(verifier: Webhook, raw: string, headers: Record<string, string>, project: string) {
  let payload: unknown;
  try { payload = verifier.verify(raw, headers); }
  catch { return; }
  const result = eventSchema.safeParse(payload);
  if (!result.success || result.data.id !== headers['webhook-id'] || result.data.data.projectId !== project) return;
  return result.data;
}

export type Message = {
  id: string;
  handle: string;
  space: string;
  agent: string;
  text: string;
  attachmentId?: string;
};

const contentSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  attachmentId: z.string().optional(),
  parts: z.array(z.unknown()).optional(),
});

export function readMessage(object: unknown): Message | undefined {
  const message = messageSchema.parse(object);
  if (message.status !== 'received' || message.platform !== 'imessage' ||
    message.space.kind !== 'direct' || message.sentBy.kind !== 'human' ||
    message.receivedBy?.kind !== 'agent') return;
  const content = contentSchema.parse(message.content);
  const parts = content.type === 'group' ? (content.parts ?? []).map((p) => contentSchema.parse(p)) : [content];
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim().slice(0, 2000);
  const attachmentId = parts.find((p) => p.type === 'attachment')?.attachmentId;
  if (!text && !attachmentId) return;
  return {
    id: message.id, handle: message.sentBy.handle, space: message.space.id,
    agent: message.receivedBy.id, text, attachmentId,
  };
}

export const tenantPhotoWindowSeconds = 300;
const tenantMention = /^@signoff(?=$|[\s,:])[\s,:]*/i;

/** Gate Photon before downloading photos or asking a model to process a tenant's text. */
export async function activatePhotonMessage(db: Pick<PoolClient, 'query'>, message: Message, role: Role, project?: string) {
  if (role === 'manager') return message;
  if (tenantMention.test(message.text)) {
    const text = message.text.replace(tenantMention, '').trim();
    return { ...message, text: text || (message.attachmentId ? '' : 'START') };
  }
  if (message.text || !message.attachmentId || !project) return;
  // An iMessage photo can arrive in its own bubble directly after a tagged report or PHOTO request.
  const permission = await db.query(`SELECT 1 FROM conversations WHERE handle=$1 AND space_id=$2
    AND agent_id=$3 AND photon_project=$4 AND tenant_photo_until > now()`,
  [normalizeHandle(message.handle), message.space, message.agent, project]);
  return permission.rowCount ? message : undefined;
}

export class RetryableError extends Error {
  constructor(message: string, readonly retryAfter?: number) { super(message); }
}

export type Photo = { bytes: Buffer; type: string };
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const photoLimit = 4 * 1024 * 1024;

async function call(config: PhotonConnection, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.photon.codes/v1/projects/${encodeURIComponent(config.photonProject!)}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.photonKey}`, ...init?.headers },
    signal: AbortSignal.timeout(18_000),
  });
  return response;
}

export async function listReceivedMessages(config: PhotonConnection, since: string, pageToken?: string) {
  const query = new URLSearchParams({ platform: 'imessage', direction: 'received', order: 'asc', pageSize: '50', createdSince: since });
  if (pageToken) query.set('pageToken', pageToken);
  const response = await call(config, `messages?${query}`);
  if (!response.ok) {
    await response.body?.cancel();
    throw new RetryableError(`Photon inbox returned ${response.status}`);
  }
  const item = z.object({ id: z.string(), createdAt: z.iso.datetime({ offset: true }) }).passthrough();
  return z.object({ items: z.array(item), nextPageToken: z.string().optional() }).parse(await response.json());
}

export async function downloadPhoto(config: PhotonConnection, id: string): Promise<Photo | undefined> {
  const response = await call(config, `attachments/${encodeURIComponent(id)}/content`);
  if (response.status === 409 || response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    throw new RetryableError(`Photon attachment returned ${response.status}`, Number(response.headers.get('Retry-After')) || undefined);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Photon attachment returned ${response.status}`);
  }
  const type = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (!imageTypes.has(type) || Number(response.headers.get('content-length')) > photoLimit) {
    await response.body?.cancel();
    return;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > photoLimit) { await reader.cancel(); return; }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), type };
}

export async function sendText(config: PhotonConnection, job: { id: string; body: string; space_id: string; agent_id: string; image?: Buffer; image_type?: string | null; image_filename?: string }) {
  let content: { type: 'text'; format: 'plain'; text: string } | { type: 'attachment'; attachmentId: string } =
    { type: 'text', format: 'plain', text: job.body };
  if (job.image) {
    const digest = createHash('sha256').update(job.image).digest('hex');
    const boundary = `fix-spot-${digest.slice(0, 32)}`;
    const contentType = job.image_type ?? 'image/png';
    if (!imageTypes.has(contentType)) throw new Error('Unsupported image type');
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
    const filename = job.image_filename ?? (job.image_type ? `tenant-photo.${extension}` : 'repair-guide.png');
    const chunks = [`--${boundary}`, 'Content-Type: application/json', '',
      JSON.stringify({ contentType, sizeBytes: job.image.length, filename }),
      `--${boundary}`, `Content-Type: ${contentType}`, '', ''];
    const body = Buffer.concat([Buffer.from(chunks.join('\r\n')), job.image, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded = await call(config, 'attachments', { method: 'POST', body: new Uint8Array(body), headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length),
      'Idempotency-Key': `${job.image_filename ? 'guide' : job.image_type ? 'photo' : 'render'}-${job.id}-${digest}`,
    } });
    if (!uploaded.ok) {
      await uploaded.body?.cancel();
      throw new RetryableError(`Photon attachment upload returned ${uploaded.status}`, Number(uploaded.headers.get('Retry-After')) || undefined);
    }
    content = { type: 'attachment', attachmentId: z.object({ id: z.string() }).parse(await uploaded.json()).id };
  }
  const response = await call(config, 'messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': job.id },
    body: JSON.stringify({
      spaceId: job.space_id,
      senderId: job.agent_id,
      content,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new RetryableError(`Photon send returned ${response.status}`, Number(response.headers.get('Retry-After')) || undefined);
  }
  return z.object({ id: z.string() }).parse(await response.json()).id;
}
