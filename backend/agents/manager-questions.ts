import { z } from 'zod';
import type { Config } from '../config.js';
import { listOpenOrders, orderDetail, type Db } from './orders.js';

const areaSchema = z.object({
  weather: z.object({
    current: z.object({ time: z.string(), apparent_temperature: z.number() }),
  }).optional(),
  coverage: z.object({
    start_date: z.string(),
    through_date: z.string(),
    indicators: z.object({ water: z.number(), waste: z.number() }),
  }).optional(),
});

export async function managerOrderContext(db: Db, cfg: Config, id: string) {
  const { rows: [row] } = await db.query<{ property_match: boolean; area: unknown }>(`
    SELECT COALESCE(c.property_match,true) AS property_match, c.area
    FROM work_orders w LEFT JOIN repair_contexts c ON c.order_id=w.id
    WHERE w.id=$1 AND w.property_id=$2`, [id, cfg.property.id]);
  if (!row) return;
  return {
    area: areaSchema.safeParse(row.area).data,
    property: row.property_match ? {
      address: cfg.property.address,
      costar: cfg.property.costar,
      matterport: !!cfg.property.matterportModel,
      vexcel: !!(cfg.property.roof.imageUrl || cfg.property.roof.imageFile),
      captureDate: cfg.property.roof.captureDate,
    } : undefined,
  };
}

const stateLabels: Record<string, string> = {
  open: 'open', scheduled: 'scheduled',
  awaiting_confirmation: 'waiting for tenant confirmation', closed: 'closed',
};
const replyOptions = 'Ask for an order’s status, visit time, photo or area conditions. Include its L-number.';

/** Safe answers even when the scheduler model is unavailable. */
export async function answerManagerQuestion(db: Db, cfg: Config, message: string) {
  if (/\b(?:reschedul\w*|mov\w* the (?:visit|inspection))\b/i.test(message)) {
    return 'Moving a visit requires at least 72 hours before the scheduled start. Send the L-number and a new window, then reply YES to confirm.';
  }
  const ids = [...new Set([...message.matchAll(/\bL-([1-9]\d{0,12})\b/gi)].map((match) => match[1]))];
  if (ids.length > 1) return 'Which work order should I check? Send one L-number.';
  let id = ids[0];
  if (!id) {
    const orders = await listOpenOrders(db, cfg);
    if (!orders.length) return `There are no open orders assigned to this property. ${replyOptions}`;
    if (orders.length > 1 || /\b(?:all|list|orders|tickets|repairs)\b/i.test(message)) {
      return [`Open work orders here${orders.length > 5 ? ' (latest five)' : ''}:`,
        ...orders.slice(0, 5).map((order) => `${order.code} · ${stateLabels[order.status]} · ${order.issue}`),
        'Reply with the L-number to see details.'].join('\n');
    }
    id = orders[0].code.slice(2);
  }

  const order = await orderDetail(db, cfg, id);
  if (!('code' in order)) return `I couldn’t find L-${id} for this property. Check the work-order number.`;
  const status = `${order.code} is ${stateLabels[order.status]}.`;
  const visit = order.inspection ? `Inspection: ${order.inspection}.` : 'No inspection is scheduled.';
  if (/\b(?:heat|weather|temperature|humidity|hot|rodents?|mice|mouse|rats?|pests?|neighbou?rhood|311|costar|matterport|vexcel|aerial|roof)\b/i.test(message)) {
    const context = await managerOrderContext(db, cfg, id);
    const property = context?.property;
    const weather = context?.area?.weather?.current;
    const coverage = context?.area?.coverage;
    if (/\b(?:costar|matterport|vexcel|aerial|roof)\b/i.test(message)) {
      if (!property) return `${order.code}: Property evidence is unavailable for the reported address.`;
      const costar = property.costar;
      return [
        `${order.code} · ${property.address}`,
        costar ? `CoStar: ${costar.buildingType ? `${costar.buildingType}, ` : ''}${costar.storiesAboveGrade} above-grade stories${costar.buildingAreaSqFt ? `, ${costar.buildingAreaSqFt.toLocaleString('en-US')} sq ft` : ''}.` : 'CoStar building details are unavailable.',
        property.matterport ? 'Matterport model attached.' : '',
        property.vexcel ? `Vexcel roof imagery attached${property.captureDate ? ` (${property.captureDate})` : ''}.` : '',
        'An on-site inspection is needed to verify the cause.',
      ].filter(Boolean).join('\n');
    }
    return [
      `${order.code} · ${order.address}`,
      weather ? `Outdoor feels-like temperature: ${Math.round(weather.apparent_temperature)}°F at ${weather.time.replace('T', ' ')} local.` : 'Outdoor weather is unavailable.',
      coverage ? `City 311 recorded ${coverage.indicators.water} water and ${coverage.indicators.waste} waste reports within 1 km (${coverage.start_date} to ${coverage.through_date}).` : 'Nearby 311 coverage is unavailable.',
      'A building inspection is needed to verify indoor conditions or signs of rodents.',
    ].join('\n');
  }
  if (/\b(?:address|location|room|where|photo|photos|picture|evidence|report|reported)\b/i.test(message)) {
    const locations = [...new Set(order.reports.map((report) => report.location))].slice(0, 3);
    const photos = order.reports.filter((report) => report.hasPhoto).length;
    return [status, `Property: ${order.address}`, locations.length ? `Reported area: ${locations.join(', ')}.` : '',
      `${photos} of ${order.reports.length} reports include a tenant photo.`, visit].filter(Boolean).join('\n');
  }
  return [status, visit, order.status === 'awaiting_confirmation'
    ? `${order.reports.filter((report) => report.confirmed).length} of ${order.reports.length} reporting tenants have confirmed.`
    : `${order.reports.length} tenant report${order.reports.length === 1 ? '' : 's'}.`].join('\n');
}
