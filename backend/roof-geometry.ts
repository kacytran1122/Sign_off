type Point = readonly [number, number];

const tolerance = 1e-9;
const subtract = ([ax, ay]: Point, [bx, by]: Point): Point => [ax - bx, ay - by];
const cross = ([ax, ay]: Point, [bx, by]: Point) => ax * by - ay * bx;
const dot = ([ax, ay]: Point, [bx, by]: Point) => ax * bx + ay * by;
const length = ([x, y]: Point) => Math.hypot(x, y);

function onSegment(point: Point, start: Point, end: Point) {
  const edge = subtract(end, start);
  const offset = subtract(point, start);
  const span = length(edge);
  if (span <= tolerance) return length(offset) <= tolerance;
  const along = dot(edge, offset) / span;
  return along >= -tolerance && along <= span + tolerance &&
    Math.abs(cross(edge, offset)) <= tolerance * span;
}

function hasArea(ring: readonly Point[]) {
  if (ring.length < 3 || !ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return false;
  const origin = ring[0];
  const twiceArea = ring.reduce((area, point, index) =>
    area + cross(subtract(point, origin), subtract(ring[(index + 1) % ring.length], origin)), 0);
  return Math.abs(twiceArea) > tolerance ** 2;
}

function insideRing(point: Point, ring: readonly Point[]) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Point, outline: readonly Point[]) {
  return hasArea(outline) && insideRing(point, outline);
}

function segmentInRing(start: Point, end: Point, ring: readonly Point[]) {
  const direction = subtract(end, start);
  const span = length(direction);
  if (span <= tolerance) return true;

  // Between successive boundary intersections the segment is wholly inside or wholly outside.
  const cuts = [0, 1];
  const addCut = (ratio: number) => {
    if (ratio > 0 && ratio < 1) cuts.push(ratio);
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const edge = subtract(b, a);
    const offset = subtract(a, start);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) <= tolerance * span * length(edge)) {
      if (Math.abs(cross(offset, direction)) <= tolerance * span) {
        addCut(dot(offset, direction) / (span * span));
        addCut(dot(subtract(b, start), direction) / (span * span));
      }
    } else {
      const fenceRatio = cross(offset, direction) / denominator;
      if (fenceRatio >= -tolerance && fenceRatio <= 1 + tolerance) {
        addCut(cross(offset, edge) / denominator);
      }
    }
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).every((cut, i) => {
    const ratio = (cuts[i] + cut) / 2;
    return insideRing([start[0] + ratio * direction[0], start[1] + ratio * direction[1]], ring);
  });
}

export function polygonContainsPolygon(outline: readonly Point[], target: readonly Point[]) {
  return hasArea(outline) && hasArea(target) && target.every((point) => insideRing(point, outline)) &&
    target.every((point, i) => segmentInRing(point, target[(i + 1) % target.length], outline));
}
