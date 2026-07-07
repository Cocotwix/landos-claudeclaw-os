import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { resolveProperty, type ResolutionDeps } from './property-resolution-engine.js';
import { buildResolutionSnapshot, writeResolutionSnapshot, readResolutionSnapshot } from './resolution-snapshot.js';
import type { ParsedIntakeFields } from './intake-router.js';
import type { DukeVerificationResult } from './duke-verification-bridge.js';

beforeEach(() => { _initTestLandosDb(); });
const NOW = () => '2026-07-07T00:00:00.000Z';

function needsCounty(): DukeVerificationResult {
  return {
    status: 'unverified', parcelVerified: false,
    sourceAttempts: [], dataGaps: ['needs_county_or_fips'], marketPulseEligible: false,
    strategyUnderwritingBlocked: true, summary: 'Needs county/FIPS.', executionMode: 'duke_verification_read_only',
  };
}

// The Scott County TN scenario: county + a bare road name + an APN the operator
// pasted (with an alternate format), which no external source confirmed. It is a
// CANDIDATE — never Confirmed — so the Deal Card must open the Resolution view.
// The acquire route feeds ONE parsed-fields object to both the resolver and the
// snapshot builder — mirror that here.
const RAW = 'Henson Lane, Scott County TN, APN 094-020.08';
const FIELDS: ParsedIntakeFields = { address: 'Henson Lane', county: 'Scott', state: 'TN', apn: '094-020.08', apnAlternates: ['094 02008 000'] };

async function scottCountyResolution() {
  const deps: ResolutionDeps = {
    verify: async () => needsCounty(),      // Realie/LandPortal cannot verify
    deriveCounty: async () => null,          // no geocode for a house-number-less road
    suggest: async () => ({ query: 'Henson Lane', suggestions: [], source: 'none', cached: false }),
    now: NOW,
  };
  return resolveProperty({ fields: FIELDS }, deps);
}

describe('resolution snapshot — Scott County TN (candidate)', () => {
  it('captures what LandOS understood, sources searched, missing, and the smallest next identifier', async () => {
    const resolution = await scottCountyResolution();
    const snap = buildResolutionSnapshot(RAW, FIELDS, resolution);

    // ParcelIdentity state drives the gate — NOT confirmed.
    expect(snap.state).toBe('candidate');
    // What LandOS understood.
    expect(snap.parsed.county).toBe('Scott');
    expect(snap.parsed.state).toBe('TN');
    expect(snap.parsed.apn).toBe('094-020.08');
    expect(snap.parsed.apnAlternates).toContain('094 02008 000');
    // Basis is honest about not-confirmed.
    expect(snap.basis).toMatch(/not yet confirmed|geocoder proves where|not which parcel/i);
    // Sources searched are recorded with accept/reject notes.
    expect(snap.lanes.length).toBeGreaterThan(0);
    expect(snap.lanes.some((l) => l.lane === 'realie_landportal')).toBe(true);
    // A smallest next identifier is offered.
    expect(snap.smallestNextIdentifier).toBeTruthy();
  });

  it('persists and reloads the snapshot for the Deal Card', async () => {
    const resolution = await scottCountyResolution();
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Scott County lead', leadType: 'test' });
    const snap = buildResolutionSnapshot(RAW, FIELDS, resolution);
    writeResolutionSnapshot(deal.id, snap);
    const reloaded = readResolutionSnapshot(deal.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.state).toBe('candidate');
    expect(reloaded!.parsed.county).toBe('Scott');
    expect(readResolutionSnapshot(999999)).toBeNull();
  });
});
