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
  it('retains every distinct item and every tier key', () => {
    const result = reconcileAccessEvidence([
      item('parcel_flag', { statement: 'Land Locked: Yes.' }),
      item('parcel_flag', { statement: 'Road frontage reads 0 ft.', sourceLabel: 'LandPortal frontage row' }),
      item('reported_legal'),
    ]);
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

describe('the ladder is exactly four rungs a surface renders once', () => {
  it('always returns the four rungs in order, occupied or not', () => {
    const result = reconcileAccessEvidence([]);
    expect(result.rungs.map((rung) => rung.tier)).toEqual(['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal']);
    expect(result.rungs.every((rung) => rung.status === 'not_evidenced')).toBe(true);
    // An empty rung still says something honest rather than nothing.
    expect(result.rungs.every((rung) => rung.statement.length > 0)).toBe(true);
  });

  it('carries one statement per rung and never repeats it per source', () => {
    const result = reconcileAccessEvidence([
      item('apparent_physical', { basis: 'direct_observation', sourceKind: 'satellite_imagery', sourceLabel: 'LandPortal satellite', statement: 'A gravel drive is apparent.' }),
      item('apparent_physical', { basis: 'direct_observation', sourceKind: 'street_view', sourceLabel: 'Street View', statement: 'The drive meets the road.' }),
    ]);
    const rung = result.rungs.find((entry) => entry.tier === 'apparent_physical')!;
    expect(rung.items).toHaveLength(2);
    expect(rung.sources).toHaveLength(2);
    expect(result.operatorConclusion.split(rung.statement).length - 1).toBe(1);
  });

  it('collapses the identical explanation arriving from several places', () => {
    const duplicate = item('parcel_flag', { sourceKind: 'landportal_parcel_flag', statement: 'Land  Locked: Yes.' });
    const result = reconcileAccessEvidence([duplicate, { ...duplicate, statement: 'land locked: yes.' }, duplicate]);
    expect(result.items).toHaveLength(1);
    expect(result.rungs[0].sources).toHaveLength(1);
  });
});

describe('a visual claim is only evidence when someone actually looked at an image', () => {
  it('refuses an apparent route asserted from an interpretation rather than an observation', () => {
    const result = reconcileAccessEvidence([
      item('apparent_physical', { basis: 'reasonable_interpretation', sourceKind: 'street_view', statement: 'A gated entrance is present.' }),
    ]);
    expect(result.apparentPhysicalAccess).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/direct observation of retained imagery/i);
  });

  it('refuses imagery that claims to report a legal or easement right', () => {
    const result = reconcileAccessEvidence([
      item('reported_legal', { basis: 'direct_observation', sourceKind: 'satellite_imagery' }),
    ]);
    expect(result.reportedLegalAccess).toBe(false);
    expect(result.rejected[0].reason).toMatch(/imagery cannot report a legal or easement right/i);
  });

  it('refuses imagery labeled as a recorded instrument', () => {
    const result = reconcileAccessEvidence([
      item('verified_legal', { basis: 'recorded_instrument', sourceKind: 'street_view' }),
    ]);
    expect(result.verifiedLegalAccess).toBe(false);
    expect(result.rejected[0].reason).toMatch(/must come from the instrument itself/i);
  });

  it('requires the retained artifact when the caller asks for artifact-backed evidence', () => {
    const unbacked = item('apparent_physical', { basis: 'direct_observation', sourceKind: 'street_view' });
    expect(reconcileAccessEvidence([unbacked], { requireVisualArtifact: true }).items).toHaveLength(0);
    expect(reconcileAccessEvidence([unbacked], { requireVisualArtifact: true }).rejected[0].reason)
      .toMatch(/no retained image artifact/i);
    const backed = { ...unbacked, artifactRef: 'street_view' };
    const result = reconcileAccessEvidence([backed], { requireVisualArtifact: true });
    expect(result.items).toHaveLength(1);
    expect(result.rungs[1].sources[0].artifactRef).toBe('street_view');
  });

  it('never lets an apparent physical route become reported or verified legal access', () => {
    const result = reconcileAccessEvidence([
      item('apparent_physical', { basis: 'direct_observation', sourceKind: 'satellite_imagery', weight: 'well_supported' }),
    ]);
    expect(result.apparentPhysicalAccess).toBe(true);
    expect(result.reportedLegalAccess).toBe(false);
    expect(result.verifiedLegalAccess).toBe(false);
    expect(result.rungs[3].status).toBe('not_evidenced');
  });
});
