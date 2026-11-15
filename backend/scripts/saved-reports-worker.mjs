const base = '/api/saved-reports';
const sessionPath = `${base}/session`;
const photonPath = `${base}/photon`;
const internalPhotonPath = '/internal/saved-photon';
const reportPath = /^\/api\/saved-reports\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
const hostedReportPath = /^\/reports\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const verificationCode = /^[0-9A-F]{32}$/;
const scopePattern = /^[0-9a-f]{64}$/;
const cookieName = 'signoff_saved_session';
const sessionSeconds = 30 * 24 * 60 * 60;
const codeLifetimeMs = 10 * 60 * 1_000;
const indexLifetimeMs = 120_000;
const jsonLimit = 24_576;
const statuses = new Set(['received', 'scheduled', 'fixed']);
const photonStatuses = new Set(['open', 'scheduled', 'awaiting_confirmation', 'closed']);
const roles = new Set(['tenant', 'landlord']);

// These tables hold the shared fixed-account workspace only.
export const savedReportsSchema = [
  "CREATE TABLE IF NOT EXISTS saved_report_sessions (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('tenant', 'landlord')), expires_at INTEGER NOT NULL);",
  'CREATE INDEX IF NOT EXISTS saved_report_sessions_expiry ON saved_report_sessions (expires_at);',
  "CREATE TABLE IF NOT EXISTS saved_account_reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('received', 'scheduled', 'fixed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
].join('\n');

// Link grants are attached to the individual browser session, separate from the fixed accounts.
export const savedReportsPhotonSchema = [
  'CREATE TABLE IF NOT EXISTS saved_photon_links (session_hash TEXT PRIMARY KEY REFERENCES saved_report_sessions(token_hash) ON DELETE CASCADE, code_hash TEXT NOT NULL UNIQUE, code TEXT, expires_at INTEGER NOT NULL, scope TEXT, property_id TEXT);',
  'CREATE INDEX IF NOT EXISTS saved_photon_links_scope ON saved_photon_links (property_id, scope);',
  'CREATE TABLE IF NOT EXISTS saved_photon_report_index (property_id TEXT NOT NULL, scope TEXT NOT NULL, reports_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (property_id, scope));',
].join('\n');

const reportFields = 'id, title, description, status, created_at AS createdAt, updated_at AS updatedAt';

function headers(origin) {
  const value = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Origin',
  });
  if (origin) {
    value.set('Access-Control-Allow-Origin', origin);
    value.set('Access-Control-Allow-Credentials', 'true');
  }
  return value;
}

function json(body, responseHeaders, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readObject(request, limit = jsonLimit) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError('Send an application/json body.', 415);
  }
  if (Number(request.headers.get('Content-Length')) > limit) throw new RequestError('Request is too large.', 413);
  if (!request.body) throw new RequestError('Send a JSON object.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let content = '';
  let length = 0;
  const reader = request.body.getReader();
  let body;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new RequestError('Request is too large.', 413);
      }
      content += decoder.decode(value, { stream: true });
    }
    body = JSON.parse(content + decoder.decode());
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('Send a valid JSON object.');
  } finally {
    reader.releaseLock();
  }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new RequestError('Send a JSON object.');
  return body;
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

function sessionToken(request) {
  const match = /(?:^|;\s*)signoff_saved_session=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('Cookie') ?? '');
  return match?.[1];
}

function sessionCookie(url, token, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${token}; Path=${base}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

async function roleForToken(env, token) {
  if (!token) return null;
  const session = await env.DB.prepare('SELECT role FROM saved_report_sessions WHERE token_hash=? AND expires_at>?')
    .bind(await tokenHash(token), Date.now()).first();
  return session?.role ?? null;
}

function loginRole({ username, password }) {
  if (username !== 'signoff') return null;
  if (password === 'signoff') return 'tenant';
  if (password === 'landyord') return 'landlord';
  return null;
}

async function sessionResponse(request, env, url, responseHeaders) {
  const token = sessionToken(request);
  if (request.method === 'GET') return json({ role: await roleForToken(env, token) }, responseHeaders);
  if (request.method === 'DELETE') {
    if (token) {
      await env.DB.prepare('DELETE FROM saved_report_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
    }
    responseHeaders.set('Set-Cookie', sessionCookie(url, '', 0));
    return json({ role: null }, responseHeaders);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, responseHeaders, 405);
  const role = loginRole(await readObject(request));
  if (!role) return json({ error: 'The username or password is incorrect.' }, responseHeaders, 401);
  const db = env.DB;
  const newToken = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.prepare('DELETE FROM saved_report_sessions WHERE expires_at<=?').bind(now).run();
  await db.prepare('INSERT INTO saved_report_sessions (token_hash, role, expires_at) VALUES (?,?,?)')
    .bind(await tokenHash(newToken), role, now + sessionSeconds * 1_000).run();
  if (token) await db.prepare('DELETE FROM saved_report_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
  responseHeaders.set('Set-Cookie', sessionCookie(url, newToken, sessionSeconds));
  return json({ role }, responseHeaders);
}

function reportInput(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!title || title.length > 120 || !description || description.length > 3_000) {
    throw new RequestError('Enter a title up to 120 characters and details up to 3,000 characters.');
  }
  return { title, description };
}

async function reportsResponse(request, env, id, responseHeaders) {
  const role = await roleForToken(env, sessionToken(request));
  if (!role) return json({ error: 'Sign in to view reports.' }, responseHeaders, 401);

  if (!id && request.method === 'GET') {
    const { results: reports } = await env.DB.prepare(`SELECT ${reportFields} FROM saved_account_reports ORDER BY created_at DESC, id DESC`).all();
    return json({ reports }, responseHeaders);
  }
  if (!id && request.method === 'POST') {
    if (role !== 'tenant') return json({ error: 'Sign in as a tenant to submit a report.' }, responseHeaders, 403);
    const { title, description } = reportInput(await readObject(request));
    const now = new Date().toISOString();
    const report = { id: crypto.randomUUID(), title, description, status: 'received', createdAt: now, updatedAt: now };
    await env.DB.prepare('INSERT INTO saved_account_reports (id, title, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(report.id, title, description, report.status, now, now).run();
    return json({ report }, responseHeaders, 201);
  }
  if (id && request.method === 'PATCH') {
    if (role !== 'landlord') return json({ error: 'Sign in as a landlord to update a report.' }, responseHeaders, 403);
    const { status } = await readObject(request);
    if (!statuses.has(status)) throw new RequestError('Choose a valid report status.');
    const report = await env.DB.prepare(`UPDATE saved_account_reports SET status=?, updated_at=? WHERE id=? RETURNING ${reportFields}`)
      .bind(status, new Date().toISOString(), id).first();
    return report ? json({ report }, responseHeaders) : json({ error: 'Report unavailable.' }, responseHeaders, 404);
  }
  return json({ error: 'Method not allowed.' }, responseHeaders, 405);
}

async function photonResponse(request, env, responseHeaders) {
  const token = sessionToken(request);
  if (!token) return json({ error: 'Sign in to view Photon reports.' }, responseHeaders, 401);
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, responseHeaders, 405);
  }
  const db = env.DB;
  const sessionHash = await tokenHash(token);
  const now = Date.now();
  if (request.method === 'POST') {
    const code = hex(crypto.getRandomValues(new Uint8Array(16))).toUpperCase();
    await db.prepare(`
      INSERT INTO saved_photon_links (session_hash, code_hash, code, expires_at)
      SELECT token_hash, ?, ?, ? FROM saved_report_sessions WHERE token_hash=? AND expires_at>?
      ON CONFLICT (session_hash) DO UPDATE SET code_hash=excluded.code_hash, code=excluded.code, expires_at=excluded.expires_at
      WHERE saved_photon_links.scope IS NULL AND saved_photon_links.expires_at<=?
    `).bind(await tokenHash(code), code, now + codeLifetimeMs, sessionHash, now, now).run();
  }
  const link = await db.prepare(`
    SELECT l.code, l.scope, l.expires_at, r.reports_json
    FROM saved_report_sessions s
    LEFT JOIN saved_photon_links l ON l.session_hash=s.token_hash
    LEFT JOIN saved_photon_report_index r ON r.property_id=l.property_id AND r.scope=l.scope AND r.updated_at>?
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(now - indexLifetimeMs, sessionHash, now).first();
  if (!link) return json({ error: 'Sign in to view Photon reports.' }, responseHeaders, 401);
  if (link.scope) {
    return json(link.reports_json
      ? { state: 'linked', reports: JSON.parse(link.reports_json) }
      : { state: 'linked', reports: [], syncing: true }, responseHeaders);
  }
  if (link.code && link.expires_at > now) {
    return json({ state: 'pending', reports: [], code: link.code, expiresAt: new Date(link.expires_at).toISOString() }, responseHeaders);
  }
  return json({ state: 'unlinked', reports: [] }, responseHeaders);
}

async function validBridge(request, secret) {
  const authorization = request.headers.get('Authorization');
  if (typeof secret !== 'string' || secret.length < 32 ||
      !authorization?.startsWith('Bearer ') || authorization.length > 1_024) return false;
  const [expected, actual] = await Promise.all([tokenHash(secret), tokenHash(authorization.slice(7))]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

function validScope(scope, propertyId) {
  return typeof scope === 'string' && scopePattern.test(scope) && validProperty(propertyId);
}

function validProperty(propertyId) {
  return typeof propertyId === 'string' && propertyId.length > 0 && propertyId.length <= 128 && propertyId.trim() === propertyId;
}

async function verifyPhoton(request, db, responseHeaders, now) {
  const { code, role, scope, propertyId } = await readObject(request);
  if (typeof code !== 'string' || !verificationCode.test(code) || !roles.has(role) || !validScope(scope, propertyId)) {
    throw new RequestError('Invalid verification.');
  }
  const codeHash = await tokenHash(code);
  const updated = await db.prepare(`
    UPDATE saved_photon_links SET scope=?, property_id=?, code=NULL
    WHERE code_hash=? AND scope IS NULL AND expires_at>?
      AND EXISTS (SELECT 1 FROM saved_report_sessions s WHERE s.token_hash=saved_photon_links.session_hash AND s.role=? AND s.expires_at>?)
    RETURNING session_hash
  `).bind(scope, propertyId, codeHash, now, role, now).first();
  if (updated) return new Response(null, { status: 204, headers: responseHeaders });
  const existing = await db.prepare(`
    SELECT l.scope, l.property_id, l.expires_at, s.role FROM saved_photon_links l
    JOIN saved_report_sessions s ON l.session_hash=s.token_hash
    WHERE l.code_hash=? AND s.expires_at>?
  `).bind(codeHash, now).first();
  if (!existing || (!existing.scope && existing.expires_at <= now)) {
    return json({ error: 'Link code is unknown or expired.' }, responseHeaders, 404);
  }
  if (existing.scope === scope && existing.property_id === propertyId && existing.role === role) {
    return new Response(null, { status: 204, headers: responseHeaders });
  }
  return json({ error: 'Link code does not match this account.' }, responseHeaders, 409);
}

function safePhotonReport(report) {
  const { id, title, status, createdAt, url } = report ?? {};
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
      typeof title !== 'string' || title.length > 120 || !title.trim() ||
      !photonStatuses.has(status) || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    throw new RequestError('Invalid Photon report.');
  }
  const item = { id, title: title.trim(), status, createdAt: new Date(createdAt).toISOString() };
  if (url !== undefined) {
    if (typeof url !== 'string' || !hostedReportPath.test(url)) throw new RequestError('Invalid Photon report link.');
    item.url = url;
  }
  return item;
}

async function bridgeResponse(request, env, url, path) {
  const responseHeaders = headers();
  if (!await validBridge(request, env.REPORT_PUBLISH_TOKEN)) {
    return json({ error: 'Not found.' }, responseHeaders, 404);
  }
  const db = env.DB;
  const now = Date.now();
  if (path === `${internalPhotonPath}/verify` && request.method === 'POST') {
    return verifyPhoton(request, db, responseHeaders, now);
  }
  if (path === `${internalPhotonPath}/scopes` && request.method === 'GET') {
    const propertyId = url.searchParams.get('propertyId');
    if (!validProperty(propertyId)) throw new RequestError('Invalid property.');
    const { results } = await db.prepare(`
      SELECT DISTINCT l.scope FROM saved_photon_links l
      JOIN saved_report_sessions s ON s.token_hash=l.session_hash
      WHERE l.property_id=? AND l.scope IS NOT NULL AND s.expires_at>?
    `).bind(propertyId, now).all();
    return json({ scopes: results.map(row => row.scope) }, responseHeaders);
  }
  if (path === `${internalPhotonPath}/reports` && request.method === 'PUT') {
    const { scope, propertyId, reports } = await readObject(request, 131_072);
    if (!validScope(scope, propertyId) || !Array.isArray(reports) || reports.length > 200) {
      throw new RequestError('Invalid Photon report list.');
    }
    const reportJson = JSON.stringify(reports.map(safePhotonReport));
    const updated = await db.prepare(`
      INSERT INTO saved_photon_report_index (property_id, scope, reports_json, updated_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM saved_photon_links l JOIN saved_report_sessions s ON s.token_hash=l.session_hash
        WHERE l.property_id=? AND l.scope=? AND s.expires_at>?
      )
      ON CONFLICT (property_id, scope) DO UPDATE SET reports_json=excluded.reports_json, updated_at=excluded.updated_at
      RETURNING scope
    `).bind(propertyId, scope, reportJson, now, propertyId, scope, now).first();
    return updated ? new Response(null, { status: 204, headers: responseHeaders }) :
      json({ error: 'No verified session for this property and account.' }, responseHeaders, 404);
  }
  return json({ error: 'Not found.' }, responseHeaders, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const origin = request.headers.get('Origin');
    // Only the workspace itself or its configured frontend can make browser requests.
    const allowedOrigins = env.ALLOWED_ORIGIN?.split(',').map(value => value.trim()) ?? [];
    if (origin && origin !== url.origin && !allowedOrigins.includes(origin)) {
      return json({ error: 'Origin not allowed.' }, headers(), 403);
    }
    const responseHeaders = headers(origin);
    if (path.startsWith(`${internalPhotonPath}/`)) {
      try {
        return await bridgeResponse(request, env, url, path);
      } catch (error) {
        if (error instanceof RequestError) return json({ error: error.message }, headers(), error.status);
        return json({ error: 'Saved reports are temporarily unavailable.' }, headers(), 503);
      }
    }
    const id = reportPath.exec(path)?.[1];
    if (path !== base && path !== sessionPath && path !== photonPath && !id) {
      return json({ error: 'Not found.' }, responseHeaders, 404);
    }
    if (request.method === 'OPTIONS') {
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    try {
      if (path === sessionPath) return await sessionResponse(request, env, url, responseHeaders);
      if (path === photonPath) return await photonResponse(request, env, responseHeaders);
      return await reportsResponse(request, env, id, responseHeaders);
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, responseHeaders, error.status);
      return json({ error: 'Saved reports are temporarily unavailable.' }, responseHeaders, 503);
    }
  },
};
