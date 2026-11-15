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
        daily: { time: ['2026-11-16', '2026-11-17'], apparent_temperature_max: [78, 81] },
      },
      coverage: { start_date: '2026-11-01', through_date: '2026-11-14', indicators: { water: 3, waste: 7 }, raw: 'untrusted' },
      heat: { typicalHighF: 81, validationMaeF: 2.1, trainedThrough: '2025-12-31' },
      history: [
        { time: '2026-11-15T17:00:00Z', feelsLikeF: 79 },
        { time: '2026-11-15T16:00:00Z', feelsLikeF: 74 },
        { time: '2026-11-15T21:00:00Z', feelsLikeF: 73 },
      ],
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
  assert.match(page.headers.get('Content-Security-Policy') ?? '', /frame-src https:\/\/www\.arcgis\.com;/);
  const html = await page.text();
  for (const fragment of ['Water leak', 'Work order L-2', 'Neighborhood satellite view', 'Esri World Imagery', 'Forecast feels-like highs', '78°F', 'Seasonal model estimate 81°F', 'TimescaleDB', 'city 311 reports', 'whether mice or rats are present', 'Building record provided by CoStar', 'Conference room', 'Matched Matterport interior', 'Matched Vexcel aerial imagery', '&lt;script&gt;']) {
    assert(html.includes(fragment), fragment);
  }
  assert.match(html, /<iframe title="Neighborhood satellite map"[^>]+referrerpolicy="no-referrer"[^>]+src="https:\/\/www\.arcgis\.com\/apps\/Embed\/index\.html\?webmap=86265e5a4bbb4187a59719cf134e0018&amp;center=-117\.765%2C34\.123&amp;level=18/);
  assert.doesNotMatch(html, /OpenStreetMap|explain the precaution|separate records/);
  assert.match(html, /aria-labelledby="observed-title observed-description"/);
  assert.match(html, /aria-labelledby="forecast-title forecast-description"/);
  // The duplicate or missing measurement must never be replaced by an invented value or line.
  assert.match(html, /class="chart-line" d="M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ M[\d.]+ [\d.]+"/);
  assert.match(html, /<time datetime="2026-11-15T16:00:00\.000Z">[^<]+<\/time><\/th><td>74°F<\/td>/);
  assert.match(html, /<time datetime="2026-11-17">[^<]+<\/time><\/th><td>81°F<\/td>/);
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

test('the report uses the repair scenario and reserves the roof inspection path for linked overhead damage', async () => {
  const { request, publish } = await workerFixture();
  const building = {
    storiesAboveGrade: 1,
    hasMatterport: true, hasVexcel: true,
    inspectionSteps: ['Inspect the room below the roof feature.', { unexpected: true }, 'Review <linked> images.'],
    roofEvidence: ['Roof material classification from the aerial capture.'],
  };
  const render = async (data: Record<string, unknown>) => {
    assert.equal((await publish({ ...example, building, renderPng: png, ...data })).status, 204);
    return (await request(`/reports/${id}`)).text();
  };
  const ceiling = await render({ scenario: 'ceiling-leak', aid: 'bucket' });
  assert.match(ceiling, /<h1>Ceiling leak<\/h1>/);
  assert.match(ceiling, /Suggested inspection path/);
  assert.match(ceiling, /Review &lt;linked&gt; images/);
  assert.doesNotMatch(ceiling, /unexpected|<svg viewBox=/);
  assert.match(ceiling, /Data unavailable\./);

  const sink = await render({ scenario: 'sink-leak', aid: 'bucket' });
  assert.match(sink, /<h1>Under-sink leak<\/h1>/);
  assert.match(sink, /Cabinet cutaway with the drain, trap and collection area/);
  assert.doesNotMatch(sink, /Suggested inspection path|Inspect the room below the roof feature/);

  const stair = await render({ issue: 'damage', scenario: 'damaged-stair', aid: 'stair-sign' });
  assert.match(stair, /<h1>Damaged stair<\/h1>/);
  assert.match(stair, /Avoid the damaged step/);
  assert.doesNotMatch(stair, /Suggested inspection path|Demo|illustrative/i);

  const blocked = await render({ scenario: 'sink-leak', aid: 'clear' });
  assert.match(blocked, /Keep clear of the affected area/);
  assert.doesNotMatch(blocked, /Cabinet cutaway/);
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
