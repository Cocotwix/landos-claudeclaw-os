// LandOS — the ACCESS EVIDENCE LADDER.
//
// Access is one question answered on exactly four rungs, in this order:
//
//   1. parcel flag            — what the LandPortal parcel record states
//   2. apparent physical      — what retained imagery actually shows
//   3. reported legal         — what a listing or other source claims
//   4. verified recorded      — what a recorded instrument proves
//
// Two rules this module enforces structurally rather than by convention:
//
//   • A visible driveway is NEVER legal access. Imagery may occupy rung 2 and
//     may sit on rung 4 as a retained claim, but it can never SET
//     `verifiedLegalAccess`, and it can never be read as a reported legal right.
//   • A visual observation is only admissible when someone actually looked at a
//     retained image (`basis: 'direct_observation'`), and — when the caller asks
//     for it — only when a retained image artifact backs it. Prose, remembered
//     descriptions and interpretations cannot become an access observation.
//
// The reconciliation returns exactly four rungs so a surface renders each
// concept ONCE. Duplicate statements are collapsed; the operator conclusion is
// assembled from the rungs, never repeated per source.

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
  /**
   * Identifier (artifact key or content hash) of the RETAINED image that backs a
   * visual observation. A visual claim with no artifact is a description, not an
   * observation; `requireVisualArtifact` rejects it.
   */
  artifactRef?: string | null;
}

export interface AccessInvestigationTrigger {
  triggered: boolean;
  reasons: string[];
  requiredSteps: string[];
}

const AFFIRMATIVE = /^(?:yes|true|1|land\s*locked|land\s*locked\s*:\s*yes|affirmative)$/i;

/** Source kinds whose evidence is an IMAGE, and therefore never a legal right. */
const VISUAL_SOURCE_KINDS = new Set<AccessEvidenceSourceKind>(['satellite_imagery', 'street_view']);

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
          'Trace any apparent route from the parcel toward the nearest public or named road and identify the likely junction point.',
          'Run a LandPortal Street View pass with the marker placed on the nearest public road at that junction and inspect the parcel-facing approach.',
        ]
      : [],
  };
}

export type AccessRungStatus = 'evidenced' | 'claimed_not_verified' | 'not_evidenced';

export interface AccessRungSource {
  label: string;
  kind: AccessEvidenceSourceKind;
  basis: AccessEvidenceBasis;
  weight: AccessEvidenceWeight;
  url: string | null;
  observedAt: string | null;
  artifactRef: string | null;
}

/** One rung of the ladder. A surface renders these four and nothing else. */
export interface AccessRung {
  tier: AccessEvidenceTier;
  label: string;
  question: string;
  status: AccessRungStatus;
  /** The single operator-facing sentence for this rung. Never repeated. */
  statement: string;
  items: AccessEvidenceItem[];
  sources: AccessRungSource[];
}

export interface RejectedAccessEvidence {
  item: AccessEvidenceItem;
  reason: string;
}

export interface AccessEvidenceReconciliation {
  items: AccessEvidenceItem[];
  byTier: Record<AccessEvidenceTier, AccessEvidenceItem[]>;
  /** Exactly four, in ladder order. */
  rungs: AccessRung[];
  /** Evidence refused, with the reason. Never silently dropped. */
  rejected: RejectedAccessEvidence[];
  parcelFlagged: boolean;
  apparentPhysicalAccess: boolean;
  reportedLegalAccess: boolean;
  verifiedLegalAccess: boolean;
  operatorConclusion: string;
  outstanding: string[];
  conclusionWeight: AccessEvidenceWeight;
}

export interface ReconcileAccessOptions {
  /**
   * Require every satellite/Street View item to name the retained artifact that
   * backs it. Callers importing a worker handback set this so a written
   * description can never become a visual observation.
   */
  requireVisualArtifact?: boolean;
}

const RUNG_ORDER: AccessEvidenceTier[] = ['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal'];

const RUNG_LABEL: Record<AccessEvidenceTier, string> = {
  parcel_flag: 'Parcel / landlocked flag',
  apparent_physical: 'Apparent physical access',
  reported_legal: 'Reported legal / easement access',
  verified_legal: 'Verified recorded legal access',
};

const RUNG_QUESTION: Record<AccessEvidenceTier, string> = {
  parcel_flag: 'What does the parcel record itself state?',
  apparent_physical: 'What does retained imagery actually show on the ground?',
  reported_legal: 'What does a listing or other source claim about a legal right?',
  verified_legal: 'What has been read from a recorded instrument?',
};

const RUNG_EMPTY: Record<AccessEvidenceTier, string> = {
  parcel_flag: 'No LandPortal landlocked or road-frontage flag has been retained for this parcel.',
  apparent_physical: 'No retained imagery observation of a drive, track, or access route exists yet.',
  reported_legal: 'No listing or other source has reported a legal or easement access right.',
  verified_legal: 'No recorded instrument establishing legal access has been read.',
};

/** Why a piece of evidence cannot occupy the rung it claimed, or null if it can. */
function refusalReason(item: AccessEvidenceItem, options: ReconcileAccessOptions): string | null {
  const visual = VISUAL_SOURCE_KINDS.has(item.sourceKind);
  if (visual && item.basis !== 'direct_observation' && item.tier === 'apparent_physical') {
    return 'An apparent physical route is only recorded from a direct observation of retained imagery, never from an interpretation or a written description.';
  }
  if (visual && item.tier === 'reported_legal') {
    return 'Imagery cannot report a legal or easement right; a visible route belongs on the apparent-physical rung.';
  }
  if (visual && item.tier === 'verified_legal' && item.basis === 'recorded_instrument') {
    return 'A recorded legal right must come from the instrument itself, never from imagery labeled as recorded.';
  }
  if (options.requireVisualArtifact && visual && !(item.artifactRef ?? '').trim()) {
    return 'No retained image artifact backs this visual observation, so it is a description rather than an observation.';
  }
  return null;
}

/** Collapses the identical explanation arriving from several places. */
function dedupeKey(item: AccessEvidenceItem): string {
  return [
    item.tier,
    item.sourceKind,
    item.basis,
    item.sourceLabel.trim().toLowerCase(),
    item.statement.trim().toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
}

function rungSource(item: AccessEvidenceItem): AccessRungSource {
  return {
    label: item.sourceLabel,
    kind: item.sourceKind,
    basis: item.basis,
    weight: item.weight,
    url: item.sourceUrl ?? null,
    observedAt: item.observedAt ?? null,
    artifactRef: item.artifactRef ?? null,
  };
}

export function reconcileAccessEvidence(
  items: AccessEvidenceItem[],
  options: ReconcileAccessOptions = {},
): AccessEvidenceReconciliation {
  const rejected: RejectedAccessEvidence[] = [];
  const retained: AccessEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const reason = refusalReason(item, options);
    if (reason) { rejected.push({ item, reason }); continue; }
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    retained.push(item);
  }

  const byTier: Record<AccessEvidenceTier, AccessEvidenceItem[]> = {
    parcel_flag: [], apparent_physical: [], reported_legal: [], verified_legal: [],
  };
  for (const item of retained) byTier[item.tier].push(item);

  const parcelFlagged = byTier.parcel_flag.length > 0;
  const apparentPhysicalAccess = byTier.apparent_physical.length > 0;
  // Imagery never reports a legal right, so only non-visual sources can set it.
  const reportedLegalAccess = byTier.reported_legal.some((item) => !VISUAL_SOURCE_KINDS.has(item.sourceKind));
  // Only a recorded instrument verifies legal access, and never from imagery.
  const verifiedLegalAccess = byTier.verified_legal.some((item) =>
    item.basis === 'recorded_instrument' && !VISUAL_SOURCE_KINDS.has(item.sourceKind));

  const rungStatement = (tier: AccessEvidenceTier): { status: AccessRungStatus; statement: string } => {
    const tierItems = byTier[tier];
    if (!tierItems.length) return { status: 'not_evidenced', statement: RUNG_EMPTY[tier] };
    switch (tier) {
      case 'parcel_flag':
        return {
          status: 'evidenced',
          statement: 'LandPortal\'s parcel record flags this parcel as land locked (Land Locked: Yes) because it does not directly front a recognized named road; that parcel flag alone does not establish the absence of physical or legal access.',
        };
      case 'apparent_physical': {
        // Name only the surfaces actually retained, so the rung never implies
        // evidence nobody took.
        const kinds = new Set(tierItems.map((observation) => observation.sourceKind));
        const surfaces: string[] = [];
        if (kinds.has('satellite_imagery')) surfaces.push('Satellite imagery');
        if (kinds.has('street_view')) surfaces.push('Street View observation');
        const observedVia = surfaces.length ? surfaces.join(' and ') : 'Retained visual observation';
        const verb = surfaces.length > 1 ? 'show' : 'shows';
        return {
          status: 'evidenced',
          statement: `${observedVia} ${verb} an apparent physical drive or access route toward the subject; imagery alone is not evidence of legal rights.`,
        };
      }
      case 'reported_legal':
        return {
          status: 'evidenced',
          statement: 'Listing or other reported evidence states that legal or easement access exists; this remains reported legal evidence rather than a verified recorded right.',
        };
      case 'verified_legal':
        return verifiedLegalAccess
          ? {
              status: 'evidenced',
              statement: 'Official recorded-instrument evidence verifies a legal access right, with its separate record provenance retained.',
            }
          : {
              status: 'claimed_not_verified',
              statement: 'Evidence labeled as verified legal access is retained, but it does not verify legal access because no recorded instrument basis accompanies it.',
            };
    }
  };

  const rungs: AccessRung[] = RUNG_ORDER.map((tier) => {
    const { status, statement } = rungStatement(tier);
    return {
      tier,
      label: RUNG_LABEL[tier],
      question: RUNG_QUESTION[tier],
      status,
      statement,
      items: byTier[tier],
      sources: byTier[tier].map(rungSource),
    };
  });

  // ONE clause per occupied rung. The same explanation can never appear twice.
  const clauses = rungs.filter((rung) => rung.status !== 'not_evidenced').map((rung) => rung.statement);
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
    rungs,
    rejected,
    parcelFlagged,
    apparentPhysicalAccess,
    reportedLegalAccess,
    verifiedLegalAccess,
    operatorConclusion: [...new Set(clauses)].join(' '),
    outstanding: verifiedLegalAccess ? [] : ['Verify any access easement or other legal access right from the recorded instrument and retain its provenance.'],
    conclusionWeight,
  };
}
