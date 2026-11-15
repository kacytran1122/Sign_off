import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const hostname = 'https://reports.signoffon.us';
const website = 'https://signoffon.us';
const base = '/api/saved-reports';
const session = `${base}/session`;
const photon = `${base}/photon`;
const internal = '/internal/saved-photon';
const bridgeToken = 'fixture-token-for-private-photon-bridge';

function binding(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = database.prepare(sql);
      return {
        bind(...params: SQLInputValue[]) {
          return {
            async all() { return { results: statement.all(...params) }; },
            async first() { return statement.get(...params) ?? null; },
            async run() { return statement.run(...params); },
          };
        },
        async all() { return { results: statement.all() }; },
      };
    },
  };
}

async function fixture(filename = ':memory:') {
  const { default: worker, savedReportsSchema, savedReportsPhotonSchema } = await import(pathToFileURL(resolve('backend/scripts/saved-reports-worker.mjs')).href);
  const database = new DatabaseSync(filename);
  database.exec(savedReportsSchema);
  database.exec(savedReportsPhotonSchema);
  const env = { DB: binding(database), ALLOWED_ORIGIN: `${website}, https://www.signoffon.us`, REPORT_PUBLISH_TOKEN: bridgeToken };
  const request = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(hostname + path, init), env);
  const send = (path: string, method: string, body: unknown, cookie?: string, origin = website) => request(path, {
    method, body: JSON.stringify(body),
    headers: {
      Origin: origin, 'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const login = (password: string, cookie?: string) => send(session, 'POST', { username: 'signoff', password }, cookie);
  const bridge = (path: string, method = 'GET', body?: unknown) => request(internal + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: `Bearer ${bridgeToken}`, 'Content-Type': 'application/json' },
  });
  return { database, request, send, login, bridge };
}

function cookieFrom(response: Response) {
  const cookie = response.headers.get('Set-Cookie');
  assert(cookie);
  assert.match(cookie, /^signoff_saved_session=[0-9a-f]{64}; Path=\/api\/saved-reports; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure$/);
  return cookie.split(';', 1)[0];
}

test('tenant reports persist across database reopen and can only be updated by the landlord', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'signoff-saved-reports-'));
  const filename = join(directory, 'saved-reports.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = await fixture(filename);
  let created;
  try {
    assert.equal((await original.request(base)).status, 401);
    assert.deepEqual(await (await original.request(session)).json(), { role: null });
    assert.equal((await original.login('landlord')).status, 401);

    const tenantLogin = await original.login('signoff');
    assert.equal(tenantLogin.status, 200);
    assert.deepEqual(await tenantLogin.json(), { role: 'tenant' });
    const tenant = cookieFrom(tenantLogin);
    const tokenInStorage = original.database.prepare('SELECT token_hash FROM saved_report_sessions').get()?.token_hash;
    assert(tokenInStorage);
    assert.notEqual(tokenInStorage, tenant.slice(tenant.indexOf('=') + 1));
    const result = await original.send(base, 'POST', { title: ' Ceiling leak ', description: 'Dripping over the sink.' }, tenant);
    assert.equal(result.status, 201);
    const payload = await result.json();
    assert.equal(payload.report.title, 'Ceiling leak');
    assert.equal(payload.report.status, 'received');
    created = payload.report;

    const patch = await original.send(`${base}/${created.id}`, 'PATCH', { status: 'fixed' }, tenant);
    assert.equal(patch.status, 403);
    const logout = await original.request(session, { method: 'DELETE', headers: { Cookie: tenant, Origin: website } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
    assert.equal((await original.request(base, { headers: { Cookie: tenant } })).status, 401);
  } finally {
    original.database.close();
  }

  const reopened = await fixture(filename);
  try {
    const landlordLogin = await reopened.login('landyord');
    assert.equal(landlordLogin.status, 200);
    assert.deepEqual(await landlordLogin.json(), { role: 'landlord' });
    const landlord = cookieFrom(landlordLogin);
    const records = await reopened.request(base, { headers: { Cookie: landlord } });
    assert.equal(records.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await records.json(), { reports: [created] });
    assert.equal((await reopened.send(base, 'POST', { title: 'Leak', description: 'Water' }, landlord)).status, 403);
    assert.equal((await reopened.send(`${base}/${created.id}`, 'PATCH', { status: 'invalid' }, landlord)).status, 400);
    const response = await reopened.send(`${base}/${created.id}`, 'PATCH', { status: 'fixed' }, landlord);
    assert.equal(response.status, 200);
    const { report } = await response.json();
    assert.equal(report.id, created.id);
    assert.equal(report.status, 'fixed');
    assert.equal(report.createdAt, created.createdAt);
    const reentered = cookieFrom(await reopened.login('signoff', landlord));
    assert.equal((await reopened.request(base, { headers: { Cookie: landlord } })).status, 401);
    assert.deepEqual(await (await reopened.request(base, { headers: { Cookie: reentered } })).json(), { reports: [report] });
  } finally {
    reopened.database.close();
  }
});

test('saved reports checks browser origins, payload bounds, and session expiry', async (t) => {
  const { database, request, send, login } = await fixture();
  t.after(() => database.close());

  const preflight = await request(session, {
    method: 'OPTIONS', headers: { Origin: website, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), website);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), 'true');

  const sessionCookie = cookieFrom(await login('signoff'));
  const crossOrigin = await send(base, 'POST', { title: 'Leak', description: 'Water' }, sessionCookie, 'https://attacker.example');
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.has('Access-Control-Allow-Origin'), false);
  const badType = await request(base, {
    method: 'POST', body: 'title=Leak', headers: { Cookie: sessionCookie, 'Content-Type': 'text/plain' },
  });
  assert.equal(badType.status, 415);
  assert.equal((await send(base, 'POST', { title: 'Leak', description: 'a'.repeat(24_576) }, sessionCookie)).status, 413);
  assert.equal((await send(base, 'POST', { title: ' ', description: 'Water' }, sessionCookie)).status, 400);
  assert.deepEqual(await (await request(base, { headers: { Cookie: sessionCookie } })).json(), { reports: [] });

  database.prepare('UPDATE saved_report_sessions SET expires_at=0').run();
  assert.deepEqual(await (await request(session, { headers: { Cookie: sessionCookie } })).json(), { role: null });
  assert.equal((await request(base, { headers: { Cookie: sessionCookie } })).status, 401);
});

test('Photon proof authorizes only the linked browser session and property', async t => {
  const { database, request, bridge, login } = await fixture();
  t.after(() => database.close());
  const propertyId = 'property-a';
  const tenantScope = 'a'.repeat(64);
  const otherTenantScope = 'b'.repeat(64);
  const landlordScope = 'c'.repeat(64);
  const tenant = cookieFrom(await login('signoff'));
  const otherTenant = cookieFrom(await login('signoff'));
  const landlord = cookieFrom(await login('landyord'));
  const fixedOnly = cookieFrom(await login('signoff'));
  const read = (Cookie: string, method = 'GET') => request(photon, { method, headers: { Cookie, Origin: website } });
  const verify = (code: string, role: string, scope: string) => bridge('/verify', 'POST', { code, role, scope, propertyId });
  const write = (scope: string, reports: unknown[], building = propertyId) => bridge('/reports', 'PUT', { scope, propertyId: building, reports });
  const record = (id: string, url?: string) => ({ id, title: 'Repair report', status: 'open', createdAt: '2026-11-15T13:00:00.000Z', url });
  const tenantReport = record('7', '/reports/8d08830e-ee22-4b50-bcb8-71bb8d176520');
  const otherTenantReport = record('8');

  assert.equal((await request(photon)).status, 401);
  assert.equal((await request(`${internal}/scopes?propertyId=${propertyId}`)).status, 404);
  assert.equal((await write(tenantScope, [tenantReport])).status, 404);
  assert.deepEqual(await (await read(tenant)).json(), { state: 'unlinked', reports: [] });
  const pending = await (await read(tenant, 'POST')).json();
  assert.equal(pending.state, 'pending');
  assert.match(pending.code, /^[0-9A-F]{32}$/);
  assert.deepEqual(await (await read(tenant, 'POST')).json(), pending);
  const otherCode = (await (await read(otherTenant, 'POST')).json()).code;
  const landlordCode = (await (await read(landlord, 'POST')).json()).code;
  assert.notEqual(otherCode, pending.code);
  assert.equal((await verify(pending.code, 'landlord', landlordScope)).status, 409);
  assert.equal((await verify(pending.code, 'tenant', tenantScope)).status, 204);
  assert.equal((await verify(pending.code, 'tenant', tenantScope)).status, 204);
  assert.equal((await verify(pending.code, 'tenant', otherTenantScope)).status, 409);
  assert.equal((await verify(otherCode, 'tenant', otherTenantScope)).status, 204);
  assert.equal((await verify(landlordCode, 'landlord', landlordScope)).status, 204);
  assert.deepEqual(await (await read(tenant)).json(), { state: 'linked', reports: [], syncing: true });
  const scopes = await (await bridge(`/scopes?propertyId=${propertyId}`)).json();
  assert.deepEqual(scopes.scopes.sort(), [tenantScope, otherTenantScope, landlordScope]);
  assert.deepEqual(await (await bridge('/scopes?propertyId=property-b')).json(), { scopes: [] });
  assert.equal((await write(tenantScope, [tenantReport], 'property-b')).status, 404);
  assert.equal((await write(tenantScope, [record('7', 'https://example.invalid/report')])).status, 400);

  assert.equal((await write(tenantScope, [{ ...tenantReport, reporter: 'private-field' }])).status, 204);
  assert.equal((await write(otherTenantScope, [otherTenantReport])).status, 204);
  assert.equal((await write(landlordScope, [tenantReport, otherTenantReport])).status, 204);
  assert.deepEqual(await (await read(tenant)).json(), { state: 'linked', reports: [tenantReport] });
  assert.deepEqual(await (await read(otherTenant)).json(), {
    state: 'linked', reports: [{ id: '8', title: 'Repair report', status: 'open', createdAt: '2026-11-15T13:00:00.000Z' }],
  });
  const landlordList = await read(landlord);
  assert.equal(landlordList.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual((await landlordList.json()).reports.map((report: { id: string }) => report.id), ['7', '8']);
  assert.deepEqual(await (await read(fixedOnly)).json(), { state: 'unlinked', reports: [] });

  const expired = (await (await read(fixedOnly, 'POST')).json()).code;
  database.prepare('UPDATE saved_photon_links SET expires_at=0 WHERE code=?').run(expired);
  assert.equal((await verify(expired, 'tenant', tenantScope)).status, 404);
  assert.deepEqual(await (await read(fixedOnly)).json(), { state: 'unlinked', reports: [] });
  assert.notEqual((await (await read(fixedOnly, 'POST')).json()).code, expired);

  database.prepare('UPDATE saved_photon_report_index SET updated_at=0 WHERE scope=?').run(tenantScope);
  assert.deepEqual(await (await read(tenant)).json(), { state: 'linked', reports: [], syncing: true });
  assert.equal((await request(session, { method: 'DELETE', headers: { Cookie: tenant } })).status, 200);
  assert.equal((await read(tenant)).status, 401);
  assert.equal((await verify(pending.code, 'tenant', tenantScope)).status, 404);
  assert.equal((await write(tenantScope, [tenantReport])).status, 404);
});
