import type { Aid, Issue } from './repair.js';

export function repairScenario(issue: Issue, aid: Aid, description = '', location?: string) {
  if (issue === 'leak') {
    if (/\b(?:ceiling|roof|overhead|drywall above)\b/i.test(description)) return 'ceiling-leak';
    if (/\b(?:sink|drain pipe|p[ -]trap|supply hose|faucet|tap)\b/i.test(description)) return 'sink-leak';
    if (aid === 'towel') return 'floor-spill';
    return location && /\bceiling\b/i.test(location) ? 'ceiling-leak' : 'general-leak';
  }
  if (aid === 'stair-sign' || /\b(?:stairs?|stairwell|staircase|tread)\b/i.test(description)) return 'damaged-stair';
  if (/\b(?:window|sash|latch)\b/i.test(description)) return 'damaged-window';
  return 'general-damage';
}
