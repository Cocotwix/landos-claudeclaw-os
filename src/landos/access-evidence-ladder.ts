// LandOS — the ACCESS EVIDENCE LADDER.
//
// Access is one question answered on exactly four rungs, in this order:
//
//   1. parcel flag            — what the LandPortal parcel record states
//   2. apparent physical      — what retained imagery actually shows
//   3. reported legal         — what a listing or other source claims
//   4. verified recorded      — what a recorded instrument proves
//
// The rungs are structurally distinct, not four labels over one bucket:
//
//   • rung 1 carries ONLY what the parcel source itself states, verbatim. The
//     rung repeats the source-stated condition rather than a canned sentence,
//     so a parcel record that says something else is never overwritten.
//   • rung 2 is the ONLY home of physical evidence: aerial imagery, an actual
//     Street View capture, listing driveway/directions wording and listing
//     photography. Several independent supporting sources strengthen it.
//   • rung 3 exists only where a source actually reports a legal or easement
//     RIGHT. Driveway wording, directions and photographs describe a surface,
//     not a right, so they are demoted back to rung 2 and never promoted.
//   • rung 4 exists only on a recorded instrument, read from the instrument.
//
// Two rules this module enforces structurally rather than by convention:
//
//   • A visible driveway is NEVER legal access. Imagery may occupy rung 2 and
//     may sit on rung 4 as a retained claim, but it can never SET
//     `verifiedLegalAccess`, and it can never be read as a reported legal right.
//   • A visual observation is only admissible when someone actually looked at a
//     retained image (`basis: 'direct_observation'`) and the image or capture it
//     cites was actually retained: `requireVisualArtifact` demands the artifact
//     reference, and `retainedArtifacts` demands that the cited capture is in
//     the set that was really retrieved. An observation citing a capture that is
//     absent is ORPHANED and is dropped rather than displayed — a stored Street
//     View statement no capture ever backed cannot render.
//
// The reconciliation returns exactly four rungs so a surface renders each
// concept ONCE. Duplicate statements are collapsed; the operator conclusion is
// assembled from the rungs, never repeated per source.

export type AccessEvidenceTier = 'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal';
export type AccessEvidenceWeight = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';
export type AccessEvidenceSourceKind =
  | 'landportal_parcel_flag'
  | 'satellite_imagery'
  | 'street_view'
  | 'listing'
  | 'listing_photo'
  | 'official_record'
  | 'other';
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
const VISUAL_SOURCE_KINDS = new Set<AccessEvidenceSourceKind>(['satellite_imagery', 'street_view', 'listing_photo']);

/**
 * Visual sources whose image is a capture LandOS itself retained. These are the
 * kinds an orphan check can test against a retained-capture set; a listing photo
 * lives on the retained listing page and carries its own reference instead.
 */
const CAPTURE_SOURCE_KINDS = new Set<AccessEvidenceSourceKind>(['satellite_imagery', 'street_view']);

/** True when this source's evidence is an image rather than a statement. */
export function isVisualAccessSource(kind: AccessEvidenceSourceKind): boolean {
  return VISUAL_SOURCE_KINDS.has(kind);
}

/**
 * Wording that describes a physical surface or a way to drive there. Listing
 * driveway/directions text and photography say what the ground looks like, never
 * what right exists, so this wording alone can only support `apparent_physical`.
 */
const PHYSICAL_ACCESS_WORDING =
  /drive\s?way|dirt (?:road|drive|two[- ]track)|gravel|two[- ]track|paved drive|curb cut|entrance|gate|track|turn (?:left|right|onto)|head (?:north|south|east|west)|directions|photo|photograph|pictured|image shows|frontage road surface/i;

/** Wording by which a source actually reports a legal or easement RIGHT. */
const LEGAL_RIGHT_WORDING =
  /easement|right[-\s]of[-\s]way|ingress|egress|deeded|appurtenant|recorded|instrument|title|plat|covenant|legal access|access agreement|right of access|granted access|conveys/i;

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
  /** Distinct source kinds supporting this rung; >1 strengthens it. */
  supportingSourceCount: number;
}

export interface RejectedAccessEvidence {
  item: AccessEvidenceItem;
  reason: string;
}

/** Physical wording a source filed on a legal rung, moved back to rung 2. */
export interface DemotedAccessEvidence {
  item: AccessEvidenceItem;
  fromTier: AccessEvidenceTier;
  reason: string;
}

export interface AccessEvidenceReconciliation {
  items: AccessEvidenceItem[];
  byTier: Record<AccessEvidenceTier, AccessEvidenceItem[]>;
  /** Exactly four, in ladder order. */
  rungs: AccessRung[];
  /** Evidence refused, with the reason. Never silently dropped. */
  rejected: RejectedAccessEvidence[];
  /** Physical wording moved off a legal rung onto apparent physical. */
  demoted: DemotedAccessEvidence[];
  parcelFlagged: boolean;
  apparentPhysicalAccess: boolean;
  /** How many independent sources support the apparent-physical rung. */
  apparentPhysicalSupport: number;
  reportedLegalAccess: boolean;
  verifiedLegalAccess: boolean;
  operatorConclusion: string;
  outstanding: string[];
  conclusionWeight: AccessEvidenceWeight;
}

export interface ReconcileAccessOptions {
  /**
   * Require every visual item to name the retained artifact that backs it.
   * Callers importing a worker handback, and every presentation path, set this
   * so a written description can never become a visual observation.
   */
  requireVisualArtifact?: boolean;
  /**
   * The capture references that were ACTUALLY retained (artifact keys, content
   * hashes, evidence ids or view URLs). Supplying the set turns on the orphan
   * check and implies `requireVisualArtifact`: a satellite/Street View
   * observation citing a capture outside the set never happened as far as the
   * operator is concerned, so it is dropped rather than displayed.
   */
  retainedArtifacts?: Iterable<string> | null;
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

/** Comparable forms of one artifact reference: an id, key, hash, path or URL. */
function artifactKeys(value: string): string[] {
  const key = value.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!key) return [];
  // The file name alone, so a handback naming the capture file matches the
  // retained path or served URL of that same capture.
  const basename = key.split(/[/?#]/).filter(Boolean).pop() ?? '';
  return basename && basename !== key ? [key, basename] : [key];
}

function retainedArtifactSet(options: ReconcileAccessOptions): Set<string> | null {
  if (options.retainedArtifacts == null) return null;
  const retained = new Set<string>();
  for (const value of options.retainedArtifacts) {
    for (const key of artifactKeys(String(value ?? ''))) retained.add(key);
  }
  return retained;
}

/**
 * Wording that belongs to the source page's own furniture rather than to the
 * property. Kept local to the ladder so the guard has no dependency on the
 * discovery module that produces most of its items.
 */
const SITE_NAVIGATION_WORDING = new RegExp(
  '\\b(?:saved\\s+searches?|favou?rites?|co-?shopper|add\\s+a\\s+note|copy\\s+link'
  + '|claim\\s+this\\s+home|valuation\\s+report|new\\s+construction|building\\s+search'
  + '|sign\\s*[- ]?in|register|advertise|mortgage\\s+calculator|what\\s+is\\s+my\\s+home'
  + '|agent\\s+directory|estimated\\s+payment|terms?\\s+of\\s+use|privacy\\s+notice)\\b',
  'i',
);

/** The outcome of putting one item through the ladder's admission guard. */
export interface AccessEvidenceAdmission {
  admitted: boolean;
  /** The item as the ladder will carry it: demotion rewrites `tier`. */
  item: AccessEvidenceItem;
  /** Set when the item was refused outright. */
  refusedReason: string | null;
  /** Set when physical wording was moved back down to apparent physical. */
  demotedFrom: AccessEvidenceTier | null;
  demotedReason: string | null;
}

/**
 * The single admission guard for access evidence. Persistence paths and
 * presentation paths both run every item through this, so an observation that
 * cannot render also cannot be stored as a finding.
 */
export function admitAccessEvidence(
  item: AccessEvidenceItem,
  options: ReconcileAccessOptions = {},
): AccessEvidenceAdmission {
  const refuse = (reason: string): AccessEvidenceAdmission =>
    ({ admitted: false, item, refusedReason: reason, demotedFrom: null, demotedReason: null });
  const visual = VISUAL_SOURCE_KINDS.has(item.sourceKind);
  const statement = item.statement ?? '';

  // An access rung may only quote wording that describes the ground. Listing
  // pages publish their whole navigation without sentence punctuation, so a
  // statement captured from one can be the site's own menu; and a statement
  // persisted before that was understood is still read back on every render.
  // The guard is the one place every item passes, so the test lives here and
  // applies to stored items as well as fresh ones.
  if (SITE_NAVIGATION_WORDING.test(statement)) {
    return refuse('This statement quotes the source page\'s own navigation or boilerplate rather than describing the property, so it is not access evidence.');
  }

  // Rung 1 restates the parcel source. Nothing observed, interpreted or read
  // out of an instrument belongs there.
  if (item.tier === 'parcel_flag') {
    if (visual) return refuse('Imagery does not state the parcel record\'s own condition; a visible route belongs on the apparent-physical rung.');
    if (item.basis !== 'source_stated') {
      return refuse('The parcel-flag rung carries only the condition the parcel source itself states, never an observation or an interpretation.');
    }
  }

  if (visual && item.basis !== 'direct_observation' && item.tier === 'apparent_physical'
    && !(item.sourceKind === 'listing_photo' && item.basis === 'source_stated')) {
    return refuse('An apparent physical route is only recorded from a direct observation of retained imagery, never from an interpretation or a written description.');
  }
  if (item.tier === 'apparent_physical' && item.basis === 'recorded_instrument') {
    return refuse('A recorded instrument establishes a legal right, not an apparent physical route; it belongs on the verified rung.');
  }
  if (visual && item.tier === 'reported_legal') {
    return refuse('Imagery cannot report a legal or easement right; a visible route belongs on the apparent-physical rung.');
  }
  if (visual && item.tier === 'verified_legal' && item.basis === 'recorded_instrument') {
    return refuse('A recorded legal right must come from the instrument itself, never from imagery labeled as recorded.');
  }

  // Driveway wording, directions and photographs describe the ground. Filed on
  // a legal rung they are moved back to rung 2 rather than promoted or lost.
  const physicalOnly = PHYSICAL_ACCESS_WORDING.test(statement) && !LEGAL_RIGHT_WORDING.test(statement);
  const demotable = item.sourceKind === 'listing' || item.sourceKind === 'listing_photo';
  if (demotable && physicalOnly && (item.tier === 'reported_legal' || item.tier === 'verified_legal')) {
    const demoted: AccessEvidenceItem = { ...item, tier: 'apparent_physical' };
    const admission = admitAccessEvidence(demoted, options);
    return admission.admitted
      ? {
          ...admission,
          demotedFrom: item.tier,
          demotedReason: 'Driveway wording, directions and photography describe a physical surface, never a legal right, so this supports apparent physical access only.',
        }
      : admission;
  }

  // A visual claim exists only where its image does.
  if (visual) {
    const ref = (item.artifactRef ?? '').trim();
    const retained = retainedArtifactSet(options);
    if (!ref && (options.requireVisualArtifact || retained || item.sourceKind === 'listing_photo')) {
      return refuse('No retained image artifact backs this visual observation, so it is a description rather than an observation.');
    }
    if (ref && retained && CAPTURE_SOURCE_KINDS.has(item.sourceKind)
      && !artifactKeys(ref).some((key) => retained.has(key))) {
      return refuse(`The capture this visual observation cites (${ref}) was not retained, so the observation is orphaned and cannot be shown.`);
    }
  }

  return { admitted: true, item, refusedReason: null, demotedFrom: null, demotedReason: null };
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

/** "A", "A and B", "A, B and C" — one readable list, never a bare join. */
function joinList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
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
  const demoted: DemotedAccessEvidence[] = [];
  const retained: AccessEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const admission = admitAccessEvidence(item, options);
    if (!admission.admitted) { rejected.push({ item, reason: admission.refusedReason ?? 'Refused by the access-evidence guard.' }); continue; }
    const key = dedupeKey(admission.item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (admission.demotedFrom) {
      demoted.push({ item: admission.item, fromTier: admission.demotedFrom, reason: admission.demotedReason ?? '' });
    }
    retained.push(admission.item);
  }

  const byTier: Record<AccessEvidenceTier, AccessEvidenceItem[]> = {
    parcel_flag: [], apparent_physical: [], reported_legal: [], verified_legal: [],
  };
  for (const item of retained) byTier[item.tier].push(item);

  const parcelFlagged = byTier.parcel_flag.length > 0;
  const apparentPhysicalAccess = byTier.apparent_physical.length > 0;
  // Independent support: distinct source kinds, not repeated readings of one.
  const apparentPhysicalSupport = new Set(byTier.apparent_physical.map((item) => item.sourceKind)).size;
  // Imagery never reports a legal right, so only non-visual sources can set it.
  const reportedLegalAccess = byTier.reported_legal.some((item) => !VISUAL_SOURCE_KINDS.has(item.sourceKind));
  // Only a recorded instrument verifies legal access, and never from imagery.
  const verifiedLegalAccess = byTier.verified_legal.some((item) =>
    item.basis === 'recorded_instrument' && !VISUAL_SOURCE_KINDS.has(item.sourceKind));

  const rungStatement = (tier: AccessEvidenceTier): { status: AccessRungStatus; statement: string } => {
    const tierItems = byTier[tier];
    if (!tierItems.length) return { status: 'not_evidenced', statement: RUNG_EMPTY[tier] };
    switch (tier) {
      case 'parcel_flag': {
        // Repeat the condition the parcel source STATED. A canned landlocked
        // sentence would overwrite a record that says something else.
        const stated = [...new Set(tierItems
          .map((flag) => flag.statement.trim().replace(/\s+/g, ' '))
          .filter(Boolean))];
        const condition = stated.length
          ? stated.map((line) => (/[.!?]$/.test(line) ? line : `${line}.`)).join(' ')
          : 'The parcel source states a landlocked or road-frontage condition for this parcel.';
        return {
          status: 'evidenced',
          statement: `${condition} That parcel-source condition alone does not establish the absence of physical or legal access.`,
        };
      }
      case 'apparent_physical': {
        // Name only the surfaces actually retained, so the rung never implies
        // evidence nobody took.
        const kinds = new Set(tierItems.map((observation) => observation.sourceKind));
        const surfaces: string[] = [];
        if (kinds.has('satellite_imagery')) surfaces.push('Satellite imagery');
        if (kinds.has('street_view')) surfaces.push('Street View observation');
        if (kinds.has('listing_photo')) surfaces.push('Listing photography');
        if (kinds.has('listing')) surfaces.push('Listing driveway and directions wording');
        const imagery = [...kinds].some((kind) => VISUAL_SOURCE_KINDS.has(kind));
        const observedVia = surfaces.length ? joinList(surfaces) : 'Retained visual observation';
        const verb = surfaces.length > 1 ? 'show' : 'shows';
        const caveat = imagery ? 'imagery alone is not evidence of legal rights' : 'listing wording alone is not evidence of legal rights';
        const corroboration = kinds.size > 1
          ? ` ${kinds.size} independent sources support this rung.`
          : '';
        return {
          status: 'evidenced',
          statement: `${observedVia} ${verb} an apparent physical drive or access route toward the subject; ${caveat}.${corroboration}`,
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
      supportingSourceCount: new Set(byTier[tier].map((item) => item.sourceKind)).size,
    };
  });

  // ONE clause per occupied rung. The same explanation can never appear twice.
  const clauses = rungs.filter((rung) => rung.status !== 'not_evidenced').map((rung) => rung.statement);
  if (!clauses.length) {
    clauses.push('No parcel-flag, apparent physical, reported legal, or verified recorded-instrument access evidence has been retained, so access remains unresolved.');
  }
  if (!verifiedLegalAccess) clauses.push('Recorded easement documentation remains a diligence item unless separately verified from the instrument.');

  // Several independent sources on rung 2 strengthen the read the same way a
  // reported legal right alongside it does. Neither ever reaches confirmed.
  const conclusionWeight: AccessEvidenceWeight = verifiedLegalAccess
    ? 'confirmed'
    : apparentPhysicalAccess && (reportedLegalAccess || apparentPhysicalSupport > 1)
      ? 'well_supported'
      : retained.length
        ? 'likely'
        : 'unresolved';
  return {
    items: retained,
    byTier,
    rungs,
    rejected,
    demoted,
    parcelFlagged,
    apparentPhysicalAccess,
    apparentPhysicalSupport,
    reportedLegalAccess,
    verifiedLegalAccess,
    operatorConclusion: [...new Set(clauses)].join(' '),
    outstanding: verifiedLegalAccess ? [] : ['Verify any access easement or other legal access right from the recorded instrument and retain its provenance.'],
    conclusionWeight,
  };
}
