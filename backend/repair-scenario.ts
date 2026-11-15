import type { Aid, Issue } from './repair.js';

export function repairScenario(issue: Issue, aid: Aid, description = '') {
  if (issue === 'leak') {
    if (/\b(?:ceiling|roof|overhead|drywall above)\b/i.test(description)) return 'ceiling-leak';
    if (/\b(?:sink|drain pipe|p[ -]trap|supply hose|faucet|tap)\b/i.test(description)) return 'sink-leak';
    return aid === 'towel' ? 'floor-spill' : 'general-leak';
  }
  if (aid === 'stair-sign' || /\b(?:stairs?|stairwell|staircase|tread)\b/i.test(description)) return 'damaged-stair';
  if (/\b(?:window|sash|latch)\b/i.test(description)) return 'damaged-window';
  return 'general-damage';
}
