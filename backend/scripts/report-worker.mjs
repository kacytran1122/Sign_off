const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const publishPath = new RegExp(`^/internal/reports/(${UUID})$`, 'i');
const reportPath = new RegExp(`^/(reports|api/reports)/(${UUID})(/render)?/?$`, 'i');
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * Math.ceil(MAX_PNG_BYTES / 3) + 32 * 1024;
const states = { open: 'Open', scheduled: 'Scheduled', awaiting_confirmation: 'Awaiting tenant confirmation', closed: 'Closed' };
const inspectionDecisions = {
  'indoor-check': 'Inspect the reported area first',
  'roof-zone': 'Start indoors, then check the roof zone',
  'projected-roof-check': 'Start indoors, then check the mapped roof spot',
  'alignment-check': 'Verify the room-to-roof alignment',
};
const precautions = {
  bucket: {
    title: 'Water leak',
    action: 'Contain a small drip safely',
    model: 'Bucket below a drip with a clear walkway',
  },
  towel: {
    title: 'Water on the floor',
    action: 'Protect the walking area',
    model: 'Towel at a small spill with a clear walkway',
  },
  clear: {
    action: 'Keep clear of the affected area',
    model: 'Clear space around a damaged area',
  },
  'stair-sign': {
    title: 'Damaged stair',
    action: 'Avoid the damaged step',
    model: 'Unsafe step and a warning visible from the landing',
  },
};
const scenarios = {
  'ceiling-leak': {
    issue: 'leak',
    title: 'Ceiling leak',
    inspection: 'Have maintenance inspect the reported ceiling and adjacent services.',
  },
  'sink-leak': {
    issue: 'leak',
    title: 'Under-sink leak',
    model: 'Cabinet cutaway with the drain, trap and collection area',
    inspection: 'Have maintenance inspect the sink supply connections, drain joints and cabinet base.',
  },
  'floor-spill': {
    issue: 'leak',
    title: 'Water on the floor',
    inspection: 'Identify the source of the water and check the floor before reopening the affected walkway.',
  },
  'damaged-stair': {
    issue: 'damage',
    title: 'Damaged stair',
    inspection: 'Keep the affected stair out of use until maintenance has inspected the tread and its supports.',
  },
  'damaged-window': {
    issue: 'damage',
    title: 'Damaged window',
    inspection: 'Have maintenance inspect the affected glass, frame and latch from a safe position.',
  },
  'general-leak': { issue: 'leak', title: 'Water leak' },
  'general-damage': { issue: 'damage', title: 'Building damage' },
};
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
const sourceLines = (values) => Array.isArray(values)
  ? values.slice(0, 8).map((value) => shortText(value, 320)).filter(Boolean)
  : undefined;

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

function cleanObservations(input) {
  const hours = boundedNumber(input?.hours, 1, 24);
  const lowFeelsLikeF = boundedNumber(input?.lowFeelsLikeF, -150, 250);
  const highFeelsLikeF = boundedNumber(input?.highFeelsLikeF, -150, 250);
  const lowHumidity = boundedNumber(input?.lowHumidity, 0, 100);
  const highHumidity = boundedNumber(input?.highHumidity, 0, 100);
  if (!Number.isInteger(hours) || lowFeelsLikeF === undefined || highFeelsLikeF === undefined ||
      lowHumidity === undefined || highHumidity === undefined || lowFeelsLikeF > highFeelsLikeF || lowHumidity > highHumidity) return;
  return { hours, lowFeelsLikeF, highFeelsLikeF, lowHumidity, highHumidity };
}

function cleanRodentPeriods(periods, start, through) {
  if (!Array.isArray(periods) || periods.length !== 2) return;
  const windows = periods.map((period) => ({
    start_date: dateOnly(period?.start_date),
    through_date: dateOnly(period?.through_date),
    mentions: boundedNumber(period?.mentions, 0, Number.MAX_SAFE_INTEGER),
  }));
  for (const window of windows) {
    if (!window.start_date || !window.through_date || window.start_date < start || window.through_date > through ||
        Date.parse(window.through_date) - Date.parse(window.start_date) !== 29 * day || !Number.isInteger(window.mentions)) return;
  }
  const [latest, prior] = windows;
  if (latest.through_date !== through || Date.parse(latest.start_date) - Date.parse(prior.through_date) !== day) return;
  return windows;
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
    observations: cleanObservations(input.observations),
    coverage: start && through && start <= through && Number.isInteger(water) && Number.isInteger(waste)
      ? {
          start_date: start, through_date: through, indicators: { water, waste, rodentMentions },
          store: ['TimescaleDB', 'Local PostgreSQL', 'City 311'].includes(coverage.store) ? coverage.store : undefined,
          rodentPeriods: rodentMentions === undefined ? undefined : cleanRodentPeriods(coverage.rodentPeriods, start, through),
        } : undefined,
    heat: heat.typicalHighF !== undefined && heat.validationMaeF !== undefined ? heat : undefined,
    history,
  };
}

const publicModelId = /^[A-Za-z0-9]{1,64}$/;

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
    publicMatterportModel: input.hasMatterport === true && typeof input.publicMatterportModel === 'string' &&
      publicModelId.test(input.publicMatterportModel) ? input.publicMatterportModel : undefined,
    hasVexcel: input.hasVexcel === true,
    analysisDate: dateOnly(input.analysisDate),
    captureDate: dateOnly(input.captureDate),
    inspectionSteps: sourceLines(input.inspectionSteps),
    roofEvidence: sourceLines(input.roofEvidence),
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

function cleanAssessment(input) {
  if (!record(input) || typeof input.decision !== 'string' || !Object.hasOwn(inspectionDecisions, input.decision)) return;
  const reason = shortText(input.reason, 350);
  const nextStep = shortText(input.nextStep, 550);
  if (reason && nextStep) return { decision: input.decision, reason, nextStep };
}

function snapshot(input) {
  if (!record(input) || typeof input.id !== 'string' || !/^[1-9]\d{0,18}$/.test(input.id) ||
    typeof input.status !== 'string' || !Object.hasOwn(states, input.status) || !['leak', 'damage'].includes(input.issue)) return;
  const guidance = shortText(input.guidance, 1800);
  const effects = shortText(input.effects, 1800);
  if (!guidance || !effects || (input.renderPng != null && !readPng(input.renderPng))) return;
  return {
    id: input.id, status: input.status, issue: input.issue, guidance, effects,
    aid: typeof input.aid === 'string' && Object.hasOwn(precautions, input.aid) ? input.aid : undefined,
    scenario: typeof input.scenario === 'string' && Object.hasOwn(scenarios, input.scenario) &&
      scenarios[input.scenario].issue === input.issue ? input.scenario : undefined,
    area: cleanArea(input.area), building: cleanBuilding(input.building),
    inspectionAssessment: cleanAssessment(input.inspectionAssessment),
    renderStatus: input.renderPng ? 'ready' : input.renderStatus === 'queued' ? 'queued' : input.renderStatus === 'failed' ? 'failed' : undefined,
    renderPng: input.renderPng ?? undefined,
  };
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rounded = (value, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const temperature = (value) => value === undefined ? '' : `${Math.round(value)}°F`;

const hour = 60 * 60 * 1000;
const day = 24 * hour;

function series(raw) {
  const byTime = new Map();
  for (const [time, degrees] of raw) {
    if (Number.isFinite(time) && Number.isFinite(degrees)) byTime.set(time, degrees);
  }
  return [...byTime].sort(([left], [right]) => left - right);
}

function localTimeFormat(timeZone) {
  const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  try { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone ?? 'UTC' }); }
  catch { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }); }
}

const forecastTimeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function lineChart(id, title, style, points, formatter, maximumGap) {
  if (!points.length) return `<figure class="chart"><figcaption>${title}</figcaption><p class="muted">Data unavailable.</p></figure>`;
  const [start] = points[0];
  const [end] = points.at(-1);
  const values = points.map((entry) => entry[1]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = Math.max(1, Math.ceil((high - low) / 4));
  const base = Math.floor((low - step / 2) / step) * step;
  const limit = Math.ceil((high + step / 2) / step) * step;
  const ticks = Array.from({ length: (limit - base) / step + 1 }, (_, i) => base + i * step);
  const plot = { left: 52, right: 592, top: 28, bottom: 174 };
  const x = (time) => end === start ? (plot.left + plot.right) / 2
    : plot.left + (time - start) / (end - start) * (plot.right - plot.left);
  const y = (value) => plot.bottom - (value - base) / (limit - base) * (plot.bottom - plot.top);
  const commands = points.map(([time, degrees], i) => {
    const mark = !i || time - points[i - 1][0] > maximumGap ? 'M' : 'L';
    return `${mark}${x(time).toFixed(2)} ${y(degrees).toFixed(2)}`;
  }).join(' ');
  const horizontal = ticks.map((value) => `<line x1="${plot.left}" x2="${plot.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${plot.left - 10}" y="${y(value)}" text-anchor="end" dominant-baseline="middle">${value}</text>`).join('');
  const rangeLabels = start === end ? [[start, 'middle']] : [[start, 'start'], [end, 'end']];
  const bottom = rangeLabels.map(([time, anchor]) => `<text x="${x(time)}" text-anchor="${anchor}" y="198">${esc(formatter.format(time))}</text>`).join('');
  const readingRows = points.map(([time, value]) => {
    const instant = new Date(time).toISOString();
    return `<tr><th scope="row"><time datetime="${id === 'forecast' ? instant.slice(0, 10) : instant}">${esc(formatter.format(time))}</time></th><td>${rounded(value, 1)}°F</td></tr>`;
  }).join('');
  const description = `${points.length === 1 ? `One value at ${temperature(low)}` : `${points.length} values from ${temperature(low)} to ${temperature(high)}`}. Use the reading table for exact values and dates.`;
  return `<figure class="chart ${style}"><figcaption id="${id}-title">${title}</figcaption>
    <svg viewBox="0 0 610 212" role="img" aria-labelledby="${id}-title ${id}-description">
      <desc id="${id}-description">${description}</desc>
      <g class="chart-ticks" aria-hidden="true"><text x="${plot.left}" y="15">Feels like (°F)</text>${horizontal}${bottom}</g>
      <path class="chart-line" d="${commands}"/>
      ${points.map(([time, degrees]) => `<circle class="chart-dot" cx="${x(time)}" cy="${y(degrees)}" r="${points.length > 12 ? 3 : 4}"><title>${esc(formatter.format(time))} · ${rounded(degrees, 1)}°F</title></circle>`).join('')}
    </svg>
    <details><summary>View values</summary><table><thead><tr><th scope="col">${id === 'forecast' ? 'Date' : 'Reading time'}</th><th scope="col">Feels like</th></tr></thead><tbody>${readingRows}</tbody></table></details>
  </figure>`;
}

function observationSummary(observations, store, latestHour, timeZone) {
  if (!observations) return '';
  const { hours, lowFeelsLikeF, highFeelsLikeF, lowHumidity, highHumidity } = observations;
  const source = store === 'TimescaleDB' ? 'Tiger Data (TimescaleDB)' : store;
  const date = Number.isFinite(latestHour) ? new Date(latestHour) : undefined;
  const latestLabel = date ? new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }).format(date) : '';
  return `<div class="observation-summary">
    <h4>24-hour weather summary</h4>
    <dl class="weather-current">
      <div><dt>Hours with readings</dt><dd>${hours} / 24</dd></div>
      <div><dt>Hourly feels-like range</dt><dd>${temperature(lowFeelsLikeF)}–${temperature(highFeelsLikeF)}</dd></div>
      <div><dt>Hourly humidity range</dt><dd>${rounded(lowHumidity)}%–${rounded(highHumidity)}%</dd></div>
    </dl>
    ${date ? `<p class="muted">Latest recorded hour <time datetime="${date.toISOString()}">${esc(latestLabel)}</time>.</p>` : ''}
    <p class="muted">Outdoor readings averaged by hour.${source ? ` Stored in ${esc(source)}.` : ''}</p>
  </div>`;
}

function heatContent(area) {
  const weather = area?.weather;
  const current = weather?.current;
  const currentValues = current ? [
    ['Outdoor temperature', temperature(current.temperature_2m)],
    ['Feels like', temperature(current.apparent_temperature)],
    ['Relative humidity', current.relative_humidity_2m !== undefined ? `${Math.round(current.relative_humidity_2m)}%` : ''],
  ].filter(([, value]) => value) : [];
  const forecast = series((weather?.daily?.time ?? []).map((date, index) => [Date.parse(date), weather.daily.apparent_temperature_max[index]]));
  const history = series((area?.history ?? []).map(({ time, feelsLikeF }) => [Date.parse(time), feelsLikeF]));
  const formatter = localTimeFormat(area?.timeZone);
  const zone = formatter.resolvedOptions().timeZone;
  return `<section class="card weather-card" aria-labelledby="weather-heading">
    <h3 id="weather-heading">Outdoor heat and humidity</h3>
    ${currentValues.length ? `<dl class="weather-current">${currentValues.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>${current.time ? `<p class="muted">Observed ${esc(current.time.replace('T', ' '))} local time.</p>` : ''}` : '<p class="muted">Current outdoor conditions are unavailable.</p>'}
    ${observationSummary(area?.observations, area?.store, history.at(-1)?.[0], zone)}
    <div class="chart-grid">
      ${lineChart('observed', 'Hourly outdoor readings', 'observed', history, formatter, 1.5 * hour)}
      ${lineChart('forecast', 'Forecast feels-like highs from this snapshot', 'forecast', forecast, forecastTimeFormat, 1.5 * day)}
    </div>
    ${area?.heat ? `<div class="estimate"><p><strong>Seasonal model estimate ${temperature(area.heat.typicalHighF)}</strong> feels like</p><p class="muted">Average validation error ${rounded(area.heat.validationMaeF, 1)}°F${area.heat.trainedThrough ? ` · Trained through ${esc(area.heat.trainedThrough)}` : ''}.</p></div>` : ''}
    <p class="muted attribution">Indoor conditions require an on-site check.${history.length ? ` Hourly readings shown in ${esc(zone)}${area.store && !area.observations ? ` and stored in ${esc(area.store)}` : ''}.` : ''}${weather ? ' <a href="https://open-meteo.com/" rel="noreferrer">Weather by Open-Meteo</a>.' : ''}</p>
  </section>`;
}

function rodentContent(city, coverage, records) {
  const count = coverage?.indicators.rodentMentions;
  const rows = (coverage?.rodentPeriods ?? []).map((window) =>
    `<tr><th scope="row"><time>${esc(window.start_date)}</time> to <time>${esc(window.through_date)}</time></th><td>${rounded(window.mentions)}</td></tr>`).join('');
  return `<section class="card rodent-card" aria-labelledby="rodent-heading">
    <h3 id="rodent-heading">Mice and rats</h3>
    ${count !== undefined ? `<dl class="local-counts"><div><dt>311 requests mentioning mice or rats</dt><dd>${rounded(count)}</dd></div></dl>
      <p class="muted">Houston ${records} within 1 km from ${esc(coverage.start_date)} to ${esc(coverage.through_date)}.${coverage.store === 'TimescaleDB' ? ' Stored in Tiger Data (TimescaleDB).' : ''}</p>
      ${rows ? `<table><caption>Recent 30-day periods</caption><thead><tr><th scope="col">Dates</th><th scope="col">Requests</th></tr></thead><tbody>${rows}</tbody></table>` : ''}` :
      '<p class="muted">Nearby mouse and rat request counts are unavailable for this report.</p>'}
    <p>An on-site check can establish whether mice or rats are present. Tell maintenance if you see rodents, droppings, or gnaw marks.</p>
    <p>Keep food and trash sealed. Ask maintenance to repair leaks and check for openings around pipes and doors. Avoid sweeping or vacuuming droppings.</p>
    <p class="muted"><a href="https://www.cdc.gov/healthy-pets/rodent-control/index.html" rel="noreferrer">CDC rodent guidance</a>${city === 'LOS ANGELES' ? ' · <a href="https://publichealth.lacounty.gov/eh/safety/rats.htm" rel="noreferrer">LA County rodent reporting</a>' : ''}</p>
  </section>`;
}

function neighborhood(area) {
  const mapped = Number.isFinite(area?.longitude) && Number.isFinite(area?.latitude);
  const center = mapped ? encodeURIComponent(`${area.longitude.toFixed(3)},${area.latitude.toFixed(3)}`) : '';
  const coverage = area?.coverage;
  const city = area?.city?.toUpperCase();
  const source = { 'LOS ANGELES': 'https://data.lacity.org/d/2cy6-i7zn', HOUSTON: 'https://my311.houstontx.gov/servicerequestdata.html' }[city];
  const records = source ? `<a href="${source}" rel="noreferrer">city 311 reports</a>` : 'city 311 reports';
  return `<section class="section" aria-labelledby="neighborhood">
    <div class="section-title"><h2 id="neighborhood">Neighborhood conditions</h2>${area?.city ? `<p class="muted">${esc(area.city)}</p>` : ''}</div>
    ${heatContent(area)}
    <section class="card satellite-card"><h3>Neighborhood satellite view</h3>
      ${center ? `<iframe class="satellite-map" title="Neighborhood satellite map" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" src="https://www.arcgis.com/apps/Embed/index.html?webmap=86265e5a4bbb4187a59719cf134e0018&amp;center=${center}&amp;level=18&amp;scale=true&amp;zoom=true&amp;disable_scroll=true"></iframe><p class="muted attribution">Approximate location · <a href="https://www.arcgis.com/home/item.html?id=86265e5a4bbb4187a59719cf134e0018" rel="noreferrer">Esri World Imagery</a></p>` : '<p class="muted">Neighborhood map unavailable.</p>'}
    </section>
    <section class="card"><h3>Nearby 311 reports</h3>
      ${coverage ? `<dl class="local-counts">
        <div><dt>Water-related</dt><dd>${rounded(coverage.indicators.water)}</dd></div>
        <div><dt>Waste-related</dt><dd>${rounded(coverage.indicators.waste)}</dd></div>
      </dl><p class="muted">Source: ${records} within 1 km from ${esc(coverage.start_date)} to ${esc(coverage.through_date)}.</p>` : '<p class="muted">Nearby 311 report counts are unavailable.</p>'}
    </section>
    ${rodentContent(city, coverage, records)}
  </section>`;
}

function sourceCard(title, facts, notes) {
  const present = facts.filter(([, value]) => value);
  return `<section class="card evidence-card"><h3>${title}</h3>
    ${present.length ? `<dl class="evidence-list">${present.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
    ${notes}
  </section>`;
}

function matterportView(building) {
  const model = building?.publicMatterportModel;
  if (!model || !publicModelId.test(model)) return '';
  const url = `https://my.matterport.com/show/?m=${model}&amp;play=1`;
  return `<details class="card property-view">
    <summary>Explore the property in 3D</summary>
    <iframe title="Matterport 3D property scan" src="${url}" loading="lazy" referrerpolicy="no-referrer" allow="fullscreen"></iframe>
    <p class="muted"><a href="${url}" target="_blank" rel="noreferrer">Open in Matterport</a></p>
  </details>`;
}

function inspectionDecision(assessment, aid) {
  const result = cleanAssessment(assessment);
  if (!result) return '';
  const heading = aid === 'clear' ? 'Keep clear until maintenance assesses the area' : inspectionDecisions[result.decision];
  return `<section class="card assessment-card" aria-labelledby="assessment">
    <h2 id="assessment">Inspection recommendation</h2>
    <h3>${heading}</h3>
    <p class="muted">${esc(result.reason)}</p>
    <p>${esc(result.nextStep)}</p>
  </section>`;
}

function buildingContent(building, report) {
  if (!building || !(building.storiesAboveGrade || building.hasMatterport || building.hasVexcel)) {
    return '<section class="section" aria-labelledby="building"><div class="section-title"><h2 id="building">Building evidence</h2></div><div class="card muted">Verified building evidence is unavailable for this report.</div></section>';
  }
  const room = building.roomEvidence;
  const linkedOverhead = building.storiesAboveGrade && building.hasMatterport && building.hasVexcel &&
    (report.scenario === 'ceiling-leak' || (!report.scenario && report.issue === 'leak' && (building.inspectionSteps?.length ?? 0) > 0));
  return `<section class="section" aria-labelledby="building">
    <div class="section-title"><h2 id="building">Building evidence</h2>${building.roomLabel ? `<p class="muted">${esc(building.roomLabel)}</p>` : ''}</div>
    <div class="source-grid">
      ${building.storiesAboveGrade ? sourceCard('CoStar Group', [
        ['Building type', [building.buildingType, building.propertySubtype].filter(Boolean).join(' · ')],
        ['Above-grade stories', building.storiesAboveGrade],
        ['Building area', building.buildingAreaSqFt && `${rounded(building.buildingAreaSqFt)} sq ft`],
        ['Year built', building.yearBuilt],
      ], '<p class="muted attribution">Building record provided by CoStar.</p>') : ''}
      ${building.hasMatterport ? sourceCard('Matterport', [
        ['Reported room', building.roomLabel],
        ['Estimated room area', room?.areaSqFt && `${rounded(room.areaSqFt, 1)} sq ft`],
        ['Estimated dimensions', room && [room.widthFt && `${rounded(room.widthFt, 1)} ft wide`, room.depthFt && `${rounded(room.depthFt, 1)} ft deep`, room.heightFt && `${rounded(room.heightFt, 1)} ft high`].filter(Boolean).join(' · ')],
        ['Matched scan rooms', building.matchedRooms],
        ['Matched scan views', building.matchedViewpoints],
      ], '<p class="muted attribution">Matched Matterport interior</p>') : ''}
      ${building.hasVexcel ? sourceCard('Vexcel', [
        ['Roof capture', building.captureDate],
        ['Roof analysis', building.analysisDate],
      ], `${building.roofEvidence?.length ? `<ul class="evidence-notes">${building.roofEvidence.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}<p class="muted attribution">Matched Vexcel aerial imagery</p>`) : ''}
    </div>
    ${matterportView(building)}
    ${linkedOverhead && building.inspectionSteps?.length ? `<section class="card path-card"><h3>Suggested inspection path</h3><ol>${building.inspectionSteps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol><p class="muted">The property record, interior scan, and aerial capture guide where to look. A site visit can verify the source.</p></section>` : ''}
  </section>`;
}

const reportCanvas = 'margin:0;background:#faf6f3;color:#291d27;font:16px/1.55 system-ui,-apple-system,sans-serif';
const styles = `
*{box-sizing:border-box}
h1,h2,h3,p,figure,dl{margin:0}
h1,h2{font-family:Georgia,serif;font-weight:400;letter-spacing:-.04em;line-height:1.1}
h1{font-size:clamp(2.8rem,8vw,5.25rem)}h2{font-size:clamp(1.9rem,4.5vw,2.85rem)}
h3{font-size:1.16rem;line-height:1.32;letter-spacing:-.02em}p{overflow-wrap:anywhere}
a{color:#66294e;text-underline-offset:.2em}a:focus-visible,summary:focus-visible{outline:2px solid #7d3d65;outline-offset:4px}
.shell{max-width:73rem;width:calc(100% - 3rem);margin-inline:auto}
header{background:#fffcfa;border-bottom:1px solid #ebdde4}nav{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.7rem 0}
.mark{font:700 italic 2.05rem/1 Georgia,serif;letter-spacing:-.07em;color:#652d50}
.refresh{padding:.41rem .82rem;border:1px solid #ddc8d6;border-radius:999px;text-decoration:none;font-size:.8rem;font-weight:650}
.hero{padding:clamp(2.4rem,5.6vw,4.8rem) 0;background:radial-gradient(ellipse 45rem 27rem at 92% 70%,#efe1ed,transparent),linear-gradient(110deg,#f2e1ce,#fff9ee 65%)}
.hero p{color:#632f4f;font-size:.85rem;font-weight:650;letter-spacing:.04em}.hero h1{margin:.32rem 0 .75rem}
.badge{display:inline-block;border:1px solid #d9c2d0;border-radius:999px;padding:.22rem .67rem;background:#fffaf5;color:#61314d;font-size:.82rem;font-weight:650}
.badge.closed{color:#245848;background:#edf4e9;border-color:#c9dccb}
main{padding-block:clamp(1.45rem,4vw,3rem)}
.section{margin-top:clamp(2rem,5.5vw,4rem)}.section-title{margin:0 0 1rem}.section-title .muted{margin-top:.28rem}
.card{min-width:0;border:1px solid #e9dce3;border-radius:1.1rem;background:#fffcfa;padding:clamp(1rem,2.7vw,1.75rem);box-shadow:0 3px 11px #41223508}
.card>p:not(:first-child){margin-top:.56rem}.muted{color:#614e5d;font-size:.87rem}
.attribution{border-top:1px solid #ede1e8;padding-top:.65rem;margin-top:1rem}
.action-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:.9rem;align-items:stretch}
.action-card{background:linear-gradient(150deg,#f7e8e9,#fffdf9 65%);padding:clamp(1.2rem,3vw,2.3rem)}
.action-card h2{font-size:clamp(1.85rem,4vw,2.7rem)}.action-card > p{max-width:43ch}
.action-pair{border-top:1px solid #e8d9e1;margin-top:1.2rem;padding-top:1rem}.action-pair h3{font-size:.95rem}.action-pair p{margin:.3rem 0 1rem}
.model-card{overflow:hidden;padding:clamp(.75rem,1.5vw,1rem)}.model-card img{display:block;width:100%;height:auto;aspect-ratio:1.56;object-fit:contain;background:#f4edf0;border-radius:.64rem}
.model-card figcaption{padding:.72rem .45rem .12rem}.model-card figcaption strong{display:block;font-size:1rem}
.model-card figcaption p{margin-top:.25rem}.model-pending{min-height:8rem;padding:.75rem}
.source-grid,.chart-grid{display:grid;gap:.9rem;grid-template-columns:repeat(2,minmax(0,1fr))}
.source-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));align-items:stretch}
.evidence-card h3{color:#65324e}.path-card{margin-top:.9rem}.path-card ol,.evidence-notes{padding-left:1.25rem;margin:.75rem 0}
.evidence-list{margin-top:.45rem}.evidence-list>div{display:flex;justify-content:space-between;gap:.7rem;padding:.36rem 0;border-bottom:1px solid #efe5eb}.evidence-list dt{color:#614e5d;font-size:.83rem}.evidence-list dd{text-align:right;font-size:.89rem;font-weight:600}
.weather-card{margin-bottom:.9rem}.weather-current,.local-counts{display:flex;flex-wrap:wrap;gap:.65rem;margin:.65rem 0}.weather-current>div,.local-counts>div{min-width:0;flex:1 1 7rem;padding:.58rem .66rem;background:#f5edf2;border-radius:.58rem}
.weather-current dt,.local-counts dt{font-size:.79rem;color:#614e5d}.weather-current dd,.local-counts dd{font-weight:700;font-size:clamp(1.1rem,3vw,1.5rem);font-variant-numeric:tabular-nums}
.chart{min-width:0;margin:.75rem 0 .2rem;padding:.8rem;border:1px solid #ebdfe7;border-radius:.85rem}
.chart figcaption{font-size:.92rem;font-weight:650}.chart>p{margin-top:.4rem}.chart svg{width:100%;height:auto;display:block;margin-top:.55rem;overflow:visible}
.chart-ticks line{stroke:#e7dce4;stroke-width:1}.chart-ticks text{fill:#5b4a57;font:16px system-ui,-apple-system,sans-serif}
.chart-line{fill:none;stroke:#8b3566;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.chart-dot{fill:#8b3566;stroke:#fff;stroke-width:1.5}
.forecast .chart-line{stroke:#276760;stroke-dasharray:7 5}.forecast .chart-dot{fill:#276760}
.chart details{font-size:.83rem;margin-top:.36rem}.chart summary{cursor:pointer;color:#632c50;padding:.18rem 0}
.chart table{width:100%;border-collapse:collapse;margin-top:.4rem;text-align:left}.chart td,.chart th{padding:.2rem .3rem;border-bottom:1px solid #eee3eb}.chart td:last-child,.chart th:last-child{text-align:right}.chart tbody th{font-weight:400}
.estimate{background:#f4edf1;border-radius:.58rem;margin-top:.8rem;padding:.66rem .8rem}.estimate strong{font-weight:650}
.observation-summary,.rodent-card{margin-top:.9rem}.observation-summary h4{font-size:.9rem;margin:0}
.rodent-card p{margin-top:.6rem}.rodent-card table{width:100%;margin-top:.7rem;border-collapse:collapse;text-align:left;font-size:.85rem;font-variant-numeric:tabular-nums}
.rodent-card caption{text-align:left;font-weight:650;padding:0 0 .35rem}.rodent-card td,.rodent-card th{padding:.4rem .5rem;border-bottom:1px solid #eee3eb}.rodent-card tbody th{font-weight:400}.rodent-card td,.rodent-card th:last-child{text-align:right}
.satellite-card{margin-bottom:.9rem}
.satellite-map{display:block;width:100%;height:clamp(24rem,44vw,39rem);border:0;border-radius:.65rem;background:#f4edef;margin-top:.72rem}
.property-view{margin-top:.9rem}.property-view summary{cursor:pointer;font-weight:650;color:#632c50}
.property-view iframe{display:block;width:100%;height:clamp(19rem,40vw,34rem);border:0;border-radius:.65rem;background:#231721;margin:.75rem 0}
.assessment-card{margin-top:1rem;background:linear-gradient(135deg,#f4e5ef,#fffcfa 72%)}.assessment-card h2{margin-bottom:.7rem}
footer{padding:0 0 2rem;color:#614e5d;font-size:.83rem}
@media(max-width:730px){.action-grid,.chart-grid{grid-template-columns:minmax(0,1fr)}.shell{width:calc(100% - 1.3rem)}.chart-ticks text{font-size:23px}}
`;

function reportMarkup(report, { navigationHref, navigationLabel, reference, renderSrc, footer }) {
  const scenario = Object.hasOwn(scenarios, report.scenario) ? scenarios[report.scenario] : undefined;
  const precaution = Object.hasOwn(precautions, report.aid) ? precautions[report.aid] : undefined;
  const title = scenario?.title ?? precaution?.title ?? (report.issue === 'leak' ? 'Water leak' : 'Building damage');
  const action = precaution?.action ?? 'Temporary protection';
  const model = (report.aid !== 'clear' && scenario?.model) || precaution?.model || 'Temporary protection for the reported condition';
  const html = `<header><nav class="shell" aria-label="Signoff"><span class="mark">Signoff</span><a class="refresh" href="${esc(navigationHref)}">${esc(navigationLabel)}</a></nav></header>
    <section class="hero"><div class="shell"><p>${esc(reference)}</p><h1>${title}</h1><span class="badge ${report.status === 'closed' ? 'closed' : ''}">${states[report.status]}</span></div></section>
    <main class="shell">
      <div class="action-grid">
        <section class="card action-card" aria-labelledby="action"><h2 id="action">${action}</h2><p>${esc(report.guidance)}</p>
          <div class="action-pair"><h3>Possible effects</h3><p class="muted">${esc(report.effects)}</p>${scenario?.inspection ? `<h3>Maintenance check</h3><p>${scenario.inspection}</p>` : ''}</div>
        </section>
        <figure class="card model-card">
          ${report.renderStatus === 'ready' ? `<img src="${esc(renderSrc)}" alt="3D model: ${model}">` : `<p class="model-pending muted">${report.renderStatus === 'queued' ? 'The 3D model is being prepared. Refresh this page for an update.' : 'A 3D model is unavailable.'}</p>`}
          <figcaption><strong>3D reference model</strong>${report.renderStatus === 'ready' ? `<p>${model}.</p><p class="muted">Blender rendered</p>` : ''}</figcaption>
        </figure>
      </div>
      ${inspectionDecision(report.inspectionAssessment, report.aid)}${buildingContent(report.building, report)}${neighborhood(report.area)}
    </main><footer class="shell">${esc(footer)}</footer>`;
  return { title, html };
}

function reportHtml(report, uuid) {
  const { title, html } = reportMarkup(report, {
    navigationHref: `/reports/${uuid}`, navigationLabel: 'Refresh report',
    reference: `Work order L-${report.id}`, renderSrc: `/api/reports/${uuid}/render`,
    footer: 'Signoff repair report · Share this link only with people helping with the repair.',
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><title>${title} · Signoff</title><style>body{${reportCanvas}}${styles}</style></head><body>
    ${html}</body></html>`;
}

export function renderPublicReportExample(report, renderSrc) {
  const { html } = reportMarkup(report, {
    navigationHref: '/', navigationLabel: 'Back to Signoff',
    reference: 'Public repair example', renderSrc,
    footer: 'Signoff repair report · Public example',
  });
  return { html, css: `@scope (.signoff-public-report) { :scope{${reportCanvas};min-height:100vh} ${styles} }` };
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
    const matterport = metadata.building?.publicMatterportModel && publicModelId.test(metadata.building.publicMatterportModel)
      ? ' https://my.matterport.com' : '';
    page.headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-src https://www.arcgis.com${matterport}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    return page;
  },
};
