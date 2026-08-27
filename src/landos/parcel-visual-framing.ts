// LandOS — parcel-scale visual framing + overlay distinctness (pure logic).
//
// Phase 5 Item 21 screenshot correction. Two live defects on Deal 32:
//
//  1. COUNTY-SCALE CAPTURES. The LandPortal capture normalized the camera with
//     "Fit" (subject fills the frame) and then stepped the Mapbox zoom out a
//     FIXED five levels. Each step doubles the linear ground extent, so five
//     steps is 32x wider than the fitted parcel — county scale, where a
//     12-acre subject renders as a tiny pin and its boundary is sub-pixel.
//
//  2. IDENTICAL OVERLAY IMAGES. Overlay screenshots were taken ~1.8 s after
//     toggling a layer, with no proof the layer's tiles ever painted. At
//     county scale many thematic layers (contours, wetlands, FEMA) render
//     nothing visible at all, so the "FEMA", "Wetlands" and "Contours"
//     captures were the SAME base map saved under different labels.
//
// This module holds the deterministic parts of the fix so they are testable
// without a live browser: how many zoom steps out from a parcel fit produce a
// parcel-context frame (subject boundary + the immediately surrounding
// parcels + the fronting road), which overlays are attempted under which
// control names, and the byte-identity gate that refuses to promote a
// relabeled base map as an overlay capture.

import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Zoom steps OUT from the parcel "Fit" view for a parcel-context capture.
 *
 * "Fit" frames the subject to the viewport. Each Mapbox keyboard zoom step
 * doubles the linear ground extent. Two steps place the subject at roughly a
 * quarter of the frame width — the complete subject boundary stays clearly
 * visible, the ring of immediately surrounding parcels (~5-8 of them) is in
 * frame, and the fronting road is readable. That is the required end state.
 *
 * Very large parcels already span a wide fitted view, so one step retains
 * neighbor context without losing road readability. Never returns the former
 * fixed five: five steps is 32x the fitted extent — county scale.
 */
export function contextZoomOutSteps(subjectAcres: number | null): number {
  if (subjectAcres != null && Number.isFinite(subjectAcres) && subjectAcres >= 150) return 1;
  return 2;
}

/**
 * Hard ceiling on zoom steps out from the parcel fit for ANY standard aerial.
 *
 * Three steps is 8x the fitted linear extent: the neighborhood a buyer would
 * drive, not the city. Five steps (32x) was the county-scale defect, so no
 * capture in the standard package may reach it.
 */
export const MAX_STANDARD_ZOOM_OUT_STEPS = 3;

/**
 * Zoom steps OUT from the parcel "Fit" view for the SURROUNDING-AREA capture.
 *
 * This is the second, deliberately wider standard aerial. Where the
 * parcel-context frame answers "what is immediately around the boundary", this
 * one answers "what is the area doing": neighboring subdivisions, nearby
 * development, the roads approaching the subject and the roads that stop near
 * its boundaries, adjoining vacant acreage, and the residential/commercial
 * pattern around it.
 *
 * It is always at least one step wider than the parcel-context frame and never
 * wider than the standard ceiling, so the subject stays identifiable inside it.
 * Zooming to the whole city would answer nothing an operator can act on.
 */
export function surroundingAreaZoomOutSteps(subjectAcres: number | null): number {
  return Math.min(contextZoomOutSteps(subjectAcres) + 2, MAX_STANDARD_ZOOM_OUT_STEPS);
}

/** Parse the subject's acreage from the LandPortal parcel fact sheet fields. */
export function parseAcresFromFields(fields: Record<string, string>): number | null {
  const keys = Object.keys(fields);
  const preferred = keys.find((k) => /^acres$/i.test(k.trim()))
    ?? keys.find((k) => /^mls\s+acres$/i.test(k.trim()))
    ?? keys.find((k) => /acre/i.test(k));
  if (!preferred) return null;
  const match = /([\d,]+(?:\.\d+)?)/.exec(fields[preferred] ?? '');
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface PlannedOverlayCapture {
  /** Operator-facing overlay name (stable key downstream). */
  overlay: string;
  /** Control-name candidates: LandPortal renders "Enable <name>"/"Disable <name>". */
  candidates: string[];
  /** Screenshot file/purpose key. */
  purpose: string;
}

/**
 * Every thematic overlay the one-pass LandPortal capture must ATTEMPT, in
 * order. Each entry is toggled on, rendered, captured distinctly, and toggled
 * back off — or honestly recorded as unavailable. Soil is part of the Phase 5
 * required set; it was previously never attempted in the one-pass capture.
 */
export const OVERLAY_CAPTURE_PLAN: readonly PlannedOverlayCapture[] = [
  { overlay: 'Contour Lines', candidates: ['Contour Lines', 'Contours'], purpose: 'landportal_overlay_contour_lines' },
  { overlay: 'Wetlands', candidates: ['Wetlands'], purpose: 'landportal_overlay_wetlands' },
  { overlay: 'FEMA Floodplain', candidates: ['FEMA Floodplain', 'FEMA Flood Zones'], purpose: 'landportal_overlay_fema_floodplain' },
  { overlay: 'Soil', candidates: ['Soil Type', 'Soil', 'Soils', 'Soil Survey'], purpose: 'landportal_overlay_soil' },
];

export interface PlannedBoundaryContextCapture {
  /** Stable capture label / inspection key. */
  label: 'zip_boundary_context' | 'city_boundary_context' | 'county_boundary_context';
  /** Operator-facing name for the geography. */
  boundary: string;
  /** Control-name candidates in the Basemaps & Overlays dialog ("Enable X"). */
  candidates: string[];
  /** Zoom steps OUT from the parcel Fit. Each step doubles the linear ground
   *  extent, so these deliberately exceed MAX_STANDARD_ZOOM_OUT_STEPS: the
   *  whole point is "where inside this geography does the subject sit". The
   *  county frame needs the widest camera; the ZIP the narrowest. The subject
   *  stays marked by LandPortal's own pin, so it remains identifiable. */
  zoomOutSteps: number;
  purpose: string;
}

/**
 * Boundary-context captures: the subject's position INSIDE its ZIP, city and
 * county, using LandPortal's own boundary overlays (control names proven live:
 * "ZIP Boundaries", "City Limits", "County Boundaries"). Each is attempted,
 * rendered distinctly, and captured — or honestly recorded as unavailable when
 * LandPortal exposes no such boundary for the property. Never manufactured.
 */
export const BOUNDARY_CONTEXT_PLAN: readonly PlannedBoundaryContextCapture[] = [
  {
    label: 'zip_boundary_context',
    boundary: 'ZIP code boundary',
    candidates: ['ZIP Boundaries', 'Zip Boundaries', 'ZIP Codes', 'Zip Codes'],
    zoomOutSteps: 4,
    purpose: 'landportal_zip_boundary_context',
  },
  {
    label: 'city_boundary_context',
    boundary: 'City / municipal boundary',
    candidates: ['City Limits', 'City Boundaries', 'Municipal Boundaries'],
    zoomOutSteps: 5,
    purpose: 'landportal_city_boundary_context',
  },
  {
    label: 'county_boundary_context',
    boundary: 'County boundary',
    candidates: ['County Boundaries', 'County Lines'],
    zoomOutSteps: 6,
    purpose: 'landportal_county_boundary_context',
  },
];

/**
 * Distinctness gate: an overlay screenshot that is byte-identical to the base
 * parcel capture — or to ANY earlier capture in the same pass — proves the
 * toggled layer never painted anything. Such an image must never be promoted
 * under an overlay label; the overlay is recorded as unavailable instead.
 */
export function isDistinctOverlayCapture(candidateSha256: string, priorSha256s: Iterable<string>): boolean {
  if (!candidateSha256) return false;
  for (const prior of priorSha256s) {
    if (prior && prior === candidateSha256) return false;
  }
  return true;
}

export type ParcelVisualCaptureKind = 'parcel_context' | 'comps_map' | 'overlay' | 'terrain';

/** Minimum bytes required before a rendered frame can enter the current visual
 * snapshot. Parcel/overlay/terrain captures include a full 1600×1000 map and
 * must be materially larger than page chrome; the comps map has a lower bound
 * because its result panel can reduce the painted-map area. */
export const MIN_PARCEL_VISUAL_BYTES: Readonly<Record<ParcelVisualCaptureKind, number>> = {
  parcel_context: 500_000,
  comps_map: 64_000,
  overlay: 500_000,
  terrain: 500_000,
};

export interface ParcelVisualQualityVerdict {
  accepted: boolean;
  reason: string | null;
}

export interface SavedParcelVisualInspection extends ParcelVisualQualityVerdict {
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
}

/**
 * The capture viewport used for every retained property visual.
 *
 * LandPortal renders its parcel fact panel down the left edge and the map into
 * whatever remains, so a 1600x1000 browser viewport isolated a roughly square
 * map canvas. That square is the "tight" capture the Deal Overview hero then
 * had to letterbox, blur-fill or crop. Opening the browser wider makes the map
 * canvas itself landscape, so the SAME capture is Overview-ready the first
 * time: the whole subject parcel with padding, in a wide frame.
 */
export const OVERVIEW_HERO_VIEWPORT = { width: 2200, height: 1040 } as const;

/**
 * Minimum width:height the retained Overview hero capture must reach. The
 * hero renders in a wide landscape band; anything squarer than this is the old
 * tight format and forces the presentation compromises above.
 */
export const OVERVIEW_HERO_MIN_ASPECT = 1.7;

/**
 * Trim an isolated map clip down to the wide Overview hero frame.
 *
 * The camera has already fitted the subject and stepped out (see
 * contextZoomOutSteps), so the subject occupies roughly a quarter of the frame
 * about its center with neighbouring parcels and the fronting road around it.
 * Reducing height about that same center therefore keeps the complete subject
 * boundary and its padding in frame while producing the landscape aspect the
 * hero wants. Full clip width is always kept, nothing is scaled, and a clip
 * that is already wide enough is returned unchanged — so this can never crop a
 * capture that did not need it.
 */
export function overviewHeroClip(clip: MapViewportClip, viewport: { width: number; height: number }): MapViewportClip {
  if (!(clip.width > 0 && clip.height > 0)) return clip;
  if (clip.width / clip.height >= OVERVIEW_HERO_MIN_ASPECT) return clip;
  const targetHeight = Math.max(1, Math.floor(clip.width / OVERVIEW_HERO_MIN_ASPECT));
  if (targetHeight >= clip.height) return clip;
  const centered = Math.floor(clip.y + (clip.height - targetHeight) / 2);
  const y = Math.max(0, Math.min(centered, Math.max(0, viewport.height - targetHeight)));
  return { x: clip.x, y, width: clip.width, height: targetHeight };
}

/** Is this retained capture usable as the wide Overview hero as saved? */
export function isOverviewHeroFramed(size: { width: number; height: number } | null | undefined): boolean {
  if (!size || !(size.width > 0) || !(size.height > 0)) return false;
  return size.width / size.height >= OVERVIEW_HERO_MIN_ASPECT;
}

export interface MapViewportClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Final browser-side framing gate before any screenshot is written. */
export function assessMapViewportFrame(input: {
  clip: MapViewportClip | null;
  viewport: { width: number; height: number };
  obstructions: string[];
}): ParcelVisualQualityVerdict {
  if (!input.clip) return { accepted: false, reason: 'capture rejected: no rendered map viewport could be isolated.' };
  const { x, y, width, height } = input.clip;
  const withinViewport = x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= input.viewport.width + 1
    && y + height <= input.viewport.height + 1;
  if (!withinViewport || width < 600 || height < 400) {
    return { accepted: false, reason: 'capture rejected: the isolated map viewport is missing, clipped, or too small to show parcel context.' };
  }
  if (input.obstructions.length) {
    return {
      accepted: false,
      reason: `capture rejected: ${input.obstructions.join(', ')} still obstructs the useful map viewport.`,
    };
  }
  return { accepted: true, reason: null };
}

/**
 * Inspect the PNG that was actually written, rather than trusting that a
 * successful browser screenshot call produced the requested crop. Chromium
 * writes PNG dimensions in the IHDR header, so this gate needs no image
 * decoder and can reject a full-page frame, truncated file, blank shell, or
 * relabelled overlay before the path is persisted.
 */
export function inspectSavedParcelVisual(input: {
  filePath: string;
  kind: ParcelVisualCaptureKind;
  expectedClip: MapViewportClip;
  priorSha256s?: Iterable<string>;
}): SavedParcelVisualInspection {
  let bytes = 0;
  let width: number | null = null;
  let height: number | null = null;
  let sha256: string | null = null;
  try {
    const file = fs.readFileSync(input.filePath);
    bytes = file.length;
    const pngSignature = file.length >= 24
      && file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!pngSignature || file.toString('ascii', 12, 16) !== 'IHDR') {
      return { accepted: false, reason: 'capture rejected: saved image is not a readable PNG.', bytes, width, height, sha256 };
    }
    width = file.readUInt32BE(16);
    height = file.readUInt32BE(20);
    sha256 = crypto.createHash('sha256').update(file).digest('hex');
  } catch {
    return { accepted: false, reason: 'capture rejected: saved image could not be read back for inspection.', bytes, width, height, sha256 };
  }

  // A connected Chrome profile can render at deviceScaleFactor > 1. Accept a
  // uniformly scaled crop, but reject a full-page/aspect-mismatched image.
  const widthScale = width / input.expectedClip.width;
  const heightScale = height / input.expectedClip.height;
  const uniformScale = widthScale >= 0.5 && widthScale <= 4
    && heightScale >= 0.5 && heightScale <= 4
    && Math.abs(widthScale - heightScale) <= 0.02;
  if (!uniformScale) {
    return {
      accepted: false,
      reason: `capture rejected: saved PNG is ${width}×${height}, not a uniformly scaled rendering of the isolated ${Math.round(input.expectedClip.width)}×${Math.round(input.expectedClip.height)} map viewport.`,
      bytes, width, height, sha256,
    };
  }
  const quality = assessParcelVisualCapture({
    kind: input.kind,
    bytes,
    sha256,
    priorSha256s: input.priorSha256s,
  });
  return { ...quality, bytes, width, height, sha256 };
}

/** File-level quality gate shared by live and persistence-derived visual reads.
 * It cannot prove semantics by bytes alone; the browser capture supplies the
 * parcel-panel/map/zoom checks. It does prove that a tiny shell/blank frame or
 * byte-identical relabel is never promoted. */
export function assessParcelVisualCapture(input: {
  kind: ParcelVisualCaptureKind;
  bytes: number;
  sha256?: string | null;
  priorSha256s?: Iterable<string>;
}): ParcelVisualQualityVerdict {
  const minimum = MIN_PARCEL_VISUAL_BYTES[input.kind];
  if (!Number.isFinite(input.bytes) || input.bytes < minimum) {
    return {
      accepted: false,
      reason: `capture rejected: ${input.kind.replace(/_/g, ' ')} image is ${Math.max(0, Number(input.bytes) || 0).toLocaleString()} bytes; at least ${minimum.toLocaleString()} bytes are required to rule out an unpainted shell.`,
    };
  }
  if (input.kind === 'overlay') {
    if (!input.sha256) {
      return { accepted: false, reason: 'capture rejected: overlay file could not be hashed, so distinct layer rendering cannot be proven.' };
    }
    if (!isDistinctOverlayCapture(input.sha256, input.priorSha256s ?? [])) {
      return { accepted: false, reason: 'capture rejected: overlay is byte-identical to the base map or an earlier layer; no distinct overlay image exists.' };
    }
  }
  return { accepted: true, reason: null };
}

/** SHA-256 of a captured screenshot file (hex). Throws if unreadable. */
export function fileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
