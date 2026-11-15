const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const publishPath = new RegExp(`^/internal/reports/(${UUID})$`, 'i');
const reportPath = new RegExp(`^/(reports|api/reports)/(${UUID})(/render)?/?$`, 'i');
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * Math.ceil(MAX_PNG_BYTES / 3) + 32 * 1024;
const states = { open: 'Open', scheduled: 'Scheduled', awaiting_confirmation: 'Awaiting tenant confirmation', closed: 'Closed' };
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function response(body, status = 200, type = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { ...privateHeaders, 'Content-Type': type } });
}

const storageKey = (uuid) => `reports/${uuid.toLowerCase()}.json`;
const shortText = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : undefined;
const boundedNumber = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : undefined;
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 24) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 1024) return false;
  const encode = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(header.slice(7))),
    crypto.subtle.digest('SHA-256', encode.encode(secret)),
  ]);
  const actualBytes = new Uint8Array(provided);
  const expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < expectedBytes.length; i++) difference |= actualBytes[i] ^ expectedBytes[i];
  return difference === 0;
}

class BodyTooLarge extends Error {}

async function readJson(request) {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) throw new Error('Missing body');
  const stream = request.body.getReader();
  let data = new Uint8Array(32 * 1024);
  let size = 0;
  try {
    while (true) {
      const chunk = await stream.read();
      if (chunk.done) break;
      const end = size + chunk.value.byteLength;
      if (end > MAX_BODY_BYTES) {
        await stream.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      if (end > data.byteLength) {
        const next = new Uint8Array(Math.min(MAX_BODY_BYTES, Math.max(end, data.byteLength * 2)));
        next.set(data.subarray(0, size));
        data = next;
      }
      data.set(chunk.value, size);
      size = end;
    }
  } finally { stream.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, size)));
}

function cleanArea(input) {
  if (!record(input)) return;
  const lat = boundedNumber(input.latitude, -85, 85);
  const lon = boundedNumber(input.longitude, -180, 180);
  const weather = input.weather?.current;
  const forecast = input.weather?.daily;
  const currentWeather = {
    time: shortText(weather?.time, 35),
    temperature_2m: boundedNumber(weather?.temperature_2m, -150, 200),
    apparent_temperature: boundedNumber(weather?.apparent_temperature, -150, 250),
    relative_humidity_2m: boundedNumber(weather?.relative_humidity_2m, 0, 100),
  };
  const daily = { time: [], apparent_temperature_max: [] };
  if (Array.isArray(forecast?.time) && Array.isArray(forecast?.apparent_temperature_max)) {
    for (let i = 0; i < Math.min(7, forecast.time.length); i++) {
      const day = dateOnly(forecast.time[i]);
      const high = boundedNumber(forecast.apparent_temperature_max[i], -150, 250);
      if (!day || high === undefined) continue;
      daily.time.push(day);
      daily.apparent_temperature_max.push(high);
    }
  }
  const history = Array.isArray(input.history) ? input.history.slice(-48).flatMap((sample) => {
    const time = shortText(sample?.time, 35);
    const feelsLikeF = boundedNumber(sample?.feelsLikeF, -150, 250);
    return time && Number.isFinite(Date.parse(time)) && feelsLikeF !== undefined ? [{ time, feelsLikeF }] : [];
  }) : [];
  const heat = {
    typicalHighF: boundedNumber(input.heat?.typicalHighF, -150, 250),
    validationMaeF: boundedNumber(input.heat?.validationMaeF, 0, 100),
    trainedThrough: dateOnly(input.heat?.trainedThrough),
  };
  const coverage = input.coverage;
  const start = dateOnly(coverage?.start_date);
  const through = dateOnly(coverage?.through_date);
  const water = boundedNumber(coverage?.indicators?.water, 0, Number.MAX_SAFE_INTEGER);
  const waste = boundedNumber(coverage?.indicators?.waste, 0, Number.MAX_SAFE_INTEGER);
  const mentions = boundedNumber(coverage?.indicators?.rodentMentions, 0, Number.MAX_SAFE_INTEGER);
  const rodentMentions = shortText(input.city, 100)?.toUpperCase() === 'HOUSTON' && Number.isInteger(mentions) ? mentions : undefined;
  return {
    latitude: lat !== undefined && lon !== undefined ? Math.round(lat * 1000) / 1000 : undefined,
    longitude: lat !== undefined && lon !== undefined ? Math.round(lon * 1000) / 1000 : undefined,
    city: shortText(input.city, 70),
    error: shortText(input.error) ? 'Neighborhood data is unavailable.' : undefined,
    timeZone: typeof input.timeZone === 'string' && /^[A-Za-z_+-]+(?:\/[A-Za-z_+-]+){0,2}$/.test(input.timeZone)
      ? shortText(input.timeZone, 50) : undefined,
    store: ['TimescaleDB', 'Local PostgreSQL'].includes(input.store) ? input.store : undefined,
    weather: Object.values(currentWeather).some((number) => typeof number === 'number') || daily.time.length
      ? { current: currentWeather, daily } : undefined,
    coverage: start && through && start <= through && Number.isInteger(water) && Number.isInteger(waste)
      ? { start_date: start, through_date: through, indicators: { water, waste, rodentMentions } } : undefined,
    heat: heat.typicalHighF !== undefined && heat.validationMaeF !== undefined ? heat : undefined,
    history,
  };
}

function cleanBuilding(input) {
  if (!record(input)) return;
  const room = input.roomEvidence;
  return {
    storiesAboveGrade: boundedNumber(input.storiesAboveGrade, 1, 300),
    buildingType: shortText(input.buildingType, 80),
    buildingAreaSqFt: boundedNumber(input.buildingAreaSqFt, 1, 100_000_000),
    yearBuilt: boundedNumber(input.yearBuilt, 1000, 3000),
    propertySubtype: shortText(input.propertySubtype, 80),
    matchedViewpoints: boundedNumber(input.matchedViewpoints, 1, 1_000_000),
    matchedRooms: boundedNumber(input.matchedRooms, 1, 1_000_000),
    roomLabel: shortText(input.roomLabel, 100),
    roomEvidence: record(room) ? {
      areaSqFt: boundedNumber(room.areaSqFt, .01, 100_000_000),
      widthFt: boundedNumber(room.widthFt, .01, 10_000),
      depthFt: boundedNumber(room.depthFt, .01, 10_000),
      heightFt: boundedNumber(room.heightFt, .01, 10_000),
    } : undefined,
    hasMatterport: input.hasMatterport === true,
    hasVexcel: input.hasVexcel === true,
    analysisDate: dateOnly(input.analysisDate),
    captureDate: dateOnly(input.captureDate),
  };
}

function readPng(base64) {
  if (typeof base64 !== 'string' || base64.length < 48 ||
    base64.length > 4 * Math.ceil(MAX_PNG_BYTES / 3) || base64.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return;
  const raw = atob(base64);
  if (raw.length > MAX_PNG_BYTES || raw.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || raw.slice(12, 16) !== 'IHDR') return;
  const uint32 = (offset) => 0x1000000 * raw.charCodeAt(offset) + 0x10000 * raw.charCodeAt(offset + 1) +
    0x100 * raw.charCodeAt(offset + 2) + raw.charCodeAt(offset + 3);
  const width = uint32(16);
  const height = uint32(20);
  return width > 0 && width <= 4096 && height > 0 && height <= 4096 ? raw : undefined;
}

function snapshot(input) {
  if (!record(input) || typeof input.id !== 'string' || !/^[1-9]\d{0,18}$/.test(input.id) ||
    !Object.hasOwn(states, input.status) || !['leak', 'damage'].includes(input.issue)) return;
  const guidance = shortText(input.guidance, 1800);
  const effects = shortText(input.effects, 1800);
  if (!guidance || !effects || (input.renderPng != null && !readPng(input.renderPng))) return;
  return {
    id: input.id, status: input.status, issue: input.issue, guidance, effects,
    area: cleanArea(input.area), building: cleanBuilding(input.building),
    renderStatus: input.renderPng ? 'ready' : input.renderStatus === 'queued' ? 'queued' : input.renderStatus === 'failed' ? 'failed' : undefined,
    renderPng: input.renderPng ?? undefined,
  };
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rounded = (value, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const temperature = (value) => value === undefined ? '' : `${Math.round(value)}°F`;

function heatContent(area) {
  const weather = area?.weather;
  const current = weather?.current;
  const currentValues = current ? [
    current.temperature_2m !== undefined && `${temperature(current.temperature_2m)} outside`,
    current.apparent_temperature !== undefined && `${temperature(current.apparent_temperature)} feels like`,
    current.relative_humidity_2m !== undefined && `${Math.round(current.relative_humidity_2m)}% relative humidity`,
  ].filter(Boolean) : [];
  const forecast = weather?.daily.time.map((day, index) => {
    const max = weather.daily.apparent_temperature_max[index];
    const bar = Math.max(8, Math.min(100, (max + 30) / 1.6));
    return `<li><time datetime="${esc(day)}">${esc(day.slice(5))}</time><i aria-hidden="true" style="--level:${bar}%"></i><strong>${temperature(max)}</strong></li>`;
  }).join('');
  const history = area?.history ?? [];
  const temperatures = history.map(({ feelsLikeF }) => feelsLikeF);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const spark = history.map(({ time, feelsLikeF }) =>
    `<i aria-hidden="true" title="${esc(time)} · ${temperature(feelsLikeF)}" style="--level:${15 + 85 * (feelsLikeF - low) / Math.max(1, high - low)}%"></i>`).join('');
  return `<section class="card"><h3>Outdoor heat and humidity</h3>
    ${currentValues.length ? `<p class="measure">${currentValues.join(' · ')}</p>${current.time ? `<p class="small">Observed ${esc(current.time.replace('T', ' '))} local time.</p>` : ''}` : '<p>Current outdoor conditions are unavailable.</p>'}
    ${forecast ? `<p class="label">Forecast feels-like highs</p><ul class="bars">${forecast}</ul>` : ''}
    ${history.length ? `<p class="label">Recent outdoor readings</p><div class="spark" role="img" aria-label="Feels-like temperatures from ${temperature(low)} to ${temperature(high)}">${spark}</div><p class="small">${temperature(low)} to ${temperature(high)}${area.store ? ` · Stored in ${esc(area.store)}` : ''}</p>` : ''}
    ${area?.heat ? `<p class="small">Seasonal model estimate ${temperature(area.heat.typicalHighF)} feels like · Average validation error ${rounded(area.heat.validationMaeF, 1)}°F${area.heat.trainedThrough ? ` · Trained through ${esc(area.heat.trainedThrough)}` : ''}.</p>` : ''}
    <p class="small">Indoor conditions require an on-site check.${weather ? ' <a href="https://open-meteo.com/" rel="noreferrer">Weather by Open-Meteo</a>.' : ''}</p>
  </section>`;
}

function neighborhood(area) {
  const mapped = Number.isFinite(area?.longitude) && Number.isFinite(area?.latitude);
  const bbox = mapped ? [
    Math.max(-180, area.longitude - .012), Math.max(-85, area.latitude - .008),
    Math.min(180, area.longitude + .012), Math.min(85, area.latitude + .008),
  ].map((number) => number.toFixed(3)).join(',') : '';
  const coverage = area?.coverage;
  const source = { 'LOS ANGELES': 'https://data.lacity.org/d/2cy6-i7zn', HOUSTON: 'https://my311.houstontx.gov/servicerequestdata.html' }[area?.city?.toUpperCase()];
  const records = source ? `<a href="${source}" rel="noreferrer">city 311 reports</a>` : 'city 311 reports';
  return `<section class="group" aria-labelledby="neighborhood">
    <h2 id="neighborhood">Neighborhood conditions</h2>
    ${area?.city ? `<p class="small">${esc(area.city)}</p>` : ''}
    <div class="grid">
      ${heatContent(area)}
      <section class="card"><h3>Rodents and nearby 311 reports</h3>
        ${coverage ? `<p><strong>${rounded(coverage.indicators.water)}</strong> water-related and <strong>${rounded(coverage.indicators.waste)}</strong> waste-related ${records} within 1 km from ${esc(coverage.start_date)} to ${esc(coverage.through_date)}.</p>` : '<p>Nearby water and waste report counts are unavailable.</p>'}
        ${coverage?.indicators.rodentMentions !== undefined ? `<p><strong>${rounded(coverage.indicators.rodentMentions)}</strong> Houston 311 reports in the same area and dates mentioned mice or rats.</p>` : ''}
        <p>Water and waste reports describe neighborhood conditions. An on-site check can establish whether mice or rats are present. Tell maintenance if you see rodents, droppings, or gnaw marks.</p>
        ${bbox ? `<iframe title="OpenStreetMap neighborhood map" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&amp;layer=mapnik"></iframe><p class="small"><a href="https://www.openstreetmap.org/copyright" rel="noreferrer">© OpenStreetMap contributors</a> · Approximate neighborhood</p>` : '<p class="small">Neighborhood map unavailable.</p>'}
      </section>
    </div>
  </section>`;
}

function buildingContent(building) {
  const room = building?.roomEvidence;
  const facts = building ? [
    ['Building type', [building.buildingType, building.propertySubtype].filter(Boolean).join(' · ')],
    ['Above-grade stories', building.storiesAboveGrade],
    ['Building area', building.buildingAreaSqFt && `${rounded(building.buildingAreaSqFt)} sq ft`],
    ['Year built', building.yearBuilt],
    ['Matched scan views', building.matchedViewpoints],
    ['Matched scan rooms', building.matchedRooms],
    ['Reported room', building.roomLabel],
    ['Estimated room area', room?.areaSqFt && `${rounded(room.areaSqFt, 1)} sq ft`],
    ['Estimated dimensions', room && [room.widthFt && `${rounded(room.widthFt, 1)} ft wide`, room.depthFt && `${rounded(room.depthFt, 1)} ft deep`, room.heightFt && `${rounded(room.heightFt, 1)} ft high`].filter(Boolean).join(' · ')],
    ['Roof capture', building.captureDate],
    ['Roof analysis', building.analysisDate],
  ].filter(([, value]) => value) : [];
  return `<section class="card" aria-labelledby="building"><h2 id="building">Building evidence</h2>
    ${facts.length ? `<dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : '<p>Verified building details are unavailable for this report.</p>'}
    ${building?.hasMatterport || building?.hasVexcel ? `<p class="small">${[building.hasMatterport && 'Matched Matterport interior', building.hasVexcel && 'Matched Vexcel aerial imagery'].filter(Boolean).join(' · ')}</p>` : ''}
    ${building?.storiesAboveGrade ? '<p class="small">Building record provided by CoStar.</p>' : ''}
  </section>`;
}

const styles = `
*{box-sizing:border-box}body{margin:0;background:#fffcf8;color:#261b24;font:16px/1.6 system-ui,sans-serif}
header{background:#fffaf7e8;border-bottom:1px solid #e9dde3}.shell{max-width:72rem;width:calc(100% - 2.4rem);margin:auto}
nav{display:flex;align-items:center;justify-content:space-between;padding:.8rem 0;color:#5d264a}.mark{font:italic 2rem/1 Georgia,serif;font-weight:700}
.hero{margin:0 0 1.5rem;padding:clamp(2rem,6vw,4.8rem) 0;background:linear-gradient(112deg,#f7e6c5,#f4e3ed 85%)}
.hero p,.label{font-size:.82rem;font-weight:650;letter-spacing:.03em;color:#652f50}h1,h2,h3,p{margin:0}
h1,h2{font-family:Georgia,serif;font-weight:400;line-height:1.15;letter-spacing:-.025em}h1{font-size:clamp(2.6rem,7vw,5rem)}
h2{font-size:clamp(1.5rem,4vw,2.3rem);margin-bottom:.6rem}h3{font-size:1.1rem}
.badge{display:inline-block;margin:.65rem 0 0;padding:.24rem .75rem;border:1px solid #793b6260;border-radius:2rem;color:#502341;background:#fff9fb;font-size:.86rem}
main>.grid,.group{margin-bottom:1.4rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}
.card,.group{border:1px solid #e9dde3;border-radius:1.2rem;background:#fffcfa;padding:clamp(.9rem,3vw,1.75rem);min-width:0}
.group{background:#f9eff4}.card>p:not(:first-child),.group>p,.group>.grid{margin-top:.55rem}
.small{color:#66545f;font-size:.84rem}.measure{font-weight:600}.label{margin:.75rem 0 .3rem}
a{color:#632d51;text-underline-offset:.16em}.guide{display:block;width:100%;height:auto;margin-top:.85rem;border-radius:.75rem;border:1px solid #e9dde3}
iframe{width:100%;height:13rem;border:0;border-radius:.65rem;background:#f4edef;margin-top:.85rem}
.bars{list-style:none;margin:.45rem 0;padding:0}.bars li{display:grid;grid-template-columns:3.3rem minmax(0,1fr) 3.4rem;gap:.45rem;align-items:center;font-size:.8rem}
.bars i,.spark i{display:block;background:#b46a95;border-radius:.25rem}.bars i{height:.42rem;width:var(--level)}.bars strong{text-align:right}
.spark{display:flex;gap:2px;align-items:end;height:3rem;padding:.2rem;background:#f6ebf2;border-radius:.45rem}.spark i{height:var(--level);flex:1}
dl{margin:0}dl>div{display:flex;justify-content:space-between;gap:.7rem;padding:.34rem 0;border-bottom:1px solid #ece4e8}dt{font-size:.86rem;color:#66545f}dd{margin:0;text-align:right}
footer{padding:1.25rem 0 2rem;color:#66545f;font-size:.83rem}
@media(max-width:670px){.grid{grid-template-columns:1fr}.shell{width:calc(100% - 1.25rem)}dl>div{flex-wrap:wrap}dd{text-align:left}}
`;

function reportHtml(report, uuid) {
  const title = report.issue === 'leak' ? 'Water leak' : 'Building damage';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>${title} · Signoff</title><style>${styles}</style></head><body>
    <header><nav class="shell" aria-label="Signoff"><span class="mark">Signoff</span><a href="/reports/${uuid}">Refresh report</a></nav></header>
    <section class="hero"><div class="shell"><p>Work order L-${esc(report.id)}</p><h1>${title}</h1><span class="badge">${states[report.status]}</span></div></section>
    <main class="shell"><div class="grid"><section class="card"><h2>Temporary protection</h2><p>${esc(report.guidance)}</p>
    ${report.renderStatus === 'ready' ? `<img class="guide" src="/api/reports/${uuid}/render" alt="Three-dimensional scene showing the temporary protection for this repair">` :
      `<p class="small">${report.renderStatus === 'queued' ? 'The 3D guide is being prepared. Refresh this page for an update.' : 'A 3D guide is unavailable.'}</p>`}
    <p class="small"><strong>Possible effects</strong> ${esc(report.effects)}</p></section>${buildingContent(report.building)}</div>
    ${neighborhood(report.area)}</main><footer class="shell">Signoff repair report · Share this link only with people helping with the repair.</footer></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.search) return response('Not found', 404);
    const publishing = publishPath.exec(url.pathname);
    const reading = reportPath.exec(url.pathname);
    if (request.method === 'PUT' && publishing) {
      if (!await authorized(request, env.REPORT_PUBLISH_TOKEN)) return response('Not found', 404);
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response('Use application/json', 415);
      let report;
      try { report = snapshot(await readJson(request)); }
      catch (error) { return error instanceof BodyTooLarge ? response('Report too large', 413) : response('Invalid report', 400); }
      if (!report) return response('Invalid report', 400);
      try { await env.BUCKET.put(storageKey(publishing[1]), JSON.stringify(report)); }
      catch { return response('Report storage unavailable', 503); }
      return response(null, 204);
    }
    if (request.method !== 'GET' || !reading || (reading[1].toLowerCase() === 'reports' && reading[3])) return response('Not found', 404);
    const uuid = reading[2].toLowerCase();
    const api = reading[1].toLowerCase() === 'api/reports';
    let report;
    try {
      const object = await env.BUCKET.get(storageKey(uuid));
      if (!object) return response('Report unavailable', 404);
      report = await object.json();
    } catch { return response('Report storage unavailable', 503); }
    if (api && reading[3]) {
      const raw = report.renderStatus === 'ready' ? readPng(report.renderPng) : undefined;
      if (!raw) return response('Guide unavailable', 404);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return response(bytes, 200, 'image/png');
    }
    const { renderPng, ...metadata } = report;
    if (api) return response(JSON.stringify(metadata), 200, 'application/json; charset=utf-8');
    const page = response(reportHtml(metadata, uuid), 200, 'text/html; charset=utf-8');
    page.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-src https://www.openstreetmap.org; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return page;
  },
};
