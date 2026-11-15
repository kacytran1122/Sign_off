import type { Landmark, Property } from './config.js';
import type { Aid } from './repair.js';
import type { repairScenario } from './repair-scenario.js';
import { polygonContainsPolygon } from './roof-geometry.js';
import { projectDamageOnRoof } from './roof-projection.js';

type InspectionAssessment = {
  decision: 'indoor-check' | 'roof-zone' | 'projected-roof-check' | 'alignment-check';
  reason: string;
  nextStep: string;
};

type Inspection = {
  assessment: InspectionAssessment;
  plan?: { summary: string; steps: string[] };
};

const safety = 'Keep people clear and have site maintenance assess the hazard before entering the reported area.';
const indoorCheck = (reason: string, aid?: Aid): Inspection => ({
  assessment: {
    decision: 'indoor-check',
    reason,
    nextStep: aid === 'clear' ? safety : 'Have maintenance inspect the reported area and nearby fixtures on site.',
  },
});

export function assessRepairInspection(property: Property, input: {
  propertyMatch: boolean;
  scenario: ReturnType<typeof repairScenario>;
  room?: Landmark;
  aid?: Aid;
  confirmedAnchor?: Landmark['anchor'];
}): Inspection {
  const { propertyMatch, scenario, room, aid, confirmedAnchor } = input;
  if (!propertyMatch) return indoorCheck('The reported address has no verified match to this property.', aid);
  if (scenario !== 'ceiling-leak') return indoorCheck('The report gives no clear indication of an overhead leak.', aid);
  return assessRoofInspection(property, room, aid, confirmedAnchor);
}

function assessRoofInspection(property: Property, room?: Landmark, aid?: Aid, confirmedAnchor?: Landmark['anchor']): Inspection {
  if (!property.costar) return indoorCheck('The CoStar story count is unavailable for this property.', aid);
  if (property.costar.storiesAboveGrade !== 1) {
    return indoorCheck(`CoStar records ${property.costar.storiesAboveGrade} above-grade stories. An on-site check is needed to establish what is above the reported room.`, aid);
  }
  if (!property.matterportModel || !room?.matterportRoomId || !room.anchor || !room.views.length) {
    return indoorCheck('The reported area has no verified Matterport room and viewpoint match.', aid);
  }
  if (!(property.roof.imageFile || property.roof.imageUrl)) {
    return indoorCheck('A Vexcel roof image is unavailable for the matched building.', aid);
  }
  const zone = property.zones.find((candidate) => candidate.id === room.zoneId);
  if (!zone || !property.roof.outline || !polygonContainsPolygon(property.roof.outline, zone.polygon)) {
    return {
      assessment: {
        decision: 'alignment-check',
        reason: 'The room’s roof zone could not be placed inside the verified Vexcel footprint.',
        nextStep: aid === 'clear' ? safety : 'Trace the moisture indoors and verify the room-to-roof alignment on site.',
      },
    };
  }

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
  const steps = aid === 'clear' ? [safety, indoor, roof] : [indoor, roof];
  const next = confirmedAnchor && !projection?.inInspectionZone ? 'verify the room-to-roof alignment on site' : 'use the mapped roof target if moisture traces overhead';
  const summary = aid === 'clear'
    ? 'Safety check first. Keep people clear and have site maintenance assess the area before any inspection.'
    : `Inspection plan: check the ${roomLabel} inside, then ${next}.`;
  const decision = projection?.inInspectionZone ? 'projected-roof-check' : confirmedAnchor ? 'alignment-check' : 'roof-zone';
  const reason = {
    'projected-roof-check': 'The confirmed Matterport spot projects within the verified Vexcel roof zone.',
    'alignment-check': 'The confirmed Matterport spot does not project within the verified Vexcel roof zone.',
    'roof-zone': 'CoStar records one story. The Matterport room is matched to a zone inside the Vexcel roof footprint.',
  }[decision];
  return {
    assessment: { decision, reason, nextStep: aid === 'clear' ? safety : `Trace the moisture indoors first. ${roof}` },
    plan: { summary, steps },
  };
}

export function planRoofInspection(property: Property, room: Landmark, aid?: Aid, confirmedAnchor?: Landmark['anchor']) {
  return assessRoofInspection(property, room, aid, confirmedAnchor).plan;
}
