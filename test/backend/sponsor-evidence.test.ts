import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

type Point = [number, number];
type Bounds = [number, number, number, number];

const modelId = 'ExampleModel';
const bounds: Bounds = [-10, -10, 110, 110];
const neighborBounds: Bounds = [110, -10, 230, 110];
const building: Bounds = [0, 0, 100, 100];
const neighbor: Bounds = [120, 0, 220, 100];
const scans: Point[] = [[20, 20], [65, 70], [15, 80], [25, 65], [45, 35], [70, 45], [78, 80], [80, 15]];

const corners = ([left, bottom, right, top]: Bounds): Point[] =>
  [[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]];
const radius = 6_378_137;
const geographic = ([east, north]: Point): Point => [
  east / radius * 180 / Math.PI,
  (2 * Math.atan(Math.exp(north / radius)) - Math.PI / 2) * 180 / Math.PI,
];
const footprint = (extent: Bounds) => ({
  type: 'Feature',
  properties: {
    'roof-characteristics.material.class': extent === building ? 'Metal' : 'Tile',
    'metadata.is-ortho-image': true,
    'metadata.ortho-date-estimate': '2025-07-14T00:00:00Z',
    'roof-characteristics.tree-cover.percent': extent === building ? 7.3 : 93,
    'roof-defects.discoloration.types.water-pooling.detected': extent === building,
  },
  geometry: { type: 'MultiPolygon', coordinates: [[corners(extent).map(geographic)]] },
});

const normalize = ([east, north]: Point, [left, bottom, right, top]: Bounds): Point =>
  [(east - left) / (right - left), (top - north) / (top - bottom)];

function fixture(structures: Bounds[]) {
  const rooms = [
    { id: 'lobby', dimensionEstimates: { area: 19, areaIndoor: 18, width: 5, depth: 3.8, height: 2.7, units: 'metric' } },
    { id: 'office', dimensionEstimates: { area: 120, width: 0, height: 9, units: undefined } },
  ];
  const locations = scans.map(([x, y], i) => ({
    id: `scan-${i}`, position: { x, y, z: 1 }, room: rooms[i % rooms.length], panos: [{ id: `pano-${i}` }],
  }));
  const verified = {
    row: { PropertyId: '42', MatterportModelId: modelId, Address: '42 Example St', City: 'Houston', State: 'TX' },
    record: { id: 42, numStoriesAboveGrade: 1, propertyType: 'Office', propertySubtype: 'Medical',
      yearBuilt: 1996, grossBuildingAreaSquareFeet: 100_000 },
    model: { id: modelId, rooms, locations },
    structure: { body: { type: 'FeatureCollection', features: structures.map(footprint) } },
  };
  const projected = scans.map((point, i) => ({
    // The authoritative model must supply the panorama, room and local position.
    scan: { id: locations[i].id, panos: [{ id: 'stale-pano' }] },
    roomId: 'stale-room', point: geographic(point), inside: false,
  }));
  const zones = [
    { id: 'roof-lobby', polygon: [[.2, .6], [.3, .6], [.3, .7], [.2, .7]] },
    { id: 'roof-office', polygon: [[.6, .3], [.7, .3], [.7, .4], [.6, .4]] },
  ];
  const overlay = {
    bounds3857: bounds as Bounds | undefined,
    outline: corners(building).map((point) => normalize(point, bounds)),
    zones,
  };
  const property = {
    id: '42', matterportModel: modelId, address: '42 Example St, Houston, TX',
    roof: { imageFile: 'backend/config/roof-assets/example.jpg' },
    zones,
    landmarks: locations.slice(0, 2).map((location, i) => ({
      id: rooms[i].id, zoneId: zones[i].id, views: [{ sweep: location.panos[0].id }],
    })),
  };
  return { verified, projected, overlay, property };
}

async function run(t: TestContext, { verified, projected, overlay, property }: ReturnType<typeof fixture>, dimensions?: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'signoff-sponsor-evidence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = ['verified.json', 'projected.json', 'overlay.json', 'property.json'].map((name) => join(dir, name));
  const inputs = [verified, projected, overlay, property].map((input) => JSON.stringify(input, null, 2) + '\n');
  await Promise.all(files.map((file, index) => writeFile(file, inputs[index])));
  if (dimensions) {
    const dimensionFile = join(dir, 'room-dimensions.json');
    await writeFile(dimensionFile, JSON.stringify(dimensions));
    files.push(dimensionFile);
  }
  const result = spawnSync(process.execPath, ['backend/scripts/import-sponsor-evidence.mjs', ...files], {
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  const output = await readFile(files[3], 'utf8');
  return { result, output, original: inputs[3] };
}

function assertCalibrated(output: string) {
  const imported = JSON.parse(output);
  assert.deepEqual(imported.landmarks.map((landmark: { matterportRoomId: string }) => landmark.matterportRoomId), ['lobby', 'office']);
  const { u, v } = imported.roof.projection;
  assert.ok(Math.abs(u[0] * 40 + u[1] * 30 + u[2] - 50 / 120) < 1e-6);
  assert.ok(Math.abs(v[0] * 40 + v[1] * 30 + v[2] - 80 / 120) < 1e-6);
}

test('sponsor evidence selects and calibrates the same roof in either feature order', async (t) => {
  for (const structures of [[neighbor, building], [building, neighbor]]) {
    const { result, output } = await run(t, fixture(structures));
    assert.equal(result.status, 0, result.stderr);
    assertCalibrated(output);
    const imported = JSON.parse(output);
    assert.deepEqual(imported.costar, { storiesAboveGrade: 1, buildingType: 'Office', buildingAreaSqFt: 100_000,
      yearBuilt: 1996, propertySubtype: 'Medical', candidateStructures: 2, matchedViewpoints: 2, matchedRooms: 2 });
    assert.deepEqual(imported.roof.attributes, [
      { label: 'Roof material', value: 'Metal' },
      { label: 'Tree cover over roof', value: '7%' },
      { label: 'Possible pooling in aerial analysis', value: 'Verify on site' },
    ]);
    assert.equal(imported.roof.analysisDate, '2025-07-14');
    assert.ok(Math.abs(imported.landmarks[0].roomEvidence.areaSqFt - 18 / .3048 ** 2) < 1e-8);
    assert.ok(Math.abs(imported.landmarks[0].roomEvidence.heightFt - 2.7 / .3048) < 1e-8);
    assert.equal(imported.landmarks[1].roomEvidence, undefined);
  }
});

test('sponsor evidence still accepts a verified single structure with a legacy crop', async (t) => {
  const input = fixture([building]);
  input.overlay.bounds3857 = undefined;
  const { result, output } = await run(t, input);
  assert.equal(result.status, 0, result.stderr);
  assertCalibrated(output);
});

test('multistory properties keep building and room evidence without a roof projection', async (t) => {
  const input = fixture([building]);
  input.verified.record.numStoriesAboveGrade = 4;
  const dimensions = { id: modelId, rooms: [
    { id: 'office', dimensionEstimates: { units: 'imperial', areaIndoor: 105, height: 9, width: 0 } },
  ] };
  const { result, output } = await run(t, input, dimensions);
  assert.equal(result.status, 0, result.stderr);
  const imported = JSON.parse(output);
  assert.equal(imported.costar.storiesAboveGrade, 4);
  assert.equal(imported.costar.candidateStructures, 1);
  assert.deepEqual(imported.landmarks[1].roomEvidence, { areaSqFt: 105, heightFt: 9 });
  assert.equal(imported.roof.projection, undefined);
});

test('an unrelated dimensions export cannot be added to the property', async (t) => {
  const { result, output, original } = await run(t, fixture([building]), { id: 'OtherModel', rooms: [] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dimensions export must belong to the same model/);
  assert.equal(output, original);
});

test('sponsor evidence leaves the local property untouched when roof selection is unsafe', async (t) => {
  const wrongCrop = fixture([neighbor, building]);
  wrongCrop.overlay.bounds3857 = neighborBounds;
  wrongCrop.overlay.outline = corners(neighbor).map((point) => normalize(point, neighborBounds));
  // Each roof has the same outline relative to its own crop.
  assert.deepEqual(wrongCrop.overlay.outline, fixture([building]).overlay.outline);

  const split = fixture([neighbor, building]);
  split.projected[1].point = geographic([185, 70]);
  const missingBounds = fixture([neighbor, building]);
  missingBounds.overlay.bounds3857 = undefined;
  const duplicateScan = fixture([neighbor, building]);
  duplicateScan.property.landmarks[1].views[0].sweep = duplicateScan.property.landmarks[0].views[0].sweep;
  const conflicts = fixture([neighbor, building]);
  conflicts.projected.push({ ...conflicts.projected[0], point: geographic([21, 20]) });
  const sharedEdge = fixture([[100, 0, 200, 100], building]);
  sharedEdge.projected[0].point = geographic([100, 50]);
  const laterView = fixture([neighbor, building]);
  laterView.property.landmarks[0].views.push({ sweep: 'pano-2' });
  laterView.projected[2].point = geographic([185, 70]);
  const badRoom = fixture([building]);
  badRoom.property.landmarks[0].views.push({ sweep: 'pano-1' });
  const badAddress = fixture([building]);
  badAddress.property.address = '43 Example St, Houston, TX';

  const cases = [
    { name: 'same-shaped neighboring crop', input: wrongCrop, message: /crop does not match/ },
    { name: 'two overlapping matches', input: fixture([building, building]), message: /unique Vexcel footprint/ },
    { name: 'landmarks split between roofs', input: split, message: /unique Vexcel footprint/ },
    { name: 'multiple structures without crop bounds', input: missingBounds, message: /requires bounds3857/ },
    { name: 'two landmarks with one distinct scan', input: duplicateScan, message: /two distinct Matterport/ },
    { name: 'one scan with conflicting geographic positions', input: conflicts, message: /conflicting projected coordinates/ },
    { name: 'a landmark on the edge shared by neighboring roofs', input: sharedEdge, message: /unique Vexcel footprint/ },
    { name: 'a second view points to the neighboring roof', input: laterView, message: /unique Vexcel footprint/ },
    { name: 'a later view resolves to another room', input: badRoom, message: /same Matterport room/ },
    { name: 'the configured address differs from the crosswalk', input: badAddress, message: /address does not match/ },
  ];
  for (const { name, input, message } of cases) {
    await t.test(name, async (subtest) => {
      const { result, output, original } = await run(subtest, input);
      assert.ok(result.status && result.status > 0, result.stdout);
      assert.match(result.stderr, message);
      assert.equal(output, original);
    });
  }
});
