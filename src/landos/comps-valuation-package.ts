/**
 * The operator valuation package: three labeled FMV views and the standard
 * offer benchmarks, computed over the EXISTING comps-valuation outputs.
 *
 * This is arithmetic over numbers the valuation view already carries, not a
 * second valuation engine:
 *   - LandPortal FMV is the value LandPortal itself published (never rebuilt).
 *   - Non-LandPortal FMV is the existing cleaned reconciliation run over the
 *     closed sales that at least one non-LandPortal lane supplied.
 *   - Combined LandOS FMV is the plain average of the two when both exist,
 *     the single lane when only one exists, and the closest price-bearing
 *     evidence at low confidence when neither does. It is never blank once a
 *     valuation has run and there is any price-bearing evidence at all.
 *   - 40% and 60% benchmarks derive from Combined LandOS FMV only. No 50%.
 */

import type { CleanedValuation, WorkspaceComp } from './comps-valuation.js';

export type ValuationConfidence = 'high' | 'moderate' | 'low' | 'unavailable';

export interface LaneFmv {
  value: number | null;
  /** Qualified closed vacant-land sales this lane supplied. */
  compCount: number;
  /** Every retained record this lane supplied, by workspace category label,
   *  so context and active records are shown honestly rather than hidden. */
  associatedCount: number;
  associatedBreakdown: Array<{ category: string; label: string; count: number }>;
  associatedNote: string | null;
  confidence: ValuationConfidence;
  source: string;
  retrievedAt: string | null;
  limitation: string | null;
  /** Canonical comp keys that carry this lane's sold evidence. */
  compKeys: string[];
}

export type CombinedFmvMethod = 'average' | 'landportal_only' | 'non_landportal_only' | 'closest_evidence' | 'unavailable';

export interface CombinedFmv {
  value: number | null;
  method: CombinedFmvMethod;
  methodLabel: string;
  confidence: ValuationConfidence;
  limitation: string | null;
  calculation: string;
}

export interface CollectiveComparison {
  posture: 'more_desirable' | 'similar' | 'less_desirable';
  postureLabel: string;
  statement: string;
  reasons: string[];
  basis: 'visuals_and_remarks' | 'facts_only';
  compCount: number;
}

export interface ActiveCompetitionSummary {
  compKeys: string[];
  count: number;
  summary: string;
}

/** Retained subject terrain and site facts used by the comparison and the
 *  preliminary Land Home Package physical screen. All optional: missing facts
 *  lower certainty, they never invent a conclusion. */
export interface SubjectSiteFacts {
  buildableAcres: number | null;
  buildabilityPct: number | null;
  slopeAvgPct: number | null;
  slopeUnder10Pct: number | null;
  wetlandsPct: number | null;
  femaCoveragePct: number | null;
  waterPresent: boolean | null;
  roadFrontageFt: number | null;
  landLocked: boolean | null;
}

/** Preliminary Land Home Package opportunity screen. A market and physical
 *  trigger only; zoning permission and the posture label are applied by the
 *  Deal Brain where the Development Path is known. */
export interface LandHomePackageScreen {
  physical: { met: boolean | null; usableAcres: number | null; slopeBasis: string | null; note: string };
  market: {
    met: boolean; qualifyingSaleCount: number; topSalePrice: number | null; note: string;
    /** The one-sentence reason the operator reads: which qualifying sales
     *  carry the screen, named by the subject's own street and retained
     *  subdivision when a sale sits on them. Null until the screen is met. */
    brief: string | null;
    /** False when any approved manufactured-home source was blocked or errored,
     *  so a "no sale found" cannot be called a completed search. */
    searchComplete: boolean;
    /** The lane's own per-source outcome line, when retained. */
    searchOutcome: string | null;
  };
  soldCompKeys: string[];
  activeCompKeys: string[];
  excludedCount: number;
  triggered: boolean;
  /** Exact requirement carried to the Deal Brain and the UI. */
  rule: string;
}

export interface CompsValuationPackage {
  landPortalFmv: LaneFmv;
  nonLandPortalFmv: LaneFmv & { sources: string[]; method: string };
  combinedFmv: CombinedFmv;
  offer40: number | null;
  offer60: number | null;
  /** Seller asking price on file. Kept beside, never inside, the benchmarks. */
  askingPrice: number | null;
  collectiveComparison: CollectiveComparison;
  activeCompetition: ActiveCompetitionSummary;
  landHomePackage: LandHomePackageScreen;
  landWatch: { applicable: boolean; thresholdAcres: number; additive: true; note: string };
}

export const LAND_HOME_MIN_USABLE_ACRES = 0.5;
export const LAND_HOME_MAX_SLOPE_PCT = 10;
export const LAND_HOME_MARKET_MIN_SALE_USD = 200_000;
export const LAND_HOME_MARKET_RADIUS_MILES = 5;

/** Manufactured or mobile home record, by the retained provider labels and text. */
export function isManufacturedHomeRecord(comp: Pick<WorkspaceComp, 'source' | 'origins' | 'classificationReason' | 'listing' | 'address'>): boolean {
  const text = [comp.source, ...comp.origins, comp.classificationReason, comp.listing?.description.source?.text ?? ''].join(' ');
  return /manufactured|mobile home|mobile\/manufactured|double[- ]?wide|single[- ]?wide/i.test(text);
}

/** Obvious park or leased-lot listings: excluded on their own words, never a title investigation. */
export function isObviousParkOrLeasedLot(comp: Pick<WorkspaceComp, 'address' | 'classificationReason' | 'listing'>): boolean {
  const text = [comp.address ?? '', comp.classificationReason, comp.listing?.description.source?.text ?? ''].join(' ');
  return /mobile home park|\bmhp\b|manufactured home community|lot rent|leased lot|land lease|leased land|\blot \d+\b.*\bpark\b|space rent/i.test(text);
}

/** LandWatch joins the non-LandPortal provider set at this acreage and above. */
export const LANDWATCH_ADDITIVE_MIN_ACRES = 20;

const round500 = (n: number): number => Math.round(n / 500) * 500;
const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

export function isLandPortalLabel(label: string | null | undefined): boolean {
  return /land\s*portal/i.test(label ?? '');
}

/** Any provider observation behind this record that is not LandPortal. */
export function hasNonLandPortalOrigin(comp: Pick<WorkspaceComp, 'origins' | 'source'>): boolean {
  const labels = comp.origins.length ? comp.origins : String(comp.source ?? '').split(' + ');
  return labels.some((label) => label.trim() && !isLandPortalLabel(label));
}

export function hasLandPortalOrigin(comp: Pick<WorkspaceComp, 'origins' | 'source' | 'fromLandPortalSidebar' | 'fromLandPortalShowOnMap'>): boolean {
  if (comp.fromLandPortalSidebar || comp.fromLandPortalShowOnMap) return true;
  const labels = comp.origins.length ? comp.origins : String(comp.source ?? '').split(' + ');
  return labels.some(isLandPortalLabel);
}

const isClosedSale = (c: WorkspaceComp): boolean =>
  c.category === 'accepted_closed_sale' || c.category === 'candidate_closed_sale';

function downgrade(confidence: ValuationConfidence): ValuationConfidence {
  return confidence === 'high' ? 'moderate' : confidence === 'moderate' ? 'low' : confidence;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ValuationPackageInput {
  subjectAcres: number | null;
  /** LandPortal's own published estimate, read verbatim. */
  landPortalEstimate: { price: number | null; perAcre?: number | null; source: string; retrievedAt?: string | null } | null;
  comps: WorkspaceComp[];
  /** Cleaned reconciliation over the non-LandPortal closed-sale subset. */
  nonLandPortalCleaned: CleanedValuation;
  /** Cleaned reconciliation over every retained closed sale (all lanes). */
  allLanesCleaned: CleanedValuation;
  /** Closest retained sold-market evidence for a thin market: median sold $/ac. */
  marketFallback: { pricePerAcre: number; label: string } | null;
  askingPrice: number | null;
  subjectImproved: boolean;
  /** Retained subject site facts (LandPortal parcel panel); null when none. */
  subjectFacts?: SubjectSiteFacts | null;
  /** The manufactured-home lane's retained attempt outcome, when any. */
  manufacturedSearch?: { status: string | null; note: string | null } | null;
  /** The subject's own street ("NW 137th Ln") and retained subdivision name
   *  ("RIVER OAK PLANTATION S/D"), so the market brief can name a same-street
   *  or same-subdivision sale. Retained facts only; null when unknown. */
  subjectStreet?: string | null;
  subjectSubdivision?: string | null;
}

/** "19517 NW 137th Ln, Lake Butler, FL 32054" → "nw 137th ln" (comparison key). */
function streetKey(address: string | null | undefined): string | null {
  const street = (address ?? '').replace(/,.*$/, '').replace(/^\s*\d+[A-Za-z]?\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return street && !/^\d+$/.test(street) ? street : null;
}

/** "RIVER OAK PLANTATION S/D" → "River Oak Plantation". */
function subdivisionName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').replace(/\b(?:S\/D|SUBDIVISION|SUB|PH(?:ASE)?\s*\w+|UNIT\s*\w+)\b/gi, '').replace(/\s+/g, ' ').trim();
  return name ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
}

/** Workspace category labels, mirrored so the package can describe records honestly. */
const CATEGORY_LABELS: Record<string, string> = {
  accepted_closed_sale: 'Accepted closed sale',
  candidate_closed_sale: 'Candidate closed sale',
  active_competition: 'Active competition',
  asking_reference: 'Asking reference',
  improved_context: 'Improved-property context',
  rejected: 'Rejected',
  context_only: 'Context only',
};

function breakdownOf(records: WorkspaceComp[]): Array<{ category: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of records) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  return [...counts.entries()].map(([category, count]) => ({ category, label: CATEGORY_LABELS[category] ?? category, count }));
}

export function computeValuationPackage(input: ValuationPackageInput): CompsValuationPackage {
  const acres = input.subjectAcres != null && input.subjectAcres > 0 ? input.subjectAcres : null;
  const sold = input.comps.filter(isClosedSale);
  const lpSold = sold.filter(hasLandPortalOrigin);
  const nonLpSold = sold.filter(hasNonLandPortalOrigin);
  const nonLpInSet = nonLpSold.filter((c) => c.inValuationSet && c.price != null && c.acres != null && c.acres > 0);

  // ── LandPortal FMV: extracted, never rebuilt ─────────────────────────────
  // The published estimate must belong to the ACCEPTED acquisition interest.
  // LandPortal prints a price and a per-acre figure; when the acreage they
  // imply is not the accepted acreage, the estimate is for a different extent
  // (a parent holding, a stale assessor size) and cannot be current FMV for
  // this subject. That is the lifecycle rule against a different-parcel
  // valuation appearing as current, not a reinterpretation of LandPortal.
  const lpPublished = input.landPortalEstimate?.price ?? null;
  const lpPerAcre = input.landPortalEstimate?.perAcre ?? null;
  const lpImpliedAcres = lpPublished != null && lpPerAcre != null && lpPerAcre > 0 ? lpPublished / lpPerAcre : null;
  const lpAcreageMismatch = acres != null && lpImpliedAcres != null && Math.abs(lpImpliedAcres - acres) / acres > 0.15;
  const lpPrice = lpAcreageMismatch ? null : lpPublished;
  const lpAssociated = input.comps.filter(hasLandPortalOrigin);
  const lpBreakdown = breakdownOf(lpAssociated);
  const landPortalFmv: LaneFmv = {
    value: lpPrice,
    compCount: lpSold.length,
    associatedCount: lpAssociated.length,
    associatedBreakdown: lpBreakdown,
    associatedNote: lpAssociated.length === 0
      ? 'No LandPortal comp record is retained for this subject.'
      : lpSold.length === 0
        ? `${lpAssociated.length} LandPortal record${lpAssociated.length === 1 ? '' : 's'} retained as ${lpBreakdown.map((b) => `${b.count} ${b.label.toLowerCase()}`).join(', ')}. They are LandPortal’s displayed evidence beside its estimate; none is a qualified closed vacant-land sale, so they do not price the subject.`
        : `${lpSold.length} LandPortal closed sale${lpSold.length === 1 ? '' : 's'} plus ${lpAssociated.length - lpSold.length} further retained LandPortal record${lpAssociated.length - lpSold.length === 1 ? '' : 's'} (${lpBreakdown.map((b) => `${b.count} ${b.label.toLowerCase()}`).join(', ')}).`,
    confidence: lpPrice != null ? 'moderate' : 'unavailable',
    source: input.landPortalEstimate?.source ?? 'LandPortal',
    retrievedAt: input.landPortalEstimate?.retrievedAt ?? null,
    limitation: lpPrice != null
      ? 'LandPortal’s own automated estimate, shown as published; LandOS does not recalculate it.'
      : lpAcreageMismatch
        ? `LandPortal’s published estimate (${money(lpPublished as number)} at ${money(lpPerAcre as number)}/ac) implies about ${(lpImpliedAcres as number).toFixed(1)} acres, not the accepted ${acres} acres, so it is retained as context and not used as the LandPortal FMV for this subject.`
        : 'LandPortal did not publish an estimate for this subject. Only this component is unavailable.',
    compKeys: lpSold.map((c) => c.key),
  };

  // ── Non-LandPortal FMV: existing cleaned reconciliation, non-LP subset ────
  const sourceMap = new Map<string, string>();
  for (const label of nonLpSold.flatMap((c) => c.origins.length ? c.origins : [c.source])) {
    if (!label || isLandPortalLabel(label)) continue;
    const key = label.trim().toLowerCase();
    if (!sourceMap.has(key)) sourceMap.set(key, label.trim());
  }
  const sources = [...sourceMap.values()];
  let nonLpValue = input.nonLandPortalCleaned.adoptedFmv;
  let nonLpConfidence: ValuationConfidence = input.nonLandPortalCleaned.confidence;
  let nonLpMethod = 'Weighted direct-comp indication reconciled with the cleaned median and average over the non-LandPortal closed sales.';
  let nonLpLimitation: string | null = null;
  if (nonLpValue == null && acres != null && nonLpInSet.length === 1) {
    const only = nonLpInSet[0];
    nonLpValue = round500(((only.price as number) / (only.acres as number)) * acres);
    nonLpConfidence = 'low';
    nonLpMethod = 'Single non-LandPortal closed sale applied per acre to the subject acreage.';
    nonLpLimitation = 'Only one non-LandPortal closed sale qualified; the indication is low confidence until a second closed sale is admitted.';
  } else if (nonLpValue == null) {
    nonLpConfidence = 'unavailable';
    nonLpLimitation = nonLpSold.length
      ? 'Non-LandPortal closed sales are retained but none qualified for the cleaned set.'
      : 'No non-LandPortal closed vacant-land sale is retained yet.';
  }
  const nonLpAssociated = input.comps.filter(hasNonLandPortalOrigin);
  const nonLpBreakdown = breakdownOf(nonLpAssociated);
  const nonLandPortalFmv: CompsValuationPackage['nonLandPortalFmv'] = {
    value: nonLpValue,
    compCount: nonLpInSet.length,
    associatedCount: nonLpAssociated.length,
    associatedBreakdown: nonLpBreakdown,
    associatedNote: nonLpAssociated.length === 0
      ? 'No non-LandPortal record is retained yet; the Zillow, Redfin and Realtor.com lanes have not returned evidence.'
      : `${nonLpAssociated.length} non-LandPortal record${nonLpAssociated.length === 1 ? '' : 's'} retained (${nonLpBreakdown.map((b) => `${b.count} ${b.label.toLowerCase()}`).join(', ')}); ${nonLpInSet.length} qualified closed vacant-land sale${nonLpInSet.length === 1 ? '' : 's'} price the lane.`,
    confidence: nonLpConfidence,
    source: sources.length ? sources.join(', ') : 'Non-LandPortal lanes',
    retrievedAt: null,
    limitation: nonLpLimitation,
    compKeys: nonLpInSet.map((c) => c.key),
    sources,
    method: nonLpMethod,
  };

  // ── Combined LandOS FMV ──────────────────────────────────────────────────
  let combined: CombinedFmv;
  if (lpPrice != null && nonLpValue != null) {
    const value = round500((lpPrice + nonLpValue) / 2);
    combined = {
      value,
      method: 'average',
      methodLabel: 'Average of LandPortal FMV and Non-LandPortal FMV',
      confidence: nonLpConfidence === 'unavailable' ? 'low' : nonLpConfidence,
      limitation: null,
      calculation: `(${money(lpPrice)} + ${money(nonLpValue)}) ÷ 2 = ${money(value)} (rounded to $500)`,
    };
  } else if (lpPrice != null) {
    combined = {
      value: lpPrice,
      method: 'landportal_only',
      methodLabel: 'LandPortal lane only',
      confidence: 'low',
      limitation: 'Currently supported by the LandPortal lane only; no non-LandPortal closed sale qualified yet.',
      calculation: `Combined LandOS FMV = LandPortal FMV ${money(lpPrice)}`,
    };
  } else if (nonLpValue != null) {
    combined = {
      value: nonLpValue,
      method: 'non_landportal_only',
      methodLabel: 'Non-LandPortal lane only',
      confidence: downgrade(nonLpConfidence),
      limitation: 'Currently supported by the non-LandPortal lane only; LandPortal published no estimate.',
      calculation: `Combined LandOS FMV = Non-LandPortal FMV ${money(nonLpValue)}`,
    };
  } else if (input.allLanesCleaned.adoptedFmv != null) {
    const value = input.allLanesCleaned.adoptedFmv;
    combined = {
      value,
      method: 'closest_evidence',
      methodLabel: 'Closest retained closed-sale evidence',
      confidence: 'low',
      limitation: 'Neither lane produced its own FMV; the LandOS cleaned reconciliation over every retained closed sale carries the value at low confidence.',
      calculation: `Combined LandOS FMV = cleaned reconciliation over ${input.allLanesCleaned.cleanedCount} retained closed sale(s) = ${money(value)}`,
    };
  } else if (acres != null && input.marketFallback && input.marketFallback.pricePerAcre > 0) {
    const value = round500(input.marketFallback.pricePerAcre * acres);
    combined = {
      value,
      method: 'closest_evidence',
      methodLabel: 'Closest sold-market evidence',
      confidence: 'low',
      limitation: `No qualifying closed sale is retained for either lane; the value rests on ${input.marketFallback.label} until closed sales are admitted.`,
      calculation: `${money(input.marketFallback.pricePerAcre)}/ac (${input.marketFallback.label}) × ${acres} ac = ${money(value)} (rounded to $500)`,
    };
  } else {
    combined = {
      value: null,
      method: 'unavailable',
      methodLabel: 'No price-bearing evidence retained',
      confidence: 'unavailable',
      limitation: acres == null
        ? 'The subject working acreage is not established, so no per-acre evidence can be applied.'
        : 'No closed sale and no sold-market record is retained yet; expand the sold-evidence search.',
      calculation: 'Combined LandOS FMV cannot be stated until price-bearing evidence is retained.',
    };
  }

  const offer40 = combined.value != null ? round500(combined.value * 0.4) : null;
  const offer60 = combined.value != null ? round500(combined.value * 0.6) : null;

  // ── One concise collective comparison over the selected sold comps ───────
  const selected = (nonLpInSet.length || lpSold.some((c) => c.inValuationSet))
    ? sold.filter((c) => c.inValuationSet)
    : sold.slice(0, 5);
  const withRemarks = selected.filter((c) => (c.listing?.description.source?.text ?? '').trim().length > 0).length;
  const withPhotos = selected.filter((c) => (c.listing?.photos.count ?? 0) > 0 || c.visual.provenance === 'listing_photo').length;
  const reasons: string[] = [];
  const compAcres = selected.map((c) => c.acres).filter((a): a is number => a != null && a > 0);
  const medAcres = median(compAcres);
  if (acres != null && medAcres != null) {
    if (acres < medAcres * 0.6) reasons.push(`Subject (${acres} ac) is smaller than most selected sales (median ${medAcres} ac); smaller parcels usually sell at a higher price per acre.`);
    else if (acres > medAcres * 1.6) reasons.push(`Subject (${acres} ac) is larger than most selected sales (median ${medAcres} ac); larger parcels usually sell at a lower price per acre.`);
    else reasons.push(`Subject (${acres} ac) sits inside the selected sales’ acreage range (median ${medAcres} ac).`);
  }
  const distances = selected.map((c) => c.distanceMiles).filter((d): d is number => d != null);
  if (distances.length) reasons.push(`Selected sales lie ${Math.min(...distances)}–${Math.max(...distances)} miles from the subject.`);
  if (input.subjectImproved) reasons.push('The subject carries an improvement the vacant-land sales do not; the land value is compared on a land-only basis.');
  const documentedDifferences = [...new Set(selected.map((c) => c.keyDifference).filter((d): d is string => !!d))].slice(0, 2);
  for (const difference of documentedDifferences) reasons.push(`Documented difference: ${difference}`);
  const basis: CollectiveComparison['basis'] = withRemarks > 0 || withPhotos > 0 ? 'visuals_and_remarks' : 'facts_only';

  // Posture: the subject's retained site facts against what the comps' own
  // remarks document. Each signal is a documented fact or an observed remark,
  // never an inference; with no facts and no remarks the score stays at zero
  // and the posture stays "generally similar" with the limitation stated.
  const facts = input.subjectFacts ?? null;
  const remarks = selected.map((c) => c.listing?.description.source?.text ?? '').filter((t) => t.trim());
  const remarkShare = (re: RegExp): number => remarks.length ? remarks.filter((t) => re.test(t)).length / remarks.length : 0;
  let score = 0;
  if (facts) {
    if (facts.wetlandsPct != null && facts.wetlandsPct >= 40) { score -= 1; reasons.push(`Mapped wetlands cover ${facts.wetlandsPct}% of the subject (LandPortal), shrinking the buildable envelope.`); }
    if (facts.femaCoveragePct != null && facts.femaCoveragePct >= 40) { score -= 1; reasons.push(`FEMA flood coverage reaches ${facts.femaCoveragePct}% of the subject (LandPortal).`); }
    if (facts.buildabilityPct != null && facts.buildabilityPct < 35) { score -= 1; reasons.push(`Only ${facts.buildabilityPct}% of the subject reads as buildable (LandPortal terrain read).`); }
    if (facts.slopeAvgPct != null && facts.slopeAvgPct >= 15) { score -= 1; reasons.push(`Average slope of ${facts.slopeAvgPct}% limits practical building sites.`); }
    else if (facts.slopeAvgPct != null && facts.slopeAvgPct < 8 && facts.buildabilityPct != null && facts.buildabilityPct >= 50) { score += 1; reasons.push(`Flatter, usable terrain: ${facts.slopeAvgPct}% average slope with ${facts.buildabilityPct}% buildable.`); }
    if (facts.landLocked === true) { score -= 1; reasons.push('LandPortal reads the subject as land-locked; no road frontage is mapped.'); }
    else if (facts.roadFrontageFt != null && facts.roadFrontageFt >= 200) { score += 1; reasons.push(`${Math.round(facts.roadFrontageFt)} ft of mapped road frontage (mapped, not a recorded access right).`); }
    if (facts.waterPresent === true) { score += 1; reasons.push('A water feature is mapped on the subject (LandPortal); buyers pay for water where the sales lack it.'); }
  }
  if (remarks.length) {
    const water = remarkShare(/waterfront|lake ?front|river ?front|creek frontage|on the (lake|river)|pond/i);
    const cleared = remarkShare(/cleared|pasture|open field|ready to build|site prepped|septic (installed|in place)|well (installed|in place)|power at|utilities (available|at the road)/i);
    const trouble = remarkShare(/wetland|flood ?zone|swamp|landlocked|no legal access|steep|ravine|unbuildable/i);
    if (water >= 0.5 && facts?.waterPresent !== true) { score -= 1; reasons.push(`${Math.round(water * 100)}% of the selected sales’ remarks describe water frontage the subject does not show (observed).`); }
    if (cleared >= 0.5) { score -= 1; reasons.push(`${Math.round(cleared * 100)}% of the selected sales’ remarks describe cleared or site-prepared land with utilities; the subject shows no such preparation (observed).`); }
    if (trouble >= 0.5) { score += 1; reasons.push(`${Math.round(trouble * 100)}% of the selected sales’ remarks disclose wetlands, flood, access or terrain problems (observed).`); }
  }
  reasons.push(basis === 'visuals_and_remarks'
    ? `${withPhotos} of ${selected.length} selected sales carry listing photos and ${withRemarks} carry listing remarks (observed, not independently verified).`
    : 'No listing photos or remarks are retained for the selected sales, so the comparison rests on sale price, acreage, location, recency and the subject’s own retained facts.');
  if (!facts) reasons.push('No retained subject terrain read is available, which limits the comparison.');
  const posture: CollectiveComparison['posture'] = score >= 1 ? 'more_desirable' : score <= -1 ? 'less_desirable' : 'similar';
  const postureLabel = posture === 'more_desirable'
    ? 'Slightly more desirable than the selected comps'
    : posture === 'less_desirable'
      ? 'Somewhat less desirable than the selected comps'
      : 'Generally similar to the selected comps';
  const collectiveComparison: CollectiveComparison = {
    posture,
    postureLabel,
    statement: selected.length
      ? `On the documented evidence the subject appears ${posture === 'more_desirable' ? 'slightly more desirable than' : posture === 'less_desirable' ? 'somewhat less desirable than' : 'generally similar to'} the ${selected.length} selected sold comp${selected.length === 1 ? '' : 's'}; differences adjust each comp’s weight rather than its use.`
      : 'No sold comp is selected yet, so no subject-versus-comps comparison can be stated.',
    reasons: selected.length ? reasons : [],
    basis,
    compCount: selected.length,
  };

  // ── Active resale competition: up to five, never FMV ─────────────────────
  const actives = input.comps
    .filter((c) => c.category === 'active_competition' && c.price != null)
    .sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9) || (a.daysOnMarket ?? 1e9) - (b.daysOnMarket ?? 1e9))
    .slice(0, 5);
  const askPpas = actives.map((c) => c.pricePerAcre).filter((p): p is number => p != null && p > 0);
  const stale = actives.filter((c) => c.daysOnMarket != null && c.daysOnMarket > 180).length;
  const combinedPpa = combined.value != null && acres != null ? combined.value / acres : null;
  const activeSummary = actives.length === 0
    ? 'No active land listing is retained as resale competition yet.'
    : `${actives.length} active land listing${actives.length === 1 ? '' : 's'} compete for the same buyers${askPpas.length ? `, asking ${money(Math.min(...askPpas))}–${money(Math.max(...askPpas))} per acre` : ''}${combinedPpa != null && askPpas.length ? ` against a combined FMV of ${money(combinedPpa)} per acre` : ''}${stale ? `; ${stale} ${stale === 1 ? 'has' : 'have'} sat over 180 days` : ''}. Asking prices position the resale; they do not set FMV.`;
  const activeCompetition: ActiveCompetitionSummary = {
    compKeys: actives.map((c) => c.key),
    count: actives.length,
    summary: activeSummary,
  };

  // ── Preliminary Land Home Package screen ────────────────────────────────
  // Physical: about half an acre of usable ground under 10% slope, from the
  // retained terrain read. Market: one credible sold manufactured or mobile
  // home within about five miles above $200,000. Obvious parks and leased
  // lots are excluded on their own words. Nothing here touches vacant-land FMV:
  // these records are improved context and never enter the valuation set.
  const usableAcres = facts?.buildableAcres ?? (facts?.buildabilityPct != null && acres != null ? (facts.buildabilityPct / 100) * acres : null);
  const slopeOk = facts?.slopeUnder10Pct != null
    ? facts.slopeUnder10Pct >= 50
    : facts?.slopeAvgPct != null ? facts.slopeAvgPct < LAND_HOME_MAX_SLOPE_PCT : null;
  const physicalMet = usableAcres == null || slopeOk == null ? null : usableAcres >= LAND_HOME_MIN_USABLE_ACRES && slopeOk;
  const slopeBasis = facts?.slopeUnder10Pct != null
    ? `${facts.slopeUnder10Pct}% of the parcel under 10% slope`
    : facts?.slopeAvgPct != null ? `${facts.slopeAvgPct}% average slope` : null;
  const manufacturedAll = input.comps.filter(isManufacturedHomeRecord);
  const parkExcluded = manufacturedAll.filter(isObviousParkOrLeasedLot);
  const manufactured = manufacturedAll.filter((c) => !isObviousParkOrLeasedLot(c));
  // Only a sale with a KNOWN distance inside the screen radius qualifies; an
  // unlocated sale stays retained as context and never counts as "within five miles".
  const mhSoldAll = manufactured.filter((c) => c.priceKind === 'sale' && c.price != null);
  const mhSold = mhSoldAll
    .filter((c) => c.distanceMiles != null && c.distanceMiles <= LAND_HOME_MARKET_RADIUS_MILES)
    .sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));
  const mhBeyond = mhSoldAll.length - mhSold.length;
  const searchNote = input.manufacturedSearch?.note ?? null;
  // Complete only when every approved manufactured-home source reported (the
  // merged lane names all three) and none was blocked, errored, unavailable or
  // skipped for missing coordinates.
  const searchComplete = !!input.manufacturedSearch
    && /Redfin:/.test(searchNote ?? '') && /Realtor\.com:/.test(searchNote ?? '')
    && !/blocked|error|unavailable|not_applicable|not applicable/i.test(`${input.manufacturedSearch.status ?? ''} ${searchNote ?? ''}`);
  const mhActive = manufactured.filter((c) => c.priceKind === 'list');
  const qualifying = mhSold.filter((c) => (c.price as number) > LAND_HOME_MARKET_MIN_SALE_USD);
  const topSale = mhSold.length ? Math.max(...mhSold.map((c) => c.price as number)) : null;
  // The brief reason, from the qualifying sales themselves: a same-street sale
  // is named with its acreage and street; the subject's retained subdivision
  // locates the market. Nothing here is asserted that a retained fact does not carry.
  const subjectStreetKey = streetKey(input.subjectStreet);
  const sameStreet = subjectStreetKey ? qualifying.find((c) => streetKey(c.address) === subjectStreetKey) ?? null : null;
  const subdivision = subdivisionName(input.subjectSubdivision);
  const brief = qualifying.length
    ? `Recent manufactured homes above ${money(LAND_HOME_MARKET_MIN_SALE_USD)} sold within about five miles${subdivision ? ` of the subject's ${subdivision} location` : ''} (${qualifying.length} qualifying, top ${money(topSale as number)})${sameStreet ? `, including a same-street ${sameStreet.acres != null ? `${sameStreet.acres}-acre ` : ''}sale on ${sameStreet.address?.replace(/^\s*\d+[A-Za-z]?\s+/, '').replace(/,.*$/, '') ?? 'the subject street'} at ${money(sameStreet.price as number)}${sameStreet.dateIso ? ` (${sameStreet.dateIso})` : ''}` : ''}.`
    : null;
  const landHomePackage: LandHomePackageScreen = {
    physical: {
      met: physicalMet,
      usableAcres: usableAcres != null ? Math.round(usableAcres * 100) / 100 : null,
      slopeBasis,
      note: physicalMet == null
        ? 'No retained terrain read states usable acreage and slope, so the physical screen is incomplete.'
        : physicalMet
          ? `About ${Math.round((usableAcres as number) * 100) / 100} usable acres with ${slopeBasis}: meets the 0.50-acre-under-10%-slope screen (retained terrain read, not a site survey).`
          : `About ${Math.round((usableAcres as number) * 100) / 100} usable acres with ${slopeBasis}: does not meet the 0.50-acre-under-10%-slope screen on the retained terrain read.`,
    },
    market: {
      met: qualifying.length > 0,
      qualifyingSaleCount: qualifying.length,
      topSalePrice: topSale,
      note: `${mhSold.length === 0
        ? `No sold manufactured or mobile home within about five miles is retained${mhBeyond ? ` (${mhBeyond} retained sale${mhBeyond === 1 ? '' : 's'} lie beyond the screen or at an unresolved distance)` : ''}.`
        : qualifying.length
          ? `${qualifying.length} of ${mhSold.length} retained manufactured-home sale${mhSold.length === 1 ? '' : 's'} within about five miles closed above ${money(LAND_HOME_MARKET_MIN_SALE_USD)} (top ${money(topSale as number)}).`
          : `${mhSold.length} manufactured-home sale${mhSold.length === 1 ? '' : 's'} within about five miles, none above ${money(LAND_HOME_MARKET_MIN_SALE_USD)} (top ${money(topSale as number)}).`}${searchNote ? ` Sources: ${searchNote}` : ' The manufactured-home lane has not reported an outcome yet.'}`,
      brief,
      searchComplete,
      searchOutcome: searchNote,
    },
    soldCompKeys: mhSold.slice(0, 5).map((c) => c.key),
    activeCompKeys: mhActive.slice(0, 5).map((c) => c.key),
    excludedCount: parkExcluded.length,
    triggered: physicalMet === true && qualifying.length > 0,
    rule: `Physical: at least ${LAND_HOME_MIN_USABLE_ACRES} usable acre under ${LAND_HOME_MAX_SLOPE_PCT}% slope. Market: one credible sold manufactured or mobile home within about ${LAND_HOME_MARKET_RADIUS_MILES} miles above ${money(LAND_HOME_MARKET_MIN_SALE_USD)}. Parks and leased lots excluded on their own words; no title or affixture investigation.`,
  };

  const landWatchApplicable = acres != null && acres >= LANDWATCH_ADDITIVE_MIN_ACRES;
  return {
    landPortalFmv,
    nonLandPortalFmv,
    combinedFmv: combined,
    offer40,
    offer60,
    askingPrice: input.askingPrice,
    collectiveComparison,
    activeCompetition,
    landHomePackage,
    landWatch: {
      applicable: landWatchApplicable,
      thresholdAcres: LANDWATCH_ADDITIVE_MIN_ACRES,
      additive: true,
      note: landWatchApplicable
        ? `Subject is ${acres} acres: LandWatch is added to the non-LandPortal provider set alongside Zillow, Redfin, Realtor.com, county and manual sources; it never replaces them.`
        : `Subject is under ${LANDWATCH_ADDITIVE_MIN_ACRES} acres: LandWatch is not added; the normal provider set applies.`,
    },
  };
}
