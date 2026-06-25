import { describe, it, expect } from 'vitest';
import { runUnderwriting, type UnderwritingInput } from './underwriting-agent.js';

const LANES = [
  { id: 'flip', label: 'Flip standard', offerLowUsd: 100000, offerHighUsd: 150000, applicable: true },
  { id: 'subdivide', label: 'Subdivide', offerLowUsd: 130000, offerHighUsd: 160000, applicable: true },
];
const approvedInput = (o: Partial<UnderwritingInput> = {}): UnderwritingInput => ({
  apn: 'APN-1', parcelVerified: true, expectedValueUsd: 200000, strategyLanes: LANES,
  discoveryCallSummary: 'seller motivated, needs quick close', compsAttached: true, marketFactsAttached: true, ...o,
});

describe('operational underwriting', () => {
  it('approves with primary + secondary strategy and a max-offer ceiling', () => {
    const d = runUnderwriting(approvedInput());
    expect(d.status).toBe('approved');
    expect(d.recommendedStrategy).toBe('Subdivide'); // highest ceiling
    expect(d.secondaryStrategy).toBe('Flip standard');
    expect(d.maxOfferUsd).toBe(160000);
    expect(d.approvedBy).toBe('deterministic_gate'); // never a model
  });

  it('emits a Deal Card underwriting_snapshot event', () => {
    const d = runUnderwriting(approvedInput());
    expect(d.dealCardEvent?.eventType).toBe('underwriting_snapshot');
    expect(d.dealCardEvent?.summary).toMatch(/Underwriting approved/);
  });

  it('labels missing facts instead of fabricating them', () => {
    const d = runUnderwriting(approvedInput({ compsAttached: false, marketFactsAttached: false }));
    expect(d.missingFacts).toEqual(expect.arrayContaining(['comparable sales', 'market metrics']));
    expect(d.requiredVerification.some((v) => /comparable sales|market metrics/.test(v))).toBe(true);
  });

  it('always requires legal/zoning/title verification (never asserts certainty)', () => {
    const d = runUnderwriting(approvedInput());
    expect(d.requiredVerification.some((v) => /legal access, zoning, and clean title/i.test(v))).toBe(true);
  });

  it('treats a deal-killer constraint as needs_deeper_dd, not approved', () => {
    const d = runUnderwriting(approvedInput({ knownConstraints: ['No legal access to the parcel'] }));
    expect(d.status).toBe('needs_deeper_dd');
    expect(d.dealKillers).toContain('No legal access to the parcel');
    expect(d.approvedOfferHighUsd).toBeNull();
  });

  it('routes non-killer constraints to risks + required verification', () => {
    const d = runUnderwriting(approvedInput({ knownConstraints: ['Zoning may limit density'] }));
    expect(d.status).toBe('approved');
    expect(d.risks).toContain('Zoning may limit density');
    expect(d.requiredVerification.some((v) => /Zoning may limit density/.test(v))).toBe(true);
  });

  it('still blocks unverified parcels and gates pre-call', () => {
    expect(runUnderwriting(approvedInput({ parcelVerified: false })).status).toBe('blocked_unverified');
    expect(runUnderwriting(approvedInput({ discoveryCallSummary: null })).status).toBe('needs_deeper_dd');
  });
});
