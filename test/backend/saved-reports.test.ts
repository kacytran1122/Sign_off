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

function binding(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = database.prepare(sql);
      return {
        bind(...params: SQLInputValue[]) {
          return {
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
  const { default: worker, savedReportsSchema } = await import(pathToFileURL(resolve('backend/scripts/saved-reports-worker.mjs')).href);
  const database = new DatabaseSync(filename);
  database.exec(savedReportsSchema);
  const env = { DB: binding(database), ALLOWED_ORIGIN: `${website}, https://www.signoffon.us` };
  const request = (path: string, init: RequestInit = {}): Promise<Response> => worker.fetch(new Request(hostname + path, init), env);
  const send = (path: string, method: string, body: unknown, cookie?: string, origin = website) => request(path, {
    method, body: JSON.stringify(body),
    headers: {
      Origin: origin, 'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const login = (password: string, cookie?: string) => send(session, 'POST', { username: 'signoff', password }, cookie);
  return { database, request, send, login };
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
