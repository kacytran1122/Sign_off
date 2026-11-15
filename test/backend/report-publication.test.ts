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
  const publicProperty = { ...property, matterportPublicView: true };
  assert.equal(reportSnapshot(publicProperty, row).building?.publicMatterportModel, property.matterportModel);
  assert.equal(reportSnapshot(publicProperty, { ...row, property_match: false }).building, undefined);
});

test('shared summaries preserve climate observations and counted rodent periods without retaining 311 case details', async () => {
  const config = await loadConfig({ DEMO_MODE: 'true', DATABASE_URL: 'test-database-url' });
  const rodentPeriods = [
    { start_date: '2026-10-16', through_date: '2026-11-14', mentions: 0 },
    { start_date: '2026-09-16', through_date: '2026-10-15', mentions: 1 },
  ];
  const area = {
    city: 'HOUSTON',
    store: 'TimescaleDB',
    history: [{ time: '2026-11-14T01:00:00.000Z', temperatureF: 56, feelsLikeF: 54, humidity: 73 }],
    observations: { hours: 1, lowFeelsLikeF: 54, highFeelsLikeF: 54, lowHumidity: 73, highHumidity: 73 },
    coverage: {
      start_date: '2026-08-17', through_date: '2026-11-14', store: 'Local PostgreSQL',
      indicators: { water: 2, waste: 3, rodentMentions: 1 },
      rodentPeriods,
      cases: [{ ticket: 'private-case', address: 'private-address' }],
    },
  };
  const report = reportSnapshot(config.property, {
    id: '13', status: 'open', issue: 'leak', aid: 'bucket', property_match: false, area,
  });
  const { cases: _cases, ...publicCoverage } = area.coverage;
  assert.deepEqual(report.area, { ...area, coverage: publicCoverage });
});

test('an invalid neighborhood section does not discard unrelated evidence', async () => {
  const config = await loadConfig({ DEMO_MODE: 'true', DATABASE_URL: 'test-database-url' });
  const area = {
    city: 'HOUSTON',
    latitude: 29.7604,
    longitude: -95.3698,
    weather: {
      current: { time: '2026-11-08T14:00', temperature_2m: 62, apparent_temperature: 60, relative_humidity_2m: 55 },
      daily: { time: ['2026-11-09'], apparent_temperature_max: ['unavailable'] },
    },
    history: [{ time: '2026-11-08T20:00:00Z', feelsLikeF: 60, humidity: null }],
    observations: { hours: 25, lowFeelsLikeF: 50, highFeelsLikeF: 64, lowHumidity: 40, highHumidity: 62 },
    coverage: {
      start_date: '2026-08-10', through_date: '2026-11-07',
      indicators: { water: 2, waste: 0, rodentMentions: 0 },
      rodentPeriods: null,
    },
  };
  const row = { id: '15', status: 'open', issue: 'leak' as const, aid: 'bucket' as const, property_match: false, area };
  const report = reportSnapshot(config.property, row);
  assert.equal(report.area?.latitude, 29.76);
  assert.equal(report.area?.weather?.current.temperature_2m, 62);
  assert.equal(report.area?.weather?.daily, undefined);
  assert.equal(report.area?.history?.[0].feelsLikeF, 60);
  assert.equal(report.area?.history?.[0].humidity, undefined);
  assert.equal(report.area?.observations, undefined);
  assert.deepEqual(report.area?.coverage?.indicators, area.coverage.indicators);
  assert.equal(report.area?.coverage?.rodentPeriods, undefined);
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
  assert.equal(reportSnapshot(property, row).inspectionAssessment.decision, 'roof-zone');
  const report = reportSnapshot(property, { ...row, damagePoint: pin });
  assert.match(report.building?.inspectionSteps?.[1] ?? '', /use the projected spot/);
  assert.equal(report.inspectionAssessment.decision, 'projected-roof-check');
  assert.match(report.inspectionAssessment.reason, /Matterport spot projects within the verified Vexcel roof zone/);
  assert.match(report.inspectionAssessment.nextStep, /Trace the moisture indoors first/);
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
  assert.equal(reportSnapshot(property, { ...row, damagePoint: ownPin }).inspectionAssessment.decision, 'alignment-check');
  assert.equal(reportSnapshot(property, { ...row, linkedDamagePoints, description: 'A sink leak' }).scenario, 'sink-leak');

  const unmatched = reportSnapshot(property, { ...row, property_match: false, damagePoint: pin });
  assert.equal(unmatched.inspectionAssessment.decision, 'indoor-check');
  assert.match(unmatched.inspectionAssessment.reason, /address has no verified match/);
  assert.equal(unmatched.building, undefined);

  const sink = reportSnapshot(property, { ...row, description: 'A sink leak', damagePoint: pin });
  assert.equal(sink.inspectionAssessment.decision, 'indoor-check');
  assert.equal(sink.building?.inspectionSteps, undefined);

  const upstairs = reportSnapshot({ ...property, costar: { storiesAboveGrade: 2 } }, { ...row, aid: 'clear', damagePoint: pin });
  assert.equal(upstairs.inspectionAssessment.decision, 'indoor-check');
  assert.match(upstairs.inspectionAssessment.reason, /CoStar records 2 above-grade stories/);
  assert.match(upstairs.inspectionAssessment.nextStep, /Keep people clear/);
  assert.equal(upstairs.building?.inspectionSteps, undefined);
});

test('a public report scan is selected only for its matching street address', async () => {
  const scans = [
    { address: '1200 Example Rd, Los Angeles, CA 90012', modelId: 'ApprovedLAModel' },
  ];
  const config = await loadConfig({
    DEMO_MODE: 'true', DATABASE_URL: 'test-database-url', REPORT_MATTERPORT_SCANS_JSON: JSON.stringify(scans),
  });
  const row = {
    id: '18', status: 'open', issue: 'leak' as const, aid: 'bucket' as const, property_match: false,
    address: '1200 Example Road, Los Angeles, CA', area: { city: 'LOS ANGELES' },
  };
  const report = reportSnapshot(config.property, row, config.reportMatterportScans);
  assert.equal(report.building?.publicMatterportModel, 'ApprovedLAModel');
  assert.equal(report.building?.hasMatterport, true);
  assert.equal(report.building?.hasVexcel, false);
  assert.equal(report.building?.storiesAboveGrade, undefined);
  assert.equal(report.inspectionAssessment.decision, 'indoor-check');
  assert.match(report.inspectionAssessment.reason, /scan matches the address/);
  assert.doesNotMatch(JSON.stringify(report), /1200 Example/);
  for (const address of ['1202 Example Rd, Los Angeles, CA', '1200 Example Rd, Houston, TX', '1200 Example Rd, Los Angeles, CA 91364']) {
    assert.equal(reportSnapshot(config.property, { ...row, address }, scans).building, undefined);
  }
  assert.equal(reportSnapshot(config.property, row, [...scans, { ...scans[0], modelId: 'ConflictingModel' }]).building, undefined);
  assert.equal(reportSnapshot(config.property, { ...row, address: undefined }, scans).building, undefined);
  await assert.rejects(loadConfig({
    DEMO_MODE: 'true', DATABASE_URL: 'test-database-url',
    REPORT_MATTERPORT_SCANS_JSON: JSON.stringify([{ ...scans[0], modelId: 'https://example.invalid' }]),
  }));
});
