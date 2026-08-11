export type AccessEvidenceTier = 'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal';
export type AccessEvidenceWeight = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';
export type AccessEvidenceSourceKind = 'landportal_parcel_flag' | 'satellite_imagery' | 'street_view' | 'listing' | 'official_record' | 'other';
export type AccessEvidenceBasis = 'source_stated' | 'direct_observation' | 'reasonable_interpretation' | 'recorded_instrument';

export interface AccessEvidenceItem {
  tier: AccessEvidenceTier;
  statement: string;
  sourceLabel: string;
  sourceKind: AccessEvidenceSourceKind;
  basis: AccessEvidenceBasis;
  weight: AccessEvidenceWeight;
  sourceUrl?: string | null;
  observedAt?: string | null;
}

export interface AccessInvestigationTrigger {
  triggered: boolean;
  reasons: string[];
  requiredSteps: string[];
}

const AFFIRMATIVE = /^(?:yes|true|1|land\s*locked|land\s*locked\s*:\s*yes|affirmative)$/i;

export function accessInvestigationTrigger(input: {
  landlockedStatus?: string | null;
  roadFrontageFt?: number | null;
  setbackFromRoad?: boolean | null;
}): AccessInvestigationTrigger {
  const flagPresent = AFFIRMATIVE.test((input.landlockedStatus ?? '').trim());
  const reasons: string[] = [];
  if (flagPresent) reasons.push('LandPortal affirmatively flags the parcel as landlocked.');
  if (input.roadFrontageFt === 0) reasons.push('The parcel record reports zero feet of road frontage.');
  if (input.roadFrontageFt == null && flagPresent) reasons.push('Road frontage is absent while the landlocked flag is affirmative.');
  if (input.setbackFromRoad === true) reasons.push('The parcel is set back from the nearest public road.');
  const triggered = reasons.length > 0;
  return {
    triggered,
    reasons,
    requiredSteps: triggered
      ? [
          'Inspect the LandPortal satellite/map view for driveways, private access routes, gates, tracks, or mapped access lines.',
          'Run a LandPortal Street View pass with the marker placed on the nearest public road and inspect the parcel-facing approach.',
        ]
      : [],
  };
}

export interface AccessEvidenceReconciliation {
  items: AccessEvidenceItem[];
  byTier: Record<AccessEvidenceTier, AccessEvidenceItem[]>;
  parcelFlagged: boolean;
  apparentPhysicalAccess: boolean;
  reportedLegalAccess: boolean;
  verifiedLegalAccess: boolean;
  operatorConclusion: string;
  outstanding: string[];
  conclusionWeight: AccessEvidenceWeight;
}

export function reconcileAccessEvidence(items: AccessEvidenceItem[]): AccessEvidenceReconciliation {
  const retained = [...items];
  const byTier: Record<AccessEvidenceTier, AccessEvidenceItem[]> = {
    parcel_flag: [], apparent_physical: [], reported_legal: [], verified_legal: [],
  };
  for (const item of retained) byTier[item.tier].push(item);

  const parcelFlagged = byTier.parcel_flag.length > 0;
  const apparentPhysicalAccess = byTier.apparent_physical.length > 0;
  const reportedLegalAccess = byTier.reported_legal.length > 0;
  const verifiedLegalAccess = byTier.verified_legal.some((item) => item.basis === 'recorded_instrument');
  const clauses: string[] = [];
  if (parcelFlagged) {
    clauses.push('LandPortal\'s parcel record flags this parcel as land locked (Land Locked: Yes) because it does not directly front a recognized named road; that parcel flag alone does not establish the absence of physical or legal access.');
  }
  if (apparentPhysicalAccess) {
    // Name the observation surfaces that were actually retained rather than
    // claiming both, so the conclusion never implies evidence nobody took.
    const kinds = new Set(byTier.apparent_physical.map((observation) => observation.sourceKind));
    const surfaces: string[] = [];
    if (kinds.has('satellite_imagery')) surfaces.push('Satellite imagery');
    if (kinds.has('street_view')) surfaces.push('Street View observation');
    const observedVia = surfaces.length ? surfaces.join(' and ') : 'Retained visual observation';
    const verb = surfaces.length > 1 ? 'show' : 'shows';
    clauses.push(`${observedVia} ${verb} an apparent physical drive or access route toward the subject; imagery alone is not evidence of legal rights.`);
  }
  if (reportedLegalAccess) {
    clauses.push('Listing or other reported evidence states that legal or easement access exists; this remains reported legal evidence rather than a verified recorded right.');
  }
  if (byTier.verified_legal.length) {
    clauses.push(verifiedLegalAccess
      ? 'Official recorded-instrument evidence verifies a legal access right, with its separate record provenance retained.'
      : 'Evidence labeled as verified legal access is retained, but it does not verify legal access because no recorded instrument basis accompanies it.');
  }
  if (!clauses.length) {
    clauses.push('No parcel-flag, apparent physical, reported legal, or verified recorded-instrument access evidence has been retained, so access remains unresolved.');
  }
  if (!verifiedLegalAccess) clauses.push('Recorded easement documentation remains a diligence item unless separately verified from the instrument.');

  const conclusionWeight: AccessEvidenceWeight = verifiedLegalAccess
    ? 'confirmed'
    : apparentPhysicalAccess && reportedLegalAccess
      ? 'well_supported'
      : retained.length
        ? 'likely'
        : 'unresolved';
  return {
    items: retained,
    byTier,
    parcelFlagged,
    apparentPhysicalAccess,
    reportedLegalAccess,
    verifiedLegalAccess,
    operatorConclusion: clauses.join(' '),
    outstanding: verifiedLegalAccess ? [] : ['Verify any access easement or other legal access right from the recorded instrument and retain its provenance.'],
    conclusionWeight,
  };
}
