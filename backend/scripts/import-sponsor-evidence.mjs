import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { calibrateRoof, matchRoofCrop } from './calibrate-roof.mjs';
import { matchStructure } from './structure-footprint.mjs';

const [verifiedFile, projectedFile, overlayFile, propertyFile = 'backend/config/property.local.json'] = process.argv.slice(2);
if (!verifiedFile || !projectedFile || !overlayFile) {
  throw new Error('Usage: npm run costar:evidence -- VERIFIED.json PROJECTED.json OVERLAY.json [PROPERTY.json]');
}
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [verified, projected, overlay, property] = await Promise.all(
  [verifiedFile, projectedFile, overlayFile, propertyFile].map(readJson),
);
const { row, record, model, structure } = verified;
const features = structure.body.features;
if (String(record.id) !== property.id || String(row.PropertyId) !== property.id ||
    row.MatterportModelId !== property.matterportModel ||
    model.id !== property.matterportModel ||
    record.numStoriesAboveGrade !== 1 || !property.roof.imageFile) {
  throw new Error('The private property, model, roof image, and single-story CoStar record must match.');
}
const polygon = (points) => Array.isArray(points) && points.length >= 3 &&
  points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
// The building outline may extend beyond the crop. Only the inspection targets must fit inside it.
if (!polygon(overlay.outline) || property.zones.some((zone) => {
  const target = overlay.zones.find((item) => item.id === zone.id);
  return !polygon(target?.polygon) || !target.polygon.every((point) => point.every((n) => n >= 0 && n <= 1)) ||
    JSON.stringify(target.polygon) !== JSON.stringify(zone.polygon);
})) throw new Error('The footprint and target zones must use the saved Vexcel crop.');

const { feature, viewpoints, samples } = matchStructure(features, model, property.landmarks, projected);
const bounds = overlay.bounds3857;
if (features.length > 1 && bounds === undefined) {
  throw new Error('A shared parcel requires bounds3857 from the saved Vexcel imagery request.');
}
const crop = matchRoofCrop(feature.geometry, overlay.outline, bounds);
if (bounds !== undefined && !crop) {
  throw new Error('The saved Vexcel crop does not match the selected building footprint.');
}
for (const [index, landmark] of property.landmarks.entries()) {
  landmark.matterportRoomId = viewpoints[index].roomId;
}
property.costar = {
  storiesAboveGrade: record.numStoriesAboveGrade,
  buildingType: typeof record.propertyType === 'string' ? record.propertyType : undefined,
  buildingAreaSqFt: record.grossBuildingAreaSquareFeet || undefined,
};
property.roof.outline = overlay.outline;
property.roof.projection = calibrateRoof(crop, model, samples);
if (features.length > 1) {
  property.roof.attributes = [
    { label: 'Roof material', value: feature.properties?.['roof-characteristics.material.class'] },
    { label: 'Roof shape', value: feature.properties?.['roof-characteristics.shape.value'] },
  ].filter(({ value }) => typeof value === 'string' && value.length > 0);
}
const temporary = `${propertyFile}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(property, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await rename(temporary, propertyFile);
console.log(`Added CoStar, Matterport, and Vexcel evidence for ${property.landmarks.length} room targets.`);
console.log(property.roof.projection ? 'Calibrated the Matterport to Vexcel roof projection.' : 'Roof projection unavailable for this evidence.');
