import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { startBlenderWorker } from '../../backend/blender.js';
import { loadConfig } from '../../backend/config.js';
import { downloadPhoto, readMessage, readyPhotonOutbox, type Message, type Photo } from '../../backend/photon.js';
import { queueAreaNotices } from '../../backend/reports.js';
import { handleMessage, prepareReport } from '../../backend/workflow.js';

const jpeg: Photo = { bytes: Buffer.from([255, 216, 1, 2, 255, 217]), type: 'image/jpeg' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=', 'base64');

test('repair evidence and render jobs in PostgreSQL', { timeout: 30_000 }, async (t) => {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), 'signoff-evidence-'));
  const postgres = new EmbeddedPostgres({
    databaseDir: join(dir, 'db'), port, user: 'postgres', password: 'fixture',
    persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {},
  });
  const url = `postgres://postgres:fixture@127.0.0.1:${port}/postgres`;
  const pool = new pg.Pool({ connectionString: url });
  let started = false;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    await pool.query(await readFile('backend/db/schema.sql', 'utf8'));
    await runEvidenceCases(t, pool, url, dir);
  } finally {
    await pool.end();
    if (started) await postgres.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

async function runEvidenceCases(t: TestContext, pool: pg.Pool, url: string, dir: string) {
  const cfg = await loadConfig({
    DEMO_MODE: 'true', REPAIR_CONTEXT: 'true', BLENDER_RENDERER: '/fixture',
    DATABASE_URL: url, REPORT_SHARE_ORIGIN: 'https://reports.example.invalid',
  });
  const tenant = 'tenant@demo.invalid';
  const otherTenant = 'tenant2@demo.invalid';
  const ids = { leak: '1', stair: '2' };
  let sequence = 0;

  async function send(handle: string, text: string, photo?: Photo, id = `message-${++sequence}`, attachmentId = photo && id) {
    const message: Message = { id, handle, text, space: handle, agent: 'fixture', attachmentId };
    const client = await pool.connect();
    try {
      const prepared = await prepareReport(client, cfg, message, photo);
      await client.query('BEGIN');
      await handleMessage(client, cfg, message, prepared);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function evidenceJobs() {
    return (await pool.query<{
      target: string; is_render: boolean; order_id: string; photo: Buffer | null; photo_type: string | null;
    }>(`SELECT o.target, o.is_render, coalesce(o.render_order_id, r.order_id) AS order_id, r.photo, r.photo_type
      FROM outbox o LEFT JOIN reports r ON r.id=o.photo_report_id
      WHERE o.is_render OR o.photo_report_id IS NOT NULL ORDER BY o.created_at`)).rows;
  }
  async function lastText(target: string) {
    return (await pool.query<{ body: string }>(
      "SELECT body FROM outbox WHERE target=$1 AND body<>'' ORDER BY created_at DESC LIMIT 1", [target],
    )).rows[0]?.body ?? '';
  }

  await t.test('address clarification retains the original photo and separates the two attachments', async () => {
    await send('unlisted@example.invalid', 'Water dripping');
    assert.equal((await pool.query('SELECT 1 FROM conversations')).rowCount, 0);
    await send(tenant, 'Water dripping from the ceiling', jpeg, 'initial-leak');
    assert.match(await lastText(tenant), /full street address/);
    assert.equal((await pool.query('SELECT 1 FROM work_orders')).rowCount, 0);

    await send(tenant, '200 N Spring St, Los Angeles, CA');
    assert.match(await lastText(tenant), /I read 200 N Spring St, Los Angeles, CA/);
    assert.equal((await pool.query('SELECT 1 FROM work_orders')).rowCount, 0);
    await send(tenant, 'YES');
    await send(tenant, 'Water dripping from the ceiling at 200 N Spring St, Los Angeles, CA', jpeg, 'initial-leak');
    const jobs = await evidenceJobs();
    assert.equal((await pool.query('SELECT 1 FROM reports')).rowCount, 1);
    assert.deepEqual(jobs.find((job) => job.target === cfg.manager), {
      target: cfg.manager, order_id: ids.leak, is_render: false, photo: jpeg.bytes, photo_type: jpeg.type,
    });
    assert.equal(jobs.length, 1);
    const { rows: guides } = await pool.query(`SELECT guide.target, guide.guide_image, notice.body
      FROM outbox guide JOIN outbox notice ON notice.id=guide.guide_for`);
    assert.equal(guides.length, 1);
    assert.equal(guides[0].target, tenant);
    assert.equal(guides[0].guide_image, 'ceiling-drip');
    assert.match(guides[0].body, /set a wide bucket on a flat towel/);
    assert.match(await lastText(cfg.manager), /Tenant image received/);
    assert.match(await lastText(tenant), /reports\.example\.invalid\/reports\//);
  });

  await t.test('a guide is ready when its safety text was accepted or delivered', async () => {
    const { rows: [guide] } = await pool.query<{ id: string; guide_for: string }>(
      'SELECT id, guide_for FROM outbox WHERE target=$1 AND guide_image=$2', [tenant, 'ceiling-drip']);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE conversations SET photon_project=$2 WHERE handle=$1', [tenant, 'tenant-project']);
      for (const status of ['queued', 'accepted', 'delivered', 'failed']) {
        await client.query('UPDATE outbox SET status=$2 WHERE id=$1', [guide.guide_for, status]);
        const jobs = await readyPhotonOutbox(client, 'tenant-project', cfg.manager, 'manager-project');
        assert.equal(jobs.some((job) => job.id === guide.id), status === 'accepted' || status === 'delivered', status);
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });


  await t.test('follow-up photos require the original reporter and cannot replace evidence', async () => {
    await send(tenant, 'Broken stair tread in the lobby at 201 N Spring St, Los Angeles, CA');
    await send(tenant, 'YES');
    await send(otherTenant, `PHOTO L-${ids.stair}`);
    await send(otherTenant, '', jpeg);
    assert.match(await lastText(otherTenant), /couldn’t attach/);

    await send(tenant, `PHOTO L-${ids.stair}`);
    await send(tenant, '', { bytes: png, type: 'image/png' });
    assert.match(await lastText(tenant), /I attached the photo/);
    await send(tenant, `PHOTO L-${ids.stair}`, jpeg);
    assert.match(await lastText(tenant), /already has a photo/);
    const { rows } = await pool.query('SELECT photo, photo_type FROM reports WHERE order_id=$1', [ids.stair]);
    assert.deepEqual(rows, [{ photo: png, photo_type: 'image/png' }]);
    const jobs = (await evidenceJobs()).filter((job) => job.order_id === ids.stair && job.target === cfg.manager);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].photo, png);
    assert.equal(jobs[0].is_render, false);
    assert.equal((await pool.query('SELECT 1 FROM work_orders')).rowCount, 2);
  });

  await t.test('area notices wait for enrichment and are sent once with concurrent workers', async () => {
    const countNotices = async () => (await pool.query<{ target: string }>(
      "SELECT target FROM outbox WHERE body LIKE '%Neighborhood update%'",
    )).rows.map((row) => row.target);
    await queueAreaNotices(pool, cfg);
    assert.deepEqual(await countNotices(), []);
    await pool.query("UPDATE repair_contexts SET updated_at=now(), area='{}' WHERE order_id=$1", [ids.leak]);
    await Promise.all([queueAreaNotices(pool, cfg), queueAreaNotices(pool, cfg)]);
    await queueAreaNotices(pool, cfg);
    assert.deepEqual(await countNotices(), [tenant]);
  });

  await t.test('the render worker saves valid PNGs and stops retrying invalid output', async (subtest) => {
    const renderer = join(dir, 'renderer');
    await writeFile(join(dir, 'result.png'), png);
    await writeFile(renderer, '#!/bin/sh\nif [ "$2" = bucket ]; then cat "$(dirname "$0")/result.png"; else printf bad; fi\n', { mode: 0o755 });
    subtest.mock.method(console, 'warn', () => {});
    const stop = startBlenderWorker(pool, renderer);
    async function waitFor(id: string, expected: string, attempts: number) {
      for (let i = 0; i < 80; i++) {
        const { rows: [row] } = await pool.query<{ status: string; attempts: number; image: Buffer | null }>(
          'SELECT status, attempts, image FROM blender_renders WHERE order_id=$1', [id],
        );
        if (row.status === expected && row.attempts === attempts) return row.image;
        await delay(75);
      }
      assert.fail(`Render L-${id} did not reach ${expected} after ${attempts} failed attempts`);
    }
    try {
      assert.deepEqual(await waitFor(ids.leak, 'ready', 0), png);
      assert.equal(await waitFor(ids.stair, 'queued', 1), null);
      const result = await pool.query<{ waiting: boolean }>('SELECT run_after > now() AS waiting FROM blender_renders WHERE order_id=$1', [ids.stair]);
      assert(result.rows[0].waiting);
      await pool.query('UPDATE blender_renders SET run_after=now() WHERE order_id=$1', [ids.stair]);
      assert.equal(await waitFor(ids.stair, 'queued', 2), null);
      await pool.query('UPDATE blender_renders SET run_after=now() WHERE order_id=$1', [ids.stair]);
      assert.equal(await waitFor(ids.stair, 'failed', 3), null);
    } finally {
      await stop();
    }
  });

  await t.test('a matched leak records and sends the inspection plan', async () => {
    const room = cfg.property.landmarks[0];
    cfg.property.address = '101 Fixture Avenue, Houston, TX';
    cfg.property.costar = { storiesAboveGrade: 1 };
    cfg.property.matterportModel = 'ModelFixture';
    cfg.property.roof = {
      attributes: [], imageUrl: 'https://example.invalid/roof.jpg',
      outline: [[.1, .1], [.9, .1], [.9, 1.25], [.1, 1.25]],
    };
    room.matterportRoomId = 'test-room';
    room.anchor = { x: 0, y: 2, z: 0 };
    room.views = [{ sweep: 'fixture', rotation: { x: 0, y: 0 } }];
    await send(tenant, 'Water dripping at the conference room window\n101 Fixture Avenue, Houston, TX');
    assert.match(await lastText(cfg.manager), /Inspection plan: check the conference room window inside/);
    const { rows } = await pool.query("SELECT detail FROM work_order_events WHERE action='inspection_planned'");
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /mapped roof target/);
    assert.doesNotMatch(await lastText(tenant), /mapped roof target/);
  });

  await t.test('a photo for a matched report sends the review link only to the manager', async () => {
    cfg.matterportKey = 'sdk-fixture';
    const { rows: [order] } = await pool.query<{ id: string; inspection_key: string }>(
      'SELECT id, inspection_key FROM work_orders ORDER BY id DESC LIMIT 1',
    );
    await send(tenant, `PHOTO L-${order.id}`);
    await send(tenant, '', jpeg);
    const { rows: [report] } = await pool.query<{ id: string }>(
      'SELECT id FROM reports WHERE order_id=$1 AND photo IS NOT NULL ORDER BY id DESC LIMIT 1', [order.id],
    );
    const managerNotice = await lastText(cfg.manager);
    assert.match(managerNotice, /Match its location in Matterport/);
    assert(managerNotice.includes(`#inspect=${order.inspection_key}&report=${report.id}`));
    assert(!(await lastText(tenant)).includes(order.inspection_key));
  });
  await t.test('a separate photo preserves a typed address suggestion until the tenant confirms', async () => {
    const id = 'separate-photo-address';
    await send(tenant, 'Water dripping by the conference room window\n101 Fixtuer Avenue, Houston, TX', undefined, id);
    assert.match(await lastText(tenant), /Did you mean 101 Fixture Avenue, Houston, TX/);
    await send(tenant, '', jpeg);
    assert.match(await lastText(tenant), /Did you mean 101 Fixture Avenue, Houston, TX/);
    assert.equal((await pool.query('SELECT 1 FROM reports WHERE message_id=$1', [id])).rowCount, 0);
    await send(tenant, 'YES');
    const { rows } = await pool.query(`
      SELECT r.id,r.photo,r.photo_type,o.target,w.inspection_key FROM reports r
      JOIN outbox o ON o.photo_report_id=r.id JOIN work_orders w ON w.id=r.order_id WHERE r.message_id=$1
    `, [id]);
    assert.equal(rows.length, 1);
    const [{ id: reportId, inspection_key: reviewKey, ...photoJob }] = rows;
    assert.deepEqual(photoJob, { photo: jpeg.bytes, photo_type: 'image/jpeg', target: cfg.manager });
    assert((await lastText(cfg.manager)).includes(`#inspect=${reviewKey}&report=${reportId}`));
  });

  await t.test('standard reports send the exact tenant photo to the manager in both message formats', async () => {
    cfg.repairContext = false;
    const upload = { bytes: png, type: 'image/png' };
    const initial = 'standard-report-and-photo';
    const separate = 'standard-report-before-photo';
    const caption = 'Water dripping at the reception window';

    await send(tenant, caption, jpeg, initial);
    await send(tenant, caption, jpeg, initial);
    await send(tenant, caption, undefined, separate);
    // The two-minute-old report is still inside the window for a separate Photon photo.
    await pool.query("UPDATE reports SET created_at=now() - interval '2 minutes' WHERE message_id=$1", [separate]);
    await send(tenant, '', upload);
    assert.match(await lastText(tenant), /I attached the photo/);

    const { rows } = await pool.query(`
      SELECT r.message_id,r.photo,r.photo_type,o.target FROM reports r JOIN outbox o ON o.photo_report_id=r.id
      WHERE r.message_id=ANY($1::text[]) ORDER BY r.id
    `, [[initial, separate]]);
    assert.deepEqual(rows, [
      { message_id: initial, photo: jpeg.bytes, photo_type: 'image/jpeg', target: cfg.manager },
      { message_id: separate, photo: png, photo_type: 'image/png', target: cfg.manager },
    ]);
  });

  await t.test('a missing Photon photo does not discard the leak caption', async (subtest) => {
    subtest.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'ATTACHMENT_NOT_FOUND' }, { status: 404 }));
    const message = readMessage({
      id: 'caption-with-missing-photo', status: 'received', platform: 'imessage',
      space: { kind: 'direct', id: 'fixture-space' },
      sentBy: { kind: 'human', handle: tenant }, receivedBy: { kind: 'agent', id: 'fixture-agent' },
      content: { type: 'group', parts: [
        { type: 'text', text: 'Water dripping at the reception window' },
        { type: 'attachment', attachmentId: 'missing-photo' },
      ] },
    });
    assert(message?.attachmentId);
    const photo = await downloadPhoto({ photonProject: 'fixture-project', photonKey: 'fixture-key' }, message.attachmentId);
    await send(message.handle, message.text, photo, message.id, message.attachmentId);
    const report = () => pool.query<{ order_id: string; description: string; photo: Buffer | null }>(
      'SELECT order_id,description,photo FROM reports WHERE message_id=$1', [message.id]);
    const { rows } = await report();
    assert.equal(rows.length, 1);
    assert.match(rows[0].description, /Water dripping at the reception window/i);
    assert.equal(rows[0].photo, null);

    await send(tenant, `PHOTO L-${rows[0].order_id}`, undefined, 'failed-photo-retry', 'missing-photo');
    assert.match(await lastText(tenant), new RegExp(`Send the photo for L-${rows[0].order_id} now`));
    await send(tenant, '', jpeg);
    assert.deepEqual((await report()).rows[0].photo, jpeg.bytes);
  });

}
