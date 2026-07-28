// Phase 5 regression: the LandPortal SUBJECT search must try the county-local
// APN spelling, not only the confirmed state form.
//
// Live failure this pins (Deal 57, 2026-07-27): the identity lane confirmed the
// state-form APN 073060 05808 (TN Comptroller), but LandPortal indexes the
// county-local form (060 05808). The subject search tried apn/address/owner
// with only the state form, verified no parcel, and the whole visual/comp
// pipeline behind parcel verification — parcel-context screenshot, comp map,
// FEMA/Wetlands/Soil/Contours overlays, 3D terrain — produced nothing. The
// equivalence rule was already proven on Deal 32 (073090 04200 ↔ 090 04200);
// this generates the search spelling that rule implies.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { jurisdictionLocalApnVariants, apnEquivalent } from './property-intelligence-snapshot.js';

describe('jurisdictionLocalApnVariants', () => {
  it('derives the proven Deal 32 county-local spelling from the state form', () => {
    expect(jurisdictionLocalApnVariants('073090 04200')).toEqual(['090 04200']);
  });

  it('derives the Deal 57 county-local spelling that the live search was missing', () => {
    expect(jurisdictionLocalApnVariants('073060 05808')).toEqual(['060 05808']);
  });

  it('every emitted variant denotes the SAME parcel as the input', () => {
    for (const apn of ['073090 04200', '073060 05808', '015027 04512']) {
      for (const variant of jurisdictionLocalApnVariants(apn)) {
        expect(apnEquivalent(apn, variant)).toBe(true);
      }
    }
  });

  it('never invents a variant for a county-local, short, letter-led, or empty APN', () => {
    // Already county-local: stripping again would name a DIFFERENT parcel.
    expect(jurisdictionLocalApnVariants('090 04200')).toEqual([]);
    // First token too short to carry a county prefix plus a real identifier.
    expect(jurisdictionLocalApnVariants('094-020.08')).toEqual([]);
    // Letter-led APNs are outside the numeric prefix convention.
    expect(jurisdictionLocalApnVariants('R1234-567A')).toEqual([]);
    expect(jurisdictionLocalApnVariants('')).toEqual([]);
    expect(jurisdictionLocalApnVariants(null)).toEqual([]);
    expect(jurisdictionLocalApnVariants(undefined)).toEqual([]);
  });

  it('keeps the remaining identifier substantial (no tiny fragment can verify a parcel)', () => {
    // 6-digit first token with nothing after it: local form "060" alone is too
    // small to be a parcel identifier, so nothing is emitted.
    expect(jurisdictionLocalApnVariants('073060')).toEqual([]);
  });
});

describe('subject search wiring (source contract)', () => {
  const routesSource = readFileSync(path.join(__dirname, 'routes.ts'), 'utf8');

  it('the canonical LandPortal inspection passes county-local variants to the parcel search', () => {
    expect(routesSource).toContain('apnAlternates: jurisdictionLocalApnVariants(searchKey.apn)');
    const uses = routesSource.match(/apnAlternates: jurisdictionLocalApnVariants\(searchKey\.apn\)/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(routesSource).toMatch(
      /captureLandPortalInspection:[\s\S]{0,2600}apnAlternates: jurisdictionLocalApnVariants\(searchKey\.apn\)[\s\S]{0,900}mode: 'deep_record'/,
    );
  });
});
