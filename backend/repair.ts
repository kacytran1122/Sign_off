export type Issue = 'leak' | 'damage';
export const aids = ['bucket', 'towel', 'clear', 'stair-sign'] as const;
export type Aid = typeof aids[number];

export const guidance: Record<Aid, string> = {
  bucket: 'For a small drip in a safe spot, set a bucket below it and lay towels flat beside it to catch splashes. Keep the walkway clear.',
  towel: 'If the area is safe, use a towel for a small spill on the floor and keep the walkway clear.',
  clear: 'Keep clear of the damaged area and leave it for maintenance to inspect.',
  'stair-sign': 'Avoid the damaged stair. If you can reach the landing safely, use paper, a marker and tape to post a warning on the wall. Keep the exit path clear. Maintenance should assess the step before anyone uses it.',
};

export function repairEffects(issue: Issue, aid: Aid) {
  return aid === 'stair-sign'
    ? 'A broken tread increases the risk of a fall and can make the stairs harder to use during an emergency.'
    : possibleEffects[issue];
}

export const possibleEffects: Record<Issue, string> = {
  leak: 'Water can damage nearby finishes and belongings. Materials that stay wet can develop mold.',
  damage: 'The damaged part can affect access or nearby fixtures. Maintenance can check what needs repair.',
};

export function repairTimeZone(address: string | undefined, fallback: string, observed?: string) {
  if (observed) {
    try { new Intl.DateTimeFormat('en', { timeZone: observed }); return observed; } catch { /* use the address */ }
  }
  return /, Los Angeles, CA\b/i.test(address ?? '') ? 'America/Los_Angeles' : fallback;
}

export function safeAid(text: string, issue: Issue, suggested?: Aid): Aid {
  if (suggested === 'clear') return 'clear';
  if (/\b(?:sag\w*|bulg\w*|collaps\w*|sparks?|wires?|electri\w*|outlets?|sewage|flood\w*)\b/i.test(text)) return 'clear';
  if (issue === 'damage') {
    return suggested === 'stair-sign' || /\b(?:stairs?|staircase|stairwell|stairway|tread|step)\b/i.test(text)
      ? 'stair-sign' : 'clear';
  }
  if (/\b(?:drip\w*|ceiling)\b/i.test(text)) return 'bucket';
  return suggested === 'towel' || /\b(?:puddle|spill)\b/i.test(text) ? 'towel' : 'bucket';
}

const streetAddress = /\b\d{1,6}(?:-\d{1,6})?\s+[\w.'’-]+(?:\s+[\w.'’-]+){0,6}\s+(?:st(?:reet)?|ave(?:nue)?|rd|road|blvd|boulevard|dr(?:ive)?|ln|lane|ct|court|way|pkwy|parkway|pl(?:ace)?|ter(?:race)?|cir(?:cle)?|hwy|highway|loop|trl|trail)\b\.?/i;

export function reportAddress(text: string) {
  const line = text.split('\n').find((line) => streetAddress.test(line));
  const street = line?.match(streetAddress);
  if (!line || !street || street.index == null) return;
  const place = line.slice(street.index + street[0].length).match(/^\s*,?\s*([A-Za-z][A-Za-z .'-]+?)[\s,]+([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?\b))?(?=\s|[,.;]|$)/i);
  if (!place) return;
  return `${street[0]}, ${place[1].trim()}, ${place[2].toUpperCase()}${place[3] ? ` ${place[3]}` : ''}`;
}

function addressKey(value: string) {
  return value.toLowerCase().replace(/\b(road|street|avenue|drive|boulevard)\b/g,
    (part) => ({ road: 'rd', street: 'st', avenue: 'ave', drive: 'dr', boulevard: 'blvd' })[part]!)
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/[^a-z0-9-]+/g, ' ').trim();
}

export function belongsToProperty(address: string, property: string) {
  const target = addressKey(address);
  const configured = addressKey(property);
  if (target === configured) return true;
  const range = /^(\d+)-(\d+) (.+)$/.exec(configured);
  const reported = /^(\d+) (.+)$/.exec(target);
  return !!(range && reported && range[3] === reported[2] && +reported[1] >= +range[1] && +reported[1] <= +range[2]);
}
