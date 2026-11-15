const base = '/api/saved-reports';
const sessionPath = `${base}/session`;
const reportPath = /^\/api\/saved-reports\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
const cookieName = 'signoff_saved_session';
const sessionSeconds = 30 * 24 * 60 * 60;
const jsonLimit = 24_576;
const statuses = new Set(['received', 'scheduled', 'fixed']);

// These tables hold the shared fixed-account workspace only.
export const savedReportsSchema = [
  "CREATE TABLE IF NOT EXISTS saved_report_sessions (token_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('tenant', 'landlord')), expires_at INTEGER NOT NULL);",
  'CREATE INDEX IF NOT EXISTS saved_report_sessions_expiry ON saved_report_sessions (expires_at);',
  "CREATE TABLE IF NOT EXISTS saved_account_reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('received', 'scheduled', 'fixed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
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

async function readObject(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError('Send an application/json body.', 415);
  }
  if (Number(request.headers.get('Content-Length')) > jsonLimit) throw new RequestError('Request is too large.', 413);
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
      if (length > jsonLimit) {
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
    const id = reportPath.exec(path)?.[1];
    if (path !== base && path !== sessionPath && !id) return json({ error: 'Not found.' }, responseHeaders, 404);
    if (request.method === 'OPTIONS') {
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    try {
      return path === sessionPath
        ? await sessionResponse(request, env, url, responseHeaders)
        : await reportsResponse(request, env, id, responseHeaders);
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, responseHeaders, error.status);
      return json({ error: 'Saved reports are temporarily unavailable.' }, responseHeaders, 503);
    }
  },
};
