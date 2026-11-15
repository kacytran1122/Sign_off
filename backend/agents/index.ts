import type { PoolClient } from 'pg';
import { normalizeHandle, type Config } from '../config.js';
import type { Message } from '../photon.js';
import { isManagerCommand, notify, record, remindManager } from '../workflow.js';
import { runEvidence } from './evidence.js';
import { runFollowUp, type FollowUp } from './followup.js';
import { openAiModel } from './openai-model.js';
import { plainText, warnAgentFailure, type Model } from './runtime.js';
import { planManagerMessage, type ManagerPlan } from './scheduler.js';
import { recordAgentTrace } from './tasks.js';

/**
 * Orchestrator. Agents run outside database transactions and only propose decisions;
 * every write happens here or in workflow.ts inside a short transaction that rechecks state.
 */
export type Agents = { model: Model };

const TASK_RETRY_SECONDS = 60;
const MAX_TASK_ATTEMPTS = 3;
// One model-driven follow-up per tick keeps outbound texts from waiting behind slow model calls.
const FOLLOWUPS_PER_TICK = 1;
const FOLLOWUP_LEASE_SECONDS = 600;
const MAX_REMINDERS = 3;

export function createAgents(cfg: Config, env = process.env): Agents | undefined {
  if (!cfg.agentMode) return;
  return { model: openAiModel(env.OPENAI_MODEL!) };
}

async function inTransaction<T>(db: PoolClient, work: () => Promise<T>) {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** Scheduler agent: only free-form manager texts. Exact commands keep the fast deterministic path. */
export async function planManager(db: PoolClient, cfg: Config, agents: Agents | undefined, message: Message): Promise<ManagerPlan | undefined> {
  if (!agents || cfg.participants.get(normalizeHandle(message.handle))?.role !== 'manager' || isManagerCommand(message.text)) return;
  try {
    return await planManagerMessage(db, cfg, agents.model, message.text);
  } catch (error) {
    warnAgentFailure('scheduler', error);
  }
}

/** Evidence agent: picks up one due hand-off for this property. */
export async function runAgentTasks(db: PoolClient, cfg: Config, agents: Agents) {
  const { rows: [task] } = await db.query<{ id: string; order_id: string; attempts: number; status: string }>(`
    UPDATE agent_tasks AS task
    SET attempts=LEAST(task.attempts + 1, $3), run_after=now() + $1 * interval '1 second',
        status=CASE WHEN task.attempts >= $3 THEN 'failed' ELSE 'queued' END
    WHERE task.id=(
      SELECT queued.id FROM agent_tasks AS queued JOIN work_orders AS w ON w.id=queued.order_id
      WHERE w.property_id=$2 AND queued.agent='evidence' AND queued.status='queued' AND queued.run_after<=now()
      ORDER BY queued.id LIMIT 1 FOR UPDATE OF queued SKIP LOCKED
    )
    RETURNING task.id, task.order_id, task.attempts, task.status`,
    [TASK_RETRY_SECONDS, cfg.property.id, MAX_TASK_ATTEMPTS]);
  if (!task || task.status === 'failed') return;
  try {
    const result = await runEvidence(db, cfg, agents.model, task.order_id);
    await inTransaction(db, async () => {
      const order = await db.query('SELECT id FROM work_orders WHERE id=$1 AND property_id=$2 FOR UPDATE',
        [task.order_id, cfg.property.id]);
      if (!order.rowCount) return;
      // A later attempt supersedes this result. Only the current claim can publish it.
      const completed = await db.query(`UPDATE agent_tasks SET status='done'
        WHERE id=$1 AND order_id=$2 AND status='queued' AND attempts=$3`, [task.id, task.order_id, task.attempts]);
      if (!completed.rowCount) return;
      await recordAgentTrace(db, task.order_id, result.trace);
      await record(db, task.order_id, 'agent_brief', plainText(result.brief));
      if (result.managerNote) await notify(db, cfg.manager, `L-${task.order_id} · ${plainText(result.managerNote)}`);
    });
  } catch (error) {
    warnAgentFailure('evidence', error);
    if (task.attempts >= MAX_TASK_ATTEMPTS) await db.query(`UPDATE agent_tasks AS task SET status='failed'
      FROM work_orders AS w WHERE task.id=$1 AND task.attempts=$2 AND task.status='queued'
      AND task.order_id=w.id AND w.property_id=$3`, [task.id, task.attempts, cfg.property.id]);
  }
}

async function applyFollowUp(db: PoolClient, cfg: Config, order: { id: string; access_key: string }, decision?: FollowUp) {
  const { rows: [current] } = await db.query<{ status: string }>('SELECT status FROM work_orders WHERE id=$1 FOR UPDATE', [order.id]);
  if (current?.status !== 'open') return;
  if (decision) await recordAgentTrace(db, order.id, decision.trace);
  if (decision?.kind === 'snooze') {
    await db.query("UPDATE work_orders SET next_nudge_at=now() + $2 * interval '1 hour' WHERE id=$1", [order.id, decision.hours]);
    return record(db, order.id, 'agent_snooze', `Follow-up agent will check again in ${decision.hours} h. ${plainText(decision.reason)}`);
  }
  const { rows: [sent] } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM work_order_events WHERE order_id=$1 AND action='reminder'", [order.id]);
  await remindManager(db, cfg, order, decision && `${decision.urgent ? 'URGENT · ' : ''}Reminder: L-${order.id} · ${plainText(decision.message)}`);
  const again = decision && sent.n + 1 < MAX_REMINDERS;
  await db.query("UPDATE work_orders SET next_nudge_at=CASE WHEN $2 THEN now() + $3 * interval '1 second' END WHERE id=$1",
    [order.id, !!again, cfg.nudgeSeconds]);
}

/** Follow-up agent: replaces the fixed one-time reminder for orders still waiting on a time. */
export async function runFollowUps(db: PoolClient, cfg: Config, agents: Agents) {
  // A lease instead of clearing next_nudge_at: if the worker stops mid-run, the order comes due again.
  const { rows } = await db.query<{ id: string; access_key: string }>(`
    UPDATE work_orders SET next_nudge_at=now() + $3 * interval '1 second' WHERE id IN (
      SELECT id FROM work_orders WHERE property_id=$1 AND status='open' AND next_nudge_at <= now()
      ORDER BY next_nudge_at LIMIT $2 FOR UPDATE SKIP LOCKED)
    RETURNING id, access_key`, [cfg.property.id, FOLLOWUPS_PER_TICK, FOLLOWUP_LEASE_SECONDS]);
  for (const order of rows) {
    const decision = await runFollowUp(db, cfg, agents.model, order.id)
      .catch((error: unknown) => { warnAgentFailure('followup', error); return undefined; });
    try {
      await inTransaction(db, () => applyFollowUp(db, cfg, order, decision));
    } catch (error) {
      warnAgentFailure('followup', error);
    }
  }
}
