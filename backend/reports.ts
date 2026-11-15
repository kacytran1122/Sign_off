import type { Pool } from 'pg';
import type { Config } from './config.js';
import { z } from 'zod';
import { repairEffects, type Aid, type Issue } from './repair.js';

export function managerReport(report: {
  code: string; address: string; description: string; issue: Issue; aid: Aid;
  hasPhoto: boolean; demo: boolean; inspectionSummary?: string; photoReview?: string;
}) {
  const stair = report.aid === 'stair-sign';
  const title = stair ? 'Urgent inspection requested for a damaged stair' : report.issue === 'leak' ? 'Water leak inspection requested' : 'Building damage inspection requested';
  const action = stair
    ? 'Please inspect promptly, assess the tread and supporting structure, and arrange safe access for residents. Reply with an inspection window.'
    : report.issue === 'leak'
      ? 'Please trace and stop the source, assess the wet materials, and schedule drying or restoration as needed. Reply with an inspection window.'
      : 'Please inspect the affected area, document the findings and reply with an inspection window.';
  return [
    `${report.demo ? 'DEMO · ' : ''}Work order ${report.code} · ${title}`,
    `Property: ${report.address}`,
    `Tenant report: ${report.description.replace(/\s+/g, ' ').trim().slice(0, 360)}`,
    report.hasPhoto ? 'Evidence: Tenant image received. Site inspection pending.' : 'Evidence: Tenant description received. Site inspection pending.',
    report.photoReview && `Match the tenant photo in Matterport: ${report.photoReview}`,
    `Potential impact: ${repairEffects(report.issue, report.aid)}`,
    report.inspectionSummary ?? action,
    report.inspectionSummary && 'Reply with an inspection window.',
  ].filter(Boolean).join('\n');
}

const areaSchema = z.object({
  weather: z.object({
    current: z.object({ time: z.string(), temperature_2m: z.number(), relative_humidity_2m: z.number(), apparent_temperature: z.number() }),
    daily: z.object({ time: z.array(z.string()), apparent_temperature_max: z.array(z.number().nullable()) }).optional(),
  }).optional(),
  heat: z.object({ typicalHighF: z.number(), validationMaeF: z.number() }).optional(),
  history: z.array(z.object({ feelsLikeF: z.number() })).optional(),
  coverage: z.object({
    start_date: z.string(), through_date: z.string(),
    indicators: z.object({ water: z.number(), waste: z.number(), rodentMentions: z.number().int().nonnegative().optional() }),
  }).optional(),
});

export function tenantAreaReport(code: string, issue: Issue, aid: Aid, input: unknown, url: string) {
  const area = areaSchema.safeParse(input).data;
  const current = area?.weather?.current;
  const daily = area?.weather?.daily;
  const history = area?.history?.map((sample) => sample.feelsLikeF) ?? [];
  const forecast = daily?.time.flatMap((date, i) => {
    const high = daily.apparent_temperature_max[i];
    return high == null ? [] : [`${date.slice(5)} ${Math.round(high)}°F`];
  });
  const heat = area?.heat;
  const coverage = area?.coverage;
  return [
    `${code} · Neighborhood update`,
    current ? `Outdoor weather at ${current.time.replace('T', ' ')} local: ${Math.round(current.temperature_2m)}°F, feels like ${Math.round(current.apparent_temperature)}°F, humidity ${Math.round(current.relative_humidity_2m)}%.`
      : 'Outdoor weather is unavailable for this report.',
    history.length ? `Past 24 hours of available outdoor data: feels like ${Math.min(...history)}–${Math.max(...history)}°F.` : '',
    forecast?.length ? `Forecast feels-like highs: ${forecast.join(', ')}.` : '',
    heat ? `Typical seasonal high: ${heat.typicalHighF}°F feels like (model estimate; average validation error ${heat.validationMaeF.toFixed(1)}°F).` : '',
    'Indoor temperature and the cause of the damage still need to be checked on site.',
    coverage ? `Within 1 km, city 311 recorded ${coverage.indicators.water} water and ${coverage.indicators.waste} waste reports (${coverage.start_date} to ${coverage.through_date}).`
      : 'Nearby water and waste report counts are unavailable.',
    coverage?.indicators.rodentMentions !== undefined
      ? `Houston 311 includes ${coverage.indicators.rodentMentions} nearby reports that mention mice or rats in the same period.`
      : '',
    'The available data does not establish whether mice or rats are at the building. Tell maintenance if you see rodents, droppings or gnaw marks.',
    repairEffects(issue, aid),
    url,
  ].filter(Boolean).join('\n');
}

export function repairReportUrl(config: { reportShareOrigin?: string; baseUrl: string }, key: string) {
  return config.reportShareOrigin ? `${config.reportShareOrigin}/reports/${key}` : `${config.baseUrl}/reports/${key}`;
}

export async function queueAreaNotices(db: Pool, config: Pick<Config, 'reportShareOrigin' | 'baseUrl' | 'reportPublish'>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string; order_id: string; reporter: string; access_key: string; area: unknown; issue: Issue; aid: Aid;
    }>(`SELECT p.id, p.order_id, p.reporter, w.access_key, r.area, r.issue, r.aid
      FROM reports p JOIN repair_contexts r ON r.order_id=p.order_id JOIN work_orders w ON w.id=p.order_id
      WHERE p.area_notice_pending AND r.updated_at IS NOT NULL ORDER BY p.id LIMIT 5 FOR UPDATE OF p SKIP LOCKED`);
    for (const report of rows) {
      const body = tenantAreaReport(`L-${report.order_id}`, report.issue, report.aid, report.area, repairReportUrl(config, report.access_key));
      await client.query('INSERT INTO outbox(target, body, shared_order_id) VALUES($1,$2,$3)', [report.reporter, body, config.reportPublish ? report.order_id : null]);
      await client.query('UPDATE reports SET area_notice_pending=false WHERE id=$1', [report.id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
