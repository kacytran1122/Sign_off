import { createServer } from 'node:http';
import { Readable } from 'node:stream';

const key = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const reportPath = new RegExp(`^/(?:reports/${key}/?|api/reports/${key}(?:/render)?)$`, 'i');
const assetPath = /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/;
createServer(async (request, response) => {
  const path = request.url ?? '';
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' || !(reportPath.test(path) || assetPath.test(path))) {
    response.writeHead(404).end();
    return;
  }
  try {
    const upstream = await fetch(`http://127.0.0.1:4312${path}`, { signal: AbortSignal.timeout(10000) });
    response.statusCode = upstream.status;
    const type = upstream.headers.get('Content-Type');
    if (type) response.setHeader('Content-Type', type);
    response.setHeader('Cache-Control', assetPath.test(path) ? 'public, max-age=3600' : 'private, no-store');
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
    else response.end();
  } catch { response.writeHead(503).end(); }
}).listen(4313, '127.0.0.1');
