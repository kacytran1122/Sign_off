import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig } from '../../backend/config.js';
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
