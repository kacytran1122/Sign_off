import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { Config } from './config.js';
import { guidance, repairEffects, type Aid, type Issue } from './repair.js';
import { repairScenario } from './repair-scenario.js';
import { planRoofInspection } from './inspection.js';

const historySample = z.object({ time: z.string(), feelsLikeF: z.number() });
const reportArea = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  city: z.string().max(100).optional(),
  timeZone: z.string().max(80).optional(),
  error: z.string().max(200).optional(),
  store: z.enum(['TimescaleDB', 'Local PostgreSQL']).optional(),
  weather: z.object({
    current: z.object({ time: z.string(), temperature_2m: z.number(), apparent_temperature: z.number(), relative_humidity_2m: z.number() }),
    daily: z.object({ time: z.array(z.string()), apparent_temperature_max: z.array(z.number().nullable()) }).optional(),
  }).optional(),
  coverage: z.object({
    start_date: z.string(), through_date: z.string(),
    indicators: z.object({ water: z.number().int().nonnegative(), waste: z.number().int().nonnegative(), rodentMentions: z.number().int().nonnegative().optional() }),
  }).optional(),
  heat: z.object({ typicalHighF: z.number(), validationMaeF: z.number(), trainedThrough: z.string() }).optional(),
  history: z.array(historySample).max(25).optional(),
});

type ReportRow = {
  id: string; status: string; issue: Issue; aid: Aid; area: unknown; property_match: boolean;
  landmarkId?: string; description?: string; renderStatus?: string; image?: Buffer;
};

export function reportSnapshot(property: Config['property'], row: ReportRow) {
  const point = property.landmarks.find((landmark) => landmark.id === row.landmarkId);
  const scenario = repairScenario(row.issue, row.aid, row.description, row.property_match ? point?.label : undefined);
  const inspection = point && row.property_match && scenario === 'ceiling-leak' ? planRoofInspection(property, point, row.aid) : undefined;
  const area = reportArea.safeParse(row.area).data;
  if (area?.latitude !== undefined) area.latitude = Number(area.latitude.toFixed(3));
  if (area?.longitude !== undefined) area.longitude = Number(area.longitude.toFixed(3));
  const building = row.property_match && property.costar ? {
    ...property.costar,
    roomLabel: point?.label,
    roomEvidence: point?.roomEvidence,
    hasMatterport: !!property.matterportModel,
    hasVexcel: !!(property.roof.imageUrl || property.roof.imageFile),
    analysisDate: property.roof.analysisDate,
    captureDate: property.roof.captureDate,
    roofEvidence: property.roof.attributes.slice(0, 6).map(({ label, value }) => `${label} · ${value}`),
    inspectionSteps: inspection?.steps,
  } : undefined;
  return {
    id: row.id, status: row.status, issue: row.issue, aid: row.aid, scenario, guidance: guidance[row.aid],
    effects: repairEffects(row.issue, row.aid), area, building, renderStatus: row.renderStatus,
  };
}

export function startReportPublisher(db: Pool, config: Config) {
  if (!config.reportPublish) return;
  const { origin, token } = config.reportPublish;
  const evidenceVersion = createHash('sha256').update('report-v4:').update(JSON.stringify(config.property)).digest('hex');
  let active: Promise<void> | undefined;

  async function publish() {
    const client = await db.connect();
    let locked = false;
    try {
      const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(75820421) AS locked');
      locked = lock.rows[0].locked;
      if (locked) await publishNext(client);
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(75820421)');
        client.release();
      } catch { client.release(true); }
    }
  }

  async function publishNext(client: PoolClient) {
    const { rows: [row] } = await client.query<ReportRow & { key: string; revision: string }>(`
      SELECT w.id,w.access_key AS key,w.status,r.issue,r.aid,r.area,r.property_match,
        photo.landmark_id AS "landmarkId",photo.description,b.status AS "renderStatus",b.image,
        source.revision
      FROM work_orders w JOIN repair_contexts r ON w.id=r.order_id
      LEFT JOIN blender_renders b ON b.order_id=w.id AND b.aid IS NOT NULL
      LEFT JOIN report_publications p ON p.order_id=w.id
      LEFT JOIN LATERAL (SELECT landmark_id,description FROM reports WHERE order_id=w.id ORDER BY id LIMIT 1) photo ON true
      CROSS JOIN LATERAL (SELECT jsonb_build_array($2::text,w.status,r.updated_at,b.status,b.completed_at,b.attempts,r.issue,r.aid,md5(photo.description))::text AS revision) source
      WHERE w.property_id=$1 AND p.revision IS DISTINCT FROM source.revision
        AND (p.retry_after IS NULL OR p.retry_after<=now())
      ORDER BY w.created_at DESC LIMIT 1`, [config.property.id, evidenceVersion]);
    if (!row) return;
    try {
      const response = await fetch(`${origin}/internal/reports/${row.key}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...reportSnapshot(config.property, row),
          renderPng: row.renderStatus === 'ready' ? row.image?.toString('base64') : undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Report host returned ${response.status}`);
      await client.query(`INSERT INTO report_publications(order_id,revision) VALUES($1,$2)
        ON CONFLICT(order_id) DO UPDATE SET revision=EXCLUDED.revision,retry_after=NULL`, [row.id, row.revision]);
    } catch {
      await client.query(`INSERT INTO report_publications(order_id,retry_after) VALUES($1,now() + interval '30 seconds')
        ON CONFLICT(order_id) DO UPDATE SET retry_after=EXCLUDED.retry_after`, [row.id]);
      console.warn('The report host did not accept an update; will retry.');
    }
  }

  const timer = setInterval(() => {
    if (!active) active = publish().catch(() => console.warn('Could not check report publications')).finally(() => { active = undefined; });
  }, 2000);
  return async () => { clearInterval(timer); await active; };
}
