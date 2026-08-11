// The MI acceptance subject's accepted land-use determination, as a fixture.
//
// Deal 83 / 9490 Elk Lake Rd is the property the zoning source-selection work
// is proven on: Whitewater township is the resolved governing authority, no
// zoning district was ever established for the parcel, and the county's own
// land-division rules stand behind a fallback label. Both the parcel-path tests
// and the parcel-independence tests need exactly this shape, so it lives here
// once rather than drifting in two copies.

import {
  evidencedValue,
  unresolvedValue,
  type LandUseDetermination,
  type LegalSourceCitation,
} from '../land-use-types.js';

export function landUseCitation(url: string, label: string): LegalSourceCitation {
  return {
    tier: 'township_code',
    label,
    url,
    publisher: null,
    citation: null,
    excerpt: 'Whitewater Township Planning & Zoning.',
    format: 'html',
    effectiveDate: null,
    retrievedAt: '2026-08-07T15:36:48.780Z',
  } as LegalSourceCitation;
}

export function whitewaterDetermination(overrides: Partial<LandUseDetermination> = {}): LandUseDetermination {
  const townshipCitation = landUseCitation('https://www.whitewatertownshipmi.gov/', 'Whitewater township official website');
  const authorityName = evidencedValue('Whitewater township', [townshipCitation]);
  return {
    version: 1,
    subject: {
      dealCardId: 83, parcelId: '13-116-015-01', address: '9490 Elk Lake Rd', city: 'Williamsburg',
      county: 'Grand Traverse County', state: 'MI', acres: 60, latitude: 44.82, longitude: -85.4,
      hasImprovements: false, sellerReported: [],
    },
    authority: {
      pattern: 'state_framework_local_administration',
      patternExplanation: 'The state sets the land-division baseline and the township administers zoning.',
      incorporation: unresolvedValue<string>('Not established.'),
      county: { role: 'county', unitType: 'county', name: evidencedValue('Grand Traverse County', [townshipCitation]) },
      localUnit: { role: 'local_unit', unitType: 'township', name: authorityName },
      zoningAuthority: { role: 'zoning', unitType: 'township', name: authorityName },
      subdivisionAuthority: { role: 'subdivision', unitType: 'township', name: unresolvedValue<string>('Not established.') },
    },
    stateFramework: {
      state: 'MI', status: 'present',
      provisions: [], localAuthorityRetained: unresolvedValue<string>('Not established.'),
      sourcesSearched: [], searchedAt: '2026-08-07T15:36:48.780Z',
    },
    zoning: {
      presence: 'zoning_unverified',
      code: unresolvedValue<string>('No zoning district was established for this parcel.'),
      districtName: unresolvedValue<string>('Not established.'),
      classificationKind: 'unknown_classification',
      governingAuthority: 'Whitewater township',
      sourceDisclaimer: null, effectiveDate: null, nonZoningClassification: null,
    },
    uses: [],
    privateRestrictions: [],
    dimensionalStandards: [],
    subdivision: {
      governingBody: null, ordinanceLabel: null, ordinanceUrl: null,
      subdivisionDefinition: unresolvedValue<string>('Not located.'),
      paths: [], parentTract: {
        applies: unresolvedValue<boolean>('Not located.'),
        parentTractDefinition: unresolvedValue<string>('Not located.'),
        lookbackPeriod: unresolvedValue<string>('Not located.'),
        priorDivisionCountRule: unresolvedValue<string>('Not located.'),
        remainderTreatment: unresolvedValue<string>('Not located.'),
        priorDivisionHistoryRequired: false, requiredVerificationStep: null,
      },
      minimumLotArea: unresolvedValue<string>('Not located.'),
      minimumLotWidth: unresolvedValue<string>('Not located.'),
      minimumRoadFrontage: unresolvedValue<string>('Not located.'),
      flagLots: unresolvedValue<string>('Not located.'),
      sharedDriveways: unresolvedValue<string>('Not located.'),
      privateRoads: unresolvedValue<string>('Not located.'),
      publicRoadFrontageRequired: unresolvedValue<boolean>('Not located.'),
      newRoadTrigger: unresolvedValue<string>('Not located.'),
      surveyRequirement: unresolvedValue<string>('Not located.'),
      platRequirement: unresolvedValue<string>('Not located.'),
      recordingRequirement: unresolvedValue<string>('Not located.'),
      utilityRequirement: unresolvedValue<string>('Not located.'),
      septicRequirement: unresolvedValue<string>('Not located.'),
      wellRequirement: unresolvedValue<string>('Not located.'),
      stormwaterRequirement: unresolvedValue<string>('Not located.'),
      fireAccessRequirement: unresolvedValue<string>('Not located.'),
      applicationFee: unresolvedValue<string>('Not located.'),
      publishedReviewTimeline: unresolvedValue<string>('Not located.'),
      stateHighwayAccessImplication: unresolvedValue<string>('Not located.'),
    },
    countySubdivisionFallback: null,
    access: {
      roadName: null, roadType: unresolvedValue<string>('Not located.'), status: 'new_access_unverified',
      accessAuthority: null, drivewayPermitRequired: unresolvedValue<boolean>('Not located.'),
      spacingStandards: unresolvedValue<string>('Not located.'), constraintNotes: [],
    },
    septicWell: {
      authority: null, perLotApprovalRequired: unresolvedValue<boolean>('Not located.'),
      divisionRequiresHealthReview: unresolvedValue<boolean>('Not located.'),
      minimumAcreage: unresolvedValue<string>('Not located.'),
      reserveFieldRequirement: unresolvedValue<string>('Not located.'),
      existingSepticInfluence: null, existingWellInfluence: null, unresolved: [], scopeNote: '',
    },
    precedence: [],
    legalYield: { status: 'unresolved', maximumLots: null, path: null, constraintsApplied: [], missingInputs: [], reason: 'Unresolved.' },
    physicalYield: { status: 'unresolved', plausibleLots: null, limitingFactors: [], siteFacts: [], scopeNote: '' },
    carveouts: [],
    scenarios: [],
    discoveryQuestions: [],
    unresolved: [],
    failureStates: [],
    sources: [townshipCitation],
    lanes: [],
    determinedAt: '2026-08-07T15:36:48.780Z',
    ...overrides,
  } as LandUseDetermination;
}
