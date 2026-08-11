import { contextZoomOutSteps } from './parcel-visual-framing.js';

export const OVERVIEW_CAPTURE_KEY: string = 'landportal_overview';

export interface OverviewCapturePlan {
  view: 'parcel_context';
  zoomOutSteps: number;
  purpose: string;
  framingIntent: string;
  mustShow: string[];
  requires: { boundaryVisible: boolean; tilesLoaded: boolean; roadInFrame: boolean };
}

export function planOverviewCapture(input: { subjectAcres: number | null; roadName?: string | null }): OverviewCapturePlan {
  const road = input.roadName?.trim() || 'the nearest public road';
  return {
    view: 'parcel_context',
    zoomOutSteps: contextZoomOutSteps(input.subjectAcres),
    purpose: OVERVIEW_CAPTURE_KEY,
    framingIntent: `Frame the complete subject parcel against ${road}, clearly showing their road relationship and any apparent access route connecting the road toward the parcel.`,
    mustShow: [
      'Complete subject parcel boundary',
      `Nearest public road (${road})`,
      'Any apparent driveway or physical access route',
      'Immediately surrounding parcels for context',
    ],
    requires: { boundaryVisible: true, tilesLoaded: true, roadInFrame: true },
  };
}

export interface OverviewFramingVerdict { accepted: boolean; reason: string }

export function assessOverviewFraming(artifact: {
  active_view?: string | null;
  requested_view?: string | null;
  boundary_visible?: boolean | null;
  tiles_loaded?: boolean | null;
  camera_scale?: string | null;
  clipped?: boolean | null;
  obstructions?: string[] | null;
}): OverviewFramingVerdict {
  if (artifact.active_view !== 'parcel_context') return { accepted: false, reason: 'Overview rejected because the active view is not the required parcel-context map.' };
  if (artifact.camera_scale === 'county' || artifact.camera_scale === 'national') return { accepted: false, reason: `Overview rejected because ${artifact.camera_scale}-scale framing makes the parcel-road relationship unreadable.` };
  if (artifact.boundary_visible !== true) return { accepted: false, reason: 'Overview rejected because the complete subject parcel boundary is not visibly retained.' };
  if (artifact.tiles_loaded !== true) return { accepted: false, reason: 'Overview rejected because the satellite or map tiles were not fully loaded.' };
  if (artifact.clipped === true) return { accepted: false, reason: 'Overview rejected because the useful parcel-context map is clipped.' };
  if ((artifact.obstructions ?? []).length > 0) return { accepted: false, reason: `Overview rejected because ${artifact.obstructions!.join(', ')} obstructs the useful map frame.` };
  return { accepted: true, reason: 'Accepted deliberately framed parcel-context Overview with boundary and map tiles visible.' };
}

export interface OverviewSelection<T> { artifact: T | null; accepted: boolean; reason: string }

export function selectOverviewVisual<T extends Record<string, unknown>>(artifacts: T[]): OverviewSelection<T> {
  for (const artifact of artifacts) {
    const verdict = assessOverviewFraming(artifact);
    if (verdict.accepted) return { artifact, accepted: true, reason: verdict.reason };
  }
  return {
    artifact: null,
    accepted: false,
    reason: artifacts.length
      ? 'No Overview screenshot is available because none of the retained artifacts passed the parcel-context framing requirements.'
      : 'No Overview screenshot is available because no deliberately framed parcel-context artifact was supplied.',
  };
}
