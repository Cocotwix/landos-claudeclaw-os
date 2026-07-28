import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contextZoomOutSteps,
  assessParcelVisualCapture,
  fileSha256,
  isDistinctOverlayCapture,
  OVERLAY_CAPTURE_PLAN,
  parseAcresFromFields,
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
