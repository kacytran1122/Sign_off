import OpenAI from 'openai';
import type { ResponseInput } from 'openai/resources/responses/responses';
import type { Model } from './runtime.js';

const REQUEST_TIMEOUT_MS = 20_000;
// Reasoning models need their encrypted reasoning items passed back because requests are not stored.
const reasoningModel = /^(?:o\d|gpt-[5-9])|codex/i;

export function openAiModel(model: string, client = new OpenAI({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })): Model {
  const reasoning = reasoningModel.test(model);
  return {
    async next({ instructions, input, tools }) {
      const response = await client.responses.create({
        model,
        store: false,
        instructions,
        input: input as ResponseInput,
        tools: tools.map((tool) => ({ type: 'function' as const, strict: true, ...tool })),
        tool_choice: 'required',
        parallel_tool_calls: false,
        ...(reasoning ? { include: ['reasoning.encrypted_content' as const], reasoning: { effort: 'low' as const } } : {}),
      });
      const calls = response.output.flatMap((item) => item.type === 'function_call'
        ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }] : []);
      return { calls, items: response.output };
    },
  };
}
