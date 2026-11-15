import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { areaSchema, readNeighborhoodCoverage } from '../../backend/area.js';
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

test('previous imports omit rodent mentions, upgraded imports report distinct cases in range', { timeout: 30_000 }, async (t) => {
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
    ('OTHER','f','rodent_mention','2026-10-15',29.76,-95.37)
    ON CONFLICT DO NOTHING`);
  const read = async (latitude = 29.76) =>
    (await readNeighborhoodCoverage(pool, 'HOUSTON', latitude, -95.37)).rows[0].indicators;
  assert.deepEqual(await read(), { water: 1, waste: 1 });
  await pool.query("UPDATE neighborhood_coverage SET rodent_mentions=true WHERE city='HOUSTON'");
  assert.deepEqual(await read(), { water: 1, waste: 1, rodentMentions: 1 });
  assert.deepEqual(await read(29.66), { water: 0, waste: 0, rodentMentions: 0 });
});
