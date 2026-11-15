import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import pg from 'pg';
import { areaSchema } from '../area.js';

const path = process.argv[2];
const url = process.env.TIGER_DATABASE_URL || process.env.DATABASE_URL;
if (!path || !url) throw new Error('Pass the Houston 311 export and set DATABASE_URL or TIGER_DATABASE_URL.');
const rows: [string, string, string, number, number][] = [];
let through = '';
let start = '';
let seenHeader = false;
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!seenHeader) {
    through ||= /^Extract date-time: \[(\d{4}-\d\d-\d\d)/.exec(line)?.[1] ?? '';
    if (line.startsWith('365 Case Number|Case Number|Incident Address|Latitude|Longitude|')) {
      if (!through) throw new Error('The export does not include its extract date.');
      start = new Date(Date.parse(through) - 89 * 86400_000).toISOString().slice(0, 10);
      seenHeader = true;
    }
    continue;
  }
  const [ticket, , , lat, lon, , date, , , type] = line.split('|');
  const day = date?.slice(0, 10);
  if (!ticket || !day || day < start || day > through || !lat || !lon) continue;
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon) || +lat < 28 || +lat > 32 || +lon < -98 || +lon > -93) continue;
  const kind = /^(Water Leak|Sewer Wastewater|Storm Drainage)$/i.test(type) ? 'water'
    : /^(Missed Garbage Pickup|Illegal Dumping|Missed Heavy Trash Pickup)$/i.test(type) ? 'waste' : undefined;
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
  await db.query(`INSERT INTO neighborhood_coverage VALUES('HOUSTON',$1,$2)
    ON CONFLICT(city) DO UPDATE SET start_date=excluded.start_date, through_date=excluded.through_date`, [start, through]);
  await db.query('COMMIT');
  console.log(`Imported ${rows.length} Houston water and waste reports through ${through}.`);
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
