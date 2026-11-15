import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { DateTime } from 'luxon';
import pg from 'pg';
import { loadConfig } from '../../backend/config.js';
import { parseVisit } from '../../backend/schedule.js';
import { Webhook } from 'standardwebhooks';
import { readMessage, sendText, verifyEvent } from '../../backend/photon.js';
import { belongsToProperty, repairTimeZone, reportAddress, safeAid } from '../../backend/repair.js';
import { managerReport, tenantAreaReport } from '../../backend/reports.js';

async function port() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return address.port;
}

test('the sponsor rehearsal accepts roof imagery in the backend folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signoff-config-'));
  const path = join(dir, 'property.json');
  const property = JSON.parse(await readFile('backend/config/property.example.json', 'utf8'));
  const imageFile = 'backend/config/roof-assets/test.jpg';
  const env = {
    PHOTON_TEST_MODE: 'true',
    PHOTON_SPONSOR_REHEARSAL: 'true',
    PHOTON_POLL_SINCE: '2026-11-14T13:00:00Z',
    PROPERTY_CONFIG: path,
    MANAGER_HANDLE: 'manager@example.invalid',
    TENANT_SUITES_JSON: '{"tenant@example.invalid":"402"}',
    DATABASE_URL: 'postgres://fixture@localhost/signoff',
    PHOTON_PROJECT_ID: 'pho_prj_fixture',
    PHOTON_API_KEY: 'fixture-photon-key',
    MATTERPORT_SDK_KEY: 'fixture-matterport-key',
  };
  try {
    await writeFile(path, JSON.stringify({ ...property, roof: { imageFile } }));
    assert.equal((await loadConfig(env)).property.roof.imageFile, imageFile);
    await writeFile(path, JSON.stringify({ ...property, roof: { imageFile: 'backend/config/roof-assets/../other.jpg' } }));
    await assert.rejects(loadConfig(env), /imageFile/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Photon Beta direct media and caption normalize into one intake message', () => {
  const object = {
    id: 'msg-1', platform: 'imessage', status: 'received',
    space: { id: 'space-1', kind: 'direct' },
    sentBy: { handle: 'tenant@example.com', kind: 'human' },
    receivedBy: { id: 'agent-1', kind: 'agent' },
    content: { type: 'group', parts: [
      { type: 'text', text: 'Water stain by the window' },
      { type: 'attachment', attachmentId: 'attachment-1' },
    ] },
  };
  assert.equal(readMessage(object)?.text, 'Water stain by the window');
  assert.equal(readMessage(object)?.attachmentId, 'attachment-1');
  assert.equal(readMessage({ ...object, space: { id: 'space-1', kind: 'group' } }), undefined);
});

test('signed Photon event verification binds the raw body and project', () => {
  const verifier = new Webhook('whsec_' + Buffer.from('testing-signing-key').toString('base64'));
  const stamp = new Date();
  const payload = JSON.stringify({ id: 'event-1', type: 'message.received', data: { projectId: 'project-1', object: {} } });
  const headers = {
    'webhook-id': 'event-1',
    'webhook-timestamp': String(Math.floor(stamp.getTime() / 1000)),
    'webhook-signature': verifier.sign('event-1', stamp, payload),
  };
  assert.equal(verifyEvent(verifier, payload, headers, 'project-1')?.id, 'event-1');
  assert.equal(verifyEvent(verifier, payload + ' ', headers, 'project-1'), undefined);
  assert.equal(verifyEvent(verifier, payload, headers, 'project-2'), undefined);
});

test('visit windows are interpreted in the property time zone', () => {
  const now = DateTime.fromISO('2026-11-14T13:00:00-05:00');
  assert.deepEqual(parseVisit('L-1 Tuesday 2 to 4 PM', 'America/Chicago', now), {
    start: '2026-11-17T14:00:00.000-06:00', end: '2026-11-17T16:00:00.000-06:00',
  });
  assert.equal(parseVisit('Today 1:99 to 4 PM', 'America/Chicago', now), undefined);
});

test('report address confirmation and protection are based on the actual report', () => {
  assert.equal(reportAddress('Water stain by the window'), undefined);
  assert.equal(reportAddress('Water stain by the window\n200 N Spring St, Los Angeles, ca'), '200 N Spring St, Los Angeles, CA');
  assert(belongsToProperty('8303 Knight Road, Houston, TX 77054', '8303-8317 Knight Rd, Houston, TX'));
  assert(!belongsToProperty('200 N Spring St, Los Angeles, CA', '8303-8317 Knight Rd, Houston, TX'));
  assert.equal(safeAid('water around the light and a bulging ceiling', 'leak'), 'clear');
  assert.equal(safeAid('water drips on the floor', 'leak'), 'bucket');
  assert.equal(repairTimeZone('200 N Spring St, Los Angeles, CA', 'America/Chicago'), 'America/Los_Angeles');
});

test('stair reports warn about falls and distinguish neighborhood data from site evidence', () => {
  const aid = safeAid('Broken step in the shared stairwell', 'damage', 'bucket');
  assert.equal(aid, 'stair-sign');
  assert.equal(safeAid('Structural collapse at the stairs', 'damage', 'stair-sign'), 'clear');
  const manager = managerReport({ code: 'L-3', address: '200 N Spring St, Los Angeles, CA',
    description: 'Tenant described a broken wooden step.', issue: 'damage', aid, hasPhoto: false, demo: true });
  assert.match(manager, /DEMO.*Urgent inspection/);
  assert.match(manager, /Tenant description received\. Site inspection pending/);
  assert.match(manager, /arrange safe access/);
  const tenant = tenantAreaReport('L-3', 'damage', aid, {
    weather: { current: { time: '2026-11-14T22:45', temperature_2m: 59.8, apparent_temperature: 58.9, relative_humidity_2m: 79 } },
    coverage: { start_date: '2026-08-17', through_date: '2026-11-14', indicators: { water: 39, waste: 225 } },
  }, 'https://example.test');
  assert.match(tenant, /Outdoor weather.*60°F.*79%/);
  assert.match(tenant, /39 water and 225 waste reports/);
  assert.match(tenant, /does not establish whether mice or rats are at the building/);
  assert.match(tenant, /a broken tread increases the risk of a fall/i);
  assert.match(tenantAreaReport('L-3', 'damage', aid, null, 'https://example.test'), /Outdoor weather is unavailable/);
});

test('Photon sends renders and original tenant photos as typed binary attachments', async (t) => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return Response.json({ id: url.endsWith('/attachments') ? 'attachment-id' : 'message-id' });
  });
  const sent = await sendText({ photonProject: 'project', photonKey: 'test-key' }, {
    id: 'job', body: '', image: png, space_id: 'space', agent_id: 'agent',
  });
  assert.equal(sent, 'message-id');
  const headers = new Headers(requests[0].init?.headers);
  const boundary = headers.get('content-type')?.split('boundary=')[1];
  const body = Buffer.from(requests[0].init?.body as Uint8Array);
  assert.equal(headers.get('content-length'), String(body.length));
  assert(body.includes(Buffer.from('Content-Type: image/png\r\n\r\n')));
  assert(body.subarray(-(String(boundary).length + 8 + png.length)).equals(Buffer.concat([png, Buffer.from(`\r\n--${boundary}--\r\n`)])));
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)).content, { type: 'attachment', attachmentId: 'attachment-id' });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x07, 0x0b, 0xff, 0xd9]);
  await sendText({ photonProject: 'manager-project', photonKey: 'test-key' }, {
    id: 'tenant-photo', body: '', image: jpeg, image_type: 'image/jpeg', space_id: 'manager-space', agent_id: 'manager-agent',
  });
  const photoBoundary = new Headers(requests[2].init?.headers).get('content-type')?.split('boundary=')[1];
  const photoUpload = Buffer.from(requests[2].init?.body as Uint8Array);
  const photoTail = Buffer.concat([jpeg, Buffer.from(`\r\n--${photoBoundary}--\r\n`)]);
  assert.match(requests[2].url, /manager-project\/attachments$/);
  assert(photoUpload.includes(Buffer.from('"contentType":"image/jpeg"')));
  assert(photoUpload.includes(Buffer.from('"filename":"tenant-photo.jpg"')));
  assert(photoUpload.subarray(-photoTail.length).equals(photoTail));
  assert.equal(JSON.parse(String(requests[3].init?.body)).spaceId, 'manager-space');
});

test('photo, clarification, duplicate delivery, scheduling, and repair reopening', { timeout: 45_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'fix-spot-'));
  const [pgPort, appPort] = await Promise.all([port(), port()]);
  const db = new EmbeddedPostgres({
    databaseDir: join(dir, 'db'), port: pgPort, user: 'postgres', password: 'test',
    persistent: true, autoRehydrateSymlinks: true,
    onLog: () => {}, onError: (error) => console.error(error),
  });
  let child: ReturnType<typeof spawn> | undefined;
  let started = false;
  try {
    await db.initialise();
    await db.start();
    started = true;
    const fixturePath = join(dir, 'property.json');
    const fixture = JSON.parse(await readFile('backend/config/property.demo.json', 'utf8'));
    await writeFile(fixturePath, JSON.stringify({ ...fixture, matterportModel: 'ModelFixture' }));
    const databaseUrl = `postgres://postgres:test@127.0.0.1:${pgPort}/postgres`;
    child = spawn(process.execPath, ['build/backend/index.js'], { env: {
      ...process.env, DEMO_MODE: 'true', PORT: String(appPort), NUDGE_SECONDS: '30',
      PUBLIC_BASE_URL: `http://127.0.0.1:${appPort}`,
      DATABASE_URL: databaseUrl, PROPERTY_CONFIG: fixturePath,
    }, stdio: ['ignore', 'ignore', 'inherit'] });
    const origin = `http://127.0.0.1:${appPort}`;
    async function wait<T>(read: () => Promise<T | undefined>): Promise<T> {
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await read().catch(() => undefined);
        if (result != null) return result;
        await new Promise((resolve) => setTimeout(resolve, 125));
      }
      throw new Error('Timed out waiting for workflow');
    }
    await wait(async () => (await fetch(origin + '/healthz')).ok || undefined);
    type Demo = {
      orders: { id: string; access_key: string }[];
      messages: { target: string; body: string }[];
    };
    const snapshot = (): Promise<Demo> => fetch(origin + '/api/demo').then((response) => response.json());
    async function send(id: string, role: string, text: string, image?: string) {
      const response = await fetch(origin + '/api/demo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role, text, image }),
      });
      assert.equal(response.status, 202);
    }
    type Ticket = { id: string; status: string; zoneId: string; reports: { id: string; has_photo: boolean }[];
      timeline: { action: string }[] };
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=';
    await Promise.all([
      send('repeat', 'tenant', 'Ceiling stain by the window', 'data:image/png;base64,' + pixel),
      send('repeat', 'tenant', 'Ceiling stain by the window', 'data:image/png;base64,' + pixel),
    ]);
    await wait(async () => (await snapshot()).messages.find((m) => m.body.includes('Where do you see it?')));
    await send('location', 'tenant', '1');
    const order = await wait(async () => (await snapshot()).orders[0]);
    const url = `${origin}/api/work-orders/${order.access_key}`;
    const ticket = (): Promise<Ticket> => fetch(url).then((r) => r.json());
    const opened = await ticket();
    assert.equal(opened.reports.length, 1);
    assert.equal(opened.zoneId, 'west-roof');
    assert(opened.reports[0].has_photo);
    const photoResponse = await fetch(`${url}/photos/${opened.reports[0].id}`);
    const photoBytes = await photoResponse.arrayBuffer();
    assert.equal(Buffer.from(photoBytes).toString('base64'), pixel);
    await send('other-tenant', 'tenant2', 'Water stain by studio window');
    await wait(async () => { const t = await ticket(); return t.reports.length === 2 ? t : undefined; });
    assert.equal((await snapshot()).orders.length, 1);
    await send('window', 'manager', `L-${order.id} tomorrow 2 to 4 PM`);
    await wait(async () => (await snapshot()).messages.find((m) => m.body.includes('Reply YES')));
    assert.equal((await ticket()).status, 'open');
    await send('confirm', 'manager', 'YES');
    await wait(async () => { const t = await ticket(); return t.status === 'scheduled' ? t : undefined; });
    await send('fix', 'manager', `FIXED L-${order.id}`);
    await wait(async () => { const t = await ticket(); return t.status === 'awaiting_confirmation' ? t : undefined; });
    await send('still', 'tenant', 'Still leaking');
    const reopened = await wait(async () => { const t = await ticket(); return t.timeline.some((e) => e.action === 'reopened') ? t : undefined; });
    assert.equal(reopened.id, order.id);
    assert.equal(reopened.status, 'open');
    await send('fixed-again', 'manager', `FIXED L-${order.id}`);
    await wait(async () => { const t = await ticket(); return t.status === 'awaiting_confirmation' ? t : undefined; });
    await send('resolved-1', 'tenant', 'Resolved');
    await wait(async () => (await snapshot()).messages.find((m) => m.body.includes('your confirmation') || m.body.includes('Your confirmation')));
    assert.equal((await ticket()).status, 'awaiting_confirmation');
    await send('resolved-2', 'tenant2', 'Resolved');
    await wait(async () => { const t = await ticket(); return t.status === 'closed' ? t : undefined; });
    await send('other-zone', 'tenant', 'Water stain at reception window');
    const another = await wait(async () => (await snapshot()).orders.find((candidate) => candidate.id !== order.id));
    assert.equal(await fetch(`${origin}/api/work-orders/${another.access_key}`).then((r) => r.json()).then((t: Ticket) => t.zoneId), 'east-roof');

    await t.test('photo bytes are scoped to the correct work-order key', async () => {
      assert.equal(photoResponse.status, 200);
      assert.equal(photoResponse.headers.get('content-type'), 'image/png');
      assert.equal(photoResponse.headers.get('cache-control'), 'private, no-store');
      assert.equal(photoResponse.headers.get('x-content-type-options'), 'nosniff');
      const photoId = opened.reports[0].id;
      const responses = await Promise.all([
        fetch(`${origin}/api/work-orders/${another.access_key}/photos/${photoId}`),
        fetch(`${origin}/api/work-orders/invalid-key/photos/${photoId}`),
        fetch(`${url}/photos/invalid-id`),
      ]);
      assert.deepEqual(responses.map((response) => response.status), [404, 404, 404]);
    });

    await t.test('only the matching manager review link can confirm a photo pin', async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      let editKey: string;
      try {
        const { rows: [row] } = await client.query<{ inspection_key: string }>(
          'SELECT inspection_key FROM work_orders WHERE id=$1', [order.id],
        );
        editKey = row.inspection_key;
      } finally {
        await client.end();
      }

      const photoId = opened.reports[0].id;
      const endpoint = `${url}/photos/${photoId}/damage-point`;
      const input = { anchor: { x: 1, y: 2, z: 3 }, stem: { x: 0, y: -.22, z: 0 }, sweep: 'sweep-1', modelId: 'ModelFixture' };
      const put = (token: string, body = input, target = endpoint) => fetch(target, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal((await put(order.access_key)).status, 404);
      assert.equal((await put(editKey, input, `${origin}/api/work-orders/${another.access_key}/photos/${photoId}/damage-point`)).status, 404);
      const withoutPhoto = (await ticket()).reports.find((report) => !report.has_photo);
      assert(withoutPhoto);
      assert.equal((await put(editKey, input, `${url}/photos/${withoutPhoto.id}/damage-point`)).status, 404);
      assert.equal((await put(editKey, { ...input, modelId: 'OtherModel' })).status, 409);
      assert.equal((await put(editKey, { ...input, stem: { x: 0, y: 0, z: 0 } })).status, 400);
      const saved = await put(editKey);
      assert.equal(saved.status, 200);
      const { modelId, ...point } = input;
      const expected = { ...point, confirmed: true };
      assert.deepEqual(await saved.json(), { damagePoint: expected });
      assert.equal((await put(editKey)).status, 200);
      const view = await fetch(url).then((response) => response.json());
      assert.deepEqual(view.reports[0].damagePoint, expected);
      assert.equal(view.timeline.filter((event: { action: string }) => event.action === 'damage_point_confirmed').length, 1);
      assert(!JSON.stringify(view).includes(editKey));
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    if (started) await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
