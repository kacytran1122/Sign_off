const mercator = ([longitude, latitude]) => {
  const radius = 6_378_137;
  const radians = Math.PI / 180;
  return [radius * longitude * radians, radius * Math.log(Math.tan(Math.PI / 4 + latitude * radians / 2))];
};

function cropAxis(world, outline, axis) {
  let low = 0;
  let high = 0;
  for (let i = 1; i < outline.length; i++) {
    if (outline[i][axis] < outline[low][axis]) low = i;
    if (outline[i][axis] > outline[high][axis]) high = i;
  }
  const scale = (world[high][axis] - world[low][axis]) / (outline[high][axis] - outline[low][axis]);
  if (!Number.isFinite(scale) || scale === 0) return;
  const origin = world[low][axis] - scale * outline[low][axis];
  const normalize = (position) => (position - origin) / scale;
  if (!world.every((point, i) => Math.abs(normalize(point[axis]) - outline[i][axis]) < 1e-6)) return;
  return normalize;
}

function fit(rows) {
  const mean = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const x0 = mean('x'), y0 = mean('y'), u0 = mean('u'), v0 = mean('v');
  let xx = 0, xy = 0, yy = 0, xu = 0, yu = 0, xv = 0, yv = 0;
  for (const { x, y, u, v } of rows) {
    const dx = x - x0, dy = y - y0;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
    xu += dx * (u - u0);
    yu += dy * (u - u0);
    xv += dx * (v - v0);
    yv += dy * (v - v0);
  }
  const determinant = xx * yy - xy * xy;
  if (determinant <= 0 || determinant < xx * yy * 1e-6) return;
  const coefficients = (first, second, center) => {
    const a = (yy * first - xy * second) / determinant;
    const b = (xx * second - xy * first) / determinant;
    return [a, b, center - a * x0 - b * y0];
  };
  return { u: coefficients(xu, yu, u0), v: coefficients(xv, yv, v0) };
}

function hull(rows) {
  const points = rows.map(({ x, y }) => [x, y]).sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
  const half = (ordered) => {
    const result = [];
    for (const point of ordered) {
      while (result.length >= 2) {
        const [ax, ay] = result.at(-2), [bx, by] = result.at(-1);
        if ((bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax) > 0) break;
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(points), ...half(points.toReversed())];
}

export function calibrateRoof(geometry, outline, model, projected) {
  const rings = geometry?.type === 'Polygon' ? geometry.coordinates
    : geometry?.type === 'MultiPolygon' && geometry.coordinates.length === 1 ? geometry.coordinates[0] : undefined;
  if (rings?.length !== 1 || rings[0].length !== outline.length) return;
  const world = rings[0].map(mercator);
  const normalizeX = cropAxis(world, outline, 0);
  const normalizeY = cropAxis(world, outline, 1);
  if (!normalizeX || !normalizeY) return;

  const scans = new Map(model.locations.map((scan) => [scan.id, scan.position]));
  const rows = [];
  for (const sample of projected) {
    if (!sample.inside || !scans.has(sample.scan.id)) continue;
    const { x, y } = scans.get(sample.scan.id);
    const [east, north] = mercator(sample.point);
    if ([x, y, east, north].every(Number.isFinite)) {
      rows.push({ x, y, u: normalizeX(east), v: normalizeY(north) });
      scans.delete(sample.scan.id);
    }
  }
  if (rows.length < 6) return;

  const transform = fit(rows.filter((_, index) => index % 5 !== 0));
  if (!transform) return;
  const evaluate = ([a, b, c], { x, y }) => a * x + b * y + c;
  // A consistency check against sampled provider positions, including points held out of the fit.
  const residual = Math.max(...rows.map((row) =>
    Math.hypot(evaluate(transform.u, row) - row.u, evaluate(transform.v, row) - row.v)));
  if (!(residual <= .005)) return;
  return { ...transform, hull: hull(rows) };
}
