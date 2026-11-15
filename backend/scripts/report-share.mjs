import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const key = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const reportPath = new RegExp(`^/(?:reports/${key}/?|api/reports/${key}(?:/render)?)$`, 'i');
const staticPrefix = '/_next/static/';

function isStaticAsset(path) {
  if (!path.startsWith(staticPrefix) || !/\.(?:js|css|woff2)$/.test(path)) return false;
  return path.slice(staticPrefix.length).split('/').every((segment) => {
    // Only route group parentheses and dynamic segment brackets may be URL-encoded.
    const name = segment.replace(/%(?:28|29|5b|5d)/gi, decodeURIComponent);
    return name !== '.' && name !== '..' && /^[a-zA-Z0-9_~.()[\]-]+$/.test(name);
  });
}

export function createReportShareServer(upstreamOrigin) {
  return createServer(async (request, response) => {
    const path = request.url ?? '';
    const asset = isStaticAsset(path);
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' || !(reportPath.test(path) || asset)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const upstream = await fetch(`${upstreamOrigin}${path}`, { signal: AbortSignal.timeout(10000) });
      response.statusCode = upstream.status;
      const type = upstream.headers.get('Content-Type');
      if (type) response.setHeader('Content-Type', type);
      response.setHeader('Cache-Control', asset ? 'public, max-age=3600' : 'private, no-store');
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
      else response.end();
    } catch { response.writeHead(503).end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createReportShareServer('http://127.0.0.1:4312').listen(4313, '127.0.0.1');
}
