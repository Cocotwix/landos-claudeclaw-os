// Discovery-stage access presentation (projection layer).
//
// Operator definition: at discovery stage, LEGAL ACCESS means the subject
// abuts or has access to a public road, private road, or recorded access
// road. When the accepted parcel evidence shows the parcel abuts a road
// (mapped frontage present and no landlocked flag), legal access is
// displayed as PRESENT — it is never shown as unresolved merely because no
// driveway, survey, deed review, or separate recorded access instrument has
// been retrieved yet. APPARENT ENTRANCE is a separate, purely visual
// question answered from retained Street View / aerial evidence, and is
// never fabricated.
//
// Genuine uncertainty is preserved: exact surveyed frontage, easements
// affecting other portions of the parcel, corridor ownership and crossing
// rights, and road maintenance when the road is private stay honestly open.
// Driveway-approval / entrance-permit language is never part of this
// operator workflow. The persisted snapshot record is not modified.

import type { SnapshotDueDiligenceItem } from './property-intelligence-snapshot.js';
import {
  reconcileAccessEvidence,
  type AccessEvidenceItem,
  type AccessEvidenceReconciliation,
} from './access-evidence-ladder.js';

/** Canonical operator projection for source-separated access evidence. */
export function presentDiscoveryAccessEvidence(items: AccessEvidenceItem[]): AccessEvidenceReconciliation {
  return reconcileAccessEvidence(items);
}

const ROAD_SUFFIX: Record<string, string> = {
  rd: 'Road', st: 'Street', dr: 'Drive', ln: 'Lane', ave: 'Avenue', av: 'Avenue',
  hwy: 'Highway', ct: 'Court', pl: 'Place', blvd: 'Boulevard', ter: 'Terrace',
  cir: 'Circle', pkwy: 'Parkway', tpke: 'Turnpike',
};

/** "1487 Onionville Rd, Sterling, NY 13156" → "Onionville Road". */
export function roadNameFromSitus(situs: string | null | undefined): string | null {
  const street = String(situs ?? '').split(',')[0]?.trim() ?? '';
  const road = street.replace(/^[\d\-/]+\s+/, '').trim();
  if (!road) return null;
  const parts = road.split(/\s+/);
  const last = parts[parts.length - 1]?.toLowerCase().replace(/\.$/, '');
  if (last && ROAD_SUFFIX[last]) parts[parts.length - 1] = ROAD_SUFFIX[last];
  return parts.join(' ');
}

export interface DiscoveryAccessRead {
  /** Discovery-stage legal access is established by road abutment evidence. */
  established: boolean;
  road: string | null;
  frontageFt: number | null;
  landlocked: 'yes' | 'no' | null;
  /** Operator display line, e.g. "Yes, via Onionville Road". */
  display: string | null;
}

/** Read the access evidence out of the stored access due-diligence item. */
export function readDiscoveryAccess(
  items: SnapshotDueDiligenceItem[],
  situsAddress: string | null | undefined,
): DiscoveryAccessRead {
  const item = items.find((candidate) => candidate.key === 'access');
  const headline = item?.headline ?? '';
  const frontage = headline.match(/(\d+(?:\.\d+)?)\s*ft frontage/i);
  const landlockedMatch = headline.match(/landlocked flag:\s*(yes|no)/i);
  const frontageFt = frontage ? Number(frontage[1]) : null;
  const landlocked = landlockedMatch ? (landlockedMatch[1].toLowerCase() as 'yes' | 'no') : null;
  const road = roadNameFromSitus(situsAddress);
  const established = landlocked === 'no' && (frontageFt ?? 0) > 0;
  return {
    established,
    road,
    frontageFt,
    landlocked,
    display: established ? `Yes, via ${road ?? 'the abutting road'}` : null,
  };
}

/** Stale access-unresolved phrasing this workflow never shows once discovery
 *  access is established. Kept as one list so projections and tests agree. */
export const RESOLVED_ACCESS_STALE_PATTERN =
  /recorded legal access has not been established|public right[- ]of[- ]way contact|driveway (?:approval|permit)|physical \/? ?driveway access|parcel.road boundary contact unresolved|mapped frontage unresolved|legal access unresolved|legal access is established by a recorded instrument|road maintenance responsibility unresolved|legal access still requires|road proximity screening has not run/i;

/** Genuine access follow-ups that remain after discovery access is present. */
export function establishedAccessFollowUps(): string[] {
  return [
    'Exact surveyed frontage (survey-grade confirmation).',
    'Any recorded easements affecting other portions of the parcel.',
  ];
}

/**
 * Rewrite the access due-diligence item for display when the accepted parcel
 * evidence establishes discovery-stage legal access. System-wide rule: any
 * property whose stored access headline shows mapped frontage and no
 * landlocked flag is displayed with legal access present. The headline keeps
 * the original "<n> ft frontage shown; landlocked flag: <x>" fragment so the
 * existing metric parsers (hero chips, score) keep working. Non-qualifying
 * items are returned untouched.
 */
export function normalizeDiscoveryAccessItems(
  items: SnapshotDueDiligenceItem[],
  situsAddress: string | null | undefined,
): SnapshotDueDiligenceItem[] {
  const read = readDiscoveryAccess(items, situsAddress);
  if (!read.established) return items;
  const road = read.road ?? 'the abutting road';
  return items.map((item) => {
    if (item.key !== 'access') return item;
    const metrics = [
      read.frontageFt != null ? `${item.headline.match(/(\d+(?:\.\d+)?)\s*ft frontage[^;]*/i)?.[0] ?? `${read.frontageFt} ft frontage shown`}` : null,
      read.landlocked ? `landlocked flag: ${read.landlocked === 'no' ? 'No' : 'Yes'}` : null,
    ].filter(Boolean).join('; ');
    return {
      ...item,
      label: 'Legal access and road frontage',
      verdict: 'good' as const,
      headline: `Legal access: Yes, via ${road} — ${metrics}`,
      detail: `Discovery-stage operator rule: the parcel abuts ${road} with mapped road frontage and is not flagged landlocked, so legal access is displayed as present. Survey-grade frontage and any recorded easements affecting other portions of the parcel remain ordinary follow-ups, not access blockers.`,
      missing: establishedAccessFollowUps(),
    };
  });
}

export interface ApparentEntranceRead {
  /** Operator display line. Never fabricated. */
  display: string;
  /** True only when a visible entry point is supported by retained imagery. */
  confirmed: boolean;
  /** The retained observation the display is grounded in, when one exists. */
  observation: string | null;
  /**
   * The observation record's own evidence label (for example
   * "Street View — unconfirmed"). The apparent-physical tier is attributed from
   * this rather than from whichever provider page the parcel link points at, so
   * a Street View read is never credited to a surface that reported no Street
   * View coverage.
   */
  evidenceLabel: string | null;
  /** The observation record's own stated confidence, when it carries one. */
  confidence: string | null;
}

const ENTRANCE_POSITIVE =
  /cleared (?:grass )?path|grass (?:drive|path)|dirt (?:drive|path)|gravel drive|paved drive|gate(?:\s|d)|established vehicle path|visible (?:entrance|entry|curb cut|drive)/i;
const ENTRANCE_NEGATED = /\bno\b|not visible|none visible|absent|without/i;

/**
 * Apparent entrance from retained visual observations (Street View or
 * aerial). Distinct from legal access: it may be a cleared grass path, dirt
 * or gravel drive, gate opening, or other visible entry point — pavement is
 * not required. When the retained evidence shows no visible entrance, or no
 * entrance observation is retained, the honest display is
 * "Not confirmed from retained imagery".
 */
export function apparentEntranceFromObservations(
  observations: Array<{ label?: string; detail?: string; evidence?: string | null; confidence?: string | null }> | null | undefined,
  road?: string | null,
): ApparentEntranceRead {
  const entranceObs = (observations ?? []).find((item) => /entrance|driveway/i.test(item.label ?? ''));
  const detail = entranceObs?.detail ?? '';
  const evidenceLabel = entranceObs?.evidence?.trim() || null;
  const confidence = entranceObs?.confidence?.trim() || null;
  if (entranceObs && ENTRANCE_POSITIVE.test(detail) && !ENTRANCE_NEGATED.test(detail)) {
    const kind = detail.match(ENTRANCE_POSITIVE)?.[0]?.toLowerCase() ?? 'entry point';
    const cleaned = kind.replace(/\s+$/, '');
    return {
      display: `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} visible from ${road ?? 'the road'}`,
      confirmed: true,
      observation: detail,
      evidenceLabel,
      confidence,
    };
  }
  return {
    display: 'Not confirmed from retained imagery',
    confirmed: false,
    observation: entranceObs?.detail ?? null,
    evidenceLabel,
    confidence,
  };
}

/**
 * How the apparent-physical tier must credit a retained entrance observation.
 * The label repeats the observation record's own evidence wording instead of
 * naming a provider, and an observation the record itself calls unconfirmed or
 * low-confidence is carried at `likely`, never at `well_supported`.
 */
export function apparentEntranceAttribution(read: Pick<ApparentEntranceRead, 'evidenceLabel' | 'confidence'>): {
  sourceLabel: string;
  weight: 'well_supported' | 'likely';
} {
  const label = read.evidenceLabel;
  const hedged = /unconfirmed|uncertain|possible/i.test(label ?? '') || /^low$/i.test(read.confidence ?? '');
  return {
    sourceLabel: label ? `Retained visual observation — ${label}` : 'Retained visual observation',
    weight: hedged ? 'likely' : 'well_supported',
  };
}

/** Drop stale access-unresolved lines from a display list once discovery
 *  access is established. Genuine items (survey, easements, corridor rights,
 *  private-road maintenance questions phrased as such) pass through. */
export function filterResolvedAccessLanguage(entries: string[], established: boolean): string[] {
  if (!established) return entries;
  return entries.filter((entry) => !RESOLVED_ACCESS_STALE_PATTERN.test(entry));
}

// Buyer-analysis display phrasing that misstates the discovery-stage access
// rule once road abutment is established. The persisted analysis record is
// never modified — only its operator display is corrected.
const VBA_ACCESS_UNRESOLVED_LINE = /^recorded legal access\b|legal access (?:not yet established|still requires|unresolved)|requiring immediate documented legal access/i;
const VBA_ACCESS_CLAUSE = /;?\s*(?:recorded )?legal access (?:still requires|requires) (?:recorded-)?instrument review\.?/gi;
const VBA_ACCESS_CONFIRMATION = /\s+and\s+legal[- ]access(?=\s+confirmation)/gi;

interface BuyerAnalysisLike {
  observedFeatures?: Array<{ detail: string }>;
  buyerInterpretation?: Array<{ detail: string }>;
  unresolvedDiligence?: string[];
  buyerPerspective?: {
    importantConcerns?: string[];
    weakerFitBuyers?: string[];
    materialToValueOrStrategy?: string[];
  };
}

/**
 * Present a retained Visual Buyer Analysis with the discovery-stage access
 * terminology applied for DISPLAY: unresolved-access lines are removed (the
 * genuine survey/easement/corridor follow-ups live in Missing Diligence) and
 * instrument-review clauses are stripped from observation details. Returns
 * the analysis untouched when access is not established.
 */
export function presentBuyerAnalysisAccessLanguage<T extends BuyerAnalysisLike>(
  analysis: T | null,
  established: boolean,
): T | null {
  if (!analysis || !established) return analysis;
  const stripClause = (value: string): string =>
    value.replace(VBA_ACCESS_CLAUSE, '.').replace(/\.\.+/g, '.').replace(/\s+\./g, '.');
  const perspective = analysis.buyerPerspective;
  return {
    ...analysis,
    observedFeatures: analysis.observedFeatures?.map((item) => ({ ...item, detail: stripClause(item.detail) })),
    buyerInterpretation: analysis.buyerInterpretation?.map((item) => ({ ...item, detail: stripClause(item.detail) })),
    unresolvedDiligence: analysis.unresolvedDiligence?.filter((entry) => !VBA_ACCESS_UNRESOLVED_LINE.test(entry)),
    buyerPerspective: perspective
      ? {
          ...perspective,
          importantConcerns: perspective.importantConcerns?.filter((entry) => !VBA_ACCESS_UNRESOLVED_LINE.test(entry)),
          weakerFitBuyers: perspective.weakerFitBuyers?.filter((entry) => !VBA_ACCESS_UNRESOLVED_LINE.test(entry)),
          materialToValueOrStrategy: perspective.materialToValueOrStrategy
            ?.map((entry) => entry.replace(VBA_ACCESS_CONFIRMATION, '').replace(/\s{2,}/g, ' ').trim())
            .filter(Boolean),
        }
      : perspective,
  } as T;
}
