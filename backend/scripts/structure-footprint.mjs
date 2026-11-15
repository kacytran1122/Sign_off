export function isGeoPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) < 90;
}

export function structureFootprint(geometry) {
  const rings = geometry?.type === 'Polygon' ? geometry.coordinates
    : geometry?.type === 'MultiPolygon' && geometry.coordinates?.length === 1 ? geometry.coordinates[0] : undefined;
  const ring = rings?.[0];
  if (rings?.length !== 1 || !Array.isArray(ring) || ring.length < 4 || !ring.every(isGeoPoint) ||
      ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return;
  return ring;
}

export function insideFootprint(ring, [x, y]) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [aX, aY] = ring[i - 1];
    const [bX, bY] = ring[i];
    const dx = bX - aX;
    const dy = bY - aY;
    const cross = dx * (y - aY) - dy * (x - aX);
    // A shared edge is not evidence that distinguishes neighboring roofs.
    if (Math.abs(cross) <= 1e-12 * Math.hypot(dx, dy) &&
        x >= Math.min(aX, bX) && x <= Math.max(aX, bX) &&
        y >= Math.min(aY, bY) && y <= Math.max(aY, bY)) return false;
    if ((aY > y) !== (bY > y) && x < aX + (y - aY) * dx / dy) inside = !inside;
  }
  return inside;
}

export function matchStructure(features, model, landmarks, projected) {
  const candidates = features.map(({ geometry }) => structureFootprint(geometry));
  if (candidates.some((ring) => !ring)) {
    throw new Error('Resolve unsupported Vexcel footprints before matching the building.');
  }

  const scans = new Set(model.locations.map(({ id }) => id));
  const panoramas = new Map();
  for (const scan of model.locations) {
    for (const { id } of scan.panos ?? []) {
      if (panoramas.has(id) && panoramas.get(id) !== scan) panoramas.set(id, undefined);
      else if (!panoramas.has(id)) panoramas.set(id, scan);
    }
  }
  const locations = new Map();
  for (const { scan, point } of projected) {
    if (!scans.has(scan?.id) || !isGeoPoint(point)) continue;
    const prior = locations.get(scan.id);
    if (prior && (prior.point[0] !== point[0] || prior.point[1] !== point[1])) {
      throw new Error('A Matterport scan has conflicting projected coordinates.');
    }
    locations.set(scan.id, { scan: { id: scan.id }, point });
  }

  const rooms = new Set(model.rooms.map(({ id }) => id));
  const viewpoints = landmarks.map((landmark) => {
    const views = (landmark.views ?? []).map(({ sweep }) => {
      const scan = panoramas.get(sweep);
      const sample = locations.get(scan?.id);
      if (!sample || !rooms.has(scan?.room?.id)) {
        throw new Error('A saved viewpoint could not be matched to a projected Matterport room.');
      }
      return { point: sample.point, roomId: scan.room.id };
    });
    if (!views.length || new Set(views.map(({ roomId }) => roomId)).size !== 1) {
      throw new Error('A landmark must use saved viewpoints from the same Matterport room.');
    }
    return { points: views.map(({ point }) => point), roomId: views[0].roomId };
  });
  const points = viewpoints.flatMap((viewpoint) => viewpoint.points);
  const distinctViewpoints = new Set(points.map((point) => point.join(','))).size;
  if (candidates.length > 1 && distinctViewpoints < 2) {
    throw new Error('A shared parcel requires at least two distinct Matterport viewpoint positions.');
  }

  const matches = candidates.flatMap((ring, index) =>
    points.length && points.every((point) => insideFootprint(ring, point)) ? [index] : []);
  if (matches.length !== 1) {
    throw new Error('Could not match a unique Vexcel footprint to all saved Matterport viewpoints.');
  }
  const [index] = matches;
  return {
    feature: features[index],
    viewpoints,
    distinctViewpoints,
    samples: [...locations.values()].map((sample) => ({
      ...sample,
      inside: insideFootprint(candidates[index], sample.point),
    })),
  };
}
