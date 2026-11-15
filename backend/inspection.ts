import type { Landmark, Property } from './config.js';
import type { Aid } from './repair.js';
import { polygonContainsPolygon } from './roof-geometry.js';

export function planRoofInspection(property: Property, room: Landmark, aid?: Aid) {
  const zone = property.zones.find((candidate) => candidate.id === room.zoneId);
  if (property.costar?.storiesAboveGrade !== 1 || !property.matterportModel || !room.matterportRoomId ||
      !room.anchor || !room.views.length || !zone || !property.roof.outline ||
      !(property.roof.imageFile || property.roof.imageUrl)) return;
  if (!polygonContainsPolygon(property.roof.outline, zone.polygon)) return;

  const indoor = `Check the reported ${room.label.toLowerCase()} and trace the moisture indoors.`;
  const roof = 'If the indoor inspection points overhead, check the highlighted roof area. Verify conditions and safe access on site.';
  const first = aid === 'clear'
    ? 'Keep people clear and have site maintenance assess the hazard before entering the reported area.'
    : indoor;
  const steps = aid === 'clear' ? [first, indoor, roof] : [first, roof];
  const summary = aid === 'clear'
    ? 'Safety check first. Keep people clear and have site maintenance assess the area before any inspection.'
    : `Inspection plan: check the ${room.label.toLowerCase()} inside, then use the mapped roof target if moisture traces overhead.`;
  return { summary, steps };
}
