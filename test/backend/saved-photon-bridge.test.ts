import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { loadConfig } from '../../backend/config.js';
import { activatePhotonMessage, RetryableError, type Message } from '../../backend/photon.js';
import { createSavedPhotonBridge, savedPhotonReports, savedPhotonScope, syncSavedPhoton } from '../../backend/saved-photon.js';

const token = 'saved-photon-publish-token-for-local-tests';
const tenant = 'tenant@demo.invalid';
const landlord = 'manager@demo.invalid';
const secondTenant = 'tenant2@demo.invalid';
const origin = 'https://reports.example.invalid';

async function bridgeConfig() {
  const config = await loadConfig({ DEMO_MODE: 'true', DATABASE_URL: 'test-database-url' });
  return { ...config, demo: false, reportPublish: { origin, token } };
}

test('link commands use the verified participant role and an opaque property-specific scope', async () => {
  const config = await bridgeConfig();
  const calls: object[] = [];
  let status = 204;
  const fetchBridge: typeof fetch = async (input, init) => {
    assert.equal(input, `${origin}/internal/saved-photon/verify`);
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
    calls.push(JSON.parse(String(init?.body)));
    return new Response(null, { status });
  };
  const bridge = createSavedPhotonBridge({} as pg.Pool, config, fetchBridge);
  const code = 'AABBCCDDEEFF00112233445566778899';
  const message: Message = { id: 'one', text: `LINK ${code}`, handle: tenant, space: 'space', agent: 'agent' };
  const tenantScope = savedPhotonScope(token, config.property.id, 'tenant', tenant);
  const landlordScope = savedPhotonScope(token, config.property.id, 'landlord', landlord);
  try {
    // The production dispatcher runs this guard before the link bridge.
    assert.equal(await activatePhotonMessage({} as pg.PoolClient, message, 'tenant', 'project'), undefined);
    const admitted = await activatePhotonMessage({} as pg.PoolClient,
      { ...message, text: `@signoff LINK ${code.toLowerCase()}` }, 'tenant', 'project');
    assert(admitted);
    assert.match(await bridge.link(admitted.text, tenant) ?? '', /linked/);
    assert.match(await bridge.link(message.text, landlord) ?? '', /linked/);
    assert.deepEqual(calls, [
      { code, role: 'tenant', scope: tenantScope, propertyId: config.property.id },
      { code, role: 'landlord', scope: landlordScope, propertyId: config.property.id },
    ]);
    assert.match(tenantScope, /^[0-9a-f]{64}$/);
    assert.equal(tenantScope, savedPhotonScope(token, config.property.id, 'tenant', ' TENANT@DEMO.INVALID '));
    assert.notEqual(tenantScope, savedPhotonScope(token, 'another-property', 'tenant', tenant));
    assert.notEqual(tenantScope, savedPhotonScope(token, config.property.id, 'landlord', tenant));
    assert.match(await bridge.link('LINK not-a-code', tenant) ?? '', /create a link code/);
    assert.equal(await bridge.link('Ceiling leak', tenant), undefined);
    assert.equal(await bridge.link('Link to report L-2', landlord), undefined);
    assert.match(await bridge.link(message.text, 'unknown@example.invalid') ?? '', /unavailable/);
    assert.equal(calls.length, 2);

    status = 409;
    assert.match(await bridge.link(message.text, landlord) ?? '', /matching role/);
    status = 404;
    assert.match(await bridge.link(message.text, tenant) ?? '', /expired/);
    status = 503;
    await assert.rejects(bridge.link(message.text, tenant), RetryableError);
  } finally {
    await bridge.stop();
  }
});

test('history sync scopes real work-order rows to the reporting tenant or verified property', { timeout: 30_000 }, async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), 'signoff-saved-photon-'));
  const database = new EmbeddedPostgres({
    databaseDir: join(dir, 'db'), port: address.port, user: 'postgres', password: 'test',
    persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {},
  });
  const pool = new pg.Pool({ connectionString: `postgres://postgres:test@127.0.0.1:${address.port}/postgres` });
  const config = await bridgeConfig();
  const { id: property } = config.property;
  const keys = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ];

  try {
    await database.initialise();
    await database.start();
    await pool.query(await readFile('backend/db/schema.sql', 'utf8'));
    await pool.query(`INSERT INTO work_orders (id, property_id, zone_id, status, access_key) VALUES
      (1,$1,'zone','open',$3), (2,$1,'zone','scheduled',$4), (3,$1,'zone','awaiting_confirmation',$5),
      (4,$2,'zone','open',DEFAULT), (5,$1,'zone','closed',DEFAULT)`, [property, 'different-property', ...keys]);
    await pool.query(`INSERT INTO reports (order_id, message_id, reporter, landmark_id, description, created_at) VALUES
      (1,'one',$1,'spot','Ceiling wet at 123 Private Road','2026-11-01'),
      (2,'two',$2,'spot','Sink leak at an unrelated suite','2026-11-02'),
      (3,'three',$2,'spot','Sink leak at an unrelated suite','2026-11-03'),
      (3,'four',$1,'spot','Ceiling leak in own report','2026-11-04'),
      (4,'five',$1,'spot','Leak at a different property','2026-11-05'),
      (5,'six',$1,'spot','Leak at 123 Private Road','2026-11-06')`, [tenant, secondTenant]);
    await pool.query(`INSERT INTO repair_contexts (order_id,address,property_match,issue,aid) VALUES
      (1,'123 Private Road',true,'leak','bucket'), (2,'123 Private Road',true,'leak','bucket'),
      (3,'123 Private Road',true,'leak','bucket'), (5,'999 Other Road',false,'leak','bucket')`);
    await pool.query(`INSERT INTO report_publications (order_id, revision) VALUES
      (1,'published'), (2,NULL), (3,'published')`);

    const tenantReports = await savedPhotonReports(pool, property, tenant);
    const landlordReports = await savedPhotonReports(pool, property);
    assert.deepEqual(tenantReports.map(({ id }) => id), ['5', '3', '1']);
    assert.deepEqual(landlordReports.map(({ id }) => id), ['3', '2', '1']);
    assert.equal(tenantReports[1].title, 'Ceiling leak');
    assert.equal(landlordReports[0].title, 'Under-sink leak');
    assert.equal(tenantReports[1].url, undefined);
    assert.equal(tenantReports[2].url, `/reports/${keys[0]}`);
    assert.equal(landlordReports[1].url, undefined);
    assert.equal(landlordReports[0].url, `/reports/${keys[2]}`);
    assert.doesNotMatch(JSON.stringify({ tenantReports, landlordReports }), /Private Road|Other Road|describe|@demo\.invalid/);

    const tenantScope = savedPhotonScope(token, property, 'tenant', tenant);
    const landlordScope = savedPhotonScope(token, property, 'landlord', landlord);
    const removedScope = 'f'.repeat(64);
    const sent: object[] = [];
    const syncTransport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, origin);
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
      if (init?.method === 'GET') {
        assert.equal(url.pathname, '/internal/saved-photon/scopes');
        assert.equal(url.searchParams.get('propertyId'), property);
        return Response.json({ scopes: [tenantScope, landlordScope, removedScope, tenantScope] });
      }
      assert.equal(url.pathname, '/internal/saved-photon/reports');
      assert.equal(init?.method, 'PUT');
      sent.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    };
    await syncSavedPhoton(pool, config, syncTransport);
    assert.deepEqual(sent, [
      { propertyId: property, scope: tenantScope, reports: tenantReports },
      { propertyId: property, scope: landlordScope, reports: landlordReports },
      { propertyId: property, scope: removedScope, reports: [] },
    ]);
  } finally {
    await pool.end();
    await database.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
