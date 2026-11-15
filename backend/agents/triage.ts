import { z } from 'zod';
import { classificationRules } from '../ai.js';
import type { Photo } from '../photon.js';
import { aids, guidance } from '../repair.js';
import { decisionTool, noArgs, readTool, runAgent, type AgentDef, type Model, type TraceStep } from './runtime.js';

export const assessmentSchema = z.strictObject({
  issue: z.enum(['leak', 'damage', 'other', 'unclear']),
  severity: z.enum(['routine', 'urgent', 'emergency']).describe('emergency: active danger to people; urgent: access or fall risk, spreading water'),
  hazards: z.array(z.enum(['electrical', 'structural', 'sewage', 'flooding', 'fall', 'mold'])).max(6),
  temporaryAid: z.enum(aids).nullable(),
  observation: z.string().max(700).describe('One professional sentence or two. Attribute text-only details to the reporter.'),
  visibleAddress: z.string().max(180).nullable(),
});
export type Assessment = z.infer<typeof assessmentSchema>;

const triageAgent: AgentDef<object> = {
  name: 'triage',
  instructions: [
    'You are the safety triage agent for a building repair service. You only assess; another agent talks to the tenant.',
    classificationRules,
    'Call safety_rules if you are unsure which precaution fits, then call assess exactly once.',
  ].join(' '),
  tools: [
    readTool({
      name: 'safety_rules',
      description: 'The approved temporary precautions and the hazards that always require keeping clear.',
      schema: noArgs,
      run: () => ({
        precautions: guidance,
        alwaysClear: ['sagging or bulging ceiling', 'collapse', 'sparks, wires, outlets, electricity', 'sewage', 'flooding'],
      }),
    }),
    decisionTool({ name: 'assess', description: 'Submit the safety assessment.', schema: assessmentSchema }),
  ],
  maxSteps: 3,
};

/** Runs the triage specialist on the raw tenant evidence, never on another agent's paraphrase. */
export async function runTriage(model: Model, report: string, photo?: Photo): Promise<{ assessment: Assessment; trace: TraceStep[] }> {
  const decision = await runAgent(triageAgent, model, {
    text: JSON.stringify({ report }),
    image: photo && { type: photo.type, base64: photo.bytes.toString('base64') },
  }, {});
  return { assessment: assessmentSchema.parse(decision.args), trace: decision.trace };
}
