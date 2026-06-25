import { describe, it, expect } from 'vitest';
import { runUnderwriting } from './underwriting-agent.js';

const LANES = [
  { id: 'flip_standard', label: 'Flip standard', offerLowUsd: 100000, offerHighUsd: 150000, applicable: true },
  { id: 'subdivide', label: 'Subdivide', offerLowUsd: 130000, offerHighUsd: 160000, applicable: true },
];

describe('Underwriting Agent (post-discovery scaffold)', () => {
  it('blocks an unverified parcel — no score/value/offer', () => {
    const d = runUnderwriting({ apn: 'APN-1', parcelVerified: false, discoveryCallSummary: 'x', expectedValueUsd: 200000, strategyLanes: LANES });
    expect(d.status).toBe('blocked_unverified');
    expect(d.approvedOfferHighUsd).toBeNull();
  });

  it('needs deeper DD when there is no discovery-call summary (underwriting is post-call)', () => {
    const d = runUnderwriting({ apn: 'APN-1', parcelVerified: true, expectedValueUsd: 200000, strategyLanes: LANES });
    expect(d.status).toBe('needs_deeper_dd');
  });

  it('needs deeper DD when evidence is insufficient (no EV / no applicable lane) — never fabricates', () => {
    const d = runUnderwriting({ apn: 'APN-1', parcelVerified: true, discoveryCallSummary: 'done', expectedValueUsd: null, strategyLanes: [] });
    expect(d.status).toBe('needs_deeper_dd');
    expect(d.approvedOfferLowUsd).toBeNull();
  });

  it('approves from the best applicable lane when verified + post-call + evidence present', () => {
    const d = runUnderwriting({ apn: 'APN-1', parcelVerified: true, discoveryCallSummary: 'seller motivated', expectedValueUsd: 200000, strategyLanes: LANES, newDisclosures: ['septic installed'] });
    expect(d.status).toBe('approved');
    expect(d.recommendedStrategy).toBe('Subdivide'); // highest ceiling
    expect(d.approvedOfferHighUsd).toBe(160000);
    expect(d.attachesToDealCard).toBe(true);
    expect(d.knowledgeKey).toBe('underwriting/APN-1/uw_decision.json');
    expect(d.talkingPoints.length).toBeGreaterThan(0);
  });

  it('is the property-specific output that attaches to the Deal Card (apn drives the key)', () => {
    const d = runUnderwriting({ apn: null, parcelVerified: true, discoveryCallSummary: 'x', expectedValueUsd: 200000, strategyLanes: LANES });
    expect(d.attachesToDealCard).toBe(false);
    expect(d.knowledgeKey).toBeNull();
  });
});
