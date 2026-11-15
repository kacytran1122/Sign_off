import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const id = 'ab123456-7890-4321-8000-123456789012';
const other = 'ab123456-7890-4321-8000-123456789099';
const secret = 'private-fixture-token-with-32-bytes';
const base = 'https://reports.example.test';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVx8AAAAASUVORK5CYII=';

async function workerFixture() {
  const { default: worker } = await import(pathToFileURL(resolve('backend/scripts/report-worker.mjs')).href);
  const objects = new Map<string, string>();
  const env = {
    REPORT_PUBLISH_TOKEN: secret,
    BUCKET: {
      async put(key: string, input: string) { objects.set(key, input); },
      async get(key: string) {
        const body = objects.get(key);
        if (body === undefined) return null;
        return { json: async () => JSON.parse(body) };
      },
    },
  };
  const request = (path: string, options: RequestInit = {}): Promise<Response> => worker.fetch(new Request(base + path, options), env);
  const publish = (data: unknown, options: RequestInit = {}) => request(`/internal/reports/${id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data), ...options,
  });
  return { request, publish, objects };
}

const example = {
  id: '2', issue: 'leak', status: 'open',
  guidance: 'Place a bucket under the drip if the area is safe.',
  effects: 'Water can damage nearby finishes.',
};

function expectPrivate(response: Response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
}

test('only the authenticated publisher can create private capability report snapshots', async () => {
  const { request, publish, objects } = await workerFixture();
  assert.equal((await publish(example, { headers: { 'Content-Type': 'application/json' } })).status, 404);
  assert.equal((await publish(example, { headers: { Authorization: 'Bearer fixture-wrong-secret', 'Content-Type': 'application/json' } })).status, 404);
  assert.equal((await publish(example, { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await publish({ ...example, id: '<script>' })).status, 400);
  assert.equal((await publish({ ...example, renderPng: Buffer.from('Fake PNG').toString('base64') })).status, 400);
  assert.equal(objects.size, 0);
  const created = await publish(example);
  assert.equal(created.status, 204);
  expectPrivate(created);
  assert.deepEqual([...objects.keys()], [`reports/${id}.json`]);
  for (const path of [
    '/', '/app', `/work-orders/${id}`, '/robots.txt', '/internal/reports', `/internal/reports/${id}`,
    `/reports/${other}`, `/reports/${id}/render`, `/api/reports/${other}/render`,
    `/reports/${id}?key=value`, '/reports/invalid-key',
  ]) {
    const result = await request(path);
    assert.equal(result.status, 404, path);
    expectPrivate(result);
  }
  assert.equal((await request(`/reports/${id}`, { method: 'POST' })).status, 404);
});

test('the report presents building and neighborhood evidence and serves the Blender PNG separately', async () => {
  const { request, publish, objects } = await workerFixture();
  const payload = {
    ...example, guidance: 'Leave <script>alert("untouched")</script> off the page.',
    renderPng: png,
    address: 'A private street address', tenantPhoto: 'should not be persisted', inspectionKey: 'never persist',
    area: {
      city: 'LOS ANGELES', latitude: 34.1234567, longitude: -117.7654321, timeZone: 'America/Los_Angeles', store: 'TimescaleDB',
      weather: {
        current: { time: '2026-11-15T08:00', temperature_2m: 72, apparent_temperature: 74, relative_humidity_2m: 55 },
        daily: { time: ['2026-11-16'], apparent_temperature_max: [78] },
      },
      coverage: { start_date: '2026-11-01', through_date: '2026-11-14', indicators: { water: 3, waste: 7 }, raw: 'untrusted' },
      heat: { typicalHighF: 81, validationMaeF: 2.1, trainedThrough: '2025-12-31' },
      history: [{ time: '2026-11-15T16:00:00Z', feelsLikeF: 74 }, { time: '2026-11-15T17:00:00Z', feelsLikeF: 79 }],
      coordinatesFromIntake: { latitude: 34.1234567 },
    },
    building: {
      storiesAboveGrade: 2, buildingType: 'Office', buildingAreaSqFt: 12_000, yearBuilt: 1991, matchedViewpoints: 7,
      roomLabel: 'Conference room', roomEvidence: { areaSqFt: 356, widthFt: 20.4, unknown: 'untrusted' },
      hasMatterport: true, hasVexcel: true, analysisDate: '2026-10-19', captureDate: '2026-05-20',
    },
  };
  assert.equal((await publish(payload)).status, 204);
  const page = await request(`/reports/${id}`);
  assert.equal(page.status, 200);
  expectPrivate(page);
  assert.match(page.headers.get('Content-Security-Policy') ?? '', /frame-src https:\/\/www\.openstreetmap\.org/);
  const html = await page.text();
  for (const fragment of ['Water leak', 'Work order L-2', 'OpenStreetMap contributors', 'Forecast feels-like highs', '78°F', 'Seasonal model estimate 81°F', 'TimescaleDB', 'city 311 reports', 'whether mice or rats are present', 'Building record provided by CoStar', 'Conference room', 'Matched Matterport interior', 'Matched Vexcel aerial imagery', '&lt;script&gt;']) {
    assert(html.includes(fragment), fragment);
  }
  assert(!html.includes('<script>'));
  assert(!html.includes('34.1234567'));
  assert(html.includes(`/api/reports/${id}/render`));
  const metadataResponse = await request(`/api/reports/${id}`);
  expectPrivate(metadataResponse);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.renderStatus, 'ready');
  assert.equal(metadata.area.latitude, 34.123);
  assert.equal(metadata.area.longitude, -117.765);
  for (const field of ['renderPng', 'address', 'tenantPhoto', 'inspectionKey']) assert(!Object.hasOwn(metadata, field), field);
  assert(![...objects.values()][0].includes('should not be persisted'));
  assert(![...objects.values()][0].includes('untrusted'));
  const image = await request(`/api/reports/${id}/render`);
  expectPrivate(image);
  assert.equal(image.headers.get('Content-Type'), 'image/png');
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), png);

  assert.equal((await publish({ ...example, status: 'closed' })).status, 204);
  assert.equal((await request(`/api/reports/${id}/render`)).status, 404);
  assert.equal((await (await request(`/api/reports/${id}`)).json()).status, 'closed');
});

test('the publisher rejects oversized bodies before storing them, including lengthless streams', async () => {
  const { publish, objects } = await workerFixture();
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  assert.equal((await publish(example, { headers: { ...headers, 'Content-Length': '8000000' } })).status, 413);
  let chunks = 0;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { canceled = true; },
  });
  const result = await publish(null, { headers, body, duplex: 'half' } as RequestInit);
  assert.equal(result.status, 413);
  assert.equal(objects.size, 0);
  assert(canceled);
  assert(chunks < 8);
});
