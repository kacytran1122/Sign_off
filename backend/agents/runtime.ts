import { z } from 'zod';

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { callId: string; name: string; arguments: string };
export type ModelTurn = { calls: ToolCall[]; items: unknown[] };
export type ModelRequest = { instructions: string; input: unknown[]; tools: ToolSpec[] };
/** One model round trip. Must return at least one tool call; agents never answer in free text. */
export type Model = { next(request: ModelRequest): Promise<ModelTurn> };

export type UserInput = { text: string; image?: { type: string; base64: string } };
export type TraceStep = { agent: string; tool: string };
export type Decision = { tool: string; args: unknown; trace: TraceStep[] };

type AnyTool<Ctx> = {
  name: string;
  description: string;
  schema: z.ZodObject;
  /** Read tools return data to the model. */
  run?: (args: unknown, ctx: Ctx) => Promise<unknown> | unknown;
  /** Decision tools end the loop. A guard message is returned to the model so it can correct itself. */
  decision?: boolean;
  guard?: (args: unknown, ctx: Ctx) => Promise<string | undefined> | string | undefined;
};

export type AgentDef<Ctx> = { name: string; instructions: string; tools: AnyTool<Ctx>[]; maxSteps?: number };

const DEFAULT_MAX_STEPS = 6;
const OUTPUT_LIMIT = 6000;

export class AgentError extends Error {
  override name = 'AgentError';
}

export function readTool<Ctx, S extends z.ZodObject>(def: {
  name: string; description: string; schema: S; run: (args: z.infer<S>, ctx: Ctx) => Promise<unknown> | unknown;
}): AnyTool<Ctx> {
  return { ...def, run: def.run as AnyTool<Ctx>['run'] };
}

export function decisionTool<Ctx, S extends z.ZodObject>(def: {
  name: string; description: string; schema: S;
  guard?: (args: z.infer<S>, ctx: Ctx) => Promise<string | undefined> | string | undefined;
}): AnyTool<Ctx> {
  return { ...def, decision: true, guard: def.guard as AnyTool<Ctx>['guard'] };
}

export const noArgs = z.strictObject({});

/** Strict function schemas need a `required` array even when a tool takes no arguments. */
export function toSpec(tool: Pick<AnyTool<unknown>, 'name' | 'description' | 'schema'>): ToolSpec {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters: { required: [], ...parameters } };
}

const MESSAGE_LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
/** Model-written text sent to people: links are removed so tenant text cannot steer one into a message. */
export function plainText(text: string) {
  return text.replace(MESSAGE_LINK, '').replace(/[ \t]{2,}/g, ' ').trim();
}

function userMessage(input: UserInput) {
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: input.text },
      ...(input.image ? [{ type: 'input_image', detail: 'auto', image_url: `data:${input.image.type};base64,${input.image.base64}` }] : []),
    ],
  };
}

function callOutput(callId: string, value: unknown) {
  const output = JSON.stringify(value ?? null);
  return { type: 'function_call_output', call_id: callId, output: output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}…` : output };
}

function parseArgs(tool: AnyTool<unknown>, raw: string) {
  let json: unknown;
  try { json = JSON.parse(raw || '{}'); } catch { return { error: 'Arguments must be valid JSON.' }; }
  const parsed = tool.schema.safeParse(json);
  return parsed.success ? { args: parsed.data as unknown } : { error: `Invalid arguments: ${z.prettifyError(parsed.error)}` };
}

type Step = { output: unknown } | { decision: { tool: string; args: unknown } };

async function invoke<Ctx>(tools: Map<string, AnyTool<Ctx>>, call: ToolCall, ctx: Ctx): Promise<Step> {
  const tool = tools.get(call.name);
  if (!tool) return { output: { error: `Unknown tool ${call.name}.` } };
  const parsed = parseArgs(tool as AnyTool<unknown>, call.arguments);
  if ('error' in parsed) return { output: { error: parsed.error } };
  if (tool.decision) {
    const refusal = await tool.guard?.(parsed.args, ctx);
    return refusal ? { output: { error: refusal } } : { decision: { tool: tool.name, args: parsed.args } };
  }
  return { output: await tool.run!(parsed.args, ctx) };
}

/**
 * Runs a tool-calling loop until the model picks a decision tool.
 * Read tools may run many times; unexpected tool exceptions propagate so callers can fall back.
 */
export async function runAgent<Ctx>(agent: AgentDef<Ctx>, model: Model, input: UserInput, ctx: Ctx): Promise<Decision> {
  const tools = new Map(agent.tools.map((tool) => [tool.name, tool]));
  const specs = agent.tools.map((tool) => toSpec(tool as AnyTool<unknown>));
  const trace: TraceStep[] = [];
  let transcript: unknown[] = [userMessage(input)];
  const maxSteps = agent.maxSteps ?? DEFAULT_MAX_STEPS;
  for (let step = 0; step < maxSteps; step++) {
    const turn = await model.next({ instructions: agent.instructions, input: transcript, tools: specs });
    if (!turn.calls.length) throw new AgentError(`${agent.name} ended without choosing an action`);
    const outputs: unknown[] = [];
    for (const call of turn.calls) {
      trace.push({ agent: agent.name, tool: call.name });
      const result = await invoke(tools, call, ctx);
      if ('decision' in result) return { ...result.decision, trace };
      outputs.push(callOutput(call.callId, result.output));
    }
    transcript = [...transcript, ...turn.items, ...outputs];
  }
  throw new AgentError(`${agent.name} did not decide within ${maxSteps} steps`);
}

/** Logs the error type only: agent errors may quote tenant text. */
export function warnAgentFailure(agent: string, error: unknown) {
  console.warn(`${agent} agent failed; using the deterministic workflow:`, error instanceof Error ? error.name : 'UnknownError');
}

export function describeTrace(trace: TraceStep[]) {
  return trace.map((step) => `${step.agent}.${step.tool}`).join(' → ').slice(0, 500);
}
