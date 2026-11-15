import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { z } from 'zod';
import { loadConfig } from '../../backend/config.js';
import { triagedAid } from '../../backend/agents/intake.js';
import type { Assessment } from '../../backend/agents/triage.js';
import {
  AgentError, decisionTool, noArgs, plainText, readTool, runAgent, toSpec, type AgentDef, type Model, type ModelRequest,
} from '../../backend/agents/runtime.js';

type Turn = Array<[string, unknown]>;

function scripted(turns: Turn[]) {
  const requests: ModelRequest[] = [];
  const model: Model = {
    async next(request) {
      requests.push(request);
      const turn = turns.shift();
      if (!turn) throw new Error('No scripted turn left');
      const calls = turn.map(([name, args], index) => ({ callId: `call-${requests.length}-${index}`, name, arguments: JSON.stringify(args) }));
      return { calls, items: calls.map((call) => ({ type: 'function_call', call_id: call.callId, name: call.name, arguments: call.arguments })) };
    },
  };
  return { model, requests };
}

const outputs = (request: ModelRequest) => request.input
  .filter((item): item is { type: string; output: string } => (item as { type?: string }).type === 'function_call_output')
  .map((item) => JSON.parse(item.output) as unknown);

const agent: AgentDef<{ stock: number }> = {
  name: 'clerk',
  instructions: 'Test agent',
  tools: [
    readTool({ name: 'count', description: 'Count stock', schema: z.strictObject({ shelf: z.string() }), run: ({ shelf }, ctx: { stock: number }) => ({ shelf, stock: ctx.stock }) }),
    decisionTool({
      name: 'order', description: 'Order more', schema: z.strictObject({ quantity: z.number().int().min(1).max(10) }),
      guard: ({ quantity }, ctx: { stock: number }) => quantity + ctx.stock > 12 ? 'Too much stock.' : undefined,
    }),
  ],
  maxSteps: 4,
};

test('the agent loop feeds read-tool results back and stops at a decision', async () => {
  const { model, requests } = scripted([[['count', { shelf: 'A' }]], [['order', { quantity: 5 }]]]);
  const decision = await runAgent(agent, model, { text: 'restock' }, { stock: 3 });
  assert.deepEqual(decision.args, { quantity: 5 });
  assert.equal(decision.tool, 'order');
  assert.deepEqual(decision.trace.map((step) => step.tool), ['count', 'order']);
  assert.deepEqual(outputs(requests[1]), [{ shelf: 'A', stock: 3 }]);
});

test('invalid arguments, unknown tools and guard refusals go back to the model to correct', async () => {
  const { model, requests } = scripted([
    [['order', { quantity: 50 }]], [['missing', {}]], [['order', { quantity: 10 }]], [['order', { quantity: 2 }]],
  ]);
  const decision = await runAgent(agent, model, { text: 'restock' }, { stock: 3 });
  assert.deepEqual(decision.args, { quantity: 2 });
  const errors = outputs(requests[3]).map((output) => (output as { error: string }).error);
  assert.match(errors[0], /Invalid arguments/);
  assert.match(errors[1], /Unknown tool missing/);
  assert.equal(errors[2], 'Too much stock.');
});

test('an agent that never decides or answers without tools raises AgentError', async () => {
  await assert.rejects(runAgent(agent, scripted(Array.from({ length: 4 }, (): Turn => [['count', { shelf: 'A' }]])).model, { text: 'x' }, { stock: 1 }),
    (error: unknown) => error instanceof AgentError && /did not decide within 4 steps/.test(error.message));
  await assert.rejects(runAgent(agent, scripted([[]]).model, { text: 'x' }, { stock: 1 }), AgentError);
});

test('tool parameters are sent as strict JSON schemas and photos as input images', async () => {
  const { model, requests } = scripted([[['order', { quantity: 1 }]]]);
  await runAgent(agent, model, { text: 'look', image: { type: 'image/png', base64: 'AAAA' } }, { stock: 0 });
  const order = requests[0].tools.find((tool) => tool.name === 'order')!;
  assert.equal(order.parameters.additionalProperties, false);
  assert.equal(order.parameters.$schema, undefined);
  const content = (requests[0].input[0] as { content: Array<{ type: string; image_url?: string }> }).content;
  assert.equal(content[1].image_url, 'data:image/png;base64,AAAA');
});

test('zero-argument tools still send the required array that strict mode needs', () => {
  const spec = toSpec({ name: 'list', description: 'List', schema: noArgs });
  assert.deepEqual(spec.parameters, { required: [], type: 'object', properties: {}, additionalProperties: false });
});

test('links are stripped from model-written text before it reaches a person', () => {
  assert.equal(plainText('Call us at https://evil.example/x or www.evil.example now'), 'Call us at or now');
});

test('triage hazards force the keep-clear precaution even without hazard words in the text', () => {
  const base: Assessment = { issue: 'leak', severity: 'routine', hazards: [], temporaryAid: 'bucket', observation: '', visibleAddress: null };
  assert.equal(triagedAid(base), 'bucket');
  assert.equal(triagedAid({ ...base, hazards: ['electrical'] }), 'clear');
  assert.equal(triagedAid({ ...base, severity: 'emergency' }), 'clear');
  assert.equal(triagedAid({ ...base, hazards: ['mold'] }), 'bucket');
});

test('agent mode refuses to start without an OpenAI key and model', async () => {
  await assert.rejects(loadConfig({ DEMO_MODE: 'true', DATABASE_URL: 'postgres://fixture@localhost/x', AGENT_MODE: 'true' }), /AGENT_MODE requires/);
});
