import { strict as assert } from 'node:assert';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

async function listen(t: TestContext, server: Server) {
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  t.after(() => new Promise<void>((closed) => server.close(() => closed())));
  return (server.address() as AddressInfo).port;
}

async function probe(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((done, reject) => {
    request({ hostname: '127.0.0.1', port, path, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => done({ status: response.statusCode!, headers: response.headers, body }));
      response.on('error', reject);
    }).on('error', reject).end();
  });
}

test('the report share proxies report content and Next static assets only', async (t) => {
  const { createReportShareServer } = await import(pathToFileURL(resolve('backend/scripts/report-share.mjs')).href);
  const forwarded: string[] = [];
  const upstream = await listen(t, createServer((incoming, outgoing) => {
    forwarded.push(incoming.url!);
    outgoing.setHeader('Content-Type', 'text/plain');
    outgoing.end(incoming.url);
  }));
  const port = await listen(t, createReportShareServer(`http://127.0.0.1:${upstream}`));
  const key = 'ab123456-7890-4321-8000-123456789012';
  const reports = [`/reports/${key}`, `/api/reports/${key}`, `/api/reports/${key}/render`];
  const assets = [
    '/_next/static/chunks/report.03~abcd.js',
    '/_next/static/chunks/app/(workspace)/reports/%5Bkey%5D/page.css',
    '/_next/static/media/demo.woff2',
  ];

  for (const path of [...reports, ...assets]) {
    const response = await probe(port, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, path);
    assert.equal(response.headers['cache-control'], reports.includes(path) ? 'private, no-store' : 'public, max-age=3600');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }

  for (const path of [
    '/', '/app', `/work-orders/${key}`, `/api/work-orders/${key}`,
    `/reports/${key}?x=1`, `/api/reports/${key}/photos`,
    '/_next/server/config.js', '/_next/static/../server/config.js',
    '/_next/static/%2e%2e/server/config.js', '/_next/static/chunks%2Freport.js',
    '/_next/static/chunks/report.js?x=1', '/_next/static/chunks/report.js.map',
  ]) {
    assert.equal((await probe(port, path)).status, 404, path);
  }
  assert.equal((await probe(port, reports[0], 'POST')).status, 404);
  assert.deepEqual(forwarded, [...reports, ...assets]);
});
