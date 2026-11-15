import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Pool } from 'pg';

const execute = promisify(execFile);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function startBlenderWorker(db: Pool, renderer: string) {
  let job: Promise<void> | undefined;
  async function renderNext() {
    const client = await db.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(75820420) AS locked');
      locked = result.rows[0].locked;
      if (!locked) return;
      const { rows: [render] } = await client.query<{ order_id: string; subject: string; aid: string | null }>(`
        SELECT order_id, subject, aid FROM blender_renders
        WHERE status='queued' AND run_after <= now() ORDER BY order_id LIMIT 1
      `);
      if (!render) return;
      try {
        const { stdout } = await execute(renderer, render.aid ? [render.subject, render.aid] : [render.subject], {
          encoding: 'buffer', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
          env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
        });
        if (!stdout.subarray(0, pngSignature.length).equals(pngSignature)) {
          throw new Error('Renderer returned an invalid PNG');
        }
        await client.query("UPDATE blender_renders SET status='ready', image=$2 WHERE order_id=$1", [render.order_id, stdout]);
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
