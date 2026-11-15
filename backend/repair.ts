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

function addressParts(value: string) {
  const zip = /\b[a-z]{2}\s+(\d{5})(?:-\d{4})?[\s.,]*$/i.exec(value)?.[1];
  const key = value.toLowerCase().replace(/\b[a-z]{2}\s+\d{5}(?:-\d{4})?[\s.,]*$/i,
    (suffix) => suffix.slice(0, 2)).replace(/\b(road|street|avenue|drive|boulevard)\b/g,
    (part) => ({ road: 'rd', street: 'st', avenue: 'ave', drive: 'dr', boulevard: 'blvd' })[part]!)
    .replace(/[^a-z0-9-]+/g, ' ').trim();
  const [number, ...words] = key.split(' ');
  return { number, words, zip };
}

function sameNumber(reported: string, configured: string) {
  if (reported === configured) return true;
  const range = /^(\d+)-(\d+)$/.exec(configured);
  return !!(range && /^\d+$/.test(reported) && +reported >= +range[1] && +reported <= +range[2]);
}

export function belongsToProperty(address: string, property: string) {
  const target = addressParts(address);
  const configured = addressParts(property);
  return sameNumber(target.number, configured.number) &&
    (!target.zip || !configured.zip || target.zip === configured.zip) &&
    target.words.join(' ') === configured.words.join(' ');
}

function singleTypo(typed: string, known: string) {
  if (Math.min(typed.length, known.length) < 4 || Math.abs(typed.length - known.length) > 1) return false;
  const offset = Array.from(typed).findIndex((letter, i) => letter !== known[i]);
  if (offset < 0) return typed.length !== known.length;
  if (typed.length > known.length) return typed.slice(offset + 1) === known.slice(offset);
  if (typed.length < known.length) return typed.slice(offset) === known.slice(offset + 1);
  if (typed.slice(offset + 1) === known.slice(offset + 1)) return true;
  return typed[offset] === known[offset + 1] && typed[offset + 1] === known[offset] &&
    typed.slice(offset + 2) === known.slice(offset + 2);
}

/** A suggestion requires an explicit tenant confirmation before it can be used as evidence. */
export function suggestPropertyAddress(address: string, property: string) {
  const target = addressParts(address);
  const configured = addressParts(property);
  if (!/^\d+(?:-\d+)?$/.test(target.number) || !sameNumber(target.number, configured.number) ||
      target.words.length < 3 || target.words.length !== configured.words.length ||
      target.words.at(-1) !== configured.words.at(-1)) return;
  const differences = target.words.flatMap((word, index) => word === configured.words[index] ? [] : [index]);
  const zipDiffers = !!(target.zip && configured.zip && target.zip !== configured.zip);
  if (zipDiffers) {
    if (!differences.length && singleTypo(target.zip!, configured.zip!)) return property;
    return;
  }
  if (differences.length === 1 && singleTypo(target.words[differences[0]], configured.words[differences[0]])) return property;
}
