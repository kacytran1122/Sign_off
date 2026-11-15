import type { PoolClient } from 'pg';
import { planRoofInspection } from './inspection.js';
import { photoReviewUrl } from './damage-point.js';
import { identifyLeak } from './ai.js';
import { normalizeHandle, type Config, type Landmark } from './config.js';
import { tenantPhotoWindowSeconds, type Message, type Photo } from './photon.js';
import { formatVisit, looksLikeVisit, parseVisit, type Visit } from './schedule.js';
import { belongsToProperty, guidance, repairTimeZone, reportAddress, safeAid, suggestPropertyAddress, tenantLeakGuide, type Aid, type Issue, type LeakGuideImage } from './repair.js';
import { managerReport, managerWorkOrderLink, managerWorkspaceUrl, repairReportUrl } from './reports.js';
import { runIntake, type IntakeResult } from './agents/intake.js';
import { warnAgentFailure, type Model } from './agents/runtime.js';
import type { ManagerPlan } from './agents/scheduler.js';
import { enqueueAgentTask, recordAgentTrace } from './agents/tasks.js';

type AgentReport = Extract<IntakeResult, { kind: 'report' }>;

type Pending = {
  text?: string;
  messageId?: string;
  photo?: { base64: string; type: string };
  choices?: string[];
  agentReport?: AgentReport;
  proposedVisit?: Visit;
  /** Set when the scheduler agent proposed marking orderId repaired; YES carries it out. */
  proposedFix?: boolean;
  orderId?: string;
  photoOrderId?: string;
  address?: string;
  addressConfirmed?: boolean;
  addressReview?: { candidate?: string; interpreted: Interpretation['interpreted'] };
};
type Order = { id: string; status: string; access_key: string; inspection_key: string };
type Conversation = { active_order: string | null; pending: Pending };
type Repair = { address: string; propertyMatch: boolean; issue: Issue; aid: Aid };
const code = (id: string) => `L-${id}`;
export const photoOrderReply = /^(?:photo\s+)?L-([1-9]\d{0,12})$/i;
const rescheduleNoticeMs = 72 * 60 * 60 * 1000;

export function canRescheduleInspection(visitStart: Date | null, now: number) {
  return visitStart !== null && visitStart.getTime() - now >= rescheduleNoticeMs;
}

export async function notify(db: PoolClient, target: string, body: string, sharedOrderId?: string, guideImage?: LeakGuideImage) {
  const { rows: [message] } = await db.query<{ id: string }>(
    'INSERT INTO outbox (target, body, shared_order_id) VALUES ($1, $2, $3) RETURNING id', [target, body, sharedOrderId ?? null]);
  if (guideImage) await db.query("INSERT INTO outbox (target, body, guide_image, guide_for) VALUES ($1, '', $2, $3)",
    [target, guideImage, message.id]);
}
export async function record(db: PoolClient, id: string, action: string, detail: string) {
  await db.query('INSERT INTO work_order_events (order_id, action, detail) VALUES ($1, $2, $3)', [id, action, detail]);
}
export async function remindManager(db: PoolClient, cfg: Config, order: { id: string; access_key: string }, lead?: string) {
  await record(db, order.id, 'reminder', 'Sent the manager a reminder to schedule the inspection.');
  const link = await managerWorkOrderLink(db, cfg, order);
  await notify(db, cfg.manager, [lead ?? `Reminder: ${code(order.id)} is waiting for an inspection window.`, link].filter(Boolean).join("\n"));
}

const confirmReply = /^(yes|confirm)(?:\s+L-\d+)?[.!]?$/i;
const fixedReply = /^(fixed|marked fixed|the leak is fixed|repaired)(?:\s+L-\d+)?[.!]?$/i;
/** Exact manager commands skip the scheduler agent and run deterministically. */
export function isManagerCommand(text: string) {
  return /^start[.!]?$/i.test(text) || confirmReply.test(text) || fixedReply.test(text) || looksLikeVisit(text);
}
async function savePending(db: PoolClient, handle: string, pending: Pending, order?: string) {
  await db.query('UPDATE conversations SET pending = $2, active_order = COALESCE($3,active_order) WHERE handle = $1',
    [handle, JSON.stringify(pending), order ?? null]);
}
async function reporters(db: PoolClient, id: string): Promise<string[]> {
  const { rows } = await db.query<{ reporter: string }>('SELECT DISTINCT reporter FROM reports WHERE order_id = $1', [id]);
  return rows.map((row) => row.reporter);
}

async function queueManagerPhoto(db: PoolClient, manager: string, reportId: string) {
  await db.query("INSERT INTO outbox(target,body,photo_report_id,created_at) VALUES($1,'',$2,clock_timestamp())",
    [manager, reportId]);
}

async function addReportPhoto(db: PoolClient, cfg: Config, tenant: string, orderId: string, photo: Photo, explicit: boolean) {
  const { rows: [report] } = await db.query<{ id: string; landmark_id: string }>(`
    UPDATE reports SET photo=$3, photo_type=$4
    WHERE photo IS NULL AND id=(SELECT r.id FROM reports r JOIN work_orders w ON w.id=r.order_id
      WHERE r.order_id=$1 AND r.reporter=$2 AND r.photo IS NULL AND w.status IN ('open','scheduled')
        AND w.property_id=$6 AND ($5 OR r.created_at > now() - $7 * interval '1 second') ORDER BY r.id DESC LIMIT 1)
    RETURNING id, landmark_id
  `, [orderId, tenant, photo.bytes, photo.type, explicit, cfg.property.id, tenantPhotoWindowSeconds]);
  if (!report) return false;
  await record(db, orderId, 'photo_added', 'Tenant added a photo to the report.');
  const { rows: [order] } = await db.query<Order>(`SELECT w.access_key,w.inspection_key FROM work_orders w
    LEFT JOIN repair_contexts r ON w.id=r.order_id WHERE w.id=$1 AND COALESCE(r.property_match,true)`, [orderId]);
  const review = order && photoReviewUrl(cfg, order, report.landmark_id);
  await notify(db, cfg.manager, `${code(orderId)} · The tenant added this photo to the report.${review ? `\nMatch its location in Matterport: ${review}` : ''}`);
  await queueManagerPhoto(db, cfg.manager, report.id);
  await notify(db, tenant, `I attached the photo to ${code(orderId)}.`);
  return true;
}

/** Returns the work-order id when this call filed a new report. */
async function openReport(db: PoolClient, cfg: Config, handle: string, pending: Pending, point: Landmark, description: string, repair?: Repair): Promise<string | undefined> {
  const related = await db.query<Order>(`
    SELECT w.id, w.status, w.access_key, w.inspection_key FROM work_orders w LEFT JOIN repair_contexts r ON r.order_id=w.id
    WHERE w.property_id = $1 AND w.zone_id = $2 AND w.status IN ('open', 'scheduled')
      AND w.created_at >= now() - interval '48 hours'
      AND ($3::text IS NULL OR (lower(r.address)=lower($3) AND r.issue=$4 AND r.aid=$5))
    ORDER BY w.id DESC LIMIT 1 FOR UPDATE OF w
  `, [cfg.property.id, point.zoneId, repair?.address ?? null, repair?.issue ?? null, repair?.aid ?? null]);
  const order = related.rows[0] ?? (await db.query<Order>(`
    INSERT INTO work_orders (property_id, zone_id, status, next_nudge_at)
    VALUES ($1, $2, 'open', now() + $3 * interval '1 second')
    RETURNING id, status, access_key, inspection_key
  `, [cfg.property.id, point.zoneId, cfg.nudgeSeconds])).rows[0];
  const { rows: [report] } = await db.query<{ id: string }>(`INSERT INTO reports (order_id, message_id, reporter, landmark_id, description, photo, photo_type, area_notice_pending)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [
    order.id, pending.messageId, handle, point.id, description,
    pending.photo ? Buffer.from(pending.photo.base64, 'base64') : null, pending.photo?.type ?? null, !!repair,
  ]);
  if (repair) await db.query(`INSERT INTO repair_contexts(order_id,address,property_match,issue,aid) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(order_id) DO NOTHING`, [order.id, repair.address, repair.propertyMatch, repair.issue, repair.aid]);
  const area = repair && !repair.propertyMatch ? repair.address : cfg.sponsorRehearsal ? point.suite : `Suite ${point.suite}`;
  await record(db, order.id, related.rowCount ? 'report_linked' : 'opened',
    `${area} · ${point.label}${related.rowCount ? ' · Possible shared source' : ''}`);
  const inspection = (!repair || (repair.propertyMatch && repair.issue === 'leak'))
    ? planRoofInspection(cfg.property, point, repair?.aid) : undefined;
  if (inspection && !related.rowCount) await record(db, order.id, 'inspection_planned', inspection.summary);
  if (cfg.agentMode) await enqueueAgentTask(db, 'evidence', order.id);
  const evidenceUrl = repairReportUrl(cfg, order.access_key);
  if (cfg.blenderRenderer) {
    const room = point.label.toLowerCase().split(' ')[0];
    const subject = room === 'lobby' || room === 'warehouse' ? room : 'inspection';
    await db.query('INSERT INTO blender_renders (order_id, subject, aid) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [order.id, subject, repair?.aid ?? null]);
  }
  await savePending(db, handle, {}, order.id);
  const guide = repair?.issue === 'leak' ? tenantLeakGuide(`${pending.text ?? ''}\n${description}`, repair.aid) : undefined;
  if (repair) {
    await notify(db, handle, `${code(order.id)} logged. ${description.slice(0, 110)}\n${guide?.text ?? guidance[repair.aid]}${cfg.reportPublish ? '' : `\n${evidenceUrl}`}`,
      undefined, guide?.image);
  } else {
    await notify(db, handle, `${code(order.id)} is with your property manager. I’ll text you when there’s an inspection time.`);
  }
  if (order.status === 'scheduled') {
    const { rows } = await db.query<{ visit_start: Date; visit_end: Date }>('SELECT visit_start, visit_end FROM work_orders WHERE id=$1', [order.id]);
    const visit = { start: rows[0].visit_start.toISOString(), end: rows[0].visit_end.toISOString() };
    await notify(db, handle, `${code(order.id)} inspection: ${formatVisit(visit, repairTimeZone(repair?.address, cfg.property.timeZone))}.`);
  }
  const photoReview = pending.photo && (!repair || repair.propertyMatch) ? photoReviewUrl(cfg, order, point.id) : undefined;
  if (repair) {
    if (cfg.reportPublish) await notify(db, handle, `${code(order.id)} · Full repair report: ${evidenceUrl}`, order.id);
    await notify(db, cfg.manager, managerReport({
      code: code(order.id), address: repair.address, description, issue: repair.issue, aid: repair.aid,
      hasPhoto: !!pending.photo, photoReview, inspectionSummary: inspection?.summary,
    }));
    if (pending.photo) await queueManagerPhoto(db, cfg.manager, report.id);
    if (cfg.reportPublish) await notify(db, cfg.manager, `${code(order.id)} · Shared repair report: ${evidenceUrl}`, order.id);
    if (cfg.blenderRenderer && repair.issue !== 'leak') {
      await db.query("INSERT INTO outbox(target,body,render_order_id,is_render) VALUES($1,'',$2,true)", [handle, order.id]);
    }
    return order.id;
  }
  const workspace = managerWorkspaceUrl(cfg, order.access_key);
  await notify(db, cfg.manager, [
    `${code(order.id)} · ${related.rowCount ? 'Related leak report' : 'New leak report'} · ${cfg.property.name}, ${cfg.sponsorRehearsal ? point.suite : `suite ${point.suite}`}`,
    inspection?.summary,
    photoReview && `Match the tenant photo in Matterport: ${photoReview}`,
    workspace && `Evidence: ${workspace}`,
    'Reply with an inspection window, e.g. “Tuesday 2 to 4 PM”.',
  ].filter(Boolean).join('\n'));
  if (pending.photo) await queueManagerPhoto(db, cfg.manager, report.id);
  return order.id;
}

async function tenantUpdate(db: PoolClient, cfg: Config, handle: string, id: string, reopen: boolean) {
  const { rows } = await db.query<Order & { issue: Issue | null }>(
    'SELECT w.*, r.issue FROM work_orders w LEFT JOIN repair_contexts r ON r.order_id=w.id WHERE w.id=$1 FOR UPDATE OF w', [id]);
  const order = rows[0];
  const report = await db.query('SELECT 1 FROM reports WHERE order_id=$1 AND reporter=$2', [id, handle]);
  if (!order || !report.rowCount || (reopen ? !['awaiting_confirmation', 'closed'].includes(order.status) : order.status !== 'awaiting_confirmation')) {
    return notify(db, handle, `There’s no repair awaiting that reply for ${code(id)}.`);
  }
  if (reopen) {
    await db.query(`UPDATE work_orders SET status='open', visit_start=NULL, visit_end=NULL,
      next_nudge_at=now() + $2 * interval '1 second' WHERE id=$1`, [id, cfg.nudgeSeconds]);
    await db.query('UPDATE reports SET confirmed_at=NULL WHERE order_id=$1', [id]);
    const detail = order.issue === 'damage' ? 'Tenant reported that the damage remains.' : 'Tenant reported that the leak is continuing.';
    await record(db, id, 'reopened', detail);
    const link = await managerWorkOrderLink(db, cfg, order);
    await notify(db, cfg.manager, [`${code(id)} reopened. ${detail}`, link].filter(Boolean).join("\n"));
    return notify(db, handle, `${code(id)} is open again. I’ve let your property manager know.`);
  }
  const updated = await db.query('UPDATE reports SET confirmed_at=now() WHERE order_id=$1 AND reporter=$2 AND confirmed_at IS NULL', [id, handle]);
  if (!updated.rowCount) return notify(db, handle, `Your confirmation for ${code(id)} is already recorded.`);
  await record(db, id, 'tenant_confirmed', 'A tenant confirmed the repair.');
  const remaining = await db.query('SELECT 1 FROM reports WHERE order_id=$1 AND confirmed_at IS NULL LIMIT 1', [id]);
  if (remaining.rowCount) return notify(db, handle, `Thanks. Your confirmation for ${code(id)} is recorded.`);
  await db.query("UPDATE work_orders SET status='closed' WHERE id=$1", [id]);
  await record(db, id, 'closed', 'All reporting tenants confirmed the repair.');
  for (const target of await reporters(db, id)) await notify(db, target, `${code(id)} is closed. Thanks for confirming the repair.`);
  return notify(db, cfg.manager, `${code(id)} is closed. All reporting tenants confirmed the repair.`);
}

async function managerReply(db: PoolClient, cfg: Config, handle: string, message: Message, conversation: Conversation) {
  const pending = conversation.pending;
  const explicit = /\bL-([1-9]\d{0,12})\b/i.exec(message.text)?.[1];
  const confirming = confirmReply.test(message.text);
  const fixed = fixedReply.test(message.text) ||
    (confirming && !!pending.proposedFix && (!explicit || explicit === pending.orderId));
  let id = explicit ?? (confirming ? pending.orderId : undefined);
  if (!id && (fixed || looksLikeVisit(message.text))) {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM work_orders WHERE property_id=$1 AND status IN ('open','scheduled') ORDER BY id DESC LIMIT 2",
      [cfg.property.id],
    );
    if (rows.length === 1) id = rows[0].id;
  }
  if (!id) return notify(db, handle, 'Include the ticket ID and an inspection window, e.g. “L-1 Tuesday 2 to 4 PM”, or reply “FIXED L-1”.');
  const { rows: [order] } = await db.query<Order & { address?: string; time_zone?: string; issue?: Issue; visit_start: Date | null; visit_end: Date | null }>(`SELECT w.*, r.address, r.issue, r.area->>'timeZone' AS time_zone
    FROM work_orders w LEFT JOIN repair_contexts r ON w.id=r.order_id WHERE w.id=$1 AND w.property_id=$2 FOR UPDATE OF w`, [id, cfg.property.id]);
  if (!order || !['open', 'scheduled'].includes(order.status)) {
    return notify(db, handle, `${code(id)} has no open repair to update.`);
  }
  const zone = repairTimeZone(order.address, cfg.property.timeZone, order.time_zone);
  if (fixed) {
    if (pending.orderId === id) await savePending(db, handle, {});
    await db.query("UPDATE work_orders SET status='awaiting_confirmation', next_nudge_at=NULL WHERE id=$1", [id]);
    await record(db, id, 'repair_reported', 'Manager reported a repair. Asking tenants to verify.');
    for (const tenant of await reporters(db, id)) {
      const unresolved = order.issue === 'damage' ? 'Still broken' : 'Still leaking';
      const tag = cfg.demo ? '' : '@signoff ';
      await notify(db, tenant, `Your manager marked ${code(id)} repaired. Reply “${tag}Resolved ${code(id)}” or “${tag}${unresolved} ${code(id)}”.`);
    }
    return notify(db, handle, `I asked the affected tenants to verify ${code(id)}.`);
  }
  const confirmation = confirming && pending.orderId === id ? pending.proposedVisit : undefined;
  const visit = confirmation ?? parseVisit(message.text, zone);
  if (!visit) return notify(db, handle, 'Send a window such as “Tuesday 2 to 4 PM”. For morning hours, include AM.');

  const now = Date.now();
  const rescheduling = order.status === 'scheduled';
  if (rescheduling && !canRescheduleInspection(order.visit_start, now)) {
    if (pending.orderId === id) await savePending(db, handle, {});
    return notify(db, handle, `Rescheduling ${code(id)} requires at least 72 hours before the scheduled start.`);
  }
  const label = formatVisit(visit, zone);
  if (rescheduling && order.visit_start?.getTime() === Date.parse(visit.start) &&
      order.visit_end?.getTime() === Date.parse(visit.end)) {
    if (pending.orderId === id) await savePending(db, handle, {});
    return notify(db, handle, `${code(id)} is already scheduled for ${label}.`);
  }
  if (!confirmation) {
    await savePending(db, handle, { orderId: id, proposedVisit: visit });
    return notify(db, handle, `${rescheduling ? 'Reschedule' : 'Schedule'} ${code(id)} for ${label}? Reply YES to confirm.`);
  }
  if (Date.parse(visit.start) <= now) {
    await savePending(db, handle, {});
    return notify(db, handle, 'That window has passed. Send a new inspection window.');
  }
  await db.query(`UPDATE work_orders SET status='scheduled', next_nudge_at=NULL, visit_start=$2, visit_end=$3 WHERE id=$1`,
    [id, visit.start, visit.end]);
  await record(db, id, 'scheduled', rescheduling ? `Rescheduled to ${label}` : label);
  await savePending(db, handle, {});
  const action = rescheduling ? 'Rescheduled' : 'Confirmed';
  for (const tenant of await reporters(db, id)) await notify(db, tenant, `${code(id)} inspection ${action.toLowerCase()} for ${label}.`);
  return notify(db, handle, `${action} ${code(id)} for ${label}. I texted the affected tenants.`);
}

const tenantStatusReply = /^(still leaking|still broken|resolved)(?:\s+L-([1-9]\d{0,12}))?[.!]?$/i;

type Interpretation = { interpreted: Awaited<ReturnType<typeof identifyLeak>>; agent?: IntakeResult };

/** Intake agent when enabled, otherwise (or on any agent failure) the single-call classifier. */
async function interpretReport(db: PoolClient, cfg: Config, handle: string, text: string,
  photo: Photo | undefined, landmarks: Landmark[], model?: Model): Promise<Interpretation> {
  if (model) {
    try {
      const agent = await runIntake({ db, cfg, model, handle, text, photo, landmarks });
      if (agent.kind === 'report') return { interpreted: agent.interpreted, agent };
      return { agent, interpreted: { isLeak: false, isDamage: false, description: text, landmark: undefined, visibleAddress: undefined, temporaryAid: undefined } };
    } catch (error) {
      warnAgentFailure('intake', error);
    }
  }
  return { interpreted: await identifyLeak(cfg, text, photo, landmarks) };
}

export async function prepareReport(db: PoolClient, cfg: Config, message: Message, photo?: Photo, model?: Model) {
  const handle = normalizeHandle(message.handle);
  const participant = cfg.participants.get(handle);
  if (participant?.role !== 'tenant') return;
  if (/^start[.!]?$/i.test(message.text) || tenantStatusReply.test(message.text)) return;
  if (!photo && ((message.attachmentId && !message.text) || photoOrderReply.test(message.text))) return;
  const landmarks = cfg.property.landmarks.filter((point) => point.suite === participant.suite);
  const { rows } = await db.query<{ pending: Pending }>('SELECT pending FROM conversations WHERE handle=$1', [handle]);
  const prior = rows[0]?.pending ?? {};
  const orderForPhoto = photoOrderReply.exec(message.text)?.[1] ?? (!message.text ? prior.photoOrderId : undefined);
  if (orderForPhoto && photo) return { orderPhoto: { orderId: orderForPhoto, photo } };
  const picked = prior.choices && /^\d+$/.test(message.text) ? prior.choices[Number(message.text) - 1] : undefined;
  const mergedPhoto = photo ?? (prior.photo && { bytes: Buffer.from(prior.photo.base64, 'base64'), type: prior.photo.type });
  const acceptedAddress = confirmReply.test(message.text) ? prior.addressReview?.candidate : undefined;
  const enteredAddress = reportAddress(message.text);
  // A separate photo supplements the same report and must preserve the typed address.
  const previousAddress = prior.addressReview
    ? (!message.text ? prior.address : undefined)
    : prior.address ?? reportAddress(prior.text ?? '');
  const address = acceptedAddress ?? enteredAddress ?? previousAddress;
  const text = [prior.text, picked || acceptedAddress ? '' : message.text].filter(Boolean).join('\n').slice(-2000);
  const pending: Pending = {
    text, messageId: prior.messageId ?? message.id, address,
    addressConfirmed: !!acceptedAddress || (!enteredAddress && !!previousAddress && prior.addressConfirmed) || undefined,
    photo: mergedPhoto && { base64: mergedPhoto.bytes.toString('base64'), type: mergedPhoto.type },
  };
  // Address and room replies keep the original assessment, unless there is a new photo.
  const locationOnly = !!picked && !photo;
  const reviewingAddress = !photo && prior.addressReview;
  const savedAgent = locationOnly || reviewingAddress ? prior.agentReport : undefined;
  const savedInterpretation = savedAgent?.interpreted ?? (reviewingAddress ? reviewingAddress.interpreted : undefined);
  const { interpreted, agent } = savedInterpretation ? { interpreted: savedInterpretation, agent: savedAgent }
    : await interpretReport(db, cfg, handle, text, mergedPhoto, landmarks, locationOnly ? undefined : model);
  if (agent?.kind === 'report') pending.agentReport = agent;
  return { pending, interpreted, agent, landmarks, point: landmarks.find((point) => point.id === picked) ?? interpreted.landmark };
}

type PreparedReport = Exclude<Awaited<ReturnType<typeof prepareReport>>, undefined | { orderPhoto: unknown }>;

async function fileReport(db: PoolClient, cfg: Config, handle: string, prepared: PreparedReport, point: Landmark, repair?: Repair) {
  const orderId = await openReport(db, cfg, handle, prepared.pending, point, prepared.interpreted.description, repair);
  const agent = prepared.agent;
  if (!orderId || agent?.kind !== 'report') return;
  const { severity, hazards } = agent.assessment;
  await record(db, orderId, 'agent_triage', `Severity ${severity}${hazards.length ? ` · hazards: ${hazards.join(', ')}` : ''}`);
  await recordAgentTrace(db, orderId, agent.trace);
}

export async function handleMessage(db: PoolClient, cfg: Config, message: Message,
  prepared: Awaited<ReturnType<typeof prepareReport>>, photonProject?: string, managerPlan?: ManagerPlan) {
  const handle = normalizeHandle(message.handle);
  const participant = cfg.participants.get(handle);
  if (!participant) return;
  const { rows } = await db.query<Conversation>(`
    INSERT INTO conversations (handle, space_id, agent_id, photon_project) VALUES ($1,$2,$3,$4)
    ON CONFLICT (handle) DO UPDATE SET space_id=EXCLUDED.space_id, agent_id=EXCLUDED.agent_id,
      photon_project=EXCLUDED.photon_project
    RETURNING active_order, pending
  `, [handle, message.space, message.agent, photonProject ?? null]);
  const conversation = rows[0];
  const tagReminder = photonProject ? ' Begin your reply with @signoff.' : '';
  if (/^start[.!]?$/i.test(message.text)) {
    return notify(db, handle, participant.role === 'tenant'
      ? (cfg.repairContext ? 'Send a photo, the street address and the room where you see the damage.' : 'Send a photo and tell me where you see the leak.') + tagReminder
      : 'You’re connected. I’ll text you about new work orders.');
  }
  if (participant.role === 'manager') {
    if (managerPlan?.kind === 'reply') return notify(db, handle, managerPlan.text);
    if (managerPlan) await recordAgentTrace(db, managerPlan.orderId, managerPlan.trace);
    if (managerPlan?.kind === 'fixed') {
      await savePending(db, handle, { orderId: managerPlan.orderId, proposedFix: true });
      return notify(db, handle, `Mark ${code(managerPlan.orderId)} repaired and ask the tenants to verify? Reply YES to confirm.`);
    }
    // A scheduling plan is an ordinary visit command, so managerReply re-validates it and asks for YES.
    return managerReply(db, cfg, handle, managerPlan ? { ...message, text: managerPlan.text } : message, conversation);
  }
  const update = tenantStatusReply.exec(message.text);
  if (update) {
    const id = update[2] ?? conversation.active_order;
    if (id) return tenantUpdate(db, cfg, handle, id, update[1].toLowerCase() !== 'resolved');
    return notify(db, handle, 'Include the work-order ID so I can find the repair.');
  }
  const requestedPhotoOrder = photoOrderReply.exec(message.text)?.[1];
  if (requestedPhotoOrder && !prepared) {
    await savePending(db, handle, { ...conversation.pending, photoOrderId: requestedPhotoOrder });
    return notify(db, handle, `Send the photo for ${code(requestedPhotoOrder)} now.`);
  }
  if (!prepared) return notify(db, handle, 'Send a JPG, PNG, or WebP under 4 MB, or describe the issue in a text.');
  if (prepared.orderPhoto) {
    const { orderId, photo } = prepared.orderPhoto;
    const { photoOrderId, ...remaining } = conversation.pending;
    if (photoOrderId) await savePending(db, handle, remaining);
    if (await addReportPhoto(db, cfg, handle, orderId, photo, true)) return;
    return notify(db, handle, `I couldn’t attach a photo to ${code(orderId)}. Check the work-order number or whether it already has a photo.`);
  }
  if (!message.text && !conversation.pending.messageId && prepared.pending.photo && conversation.active_order) {
    const { base64, type } = prepared.pending.photo;
    if (await addReportPhoto(db, cfg, handle, conversation.active_order, { bytes: Buffer.from(base64, 'base64'), type }, false)) return;
  }
  if (prepared.pending.messageId &&
      (await db.query('SELECT 1 FROM reports WHERE message_id=$1', [prepared.pending.messageId])).rowCount) return;
  if (prepared.agent?.kind === 'reply') {
    await savePending(db, handle, prepared.agent.awaitingDetails ? prepared.pending : {});
    return notify(db, handle, prepared.agent.message + (prepared.agent.awaitingDetails ? tagReminder : ''));
  }
  const { interpreted } = prepared;
  if (!interpreted.isLeak && !(cfg.repairContext && interpreted.isDamage)) {
    await savePending(db, handle, {});
    return notify(db, handle, cfg.repairContext ? 'What is broken, and where is it in the building?' : 'Tell me what water, staining, or dripping you noticed and where.');
  }
  let repair: Repair | undefined;
  if (cfg.repairContext) {
    const { address, addressConfirmed } = prepared.pending;
    const propertyMatch = !!address && belongsToProperty(address, cfg.property.address);
    if (!address || (!propertyMatch && !addressConfirmed)) {
      const visible = interpreted.visibleAddress ? reportAddress(interpreted.visibleAddress) : undefined;
      const suggested = address ? suggestPropertyAddress(address, cfg.property.address) : undefined;
      const candidate = suggested ?? address ?? visible;
      const reply = photonProject ? '@signoff YES' : 'YES';
      await savePending(db, handle, { ...prepared.pending, addressReview: { candidate, interpreted } });
      if (candidate) {
        const reading = suggested ? `Did you mean ${suggested}?`
          : address ? `I read ${address}.` : `I can read ${candidate} in the photo.`;
        return notify(db, handle, `${reading} Reply ${reply} if that’s correct, or send the full street address, city and state.`);
      }
      return notify(db, handle, 'Please confirm the full street address, city and state.' + tagReminder);
    }
    const issue = interpreted.isDamage ? 'damage' : 'leak';
    repair = { address, propertyMatch, issue, aid: safeAid(`${prepared.pending.text} ${interpreted.description}`, issue, interpreted.temporaryAid) };
    if (!propertyMatch) {
      const point = prepared.point ?? { id: 'reported-location', suite: participant.suite!, label: 'Reported area', zoneId: 'reported', aliases: [], views: [] };
      return fileReport(db, cfg, handle, prepared, point, repair);
    }
  }
  if (!prepared.point) {
    const { landmarks, pending } = prepared;
    await savePending(db, handle, { ...pending, choices: landmarks.map((point) => point.id) });
    return notify(db, handle, `Where do you see it? Reply with a number.${tagReminder}\n${landmarks.map((point, i) => `${i + 1}. ${point.label}`).join('\n')}`);
  }
  return fileReport(db, cfg, handle, prepared, prepared.point, repair);
}
