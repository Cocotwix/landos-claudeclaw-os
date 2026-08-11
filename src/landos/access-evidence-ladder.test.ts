import { describe, expect, it } from 'vitest';
import { accessInvestigationTrigger, reconcileAccessEvidence, type AccessEvidenceItem } from './access-evidence-ladder.js';

const item = (tier: AccessEvidenceItem['tier'], overrides: Partial<AccessEvidenceItem> = {}): AccessEvidenceItem => ({
  tier, statement: `${tier} statement`, sourceLabel: 'Test source', sourceKind: 'other', basis: 'source_stated', weight: 'likely', ...overrides,
});

describe('accessInvestigationTrigger', () => {
  it('triggers for affirmative landlocked status', () => expect(accessInvestigationTrigger({ landlockedStatus: 'Yes' }).triggered).toBe(true));
  it('triggers for the complete LandPortal field text', () => expect(accessInvestigationTrigger({ landlockedStatus: 'Land Locked: Yes' }).triggered).toBe(true));
  it('triggers for zero frontage', () => expect(accessInvestigationTrigger({ roadFrontageFt: 0 }).triggered).toBe(true));
  it('triggers for a setback parcel', () => expect(accessInvestigationTrigger({ roadFrontageFt: 100, setbackFromRoad: true }).triggered).toBe(true));
  it('does not trigger for mapped frontage without a flag', () => expect(accessInvestigationTrigger({ landlockedStatus: 'No', roadFrontageFt: 120 }).triggered).toBe(false));
  it('requires both satellite and public-road Street View passes', () => {
    const result = accessInvestigationTrigger({ landlockedStatus: 'Yes' });
    expect(result.requiredSteps.join(' ')).toMatch(/driveways.*private access routes.*gates.*tracks.*mapped access lines/i);
    expect(result.requiredSteps.join(' ')).toMatch(/Street View.*nearest public road/i);
  });
});

describe('reconcileAccessEvidence', () => {
  it('retains every item and every tier key', () => {
    const result = reconcileAccessEvidence([item('parcel_flag'), item('parcel_flag'), item('reported_legal')]);
    expect(result.items).toHaveLength(3);
    expect(Object.keys(result.byTier)).toEqual(['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal']);
    expect(result.byTier.parcel_flag).toHaveLength(2);
  });
  it('does not turn imagery into verified legal access', () => {
    const result = reconcileAccessEvidence([item('verified_legal', { basis: 'direct_observation', sourceKind: 'satellite_imagery' })]);
    expect(result.verifiedLegalAccess).toBe(false);
    expect(result.conclusionWeight).not.toBe('confirmed');
  });
  it('verifies only a recorded instrument', () => {
    const result = reconcileAccessEvidence([item('verified_legal', { basis: 'recorded_instrument', sourceKind: 'official_record', weight: 'confirmed' })]);
    expect(result.verifiedLegalAccess).toBe(true);
    expect(result.conclusionWeight).toBe('confirmed');
    expect(result.outstanding).toEqual([]);
  });
  it('keeps reported listing access separate', () => {
    const result = reconcileAccessEvidence([item('reported_legal', { sourceKind: 'listing' })]);
    expect(result.reportedLegalAccess).toBe(true);
    expect(result.verifiedLegalAccess).toBe(false);
  });
  it('describes an apparent drive without calling it proven legal access', () => {
    const result = reconcileAccessEvidence([item('apparent_physical', { basis: 'direct_observation', sourceKind: 'street_view' })]);
    expect(result.apparentPhysicalAccess).toBe(true);
    expect(result.operatorConclusion).toMatch(/apparent physical drive/i);
    expect(result.operatorConclusion).toMatch(/imagery alone is not evidence of legal rights/i);
  });
  it('does not conclude no access from a parcel flag alone', () => {
    const result = reconcileAccessEvidence([item('parcel_flag', { sourceKind: 'landportal_parcel_flag' })]);
    expect(result.operatorConclusion).toMatch(/does not directly front a recognized named road/i);
    expect(result.operatorConclusion).not.toMatch(/property has no access\./i);
    expect(result.outstanding.join(' ')).toMatch(/recorded instrument/i);
  });
});
