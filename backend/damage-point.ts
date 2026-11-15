import { z } from 'zod';
import type { Config } from './config.js';
import { managerWorkspaceUrl } from './reports.js';

const coordinate = z.number().min(-10_000).max(10_000);
const vector = z.object({ x: coordinate, y: coordinate, z: coordinate });
const stem = vector.refine(({ x, y, z }) => {
  const length = Math.hypot(x, y, z);
  return length >= 0.05 && length <= 0.5;
}, 'The marker stem must be between 0.05 and 0.5 meters.');

export const damagePointInput = z.object({
  anchor: vector,
  stem,
  sweep: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  modelId: z.string().regex(/^[A-Za-z0-9]{1,128}$/),
}).strict();

const storedDamagePoint = damagePointInput.extend({ confirmed: z.literal(true) });

export function confirmedDamageAnchor(input: unknown, modelId: string | undefined) {
  const result = storedDamagePoint.safeParse(input);
  return result.success && result.data.modelId === modelId ? result.data.anchor : undefined;
}

export function photoReviewUrl(config: Config, order: { access_key: string; inspection_key: string }, landmarkId: string) {
  if (!config.property.matterportModel || !config.matterportKey ||
      !config.property.landmarks.some((landmark) => landmark.id === landmarkId)) return;
  const workspace = managerWorkspaceUrl(config, order.access_key);
  if (workspace) return `${workspace}#inspect=${order.inspection_key}`;
}
