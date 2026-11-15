const rodentCaseTypes = new Set(['health code', 'multifamily habitability violation', 'weeds trash stagnant water']);
const rodentDescriptions = new Set([
  'mouse', 'mice', 'mouse infestation', 'mice infestation',
  'rat', 'rats', 'rat infestation', 'rodent', 'rodents', 'rodent infestation',
]);

export function classifyHouston311(caseType: string | undefined, description: string | undefined) {
  const type = caseType?.trim().toLowerCase() ?? '';
  const label = description?.trim().toLowerCase() ?? '';
  if (rodentCaseTypes.has(type) && rodentDescriptions.has(label)) return 'rodent_mention';
  if (/^(water leak|sewer wastewater|storm drainage)$/.test(type)) return 'water';
  if (/^(missed garbage pickup|illegal dumping|missed heavy trash pickup)$/.test(type)) return 'waste';
}
