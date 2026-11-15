import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import type { Property } from '../../backend/config.js';
import { projectDamageOnRoof } from '../../backend/roof-projection.js';

const roof: Property['roof'] = {
  attributes: [],
  outline: [[.1, .1], [.8, .1], [.8, .9], [.1, .9]],
  projection: {
    u: [.125, 0, .25],
    v: [0, .125, .25],
    hull: [[0, 0], [6, 0], [0, 6]],
  },
};
const zone: Property['zones'][number] = {
  id: 'start', label: 'Starting area', polygon: [[.2, .2], [.5, .2], [.5, .5], [.2, .5]],
};

test('the roof estimate converts Showcase depth and reports whether the point is in the original zone', () => {
  assert.deepEqual(projectDamageOnRoof(roof, zone, { x: 2, z: -1 }), { point: [.5, .375], inInspectionZone: true });
  assert.deepEqual(projectDamageOnRoof(roof, zone, { x: 3, z: -1 }), { point: [.625, .375], inInspectionZone: false });
});

test('the roof estimate requires scan support and stays within the usable image and footprint', () => {
  assert.equal(projectDamageOnRoof(roof, zone, { x: 4, z: -4 }), undefined);
  assert.equal(projectDamageOnRoof(roof, zone, { x: 2, z: 1 }), undefined);
  assert.equal(projectDamageOnRoof(roof, zone, { x: 5, z: -1 }), undefined);
  const shifted = { ...roof, projection: { ...roof.projection!, u: [0, 0, 1.1] as [number, number, number] } };
  assert.equal(projectDamageOnRoof(shifted, zone, { x: 1, z: -1 }), undefined);
});

test('the evidence importer checks the crop, independent control points, and scan identifiers', async () => {
  const calibration = pathToFileURL(resolve('backend/scripts/calibrate-roof.mjs')).href;
  const { calibrateRoof, matchRoofCrop } = await import(calibration);
  const longitude = (u: number) => u / 1000;
  const latitude = (v: number) => Math.atan(Math.sinh((1 - v) * Math.PI / 180 / 1000)) * 180 / Math.PI;
  const outline = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const geometry = { type: 'Polygon', coordinates: [[...outline, outline[0]].map(([u, v]) => [longitude(u), latitude(v)])] };
  const groundPositions = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 2]];
  const model = { locations: groundPositions.map(([x, y], i) => ({ id: String(i), position: { x, y } })) };
  const samples = model.locations.map(({ id, position }) => ({
    scan: { id }, inside: true, point: [longitude(.2 + .2 * position.x), latitude(.3 + .2 * position.y)],
  }));
  const crop = matchRoofCrop(geometry, outline);
  const projection = calibrateRoof(crop, model, samples);
  assert(projection);
  assert(Math.abs(projection.u[0] - .2) < 1e-6 && Math.abs(projection.v[1] - .2) < 1e-6);

  const altered = [{ ...samples[0], point: [longitude(.7), latitude(.3)] }, ...samples.slice(1)];
  assert.equal(calibrateRoof(crop, model, altered), undefined);
  assert.equal(calibrateRoof(crop, { locations: model.locations.slice(0, 5) }, samples), undefined);
  const badOutline = outline.map((point, index) => index === 2 ? [.95, .95] : point);
  assert.equal(matchRoofCrop(geometry, badOutline), undefined);
});
