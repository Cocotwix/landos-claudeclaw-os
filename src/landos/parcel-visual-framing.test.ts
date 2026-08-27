import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contextZoomOutSteps,
  surroundingAreaZoomOutSteps,
  MAX_STANDARD_ZOOM_OUT_STEPS,
  assessMapViewportFrame,
  assessParcelVisualCapture,
  fileSha256,
  inspectSavedParcelVisual,
  isDistinctOverlayCapture,
  OVERLAY_CAPTURE_PLAN,
  parseAcresFromFields,
  overviewHeroClip,
  isOverviewHeroFramed,
  OVERVIEW_HERO_VIEWPORT,
  OVERVIEW_HERO_MIN_ASPECT,
} from './parcel-visual-framing.js';

// Phase 5 Item 21 screenshot correction: parcel-scale framing + overlay
// distinctness, tested without a live browser.

describe('contextZoomOutSteps', () => {
  it('frames a typical land parcel two steps out from Fit (subject ~1/4 frame, ~5-8 neighbors + road)', () => {
    expect(contextZoomOutSteps(12.28)).toBe(2); // Deal 32 (Roane) subject
    expect(contextZoomOutSteps(6.14)).toBe(2);
    expect(contextZoomOutSteps(30.7)).toBe(2);
  });

  it('defaults to two steps when acreage is unknown', () => {
    expect(contextZoomOutSteps(null)).toBe(2);
    expect(contextZoomOutSteps(Number.NaN)).toBe(2);
  });

  it('steps out only once for a very large parcel whose fit already spans wide context', () => {
    expect(contextZoomOutSteps(150)).toBe(1);
    expect(contextZoomOutSteps(640)).toBe(1);
  });

  it('never returns the former county-scale five-step zoom for any acreage', () => {
    for (const acres of [null, 0.25, 1, 5, 12.28, 40, 100, 150, 1000]) {
      const steps = contextZoomOutSteps(acres);
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(steps).toBeLessThanOrEqual(2);
    }
  });
});

describe('surroundingAreaZoomOutSteps', () => {
  it('is always WIDER than the parcel-context frame, for every acreage', () => {
    for (const acres of [null, 0.25, 1, 6.14, 12.28, 40, 75.91, 100, 150, 640, 1000]) {
      expect(surroundingAreaZoomOutSteps(acres)).toBeGreaterThan(contextZoomOutSteps(acres));
    }
  });

  it('stays at neighborhood scale and never reaches the county-scale zoom', () => {
    for (const acres of [null, 0.25, 6.14, 75.91, 150, 1000]) {
      const steps = surroundingAreaZoomOutSteps(acres);
      expect(steps).toBeLessThanOrEqual(MAX_STANDARD_ZOOM_OUT_STEPS);
      // Five steps out from Fit is 32x the fitted extent: the county-scale
      // defect. The surrounding-area frame must never be that.
      expect(steps).toBeLessThan(5);
    }
  });

  it('reaches the same neighborhood frame from either parcel-context baseline', () => {
    // A 6-acre parcel fits tight and a 640-acre parcel fits wide, so their
    // context baselines differ; the surrounding-area frame is defined by the
    // area an operator needs to see, not by how tight the fit started.
    expect(surroundingAreaZoomOutSteps(6.14)).toBe(MAX_STANDARD_ZOOM_OUT_STEPS);
    expect(surroundingAreaZoomOutSteps(640)).toBe(MAX_STANDARD_ZOOM_OUT_STEPS);
  });
});

describe('parseAcresFromFields', () => {
  it('reads the exact Acres field from the LandPortal fact sheet', () => {
    expect(parseAcresFromFields({ Acres: '12.28', Owner: 'SACHAN DILEEP S' })).toBe(12.28);
  });

  it('prefers Acres over MLS Acres but falls back to it', () => {
    expect(parseAcresFromFields({ 'MLS Acres': '13.10', Acres: '12.28' })).toBe(12.28);
    expect(parseAcresFromFields({ 'MLS Acres': '13.10' })).toBe(13.1);
  });

  it('handles thousands separators and unit suffixes', () => {
    expect(parseAcresFromFields({ Acres: '1,024.5 acres' })).toBe(1024.5);
  });

  it('returns null when no acreage is stated rather than guessing', () => {
    expect(parseAcresFromFields({})).toBeNull();
    expect(parseAcresFromFields({ Acres: 'N/A' })).toBeNull();
    expect(parseAcresFromFields({ Acres: '0' })).toBeNull();
  });
});

describe('OVERLAY_CAPTURE_PLAN', () => {
  it('covers the full Phase 5 required overlay set including Soil', () => {
    const overlays = OVERLAY_CAPTURE_PLAN.map((p) => p.overlay);
    expect(overlays).toContain('FEMA Floodplain');
    expect(overlays).toContain('Wetlands');
    expect(overlays).toContain('Soil');
    expect(overlays).toContain('Contour Lines');
  });

  it('gives every planned overlay a unique purpose key and at least one control-name candidate', () => {
    const purposes = new Set(OVERLAY_CAPTURE_PLAN.map((p) => p.purpose));
    expect(purposes.size).toBe(OVERLAY_CAPTURE_PLAN.length);
    for (const planned of OVERLAY_CAPTURE_PLAN) {
      expect(planned.candidates.length).toBeGreaterThan(0);
      expect(planned.purpose).toMatch(/^landportal_overlay_/);
    }
  });
});

describe('isDistinctOverlayCapture', () => {
  it('rejects a capture identical to the base parcel image', () => {
    expect(isDistinctOverlayCapture('abc', ['abc'])).toBe(false);
  });

  it('rejects a capture identical to ANY earlier overlay in the same pass (no cross-label reuse)', () => {
    expect(isDistinctOverlayCapture('fema-hash', ['base-hash', 'wetlands-hash', 'fema-hash'])).toBe(false);
  });

  it('accepts a capture whose bytes differ from every prior capture', () => {
    expect(isDistinctOverlayCapture('soil-hash', ['base-hash', 'wetlands-hash'])).toBe(true);
    expect(isDistinctOverlayCapture('first-overlay', [])).toBe(true);
  });

  it('rejects an empty hash (an unreadable capture is never promoted)', () => {
    expect(isDistinctOverlayCapture('', ['base-hash'])).toBe(false);
  });
});

describe('assessParcelVisualCapture', () => {
  it('rejects a tiny parcel shell and accepts a materially painted parcel frame', () => {
    expect(assessParcelVisualCapture({ kind: 'parcel_context', bytes: 40_000 }).accepted).toBe(false);
    expect(assessParcelVisualCapture({ kind: 'parcel_context', bytes: 700_000 }).accepted).toBe(true);
  });

  it('rejects an overlay whose bytes duplicate the base image', () => {
    const verdict = assessParcelVisualCapture({
      kind: 'overlay',
      bytes: 700_000,
      sha256: 'same',
      priorSha256s: ['same'],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/byte-identical/i);
  });

  it('requires a readable overlay hash before a layer can be promoted', () => {
    expect(assessParcelVisualCapture({ kind: 'overlay', bytes: 700_000, sha256: null }).reason).toMatch(/could not be hashed/i);
  });

  it('accepts a distinct, fully painted thematic layer', () => {
    expect(assessParcelVisualCapture({
      kind: 'overlay',
      bytes: 700_000,
      sha256: 'wetlands',
      priorSha256s: ['base', 'fema'],
    }).accepted).toBe(true);
  });
});

describe('assessMapViewportFrame', () => {
  it('accepts a clean, large map-only viewport', () => {
    expect(assessMapViewportFrame({
      clip: { x: 420, y: 80, width: 1160, height: 880 },
      viewport: { width: 1600, height: 1000 },
      obstructions: [],
    }).accepted).toBe(true);
  });

  it('rejects ads, modals, chat widgets, and other retained obstructions', () => {
    const verdict = assessMapViewportFrame({
      clip: { x: 420, y: 80, width: 1160, height: 880 },
      viewport: { width: 1600, height: 1000 },
      obstructions: ['skip-tracing offer'],
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/skip-tracing/i);
  });

  it('rejects a full-page or unusably small crop when no real map viewport was isolated', () => {
    expect(assessMapViewportFrame({
      clip: null,
      viewport: { width: 1600, height: 1000 },
      obstructions: [],
    }).accepted).toBe(false);
    expect(assessMapViewportFrame({
      clip: { x: 0, y: 0, width: 500, height: 300 },
      viewport: { width: 1600, height: 1000 },
      obstructions: [],
    }).accepted).toBe(false);
  });
});

describe('fileSha256', () => {
  it('produces identical hashes only for identical bytes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-framing-'));
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    const c = path.join(dir, 'c.png');
    fs.writeFileSync(a, 'same-bytes');
    fs.writeFileSync(b, 'same-bytes');
    fs.writeFileSync(c, 'different-bytes');
    try {
      expect(fileSha256(a)).toBe(fileSha256(b));
      expect(fileSha256(a)).not.toBe(fileSha256(c));
      expect(isDistinctOverlayCapture(fileSha256(c), [fileSha256(a)])).toBe(true);
      expect(isDistinctOverlayCapture(fileSha256(b), [fileSha256(a)])).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('inspectSavedParcelVisual', () => {
  it('reads back the saved PNG and accepts only the requested map-crop dimensions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-saved-visual-'));
    const file = path.join(dir, 'map.png');
    const png = Buffer.alloc(600_000, 17);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(960, 16);
    png.writeUInt32BE(720, 20);
    fs.writeFileSync(file, png);

    expect(inspectSavedParcelVisual({
      filePath: file,
      kind: 'parcel_context',
      expectedClip: { x: 400, y: 0, width: 960, height: 720 },
    })).toMatchObject({ accepted: true, width: 960, height: 720, bytes: 600_000 });
    expect(inspectSavedParcelVisual({
      filePath: file,
      kind: 'parcel_context',
      expectedClip: { x: 0, y: 0, width: 1600, height: 1000 },
    }).reason).toMatch(/not a uniformly scaled rendering/i);
  });

  it('rejects a corrupt or unreadable saved image', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-saved-visual-bad-'));
    const file = path.join(dir, 'bad.png');
    fs.writeFileSync(file, Buffer.from('not an image'));
    expect(inspectSavedParcelVisual({
      filePath: file,
      kind: 'parcel_context',
      expectedClip: { x: 0, y: 0, width: 900, height: 700 },
    }).accepted).toBe(false);
  });
});

// ── Overview-ready capture framing ────────────────────────────────────────
// The Deal Overview hero is a wide landscape band. A capture saved in the old
// roughly-square format can only be presented there by letterboxing, blurred
// filler, cropping or stretching, so the capture workflow itself must retain
// the Overview version wide and whole-parcel the first time.
describe('Overview hero capture framing', () => {
  it('opens the capture browser wide enough for a landscape map canvas', () => {
    expect(OVERVIEW_HERO_VIEWPORT.width / OVERVIEW_HERO_VIEWPORT.height)
      .toBeGreaterThanOrEqual(OVERVIEW_HERO_MIN_ASPECT);
    // Wider than the former 1600x1000 capture viewport, which left LandPortal's
    // map canvas roughly square once the parcel panel took the left edge.
    expect(OVERVIEW_HERO_VIEWPORT.width).toBeGreaterThan(1600);
  });

  it('retains a tight square map clip as a wide whole-parcel hero frame', () => {
    // The old tight format: LandPortal's map canvas beside the parcel panel.
    const clip = overviewHeroClip({ x: 420, y: 60, width: 1060, height: 900 }, { width: 2200, height: 1040 });
    expect(clip.width).toBe(1060);
    expect(clip.width / clip.height).toBeGreaterThanOrEqual(OVERVIEW_HERO_MIN_ASPECT);
    expect(isOverviewHeroFramed(clip)).toBe(true);
    // Trimmed about the same center the camera fitted the parcel to, and never
    // scaled: full clip width is kept, so the parcel is not distorted.
    expect(clip.x).toBe(420);
    expect(clip.y).toBeGreaterThan(60);
    expect(clip.y + clip.height).toBeLessThanOrEqual(1040);
  });

  it('never crops a capture that is already Overview-ready', () => {
    const wide = { x: 0, y: 0, width: 1900, height: 800 };
    expect(overviewHeroClip(wide, { width: 2200, height: 1040 })).toEqual(wide);
  });

  it('rejects the old tight format as an Overview hero frame', () => {
    expect(isOverviewHeroFramed({ width: 1060, height: 900 })).toBe(false);
    expect(isOverviewHeroFramed(null)).toBe(false);
  });

  it('is the framing the live LandPortal capture workflow actually saves', () => {
    const session = readFileSync('src/landos/browser-session.ts', 'utf8');
    expect(session).toContain('OVERVIEW_HERO_VIEWPORT.width');
    expect(session).toContain('const heroClip = overviewHeroClip(frame.clip, frame.viewport)');
    expect(session).toContain('await page.screenshot({ path: file, clip: heroClip })');
    expect(session).toContain('expectedClip: heroClip');
    // The former tight capture viewport is gone from the workflow.
    expect(session).not.toContain('setViewport?.({ width: 1600, height: 1000 })');
  });
});
