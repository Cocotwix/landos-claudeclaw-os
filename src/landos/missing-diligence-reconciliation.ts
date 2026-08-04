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
  /** Road name once discovery-stage legal access is established by road
   *  abutment evidence (mapped frontage + no landlocked flag); null keeps
   *  access honestly open. */
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
    // Discovery-stage legal access is PRESENT (the parcel abuts a road per
    // accepted parcel evidence). Only the genuine follow-ups stay open:
    // surveyed frontage, easements, and any unresolved corridor rights.
    // Driveway-approval / permit language is never part of this workflow.
    items.push({
      key: 'access',
      label: 'Access follow-ups (survey and easements)',
      currentFinding: [
        `Legal access: Yes, via ${state.legalAccessRoad} — the parcel abuts the road${state.frontageFt != null ? ` with approximately ${ft(state.frontageFt)} of mapped frontage` : ''} and is not flagged landlocked`,
        state.streetViewComplete ? 'Street View confirms direct road adjacency' : null,
      ].filter(Boolean).join('; ') + '.',
      stillUnresolved: [
        'Exact surveyed frontage',
        state.corridorRightsUnresolved ? 'ownership and crossing rights of the corridor crossing the parcel' : null,
        'any recorded easements affecting other portions of the parcel',
      ].filter(Boolean).join('; ') + '.',
      whyItMatters: 'Survey-grade frontage, corridor rights, and recorded easements refine boundaries and internal access; they do not gate discovery-stage legal access.',
      nextSource: 'Boundary survey and recorded deed/easement documents.',
      shortStatus: `Legal access: Yes, via ${state.legalAccessRoad}`,
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
    items.push({
      key: 'valuation',
      label: 'Closed-sale evidence for valuation',
      currentFinding: 'An asking-market indication is retained; no accepted closed in-band vacant-land sale yet.',
      stillUnresolved: 'One or more closed vacant-land sales inside the subject acreage band.',
      whyItMatters: 'Fair market value and every acquisition level stay locked without closed evidence.',
      nextSource: 'Comp providers and county transfer records.',
      shortStatus: 'Not priceable yet',
      shortNext: 'One closed in-band sale',
      urgent: true,
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
