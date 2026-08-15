// LandOS — LandPortal Overview (parcel-context) capture framing.
//
// Screenshot style rule, settled: LandPortal's normal THIN NAVIGATION SIDEBAR is
// acceptable and is never chased. What is not acceptable is the expanded
// PROPERTY-DETAIL PANEL, which covers a substantial part of the parcel imagery
// and leaves the operator looking at a UI panel instead of the parcel. That
// panel is collapsed before capture, and a capture that still carries it is
// rejected with the reason said plainly.

import { contextZoomOutSteps } from './parcel-visual-framing.js';

export const OVERVIEW_CAPTURE_KEY: string = 'landportal_overview';

/** The thin navigation rail. Acceptable in frame; never worth removing. */
const ACCEPTABLE_CHROME = /\b(?:nav(?:igation)?\s*(?:side\s*bar|sidebar|rail|bar)|left\s*nav|side\s*nav|toolbar|top\s*bar|header)\b/i;

/** The expanded property-detail panel. Must be dismissed before capture. */
const DETAIL_PANEL = /\b(?:property\s*(?:detail|info(?:rmation)?|panel|card)|detail\s*(?:panel|pane|sidebar|drawer)|parcel\s*(?:detail|info(?:rmation)?)\s*(?:panel|pane|sidebar|drawer)?|info\s*(?:panel|drawer)|overlay\s*panel|popup|modal|dialog)\b/i;

export interface OverviewCapturePlan {
  view: 'parcel_context';
  zoomOutSteps: number;
  purpose: string;
  framingIntent: string;
  mustShow: string[];
  /** Panels collapsed or dismissed before the shutter, in order. */
  mustDismiss: string[];
  /** Chrome that may remain in frame; removing it is not worth any effort. */
  acceptableChrome: string[];
  requires: { boundaryVisible: boolean; tilesLoaded: boolean; roadInFrame: boolean };
}

/**
 * Classify one named obstruction. Acceptable chrome does not reject a capture;
 * a property-detail panel always does.
 */
export function obstructionVerdict(obstruction: string): 'acceptable' | 'detail_panel' | 'obstruction' {
  const value = obstruction.trim();
  if (!value) return 'acceptable';
  if (DETAIL_PANEL.test(value)) return 'detail_panel';
  if (ACCEPTABLE_CHROME.test(value)) return 'acceptable';
  return 'obstruction';
}

export function planOverviewCapture(input: { subjectAcres: number | null; roadName?: string | null }): OverviewCapturePlan {
  const road = input.roadName?.trim() || 'the nearest public road';
  return {
    view: 'parcel_context',
    zoomOutSteps: contextZoomOutSteps(input.subjectAcres),
    purpose: OVERVIEW_CAPTURE_KEY,
    framingIntent: `Frame the complete subject parcel against ${road}, clearly showing their road relationship and any apparent access route connecting the road toward the parcel. The ENTIRE subject boundary must sit fully inside the frame with visible padding on every side; a long, narrow, irregular, very large, or very small parcel still has to fit completely — zoom out further whenever any boundary vertex approaches an edge. A capture with any part of the subject boundary cut off by a frame edge is clipped and unacceptable.`,
    mustShow: [
      'Complete subject parcel boundary, fully inside the frame with padding on every side (never touching or crossing an edge)',
      `Nearest public road (${road})`,
      'Any apparent driveway or physical access route',
      'Immediately surrounding parcels for context',
    ],
    mustDismiss: [
      'Collapse or close the expanded property-detail panel before the shutter — it must not cover a substantial part of the parcel imagery.',
      'Close any open popup, modal, or overlay panel sitting over the map.',
    ],
    acceptableChrome: [
      'The normal thin LandPortal navigation sidebar may stay in frame; do not spend effort removing it.',
    ],
    requires: { boundaryVisible: true, tilesLoaded: true, roadInFrame: true },
  };
}

export interface OverviewFramingVerdict { accepted: boolean; reason: string }

export function assessOverviewFraming(artifact: {
  active_view?: string | null;
  requested_view?: string | null;
  boundary_visible?: boolean | null;
  /** True only when EVERY boundary vertex is inside the frame with padding.
   *  A capture reporting false is clipped and never accepted. Absent means an
   *  older handback that never measured it; boundary_visible then governs. */
  boundary_fully_in_frame?: boolean | null;
  tiles_loaded?: boolean | null;
  camera_scale?: string | null;
  clipped?: boolean | null;
  obstructions?: string[] | null;
}): OverviewFramingVerdict {
  if (artifact.active_view !== 'parcel_context') return { accepted: false, reason: 'Overview rejected because the active view is not the required parcel-context map.' };
  if (artifact.camera_scale === 'county' || artifact.camera_scale === 'national') return { accepted: false, reason: `Overview rejected because ${artifact.camera_scale}-scale framing makes the parcel-road relationship unreadable.` };
  if (artifact.boundary_visible !== true) return { accepted: false, reason: 'Overview rejected because the complete subject parcel boundary is not visibly retained.' };
  if (artifact.boundary_fully_in_frame === false) return { accepted: false, reason: 'Overview rejected because part of the subject boundary is cut off by a frame edge; the entire boundary must sit inside the frame with padding.' };
  if (artifact.tiles_loaded !== true) return { accepted: false, reason: 'Overview rejected because the satellite or map tiles were not fully loaded.' };
  if (artifact.clipped === true) return { accepted: false, reason: 'Overview rejected because the useful parcel-context map is clipped.' };
  const obstructions = (artifact.obstructions ?? []).filter(Boolean);
  const detailPanels = obstructions.filter((item) => obstructionVerdict(item) === 'detail_panel');
  if (detailPanels.length) {
    return {
      accepted: false,
      reason: `Overview rejected because ${detailPanels.join(', ')} covers a substantial part of the parcel imagery; collapse the property-detail panel and recapture. The thin navigation sidebar is fine and does not need removing.`,
    };
  }
  const blocking = obstructions.filter((item) => obstructionVerdict(item) === 'obstruction');
  if (blocking.length) return { accepted: false, reason: `Overview rejected because ${blocking.join(', ')} obstructs the useful map frame.` };
  return {
    accepted: true,
    reason: obstructions.length
      ? 'Accepted deliberately framed parcel-context Overview with boundary and map tiles visible; only the normal thin LandPortal navigation chrome is in frame.'
      : 'Accepted deliberately framed parcel-context Overview with boundary and map tiles visible.',
  };
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
