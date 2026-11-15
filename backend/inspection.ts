import type { Landmark, Property } from './config.js';
import type { Aid } from './repair.js';
import { polygonContainsPolygon } from './roof-geometry.js';
import { projectDamageOnRoof } from './roof-projection.js';

export function planRoofInspection(property: Property, room: Landmark, aid?: Aid, confirmedAnchor?: Landmark['anchor']) {
  const zone = property.zones.find((candidate) => candidate.id === room.zoneId);
  if (property.costar?.storiesAboveGrade !== 1 || !property.matterportModel || !room.matterportRoomId ||
      !room.anchor || !room.views.length || !zone || !property.roof.outline ||
      !(property.roof.imageFile || property.roof.imageUrl)) return;
  if (!polygonContainsPolygon(property.roof.outline, zone.polygon)) return;

  const roomLabel = room.label.toLowerCase();
  const indoor = confirmedAnchor
    ? `Start at the spot in the ${roomLabel} that the manager matched to a tenant photo in Matterport. Trace the moisture indoors.`
    : `Check the reported ${roomLabel} and trace the moisture indoors. Use the matched Matterport room to locate the report.`;
  const projection = confirmedAnchor && projectDamageOnRoof(property.roof, zone, confirmedAnchor);
  let roof = `If the indoor inspection points overhead, check the Vexcel area labeled “${zone.label}”. Verify conditions and safe access on site.`;
  if (projection?.inInspectionZone) {
    roof = `If the indoor inspection points overhead, use the projected spot inside “${zone.label}” to narrow the Vexcel roof check. Verify conditions and safe access on site.`;
  } else if (confirmedAnchor) {
    roof = projection
      ? 'The photo-matched spot projects outside the mapped roof area. Verify the room-to-roof alignment on site before assigning a roof target.'
      : 'An on-site check is needed to align the photo-matched spot with the aerial image before assigning a roof target.';
  }
  const safety = 'Keep people clear and have site maintenance assess the hazard before entering the reported area.';
  const steps = aid === 'clear' ? [safety, indoor, roof] : [indoor, roof];
  const next = confirmedAnchor && !projection?.inInspectionZone ? 'verify the room-to-roof alignment on site' : 'use the mapped roof target if moisture traces overhead';
  const summary = aid === 'clear'
    ? 'Safety check first. Keep people clear and have site maintenance assess the area before any inspection.'
    : `Inspection plan: check the ${roomLabel} inside, then ${next}.`;
  return { summary, steps };
}
