import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

const env = process.env;
const project = z.string().startsWith('pho_prj_').parse(env.PHOTON_PROJECT_ID);
const key = z.string().min(1).parse(env.PHOTON_API_KEY);
const url = new URL('/webhooks/photon', z.url({ protocol: /^https$/ }).parse(env.PUBLIC_BASE_URL)).href;
const output = env.PHOTON_SECRET_FILE ?? '.env.photon';
const existing = await readFile(output, 'utf8').catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
  return undefined;
});
if (existing) throw new Error(`${output} already exists. Use its signing secret, or specify a different locally ignored path.`);

const result = await fetch(`https://api.photon.codes/v1/projects/${project}/webhooks/destinations`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': createHash('sha256').update(project).update(url).update('fix-this-spot-v1').digest('hex'),
  },
  body: JSON.stringify({
    url, name: 'Signoff',
    apiVersion: '2026-07-01',
    enabledEvents: ['message.received', 'message.delivered', 'message.failed'],
  }),
  signal: AbortSignal.timeout(15_000),
});
if (!result.ok) {
  await result.body?.cancel();
  throw new Error(`Photon registration returned HTTP ${result.status}. Check the destination and key permissions.`);
}
const response = z.object({
  signingSecret: z.string().startsWith('whsec_'),
  destination: z.object({ destinationId: z.string() }),
}).parse(await result.json());
await writeFile(output, `PHOTON_WEBHOOK_SECRET=${response.signingSecret}\n`, { mode: 0o600, flag: 'wx' });
console.log(`Registered ${response.destination.destinationId}. Signing secret saved to ${output}.`);
