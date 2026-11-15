import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createListener } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import EmbeddedPostgres from 'embedded-postgres';

const demoPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=';
const mockKey = 'local-test-key';

type ModelRequest = {
  model: string;
  store: boolean;
  instructions: string;
  input: { content?: { text?: string; image_url?: string }[]; type?: string; output?: string }[];
  tools: { name: string }[];
};

type Demo = {
  orders: { id: string; access_key: string }[];
  messages: { target: string; body: string }[];
};
type Order = {
  status: string;
  zoneId: string;
  visitStart: string | null;
  reports: { description: string; has_photo: boolean }[];
  timeline: { action: string; detail: string }[];
};

async function freePort() {
  const server = createListener().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitFor<T>(label: string, check: () => Promise<T | undefined>) {
  const deadline = Date.now() + 12_000;
  do {
    const result = await check();
    if (result !== undefined) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

test('the running worker hands reports between agents and preserves manager confirmation and fallback', { timeout: 55_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signoff-agent-worker-'));
  const [appPort, databasePort] = await Promise.all([freePort(), freePort()]);
  const origin = `http://127.0.0.1:${appPort}`;
  const database = new EmbeddedPostgres({
    databaseDir: join(dir, 'db'), port: databasePort, user: 'postgres', password: 'test',
    persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {},
  });
  let orderCode = '';
  let sequence = 0;
  const requests: string[] = [];
  const mockErrors: unknown[] = [];

  // Select the next tool from the prior tool outputs, like a provider calling the real SDK contract.
  function selectTool(request: ModelRequest): [string, object] | undefined {
    const steps = request.input.filter((item) => item.type === 'function_call_output');
    const original = request.input[0].content ?? [];
    if (request.instructions.startsWith('You are the intake agent')) {
      if (original[0].text?.includes('reception window')) {
        requests.push('intake.protocol_failure');
        return;
      }
      if (!steps.length) return ['consult_safety_triage', {}];
      assert.match(steps[0].output ?? '', /"issue":"leak"/);
      if (steps.length === 1) return ['list_locations', {}];
      assert.match(steps[1].output ?? '', /conference-window/);
      return ['file_report', { issue: 'leak', landmarkId: null, observation: '' }];
    }
    if (request.instructions.startsWith('You are the safety triage agent')) {
      assert.equal(original[1].image_url, demoPixel);
      return ['assess', { issue: 'leak', severity: 'routine', hazards: [], temporaryAid: 'bucket',
        observation: 'The tenant reports water by the conference room window.', visibleAddress: null }];
    }
    if (request.instructions.startsWith('You are the evidence agent')) {
      if (!steps.length) return ['get_order', {}];
      return ['post_brief', { brief: 'The original report is attached. Inspect the reported room.', notifyManager: false, managerNote: null }];
    }
    if (request.instructions.startsWith('You are the scheduling agent')) {
      const window = { orderId: orderCode, day: 'tomorrow', start: '2 PM', end: '4 PM' };
      if (!steps.length) return ['list_open_orders', {}];
      assert.match(steps[0].output ?? '', new RegExp(orderCode));
      if (steps.length === 1) return ['check_window', window];
      assert.match(steps[1].output ?? '', /"ok":true/);
      return ['schedule_visit', window];
    }
    throw new Error('Unexpected model instructions');
  }

  const mock = createServer(async (incoming, response) => {
    try {
      assert.equal(incoming.method, 'POST');
      assert.equal(incoming.url, '/v1/responses');
      assert.equal(incoming.headers.authorization, `Bearer ${mockKey}`);
      let body = '';
      for await (const chunk of incoming) body += chunk;
      const payload: ModelRequest = JSON.parse(body);
      assert.equal(payload.model, 'local-test-model');
      assert.equal(payload.store, false);
      const selected = selectTool(payload);
      const id = `call_${++sequence}`;
      const output = selected ? [{ type: 'function_call', id, call_id: id, name: selected[0],
        arguments: JSON.stringify(selected[1]), status: 'completed' }] : [];
      if (selected) {
        assert(payload.tools.some((tool) => tool.name === selected[0]));
        requests.push(selected[0]);
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `resp_${sequence}`, output }));
    } catch (error) {
      mockErrors.push(error);
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Unexpected test model request' } }));
    }
  });
  let child: ReturnType<typeof spawn> | undefined;
  let databaseStarted = false;
  try {
    mock.listen(0, '127.0.0.1');
    await once(mock, 'listening');
    const address = mock.address();
    assert(address && typeof address !== 'string');
    await database.initialise();
    await database.start();
    databaseStarted = true;
    child = spawn(process.execPath, ['build/backend/index.js'], {
      env: {
        ...process.env, DEMO_MODE: 'true', PHOTON_TEST_MODE: 'false', PHOTON_SPONSOR_REHEARSAL: 'false',
        PHOTON_MANAGER_PROJECT_ID: undefined, PHOTON_MANAGER_API_KEY: undefined, PHOTON_POLL_SINCE: undefined,
        PROPERTY_CONFIG: 'backend/config/property.demo.json', REPAIR_CONTEXT: 'false', BLENDER_RENDERER: undefined,
        PORT: String(appPort), PUBLIC_BASE_URL: origin, NUDGE_SECONDS: '3600', NEXT_TELEMETRY_DISABLED: '1',
        DATABASE_URL: `postgres://postgres:test@127.0.0.1:${databasePort}/postgres`, AGENT_MODE: 'true',
        OPENAI_API_KEY: mockKey, OPENAI_MODEL: 'local-test-model', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const send = async (id: string, role: 'tenant' | 'manager', text: string, image?: string) => {
      const response = await fetch(`${origin}/api/demo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role, text, image }),
      });
      assert.equal(response.status, 202);
    };
    await waitFor('the demo worker to start', async () => {
      const healthy = await fetch(`${origin}/healthz`).catch(() => undefined);
      if (healthy?.ok) return true;
    });

    await send('reported', 'tenant', 'Water stain near a window', demoPixel);
    await waitFor('the location clarification', async () => (await get<Demo>('/api/demo')).messages.find((message) =>
      message.target === 'tenant@demo.invalid' && message.body.includes('Where do you see it?')));
    assert.equal((await get<Demo>('/api/demo')).orders.length, 0);
    const turnsBeforeLocation = requests.length;
    await send('choose-location', 'tenant', '1');
    const order = await waitFor('the agent to file the report', async () => (await get<Demo>('/api/demo')).orders[0]);
    orderCode = `L-${order.id}`;
    const ticket = () => get<Order>(`/api/work-orders/${order.access_key}`);
    const withEvidence = await waitFor('the evidence hand-off to finish', async () => {
      const current = await ticket();
      if (current.timeline.some((event) => event.action === 'agent_brief')) return current;
    });
    assert.deepEqual(withEvidence.reports.map(({ description, has_photo }) => ({ description, has_photo })),
      [{ description: 'The tenant reports water by the conference room window.', has_photo: true }]);
    assert.equal(withEvidence.zoneId, 'west-roof');
    assert(withEvidence.timeline.some((event) => event.action === 'agent_triage'));
    assert.deepEqual(requests.slice(turnsBeforeLocation), ['get_order', 'post_brief']);
    assert.deepEqual(withEvidence.timeline.filter((event) => event.action === 'agent_trace').map((event) => event.detail), [
      'intake.consult_safety_triage → triage.assess → intake.list_locations → intake.file_report',
      'evidence.get_order → evidence.post_brief',
    ]);

    await send('request-visit', 'manager', 'Could the crew swing by tomorrow afternoon to look at it?');
    await waitFor('the manager confirmation prompt', async () => (await get<Demo>('/api/demo')).messages.find((message) =>
      message.target === 'manager@demo.invalid' && message.body.includes(`Schedule ${orderCode}`) && message.body.includes('Reply YES')));
    assert.equal((await ticket()).visitStart, null);
    await send('confirm-visit', 'manager', 'YES');
    const scheduled = await waitFor('the confirmed inspection', async () => {
      const current = await ticket();
      if (current.status === 'scheduled') return current;
    });
    assert(scheduled.visitStart);
    assert(scheduled.timeline.some((event) => event.action === 'agent_trace' && event.detail.includes('scheduler.schedule_visit')));

    await send('provider-fallback', 'tenant', 'Water dripping by the reception window');
    const another = await waitFor('the standard workflow to file the report after the model failure', async () =>
      (await get<Demo>('/api/demo')).orders.find(({ id }) => id !== order.id));
    const fallback = await get<Order>(`/api/work-orders/${another.access_key}`);
    assert.equal(fallback.zoneId, 'east-roof');
    assert(!fallback.timeline.some((event) => event.action === 'agent_triage'));
    assert(requests.includes('intake.protocol_failure'));
    assert.deepEqual(mockErrors, []);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    if (databaseStarted) await database.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
