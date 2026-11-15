import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Landmark, Property } from '../../backend/config.js';
import { planRoofInspection } from '../../backend/inspection.js';

const room: Landmark = {
  id: 'lobby', label: 'Lobby ceiling', suite: 'Ground floor', zoneId: 'roof-lobby', aliases: [],
  matterportRoomId: 'room-fixture', anchor: { x: 1, y: 2, z: 3 },
  views: [{ sweep: 'scan-fixture', rotation: { x: 0, y: 0 } }],
};
const property: Property = {
  id: 'building-fixture', address: '123 Fixture Street', name: 'Fixture building',
  timeZone: 'America/Chicago', matterportModel: 'DemoModel',
  costar: { storiesAboveGrade: 1 },
  roof: { imageUrl: 'https://example.invalid/roof.jpg', attributes: [], outline: [
    [.1, .1], [.8, .1], [.8, 1.4], [.1, 1.4],
  ] },
  zones: [{ id: 'roof-lobby', label: 'Lobby roof area', polygon: [[.2, .2], [.3, .2], [.3, .3], [.2, .3]] }],
  landmarks: [room],
};

test('a matched single-story room gets an indoor-first inspection plan', () => {
  const plan = planRoofInspection(property, room, 'bucket');
  assert.equal(plan?.steps.length, 2);
  assert.match(plan.steps[0], /lobby ceiling.*indoors/);
  assert.match(plan.steps[1], /If the indoor inspection points overhead/);
});

test('a potential hazard gets assessed before entering the room', () => {
  const plan = planRoofInspection(property, room, 'clear');
  assert.equal(plan?.steps.length, 3);
  assert.match(plan.steps[0], /Keep people clear/);
  assert.match(plan.summary, /^Safety check first/);
});

test('missing source evidence and multi-story buildings suppress a roof plan', () => {
  assert.equal(planRoofInspection({ ...property, costar: undefined }, room), undefined);
  assert.equal(planRoofInspection({ ...property, costar: { storiesAboveGrade: 2 } }, room), undefined);
  assert.equal(planRoofInspection(property, { ...room, matterportRoomId: undefined }), undefined);
  assert.equal(planRoofInspection({ ...property, roof: { ...property.roof, imageUrl: undefined } }, room), undefined);
});

test('a target outside the footprint does not produce a roof plan', () => {
  const moved = { ...property, zones: [{
    ...property.zones[0], polygon: [[.88, .2], [.95, .2], [.95, .3], [.88, .3]] as [number, number][],
  }] };
  assert.equal(planRoofInspection(moved, room), undefined);
});
