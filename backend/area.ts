import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { Config } from './config.js';
import { queueAreaNotices } from './reports.js';

const weatherSchema = z.object({
  timezone: z.string(),
  current: z.object({ time: z.string(), temperature_2m: z.number(), relative_humidity_2m: z.number(), apparent_temperature: z.number() }),
  daily: z.object({ time: z.array(z.string()), apparent_temperature_max: z.array(z.number().nullable()) }),
  hourly: z.object({ time: z.array(z.string()), temperature_2m: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()), apparent_temperature: z.array(z.number().nullable()) }),
});
const modelSchema = z.object({ city: z.string(), trainedThrough: z.string(), holdoutMae: z.number(), samples: z.number(), coefficients: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]) });
const geocodeSchema = z.object({ result: z.object({ addressMatches: z.array(z.object({
  coordinates: z.object({ x: z.number().min(-180).max(180), y: z.number().min(-90).max(90) }),
  addressComponents: z.object({ city: z.string().optional(), state: z.string().optional() }),
})) }) });

async function json(url: URL) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Area source returned ${response.status}`);
  return response.json();
}

async function losAngelesIndicators(latitude: number, longitude: number) {
  const day = DateTime.now().setZone('America/Los_Angeles');
  const through = day.toISODate()!;
  const start = day.minus({ days: 89 }).toISODate()!;
  if (!start.startsWith('2026') || !through.startsWith('2026')) return;
  const lat = 'geolocation__latitude__s';
  const lon = 'geolocation__longitude__s';
  const water = ['Flooding', 'Report Water Wasting', 'Illegal Discharge of Water'];
  const waste = ['Illegal Dumping Item Pickup', 'Public Street Receptacles'];
  const categories = [...water, ...waste].map((type) => `'${type}'`).join(',');
  const longitudeScale = 111.2 * Math.cos(latitude * Math.PI / 180);
  const deltaLon = 1 / longitudeScale;
  const url = new URL('https://data.lacity.org/resource/2cy6-i7zn.json');
  url.search = new URLSearchParams({ '$select': `type,${lat},${lon}`, '$limit': '5000',
    '$where': `createddate >= '${start}T00:00:00' AND type in (${categories}) AND ${lat} between ${latitude - .01} and ${latitude + .01} AND ${lon} between ${longitude - deltaLon} and ${longitude + deltaLon}` }).toString();
  const rows = z.array(z.object({ type: z.string(), [lat]: z.coerce.number(), [lon]: z.coerce.number() })).parse(await json(url));
  if (rows.length === 5000) return;
  const indicators = { water: 0, waste: 0 };
  for (const row of rows) {
    if ((111.2 * (row[lat] - latitude)) ** 2 + (longitudeScale * (row[lon] - longitude)) ** 2 <= 1) {
      indicators[water.includes(row.type) ? 'water' : 'waste']++;
    }
  }
  return { start_date: start, through_date: through, indicators };
}

export const areaSchema = `
  CREATE TABLE IF NOT EXISTS neighborhood_samples (
    observed_at timestamptz NOT NULL, latitude double precision NOT NULL, longitude double precision NOT NULL,
    temperature_f double precision NOT NULL, feels_like_f double precision NOT NULL, humidity double precision NOT NULL,
    PRIMARY KEY (observed_at, latitude, longitude)
  );
  CREATE TABLE IF NOT EXISTS neighborhood_events (
    city text NOT NULL, ticket text NOT NULL, kind text NOT NULL, observed_on date NOT NULL,
    latitude double precision NOT NULL, longitude double precision NOT NULL, PRIMARY KEY(city,ticket)
  );
  CREATE TABLE IF NOT EXISTS neighborhood_coverage (
    city text PRIMARY KEY, start_date date NOT NULL, through_date date NOT NULL,
    rodent_mentions boolean NOT NULL DEFAULT false
  );
  ALTER TABLE neighborhood_coverage ADD COLUMN IF NOT EXISTS rodent_mentions boolean NOT NULL DEFAULT false;`;

type RodentPeriod = { start_date: string; through_date: string; mentions: number };
type NeighborhoodCoverage = {
  start_date: string;
  through_date: string;
  indicators: { water: number; waste: number; rodentMentions?: number };
  rodentPeriods: RodentPeriod[] | null;
};

export function readNeighborhoodCoverage(source: pg.Pool | pg.Client, city: string, latitude: number, longitude: number) {
  return source.query<NeighborhoodCoverage>(`
    SELECT c.start_date::text, c.through_date::text, stats.indicators,
      CASE WHEN c.rodent_mentions AND c.through_date-c.start_date >= 59 THEN jsonb_build_array(
        jsonb_build_object('start_date',(c.through_date-29)::text,'through_date',c.through_date::text,'mentions',stats.recent),
        jsonb_build_object('start_date',(c.through_date-59)::text,'through_date',(c.through_date-30)::text,'mentions',stats.prior)
      ) END AS "rodentPeriods"
    FROM neighborhood_coverage c
    CROSS JOIN LATERAL (
      SELECT jsonb_build_object('water',count(*) FILTER(WHERE r.kind='water'), 'waste',count(*) FILTER(WHERE r.kind='waste')) ||
        CASE WHEN c.rodent_mentions THEN jsonb_build_object('rodentMentions',count(*) FILTER(WHERE r.kind='rodent_mention'))
          ELSE '{}'::jsonb END AS indicators,
        count(*) FILTER(WHERE r.kind='rodent_mention' AND r.observed_on>=c.through_date-29) AS recent,
        count(*) FILTER(WHERE r.kind='rodent_mention' AND r.observed_on BETWEEN c.through_date-59 AND c.through_date-30) AS prior
      FROM neighborhood_events r
      WHERE r.city=c.city AND r.observed_on BETWEEN c.start_date AND c.through_date
        AND power((r.latitude-$2)*111.2,2)+power((r.longitude-$3)*111.2*cos(radians($2)),2)<=1
    ) stats WHERE c.city=$1`, [city, latitude, longitude]);
}

export async function readNeighborhoodHistory(source: pg.Pool | pg.Client, latitude: number, longitude: number, timescale: boolean) {
  const bucket = timescale ? "time_bucket('1 hour', observed_at)" : "date_trunc('hour', observed_at, 'UTC')";
  const { rows: history } = await source.query<{ time: Date; temperatureF: number; feelsLikeF: number; humidity: number }>(`
    SELECT ${bucket} AS time, round(avg(temperature_f)) AS "temperatureF",
      round(avg(feels_like_f)) AS "feelsLikeF", round(avg(humidity)) AS humidity
    FROM neighborhood_samples WHERE latitude=$1 AND longitude=$2
      AND observed_at >= date_trunc('hour', now(), 'UTC') - interval '23 hours' AND observed_at <= now()
    GROUP BY 1 ORDER BY 1`, [latitude, longitude]);
  const feelsLike = history.map((row) => row.feelsLikeF);
  const humidity = history.map((row) => row.humidity);
  return {
    history,
    observations: history.length ? {
      hours: history.length,
      lowFeelsLikeF: Math.min(...feelsLike), highFeelsLikeF: Math.max(...feelsLike),
      lowHumidity: Math.min(...humidity), highHumidity: Math.max(...humidity),
    } : undefined,
  };
}

export function startAreaWorker(db: pg.Pool, config: Config) {
  const tiger = config.tigerDatabaseUrl ? new pg.Pool({ connectionString: config.tigerDatabaseUrl, connectionTimeoutMillis: 3500, max: 2 }) : undefined;
  tiger?.on('error', () => console.warn('TigerData connection interrupted'));
  let task: Promise<void> | undefined;
  let models: z.infer<typeof modelSchema>[] = [];
  let localPrepared = false;
  let tigerCoverageReady = false;
  let tigerHistoryReady = false;
  const loadModel = readFile('backend/config/heat-models.json', 'utf8')
    .then((contents) => { models = z.array(modelSchema).parse(JSON.parse(contents)); }).catch(() => {});
  let ticker: ReturnType<typeof setInterval>;

  async function cache() {
    const row = (await db.query<{ order_id: string; address: string }>(`SELECT order_id, address FROM repair_contexts
      WHERE updated_at IS NULL OR updated_at < now() - interval '30 minutes' ORDER BY updated_at NULLS FIRST LIMIT 1`)).rows[0];
    if (!row) return;
    const query = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    query.search = new URLSearchParams({ address: row.address.replace(/^(\d+)-\d+/, '$1'), benchmark: 'Public_AR_Current', format: 'json' }).toString();
    try {
      const address = geocodeSchema.parse(await json(query)).result.addressMatches[0];
      if (!address) {
        await db.query('UPDATE repair_contexts SET area=$2,updated_at=now() WHERE order_id=$1', [row.order_id, { error: 'This address could not be mapped.' }]);
        return;
      }
      const latitude = Math.round(address.coordinates.y * 1000) / 1000;
      const longitude = Math.round(address.coordinates.x * 1000) / 1000;
      const city = address.addressComponents.city?.toUpperCase() ?? '';
      const forecast = new URL('https://api.open-meteo.com/v1/forecast');
      forecast.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), temperature_unit: 'fahrenheit',
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature', hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature',
        daily: 'apparent_temperature_max', forecast_days: '3', past_days: '1', timezone: 'auto' }).toString();
      const weather = await json(forecast).then((value) => weatherSchema.parse(value)).catch(() => undefined);
      let store = db;
      if (!localPrepared) {
        await db.query(areaSchema);
        localPrepared = true;
      }
      if (tiger) {
        try {
          if (!tigerCoverageReady) {
            await tiger.query(areaSchema);
            tigerCoverageReady = true;
          }
          if (!tigerHistoryReady) {
            await tiger.query("SELECT create_hypertable('neighborhood_samples', by_range('observed_at'), if_not_exists=>true, migrate_data=>true)");
            tigerHistoryReady = true;
          }
          store = tiger;
        }
        catch { console.warn('TigerData unavailable; using local PostgreSQL for neighborhood samples'); }
      }
      if (weather) {
        const hour = DateTime.fromISO(weather.current.time, { zone: weather.timezone }).startOf('hour');
        const samples = weather.hourly.time.flatMap((time, i) => {
          const instant = DateTime.fromISO(time, { zone: weather.timezone });
          const humidity = weather.hourly.relative_humidity_2m[i];
          const feels = weather.hourly.apparent_temperature[i];
          const actual = weather.hourly.temperature_2m[i];
          if (!instant.isValid || instant >= hour || instant < hour.minus({ hours: 24 }) || actual == null || feels == null || humidity == null) return [];
          return [[instant.toUTC().toISO(), actual, feels, humidity]];
        });
        const currentTime = hour.toUTC().toISO();
        if (currentTime) samples.push([currentTime, weather.current.temperature_2m, weather.current.apparent_temperature, weather.current.relative_humidity_2m]);
        const writeSamples = (source: pg.Pool) => source.query(`INSERT INTO neighborhood_samples
          SELECT (s->>0)::timestamptz,$1,$2,(s->>1)::float8,(s->>2)::float8,(s->>3)::float8
          FROM jsonb_array_elements($3::jsonb) s ON CONFLICT DO NOTHING`, [latitude, longitude, JSON.stringify(samples)]);
        try { await writeSamples(store); }
        catch (error) {
          if (store === db) throw error;
          store = db;
          await writeSamples(store);
        }
      }
      const readHistory = (source: pg.Pool) =>
        readNeighborhoodHistory(source, latitude, longitude, source === tiger).catch(() => undefined);
      let history = await readHistory(store);
      if (!history?.observations && store !== db) {
        store = db;
        history = await readHistory(store);
      }

      const readCoverage = async (source: pg.Pool) => {
        const result = await readNeighborhoodCoverage(source, city, latitude, longitude).catch(() => undefined);
        const record = result?.rows[0];
        return record && { ...record, rodentPeriods: record.rodentPeriods ?? undefined,
          store: source === tiger ? 'TimescaleDB' : 'Local PostgreSQL' };
      };
      const coverage = (tiger && tigerCoverageReady ? await readCoverage(tiger) : undefined)
        ?? await readCoverage(db)
        ?? (city === 'LOS ANGELES' ? await losAngelesIndicators(latitude, longitude)
          .then((record) => record && { ...record, store: 'City 311' }).catch(() => undefined) : undefined);
      await loadModel;
      const model = models.find((candidate) => candidate.city.toUpperCase() === city);
      const modelDay = weather?.current.time.slice(0, 10);
      const heat = model && modelDay ? (() => {
        const day = Date.parse(modelDay) / 86400000 - Date.UTC(+modelDay.slice(0, 4), 0, 1) / 86400000;
        const a = day * Math.PI * 2 / 365.25;
        const [intercept, sin, cos, sin2, cos2] = model.coefficients;
        return { typicalHighF: Math.round(intercept + sin * Math.sin(a) + cos * Math.cos(a) + sin2 * Math.sin(2 * a) + cos2 * Math.cos(2 * a)),
          validationMaeF: model.holdoutMae, trainedThrough: model.trainedThrough, samples: model.samples };
      })() : undefined;
      const currentWeather = weather && { current: weather.current, daily: {
        time: weather.daily.time.slice(-3), apparent_temperature_max: weather.daily.apparent_temperature_max.slice(-3),
      } };
      await db.query('UPDATE repair_contexts SET area=$2,updated_at=now() WHERE order_id=$1', [row.order_id,
        { latitude, longitude, city, timeZone: weather?.timezone, weather: currentWeather, coverage, heat, ...history,
          store: history?.observations ? (store === tiger ? 'TimescaleDB' : 'Local PostgreSQL') : undefined }]);
    } catch {
      await db.query('UPDATE repair_contexts SET updated_at=now() WHERE order_id=$1', [row.order_id]);
      console.warn('Could not refresh the work order neighborhood context');
    }
  }

  ticker = setInterval(() => {
    if (!task) task = cache().then(() => queueAreaNotices(db, config))
      .catch(() => console.warn('Could not check area jobs')).finally(() => { task = undefined; });
  }, 2500);
  return async () => { clearInterval(ticker); await task; await tiger?.end(); };
}
