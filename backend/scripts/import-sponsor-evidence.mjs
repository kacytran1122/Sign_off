import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { calibrateRoof, matchRoofCrop } from './calibrate-roof.mjs';
import { matchStructure } from './structure-footprint.mjs';

const [verifiedFile, projectedFile, overlayFile, propertyFile = 'backend/config/property.local.json', dimensionsFile] = process.argv.slice(2);
if (!verifiedFile || !projectedFile || !overlayFile) {
  throw new Error('Usage: npm run costar:evidence -- VERIFIED.json PROJECTED.json OVERLAY.json [PROPERTY.json] [ROOM_DIMENSIONS.json]');
}
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [verified, projected, overlay, property, dimensions] = await Promise.all([
  ...[verifiedFile, projectedFile, overlayFile, propertyFile].map(readJson),
  dimensionsFile ? readJson(dimensionsFile) : undefined,
]);
const { row, record, model, structure } = verified;
const features = structure.body.features;
if (String(record.id) !== property.id || String(row.PropertyId) !== property.id ||
    row.MatterportModelId !== property.matterportModel ||
    model.id !== property.matterportModel ||
    !Number.isInteger(record.numStoriesAboveGrade) || record.numStoriesAboveGrade < 1 || !property.roof.imageFile) {
  throw new Error('The private property, model, roof image, and CoStar record must match.');
}
if (dimensions && (dimensions.id !== model.id || !Array.isArray(dimensions.rooms))) {
  throw new Error('The Matterport dimensions export must belong to the same model.');
}
const normalizeAddress = (address) => address.toLowerCase()
  .replace(/\b(street|avenue|road|drive|boulevard)\b/g, (word) => ({
    street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd',
  })[word])
  .replace(/\b([a-z]{2})\s+\d{5}(?:-\d{4})?[\s.,]*$/, '$1')
  .replace(/[^a-z0-9-]+/g, ' ').trim();
if (![row.Address, row.City, row.State].every((field) => typeof field === 'string' && field.trim()) ||
    normalizeAddress(property.address) !== normalizeAddress([row.Address, row.City, row.State].join(' '))) {
  throw new Error('The private property address does not match the CoStar crosswalk.');
}

const polygon = (points) => Array.isArray(points) && points.length >= 3 &&
  points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
// The building outline may extend beyond the crop. Only the inspection targets must fit inside it.
if (!polygon(overlay.outline) || property.zones.some((zone) => {
  const target = overlay.zones.find((item) => item.id === zone.id);
  return !polygon(target?.polygon) || !target.polygon.every((point) => point.every((n) => n >= 0 && n <= 1)) ||
    JSON.stringify(target.polygon) !== JSON.stringify(zone.polygon);
})) throw new Error('The footprint and target zones must use the saved Vexcel crop.');

const { feature, viewpoints, distinctViewpoints, samples } = matchStructure(features, model, property.landmarks, projected);
const bounds = overlay.bounds3857;
if (features.length > 1 && bounds === undefined) {
  throw new Error('A shared parcel requires bounds3857 from the saved Vexcel imagery request.');
}
const crop = matchRoofCrop(feature.geometry, overlay.outline, bounds);
if (!crop) {
  throw new Error('The saved Vexcel crop does not match the selected building footprint.');
}

const dimensionsByRoom = new Map(dimensions?.rooms.map((room) => [room.id, room.dimensionEstimates]));
const modelRooms = new Map(model.rooms.map((room) => [room.id, room]));
const positive = (value) => Number.isFinite(value) && value > 0 ? value : undefined;

function roomEvidence(estimate) {
  // Read units from the response. An absent unit field gives no safe conversion.
  if (estimate?.units !== 'imperial' && estimate?.units !== 'metric') return;
  const feet = estimate.units === 'metric' ? 1 / .3048 : 1;
  const convert = (value, factor) => Number.isFinite(value) ? positive(value * factor) : undefined;
  const result = {
    areaSqFt: convert(estimate.areaIndoor ?? estimate.area, feet ** 2),
    widthFt: convert(estimate.width, feet),
    depthFt: convert(estimate.depth, feet),
    heightFt: convert(estimate.height, feet),
  };
  if (Object.values(result).some((value) => value !== undefined)) return result;
}

for (const [index, landmark] of property.landmarks.entries()) {
  const { roomId } = viewpoints[index];
  landmark.matterportRoomId = roomId;
  landmark.roomEvidence = roomEvidence(dimensionsByRoom.get(roomId) ?? modelRooms.get(roomId)?.dimensionEstimates);
}
const cleanText = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
property.costar = {
  storiesAboveGrade: record.numStoriesAboveGrade,
  buildingType: cleanText(record.propertyType),
  propertySubtype: cleanText(record.propertySubtype),
  buildingAreaSqFt: positive(record.grossBuildingAreaSquareFeet),
  yearBuilt: Number.isInteger(record.yearBuilt) && record.yearBuilt >= 1000 && record.yearBuilt <= new Date().getFullYear()
    ? record.yearBuilt : undefined,
  candidateStructures: features.length,
  matchedViewpoints: distinctViewpoints,
  matchedRooms: new Set(viewpoints.map(({ roomId }) => roomId)).size,
};
property.roof.outline = overlay.outline;
property.roof.projection = record.numStoriesAboveGrade === 1 ? calibrateRoof(crop, model, samples) : undefined;

const roofFacts = feature.properties ?? {};
const date = cleanText(roofFacts['metadata.ortho-date-estimate'])?.slice(0, 10);
const parsedDate = Date.parse(date ?? '');
property.roof.analysisDate = roofFacts['metadata.is-ortho-image'] === true && Number.isFinite(parsedDate) &&
  new Date(parsedDate).toISOString().slice(0, 10) === date ? date : undefined;
const treeCover = roofFacts['roof-characteristics.tree-cover.percent'];
const analysisSignals = [
  ['Possible pooling in aerial analysis', 'water-pooling'],
  ['Possible dry pooling marks in aerial analysis', 'water-pooling-dry'],
].filter(([, key]) => roofFacts[`roof-defects.discoloration.types.${key}.detected`] === true);
property.roof.attributes = [
  { label: 'Roof material', value: cleanText(roofFacts['roof-characteristics.material.class']) },
  { label: 'Roof shape', value: cleanText(roofFacts['roof-characteristics.shape.value']) },
  { label: 'Roof condition classification', value: cleanText(roofFacts['roof-characteristics.condition']) },
  { label: 'Tree cover over roof', value: Number.isFinite(treeCover) && treeCover >= 0 && treeCover <= 100
    ? `${Math.round(treeCover)}%` : undefined },
  ...analysisSignals.map(([label]) => ({ label, value: 'Verify on site' })),
].filter(({ value }) => value !== undefined);

const temporary = `${propertyFile}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(property, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await rename(temporary, propertyFile);
console.log(`Added CoStar, Matterport, and Vexcel evidence for ${property.landmarks.length} room targets.`);
console.log(property.roof.projection ? 'Calibrated the Matterport to Vexcel roof projection.' : 'Roof projection unavailable for this evidence.');
