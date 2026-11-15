import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import pg from 'pg';
import { areaSchema } from '../area.js';
import { classifyHouston311 } from '../houston-311.js';

const path = process.argv[2];
const url = process.env.TIGER_DATABASE_URL || process.env.DATABASE_URL;
if (!path || !url) throw new Error('Pass the Houston 311 export and set DATABASE_URL or TIGER_DATABASE_URL.');
const rows: [string, string, string, number, number][] = [];
let through = '';
let start = '';
let seenHeader = false;
let descriptionIndex = -1;
let columnCount = 0;
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!seenHeader) {
    through ||= /^Extract date-time: \[(\d{4}-\d\d-\d\d)/.exec(line)?.[1] ?? '';
    if (line.startsWith('365 Case Number|Case Number|Incident Address|Latitude|Longitude|')) {
      if (!through) throw new Error('The export does not include its extract date.');
      start = new Date(Date.parse(through) - 89 * 86400_000).toISOString().slice(0, 10);
      const columns = line.split('|');
      columnCount = columns.length;
      descriptionIndex = columns.indexOf('Description');
      seenHeader = true;
    }
    continue;
  }
  const columns = line.split('|');
  const [ticket, , , lat, lon, , date, , , type] = columns;
  const day = date?.slice(0, 10);
  if (!ticket || !day || day < start || day > through || !lat || !lon) continue;
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon) || +lat < 28 || +lat > 32 || +lon < -98 || +lon > -93) continue;
  const kind = classifyHouston311(type, columns.length === columnCount ? columns[descriptionIndex] : undefined);
  if (kind) rows.push([ticket, kind, day, +lat, +lon]);
}
if (!seenHeader || rows.length < 100) throw new Error('The 311 snapshot is incomplete or the schema changed.');
const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 4000 });
await db.connect();
try {
  await db.query(areaSchema);
  await db.query('BEGIN');
  await db.query("DELETE FROM neighborhood_events WHERE city='HOUSTON'");
  for (let i = 0; i < rows.length; i += 1000) {
    await db.query(`INSERT INTO neighborhood_events(city,ticket,kind,observed_on,latitude,longitude)
      SELECT 'HOUSTON', v->>0, v->>1, (v->>2)::date, (v->>3)::float8, (v->>4)::float8
      FROM jsonb_array_elements($1::jsonb) v ON CONFLICT DO NOTHING`, [JSON.stringify(rows.slice(i, i + 1000))]);
  }
  await db.query(`INSERT INTO neighborhood_coverage(city,start_date,through_date,rodent_mentions)
    VALUES('HOUSTON',$1,$2,$3) ON CONFLICT(city) DO UPDATE SET start_date=excluded.start_date,
      through_date=excluded.through_date, rodent_mentions=excluded.rodent_mentions`, [start, through, descriptionIndex >= 0]);
  const counts = await db.query<{ kind: string; count: number }>(
    "SELECT kind, count(*)::int AS count FROM neighborhood_events WHERE city='HOUSTON' GROUP BY kind ORDER BY kind",
  );
  await db.query('COMMIT');
  console.log(JSON.stringify({ city: 'Houston', start, through, rodentMentionCoverage: descriptionIndex >= 0,
    counts: Object.fromEntries(counts.rows.map(({ kind, count }) => [kind, count])) }));
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
