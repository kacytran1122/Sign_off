import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';

const [verifiedFile, projectedFile, overlayFile, propertyFile = 'backend/config/property.local.json'] = process.argv.slice(2);
if (!verifiedFile || !projectedFile || !overlayFile) {
  throw new Error('Usage: npm run costar:evidence -- VERIFIED.json PROJECTED.json OVERLAY.json [PROPERTY.json]');
}
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [verified, projected, overlay, property] = await Promise.all(
  [verifiedFile, projectedFile, overlayFile, propertyFile].map(readJson),
);
const { row, record, model, structure } = verified;
if (String(record.id) !== property.id || row.MatterportModelId !== property.matterportModel ||
    model.id !== property.matterportModel || structure.body.features.length !== 1 ||
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

for (const landmark of property.landmarks) {
  const shot = projected.find((point) => point.inside && point.scan.panos.some((pano) => pano.id === landmark.views[0]?.sweep));
  if (!shot || !model.rooms.some((room) => room.id === shot.roomId)) {
    throw new Error('A saved viewpoint could not be matched to a projected Matterport room.');
  }
  landmark.matterportRoomId = shot.roomId;
}
property.costar = {
  storiesAboveGrade: record.numStoriesAboveGrade,
  buildingType: typeof record.propertyType === 'string' ? record.propertyType : undefined,
  buildingAreaSqFt: record.grossBuildingAreaSquareFeet || undefined,
};
property.roof.outline = overlay.outline;
const temporary = `${propertyFile}.${process.pid}.tmp`;
await writeFile(temporary, JSON.stringify(property, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await rename(temporary, propertyFile);
console.log(`Added CoStar, Matterport, and Vexcel evidence for ${property.landmarks.length} room targets.`);
