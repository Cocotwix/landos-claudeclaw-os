import { describe, expect, it } from 'vitest';
import {
  accessInvestigationTrigger,
  admitAccessEvidence,
  isVisualAccessSource,
  reconcileAccessEvidence,
  type AccessEvidenceItem,
} from './access-evidence-ladder.js';

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
    const result = reconcileAccessEvidence([item('parcel_flag', {
      sourceKind: 'landportal_parcel_flag',
      statement: 'LandPortal flags the parcel as landlocked because it does not directly front a recognized named road.',
    })]);
    expect(result.operatorConclusion).toMatch(/does not directly front a recognized named road/i);
    expect(result.operatorConclusion).not.toMatch(/property has no access\./i);
    expect(result.outstanding.join(' ')).toMatch(/recorded instrument/i);
  });
});

describe('rung 1 repeats the condition the parcel source stated', () => {
  it('carries the source-stated condition verbatim instead of a canned landlocked sentence', () => {
    const result = reconcileAccessEvidence([item('parcel_flag', {
      sourceKind: 'landportal_parcel_flag',
      statement: 'Land Locked: No. Road frontage reads 264 ft on Elk Lake Road',
    })]);
    const rung = result.rungs[0];
    expect(rung.statement).toMatch(/Land Locked: No\. Road frontage reads 264 ft on Elk Lake Road\./);
    expect(rung.statement).not.toMatch(/flags this parcel as land locked/i);
    // The rung still refuses to read a parcel condition as an access verdict.
    expect(rung.statement).toMatch(/does not establish the absence of physical or legal access/i);
  });

  it('keeps each retained parcel statement once, in one sentence group', () => {
    const result = reconcileAccessEvidence([
      item('parcel_flag', { sourceKind: 'landportal_parcel_flag', statement: 'Land Locked: Yes.' }),
      item('parcel_flag', { sourceKind: 'landportal_parcel_flag', sourceLabel: 'Frontage row', statement: 'Road frontage reads 0 ft.' }),
    ]);
    expect(result.rungs[0].statement).toMatch(/Land Locked: Yes\. Road frontage reads 0 ft\./);
    expect(result.operatorConclusion.split(result.rungs[0].statement).length - 1).toBe(1);
  });

  it('refuses an observation or interpretation filed as the parcel record\'s own condition', () => {
    const observed = reconcileAccessEvidence([item('parcel_flag', {
      sourceKind: 'landportal_parcel_flag', basis: 'reasonable_interpretation', statement: 'The parcel looks landlocked.',
    })]);
    expect(observed.parcelFlagged).toBe(false);
    expect(observed.rejected[0].reason).toMatch(/only the condition the parcel source itself states/i);
    const imagery = reconcileAccessEvidence([item('parcel_flag', { sourceKind: 'satellite_imagery', basis: 'direct_observation' })]);
    expect(imagery.parcelFlagged).toBe(false);
    expect(imagery.rejected[0].reason).toMatch(/imagery does not state the parcel record/i);
  });
});

describe('a rung never quotes the source page instead of the property', () => {
  const navigation = 'Saved Searches Suggestions Agent and Co-Shopper Advertise Add a Note Driving '
    + 'Directions Create Valuation Report Claim this Home Copy Link Estimated payment $8,260/month';

  it('refuses a statement made of the page\'s own navigation, stored or fresh', () => {
    const admission = admitAccessEvidence(item('apparent_physical', {
      sourceKind: 'listing', basis: 'source_stated', statement: navigation,
    }));
    expect(admission.admitted).toBe(false);
    expect(admission.refusedReason).toMatch(/navigation or boilerplate/i);
    expect(reconcileAccessEvidence([item('apparent_physical', {
      sourceKind: 'listing', basis: 'source_stated', statement: navigation,
    })]).apparentPhysicalAccess).toBe(false);
  });

  it('still admits real listing driveway wording', () => {
    expect(admitAccessEvidence(item('apparent_physical', {
      sourceKind: 'listing',
      basis: 'source_stated',
      statement: 'A gravel drive runs from Elk Lake Rd to the house past the greenhouses.',
    })).admitted).toBe(true);
  });
});

describe('rung 2 accepts listing-derived support without becoming a legal right', () => {
  it('carries listing driveway and directions wording as apparent physical support', () => {
    const result = reconcileAccessEvidence([item('apparent_physical', {
      sourceKind: 'listing', basis: 'source_stated', statement: 'Listing directions: turn left onto the dirt drive at the mailbox.',
    })]);
    expect(result.apparentPhysicalAccess).toBe(true);
    expect(result.reportedLegalAccess).toBe(false);
    expect(result.rungs[1].statement).toMatch(/Listing driveway and directions wording shows/i);
    expect(result.rungs[1].statement).toMatch(/listing wording alone is not evidence of legal rights/i);
  });

  it('requires the photo reference before listing photography counts as an observation', () => {
    const unbacked = item('apparent_physical', { sourceKind: 'listing_photo', basis: 'source_stated', statement: 'A photograph shows a gravel drive.' });
    expect(reconcileAccessEvidence([unbacked]).items).toHaveLength(0);
    expect(reconcileAccessEvidence([unbacked]).rejected[0].reason).toMatch(/no retained image artifact/i);
    const backed = reconcileAccessEvidence([{ ...unbacked, artifactRef: 'listing-photo-3' }]);
    expect(backed.apparentPhysicalAccess).toBe(true);
    expect(backed.rungs[1].statement).toMatch(/Listing photography/);
  });

  it('counts independent supporting sources and strengthens the read', () => {
    const result = reconcileAccessEvidence([
      item('apparent_physical', { sourceKind: 'satellite_imagery', basis: 'direct_observation', artifactRef: 'aerial-1', statement: 'A gravel drive is apparent.' }),
      item('apparent_physical', { sourceKind: 'listing', basis: 'source_stated', statement: 'Listing describes a dirt driveway off the road.' }),
    ], { requireVisualArtifact: true });
    expect(result.apparentPhysicalSupport).toBe(2);
    expect(result.rungs[1].supportingSourceCount).toBe(2);
    expect(result.rungs[1].statement).toMatch(/2 independent sources support this rung/);
    expect(result.conclusionWeight).toBe('well_supported');
    expect(result.verifiedLegalAccess).toBe(false);
  });

  it('demotes driveway wording and photographs filed on a legal rung instead of promoting them', () => {
    const result = reconcileAccessEvidence([
      item('reported_legal', { sourceKind: 'listing', statement: 'Driveway: dirt. Directions: turn right at the gate.' }),
      item('verified_legal', { sourceKind: 'listing_photo', basis: 'source_stated', artifactRef: 'listing-photo-1', statement: 'The listing photograph pictures a gravel entrance.' }),
    ]);
    expect(result.reportedLegalAccess).toBe(false);
    expect(result.verifiedLegalAccess).toBe(false);
    expect(result.byTier.apparent_physical).toHaveLength(2);
    expect(result.demoted.map((entry) => entry.fromTier)).toEqual(['reported_legal', 'verified_legal']);
    expect(result.demoted[0].reason).toMatch(/never a legal right/i);
  });

  it('leaves a listing that genuinely reports an easement on the reported-legal rung', () => {
    const result = reconcileAccessEvidence([
      item('reported_legal', { sourceKind: 'listing', statement: 'The listing states a recorded easement over the neighboring drive.' }),
    ]);
    expect(result.reportedLegalAccess).toBe(true);
    expect(result.demoted).toHaveLength(0);
  });

  it('refuses a recorded instrument filed as an apparent physical route', () => {
    const result = reconcileAccessEvidence([
      item('apparent_physical', { sourceKind: 'official_record', basis: 'recorded_instrument', statement: 'The deed grants access.' }),
    ]);
    expect(result.apparentPhysicalAccess).toBe(false);
    expect(result.rejected[0].reason).toMatch(/belongs on the verified rung/i);
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

  it('drops an observation citing a capture that was never retained', () => {
    const orphan = item('apparent_physical', {
      basis: 'direct_observation', sourceKind: 'street_view', artifactRef: 'street-view-capture-9',
      statement: 'A fenced gravel entrance is visible in the Street View scene.',
    });
    const result = reconcileAccessEvidence([orphan], { retainedArtifacts: ['inspection-aerial'] });
    expect(result.items).toHaveLength(0);
    expect(result.apparentPhysicalAccess).toBe(false);
    expect(result.rejected[0].reason).toMatch(/was not retained, so the observation is orphaned/i);
    expect(result.rungs[1].status).toBe('not_evidenced');
    expect(result.operatorConclusion).not.toMatch(/gravel entrance/i);
  });

  it('matches a handback that names the capture file against the retained path or URL', () => {
    const observation = item('apparent_physical', {
      basis: 'direct_observation', sourceKind: 'street_view', artifactRef: 'street-view-frontage.png',
    });
    const result = reconcileAccessEvidence([observation], {
      retainedArtifacts: ['C:\\landos\\captures\\Street-View-Frontage.png'],
    });
    expect(result.apparentPhysicalAccess).toBe(true);
    expect(reconcileAccessEvidence([observation], { retainedArtifacts: ['aerial-frontage.png'] }).items).toHaveLength(0);
  });

  it('admits the same observation once its capture is in the retained set', () => {
    const observation = item('apparent_physical', {
      basis: 'direct_observation', sourceKind: 'street_view', artifactRef: 'inspection-street_view',
    });
    const result = reconcileAccessEvidence([observation], { retainedArtifacts: ['inspection-street_view', 'inspection-aerial'] });
    expect(result.apparentPhysicalAccess).toBe(true);
    expect(result.rungs[1].sources[0].artifactRef).toBe('inspection-street_view');
  });

  it('treats an empty retained set as nothing retained, so every visual claim is orphaned', () => {
    const result = reconcileAccessEvidence([
      item('apparent_physical', { basis: 'direct_observation', sourceKind: 'street_view' }),
      item('apparent_physical', { basis: 'direct_observation', sourceKind: 'satellite_imagery', artifactRef: 'aerial-1' }),
      item('apparent_physical', { sourceKind: 'listing', basis: 'source_stated', statement: 'Listing describes a dirt driveway.' }),
    ], { retainedArtifacts: [] });
    // Listing wording is not a capture claim, so it survives; both visual
    // claims do not.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceKind).toBe('listing');
    expect(result.rejected).toHaveLength(2);
  });

  it('exposes the same guard for persistence paths, so an orphan cannot be stored either', () => {
    const orphan = item('apparent_physical', {
      basis: 'direct_observation', sourceKind: 'street_view', artifactRef: 'missing-capture',
    });
    const admission = admitAccessEvidence(orphan, { retainedArtifacts: ['inspection-street_view'] });
    expect(admission.admitted).toBe(false);
    expect(admission.refusedReason).toMatch(/orphaned/i);
    expect(admitAccessEvidence(orphan, { retainedArtifacts: ['missing-capture'] }).admitted).toBe(true);
    expect(isVisualAccessSource('street_view')).toBe(true);
    expect(isVisualAccessSource('listing')).toBe(false);
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
