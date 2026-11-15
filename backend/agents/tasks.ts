import type { Db } from './orders.js';
import { describeTrace, type TraceStep } from './runtime.js';

export type AgentTask = 'evidence';

/** Hands a work order to a background agent. One queued task per agent and order covers every new report. */
export async function enqueueAgentTask(db: Db, agent: AgentTask, orderId: string) {
  await db.query(`INSERT INTO agent_tasks (agent, order_id) SELECT $1, $2
    WHERE NOT EXISTS (SELECT 1 FROM agent_tasks WHERE agent=$1 AND order_id=$2 AND status='queued')`, [agent, orderId]);
}

/** Writes which agents and tools ran to the work-order timeline, without copying tenant text. */
export async function recordAgentTrace(db: Db, orderId: string, trace: TraceStep[]) {
  if (!trace.length) return;
  await db.query(`INSERT INTO work_order_events (order_id, action, detail)
    SELECT $1, 'agent_trace', $2 WHERE EXISTS (SELECT 1 FROM work_orders WHERE id=$1)`, [orderId, describeTrace(trace)]);
}
