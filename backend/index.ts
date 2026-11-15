import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import pg from 'pg';
import { Webhook } from 'standardwebhooks';
import { z } from 'zod';
import { loadConfig, normalizeHandle } from './config.js';
import { planRoofInspection } from './inspection.js';
import { projectDamageOnRoof } from './roof-projection.js';
import { damagePointInput } from './damage-point.js';
import { startBlenderWorker } from './blender.js';
import { startAreaWorker } from './area.js';
import { guidance, repairEffects, repairTimeZone, type Aid, type Issue } from './repair.js';
import { downloadPhoto, listReceivedMessages, photoLimit, readMessage, RetryableError, sendText, verifyEvent, type PhotonConnection } from './photon.js';
import { handleMessage, prepareReport, remindManager } from './workflow.js';
import { createAgents, planManager, runAgentTasks, runFollowUps } from './agents/index.js';
import type { ManagerPlan } from './agents/scheduler.js';

const cfg = await loadConfig();
const agents = createAgents(cfg);
const hostname = cfg.demo || cfg.photonTest ? '127.0.0.1' : '0.0.0.0';
// Keep Next's CommonJS export and global environment typings isolated from the backend.
const next = createRequire(import.meta.url)('next') as (
  options: { dev: boolean; dir: string; hostname: string; port: number },
) => {
  prepare(): Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  close(): Promise<void>;
};
const frontend = next({ dev: false, dir: resolve('frontend'), hostname, port: cfg.port });
await frontend.prepare();
const roofImage = cfg.property.roof.imageFile ? await readFile(cfg.property.roof.imageFile) : undefined;
const db = new pg.Pool({ connectionString: cfg.databaseUrl, max: 6 });
await db.query(await readFile('backend/db/schema.sql', 'utf8'));
const stopBlender = cfg.blenderRenderer && startBlenderWorker(db, cfg.blenderRenderer);
const stopArea = cfg.repairContext && startAreaWorker(db, cfg);

const app = new Hono();
const verifier = cfg.webhookSecret ? new Webhook(cfg.webhookSecret) : undefined;
const eventTypes = new Set(['message.received', 'message.delivered', 'message.failed']);

async function enqueue(id: string, type: string, object: unknown, project = cfg.photonProject) {
  const messageId = type === 'message.received' ? readMessage(object)?.id : undefined;
  if (type === 'message.received' && !messageId) return;
  await db.query('INSERT INTO inbound(id, message_id, payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [id, messageId ?? null, JSON.stringify({ type, object, project })]);
}

function connectionFor(handle: string): PhotonConnection {
  return handle === cfg.manager && cfg.managerPhoton ? cfg.managerPhoton : cfg;
}

app.get('/healthz', async (c) => {
  await db.query('SELECT 1');
  const mode = cfg.sponsorRehearsal ? 'photon-sponsor' : cfg.demo ? 'demo' : cfg.photonTest ? 'photon-test' : 'live';
  return c.json({ ok: true, mode, agentMode: agents ? 'multi' : 'standard' });
});

app.post('/webhooks/photon', async (c) => {
  if (!verifier || cfg.demo) return c.notFound();
  const raw = await c.req.text();
  const result = verifyEvent(verifier, raw, c.req.header(), cfg.photonProject!);
  if (!result) return c.text('Invalid Photon event or signature', 400);
  const { id, type, data: event } = result;
  if (!eventTypes.has(type)) return c.body(null, 204);
  try { await enqueue(id, type, event.object); }
  catch (error) {
    if (error instanceof z.ZodError) return c.text('Invalid message', 400);
    return c.text('Retry later', 503);
  }
  return c.body(null, 204);
});

const keySchema = z.uuid();
app.get('/api/work-orders/:key/render', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  if (!key.success) return c.notFound();
  const { rows } = await db.query<{ image: Buffer }>(`
    SELECT b.image FROM blender_renders b JOIN work_orders w ON w.id=b.order_id
    WHERE w.access_key=$1 AND w.property_id=$2 AND b.status='ready'
  `, [key.data, cfg.property.id]);
  if (!rows.length) return c.notFound();
  return new Response(Uint8Array.from(rows[0].image), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});

app.get('/api/work-orders/:key/roof', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  if (!roofImage || !key.success) return c.notFound();
  const order = await db.query(`SELECT 1 FROM work_orders w LEFT JOIN repair_contexts c ON c.order_id=w.id
    WHERE w.access_key=$1 AND w.property_id=$2 AND coalesce(c.property_match,true) AND coalesce(c.issue,'leak')='leak'`, [key.data, cfg.property.id]);
  if (!order.rowCount) return c.notFound();
  return new Response(Uint8Array.from(roofImage), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});

app.get('/api/work-orders/:key', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  if (!key.success) return c.notFound();
  const { rows } = await db.query('SELECT * FROM work_orders WHERE access_key=$1 AND property_id=$2', [key.data, cfg.property.id]);
  const order = rows[0];
  if (!order) return c.notFound();
  const [reports, timeline, render, repairDetails] = await Promise.all([
    db.query(`SELECT id, landmark_id, description, photo IS NOT NULL AS has_photo, confirmed_at,
      CASE WHEN photo IS NOT NULL AND damage_point->>'modelId'=$2 THEN damage_point - 'modelId' END AS "damagePoint"
      FROM reports WHERE order_id=$1 ORDER BY id`, [order.id, cfg.property.matterportModel ?? null]),
    db.query('SELECT action, detail, created_at FROM work_order_events WHERE order_id=$1 ORDER BY id', [order.id]),
    db.query('SELECT status FROM blender_renders WHERE order_id=$1', [order.id]),
    db.query<{ address: string; property_match: boolean; issue: Issue; aid: Aid; area?: { timeZone?: string } }>(
      'SELECT address, property_match, issue, aid, area FROM repair_contexts WHERE order_id=$1', [order.id]),
  ]);
  const repair = repairDetails.rows[0];
  const { imageFile, projection, ...roof } = cfg.property.roof;
  const showModel = !repair || repair.property_match;
  const showRoof = showModel && (!repair || repair.issue === 'leak');
  const property = showModel ? {
    ...cfg.property,
    zones: showRoof ? cfg.property.zones : [],
    roof: showRoof ? { ...roof, imageUrl: imageFile ? `/api/work-orders/${key.data}/roof` : roof.imageUrl } : { attributes: [] },
  }
    : { name: 'Reported property', address: repair.address, timeZone: repairTimeZone(repair.address, cfg.property.timeZone, repair.area?.timeZone), landmarks: [], zones: [], roof: { attributes: [] } };
  const plans = showRoof ? cfg.property.landmarks.filter((point) => point.zoneId === order.zone_id).flatMap((point) => {
    const plan = planRoofInspection(cfg.property, point, repair?.aid);
    return plan ? [{ landmarkId: point.id, ...plan }] : [];
  }) : [];
  const inspectionZone = showRoof && projection && cfg.property.zones.find((zone) => zone.id === order.zone_id);
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    id: order.id, status: order.status, visitStart: order.visit_start, visitEnd: order.visit_end,
    zoneId: order.zone_id, property, matterportKey: showModel ? cfg.matterportKey : undefined, demo: cfg.demo, photonTest: cfg.photonTest,
    sponsorRehearsal: cfg.sponsorRehearsal,
    renderStatus: render.rows[0]?.status,
    repair: repair && { issue: repair.issue, address: repair.address, guidance: guidance[repair.aid], effects: repairEffects(repair.issue, repair.aid), aid: repair.aid, area: repair.area },
    reports: reports.rows.map(({ damagePoint, ...report }) => ({
      ...report, damagePoint: showModel && damagePoint ? damagePoint : undefined,
      roofProjection: inspectionZone && damagePoint?.confirmed && plans.some((plan) => plan.landmarkId === report.landmark_id)
        ? projectDamageOnRoof(cfg.property.roof, inspectionZone, damagePoint.anchor) : undefined,
    })), timeline: timeline.rows, plans,
  });
});
app.get('/api/work-orders/:key/photos/:id', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  const id = c.req.param('id');
  if (!key.success || !/^\d{1,15}$/.test(id)) return c.notFound();
  const { rows } = await db.query<{ photo: Buffer; photo_type: string }>(`
    SELECT r.photo, r.photo_type FROM reports r JOIN work_orders w ON w.id=r.order_id
    WHERE w.access_key=$1 AND w.property_id=$2 AND r.id=$3 AND r.photo IS NOT NULL
  `, [key.data, cfg.property.id, id]);
  if (!rows.length) return c.notFound();
  return new Response(Uint8Array.from(rows[0].photo), { headers: {
    'Content-Type': rows[0].photo_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
});
app.put('/api/work-orders/:key/photos/:id/damage-point', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  const manager = keySchema.safeParse(/^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1]);
  const id = c.req.param('id');
  if (!key.success || !manager.success || !/^\d{1,15}$/.test(id) || !cfg.property.matterportModel) return c.notFound();

  const input = damagePointInput.safeParse(await c.req.json().catch(() => undefined));
  if (!input.success) return c.text('Choose a valid point on the Matterport surface.', 400);
  const { modelId, ...point } = input.data;
  if (modelId !== cfg.property.matterportModel) return c.text('Reload the work order to use its current Matterport model.', 409);

  const damagePoint = { ...point, confirmed: true };
  const result = await db.query(`
    WITH eligible AS (
      SELECT r.id FROM reports r JOIN work_orders w ON w.id=r.order_id
      LEFT JOIN repair_contexts x ON x.order_id=w.id
      WHERE w.access_key=$1 AND w.inspection_key=$2 AND w.property_id=$3 AND r.id=$4
        AND r.photo IS NOT NULL AND r.landmark_id=ANY($6::text[]) AND COALESCE(x.property_match,true)
    ), changed AS (
      UPDATE reports r SET damage_point=$5::jsonb FROM eligible WHERE r.id=eligible.id
        AND r.damage_point IS DISTINCT FROM $5::jsonb RETURNING r.order_id
    ), logged AS (
      INSERT INTO work_order_events (order_id, action, detail)
        SELECT order_id, 'damage_point_confirmed', 'A Matterport surface was matched to a tenant photo.' FROM changed
    )
    SELECT 1 FROM eligible`, [key.data, manager.data, cfg.property.id, id, { ...damagePoint, modelId },
    cfg.property.landmarks.map((landmark) => landmark.id)]);
  if (!result.rowCount) return c.notFound();
  c.header('Cache-Control', 'private, no-store');
  return c.json({ damagePoint });
});
app.get('/api/reports/:key', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  if (!key.success) return c.notFound();
  const { rows: [report] } = await db.query<{ id: string; status: string; issue: Issue; aid: Aid; area: unknown; renderStatus?: string }>(`
    SELECT w.id,w.status,r.issue,r.aid,r.area,b.status AS "renderStatus"
    FROM work_orders w JOIN repair_contexts r ON w.id=r.order_id LEFT JOIN blender_renders b ON w.id=b.order_id
    WHERE w.access_key=$1 AND w.property_id=$2`, [key.data, cfg.property.id]);
  if (!report) return c.notFound();
  c.header('Cache-Control', 'private, no-store');
  return c.json({ id: report.id, status: report.status, issue: report.issue, guidance: guidance[report.aid], effects: repairEffects(report.issue, report.aid), area: report.area, renderStatus: report.renderStatus });
});
app.get('/api/reports/:key/render', async (c) => {
  const key = keySchema.safeParse(c.req.param('key'));
  if (!key.success) return c.notFound();
  const { rows: [report] } = await db.query<{ image: Buffer }>(`SELECT b.image FROM blender_renders b
    JOIN work_orders w ON b.order_id=w.id JOIN repair_contexts r ON w.id=r.order_id
    WHERE w.access_key=$1 AND w.property_id=$2 AND b.status='ready' AND b.aid IS NOT NULL`, [key.data, cfg.property.id]);
  if (!report) return c.notFound();
  return new Response(Uint8Array.from(report.image), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
});

if (cfg.demo) {
  app.get('/api/demo', async (c) => {
    const [orders, messages] = await Promise.all([
      db.query('SELECT id, status, access_key FROM work_orders ORDER BY id DESC LIMIT 20'),
      db.query("SELECT target, body, created_at FROM outbox ORDER BY created_at DESC LIMIT 60"),
    ]);
    return c.json({ orders: orders.rows, messages: messages.rows.reverse() });
  });
  app.post('/api/demo', async (c) => {
    const input = z.object({
      id: z.string().min(1).max(100),
      role: z.enum(['tenant', 'tenant2', 'manager']),
      text: z.string().max(2000),
      image: z.string().max(Math.ceil(photoLimit * 4 / 3) + 32).optional(),
    }).safeParse(await c.req.json().catch(() => undefined));
    if (!input.success || (!input.data.text.trim() && !input.data.image)) return c.text('Send a message', 400);
    const data = input.data;
    if (data.image && !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(data.image)) {
      return c.text('Unsupported image', 400);
    }
    await enqueue(`demo:${data.id}`, 'message.received', {
      id: data.id, platform: 'imessage', status: 'received', demoImage: data.image,
      space: { id: data.role, kind: 'direct' }, receivedBy: { id: 'demo-agent', kind: 'agent' },
      sentBy: { kind: 'human', handle: `${data.role}@demo.invalid` },
      content: { type: 'text', text: data.text.trim() || 'Photo of a ceiling stain' },
    });
    return c.body(null, 202);
  });
}

const inboxes = [cfg, ...(cfg.managerPhoton ? [cfg.managerPhoton] : [])]
  .map((connection) => ({ connection, since: cfg.photonPollSince }));
let nextPoll = 0;

async function pollInbox(inbox: (typeof inboxes)[number]) {
  if (!inbox.since) return;
  const { connection, since } = inbox;
  let pageToken: string | undefined;
  let newest = Date.parse(since);
  do {
    const page = await listReceivedMessages(connection, since, pageToken);
    for (const message of page.items) {
      await enqueue(`poll:${message.id}`, 'message.received', message, connection.photonProject);
      newest = Math.max(newest, Date.parse(message.createdAt));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  inbox.since = new Date(newest).toISOString();
}

async function pollPhoton() {
  if (!cfg.photonPollSince || Date.now() < nextPoll) return;
  nextPoll = Date.now() + 3000;
  await Promise.all(inboxes.map((inbox) => pollInbox(inbox)
    .catch((error: Error) => console.warn('Photon inbox:', error.message))));
}

async function tick() {
  const client = await db.connect();
  let locked = false;
  let broken = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(75820419) AS locked');
    locked = rows[0].locked;
    if (!locked) return;
    await pollPhoton();

    const inbound = (await client.query(`SELECT * FROM inbound WHERE completed_at IS NULL
      AND run_after <= now() AND attempts < 6 ORDER BY created_at LIMIT 1`)).rows[0];

    if (inbound) {
      try {
        const { type, object, project = cfg.photonProject } = inbound.payload;
        let message = type === 'message.received' ? readMessage(object) : undefined;
        const handle = message ? normalizeHandle(message.handle) : '';
        const connection = connectionFor(handle);
        if (!cfg.participants.has(handle) || project !== connection.photonProject) message = undefined;
        let prepared;
        let managerPlan: ManagerPlan | undefined;
        if (message) {
          let photo;
          if (message.attachmentId) photo = await downloadPhoto(connection, message.attachmentId);
          if (cfg.demo && object.demoImage) {
            const [header, value] = (object.demoImage as string).split(',');
            const bytes = Buffer.from(value, 'base64');
            if (bytes.length <= photoLimit) photo = { type: header.slice(5, -7), bytes };
          }
          // Agents run here, before BEGIN, so no row locks are held during model calls.
          prepared = await prepareReport(client, cfg, message, photo, agents?.model);
          managerPlan = await planManager(client, cfg, agents, message);
        }
        await client.query('BEGIN');
        try {
          if (message) await handleMessage(client, cfg, message, prepared, project, managerPlan);
          if (type === 'message.delivered' || type === 'message.failed') {
            await client.query("UPDATE outbox SET status=$2 WHERE photon_message_id=$1 AND status <> 'delivered'",
              [z.object({ id: z.string() }).parse(object).id, type === 'message.delivered' ? 'delivered' : 'failed']);
          }
          await client.query('UPDATE inbound SET completed_at=now(), error=NULL WHERE id=$1', [inbound.id]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } catch (error) {
        const delay = error instanceof RetryableError ? error.retryAfter : undefined;
        console.warn('Incoming job failed:', error instanceof Error ? error.name : 'UnknownError');
        await client.query(`UPDATE inbound SET attempts=attempts+1, error=$2,
          run_after=now() + $3 * interval '1 second' WHERE id=$1`,
        [inbound.id, error instanceof Error ? error.name : 'UnknownError', delay ?? Math.min(2 ** inbound.attempts, 30)]);
      }
    }

    if (!agents) {
      await client.query('BEGIN');
      try {
        const { rows } = await client.query(`UPDATE work_orders SET next_nudge_at=NULL
          WHERE property_id=$1 AND status='open' AND next_nudge_at <= now() RETURNING id, access_key`, [cfg.property.id]);
        for (const order of rows) await remindManager(client, cfg, order);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }

    if (!cfg.demo) {
      await client.query(`UPDATE outbox SET status='failed',error='Tenant guide'
        WHERE target=$1 AND is_render AND status='queued'`, [cfg.manager]);
      await client.query(`UPDATE outbox o SET status='failed',error='Render unavailable' FROM blender_renders b
        WHERE o.render_order_id=b.order_id AND o.is_render AND o.status='queued' AND b.status='failed'`);
      const { rows } = await client.query(`SELECT o.*, c.space_id, c.agent_id,
        CASE WHEN o.is_render THEN b.image ELSE r.photo END AS image, r.photo_type AS image_type
        FROM outbox o JOIN conversations c ON c.handle=o.target
        LEFT JOIN blender_renders b ON b.order_id=o.render_order_id
        LEFT JOIN reports r ON r.id=o.photo_report_id
        WHERE o.status='queued' AND o.run_after <= now()
        AND (o.render_order_id IS NULL OR b.status='ready' OR (b.status='failed' AND NOT o.is_render))
        AND (o.photo_report_id IS NULL OR (o.target=$2 AND r.photo IS NOT NULL))
        AND COALESCE(c.photon_project,$1)=CASE WHEN o.target=$2 THEN $3 ELSE $1 END
        ORDER BY o.created_at LIMIT 5`, [cfg.photonProject, cfg.manager, connectionFor(cfg.manager).photonProject]);
      for (const job of rows) {
        try {
          const id = await sendText(connectionFor(job.target), job);
          await client.query("UPDATE outbox SET status='accepted', photon_message_id=$2, error=NULL WHERE id=$1", [job.id, id]);
        } catch (error) {
          const delay = error instanceof RetryableError ? error.retryAfter : undefined;
          await client.query(`UPDATE outbox SET attempts=attempts+1, status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,
            error=$2, run_after=now() + $3 * interval '1 second' WHERE id=$1`,
          [job.id, error instanceof Error ? error.name : 'UnknownError', delay ?? Math.min(2 ** job.attempts, 30)]);
        }
      }
    }
    // Send ready texts before this tick’s model-driven background work.
    if (agents) {
      await runFollowUps(client, cfg, agents);
      await runAgentTasks(client, cfg, agents);
    }
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(75820419)'); }
    catch { broken = true; }
    client.release(broken);
  }
}

let running = true;
let wake: ReturnType<typeof setTimeout> | undefined;
let work: Promise<void> | undefined;
function loop() {
  if (!running) return;
  work = tick().catch((error) => console.warn('Worker:', error instanceof Error ? error.message : error))
    .finally(() => { if (running) wake = setTimeout(loop, 400); });
}
loop();
const handleApi = getRequestListener(app.fetch, { overrideGlobalObjects: false });
const handlePage = frontend.getRequestHandler();
const server = createServer((request, response) => {
  const path = request.url?.split('?', 1)[0] ?? '/';
  response.setHeader('Referrer-Policy', 'no-referrer');
  const api = path === '/healthz' || path === '/api' || path.startsWith('/api/') ||
    path === '/webhooks' || path.startsWith('/webhooks/');
  const handle = api ? handleApi : handlePage;
  void handle(request, response).catch((error: unknown) => {
    console.error('HTTP request failed:', error instanceof Error ? error.name : 'UnknownError');
    if (response.headersSent) response.destroy();
    else {
      response.statusCode = 500;
      response.end('Internal Server Error');
    }
  });
}).listen(cfg.port, hostname, () =>
  console.log(`Signoff · ${cfg.baseUrl} · ${cfg.demo ? 'local demo' : cfg.photonTest ? 'Photon test' : 'live'}`),
);
async function stop() {
  running = false;
  clearTimeout(wake);
  server.close();
  await work;
  if (stopBlender) await stopBlender();
  if (stopArea) await stopArea();
  await db.end();
  await frontend.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
