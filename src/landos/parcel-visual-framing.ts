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
  { overlay: 'Soil', candidates: ['Soil', 'Soils', 'Soil Survey'], purpose: 'landportal_overlay_soil' },
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
