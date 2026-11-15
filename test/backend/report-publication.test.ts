import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig, type Property } from '../../backend/config.js';
import { reportSnapshot } from '../../backend/report-publication.js';

test('shared repair summaries include rounded neighborhood and matched building context', async () => {
  const config = await loadConfig({ DEMO_MODE: 'true', DATABASE_URL: 'test-database-url' });
  const property = {
    ...config.property,
    costar: { storiesAboveGrade: 1, buildingAreaSqFt: 8000, matchedRooms: 2 },
    matterportModel: 'PrivateSponsorModel',
    roof: { attributes: [], imageUrl: 'https://private.example/roof.jpg', captureDate: '2026-10-16' },
  };
  const row = {
    id: '12', status: 'scheduled', issue: 'leak' as const, aid: 'bucket' as const,
    property_match: true, landmarkId: property.landmarks[0].id, renderStatus: 'ready',
    area: { latitude: 29.7604, longitude: -95.3698, city: 'HOUSTON', reporter: 'private@example.invalid' },
  };
  const report = reportSnapshot(property, row);
  assert.equal(report.building?.buildingAreaSqFt, 8000);
  assert.equal(report.building?.roomLabel, property.landmarks[0].label);
  assert.equal(report.building?.hasVexcel, true);
  assert.deepEqual(report.area, { latitude: 29.76, longitude: -95.37, city: 'HOUSTON' });
  assert.doesNotMatch(JSON.stringify(report), /private\.example|PrivateSponsorModel|private@example/);
  assert.equal(reportSnapshot(property, { ...row, property_match: false }).building, undefined);
});

test('a photo-matched inspection point changes the shared plan without exposing the pin', async () => {
  const config = await loadConfig({ DEMO_MODE: 'true', DATABASE_URL: 'test-database-url' });
  const room = { ...config.property.landmarks[0], matterportRoomId: 'PrivateRoom' };
  const property: Property = {
    ...config.property,
    costar: { storiesAboveGrade: 1 },
    matterportModel: 'PrivateSponsorModel',
    roof: {
      attributes: [], imageUrl: 'https://private.example/roof.jpg',
      outline: [[0, 0], [1, 0], [1, 1], [0, 1]],
      projection: { u: [.1, 0, .1], v: [0, .1, .1], hull: [[0, 0], [6, 0], [6, 6], [0, 6]] },
    },
    landmarks: [{ ...room, anchor: { x: 1, y: 2, z: 3 }, views: [{ sweep: 'PrivateSweep', rotation: { x: 0, y: 0 } }] }],
    zones: [{ id: room.zoneId, label: 'Roof above the lobby', polygon: [[.2, .2], [.3, .2], [.3, .3], [.2, .3]] }],
  };
  const row = {
    id: '12', status: 'open', issue: 'leak' as const, aid: 'bucket' as const,
    area: undefined, property_match: true, landmarkId: room.id, description: 'Water leaking through the ceiling',
  };
  const pin = {
    confirmed: true, modelId: 'PrivateSponsorModel', sweep: 'PrivateSweep',
    anchor: { x: 1.5, y: 2, z: -1.5 }, stem: { x: 0, y: -.2, z: 0 },
  };
  const initial = reportSnapshot(property, row).building?.inspectionSteps;
  assert.match(initial?.[1] ?? '', /check the Vexcel area labeled/);
  const report = reportSnapshot(property, { ...row, damagePoint: pin });
  assert.match(report.building?.inspectionSteps?.[1] ?? '', /use the projected spot/);
  assert.doesNotMatch(JSON.stringify(report), /PrivateSponsorModel|PrivateSweep|PrivateRoom|private\.example|damagePoint|anchor/);
  assert.deepEqual(reportSnapshot(property, { ...row, damagePoint: { ...pin, modelId: 'OldModel' } }).building?.inspectionSteps, initial);
  assert.deepEqual(reportSnapshot(property, { ...row, damagePoint: { ...pin, confirmed: false } }).building?.inspectionSteps, initial);
  assert.equal(reportSnapshot(property, { ...row, damagePoint: pin, description: 'Water dripping below the kitchen sink' }).building?.inspectionSteps, undefined);

  const linkedDamagePoints = [
    { description: 'Water dripping below the kitchen sink', point: { ...pin, anchor: { x: 9, y: 2, z: -1.5 } } },
    { description: 'Another ceiling leak', point: pin },
    { description: 'Earlier ceiling leak', point: { ...pin, anchor: { x: 3, y: 2, z: -1.5 } } },
  ];
  assert.deepEqual(reportSnapshot(property, { ...row, linkedDamagePoints }).building?.inspectionSteps, report.building?.inspectionSteps);
  assert.deepEqual(reportSnapshot(property, { ...row, linkedDamagePoints: linkedDamagePoints.slice(0, 1) }).building?.inspectionSteps, initial);
  const ownPin = { ...pin, anchor: { x: 3, y: 2, z: -1.5 } };
  assert.match(reportSnapshot(property, { ...row, damagePoint: ownPin, linkedDamagePoints }).building?.inspectionSteps?.[1] ?? '', /projects outside the mapped roof area/);
  assert.equal(reportSnapshot(property, { ...row, linkedDamagePoints, description: 'A sink leak' }).scenario, 'sink-leak');
});
