import type { Property } from './config.js';
import { pointInPolygon } from './roof-geometry.js';

export function projectDamageOnRoof(roof: Property['roof'], zone: Property['zones'][number], anchor: { x: number; z: number }) {
  if (!roof.projection || !roof.outline) return;
  const { u, v, hull } = roof.projection;
  // Showcase is Y-up, while Model API scan positions use Z-up and reverse the horizontal depth axis.
  const floorPoint: [number, number] = [anchor.x, -anchor.z];
  if (!floorPoint.every(Number.isFinite) || !pointInPolygon(floorPoint, hull)) return;

  const project = ([x, y, offset]: [number, number, number]) => x * floorPoint[0] + y * floorPoint[1] + offset;
  const point: [number, number] = [project(u), project(v)];
  if (!point.every((coordinate) => coordinate >= 0 && coordinate <= 1) || !pointInPolygon(point, roof.outline)) return;
  return { point, inInspectionZone: pointInPolygon(point, zone.polygon) };
}
