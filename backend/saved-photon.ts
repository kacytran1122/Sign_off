import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { normalizeHandle, type Config } from './config.js';
import { RetryableError, type Message } from './photon.js';
import type { Aid, Issue } from './repair.js';
import { repairScenario } from './repair-scenario.js';
import { notify } from './workflow.js';

type WebRole = 'tenant' | 'landlord';
type Query = Pick<Pool, 'query'>;
type ReportRow = {
  id: string;
  status: 'open' | 'scheduled' | 'awaiting_confirmation' | 'closed';
  created_at: Date;
  issue: Issue | null;
  aid: Aid | null;
  description: string;
  published_key: string | null;
};
const syncInterval = 12_000;
const requestTimeout = 3_000;
const linkCommand = /^(?:@signoff[\s,:]+)?LINK(?:\s+\S+)?$/i;
const validCode = /^(?:@signoff[\s,:]+)?LINK\s+([A-F0-9]{32})$/i;
const validScope = /^[0-9a-f]{64}$/;
const titles = {
  'ceiling-leak': 'Ceiling leak',
  'sink-leak': 'Under-sink leak',
  'floor-spill': 'Water on the floor',
  'damaged-stair': 'Damaged stair',
  'damaged-window': 'Damaged window',
  'general-leak': 'Water leak',
  'general-damage': 'Building damage',
};

export function savedPhotonScope(token: string, propertyId: string, role: WebRole, handle: string) {
  return createHmac('sha256', token)
    .update(JSON.stringify(['saved-photon-v1', propertyId, role, normalizeHandle(handle)]))
    .digest('hex');
}

export async function savedPhotonReports(db: Query, propertyId: string, tenantHandle?: string) {
  const { rows } = await db.query<ReportRow>(`
    SELECT w.id, w.status, observation.created_at, c.issue, c.aid, observation.description,
      CASE WHEN p.revision IS NOT NULL AND ($2::text IS NULL OR NOT EXISTS (
        SELECT 1 FROM reports other WHERE other.order_id=w.id AND other.reporter<>$2
      )) THEN w.access_key END AS published_key
    FROM work_orders w
    JOIN LATERAL (
      SELECT r.created_at, r.description FROM reports r
      WHERE r.order_id=w.id AND ($2::text IS NULL OR r.reporter=$2)
      ORDER BY r.id LIMIT 1
    ) observation ON true
    LEFT JOIN repair_contexts c ON c.order_id=w.id
    LEFT JOIN report_publications p ON p.order_id=w.id
    WHERE w.property_id=$1 AND ($2::text IS NOT NULL OR COALESCE(c.property_match,true))
    ORDER BY observation.created_at DESC, w.id DESC LIMIT 200
  `, [propertyId, tenantHandle === undefined ? null : normalizeHandle(tenantHandle)]);
  return rows.map(row => ({
    id: row.id,
    title: row.issue && row.aid ? titles[repairScenario(row.issue, row.aid, row.description)] : 'Repair report',
    status: row.status,
    createdAt: row.created_at.toISOString(),
    ...(row.published_key ? { url: `/reports/${row.published_key}` } : {}),
  }));
}

function relay(config: Config, transport: typeof fetch) {
  const source = config.reportPublish;
  if (config.demo || !source) return;
  return (path: string, method: 'GET' | 'POST' | 'PUT', data?: object) => transport(
    `${source.origin}/internal/saved-photon/${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${source.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeout),
    },
  );
}

export async function syncSavedPhoton(db: Query, config: Config, transport: typeof fetch = fetch) {
  const request = relay(config, transport);
  if (!request) return;
  const { id: propertyId } = config.property;
  const response = await request(`scopes?propertyId=${encodeURIComponent(propertyId)}`, 'GET');
  if (!response.ok) throw new Error('Could not read saved report scopes.');
  const { scopes } = await response.json() as { scopes: string[] };
  const participants = new Map(Array.from(config.participants, ([handle, participant]) => [
    savedPhotonScope(config.reportPublish!.token, propertyId, participant.role === 'manager' ? 'landlord' : 'tenant', handle),
    participant.role === 'tenant' ? handle : null,
  ]));
  let failed = false;
  for (const scope of new Set(scopes.filter(scope => validScope.test(scope)))) {
    const participant = participants.get(scope);
    // A removed enrollment gets an empty index instead of retaining its previous reports.
    try {
      const reports = participant === undefined ? [] : await savedPhotonReports(db, propertyId, participant ?? undefined);
      const updated = await request('reports', 'PUT', { scope, propertyId, reports });
      if (!updated.ok && updated.status !== 404) failed = true;
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Could not update saved reports.');
}

export function createSavedPhotonBridge(db: Query, config: Config, transport: typeof fetch = fetch) {
  const request = relay(config, transport);
  let active: Promise<void> | undefined;
  const timer = request && setInterval(() => {
    active ??= syncSavedPhoton(db, config, transport).catch(() => console.warn('Could not sync saved Photon reports.'))
      .finally(() => { active = undefined; });
  }, syncInterval);

  return {
    // The inbound transport has already checked the project, participant and tenant mention.
    async link(text: string, handle: string) {
      if (!linkCommand.test(text)) return;
      const code = validCode.exec(text)?.[1]?.toUpperCase();
      if (!code) return 'Open Saved Reports to create a link code, then copy the LINK message shown there.';
      const participant = config.participants.get(handle);
      if (!participant || !request) return 'Linking text reports is unavailable for this account.';
      const role = participant.role === 'manager' ? 'landlord' : 'tenant';
      const propertyId = config.property.id;
      const scope = savedPhotonScope(config.reportPublish!.token, propertyId, role, handle);
      const response = await request('verify', 'POST', { code, role, scope, propertyId })
        .catch(() => { throw new RetryableError('Saved Reports verification is unavailable.', 5); });
      if (response.status === 204) return 'Your text reports are linked. They’ll appear in Saved Reports shortly.';
      if (response.status === 409) return 'This link code is for a different account role. Sign in with the matching role and create a new code.';
      if (response.status === 404) return 'That link code expired or was already used. Create a new code in Saved Reports.';
      throw new RetryableError('Saved Reports verification is unavailable.', 5);
    },
    async stop() { if (timer) clearInterval(timer); await active; },
  };
}

export async function queueSavedPhotonReply(db: PoolClient, handle: string, message: Message, project: string | undefined, reply: string) {
  await db.query(`INSERT INTO conversations (handle, space_id, agent_id, photon_project) VALUES ($1,$2,$3,$4)
    ON CONFLICT (handle) DO UPDATE SET space_id=EXCLUDED.space_id, agent_id=EXCLUDED.agent_id, photon_project=EXCLUDED.photon_project`,
  [handle, message.space, message.agent, project ?? null]);
  await notify(db, handle, reply);
}
