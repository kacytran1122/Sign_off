import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import type { Property } from './config.js';
import type { Aid, Issue } from './repair.js';
import { repairScenario } from './repair-scenario.js';

const execute = promisify(execFile);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function startBlenderWorker(db: Pool, renderer: string, property?: Property) {
  let job: Promise<void> | undefined;
  async function renderNext() {
    const client = await db.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(75820420) AS locked');
      locked = result.rows[0].locked;
      if (!locked) return;
      const { rows: [render] } = await client.query<{ order_id: string; subject: string; aid: Aid | null; issue?: Issue; description?: string; landmark_id?: string; property_match?: boolean }>(`
        SELECT b.order_id,b.subject,b.aid,r.issue,r.property_match,photo.description,photo.landmark_id FROM blender_renders b
        LEFT JOIN repair_contexts r ON r.order_id=b.order_id
        LEFT JOIN LATERAL (SELECT description,landmark_id FROM reports WHERE order_id=b.order_id ORDER BY id LIMIT 1) photo ON true
        WHERE b.status='queued' AND b.run_after <= now() ORDER BY b.order_id LIMIT 1
      `);
      if (!render) return;
      try {
        const args = [render.subject];
        if (render.aid) {
          args.push(render.aid);
          const location = render.property_match ? property?.landmarks.find((point) => point.id === render.landmark_id)?.label : undefined;
          if (render.issue) args.push(repairScenario(render.issue, render.aid, render.description, location));
        }
        const { stdout } = await execute(renderer, args, {
          encoding: 'buffer', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
        });
        if (!stdout.subarray(0, pngSignature.length).equals(pngSignature)) {
          throw new Error('Renderer returned an invalid PNG');
        }
        await client.query("UPDATE blender_renders SET status='ready', image=$2, completed_at=now() WHERE order_id=$1", [render.order_id, stdout]);
      } catch {
        console.warn('Blender render failed for work order', render.order_id);
        await client.query(`
          UPDATE blender_renders SET attempts=attempts+1,
          status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'queued' END,
          run_after=now()+interval '10 seconds' WHERE order_id=$1
        `, [render.order_id]);
      }
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(75820420)');
        client.release();
      } catch {
        client.release(true);
      }
    }
  }

  const timer = setInterval(() => {
    if (job) return;
    job = renderNext().catch(() => console.warn('Could not check Blender jobs')).finally(() => { job = undefined; });
  }, 1000);
  return async () => {
    clearInterval(timer);
    await job;
  };
}
