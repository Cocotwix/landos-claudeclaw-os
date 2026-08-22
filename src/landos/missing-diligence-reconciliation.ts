// Missing-diligence reconciliation (projection layer).
//
// Historical collector messages persist in the snapshot record, but the
// operator must never see "screening has not been run" or "remains in
// Resolution" for a category whose discovery-stage research has since been
// accepted. This module reconciles the raw messages against the CURRENT
// accepted facts and evidence, generically by category key:
//   - a stale message is superseded when every category it references is
//     either discovery-complete or represented by an accurate checklist item;
//   - genuine uncertainty is never deleted — official/legal confirmation
//     stays honestly unresolved, and unmatched messages pass through;
//   - discovery-stage evidence is never converted into a legal conclusion.
// The output is a concise operator checklist (finding / unresolved / why /
// next source) that replaces the raw historical dump in the V2 read. The
// persisted historical record is not modified.

export interface MissingDiligenceItem {
  key: string;
  label: string;
  currentFinding: string;
  stillUnresolved: string;
  whyItMatters: string;
  nextSource: string;
  /** Compact collapsed-row status, e.g. "Discovery screening retained". */
  shortStatus: string;
  /** Compact collapsed-row next action, e.g. "Perc test / soil evaluation". */
  shortNext: string;
  /** The two or three most decision-critical items render prominently. */
  urgent: boolean;
}

export interface MissingDiligenceChecklist {
  items: MissingDiligenceItem[];
  /** Small honest evidence gaps (chips) that need no structured explanation. */
  evidenceGaps: string[];
  /** Raw messages retained because no category or checklist item covers them. */
  passthrough: string[];
  /**
   * Messages the CURRENT accepted comp/valuation records directly contradict,
   * with the record that superseded each. Retained so nothing vanishes
   * silently, never rendered on the operator surface.
   */
  supersededByAcceptedRecords: Array<{ statement: string; supersededBy: string }>;
}

export interface DiscoveryDiligenceState {
  /** Discovery-stage subject identity verified (address+APN+LandPortal id). */
  identityVerified: boolean;
  frontageFt: number | null;
  wetlandsScreenedPct: string | null;
  femaScreenedPct: string | null;
  femaDescription: string | null;
  soilUnitCount: number;
  slopePct: string | null;
  buildabilityPct: string | null;
  streetViewComplete: boolean;
  zoningCode: string | null;
  zoningOfficialConfirmed: boolean;
  utilitiesConfirmed: boolean;
  septicConfirmed: boolean;
  officialRecordsRetrieved: boolean;
  valuationPriceable: boolean;
  /**
   * The CURRENT accepted comparable record. Missing-information statements are
   * derived from these counts, never from a historical conclusion: a card that
   * shows accepted vacant-land sales may not simultaneously claim that no
   * usable comp survived or that another sale is still required. Optional so a
   * caller that has not wired the canonical counts yet degrades to the honest
   * "no accepted closed sale yet" wording rather than fabricating one.
   */
  acceptedSoldComps?: number;
  acceptedActiveComps?: number;
  acceptedAskingReferences?: number;
  /** Road name only after recorded-instrument/title evidence verifies legal
   *  access; provider frontage never populates this field. */
  legalAccessRoad: string | null;
  /** A mapped corridor crosses the parcel and its ownership/crossing rights
   *  are unconfirmed — genuine access-family uncertainty that survives the
   *  discovery-stage legal-access rule. */
  corridorRightsUnresolved: boolean;
  /** Preliminary septic outlook category label when a grounded soils
   *  screening exists (e.g. "Low preliminary likelihood"). */
  septicOutlookLabel: string | null;
}

interface CategoryMatcher {
  key: string;
  pattern: RegExp;
  /** Discovery screening for this category is complete per current state. */
  complete: (state: DiscoveryDiligenceState) => boolean;
}

const CATEGORY_MATCHERS: CategoryMatcher[] = [
  { key: 'identity', pattern: /parcel identity|has not been confirmed by a parcel source|remains in Resolution|property identity/i, complete: (s) => s.identityVerified },
  { key: 'wetlands', pattern: /wetland/i, complete: (s) => !!s.wetlandsScreenedPct },
  { key: 'fema', pattern: /fema|flood/i, complete: (s) => !!s.femaScreenedPct },
  { key: 'soils', pattern: /soil/i, complete: (s) => s.soilUnitCount > 0 },
  { key: 'slope', pattern: /slope|topography|terrain/i, complete: (s) => !!s.slopePct },
  { key: 'access', pattern: /legal access|right[- ]of[- ]way|frontage|driveway|road (?:access|proximity|maintenance)|parcel.road boundary|landlocked|access screening/i, complete: (s) => s.frontageFt != null || s.streetViewComplete },
  { key: 'utilities', pattern: /utilit/i, complete: (s) => s.utilitiesConfirmed },
  { key: 'zoning', pattern: /zoning|land use|jurisdiction authority|permitted uses|dimensional standards|ordinance/i, complete: (s) => s.zoningOfficialConfirmed },
  { key: 'county_records', pattern: /county records|government records|official county|deed|title|recorder|recorded instrument/i, complete: (s) => s.officialRecordsRetrieved },
  { key: 'septic', pattern: /septic|perc/i, complete: (s) => s.septicConfirmed },
  { key: 'valuation', pattern: /valuation|priceable|closed.*sale|fair market value|asking-market|strategy/i, complete: (s) => s.valuationPriceable },
];

/** Language that asserts research was never performed or is still gated. */
const STALE_LANGUAGE = /has not been run|has not run|has not been screened|has not been retrieved|has not been confirmed by a parcel source|remains in Resolution|no source collector ran|not attempted|screening has not/i;

const ft = (value: number): string => `${Math.round(value)} ft`;

function fixedItems(state: DiscoveryDiligenceState): MissingDiligenceItem[] {
  const items: MissingDiligenceItem[] = [];

  if (state.legalAccessRoad) {
    // Recorded legal access is verified. Surveyed frontage, physical entrance,
    // easements affecting other areas, and corridor rights stay independent.
    items.push({
      key: 'access',
      label: 'Verified legal access and separate physical follow-ups',
      currentFinding: [
        `Recorded legal access: verified via ${state.legalAccessRoad}`,
        state.frontageFt != null ? `provider maps approximately ${ft(state.frontageFt)} of frontage` : null,
        state.streetViewComplete ? 'retained imagery supplies a separate physical-access observation' : null,
      ].filter(Boolean).join('; ') + '.',
      stillUnresolved: [
        'Exact surveyed frontage',
        state.corridorRightsUnresolved ? 'ownership and crossing rights of the corridor crossing the parcel' : null,
        'physical entrance and any easements affecting other portions of the parcel',
      ].filter(Boolean).join('; ') + '.',
      whyItMatters: 'A recorded right, surveyed frontage, and a usable physical entrance answer different acquisition and development questions.',
      nextSource: 'Boundary survey and recorded deed/easement documents.',
      shortStatus: `Recorded legal access: verified via ${state.legalAccessRoad}`,
      shortNext: 'Survey + easement review',
      urgent: false,
    });
  } else {
    items.push({
      key: 'access',
      label: 'Legal access and frontage confirmation',
      currentFinding: state.frontageFt != null || state.streetViewComplete
        ? [
            state.frontageFt != null ? `LandPortal maps approximately ${ft(state.frontageFt)} of road frontage` : null,
            state.streetViewComplete ? 'Street View shows direct road adjacency with no physical frontage barrier observed' : null,
          ].filter(Boolean).join('; ') + '.'
        : 'No mapped frontage or Street View pass is retained yet.',
      stillUnresolved: 'Road abutment evidence (mapped frontage or a landlocked determination), surveyed frontage, and any recorded easements.',
      whyItMatters: 'Access gates buildability, financing, and value; road abutment must be established by parcel evidence.',
      nextSource: 'LandPortal parcel mapping, recorded deed and easement documents, survey.',
      shortStatus: 'Access not yet established',
      shortNext: 'Confirm road abutment evidence',
      urgent: true,
    });
  }

  if (!state.zoningOfficialConfirmed) {
    items.push({
      key: 'zoning',
      label: 'Official zoning confirmation',
      currentFinding: state.zoningCode
        ? `LandPortal sidebar shows discovery-stage code ${state.zoningCode}; not an official determination.`
        : 'No zoning indication has been retained yet.',
      stillUnresolved: 'Governing district, permitted uses, and dimensional standards from the official zoning authority.',
      whyItMatters: 'Zoning controls allowed uses, splits, and the buyer pool.',
      nextSource: 'Municipal zoning office, official zoning map, and ordinance.',
      shortStatus: state.zoningCode ? `Discovery code ${state.zoningCode} only` : 'No zoning indication',
      shortNext: 'Municipal zoning office',
      urgent: true,
    });
  }

  items.push({
    key: 'survey',
    label: 'Surveyed boundary and frontage confirmation',
    currentFinding: 'Boundary and acreage are retained from LandPortal parcel mapping (discovery stage).',
    stillUnresolved: 'Surveyed boundary, monumented corners, and exact legal frontage.',
    whyItMatters: 'Mapped geometry is an indication; conveyance and build placement rely on a survey.',
    nextSource: 'Existing recorded survey or a new boundary survey.',
    shortStatus: 'Mapped geometry retained',
    shortNext: 'Boundary survey',
    urgent: false,
  });

  if (!state.utilitiesConfirmed) {
    items.push({
      key: 'utilities',
      label: 'Utility service confirmation',
      currentFinding: state.streetViewComplete
        ? 'Overhead utility lines are visible along the road at the frontage in Street View.'
        : 'No utility observation has been retained yet.',
      stillUnresolved: 'Provider confirmation of electric service and any water or sewer availability at the parcel.',
      whyItMatters: 'Lines at the road are not proof of service; connection cost affects buyer appeal.',
      nextSource: 'Utility providers serving the road.',
      shortStatus: state.streetViewComplete ? 'Lines visible at the road' : 'No observation yet',
      shortNext: 'Provider confirmation',
      urgent: false,
    });
  }

  if (!state.septicConfirmed) {
    items.push({
      key: 'septic',
      label: 'Septic and perc feasibility',
      currentFinding: state.septicOutlookLabel
        ? `Preliminary septic outlook from the mapped soils: ${state.septicOutlookLabel}. ${state.soilUnitCount} accepted soil unit(s) with official soil characteristics are retained; no perc test exists yet.`
        : state.soilUnitCount > 0
          ? `LandPortal soil screening completed: ${state.soilUnitCount} accepted soil unit(s) with drainage, farmland, and capability attributes are retained.`
          : 'Soil screening has not been run yet.',
      stillUnresolved: 'Perc test and county health department septic feasibility.',
      whyItMatters: 'Soil interpretation is not a passed perc test; septic feasibility gates homesite use.',
      nextSource: 'Perc test and the county health department.',
      shortStatus: state.septicOutlookLabel ?? (state.soilUnitCount > 0 ? 'Soils screened, no perc test' : 'Not screened'),
      shortNext: 'Perc test / soil evaluation',
      urgent: true,
    });
  }

  items.push({
    key: 'wetlands',
    label: 'Official wetlands determination',
    currentFinding: state.wetlandsScreenedPct
      ? `LandPortal wetlands screening completed: mapped coverage ${state.wetlandsScreenedPct}.`
      : 'Wetlands screening has not been run yet.',
    stillUnresolved: 'Jurisdictional wetlands delineation where development is planned.',
    whyItMatters: 'Mapped overlays are indications; jurisdictional findings control permits.',
    nextSource: 'Wetlands consultant or an Army Corps jurisdictional determination.',
    shortStatus: state.wetlandsScreenedPct ? `Mapped ${state.wetlandsScreenedPct}` : 'Not screened',
    shortNext: 'Delineation if building near mapped areas',
    urgent: false,
  });

  items.push({
    key: 'fema',
    label: 'Official flood determination',
    currentFinding: state.femaScreenedPct
      ? `LandPortal FEMA screening completed: mapped coverage ${state.femaScreenedPct}${state.femaDescription ? `; retained description: ${state.femaDescription.replace(/\.\s*$/, '')}` : ''}.`
      : 'FEMA screening has not been run yet.',
    stillUnresolved: 'Official FEMA panel or survey-based determination where required.',
    whyItMatters: 'Insurance and lending decisions rely on the official determination.',
    nextSource: 'FEMA FIRM panel lookup or an elevation certificate.',
    shortStatus: state.femaScreenedPct ? `Mapped ${state.femaScreenedPct}` : 'Not screened',
    shortNext: 'FIRM panel lookup',
    urgent: false,
  });

  if (!state.officialRecordsRetrieved) {
    items.push({
      key: 'county_records',
      label: 'Official county records retrieval',
      currentFinding: state.identityVerified
        ? 'Discovery-stage subject identity is verified through LandPortal (address, APN, county, LandPortal property ID).'
        : 'Subject identity has not been verified yet.',
      stillUnresolved: 'Official county, deed, title, and recorded-instrument retrieval.',
      whyItMatters: 'Ownership, easements, and restrictions live in the recorded instruments.',
      nextSource: 'County clerk/recorder and assessor records.',
      shortStatus: state.identityVerified ? 'Identity verified, records pending' : 'Identity unverified',
      shortNext: 'County clerk / recorder',
      urgent: false,
    });
  }

  if (!state.valuationPriceable) {
    // Derived from the CURRENT accepted comp record. Saying "no accepted closed
    // in-band sale" while the working set holds accepted sales is the exact
    // contradiction this reconciliation exists to prevent.
    const sold = state.acceptedSoldComps ?? 0;
    const active = state.acceptedActiveComps ?? 0;
    const asking = state.acceptedAskingReferences ?? 0;
    items.push({
      key: 'valuation',
      label: 'Closed-sale evidence for valuation',
      currentFinding: sold > 0
        ? `${sold} accepted closed in-band sale(s) are retained, but the valuation record is not yet marked priceable against them.`
        : asking + active > 0
          ? `${asking} asking-market reference(s) and ${active} active competitor(s) are retained; no accepted closed in-band vacant-land sale yet.`
          : 'No comparable evidence is retained yet.',
      stillUnresolved: sold > 0
        ? 'Reconciliation of the retained closed sales into a supported value band.'
        : 'One or more closed vacant-land sales inside the subject acreage band.',
      whyItMatters: 'Fair market value and every acquisition level stay locked without closed evidence.',
      nextSource: 'Comp providers and county transfer records.',
      shortStatus: sold > 0 ? `${sold} closed sale(s), value not yet reconciled` : 'Not priceable yet',
      shortNext: sold > 0 ? 'Reconcile the retained sales' : 'One closed in-band sale',
      urgent: true,
    });
  }

  return items;
}

/** True when the entry is a short evidence-gap chip rather than a narrative. */
function isEvidenceGap(message: string): boolean {
  return message.length <= 48 && !/[:—]/.test(message) && !STALE_LANGUAGE.test(message);
}

/**
 * Historical comp/valuation conclusions the CURRENT accepted records can
 * contradict. Each rule names the exact record that supersedes it, so genuine
 * uncertainty is never deleted on a guess.
 */
const SUPERSEDED_BY_ACCEPTED_COMPS: Array<{
  pattern: RegExp;
  supersededWhen: (state: DiscoveryDiligenceState) => boolean;
  because: (state: DiscoveryDiligenceState) => string;
}> = [
  {
    // "…survived", "…remain", "…retained", "…retrieved yet" are all the same
    // historical claim: that the working set is empty.
    pattern: /no usable comp(?:arable)?s?[^.]*(?:surviv|remain|retain|retriev)/i,
    supersededWhen: (s) => (s.acceptedSoldComps ?? 0) > 0,
    because: (s) => `${s.acceptedSoldComps} accepted closed sale(s) are retained in the current working set.`,
  },
  {
    // The provider-search wording: "No usable comps found after searching …".
    pattern: /no usable comps? (?:found|available|were found)/i,
    supersededWhen: (s) => (s.acceptedSoldComps ?? 0) > 0,
    because: (s) => `${s.acceptedSoldComps} accepted closed sale(s) are retained in the current working set.`,
  },
  {
    pattern: /(?:another|one more|an additional)[^.]*sale[^.]*(?:still )?(?:required|needed)/i,
    supersededWhen: (s) => (s.acceptedSoldComps ?? 0) > 0,
    because: (s) => `${s.acceptedSoldComps} accepted closed sale(s) are already retained.`,
  },
  {
    pattern: /no (?:accepted |usable )?closed[^.]*sale/i,
    supersededWhen: (s) => (s.acceptedSoldComps ?? 0) > 0,
    because: (s) => `${s.acceptedSoldComps} accepted closed sale(s) are retained.`,
  },
  {
    pattern: /no comparable evidence|comps? (?:are |is )?missing/i,
    supersededWhen: (s) => (s.acceptedSoldComps ?? 0) + (s.acceptedActiveComps ?? 0) + (s.acceptedAskingReferences ?? 0) > 0,
    because: (s) => `${(s.acceptedSoldComps ?? 0) + (s.acceptedActiveComps ?? 0) + (s.acceptedAskingReferences ?? 0)} comparable record(s) are retained.`,
  },
];

export function reconcileMissingDiligence(
  state: DiscoveryDiligenceState,
  rawMessages: string[],
): MissingDiligenceChecklist {
  const items = fixedItems(state);
  const coveredKeys = new Set(items.map((item) => item.key));
  const evidenceGaps: string[] = [];
  const passthrough: string[] = [];
  const supersededByAcceptedRecords: Array<{ statement: string; supersededBy: string }> = [];

  for (const raw of rawMessages.map((value) => value.trim()).filter(Boolean)) {
    // A statement the accepted comp record contradicts is superseded before any
    // category matching, so a stale comp conclusion can never reach the surface
    // beside the accepted sales that disprove it.
    const contradicted = SUPERSEDED_BY_ACCEPTED_COMPS.find(
      (rule) => rule.pattern.test(raw) && rule.supersededWhen(state),
    );
    if (contradicted) {
      if (!supersededByAcceptedRecords.some((entry) => entry.statement === raw)) {
        supersededByAcceptedRecords.push({ statement: raw, supersededBy: contradicted.because(state) });
      }
      continue;
    }
    const matched = CATEGORY_MATCHERS.filter((matcher) => matcher.pattern.test(raw));
    if (!matched.length) {
      if (isEvidenceGap(raw)) { if (!evidenceGaps.includes(raw)) evidenceGaps.push(raw); }
      else if (!passthrough.includes(raw)) passthrough.push(raw);
      continue;
    }
    // Superseded when every referenced category is either discovery-complete
    // or represented by an accurate checklist item. Anything else is genuine
    // uncertainty the checklist does not cover — keep it verbatim.
    const fullyRepresented = matched.every((matcher) => matcher.complete(state) || coveredKeys.has(matcher.key));
    if (!fullyRepresented && !passthrough.includes(raw)) passthrough.push(raw);
  }

  return { items, evidenceGaps, passthrough, supersededByAcceptedRecords };
}
