import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { Config } from '../config.js';
import { repairTimeZone, type Aid, type Issue } from '../repair.js';
import { formatVisit } from '../schedule.js';

/** Read-only order views shared by the scheduler, evidence and follow-up agents. */
export type Db = Pick<PoolClient, 'query'>;

const HOUR_MS = 3_600_000;
const TIMELINE_LIMIT = 20;

export const orderIdSchema = z.string().regex(/^(?:L-)?[1-9]\d{0,12}$/i).describe('Work-order code such as L-12');
export const orderNumber = (value: string) => value.replace(/^L-/i, '');

type OrderRow = {
  id: string; status: string; zone_id: string; created_at: Date; visit_start: Date | null; visit_end: Date | null;
  address: string | null; issue: Issue | null; aid: Aid | null; property_match: boolean | null; time_zone: string | null; reports: number;
};

const ORDER_SELECT = `SELECT w.id, w.status, w.zone_id, w.created_at, w.visit_start, w.visit_end,
  c.address, c.issue, c.aid, c.property_match, c.area->>'timeZone' AS time_zone,
  (SELECT count(*)::int FROM reports r WHERE r.order_id=w.id) AS reports
  FROM work_orders w LEFT JOIN repair_contexts c ON c.order_id=w.id`;

export function orderZone(cfg: Config, row: Pick<OrderRow, 'address' | 'time_zone'>) {
  return repairTimeZone(row.address ?? undefined, cfg.property.timeZone, row.time_zone ?? undefined);
}

function summarize(cfg: Config, row: OrderRow, now: number) {
  const visit = row.visit_start && row.visit_end
    ? formatVisit({ start: row.visit_start.toISOString(), end: row.visit_end.toISOString() }, orderZone(cfg, row)) : null;
  return {
    code: `L-${row.id}`, status: row.status, zone: row.zone_id, issue: row.issue ?? 'leak', precaution: row.aid,
    address: row.address ?? cfg.property.name, reports: row.reports, inspection: visit,
    hoursOpen: Math.round((now - row.created_at.getTime()) / HOUR_MS),
  };
}

export async function listOpenOrders(db: Db, cfg: Config, now = Date.now()) {
  const { rows } = await db.query<OrderRow>(`${ORDER_SELECT}
    WHERE w.property_id=$1 AND w.status IN ('open','scheduled','awaiting_confirmation') ORDER BY w.id DESC LIMIT 20`,
  [cfg.property.id]);
  return rows.map((row) => summarize(cfg, row, now));
}

export async function getOrderRow(db: Db, cfg: Config, id: string) {
  const { rows: [row] } = await db.query<OrderRow>(`${ORDER_SELECT} WHERE w.id=$1 AND w.property_id=$2`, [id, cfg.property.id]);
  return row;
}

export async function orderDetail(db: Db, cfg: Config, id: string, now = Date.now()) {
  const row = await getOrderRow(db, cfg, id);
  if (!row) return { error: `L-${id} was not found.` };
  const [reports, timeline] = await Promise.all([
    db.query<{ landmark_id: string; description: string; has_photo: boolean; created_at: Date; confirmed: boolean }>(
      `SELECT landmark_id, description, photo IS NOT NULL AS has_photo, created_at, confirmed_at IS NOT NULL AS confirmed
       FROM reports WHERE order_id=$1 ORDER BY id`, [id]),
    db.query<{ action: string; detail: string; created_at: Date }>(
      'SELECT action, detail, created_at FROM work_order_events WHERE order_id=$1 ORDER BY id DESC LIMIT $2', [id, TIMELINE_LIMIT]),
  ]);
  const label = (landmarkId: string) => cfg.property.landmarks.find((point) => point.id === landmarkId)?.label ?? 'Reported area';
  return {
    ...summarize(cfg, row, now),
    reports: reports.rows.map((report) => ({
      location: label(report.landmark_id), landmarkId: report.landmark_id, description: report.description,
      hasPhoto: report.has_photo, confirmed: report.confirmed, at: report.created_at.toISOString(),
    })),
    timeline: timeline.rows.reverse().map((event) => ({ action: event.action, detail: event.detail, at: event.created_at.toISOString() })),
  };
}
