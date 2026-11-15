import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { areaSchema, readNeighborhoodCoverage, readNeighborhoodHistory } from '../../backend/area.js';
import { classifyHouston311 } from '../../backend/houston-311.js';

test('Houston 311 rodent mentions need an explicit label in a relevant case type', () => {
  assert.equal(classifyHouston311(' Health Code ', ' RAT Infestation '), 'rodent_mention');
  assert.equal(classifyHouston311('MultiFamily Habitability Violation', 'Mice'), 'rodent_mention');
  assert.equal(classifyHouston311('Weeds Trash Stagnant Water', 'Mouse Infestation'), 'rodent_mention');
  assert.equal(classifyHouston311('Street Maintenance', 'Mice'), undefined);
  assert.equal(classifyHouston311('Health Code', 'No evidence of mice'), undefined);
  assert.equal(classifyHouston311('Health Code', 'mice and ants'), undefined);
  assert.equal(classifyHouston311('Health Code', undefined), undefined);
  assert.equal(classifyHouston311('Illegal Dumping', 'Mice'), 'waste');
  assert.equal(classifyHouston311('Water Leak', undefined), 'water');
});

test('neighborhood readings and rodent mentions stay inside their respective windows', { timeout: 30_000 }, async (t) => {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert(address && typeof address !== 'string');
  const { port } = address;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const dir = await mkdtemp(join(tmpdir(), 'signoff-houston-311-'));
  const postgres = new EmbeddedPostgres({
    databaseDir: join(dir, 'db'), port, user: 'postgres', password: 'fixture',
    persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {},
  });
  const pool = new pg.Pool({ connectionString: `postgres://postgres:fixture@127.0.0.1:${port}/postgres` });
  let started = false;
  t.after(async () => {
    await pool.end();
    if (started) await postgres.stop();
    await rm(dir, { recursive: true, force: true });
  });
  await postgres.initialise();
  await postgres.start();
  started = true;
  await pool.query(`CREATE TABLE neighborhood_coverage (
    city text PRIMARY KEY, start_date date NOT NULL, through_date date NOT NULL
  )`);
  await pool.query("INSERT INTO neighborhood_coverage VALUES ('HOUSTON','2026-08-17','2026-11-14')");
  await pool.query(areaSchema);
  await pool.query(`INSERT INTO neighborhood_events VALUES
    ('HOUSTON','a','water','2026-10-15',29.76,-95.37),
    ('HOUSTON','b','waste','2026-10-15',29.76,-95.37),
    ('HOUSTON','c','rodent_mention','2026-10-15',29.76,-95.37),
    ('HOUSTON','c','rodent_mention','2026-10-15',29.76,-95.37),
    ('HOUSTON','d','rodent_mention','2026-10-15',29.86,-95.37),
    ('HOUSTON','e','rodent_mention','2026-08-15',29.76,-95.37),
    ('OTHER','f','rodent_mention','2026-10-15',29.76,-95.37),
    ('HOUSTON','g','rodent_mention','2026-10-16',29.76,-95.37),
    ('HOUSTON','h','rodent_mention','2026-11-14',29.76,-95.37),
    ('HOUSTON','i','rodent_mention','2026-09-15',29.76,-95.37)
    ON CONFLICT DO NOTHING`);
  const read = async (latitude = 29.76) =>
    (await readNeighborhoodCoverage(pool, 'HOUSTON', latitude, -95.37)).rows[0];
  assert.deepEqual((await read()).indicators, { water: 1, waste: 1 });
  assert.equal((await read()).rodentPeriods, null);
  await pool.query("UPDATE neighborhood_coverage SET rodent_mentions=true WHERE city='HOUSTON'");
  assert.deepEqual((await read()).indicators, { water: 1, waste: 1, rodentMentions: 4 });
  assert.deepEqual((await read()).rodentPeriods, [
    { start_date: '2026-10-16', through_date: '2026-11-14', mentions: 2 },
    { start_date: '2026-09-16', through_date: '2026-10-15', mentions: 1 },
  ]);
  const outside = await read(29.66);
  assert.deepEqual(outside.indicators, { water: 0, waste: 0, rodentMentions: 0 });
  assert.deepEqual(outside.rodentPeriods?.map(({ mentions }) => mentions), [0, 0]);
  await pool.query("UPDATE neighborhood_coverage SET start_date='2026-09-17' WHERE city='HOUSTON'");
  assert.equal((await read()).rodentPeriods, null);

  await pool.query(`INSERT INTO neighborhood_samples
    SELECT date_trunc('hour', now(), 'UTC') + offsets.delta, latitude, -95.37, actual, feels, humidity
    FROM (VALUES
      (interval '-24 hours', 29.76, 90, 99, 97),
      (interval '-23 hours', 29.76, 53, 50, 41),
      (interval '-23 hours' + interval '30 minutes', 29.76, 57, 52, 51),
      (interval '-1 hour', 29.76, 65, 69, 65),
      (interval '-1 hour', 29.77, 77, 77, 77),
      (interval '1 hour', 29.76, 90, 98, 95)
    ) AS offsets(delta, latitude, actual, feels, humidity)`);
  const history = await readNeighborhoodHistory(pool, 29.76, -95.37, false);
  assert.deepEqual(history.history.map(({ time: _time, ...reading }) => reading), [
    { temperatureF: 55, feelsLikeF: 51, humidity: 46 },
    { temperatureF: 65, feelsLikeF: 69, humidity: 65 },
  ]);
  assert.deepEqual(history.observations, { hours: 2, lowFeelsLikeF: 51, highFeelsLikeF: 69, lowHumidity: 46, highHumidity: 65 });
  assert.deepEqual(await readNeighborhoodHistory(pool, 29.75, -95.37, false), { history: [], observations: undefined });
});
