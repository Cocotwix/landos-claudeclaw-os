// Acquisition Workspace V2 — Comps & Valuation section.
//
// ONE comps workspace. The comparable evidence is presented exactly once: a
// decision strip at the top, the reasoning that produced it, the method
// comparison, and then a single filtered list-and-map workspace. There is no
// second full card list and no prose restatement of every comparable — the same
// records were previously rendered three times, which is what made the page
// unreadable.
//
// Mounted with its initial projection as a prop (the page's single
// property-intelligence fetch), so opening the tab refetches nothing. The ONLY
// network calls made here are explicit operator actions: valuation-set selection
// (include / exclude / restore) and the bounded resolve-locations action; both
// persist through canonical paths and return the fresh projection so every
// figure recalculates immediately.
//
// Honesty rules enforced by the server and respected here: the acreage band and
// the sale-recency window decide which sales may price the subject; sales
// outside them stay visible at ZERO valuation weight and say so; asking
// references and active listings never enter the sold-price calculations;
// unresolved locations show "Distance unavailable" and are never guessed onto
// the map; every visual states its own provenance.

import { useMemo, useState } from 'preact/hooks';
import { apiPost, dashboardToken, ApiError } from '@/lib/api';
import { CombinedCompMap } from './AcquisitionWorkspaceV2CompMap';
import { CompVisualThumb, type CvVisual } from './CompVisualThumb';
import { compDistanceLabel, identityFor, CompKindBadge, MarkerGlyph, COMP_IDENTITIES, type CompRecordIdentity } from './CompRecordIdentity';
import { CompFullDetails } from './AcquisitionWorkspaceV2CompDetails';

// ── View types (mirror src/landos/comps-valuation.ts) ──────────────────

export type CvCategory =
  | 'accepted_closed_sale'
  | 'candidate_closed_sale'
  | 'active_competition'
  | 'asking_reference'
  | 'improved_context'
  | 'rejected'
  | 'context_only';

export type CvValuationRole =
  | 'direct' | 'supporting' | 'supplemental_historical' | 'boundary' | 'historical_context';

export interface CvSubject {
  address: string | null;
  apn: string | null;
  acres: number | null;
  county: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  locationSource: string | null;
}

/** Mirrors src/landos/comp-listing-projection.ts. */
export type CvTransactionKind = 'closed' | 'active' | 'context';

export interface CvTimelineRow {
  dateIso: string;
  kind: 'listed' | 'price_change' | 'withdrawn' | 'relisted' | 'pending' | 'back_on_market' | 'sold' | 'active';
  label: string;
  price: number | null;
  source: string;
}

export interface CvListing {
  transactionKind: CvTransactionKind;
  kindLabel: string;
  price: {
    basis: 'verified_sale' | 'pending_proxy' | 'none';
    amount: number | null;
    perAcre: number | null;
    amountLabel: string;
    perAcreLabel: string;
    confidence: 'verified' | 'estimated_proxy' | 'unavailable';
    confidenceLabel: string;
    usableForValuation: boolean;
    lines: string[];
    disclosureNote: string;
  };
  soldDateIso: string | null;
  marketTime: {
    originalListingDateIso: string | null;
    originalListPrice: number | null;
    cumulativeDays: number | null;
    cumulativeLabel: string;
    currentEpisodeDays: number | null;
    providerDaysOnMarket: number | null;
    episodeCount: number;
    relistStitched: boolean;
    stitchUncertain: boolean;
    withdrawnDays: number;
    freshness: 'genuinely_new' | 'cosmetically_refreshed' | 'long_running' | 'unknown';
    freshnessLabel: string | null;
    completeness: 'full' | 'partial' | 'current_episode_only' | 'none';
    priceReductions: Array<{ dateIso: string; from: number | null; to: number; drop: number | null }>;
    lines: string[];
  };
  timeline: CvTimelineRow[];
  unusableRows: Array<{ row: string; why: string }>;
  description: {
    source: { text: string; attribution: string; isMarketingCopy: true; note: string } | null;
    landos: {
      text: string;
      verified: string[];
      sourceClaims: Array<{ claim: string; excerpt: string; status: 'unverified_marketing_claim' | 'independently_confirmed' }>;
      unresolved: string[];
      comparability: string[];
      note: string;
    };
  };
  /** The property's own photographs, in the order the provider published them. */
  photos: {
    items: Array<{
      url: string;
      sequence: number;
      label: string;
      provider: string;
      context: 'hero' | 'gallery';
    }>;
    count: number;
    hasGenuinePhotos: boolean;
    provider: string | null;
    sourcePage: string | null;
    /** Why there is no gallery, when there is none. */
    fallbackNote: string | null;
  };
  evidence: {
    sourcePage: string | null;
    provider: string | null;
    apn: string | null;
    /** Retrieval diagnostics — retained for audit, NEVER rendered in Full details. */
    diagnostics: {
      imageProvenance: string;
      imageLabel: string | null;
      imageIsOriginalListingImage: boolean;
      imageReconciledOn: string[];
      photoCount: number;
      lat: number | null;
      lng: number | null;
      transactionPriceConfidence: string;
      listingHistoryCompleteness: string;
      capturedAtIso: string | null;
      limitation: string | null;
    };
  };
}

export interface CvComp {
  compId: number | null;
  key: string;
  category: CvCategory;
  categoryLabel: string;
  classificationReason: string;
  eligibleForValuation: boolean;
  selectedForValuation: boolean;
  selectionMode: 'auto' | 'operator' | null;
  operatorExcluded: boolean;
  exclusionReason: string | null;
  source: string;
  sourceUrl: string | null;
  origins: string[];
  fromLandPortalSidebar: boolean;
  fromLandPortalShowOnMap: boolean;
  mergeStatus: string | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  distanceMiles: number | null;
  outsideInitialRadius: boolean | null;
  lat: number | null;
  lng: number | null;
  locationResolved: boolean;
  locationSource: string | null;
  locationMethod: 'provider_map_point' | 'address_geocode' | 'none';
  locationResolvedAtIso: string | null;
  statusLabel: string;
  saleVerification?: 'independent' | 'source_stated';
  priceKind: 'sale' | 'list' | 'unknown';
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  dateIso: string | null;
  daysOnMarket: number | null;
  soldBy: string | null;
  buildingSqft: number | null;
  propertyClass: 'land' | 'improved' | 'unknown';
  thumbnailUrl: string | null;
  visual: CvVisual;
  acresDeltaFromSubject: number | null;
  recencyMonths: number | null;
  monthsOld: number | null;
  primaryComparability: string | null;
  keyDifference: string | null;
  missingFields: string[];
  valuationRole: CvValuationRole | null;
  inValuationSet: boolean;
  valuationWeight: number | null;
  zeroWeightReason: string | null;
  radiusStage: 'initial_10' | 'expansion_20' | 'beyond_20' | null;
  exclusionActor: 'operator' | 'landos' | null;
  transactionKind: CvTransactionKind;
  listing: CvListing | null;
}

export const VALUATION_ROLE_LABEL: Record<CvValuationRole, string> = {
  direct: 'Direct comp',
  supporting: 'Supporting comp',
  supplemental_historical: 'Supplemental historical comp',
  boundary: 'Boundary comp',
  historical_context: 'Historical context',
};

const ROLE_BLURB: Record<CvValuationRole, string> = {
  direct: 'In the selected sale window and acreage band, inside the 10-mile radius. Full weight.',
  supporting: 'In the window and band, farther out or less similar. Reduced weight.',
  supplemental_historical: 'Sold 25–30 months ago, admitted only because the 24-month set was insufficient. Substantially reduced weight.',
  boundary: 'Defines an upper or lower limit through a documented difference.',
  historical_context: 'Older than the selected window. Zero valuation weight.',
};

export interface CvValuationWindow {
  selectedMonths: 12 | 24 | 30;
  cutoffIso: string;
  acreageBand: { min: number; max: number; label: string } | null;
  credibleWithin12: number;
  credibleWithin24: number;
  credibleWithin30: number;
  addedFrom13To24: number;
  addedFrom25To30: number;
  movedToHistoricalContext: number;
  outOfAcreageBand: number;
  valuationSetCount: number;
  explanation: string[];
}

export interface CvVisualCounts {
  listingPhoto: number;
  providerThumbnail: number;
  parcelAerial: number;
  satelliteFallback: number;
  mapFallback: number;
  locationUnresolved: number;
  total: number;
  withoutVisual: number;
}

export interface CvCleaned {
  cleanedCount: number;
  directCount: number;
  supportingCount: number;
  supplementalHistoricalCount: number;
  boundaryCount: number;
  historicalContextCount: number;
  excludedCount: number;
  cleanedAvgPpa: number | null;
  cleanedMedianPpa: number | null;
  avgIndication: number | null;
  medianIndication: number | null;
  weightedPpa: number | null;
  weightedIndication: number | null;
  lowObservedPpa: number | null;
  highObservedPpa: number | null;
  lowObservedIndication: number | null;
  highObservedIndication: number | null;
  activeCompetition: {
    count: number; minAskPpa: number | null; maxAskPpa: number | null; staleCount: number;
    executableLow: number | null; executableHigh: number | null; note: string;
  } | null;
  adoptedFmv: number | null;
  retailRangeLow: number | null;
  retailRangeHigh: number | null;
  confidence: 'high' | 'moderate' | 'low' | 'unavailable';
  reconciliationLines: string[];
  directEvidenceSufficient: boolean;
  insufficiencyWarning: string | null;
}

export interface CvQuickFlip {
  expectedSalePrice: number;
  expectedMarketingDays: number | null;
  sellingCosts: number;
  sellerClosingCosts: number;
  carryingCosts: number;
  financingCosts: number;
  improvementCosts: number;
  riskReserve: number;
  requiredProfit: number;
  totalNonAcquisitionCosts: number;
  technicalMaxOffer: number;
  technicalMaxPctOfFmv: number;
  assumptions: Array<{ key: string; label: string; value: string; basis: string; note: string }>;
  confidenceNote: string;
}

export interface CvNegotiation {
  recommendedOpening: number;
  recommendedTarget: number;
  hardCeiling: number;
  ceilingBasis: 'technical_inside_band' | 'technical_above_band' | 'technical_below_band';
  standardBand: { pct40: number; pct50: number; pct60: number };
  lines: string[];
  remainingAssumptions: string[];
}

export interface CvMarketContextRecord {
  scope: string;
  label: string;
  available: boolean;
  acreageBandLabel: string | null;
  period: string | null;
  snapshotDate: string | null;
  provider: string | null;
  metrics: {
    soldCount: number | null; activeCount: number | null; medianDaysOnMarket: number | null;
    sellThroughRate: number | null; absorptionRate: number | null; monthsOfSupply: number | null;
    medianPrice: number | null; medianPricePerAcre: number | null;
  } | null;
  note: string;
}

export interface CvMarketContext {
  source: string;
  county: CvMarketContextRecord;
  zip: CvMarketContextRecord;
  subjectBand: CvMarketContextRecord;
  fastestBand: CvMarketContextRecord;
  interpretation: string;
}

export interface CvSummary {
  workingAcres: number | null;
  acceptedCount: number;
  medianPricePerAcre: number | null;
  ppaBand: { low: number; median: number; high: number } | null;
  fmv: { low: number | null; central: number; high: number | null } | null;
  acquisitionLevels: { pct40: number; pct50: number; pct60: number } | null;
  acquisitionLockedReason: string | null;
  status: 'supported' | 'provisional' | 'insufficient';
  statusLabel: string;
  basisLabel: string;
  statusReason: string;
  confidence: 'high' | 'moderate' | 'low' | 'unavailable';
  confidenceFactors: string[];
  radius: {
    initialMiles: number;
    usedMiles: number | null;
    expanded: boolean;
    withinInitial: number;
    withinExpansion: number;
    beyondExpansion: number;
    unresolved: number;
    note: string;
  };
  distanceRange: { minMiles: number; maxMiles: number } | null;
}

/** Subject-level improvement finding and the valuation scope it forces. */
export interface CvSubjectImprovement {
  improved: boolean;
  type: string;
  buildingSqft: number | null;
  evidence: string | null;
  captionNoun: string;
  valuationScope: 'land_only' | 'whole_property';
  valuationScopeLabel: string;
  wholePropertyPending: boolean;
  wholePropertyNote: string | null;
}

export interface CompsValuationViewData {
  dealCardId: number;
  propertyCardId: number | null;
  subject: CvSubject;
  subjectImprovement?: CvSubjectImprovement | null;
  summary: CvSummary;
  comps: CvComp[];
  counts: Record<string, number>;
  mapCounts: {
    retained: number;
    mapped: number;
    unresolved: number;
    byCategory: Record<string, { retained: number; mapped: number; unresolved: number }>;
  };
  landPortal: { sidebarCount: number; showOnMapCount: number; mergedUniqueCount: number };
  cleaned: CvCleaned;
  quickFlip: CvQuickFlip | null;
  negotiation: CvNegotiation | null;
  marketContext: CvMarketContext;
  valuationWindow: CvValuationWindow;
  visualCounts: CvVisualCounts;
  laneAccountability?: {
    lanes: Array<{
      lane: 'landportal' | 'zillow' | 'redfin' | 'realtor'; label: string;
      status: 'not_run' | 'ran_no_results' | 'ran_results_filtered' | 'retained' | 'failed' | 'blocked' | 'disabled_by_policy';
      candidates: number | null; retained: number | null; operatorLine: string; detail: string | null;
    }>;
    everyLaneAccountedFor: boolean;
    unrunLanes: string[];
    summaryLine: string;
  };
  explanation: {
    used: Array<{ key: string; line: string }>;
    excluded: Array<{ key: string; line: string }>;
    medianNote: string | null;
    neededEvidence: string[];
    strongestEvidence: string | null;
    weakestEvidence: string | null;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const usdOrDash = (n: number | null) => (n == null ? '—' : usd(n));
const tok = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
const nameOf = (c: CvComp) => c.address ?? (c.apn ? `APN ${c.apn}` : 'Unnamed parcel');
const cardDomId = (key: string) => `cv-card-${key.replace(/[^a-z0-9]+/gi, '-')}`;
const providerLabel = (value: string) => {
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  if (key.includes('landportal')) return 'LandPortal';
  if (key.includes('zillow')) return 'Zillow';
  if (key.includes('redfin')) return 'Redfin';
  if (key.includes('realtor')) return 'Realtor.com';
  return value;
};
const sourceBadges = (c: CvComp) => Array.from(new Set([c.source, ...c.origins].filter(Boolean).map(providerLabel)));
const propertyTypeLabel = (c: CvComp) => c.propertyClass === 'improved'
  ? 'Improved property'
  : c.propertyClass === 'land'
    ? 'Vacant land'
    : 'Property type unresolved';

const RADIUS_TEXT: Record<string, string> = {
  initial_10: 'within 10 mi',
  expansion_20: '10–20 mi',
  beyond_20: 'beyond 20 mi',
  none: 'unresolved',
};

// One unified filter set. The visible list and the map ALWAYS use the same
// filtered records, so the two can never show different evidence.
type FilterKey =
  | 'decision' | 'direct' | 'supporting' | 'supplemental' | 'boundary'
  | 'historical' | 'active' | 'improved' | 'context' | 'excluded' | 'all';

const isExcluded = (c: CvComp) => c.operatorExcluded;
const isActive = (c: CvComp) => c.category === 'active_competition' || c.category === 'asking_reference';
const isImproved = (c: CvComp) => c.category === 'improved_context';
const isOtherContext = (c: CvComp) => c.category === 'context_only' || c.category === 'rejected';
const hasRole = (c: CvComp, r: CvValuationRole) => !isExcluded(c) && c.valuationRole === r;

const FILTERS: Array<{ key: FilterKey; label: string; match: (c: CvComp) => boolean; identity?: CompRecordIdentity }> = [
  // Default: the records that actually drive the decision.
  { key: 'decision', label: 'Decision set', match: (c) => (!isExcluded(c) && (c.valuationRole === 'direct' || c.valuationRole === 'supporting')) || isActive(c) },
  { key: 'direct', label: 'Direct', match: (c) => hasRole(c, 'direct'), identity: COMP_IDENTITIES.closed },
  { key: 'supporting', label: 'Supporting', match: (c) => hasRole(c, 'supporting'), identity: COMP_IDENTITIES.closed },
  { key: 'supplemental', label: 'Supplemental historical', match: (c) => hasRole(c, 'supplemental_historical'), identity: COMP_IDENTITIES.closed },
  { key: 'boundary', label: 'Boundary', match: (c) => hasRole(c, 'boundary'), identity: COMP_IDENTITIES.zeroWeight },
  { key: 'historical', label: 'Historical context', match: (c) => hasRole(c, 'historical_context'), identity: COMP_IDENTITIES.zeroWeight },
  { key: 'active', label: 'Active competitors', match: isActive, identity: COMP_IDENTITIES.active },
  { key: 'improved', label: 'Improved context', match: isImproved, identity: COMP_IDENTITIES.improved },
  { key: 'context', label: 'Other context', match: isOtherContext, identity: COMP_IDENTITIES.context },
  { key: 'excluded', label: 'Excluded', match: isExcluded, identity: COMP_IDENTITIES.excluded },
  { key: 'all', label: 'All', match: () => true },
];

/** One concise comparability line for the collapsed card. */
const conciseReason = (c: CvComp): string => {
  if (isExcluded(c)) {
    const who = c.exclusionActor === 'operator' ? 'Excluded by the operator' : 'Excluded by LandOS (restorable)';
    return `${who}${c.exclusionReason ? `: ${c.exclusionReason}` : '.'}`;
  }
  if (c.zeroWeightReason) return c.zeroWeightReason;
  if (c.inValuationSet) {
    const role = c.valuationRole ? `${VALUATION_ROLE_LABEL[c.valuationRole]} — ` : '';
    return `${role}prices the subject at weight ${c.valuationWeight ?? '—'}${c.keyDifference ? `. Key difference: ${c.keyDifference}` : '.'}`;
  }
  switch (c.category) {
    case 'active_competition': return 'Active competition — asking prices never enter the sold-price calculations.';
    case 'asking_reference': return 'Asking reference — market positioning only, never sold evidence.';
    case 'improved_context': return 'Improved property — excluded from the vacant-land sold-price calculations.';
    default: {
      const m = c.classificationReason.match(/^[^.]*\./);
      return m ? m[0] : c.classificationReason;
    }
  }
};

// ── Section ────────────────────────────────────────────────────────────

export function CompsValuationSection({ dealId, initial }: { dealId: number; initial: CompsValuationViewData | null }) {
  const [view, setView] = useState<CompsValuationViewData | null>(initial);
  const [filter, setFilter] = useState<FilterKey>('decision');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [excludingKey, setExcludingKey] = useState<string | null>(null);
  const [excludeReason, setExcludeReason] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolutionNote, setResolutionNote] = useState<string | null>(null);

  const comps = view?.comps ?? [];
  const summary = view?.summary ?? null;

  const spec = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const visible = useMemo(() => comps.filter(spec.match), [comps, filter]);

  const act = async (comp: CvComp, action: 'include' | 'exclude' | 'restore', reason?: string) => {
    if (comp.compId == null || busyKey) return;
    setBusyKey(comp.key);
    setActionError(null);
    try {
      const r = await apiPost<{ compsValuation: CompsValuationViewData }>(
        `/api/landos/deal-cards/${dealId}/comps-valuation/selection`,
        { compId: comp.compId, action, reason },
      );
      setView((current) => ({ ...r.compsValuation, laneAccountability: r.compsValuation.laneAccountability ?? current?.laneAccountability }));
      setExcludingKey(null);
      setExcludeReason('');
    } catch (e) {
      const serverError = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : null;
      setActionError(serverError || (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyKey(null);
    }
  };

  // Bounded operator action: fill-only subject geocode + existing comp-map
  // enrichment + evidence-address geocode. Never county GIS, never a guess.
  const resolveLocations = async () => {
    if (resolving) return;
    setResolving(true);
    setActionError(null);
    try {
      const r = await apiPost<{ resolution: { subjectResolved: boolean; compsEnriched: number; evidenceResolved: number; unresolved: number }; compsValuation: CompsValuationViewData }>(
        `/api/landos/deal-cards/${dealId}/comps-valuation/resolve-locations`,
      );
      setView((current) => ({ ...r.compsValuation, laneAccountability: r.compsValuation.laneAccountability ?? current?.laneAccountability }));
      const res = r.resolution;
      setResolutionNote(`Location check finished: subject ${res.subjectResolved ? 'resolved' : 'unresolved'}, ${res.compsEnriched + res.evidenceResolved} listing location${res.compsEnriched + res.evidenceResolved === 1 ? '' : 's'} resolved, ${res.unresolved} still unresolved (left honestly unplaced).`);
    } catch (e) {
      const serverError = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : null;
      setActionError(serverError || (e instanceof Error ? e.message : String(e)));
    } finally {
      setResolving(false);
    }
  };

  // Map → list. Selecting from the map reveals the matching card WITHOUT
  // changing the filter, so the operator never loses their working set. The
  // scroll runs after paint via rAF; no mount effect is involved.
  const selectFromMap = (key: string | null) => {
    setSelectedKey(key);
    if (!key) return;
    requestAnimationFrame(() => {
      document.getElementById(cardDomId(key))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  if (!view || !summary) {
    return (
      <section class="awv2-panel">
        <div class="awv2-panel-title">Comps &amp; Valuation</div>
        <p class="awv2-pi-note">No comparable projection is available for this deal yet.</p>
      </section>
    );
  }

  const cleaned = view.cleaned;
  const subjectImprovement = view.subjectImprovement ?? null;
  const quickFlip = view.quickFlip;
  const negotiation = view.negotiation;
  const marketContext = view.marketContext;
  const mapCounts = view.mapCounts;
  const win = view.valuationWindow;
  const visuals = view.visualCounts;
  const isStaleCompConclusion = (line: string | null) => summary.acceptedCount > 0 && line != null
    && /no usable comp|another (?:comparable )?sale[^.]*required/i.test(line);
  const reconciledWarning = isStaleCompConclusion(cleaned.insufficiencyWarning) ? null : cleaned.insufficiencyWarning;
  const reconciledLockedReason = isStaleCompConclusion(summary.acquisitionLockedReason) ? null : summary.acquisitionLockedReason;
  const reconciledNeededEvidence = view.explanation.neededEvidence.filter((line) => !isStaleCompConclusion(line));
  const valuationSet = comps.filter((c) => c.inValuationSet);
  const mapCaptureUrl = view.propertyCardId != null
    ? tok(`/api/landos/inspection/image?cardId=${view.propertyCardId}&key=comps_map`)
    : null;

  // The three strongest valuation comps, plus the records that actually set the
  // bottom and the top of the supported range. This REPLACES the old prose list
  // that restated every comparable at the bottom of the page.
  const strongest = [...valuationSet].sort((a, b) => (b.valuationWeight ?? 0) - (a.valuationWeight ?? 0)).slice(0, 3);
  const byPpa = [...valuationSet].filter((c) => c.pricePerAcre != null)
    .sort((a, b) => (a.pricePerAcre ?? 0) - (b.pricePerAcre ?? 0));
  const lowEvidence = byPpa[0] ?? null;
  const highEvidence = byPpa.length > 1 ? byPpa[byPpa.length - 1] : null;

  const excludeForm = (c: CvComp) => (
    <span class="awv2-cv-exclude-form">
      <input
        type="text"
        placeholder="Concise exclusion reason"
        value={excludeReason}
        onInput={(e) => setExcludeReason((e.target as HTMLInputElement).value)}
      />
      <button type="button" class="exclude" disabled={busyKey === c.key} onClick={() => act(c, 'exclude', excludeReason)}>
        Confirm exclude
      </button>
      <button type="button" onClick={() => setExcludingKey(null)}>Cancel</button>
    </span>
  );

  const evidenceLine = (c: CvComp | null, lead: string) => c && (
    <li>
      <b>{lead}</b> {nameOf(c)} — {c.acres ?? '—'} ac at {usdOrDash(c.price)} ({usdOrDash(c.pricePerAcre)}/ac),
      sold {c.dateIso || 'undated'}{c.monthsOld != null ? ` (${c.monthsOld} mo ago)` : ''}
      {c.distanceMiles != null ? `, ${c.distanceMiles} mi from the subject` : ', location unresolved'}.
      {' '}<button type="button" class="awv2-cv-link" onClick={() => selectFromMap(c.key)}>Show on map</button>
    </li>
  );

  return (
    <>
      {/* ── 1. Decision strip ── */}
      <section class={`awv2-panel awv2-cv-decisionpanel status-${summary.status}`} aria-label="Valuation decision">
        <div class="awv2-panel-title">
          Comps &amp; Valuation <span class="awv2-src-tag">{summary.basisLabel}</span>
        </div>
        {/* An improved subject priced off vacant-land sales has a LAND value,
            not a property value. Say so before any figure is read. */}
        {subjectImprovement?.improved && (
          <div class="awv2-cv-note" data-testid="cv-land-only-scope">
            <b>Land-only indication.</b> {subjectImprovement.wholePropertyNote}
            {subjectImprovement.evidence ? ` ${subjectImprovement.evidence}` : ''}
          </div>
        )}
        <div class="awv2-cv-decision">
          <div class="awv2-cv-dec primary">
            <div class="k">{subjectImprovement?.improved ? 'Adopted cleaned land value' : 'Adopted cleaned FMV'}</div>
            <div class="v">{usdOrDash(cleaned.adoptedFmv)}</div>
          </div>
          {subjectImprovement?.wholePropertyPending && (
            <div class="awv2-cv-dec" data-testid="cv-whole-property-pending" aria-label="Whole-property value Pending">
              <div class="k">Whole-property value</div>
              <div class="v">PENDING</div>
            </div>
          )}
          <div class="awv2-cv-dec">
            <div class="k">{subjectImprovement?.improved ? 'Supported land retail range' : 'Supported retail range'}</div>
            <div class="v">{usdOrDash(cleaned.retailRangeLow)} – {usdOrDash(cleaned.retailRangeHigh)}</div>
          </div>
          <div class="awv2-cv-dec">
            <div class="k">{subjectImprovement?.improved ? 'Land-basis opening reference' : 'Recommended opening'}</div>
            <div class="v">{negotiation ? usd(negotiation.recommendedOpening) : '—'}</div>
          </div>
          <div class="awv2-cv-dec">
            <div class="k">{subjectImprovement?.improved ? 'Land-basis target reference' : 'Recommended target'}</div>
            <div class="v">{negotiation ? usd(negotiation.recommendedTarget) : '—'}</div>
          </div>
          <div class="awv2-cv-dec ceiling">
            <div class="k">{subjectImprovement?.improved ? 'Land-basis ceiling reference' : 'Hard ceiling'}</div>
            <div class="v">{negotiation ? usd(negotiation.hardCeiling) : '—'}</div>
          </div>
          <div class={`awv2-cv-dec conf ${cleaned.confidence}`}>
            <div class="k">Confidence</div>
            <div class="v">{cleaned.confidence}</div>
          </div>
        </div>
        {reconciledWarning && (
          <div class="awv2-cv-error" role="alert">{reconciledWarning}</div>
        )}
        {reconciledLockedReason && (
          <div class="awv2-cv-error" role="alert">{reconciledLockedReason}</div>
        )}

        {view.laneAccountability && (
          <div class="awv2-cv-window" aria-label="Comparable source accountability">
            <div class="awv2-panel-title">Source lane accountability</div>
            <p class="awv2-pi-note">{view.laneAccountability.summaryLine}</p>
            <div class="awv2-kv">
              {view.laneAccountability.lanes.map((lane) => (
                <>
                  <span class="k">{lane.label}</span>
                  <span class="v"><b>{lane.status.replace(/_/g, ' ')}</b> · {lane.operatorLine}{lane.detail ? ` ${lane.detail}` : ''}</span>
                </>
              ))}
            </div>
          </div>
        )}

        {/* ── 2. Which comp window was selected, and why ── */}
        <div class="awv2-cv-window">
          <div class="awv2-cv-windowhead">
            <span class="chip">{win.selectedMonths}-month sale window</span>
            <span class="chip">{win.acreageBand?.label ?? 'no acreage band'}</span>
            <span class="chip">{win.valuationSetCount} comps price the subject</span>
            <span class="chip">{summary.acceptedCount} canonical accepted comps</span>
            <span class="chip dim">cutoff {win.cutoffIso}</span>
            {win.addedFrom25To30 > 0 && <span class="chip warn">{win.addedFrom25To30} supplemental historical</span>}
          </div>
          <div class="awv2-cv-windowcounts">
            <span><i>Credible within 12 mo</i>{win.credibleWithin12}</span>
            <span><i>Added 13–24 mo</i>{win.addedFrom13To24}</span>
            <span><i>Added 25–30 mo</i>{win.addedFrom25To30}</span>
            <span><i>Moved to historical context</i>{win.movedToHistoricalContext}</span>
            <span><i>Outside {win.acreageBand?.label ?? 'band'}</i>{win.outOfAcreageBand}</span>
          </div>
          {win.explanation.map((line) => <p class="awv2-pi-note" key={line.slice(0, 40)}>{line}</p>)}
          {cleaned.adoptedFmv != null && (
            <p class="awv2-pi-note">
              <b>{subjectImprovement?.improved ? 'Why this land value:' : 'Why this FMV:'}</b> {cleaned.reconciliationLines[cleaned.reconciliationLines.length - 1]}
            </p>
          )}
        </div>
      </section>

      {/* ── 3. Valuation methods, compact ── */}
      <section class="awv2-panel" aria-label="Valuation methods">
        <div class="awv2-panel-title">
          Valuation methods <span class="awv2-src-tag">{subjectImprovement?.improved ? 'LAND BASIS ONLY · ' : ''}Average · median · weighted · active competition · offer methods</span>
        </div>
        {cleaned.adoptedFmv == null ? (
          <p class="awv2-pi-note">{cleaned.reconciliationLines[0]}</p>
        ) : (
          <>
            <div class="awv2-cv-methodgrid">
              <div class="awv2-cv-m"><span class="k">Cleaned average</span><b>{usdOrDash(cleaned.avgIndication)}</b><i>{usdOrDash(cleaned.cleanedAvgPpa)}/ac</i></div>
              <div class="awv2-cv-m"><span class="k">Cleaned median</span><b>{usdOrDash(cleaned.medianIndication)}</b><i>{usdOrDash(cleaned.cleanedMedianPpa)}/ac</i></div>
              <div class="awv2-cv-m"><span class="k">Weighted indication</span><b>{usdOrDash(cleaned.weightedIndication)}</b><i>{usdOrDash(cleaned.weightedPpa)}/ac · distance, recency, acreage</i></div>
              <div class="awv2-cv-m"><span class="k">Active competition</span>
                <b>{cleaned.activeCompetition?.executableLow != null ? `${usd(cleaned.activeCompetition.executableLow)} – ${usd(cleaned.activeCompetition.executableHigh!)}` : '—'}</b>
                <i>{cleaned.activeCompetition ? `${cleaned.activeCompetition.count} active${cleaned.activeCompetition.staleCount ? `, ${cleaned.activeCompetition.staleCount} stale excluded` : ''}` : 'no active listings'}</i>
              </div>
              <div class="awv2-cv-m adopted"><span class="k">{subjectImprovement?.improved ? 'Adopted cleaned land value' : 'Adopted cleaned FMV'}</span><b>{usd(cleaned.adoptedFmv)}</b><i>confidence {cleaned.confidence}</i></div>
              {quickFlip && (
                <div class="awv2-cv-m"><span class="k">{subjectImprovement?.improved ? 'Land-basis technical quick-flip max' : 'Technical quick-flip max'}</span><b>{usd(quickFlip.technicalMaxOffer)}</b><i>{quickFlip.technicalMaxPctOfFmv}% of cleaned {subjectImprovement?.improved ? 'land value' : 'FMV'}</i></div>
              )}
            </div>

            {negotiation && (
              <div class="awv2-cv-methodrows">
                <div class="awv2-cv-method">
                  <div class="mt">{subjectImprovement?.improved ? 'Land-basis 40 / 50 / 60 references' : 'Simplified 40 / 50 / 60 method'}</div>
                  <div class="mrow"><span>40% {subjectImprovement?.improved ? 'opening reference' : 'opening offer'}</span><b>{usd(negotiation.standardBand.pct40)}</b></div>
                  <div class="mrow"><span>50% {subjectImprovement?.improved ? 'target reference' : 'target offer'}</span><b>{usd(negotiation.standardBand.pct50)}</b></div>
                  <div class="mrow"><span>60% upper reference</span><b>{usd(negotiation.standardBand.pct60)}</b></div>
                </div>
                {quickFlip && (
                  <div class="awv2-cv-method">
                    <div class="mt">Technical quick-flip method</div>
                    <div class="mrow"><span>Expected executable sale price</span><b>{usd(quickFlip.expectedSalePrice)}</b></div>
                    <div class="mrow"><span>Total non-acquisition costs</span><b>−{usd(quickFlip.totalNonAcquisitionCosts)}</b></div>
                    <div class="mrow"><span>Required minimum profit</span><b>−{usd(quickFlip.requiredProfit)}</b></div>
                    <div class="mrow total"><span>{subjectImprovement?.improved ? 'Land-basis technical maximum reference' : 'Technical maximum allowable offer'}</span><b>{usd(quickFlip.technicalMaxOffer)}</b></div>
                    <div class="mrow"><span>{subjectImprovement?.improved ? 'As a percentage of cleaned land value' : 'As a percentage of cleaned FMV'}</span><b>{quickFlip.technicalMaxPctOfFmv}%</b></div>
                  </div>
                )}
                <div class="awv2-cv-method reconcile">
                  <div class="mt">Reconciliation</div>
                  {negotiation.lines.map((l) => <p class="awv2-pi-note" key={l.slice(0, 30)}>{l}</p>)}
                </div>
              </div>
            )}

            <details class="awv2-collapse">
              <summary>Full method detail and assumptions{quickFlip ? ` (${quickFlip.assumptions.length})` : ''}</summary>
              <div class="awv2-cv-reconcile">
                {cleaned.reconciliationLines.map((l) => <div class="line" key={l.slice(0, 30)}>{l}</div>)}
                <div class="line">
                  Low / high observed: {usdOrDash(cleaned.lowObservedIndication)} – {usdOrDash(cleaned.highObservedIndication)}
                  {' '}({usdOrDash(cleaned.lowObservedPpa)}–{usdOrDash(cleaned.highObservedPpa)} / ac).
                </div>
                {view.explanation.medianNote && <div class="line">Median cross-check: {view.explanation.medianNote}</div>}
              </div>
              {quickFlip && (
                <>
                  <div class="awv2-cv-methodrows">
                    <div class="awv2-cv-method">
                      <div class="mt">Quick-flip cost stack</div>
                      <div class="mrow"><span>Selling / brokerage costs</span><b>−{usd(quickFlip.sellingCosts)}</b></div>
                      <div class="mrow"><span>Seller closing costs</span><b>−{usd(quickFlip.sellerClosingCosts)}</b></div>
                      <div class="mrow"><span>Carrying costs</span><b>−{usd(quickFlip.carryingCosts)}</b></div>
                      <div class="mrow"><span>Financing costs</span><b>−{usd(quickFlip.financingCosts)}</b></div>
                      <div class="mrow"><span>Known improvement costs</span><b>−{usd(quickFlip.improvementCosts)}</b></div>
                      <div class="mrow"><span>Risk reserve</span><b>−{usd(quickFlip.riskReserve)}</b></div>
                      {quickFlip.expectedMarketingDays != null && (
                        <div class="mrow"><span>Expected marketing period</span><b>{quickFlip.expectedMarketingDays} days</b></div>
                      )}
                    </div>
                  </div>
                  <div class="awv2-kv">
                    {quickFlip.assumptions.map((a) => (
                      <>
                        <span class="k">{a.label}</span>
                        <span class="v">
                          <b>{a.value}</b>
                          <span class="awv2-cv-basis"> · {a.basis === 'landos_operating_assumption' ? 'LandOS operating assumption (revisable)' : a.basis === 'market_research' ? 'from LandOS Market Research' : 'derived'}</span>
                          <div>{a.note}</div>
                        </span>
                      </>
                    ))}
                  </div>
                  <p class="awv2-pi-note">{quickFlip.confidenceNote}</p>
                </>
              )}
              {cleaned.activeCompetition && <p class="awv2-pi-note">{cleaned.activeCompetition.note}</p>}
              {negotiation && (
                <div class="awv2-cv-assumptions">
                  <b>Remaining assumptions that could move the ceiling:</b>
                  <ul>{negotiation.remainingAssumptions.map((a) => <li key={a.slice(0, 30)}>{a}</li>)}</ul>
                </div>
              )}
              <div class="awv2-cv-rolecounts">
                <span><b>{cleaned.directCount}</b> direct</span>
                <span><b>{cleaned.supportingCount}</b> supporting</span>
                <span><b>{cleaned.supplementalHistoricalCount}</b> supplemental historical</span>
                <span><b>{cleaned.boundaryCount}</b> boundary</span>
                <span><b>{cleaned.historicalContextCount}</b> historical context</span>
                <span><b>{cleaned.excludedCount}</b> excluded with a retained reason</span>
              </div>
              <p class="awv2-pi-note"><b>Confidence:</b> {summary.confidence}. {summary.confidenceFactors.join(' ')}</p>
              <p class="awv2-cv-radius-note">
                <b>Search radius:</b> {summary.radius.withinInitial} inside {summary.radius.initialMiles} mi
                {summary.radius.withinExpansion > 0 && <> · {summary.radius.withinExpansion} in the {summary.radius.initialMiles}–20 mi ring</>}
                {summary.radius.beyondExpansion > 0 && <> · {summary.radius.beyondExpansion} beyond 20 mi</>}
                {summary.radius.unresolved > 0 && <> · {summary.radius.unresolved} unresolved</>}
                {' — '}{summary.radius.note}
              </p>
            </details>
          </>
        )}
      </section>

      {/* ── 4. Market Research context, compact by default ── */}
      {marketContext && (
        <section class="awv2-panel" aria-label="Market Research acreage band context">
          <div class="awv2-panel-title">
            Market Research acreage-band context <span class="awv2-src-tag">{marketContext.source} — not LandPortal</span>
          </div>
          <div class="awv2-cv-bandsummary">
            {(() => {
              const b = marketContext.subjectBand;
              const m = b.metrics;
              return (
                <>
                  <span><i>Subject band</i>{b.acreageBandLabel ?? '—'}</span>
                  <span><i>Sold</i>{m?.soldCount ?? '—'}</span>
                  <span><i>Median DOM</i>{m?.medianDaysOnMarket != null ? `${Math.round(m.medianDaysOnMarket)} d` : '—'}</span>
                  <span><i>Sell-through</i>{m?.sellThroughRate != null ? `${Math.round(m.sellThroughRate)}%` : '—'}</span>
                  <span><i>Absorption</i>{m?.absorptionRate != null ? `${Math.round(m.absorptionRate)}%` : '—'}</span>
                  <span><i>Fastest band</i>{marketContext.fastestBand.acreageBandLabel ?? '—'}</span>
                  <span><i>Snapshot</i>{b.snapshotDate ? b.snapshotDate.slice(0, 10) : '—'}</span>
                </>
              );
            })()}
          </div>
          <details class="awv2-collapse">
            <summary>Full Market Research metrics</summary>
            <div class="awv2-cv-bands">
              {[marketContext.subjectBand, marketContext.county, marketContext.zip, marketContext.fastestBand].map((rec) => (
                <div class={`awv2-cv-band${rec.available ? '' : ' unavailable'}`} key={rec.scope}>
                  <div class="bt">{rec.label}</div>
                  {rec.available && rec.metrics ? (
                    <>
                      <div class="bfigs">
                        <span><i>Sold</i>{rec.metrics.soldCount ?? '—'}</span>
                        <span><i>Active</i>{rec.metrics.activeCount ?? '—'}</span>
                        <span><i>Median DOM</i>{rec.metrics.medianDaysOnMarket != null ? `${Math.round(rec.metrics.medianDaysOnMarket)} d` : '—'}</span>
                        <span><i>Sell-through</i>{rec.metrics.sellThroughRate != null ? `${Math.round(rec.metrics.sellThroughRate)}%` : '—'}</span>
                        <span><i>Absorption</i>{rec.metrics.absorptionRate != null ? `${Math.round(rec.metrics.absorptionRate)}%` : '—'}</span>
                        <span><i>Months supply</i>{rec.metrics.monthsOfSupply != null ? rec.metrics.monthsOfSupply : '—'}</span>
                        <span><i>Median $/ac</i>{rec.metrics.medianPricePerAcre != null ? usd(rec.metrics.medianPricePerAcre) : '—'}</span>
                      </div>
                      <div class="bmeta">
                        {rec.acreageBandLabel ? `${rec.acreageBandLabel} · ` : ''}{rec.period ?? 'period unstated'}
                        {rec.snapshotDate ? ` · snapshot ${rec.snapshotDate.slice(0, 10)}` : ''}
                      </div>
                    </>
                  ) : (
                    <div class="bmeta">{rec.note}</div>
                  )}
                </div>
              ))}
            </div>
            <p class="awv2-pi-note">{marketContext.interpretation}</p>
            <p class="awv2-pi-note">
              Context only: acreage-band demand does not price this parcel, and a thin direct-comp
              count never makes the property or the market unsuitable on its own.
            </p>
          </details>
        </section>
      )}

      {/* ── 5. ONE comps workspace: filtered list + sticky map ── */}
      <section class="awv2-panel" aria-label="Comparable workspace">
        <div class="awv2-panel-title">
          Comparable workspace <span class="awv2-src-tag">One list · one map · same filtered records</span>
        </div>
        {actionError && <div class="awv2-cv-error" role="alert">{actionError}</div>}

        {/* Filters carry the SAME identity glyph the map and cards use, so a
            filter, a marker and a card can never disagree about what a record is. */}
        <div class="awv2-cv-filters">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.key}
              class={`awv2-cv-filter${filter === f.key ? ' active' : ''}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.identity && <MarkerGlyph identity={f.identity} size={10} />}
              {f.label} <span class="n">{comps.filter(f.match).length}</span>
            </button>
          ))}
        </div>
        <p class="awv2-cv-visualnote">
          Visuals: {visuals.listingPhoto} genuine listing photo{visuals.listingPhoto === 1 ? '' : 's'} ·
          {' '}{visuals.providerThumbnail} provider thumbnail{visuals.providerThumbnail === 1 ? '' : 's'} ·
          {' '}{visuals.parcelAerial} parcel aerial · {visuals.satelliteFallback} nationwide aerial fallback ·
          {' '}{visuals.mapFallback} road map fallback · {visuals.locationUnresolved} location unresolved.
          Every visual states its own source; a fallback is never labeled a listing photo.
        </p>

        <div class="awv2-cv-workspace">
          <div class="awv2-cv-list">
            {visible.length === 0 && <p class="awv2-pi-note">No retained records match this filter.</p>}
            {visible.map((c) => {
              const open = expandedKey === c.key;
              const identity = identityFor(c);
              const mt = c.listing?.marketTime;
              const active = c.transactionKind === 'active';
              return (
                <article
                  id={cardDomId(c.key)}
                  key={c.key}
                  class={`awv2-cv-card kind-${identity.kind}${c.inValuationSet ? ' selected' : ''}${selectedKey === c.key ? ' active' : ''}${hoverKey === c.key ? ' hovered' : ''}`}
                  onPointerEnter={() => setHoverKey(c.key)}
                  onPointerLeave={() => setHoverKey(null)}
                  onClick={() => setSelectedKey(c.key)}
                >
                  {/* The badge counts GENUINE photographs of this parcel only, so
                      it never promises a gallery that a labeled fallback cannot
                      deliver when the card is opened. */}
                  <div class="awv2-cv-photowrap">
                    <CompVisualThumb visual={c.visual} thumbnailUrl={c.thumbnailUrl} alt={nameOf(c)} width={150} height={112} />
                    {(c.listing?.photos.count ?? 0) > 1 && (
                      <span class="awv2-cv-photocount">{c.listing!.photos.count} photos</span>
                    )}
                  </div>
                  <div class="awv2-cv-body">
                    <div class="awv2-cv-head">
                      <span class="addr">{nameOf(c)}</span>
                      <CompKindBadge identity={identity} />
                      {c.valuationRole && !isExcluded(c) && (
                        <span class={`role ${c.valuationRole}`} title={ROLE_BLURB[c.valuationRole]}>
                          {VALUATION_ROLE_LABEL[c.valuationRole]}
                        </span>
                      )}
                      {isExcluded(c) && <span class="role excluded">Excluded</span>}
                    </div>
                    <div class="awv2-cv-sourcebadges" aria-label="Reconciled source provenance">
                      {sourceBadges(c).map((name) => <span class="source-badge" key={name}>{name}</span>)}
                      {sourceBadges(c).length > 1 && <span class="merged">One property · {sourceBadges(c).length} sources</span>}
                    </div>
                    {isImproved(c) && (
                      <p class="awv2-cv-improved-context"><b>Improved-property context only.</b> Never included in the vacant-land pricing calculation.</p>
                    )}
                    {/* Closed comps lead with sold price and how long it took to
                        sell; active competitors lead with the ask and how long
                        the market has refused it. Same component, opposite story. */}
                    <div class="awv2-cv-figs">
                      <span class="f lead"><span class="u">{c.listing?.price.amountLabel ?? (active ? 'Asking price' : 'Sold price')}</span><b>{usdOrDash(c.listing?.price.amount ?? c.price)}</b></span>
                      <span class="f lead"><span class="u">$ / acre</span><b>{usdOrDash(c.listing?.price.perAcre ?? c.pricePerAcre)}</b></span>
                      <span class="f lead"><span class="u">{active ? 'Cumulative active days' : 'Cumulative DOM'}</span>
                        <b>{mt?.cumulativeDays != null ? `${mt.cumulativeDays} d` : 'unavailable'}</b>
                        {mt?.providerDaysOnMarket != null && mt.cumulativeDays != null && mt.providerDaysOnMarket !== mt.cumulativeDays && (
                          <span class="d"> (provider says {mt.providerDaysOnMarket} d)</span>
                        )}
                      </span>
                      <span class="f"><span class="u">{active ? 'Listed' : 'Sold'}</span><b>{(active ? mt?.originalListingDateIso : c.listing?.soldDateIso) ?? c.dateIso ?? '—'}</b>{c.monthsOld != null && <span class="d"> ({c.monthsOld} mo ago)</span>}</span>
                      <span class="f"><span class="u">Acres</span><b>{c.acres ?? '—'}</b>{c.acresDeltaFromSubject != null && <span class="d"> ({c.acresDeltaFromSubject > 0 ? '+' : ''}{c.acresDeltaFromSubject} vs subject)</span>}</span>
                      <span class="f"><span class="u">Property type</span><b>{propertyTypeLabel(c)}</b>{c.buildingSqft != null && <span class="d"> ({c.buildingSqft.toLocaleString('en-US')} building sq ft)</span>}</span>
                      <span class="f"><span class="u">Distance</span><b>{compDistanceLabel(c.distanceMiles)}</b></span>
                      <span class="f"><span class="u">Radius stage</span><b>{RADIUS_TEXT[c.radiusStage ?? 'none']}</b></span>
                      {active && (mt?.priceReductions.length ?? 0) > 0 && (
                        <span class="f"><span class="u">Price reductions</span><b>{mt!.priceReductions.length}</b></span>
                      )}
                    </div>
                    {c.listing?.price.confidence === 'estimated_proxy' && (
                      <p class="awv2-cv-proxy" role="note">{c.listing.price.amountLabel} — an estimate, not a verified sale price. Reduced transaction price confidence.</p>
                    )}
                    <p class="awv2-cv-why">{conciseReason(c)}</p>
                    <div class="awv2-cv-actions">
                      <button type="button" class="awv2-cv-link" onClick={(e) => { e.stopPropagation(); selectFromMap(c.key); }}>
                        Show on map
                      </button>
                      <button type="button" class="awv2-cv-link" onClick={(e) => { e.stopPropagation(); setExpandedKey(open ? null : c.key); }} aria-expanded={open}>
                        {open ? 'Hide details' : 'Full details'}
                      </button>
                      {c.inValuationSet && !isExcluded(c) && excludingKey !== c.key && (
                        <button type="button" class="exclude" disabled={busyKey === c.key} onClick={(e) => { e.stopPropagation(); setExcludingKey(c.key); setExcludeReason(''); }}>
                          Exclude…
                        </button>
                      )}
                      {isExcluded(c) && (
                        <button type="button" disabled={busyKey === c.key} onClick={(e) => { e.stopPropagation(); act(c, 'restore'); }}>
                          Restore to valuation
                        </button>
                      )}
                      {c.eligibleForValuation && !c.inValuationSet && !isExcluded(c) && (
                        <button type="button" disabled={busyKey === c.key} onClick={(e) => { e.stopPropagation(); act(c, 'include'); }}>
                          Include in valuation
                        </button>
                      )}
                      {excludingKey === c.key && excludeForm(c)}
                    </div>

                    {/* Full details is the operator's decision surface. Retrieval
                        diagnostics — raw coordinates, resolution method, capture
                        timestamps — are retained on the projection for audit and
                        are deliberately not rendered here. */}
                    {open && (
                      <div class="awv2-cv-forensics">
                        <CompFullDetails c={c} adoptedFmv={cleaned.adoptedFmv} landBasis={subjectImprovement?.valuationScope === 'land_only'} />
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div class="awv2-cv-mapcol">
            <CombinedCompMap
              subject={view.subject}
              comps={visible}
              selectedKey={selectedKey}
              hoverKey={hoverKey}
              onSelect={selectFromMap}
              onHover={setHoverKey}
              onOpenDetails={(key) => { setExpandedKey(key); selectFromMap(key); }}
              onResolveLocations={resolveLocations}
              resolving={resolving}
              resolutionNote={resolutionNote}
              actions={{
                busyKey,
                onExclude: (c) => { setSelectedKey(c.key); setExcludingKey(c.key); setExcludeReason(''); requestAnimationFrame(() => document.getElementById(cardDomId(c.key))?.scrollIntoView({ block: 'nearest' })); },
                onRestore: (c) => act(c, 'restore'),
                onInclude: (c) => act(c, 'include'),
              }}
            />
          </div>
        </div>

        {/* Retained vs mapped, per category: the map and the evidence registry
            may only differ by the disclosed unresolved locations. */}
        <details class="awv2-collapse">
          <summary>
            Retained vs mapped reconciliation — {mapCounts.retained} retained, {mapCounts.mapped} mapped, {mapCounts.unresolved} unresolved
          </summary>
          <div class="awv2-cv-mapcounts">
            <div class="t">
              Retained vs mapped: <b>{mapCounts.retained}</b> unique records retained, <b>{mapCounts.mapped}</b> placed on the map,
              {' '}<b>{mapCounts.unresolved}</b> unresolved (retained, never guessed onto the map).
            </div>
            <table class="awv2-cv-mapcount-table">
              <thead>
                <tr><th>Category</th><th>Retained</th><th>Mapped</th><th>Unresolved</th></tr>
              </thead>
              <tbody>
                {Object.entries(mapCounts.byCategory)
                  .filter(([, v]) => v.retained > 0)
                  .map(([cat, v]) => (
                    <tr key={`mc-${cat}`}>
                      <td>{CATEGORY_LABEL[cat as CvCategory] ?? cat}</td>
                      <td>{v.retained}</td>
                      <td>{v.mapped}</td>
                      <td>{v.unresolved}</td>
                    </tr>
                  ))}
                <tr class="total">
                  <td>All retained evidence</td>
                  <td>{mapCounts.retained}</td>
                  <td>{mapCounts.mapped}</td>
                  <td>{mapCounts.unresolved}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {mapCaptureUrl && (
            <figure class="awv2-cv-mapcapture">
              <img src={mapCaptureUrl} alt="Retained LandPortal Show on Map comparable capture" loading="lazy" />
              <figcaption>
                Supporting evidence only — the comparable markers exactly as LandPortal displayed them
                {view.subject.address ? ` around ${view.subject.address}` : ''}. The combined map above is the
                LandOS working view.
              </figcaption>
            </figure>
          )}
        </details>
      </section>

      {/* ── 6. Valuation explanation: the decisive evidence, not every record ── */}
      <section class="awv2-panel" aria-label="Valuation explanation">
        <div class="awv2-panel-title">Why this value</div>
        <ul class="awv2-cv-keyevidence">
          {strongest.map((c, i) => evidenceLine(c, `Strongest comp ${i + 1}:`))}
          {evidenceLine(lowEvidence, 'Lower-value evidence:')}
          {evidenceLine(highEvidence, 'Upper-value evidence:')}
        </ul>
        <p class="awv2-pi-note">
          <b>{subjectImprovement?.improved ? 'Adopted land value:' : 'Adopted FMV:'}</b> {cleaned.adoptedFmv != null
            ? cleaned.reconciliationLines[cleaned.reconciliationLines.length - 1]
            : cleaned.reconciliationLines[0]}
        </p>
        <p class="awv2-pi-note">
          <b>Older sales:</b> {win.movedToHistoricalContext > 0
            ? `${win.movedToHistoricalContext} credible closed sale${win.movedToHistoricalContext === 1 ? ' was' : 's were'} NOT used, because ${win.credibleWithin12} credible sales already qualified inside the ${win.selectedMonths}-month window. They remain visible under the Historical context filter at zero valuation weight.`
            : win.addedFrom25To30 > 0
              ? `${win.addedFrom25To30} record${win.addedFrom25To30 === 1 ? '' : 's'} from months 25–30 had to be admitted as supplemental historical evidence because 2 or fewer credible sales survived inside 24 months.`
              : 'No credible closed sale fell outside the selected window, so nothing was set aside as historical context.'}
        </p>
        {reconciledNeededEvidence.length > 0 && (
          <p class="awv2-pi-note"><b>What would change this:</b> {reconciledNeededEvidence.join(' ')}</p>
        )}
        <details class="awv2-collapse">
          <summary>Full calculation ledger — every record and its valuation weight ({comps.length})</summary>
          <table class="awv2-cv-ledger">
            <thead>
              <tr><th>Record</th><th>Role</th><th>Acres</th><th>Price</th><th>$ / ac</th><th>Sold</th><th>Distance</th><th>Weight</th></tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={`led-${c.key}`} class={c.inValuationSet ? 'inset' : ''}>
                  <td>{nameOf(c)}</td>
                  <td>{isExcluded(c) ? 'Excluded' : c.valuationRole ? VALUATION_ROLE_LABEL[c.valuationRole] : c.categoryLabel}</td>
                  <td>{c.acres ?? '—'}</td>
                  <td>{usdOrDash(c.price)}</td>
                  <td>{usdOrDash(c.pricePerAcre)}</td>
                  <td>{c.dateIso || '—'}</td>
                  <td>{compDistanceLabel(c.distanceMiles)}</td>
                  <td>{c.valuationWeight ?? 'zero'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="awv2-pi-note">
            Only rows with a weight enter the cleaned average, cleaned median, weighted indication,
            adopted {subjectImprovement?.improved ? 'land value and land-basis references' : 'FMV, the 40/50/60 levels, the technical maximum, and the final range'}.
          </p>
        </details>
      </section>
    </>
  );
}

const CATEGORY_LABEL: Record<CvCategory, string> = {
  accepted_closed_sale: 'Closed vacant-land sale',
  candidate_closed_sale: 'Closed-sale candidate (excluded)',
  active_competition: 'Active vacant-land competition',
  asking_reference: 'Asking reference',
  improved_context: 'Improved-property context',
  rejected: 'Rejected',
  context_only: 'Context only',
};
