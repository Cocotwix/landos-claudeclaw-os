import { describe, it, expect } from 'vitest';
import {
  buildAcreageBasis,
  checkOverlayConsistency,
  detectAcceptedOverwrite,
  materiallyDifferentAcres,
  pinOverlayAcresToGeometry,
} from './acreage-basis.js';

describe('pinOverlayAcresToGeometry (WS1 F1 regression — overlay acreage from geometry)', () => {
  it('recomputes a 100% zone against mapped geometry, not the persisted assessed acreage', () => {
    // Persisted flood zone from a run captured against 1.32 assessed acres.
    const zones = [{ zone: 'X', parcelPercentage: 100, approximateAcres: 1.32, specialFloodHazardArea: false }];
    const pinned = pinOverlayAcresToGeometry(zones, 1.15);
    expect(pinned[0].approximateAcres).toBe(1.15); // 1.15 * 100% — never exceeds geometry
    expect(pinned[0].zone).toBe('X');
  });
  it('scales a partial zone by its percentage', () => {
    const pinned = pinOverlayAcresToGeometry([{ zone: 'AE', parcelPercentage: 40, approximateAcres: 0.53 }], 1.15);
    expect(pinned[0].approximateAcres).toBe(0.46); // 1.15 * 0.4
  });
  it('leaves zones untouched when no mapped geometry is known (never fabricates)', () => {
    const zones = [{ zone: 'X', parcelPercentage: 100, approximateAcres: 1.32 }];
    expect(pinOverlayAcresToGeometry(zones, null)[0].approximateAcres).toBe(1.32);
  });
  it('never lets an overlay exceed the mapped geometry it is pinned to', () => {
    const pinned = pinOverlayAcresToGeometry([{ zone: 'X', parcelPercentage: 100, approximateAcres: 99 }], 1.15);
    expect(checkOverlayConsistency({ overlayLabel: 'FEMA flood', overlayAcres: pinned[0].approximateAcres, geometryAcres: 1.15 })).toBeNull();
  });
});

describe('materiallyDifferentAcres', () => {
  it('treats small survey/roll drift as immaterial', () => {
    expect(materiallyDifferentAcres(1.15, 1.16)).toBe(false); // ~0.9%, <0.1 ac
  });
  it('flags the assessed-vs-mapped gap on the acceptance example', () => {
    // 1.32 assessed vs 1.15 mapped: 0.17 ac / ~13% — material.
    expect(materiallyDifferentAcres(1.32, 1.15)).toBe(true);
  });
  it('needs BOTH absolute and relative floors cleared', () => {
    // 0.12 ac gap but only 0.6% on a 20 ac parcel → not material.
    expect(materiallyDifferentAcres(20.0, 20.12)).toBe(false);
  });
});

describe('buildAcreageBasis — acceptance example (1.32 assessed vs 1.15 mapped)', () => {
  const rec = buildAcreageBasis({
    assessed: { value: 1.32, source: 'Pickens County assessor roll' },
    gisGeometry: { value: 1.15, source: 'Pickens County GIS geometry' },
  });

  it('records both bases without dropping either', () => {
    const kinds = rec.entries.map((e) => e.kind);
    expect(kinds).toContain('assessed');
    expect(kinds).toContain('gis_geometry');
  });

  it('marks the size disputed and requires a Tyler decision', () => {
    expect(rec.disputed).toBe(true);
    expect(rec.tylerDecisionRequired).toBe(true);
    expect(rec.decision).toBeTruthy();
    expect(rec.decision!.toLowerCase()).toContain('survey');
  });

  it('explains WHY assessed and mapped differ', () => {
    expect(rec.explanation).toMatch(/assessed/i);
    expect(rec.explanation).toMatch(/mapped|gis|geometry/i);
    expect(rec.explanation.length).toBeGreaterThan(40);
  });

  it('binds overlays to the queried GIS geometry, not the assessed number', () => {
    expect(rec.overlayBasis).toBe('gis_geometry');
    const overlay = rec.entries.find((e) => e.kind === 'spatial_overlay');
    expect(overlay?.value).toBe(1.15);
  });

  it('discloses a valuation basis and forbids it as a gated number while disputed+unaccepted', () => {
    expect(rec.valuationBasis).not.toBeNull();
    const val = rec.entries.find((e) => e.kind === 'valuation');
    expect(val).toBeTruthy();
    // Not operator-accepted + disputed → only 'display', never 'valuation'.
    expect(val!.permittedUses).toEqual(['display']);
    expect(val!.limitation.toLowerCase()).toContain('disputed');
  });

  it('does not permit the disputed assessed basis to drive a gated calc', () => {
    const assessed = rec.entries.find((e) => e.kind === 'assessed');
    expect(assessed!.permittedUses).not.toContain('valuation');
    expect(assessed!.permittedUses).not.toContain('strategy_math');
    expect(assessed!.permittedUses).toContain('display');
  });
});

describe('buildAcreageBasis — operator-accepted governs', () => {
  const rec = buildAcreageBasis({
    assessed: { value: 1.32 },
    gisGeometry: { value: 1.15 },
    operatorAccepted: { value: 1.32, source: 'Tyler accepted (survey pending)' },
  });

  it('clears the Tyler decision once a value is accepted', () => {
    expect(rec.tylerDecisionRequired).toBe(false);
    expect(rec.decision).toBeNull();
  });

  it('routes display and valuation to the accepted basis', () => {
    expect(rec.displayBasis).toBe('operator_accepted');
    expect(rec.valuationBasis).toBe('operator_accepted');
  });

  it('keeps overlays on the GIS geometry even when an accepted value exists', () => {
    expect(rec.overlayBasis).toBe('gis_geometry');
  });

  it('permits the accepted basis for gated uses', () => {
    const accepted = rec.entries.find((e) => e.kind === 'operator_accepted');
    expect(accepted!.permittedUses).toContain('valuation');
    expect(accepted!.permittedUses).toContain('strategy_math');
    expect(accepted!.operatorAccepted).toBe(true);
  });
});

describe('buildAcreageBasis — reconciled (agreeing) bases', () => {
  const rec = buildAcreageBasis({
    assessed: { value: 5.0 },
    gisGeometry: { value: 5.02 },
  });
  it('does not fabricate a dispute when bases agree', () => {
    expect(rec.disputed).toBe(false);
    expect(rec.tylerDecisionRequired).toBe(false);
    expect(rec.explanation).toBe('');
  });
  it('allows assessed to inform valuation when undisputed', () => {
    const assessed = rec.entries.find((e) => e.kind === 'assessed');
    expect(assessed!.permittedUses).toContain('valuation');
  });
});

describe('checkOverlayConsistency', () => {
  it('flags an overlay area larger than its queried geometry', () => {
    const issue = checkOverlayConsistency({ overlayLabel: 'FEMA flood', overlayAcres: 1.32, geometryAcres: 1.15 });
    expect(issue).not.toBeNull();
    expect(issue!.code).toBe('overlay_exceeds_geometry');
    expect(issue!.message).toMatch(/cannot exceed/i);
  });
  it('passes when the overlay fits inside the geometry', () => {
    expect(checkOverlayConsistency({ overlayLabel: 'Wetlands', overlayAcres: 0.4, geometryAcres: 1.15 })).toBeNull();
  });
  it('respects a documented explanation', () => {
    const issue = checkOverlayConsistency({
      overlayLabel: 'FEMA flood',
      overlayAcres: 1.32,
      geometryAcres: 1.15,
      documentedExplanation: 'Overlay intentionally buffered 25 m per FEMA panel note.',
    });
    expect(issue).toBeNull();
  });
  it('tolerates tiny sampling slack', () => {
    expect(checkOverlayConsistency({ overlayLabel: 'Slope', overlayAcres: 1.16, geometryAcres: 1.15 })).toBeNull();
  });
  it('returns null when a value is missing (never a false positive)', () => {
    expect(checkOverlayConsistency({ overlayLabel: 'X', overlayAcres: null, geometryAcres: 1.15 })).toBeNull();
    expect(checkOverlayConsistency({ overlayLabel: 'X', overlayAcres: 1.0, geometryAcres: null })).toBeNull();
  });
});

describe('detectAcceptedOverwrite (operator-confirmation rule)', () => {
  it('blocks a silent replacement of an accepted acreage', () => {
    const issue = detectAcceptedOverwrite({ previouslyAccepted: 1.32, newGoverning: 1.15, reaccepted: false });
    expect(issue).not.toBeNull();
    expect(issue!.code).toBe('accepted_overwritten');
    expect(issue!.severity).toBe('blocker');
  });
  it('allows the change once re-accepted', () => {
    expect(detectAcceptedOverwrite({ previouslyAccepted: 1.32, newGoverning: 1.15, reaccepted: true })).toBeNull();
  });
  it('ignores immaterial drift', () => {
    expect(detectAcceptedOverwrite({ previouslyAccepted: 5.0, newGoverning: 5.02, reaccepted: false })).toBeNull();
  });
});
