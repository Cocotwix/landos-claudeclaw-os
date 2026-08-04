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
}

export interface MissingDiligenceChecklist {
  items: MissingDiligenceItem[];
  /** Small honest evidence gaps (chips) that need no structured explanation. */
  evidenceGaps: string[];
  /** Raw messages retained because no category or checklist item covers them. */
  passthrough: string[];
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

  // Legal access can only be resolved by recorded instruments — always open
  // at discovery stage. This single item condenses every access-family warning.
  items.push({
    key: 'access',
    label: 'Legal access and frontage confirmation',
    currentFinding: state.frontageFt != null || state.streetViewComplete
      ? [
          state.frontageFt != null ? `LandPortal maps approximately ${ft(state.frontageFt)} of road frontage` : null,
          state.streetViewComplete ? 'Street View shows direct road adjacency with no physical frontage barrier observed' : null,
        ].filter(Boolean).join('; ') + '.'
      : 'No mapped frontage or Street View pass is retained yet.',
    stillUnresolved: 'Recorded access rights, surveyed frontage, public right-of-way contact, driveway approval, and road maintenance responsibility.',
    whyItMatters: 'Legal access is established by recorded instruments, not mapped proximity; it gates buildability, financing, and value.',
    nextSource: 'Recorded deed and easement documents, survey, county highway records, driveway permit authority.',
  });

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
    });
  }

  items.push({
    key: 'survey',
    label: 'Surveyed boundary and frontage confirmation',
    currentFinding: 'Boundary and acreage are retained from LandPortal parcel mapping (discovery stage).',
    stillUnresolved: 'Surveyed boundary, monumented corners, and exact legal frontage.',
    whyItMatters: 'Mapped geometry is an indication; conveyance and build placement rely on a survey.',
    nextSource: 'Existing recorded survey or a new boundary survey.',
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
    });
  }

  if (!state.septicConfirmed) {
    items.push({
      key: 'septic',
      label: 'Septic and perc feasibility',
      currentFinding: state.soilUnitCount > 0
        ? `LandPortal soil screening completed: ${state.soilUnitCount} accepted soil unit(s) with drainage, farmland, and capability attributes are retained.`
        : 'Soil screening has not been run yet.',
      stillUnresolved: 'Perc test and county health department septic feasibility.',
      whyItMatters: 'Soil interpretation is not a passed perc test; septic feasibility gates homesite use.',
      nextSource: 'Perc test and the county health department.',
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
    });
  }

  if (!state.valuationPriceable) {
    items.push({
      key: 'valuation',
      label: 'Closed-sale evidence for valuation',
      currentFinding: 'An asking-market indication is retained; no accepted closed in-band vacant-land sale yet.',
      stillUnresolved: 'One or more closed vacant-land sales inside the subject acreage band.',
      whyItMatters: 'Fair market value and every acquisition level stay locked without closed evidence.',
      nextSource: 'Comp providers and county transfer records.',
    });
  }

  return items;
}

/** True when the entry is a short evidence-gap chip rather than a narrative. */
function isEvidenceGap(message: string): boolean {
  return message.length <= 48 && !/[:—]/.test(message) && !STALE_LANGUAGE.test(message);
}

export function reconcileMissingDiligence(
  state: DiscoveryDiligenceState,
  rawMessages: string[],
): MissingDiligenceChecklist {
  const items = fixedItems(state);
  const coveredKeys = new Set(items.map((item) => item.key));
  const evidenceGaps: string[] = [];
  const passthrough: string[] = [];

  for (const raw of rawMessages.map((value) => value.trim()).filter(Boolean)) {
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

  return { items, evidenceGaps, passthrough };
}
