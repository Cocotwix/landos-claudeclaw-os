// Acquisition Workspace V2 — Property Intelligence section.
//
// A usable property-research workspace rendered from the latest accepted
// canonical records. The workspace page loads them once (snapshot,
// marketContext, retained soil details) and passes them down, so switching
// sections reuses the already-loaded record instead of refetching.
// Values missing from the canonical data render as honestly missing; nothing
// is fabricated. Market context is labeled as LandOS Market Research and is
// never sourced from LandPortal market panels (SOP 10B).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-preact';
import { dashboardToken } from '@/lib/api';
import { OfficialParcelGisPanel, type OfficialParcelGisView } from './AcquisitionWorkspaceV2OfficialParcelGis';
import { LandUsePanel, type LandUseView } from './AcquisitionWorkspaceV2LandUse';
import type { CvSummary } from './AcquisitionWorkspaceV2CompsValuation';
import '../styles/workspace-v2-property-intelligence.css';

// ── View types (structural; every field optional and defensive) ────────

export interface PiFact { key: string; value: string; grade: string; label?: string; source?: string; note?: string }
export interface PiDdItem { key: string; label: string; verdict: string; headline: string; detail?: string; missing?: string[] }
export interface PiEvidenceItem { id: string; label: string; viewUrl: string; kind?: string; sourceType?: string; sourceUrl?: string | null }
export interface PiCompRow {
  key?: string; apn?: string | null; address?: string | null; lane?: string; source?: string;
  sourceUrl?: string | null; status?: string; dateIso?: string | null; price?: number | null;
  acres?: number | null; pricePerAcre?: number | null; thumbnailUrl?: string | null;
}
export interface PiComps {
  conclusion?: string; summaryLine?: string;
  sold?: PiCompRow[]; active?: PiCompRow[]; askingReferences?: PiCompRow[];
  landPortalRowsSeen?: number; totalCollected?: number; duplicatesMerged?: number;
}
export interface PiSnapshot {
  status?: string;
  identity?: {
    displayAddress?: string; normalizedAddress?: string; owner?: string | null;
    ownerMailing?: string | null; county?: string; state_?: string; apn?: string;
    acres?: number | null; acreageBasis?: string; lpPropertyId?: string | null;
    zip?: string | null; city?: string | null;
    conflicts?: string[]; sourceConfidence?: string; hasParcelGeometry?: boolean;
  };
  facts?: PiFact[];
  dueDiligence?: PiDdItem[];
  evidence?: PiEvidenceItem[];
  comps?: PiComps;
  researchStatus?: ResearchStatusView;
  missingInformation?: unknown[];
  subjectParcelUrl?: string | null;
}

export interface MarketContextMetricsView {
  soldCount: number | null; activeCount: number | null; medianDaysOnMarket: number | null;
  sellThroughRate: number | null; absorptionRate: number | null; monthsOfSupply: number | null;
  medianPrice: number | null; medianPricePerAcre: number | null;
  population: number | null; populationGrowth: number | null;
}
export interface MarketContextRecordView {
  scope: string; label: string; available: boolean;
  acreageBand: string | null; acreageBandLabel: string | null;
  period: string | null; snapshotDate: string | null; provider: string | null;
  metrics: MarketContextMetricsView | null; note: string;
}
export interface MarketContextView {
  source: string;
  geography: { county: string | null; fips: string | null; state: string | null; zip: string | null; acres: number | null; subjectBand: string | null };
  county: MarketContextRecordView; zip: MarketContextRecordView;
  subjectBand: MarketContextRecordView; fastestBand: MarketContextRecordView;
  interpretation: string;
  read?: {
    headline?: string | null; summary?: string | null; resolvedVia?: string | null;
    exactSubjectBand?: boolean; note?: string | null;
  } | null;
  liquidity?: {
    headline?: string | null; summary?: string | null; resolvedVia?: string | null;
    competition?: number | null; note?: string | null;
  } | null;
}

export interface SoilDetail { symbol?: string; name?: string; fields?: Record<string, string> }
export interface BrowseruseResp { soilDetails?: SoilDetail[] }

export interface StreetViewObservationView {
  label: string; detail: string; confidence?: string; evidence?: string;
}
export interface StreetViewView { available: boolean; observations: StreetViewObservationView[] }

export interface MissingDiligenceItemView {
  key: string; label: string; currentFinding: string;
  stillUnresolved: string; whyItMatters: string; nextSource: string;
  shortStatus?: string; shortNext?: string; urgent?: boolean;
}
export interface MissingDiligenceView {
  items: MissingDiligenceItemView[];
  evidenceGaps: string[];
  passthrough: string[];
}

export interface AccessPresentationView {
  established: boolean;
  road: string | null;
  legalAccess: string | null;
  frontageFt: number | null;
  apparentEntrance: string;
  apparentEntranceConfirmed: boolean;
  apparentEntranceObservation: string | null;
  evidence?: {
    items: AccessEvidenceView[];
    byTier: Record<'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal', AccessEvidenceView[]>;
    parcelFlagged: boolean;
    apparentPhysicalAccess: boolean;
    reportedLegalAccess: boolean;
    verifiedLegalAccess: boolean;
    operatorConclusion: string;
    outstanding: string[];
    conclusionWeight: string;
    rungs?: Array<{
      tier: 'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal';
      statement: string; sourceLabel?: string; basis?: string; weight?: string;
      sourceUrl?: string | null;
    }>;
  };
}
export interface AccessEvidenceView {
  tier: 'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal';
  statement: string; sourceLabel: string; sourceKind: string; basis: string; weight: string;
  sourceUrl?: string | null; observedAt?: string | null;
}

export interface SoilsSepticUnitView {
  name: string; symbol?: string | null; slopeRange?: string | null;
  drainageClass?: string | null; hydrologicGroup?: string | null;
  waterTableDepthCm?: number | null; bedrockDepthCm?: number | null;
  floodingFrequency?: string | null; pondingFrequency?: string | null;
  septicRating?: string | null; limitationReasons?: string[];
  parcelSharePct?: number | null;
}
export interface SoilsSepticView {
  category: string; categoryLabel: string; conclusion: string;
  supportingFactors: string[]; limitations: string[];
  bestTestingAreas: string | null; confidence: string; confidenceWhy: string;
  nextStep: string; parcelShareNote: string; units: SoilsSepticUnitView[];
  source: string; screenedAt: string | null;
}

export interface VisualBuyerNarrativeView {
  sections: Array<{ title: string; body: string }>;
  overviewMarketLine: string | null;
}

export interface ResearchStatusView {
  delivered: number; total: number; headline: string;
  questionsResolved?: number; questionsTotal?: number; unresolvedQuestions?: number;
  areas: Array<{ id: string; label: string; delivered: boolean; status: string; reason: string | null; nextAction: string | null }>;
  incomplete: Array<{ id: string; label: string; delivered: boolean; status: string; reason: string | null; nextAction: string | null }>;
}

/** Mirrors ExactAddressListingEvidenceView in src/landos/exact-address-web-discovery.ts. */
export interface ExactAddressListingSourceView {
  sourceLabel: string;
  family: string;
  sourceUrl: string;
  retrievedAt: string | null;
  propertyType: string | null;
  buildingSqft: number | null;
  acres: number | null;
  listingStatus: string | null;
  listingStatusDate: string | null;
  price: number | null;
  utilities: string[];
  well: boolean | null;
  septic: boolean | null;
  accessStatements: string[];
  drivewayStatements: string[];
  accessLanguageNote: string;
  provenanceNote: string;
  originalListPrice?: number | null;
  listDate?: string | null;
  daysOnMarket?: number | null;
  views?: number | null;
  saves?: number | null;
  zillowViews?: number | null;
  zillowSaves?: number | null;
  engagementRetrievedAt?: string | null;
  priceHistory?: Array<{ date?: string | null; price?: number | null; event?: string | null }>;
  photos?: string[];
  photoUrls?: string[];
  primaryPhotoUrl?: string | null;
  beds?: number | null;
  baths?: number | null;
  yearBuilt?: number | null;
  brokerage?: string | null;
  mls?: string | null;
  description?: string | null;
  features?: string[];
}
export interface ExactAddressListingsView {
  status: string;
  note: string;
  queries: string[];
  retrievedAtIso: string | null;
  sources: ExactAddressListingSourceView[];
  subjectRead: { improved: boolean; buildingSqft: number | null; acres: number | null; statement: string } | null;
  disclaimer: string;
}

export interface VbaObservationView {
  label: string; detail: string; views?: string[]; basis?: string;
}
export interface VisualBuyerAnalysisView {
  generatedAt?: string;
  basedOn?: string[];
  observedFeatures?: VbaObservationView[];
  buyerInterpretation?: VbaObservationView[];
  unresolvedDiligence?: string[];
  buyerPerspective?: {
    strongestAdvantages?: string[]; importantConcerns?: string[];
    bestFitBuyers?: string[]; weakerFitBuyers?: string[];
    preliminaryImpression?: string; materialToValueOrStrategy?: string[];
  };
  evidenceReconciliation?: {
    supportingViews?: string[];
    supersededConclusions?: Array<{ prior: string; reconciled: string; strongerEvidence: string }>;
    remainingUncertain?: string[];
    overallConfidence?: string; confidenceWhy?: string;
  };
  overviewSummary?: { physicalCharacter?: string; mainBuyerAppeal?: string; topConcern?: string };
}

// ── Helpers ────────────────────────────────────────────────────────────

const tok = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
const num = (s: string | null | undefined, re: RegExp): string | null => {
  const m = s ? s.match(re) : null;
  return m ? m[1] : null;
};
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function fmtMetric(key: keyof MarketContextMetricsView, v: number | null): string | null {
  if (v === null) return null;
  if (key === 'medianPrice' || key === 'medianPricePerAcre') return usd(v);
  if (key === 'sellThroughRate' || key === 'absorptionRate' || key === 'populationGrowth') return `${v}%`;
  if (key === 'medianDaysOnMarket') return `${Math.round(v)} days`;
  if (key === 'monthsOfSupply') return `${v} mo`;
  return Math.round(v).toLocaleString('en-US');
}

/** missingInformation entries arrive as strings or labeled objects. */
function missingLabel(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    for (const k of ['label', 'area', 'summary', 'detail', 'reason']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) return o[k] as string;
    }
  }
  return null;
}

const GALLERY_ORDER = [
  'inspection-close_parcel_aerial', 'inspection-road_frontage_aerial', 'inspection-parcel_context',
  'inspection-default_3d', 'inspection-front_side_3d', 'inspection-rear_side_3d',
  'inspection-street_view', 'inspection-street_view_2', 'inspection-street_view_3',
  'inspection-street_view_4', 'inspection-street_view_5',
  'inspection-buildability', 'inspection-wetlands_overlay',
  'inspection-fema_flood_overlay', 'inspection-soil_overlay', 'inspection-contour_terrain_view',
  'inspection-comps_map',
];

function Kv({ k, v, empty }: { k: string; v: string | null | undefined; empty?: string }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">{empty || 'Not supplied by retained sources'}</span>}
    </>
  );
}

function MarketCard({ rec }: { rec: MarketContextRecordView }) {
  const rows: Array<[string, keyof MarketContextMetricsView]> = [
    ['Sold', 'soldCount'], ['Active', 'activeCount'], ['Median DOM', 'medianDaysOnMarket'],
    ['Sell-through', 'sellThroughRate'], ['Absorption', 'absorptionRate'], ['Months of supply', 'monthsOfSupply'],
    ['Median price', 'medianPrice'], ['Median $/acre', 'medianPricePerAcre'],
    ['Population', 'population'], ['Pop. growth', 'populationGrowth'],
  ];
  return (
    <div class={`awv2-mkt-card${rec.available ? '' : ' unavailable'}`}>
      <div class="h">{rec.label}</div>
      <div class="p">{rec.period ? `Period ${rec.period}` : 'No period'}{rec.snapshotDate ? ` · captured ${rec.snapshotDate.slice(0, 10)}` : ''}</div>
      {rec.available && rec.metrics ? (
        <div class="rows">
          {rows.map(([label, key]) => {
            const v = fmtMetric(key, rec.metrics ? rec.metrics[key] : null);
            return (
              <>
                <span class="k">{label}</span>
                {v ? <span class="v">{v}</span> : <span class="v empty">Unknown</span>}
              </>
            );
          })}
        </div>
      ) : (
        <div class="miss">{rec.note}</div>
      )}
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────

export function PropertyIntelligenceSection({ snap, market, soils, streetView, vba, missingDiligence, accessView, soilsSeptic, narrative, dealId, officialParcelGis, landUse, exactAddressListings, researchStatus: researchStatusProp, valuationSummary }: {
  snap: PiSnapshot;
  market: MarketContextView | null;
  soils: SoilDetail[] | null;
  streetView: StreetViewView | null;
  vba: VisualBuyerAnalysisView | null;
  missingDiligence: MissingDiligenceView | null;
  accessView?: AccessPresentationView | null;
  soilsSeptic?: SoilsSepticView | null;
  narrative?: VisualBuyerNarrativeView | null;
  dealId?: number;
  officialParcelGis?: OfficialParcelGisView | null;
  landUse?: LandUseView | null;
  exactAddressListings?: ExactAddressListingsView | null;
  researchStatus?: ResearchStatusView | null;
  valuationSummary?: CvSummary | null;
}) {
  // Same-page evidence viewer: index into the ordered gallery, or null.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const id = snap.identity || {};
  const address = id.displayAddress || '';
  // The reconciled record first; the address string is only a fallback for
  // records that predate identity reconciliation. Parsing the intake string is
  // exactly how a superseded ZIP kept being shown as the subject's ZIP.
  const zip = id.zip || num(address, /\b(\d{5})\s*$/);
  const street = address.split(',')[0]?.trim() || '';
  const roadName = street.replace(/^\d+\s+/, '');

  // Acreage values with source, straight from graded facts.
  const facts = snap.facts || [];
  const fact = (key: string): PiFact | undefined => facts.find((f) => f.key === key);
  // Retained LandPortal sidebar values (discovery-stage source, verbatim).
  const sidebar = (name: string): string | null => fact(`lp_sidebar_${name}`)?.value || null;
  const firstFact = (...keys: string[]): string | null => {
    for (const key of keys) {
      const retained = fact(key)?.value;
      if (retained) return retained;
    }
    return null;
  };
  const waterFeature = sidebar('water_feature_type');
  const zoningCode = sidebar('zoning_code');
  const femaDescription = sidebar('fema_flood_zone_description');
  const landPortalTerrain = firstFact('lp_sidebar_terrain', 'lp_sidebar_terrain_type', 'lp_sidebar_topography');
  const landPortalSlope = firstFact('lp_sidebar_slope', 'lp_sidebar_average_slope', 'lp_sidebar_slope_description');
  const landPortalBuildability = firstFact('lp_sidebar_buildability', 'lp_sidebar_buildable_area', 'lp_sidebar_buildability_pct');
  const landPortalWetlands = firstFact('lp_sidebar_wetlands', 'lp_sidebar_wetlands_pct', 'lp_sidebar_wetland_type');
  const landPortalSoils = firstFact('lp_sidebar_soils', 'lp_sidebar_soil_type', 'lp_sidebar_soil_description');
  const landPortalFrontage = firstFact('lp_sidebar_frontage', 'lp_sidebar_road_frontage');
  const landPortalImprovement = firstFact('lp_sidebar_improvements', 'lp_sidebar_improvement_type', 'lp_sidebar_building_sqft');
  const landPortalParcelContext = firstFact('lp_sidebar_parcel_context', 'lp_sidebar_land_use', 'lp_sidebar_property_type');
  const lastSalePrice = sidebar('last_sale_price');
  const lastSaleDate = sidebar('last_sale_date');
  const bookNumber = sidebar('book_number');
  const pageNumber = sidebar('page_number');
  const assessedValue = sidebar('assessed_value');
  const lastSalePriceUsd = lastSalePrice && /^[\d,.]+$/.test(lastSalePrice.trim())
    ? usd(Number(lastSalePrice.replace(/,/g, '')))
    : null;
  const acreageFacts: Array<{ label: string; fact: PiFact | undefined }> = [
    { label: 'Official record', fact: fact('discovery_official_record_acres') },
    { label: 'Verified LandPortal import', fact: fact('acres') },
    { label: 'Operator input', fact: fact('discovery_operator_input_acres') },
    { label: 'LandPortal parcel panel', fact: fact('discovery_marketplace_parcel_panel_acres') },
  ].filter((e) => e.fact);
  const acreNumbers = acreageFacts
    .map((e) => Number(num(e.fact?.value ?? '', /([\d.]+)/)))
    .filter((value) => Number.isFinite(value));
  const acreConflict = acreNumbers.some((value) => Math.abs(value - acreNumbers[0]) > 0.01);

  const dd = new Map<string, PiDdItem>((snap.dueDiligence || []).map((x) => [x.key, x]));
  const access = dd.get('access');
  const terrain = dd.get('terrain');
  const wetlands = dd.get('wetlands');
  const flood = dd.get('flood');
  const utilities = dd.get('utilities');
  const zoning = dd.get('zoning');
  const septic = dd.get('septic');

  const frontageFt = num(access?.headline, /([\d.]+)\s*ft frontage/);
  const slopePct = num(terrain?.headline, /([\d.]+)%\s*average slope/);
  const buildPct = num(terrain?.headline, /([\d.]+)%\s*buildability/);
  const wetPct = num(wetlands?.headline, /([\d.]+)%/);
  const floodPct = num(flood?.headline, /(\d+(?:\.\d+)?)/);
  const acres = id.acres ?? null;

  const evidence = (snap.evidence || []).filter((e) => e.viewUrl);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const gallery = [
    ...GALLERY_ORDER.map((gid) => byId.get(gid)).filter((e): e is PiEvidenceItem => !!e),
    ...evidence.filter((e) => !GALLERY_ORDER.includes(e.id)),
  ];
  const overview = byId.get('inspection-landportal_overview') ?? byId.get('inspection-parcel_context') ?? null;
  const hasDefault3d = byId.has('inspection-default_3d');
  const has3d = hasDefault3d || byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d');
  const hasBuildabilityCapture = byId.has('inspection-buildability');
  const hasStreetViewCapture = byId.has('inspection-street_view');
  const supportedStreetObservations = hasStreetViewCapture
    ? (streetView?.observations ?? []).filter((observation) => !!observation.evidence?.trim() && !/unavailable/i.test(observation.label))
    : [];

  const comps = snap.comps || {};
  const researchStatus = researchStatusProp ?? snap.researchStatus;
  const accessRungs = accessView?.evidence?.rungs ?? ([
    ['parcel_flag', 'LandPortal parcel flag'],
    ['apparent_physical', 'Apparent physical route'],
    ['reported_legal', 'Reported legal / easement access'],
    ['verified_legal', 'Verified recorded legal access'],
  ] as const).map(([tier, label]) => {
    const item = accessView?.evidence?.byTier?.[tier]?.[0];
    return {
      tier,
      statement: item?.statement || `${label}: no evidence retained.`,
      sourceLabel: item?.sourceLabel,
      basis: item?.basis,
      weight: item?.weight,
      sourceUrl: item?.sourceUrl,
    };
  });
  const listingSources = exactAddressListings?.sources ?? [];
  const primaryListing = listingSources.find((source) => source.family.toLowerCase().includes('zillow')) ?? listingSources[0] ?? null;
  const listingPhotos = primaryListing
    ? [...new Set([primaryListing.primaryPhotoUrl, ...(primaryListing.photos ?? []), ...(primaryListing.photoUrls ?? [])].filter((url): url is string => !!url))]
    : [];
  const listingViews = primaryListing?.views ?? primaryListing?.zillowViews ?? null;
  const listingSaves = primaryListing?.saves ?? primaryListing?.zillowSaves ?? null;
  const [listingPhotoIndex, setListingPhotoIndex] = useState(0);
  const canonicalAcres = acres == null ? null : `${Number(acres).toLocaleString('en-US', { maximumFractionDigits: 2 })} AC`;

  // Missing diligence, grouped once, honestly.
  const missing: string[] = [];
  for (const item of [zoning, utilities, septic]) {
    if (item && (item.verdict === 'unknown' || item.verdict === 'unresolved')) missing.push(item.label);
  }
  for (const m of access?.missing || []) missing.push(m);
  for (const entry of snap.missingInformation || []) {
    const label = missingLabel(entry);
    if (label && !missing.includes(label)) missing.push(label);
  }
  if (!waterFeature) missing.push('Water features');
  if (!primaryListing?.buildingSqft && !landPortalImprovement) missing.push('Building information');
  if (!byId.has('inspection-parcel_context')) missing.push('Wider-context aerial');
  if (!hasStreetViewCapture && streetView?.available !== false) missing.push('Street View capture');
  if (!hasBuildabilityCapture && !landPortalBuildability) missing.push('Dedicated buildability capture');

  return (
    <>
      {/* ── Subject summary ── */}
      <div class="awv2-pi-questions">
        <section class="awv2-panel awv2-pi-subject" id="pi-subject">
          <div class="awv2-panel-title">Subject</div>
          <div class="awv2-kv">
            <Kv k="Address" v={address} />
            <Kv k="Owner of record" v={id.owner || null} />
            <Kv k="APN" v={id.apn || null} />
            <Kv k="Acreage" v={canonicalAcres} />
            <Kv k="County" v={id.county ? `${id.county} County` : null} />
            <Kv k="Municipality / jurisdiction" v={id.city || null} empty="Not yet resolved" />
            <Kv k="State" v={id.state_ || null} />
            <Kv k="ZIP" v={zip} />
          </div>
          <details class="awv2-collapse awv2-pi-provenance">
            <summary>Identity provenance</summary>
            <div class="awv2-pi-note">
              Acreage basis: {id.acreageBasis || 'not stated'} · {acreageFacts.length} retained source observation(s)
              {acreConflict ? ' · a material conflict remains in source evidence' : ' · numerically equivalent observations reconciled'}.
              {id.lpPropertyId ? ` LandPortal parcel ${id.lpPropertyId}.` : ''}
            </div>
            {(id.conflicts || []).map((c) => <div class="awv2-pi-note">Conflict: {c}</div>)}
          </details>
          {valuationSummary && <p class="awv2-pi-note">Canonical valuation state: {valuationSummary.acceptedCount} accepted comp{valuationSummary.acceptedCount === 1 ? '' : 's'} · {valuationSummary.status}.</p>}
        </section>

        {/* Current listing / public property context from the existing exact-address lane. */}
        {exactAddressListings ? (
          <section class="awv2-panel awv2-listing-card" id="exact-address-listing-evidence">
            <div class="awv2-panel-title">
              Current listing / public property context
              <span class="awv2-src-tag">Exact-address web discovery · {exactAddressListings.status}</span>
            </div>
            {primaryListing ? (
              <div class="awv2-listing-layout">
                {listingPhotos.length > 0 && (
                  <div class="awv2-listing-photos">
                    <img src={listingPhotos[listingPhotoIndex].startsWith('/api/') ? tok(listingPhotos[listingPhotoIndex]) : listingPhotos[listingPhotoIndex]} alt={`${primaryListing.sourceLabel} subject listing photo ${listingPhotoIndex + 1}`} />
                    {listingPhotos.length > 1 && (
                      <div class="awv2-listing-photo-controls">
                        <button type="button" onClick={() => setListingPhotoIndex((listingPhotoIndex - 1 + listingPhotos.length) % listingPhotos.length)}>Previous</button>
                        <span>{listingPhotoIndex + 1} / {listingPhotos.length}</span>
                        <button type="button" onClick={() => setListingPhotoIndex((listingPhotoIndex + 1) % listingPhotos.length)}>Next</button>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div class="awv2-listing-status">
                    <strong>{primaryListing.listingStatus || 'Listing status not published'}</strong>
                    {primaryListing.price != null && <span>{usd(primaryListing.price)}</span>}
                  </div>
                  <div class="awv2-listing-metrics">
                    <div><span>Listing age</span><b>{primaryListing.daysOnMarket != null ? `${primaryListing.daysOnMarket} days` : primaryListing.listDate || 'Unavailable'}</b></div>
                    <div><span>Zillow views</span><b>{primaryListing.family.toLowerCase().includes('zillow') && listingViews != null && listingViews > 0 ? listingViews.toLocaleString('en-US') : 'Not collected (never shown as zero)'}</b></div>
                    <div><span>Zillow saves</span><b>{primaryListing.family.toLowerCase().includes('zillow') && listingSaves != null && listingSaves > 0 ? listingSaves.toLocaleString('en-US') : 'Not collected (never shown as zero)'}</b></div>
                    <div><span>Original list price</span><b>{primaryListing.originalListPrice != null ? usd(primaryListing.originalListPrice) : 'Unavailable'}</b></div>
                    <div><span>Price changes</span><b>{primaryListing.priceHistory?.length ? `${primaryListing.priceHistory.length} retained event(s)` : 'Unavailable'}</b></div>
                  </div>
                  <div class="awv2-listing-facts">
                    {[primaryListing.propertyType,
                      primaryListing.buildingSqft != null ? `${primaryListing.buildingSqft.toLocaleString('en-US')} sqft` : null,
                      primaryListing.beds != null ? `${primaryListing.beds} beds` : null,
                      primaryListing.baths != null ? `${primaryListing.baths} baths` : null,
                      primaryListing.yearBuilt != null ? `Built ${primaryListing.yearBuilt}` : null,
                      primaryListing.well === true ? 'Well' : null,
                      primaryListing.septic === true ? 'Septic' : null,
                      ...(primaryListing.utilities ?? [])].filter(Boolean).map((value) => <span>{value}</span>)}
                  </div>
                  {(primaryListing.brokerage || primaryListing.mls) && <div class="awv2-pi-note">{[primaryListing.brokerage, primaryListing.mls].filter(Boolean).join(' · ')}</div>}
                  <a class="awv2-listing-link" href={primaryListing.sourceUrl} target="_blank" rel="noreferrer">Open {primaryListing.sourceLabel} listing</a>
                  <div class="awv2-sv-basis">Engagement retrieved {primaryListing.engagementRetrievedAt || primaryListing.retrievedAt || exactAddressListings.retrievedAtIso || 'time unavailable'} · interest signal, not proof of value.</div>
                </div>
              </div>
            ) : (
              <div class="awv2-pi-note">{exactAddressListings.note || 'No property-specific listing page was retained.'}</div>
            )}
            <details class="awv2-collapse awv2-listing-details">
              <summary>Listing details and source provenance</summary>
              {exactAddressListings.subjectRead && <div class="awv2-pi-note" data-testid="ea-subject-read"><b>Resolved subject context:</b> {exactAddressListings.subjectRead.statement}</div>}
              {listingSources.map((source) => (
                <div class="awv2-pi-note" data-testid="ea-listing-source">
                  <b>{source.sourceLabel}</b> · {source.provenanceNote} <a href={source.sourceUrl} target="_blank" rel="noreferrer">source</a>
                  {source.accessLanguageNote && <div class="awv2-sv-basis">{source.accessLanguageNote}</div>}
                  {source.description && <p>{source.description}</p>}
                  {(source.features ?? []).length > 0 && <div>{source.features!.join(' · ')}</div>}
                  {(source.priceHistory ?? []).length > 0 && <div>{source.priceHistory!.map((row) => [row.date, row.event, row.price != null ? usd(row.price) : null].filter(Boolean).join(' · ')).join(' | ')}</div>}
                  {[...source.accessStatements, ...source.drivewayStatements].map((text) => <div class="awv2-sv-basis">Listing-reported access wording: “{text}”</div>)}
                </div>
              ))}
              <div class="awv2-pi-note">{exactAddressListings.disclaimer}</div>
            </details>
          </section>
        ) : (
          <section class="awv2-panel" id="exact-address-listing-evidence">
            <div class="awv2-panel-title">Current listing / public property context</div>
            <div class="awv2-pi-note">Exact-address discovery has not returned a retained public-property result yet.</div>
          </section>
        )}

        {/* ── Access & road frontage ── */}
        <section class="awv2-panel" id="access-road-frontage">
          <div class="awv2-panel-title">Access &amp; road frontage</div>
          <div class="awv2-kv">
            <Kv k="Road frontage" v={landPortalFrontage || (frontageFt ? `${Math.round(Number(frontageFt))} ft` : null)} empty="Not supplied by LandPortal" />
            <Kv k="Road" v={roadName ? `${roadName} (situs road)` : null} />
          </div>
          <div class="awv2-access-ladder" aria-label="Four-part access evidence ladder">
            {accessRungs.map((rung, index) => (
              <div class="awv2-access-rung">
                <span class="step">{index + 1}</span>
                <div><b>{({ parcel_flag: 'LandPortal parcel flag', apparent_physical: 'Apparent physical route', reported_legal: 'Reported legal / easement access', verified_legal: 'Verified recorded legal access' } as const)[rung.tier]}</b><p>{rung.statement}</p></div>
                <span class="weight">{rung.weight || 'Unresolved'}</span>
              </div>
            ))}
          </div>
          {accessView?.evidence?.operatorConclusion && <div class="awv2-pi-note"><b>Reconciled operator read:</b> {accessView.evidence.operatorConclusion}</div>}
          <details class="awv2-collapse awv2-access-details">
            <summary>Access sources and unresolved diligence</summary>
            {accessRungs.map((rung) => <div class="awv2-pi-note">{rung.sourceLabel || 'No source retained'}{rung.basis ? ` · ${rung.basis.replace(/_/g, ' ')}` : ''}{rung.sourceUrl ? <> · <a href={rung.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</div>)}
          </details>
          {(access?.missing || []).length > 0 && (
            missingDiligence
              ? <div class="awv2-pi-note">Survey-grade frontage and easement review are tracked under Missing diligence below.</div>
              : <div class="awv2-pi-note">Still required: {(access?.missing || []).slice(0, 4).join('; ')}{(access?.missing || []).length > 4 ? '…' : ''}</div>
          )}
        </section>
      </div>

      {/* ── Terrain + Environmental ── */}
      <div class="awv2-grid cols-3-2">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Terrain &amp; usable area</div>
          <div class="awv2-kv">
            <Kv k="Average slope" v={landPortalSlope || (slopePct ? `${slopePct}%` : null)} />
            <Kv k="Buildability" v={landPortalBuildability || (buildPct ? `${buildPct}% shown` : null)} />
            <Kv k="Buildability view" v={hasBuildabilityCapture ? 'Dedicated yellow-overlay capture retained (gallery below)' : null} empty="No dedicated buildability capture" />
            <Kv k="Terrain" v={landPortalTerrain || terrain?.detail || null} />
            <Kv k="Improvement context" v={landPortalImprovement || (exactAddressListings?.subjectRead?.improved ? exactAddressListings.subjectRead.statement : null)} empty="No improvement fact supplied" />
            <Kv k="Parcel context" v={landPortalParcelContext} empty="No parcel-context fact supplied" />
            <Kv
              k="3D evidence"
              v={has3d
                ? [hasDefault3d ? 'Default 3D view (primary)' : null,
                   byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d') ? 'front/rear 3D views' : null]
                    .filter(Boolean).join(' + ') + ' captured (gallery below)'
                : null}
              empty="No 3D captures"
            />
          </div>
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Environmental &amp; soils</div>
          <div class="awv2-kv">
            <Kv k="Wetlands" v={landPortalWetlands || (wetPct ? `${wetPct}% — parcel panel` : null)} />
            <Kv k="FEMA flood" v={femaDescription || (floodPct ? `${floodPct}% — parcel panel` : null)} />
            <Kv k="Soils" v={landPortalSoils} empty="See retained soil overlay below" />
            <Kv k="Water feature" v={waterFeature ? `${waterFeature} — LandPortal sidebar` : null} empty="Not supplied by LandPortal" />
            <Kv k="Contours" v={byId.has('inspection-contour_terrain_view') ? 'Contour view captured (gallery below)' : null} empty="No contour capture" />
          </div>
          {femaDescription && (
            <div class="awv2-pi-note"><b>FEMA flood zone description (LandPortal):</b> {femaDescription}</div>
          )}
          {(soils && soils.length > 0) || soilsSeptic ? (
            <div class="awv2-pi-note">Mapped soil units and the preliminary septic outlook are detailed under <b>Soils &amp; Preliminary Septic Outlook</b> below.</div>
          ) : (
            <div class="awv2-pi-note">The retained LandPortal evidence did not supply soil-unit details for this parcel.</div>
          )}
          {wetlands?.detail && <div class="awv2-pi-note">{wetlands.detail}</div>}
        </section>
      </div>

      {/* ── Official Parcel & GIS ──
          Placed directly after the subject/access panels: which government
          source of record answered, and whether the parcel is confirmed, is
          the foundation every later research lane depends on. */}
      {dealId != null && (
        <OfficialParcelGisPanel dealId={dealId} initial={officialParcelGis ?? null} />
      )}

      {/* ── Land Use & Subdivision ──
          Directly after the parcel evidence it is built on: who governs the
          parcel, whether it is zoned, what may be built by right, and what may
          be divided by right. Every downstream valuation scenario depends on
          this being right, so it sits where the operator reads it in order. */}
      {dealId != null && (
        <LandUsePanel dealId={dealId} initial={landUse ?? null} />
      )}

      <section class="awv2-panel" id="utilities-septic">
        <div class="awv2-panel-title">Utilities / septic</div>
        <div class="awv2-pi-question-read">
          <div><span>Utilities</span><b>{utilities?.headline || 'Not yet resolved'}</b></div>
          <div><span>Septic</span><b>{soilsSeptic?.categoryLabel || septic?.headline || 'Field testing required'}</b></div>
          <div><span>Listing-reported context</span><b>{primaryListing?.utilities?.length ? primaryListing.utilities.join(', ') : 'No utility detail retained from listing'}</b></div>
        </div>
        {(utilities?.detail || septic?.detail) && (
          <details class="awv2-collapse"><summary>Supporting utility and septic evidence</summary><div class="awv2-pi-note">{[utilities?.detail, septic?.detail].filter(Boolean).join(' ')}</div></details>
        )}
      </section>

      {/* ── Soils & Preliminary Septic Outlook ── */}
      <section class="awv2-panel" id="soils-septic">
        <div class="awv2-panel-title">
          Soils &amp; Preliminary Septic Outlook <span class="awv2-src-tag">{soilsSeptic?.source || 'LandPortal soil overlay'} · screening only</span>
        </div>
        {soilsSeptic ? (
          <>
            <div class={`awv2-septic-headline ${soilsSeptic.category}`}>
              Preliminary Septic Outlook: <b>{soilsSeptic.categoryLabel}</b>
            </div>
            <div class="awv2-pi-note">{soilsSeptic.conclusion}</div>
            <div class="awv2-mkt-grid awv2-soils-grid">
              {soilsSeptic.units.map((u) => (
                <div class="awv2-mkt-card">
                  <div class="h">{[u.symbol, u.name].filter(Boolean).join(' · ')}</div>
                  <div class="rows">
                    <span class="k">Slope</span>
                    {u.slopeRange ? <span class="v">{u.slopeRange}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Drainage</span>
                    {u.drainageClass ? <span class="v">{u.drainageClass}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Hydrologic group</span>
                    {u.hydrologicGroup ? <span class="v">{u.hydrologicGroup}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Seasonal water table</span>
                    {u.waterTableDepthCm != null ? <span class="v">≈{Math.round(u.waterTableDepthCm / 2.54)} in ({u.waterTableDepthCm} cm)</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Bedrock</span>
                    {u.bedrockDepthCm != null ? <span class="v">{u.bedrockDepthCm} cm</span> : <span class="v">None mapped in profile</span>}
                    <span class="k">Flooding / ponding</span>
                    {u.floodingFrequency ? <span class="v">{u.floodingFrequency}{u.pondingFrequency ? ` / ${u.pondingFrequency}` : ''}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Septic field rating</span>
                    {u.septicRating ? <span class="v">{u.septicRating}{u.limitationReasons?.length ? ` — ${u.limitationReasons.join('; ')}` : ''}</span> : <span class="v empty">No official rating retained</span>}
                    <span class="k">Parcel share</span>
                    {u.parcelSharePct != null ? <span class="v">{u.parcelSharePct}%</span> : <span class="v empty">Not supplied</span>}
                  </div>
                </div>
              ))}
            </div>
            {soilsSeptic.supportingFactors.length > 0 && (
              <div class="awv2-pi-note"><b>Supporting factors:</b> {soilsSeptic.supportingFactors.join(' ')}</div>
            )}
            {soilsSeptic.limitations.length > 0 && (
              <div class="awv2-pi-note"><b>Primary possible limitations:</b> {soilsSeptic.limitations.join(' ')}</div>
            )}
            {soilsSeptic.bestTestingAreas && (
              <div class="awv2-pi-note"><b>Best apparent areas for field testing:</b> {soilsSeptic.bestTestingAreas}</div>
            )}
            <div class="awv2-pi-note">
              <b>Confidence:</b> {soilsSeptic.confidence} — {soilsSeptic.confidenceWhy} {soilsSeptic.parcelShareNote}
            </div>
            <div class="awv2-pi-note"><b>Required next step:</b> {soilsSeptic.nextStep}</div>
          </>
        ) : (
          <div class="awv2-pi-note">No soil units are retained for this parcel yet, so no preliminary septic outlook can be stated.</div>
        )}
      </section>

      {/* ── Zoning, sale history, and assessment (LandPortal sidebar) ── */}
      <details class="awv2-collapse awv2-pi-diagnostics">
        <summary>LandPortal source facts and provenance</summary>
      <div class="awv2-grid cols-3">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Zoning &amp; land use <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Zoning code" v={zoningCode} empty="Not supplied" />
            <Kv k="Official zoning" v={zoning && zoning.verdict !== 'unknown' && zoning.verdict !== 'unresolved' ? zoning.headline : null} empty="Not confirmed — official record pending" />
          </div>
          {zoningCode && (
            <div class="awv2-pi-note">
              Displayed LandPortal sidebar value, stored verbatim. Discovery-stage
              data only; it is not an official zoning determination.
            </div>
          )}
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Sale &amp; deed history <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Last sale price" v={lastSalePrice ? `${lastSalePriceUsd ? `${lastSalePriceUsd} · ` : ''}displayed “${lastSalePrice}”` : null} empty="Not supplied" />
            <Kv k="Last sale date" v={lastSaleDate} empty="Not supplied" />
            <Kv k="Book number" v={bookNumber} empty="Not supplied" />
            <Kv k="Page number" v={pageNumber} empty="Not supplied" />
          </div>
          {(lastSalePrice || bookNumber) && (
            <div class="awv2-pi-note">
              Values as displayed on the LandPortal sidebar. The recorded deed
              remains the stronger source once retrieved.
            </div>
          )}
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Value &amp; assessment <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Assessed value" v={assessedValue} empty="Not supplied" />
            <Kv k="LandPortal estimate" v={fact('lpEstimateTotal')?.value || null} empty="Not supplied" />
          </div>
          {assessedValue && (
            <div class="awv2-pi-note">
              Assessed value as displayed on the LandPortal sidebar; county
              assessment rolls remain the stronger official source.
            </div>
          )}
        </section>
      </div>
      </details>

      {/* ── Visual evidence ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">Visual evidence <span class="awv2-src-tag">LandPortal · verified subject</span></div>
        {overview && (
          <figure class="awv2-gallery-item" style="margin:0 0 14px">
            <button type="button" class="awv2-gallery-open" onClick={() => setViewerIndex(gallery.indexOf(overview))} title="Open the deliberately framed LandPortal Overview">
              <img src={tok(overview.viewUrl)} alt="LandPortal satellite Overview showing the parcel, nearest road, and apparent access relationship" loading="lazy" />
            </button>
            <figcaption class="cap"><span>LandPortal satellite Overview · parcel and road context</span><span class="tag">Overview</span></figcaption>
          </figure>
        )}
        {gallery.length > 0 ? (
          <div class="awv2-gallery">
            {gallery.map((e, index) => (
              <figure class="awv2-gallery-item" style="margin:0">
                <button
                  type="button"
                  class="awv2-gallery-open"
                  onClick={() => setViewerIndex(index)}
                  title={`Open ${e.label} in the evidence viewer`}
                >
                  <img src={tok(e.viewUrl)} alt={e.label} loading="lazy" />
                </button>
                <figcaption class="cap"><span>{e.label}</span>{e.kind && <span class="tag">{e.kind}</span>}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div class="awv2-pi-note">No accepted visual evidence is on file for this parcel.</div>
        )}
      </section>

      {/* ── Street View observations ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">
          Street View observations <span class="awv2-src-tag">G Maps Street View via LandPortal</span>
        </div>
        {streetView && streetView.available && hasStreetViewCapture ? (
            <>
              <div class="awv2-pi-note">
                A usable Street View panorama was captured at the investigated public-road connection; the retained screenshot is in the gallery above.
              </div>
              {supportedStreetObservations.map((o) => (
                <div class="awv2-pi-note">
                  <b>{o.label}:</b> {o.detail}
                  {o.evidence && <span class="awv2-sv-basis"> — {o.evidence}</span>}
                </div>
              ))}
              {supportedStreetObservations.length === 0 && <div class="awv2-pi-note">No panorama-backed textual observation is retained; inspect the screenshot directly.</div>}
            </>
        ) : streetView?.available === false ? (
            <div class="awv2-pi-note">
              <b>Usable Street View coverage does not exist for the investigated connection point.</b>{' '}
              {streetView.observations.find((o) => /unavailable/i.test(o.label))?.detail
                || 'No supported visual observation is stated.'}
            </div>
        ) : (
          <div class="awv2-pi-note">No real captured Street View panorama is retained, so no Street View observation is shown.</div>
        )}
      </section>

      {/* ── Visual Buyer Analysis: concise buyer narrative by default; the
             detailed structured analysis stays available, collapsed. ── */}
      <section class="awv2-panel" id="visual-buyer-analysis">
        <div class="awv2-panel-title">
          Visual Buyer Analysis <span class="awv2-src-tag">Multi-view · {vba?.basedOn?.length ?? 0} evidence categories</span>
        </div>
        {narrative && narrative.sections.length > 0 ? (
          <div class="awv2-vbn">
            {narrative.sections.map((s) => (
              <div class="awv2-vbn-section">
                <div class="h">{s.title}</div>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        ) : !vba ? (
          <div class="awv2-pi-note">No multi-view Visual Buyer Analysis has been produced for this subject yet.</div>
        ) : null}
        {vba && (
          <details class="awv2-collapse awv2-vba-details">
            <summary>View supporting observations and evidence</summary>
            <div class="awv2-vba">
              <div class="awv2-vba-col">
                <div class="h brass">A · Directly observed features</div>
                {(vba.observedFeatures || []).map((o) => (
                  <div class="awv2-pi-note"><b>{o.label}:</b> {o.detail}{o.views?.length ? <span class="awv2-sv-basis"> — {o.views.join(', ')}</span> : null}</div>
                ))}
                <div class="h brass" style="margin-top:12px">B · Buyer-oriented interpretation</div>
                {(vba.buyerInterpretation || []).map((o) => (
                  <div class="awv2-pi-note"><b>{o.label}:</b> {o.detail}</div>
                ))}
              </div>
              <div class="awv2-vba-col">
                <div class="h rust">C · Unresolved diligence</div>
                <ul>{(vba.unresolvedDiligence || []).map((d) => <li>{d}</li>)}</ul>
                <div class="h brass" style="margin-top:12px">D · Potential buyer perspective</div>
                <div class="awv2-pi-note"><b>Strongest advantages:</b> {(vba.buyerPerspective?.strongestAdvantages || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Most important concerns:</b> {(vba.buyerPerspective?.importantConcerns || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Best-fit buyers:</b> {(vba.buyerPerspective?.bestFitBuyers || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Weaker-fit buyers:</b> {(vba.buyerPerspective?.weakerFitBuyers || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Preliminary impression:</b> {vba.buyerPerspective?.preliminaryImpression || '—'}</div>
                <div class="awv2-pi-note"><b>Would materially change value or strategy:</b> {(vba.buyerPerspective?.materialToValueOrStrategy || []).join('; ')}</div>
                <div class="h" style="margin-top:12px">E · Confidence &amp; evidence reconciliation</div>
                <div class="awv2-pi-note"><b>Supported by:</b> {(vba.evidenceReconciliation?.supportingViews || []).join(', ')}</div>
                {(vba.evidenceReconciliation?.supersededConclusions || []).map((s) => (
                  <div class="awv2-pi-note"><b>Superseded:</b> {s.prior} → <b>{s.reconciled}</b> <span class="awv2-sv-basis">({s.strongerEvidence})</span></div>
                ))}
                <div class="awv2-pi-note"><b>Still uncertain:</b> {(vba.evidenceReconciliation?.remainingUncertain || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Overall confidence:</b> {vba.evidenceReconciliation?.overallConfidence || '—'} — {vba.evidenceReconciliation?.confidenceWhy || ''}</div>
              </div>
            </div>
          </details>
        )}
      </section>

      {/* ── Market context (LandOS Market Research) ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">
          Market context <span class="awv2-src-tag">{market?.source || 'LandOS Market Research'} — not LandPortal</span>
        </div>
        {market ? (
          <>
            <div class="awv2-market-read">
              <strong>{market.read?.headline || market.read?.summary || market.interpretation || 'No concise market read is retained.'}</strong>
              {market.read?.resolvedVia && <span>Resolved via {market.read.resolvedVia}</span>}
              {market.read?.note && <span>{market.read.note}</span>}
              <span>Competition: {market.liquidity?.competition != null ? market.liquidity.competition : 'unmeasured'}</span>
            </div>
            <details class="awv2-collapse awv2-pi-diagnostics">
              <summary>Market records and methodology</summary>
              <div class="awv2-mkt-grid">
                <MarketCard rec={market.county} />
                <MarketCard rec={market.zip} />
                <MarketCard rec={market.subjectBand} />
                <MarketCard rec={market.fastestBand} />
              </div>
            </details>
          </>
        ) : (
          <div class="awv2-pi-note">No LandOS Market Research context was returned for this lead.</div>
        )}
      </section>

      {/* ── Comparable research summary ── */}
      <div class="awv2-grid cols-3-2">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Comparable evidence handoff</div>
          <div class="awv2-pi-note">{comps.summaryLine || 'Current comparable state is maintained in Comps & Valuation.'}</div>
          <div class="awv2-pi-note">Counts and valuation conclusions are not recomputed on this page; Comps &amp; Valuation is the canonical detailed surface.</div>
          <details class="awv2-collapse awv2-pi-diagnostics">
            <summary>Collection diagnostics</summary>
            <div>LandPortal rows seen: {comps.landPortalRowsSeen ?? 'not reported'}</div>
            <div>Total collected: {comps.totalCollected ?? 'not reported'}</div>
            <div>Duplicates merged: {comps.duplicatesMerged ?? 'not reported'}</div>
          </details>
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Comparables map</div>
          {byId.has('inspection-comps_map') ? (
            <figure class="awv2-gallery-item awv2-comps-map" style="margin:0">
              <button
                type="button"
                class="awv2-gallery-open"
                onClick={() => setViewerIndex(gallery.findIndex((e) => e.id === 'inspection-comps_map'))}
                title="Open the Show on Map capture in the evidence viewer"
              >
                <img src={tok(byId.get('inspection-comps_map')!.viewUrl)} alt="LandPortal Show on Map comparables" />
              </button>
              <figcaption class="cap"><span>Show on Map comparable page</span></figcaption>
            </figure>
          ) : (
            <div class="awv2-pi-note">No Show on Map capture is on file.</div>
          )}
        </section>
      </div>

      {/* Evidence / unresolved diligence: delivery is not the same as resolution. */}
      {researchStatus && (
        <section class="awv2-panel awv2-research-status" id="research-status">
          <div class="awv2-panel-title">Research status</div>
          <div class="awv2-research-counts">
            <div><span>Research lanes completed</span><b>{researchStatus.delivered} / {researchStatus.total}</b></div>
            <div><span>Diligence questions resolved</span><b>{researchStatus.questionsResolved != null ? `${researchStatus.questionsResolved}${researchStatus.questionsTotal != null ? ` / ${researchStatus.questionsTotal}` : ''}` : 'Tracked separately'}</b></div>
          </div>
          <div class="awv2-pi-note">Completed research means the lane delivered its current evidence; it does not mean every diligence question is resolved.</div>
          <details class="awv2-collapse awv2-pi-diagnostics">
            <summary>Lane delivery details</summary>
            {researchStatus.areas.map((area) => <div class="awv2-pi-note"><b>{area.label}:</b> {area.status}{area.reason ? ` · ${area.reason}` : ''}{area.nextAction ? ` · Next: ${area.nextAction}` : ''}</div>)}
          </details>
        </section>
      )}

      {/* ── Missing diligence: reconciled operator checklist ── */}
      {missingDiligence ? (
        <section class="awv2-missing">
          <div class="awv2-panel-title">
            Missing diligence <span class="awv2-src-tag">Reconciled against accepted research</span>
          </div>
          <div class="awv2-md-list">
            {/* Compact, collapsed by default: name + status + short next action.
                Expanding a row reveals the full reconciled record. The most
                urgent items are visually prominent but stay collapsed. */}
            {missingDiligence.items.map((item) => (
              <details class={`awv2-md-row${item.urgent ? ' urgent' : ''}`}>
                <summary>
                  <span class="t">{item.label}</span>
                  <span class="st">{item.shortStatus || item.currentFinding.slice(0, 64)}</span>
                  <span class="nx">{item.shortNext ? `Next: ${item.shortNext}` : ''}</span>
                </summary>
                <div class="awv2-md-detail">
                  <div class="row"><span class="k">Current finding</span><span class="v">{item.currentFinding}</span></div>
                  <div class="row"><span class="k">Still unresolved</span><span class="v">{item.stillUnresolved}</span></div>
                  <div class="row"><span class="k">Why it matters</span><span class="v">{item.whyItMatters}</span></div>
                  <div class="row"><span class="k">Next source</span><span class="v">{item.nextSource}</span></div>
                </div>
              </details>
            ))}
          </div>
          {missingDiligence.evidenceGaps.length > 0 && (
            <div class="awv2-missing-chips" style="margin-top:12px">
              {missingDiligence.evidenceGaps.map((m) => <span class="awv2-chip">{m}</span>)}
            </div>
          )}
          {missingDiligence.passthrough.length > 0 && (
            <ul class="awv2-missing-lines">
              {missingDiligence.passthrough.map((m) => <li>{m}</li>)}
            </ul>
          )}
        </section>
      ) : (() => {
        const uniqueMissing = [...new Set(missing)];
        const shortMissing = uniqueMissing.filter((m) => m.length <= 64);
        const longMissing = uniqueMissing.filter((m) => m.length > 64);
        return (
          <section class="awv2-missing">
            <div class="awv2-panel-title">Missing diligence</div>
            <div class="awv2-missing-chips">
              {shortMissing.map((m) => <span class="awv2-chip">{m}</span>)}
            </div>
            {longMissing.length > 0 && (
              <ul class="awv2-missing-lines">
                {longMissing.map((m) => <li>{m}</li>)}
              </ul>
            )}
          </section>
        );
      })()}

      {viewerIndex != null && gallery[viewerIndex] && (
        <EvidenceViewer
          items={gallery}
          index={viewerIndex}
          onNavigate={(next) => setViewerIndex(next)}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}

// ── Same-page evidence viewer ──────────────────────────────────────────
//
// A large in-page lightbox over the workspace: largest retained image at
// natural aspect ratio, zoom in/out/reset, wheel zoom, pointer panning,
// previous/next, category + caption + source, close button and Escape.
// No navigation away, no new tab, no external image library.

const VIEWER_MIN_SCALE = 1;
const VIEWER_MAX_SCALE = 8;
const VIEWER_STEP = 1.4;

function EvidenceViewer({ items, index, onNavigate, onClose }: {
  items: PiEvidenceItem[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Live index for the once-registered keydown listener: rapid successive
  // presses must never hit a stale closure between effect flushes.
  const indexRef = useRef(index);
  indexRef.current = index;

  const clampScale = (value: number) => Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, value));
  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const zoomIn = () => setScale((s) => clampScale(s * VIEWER_STEP));
  const zoomOut = () => setScale((s) => {
    const next = clampScale(s / VIEWER_STEP);
    if (next === VIEWER_MIN_SCALE) setOffset({ x: 0, y: 0 });
    return next;
  });
  const prev = () => { resetView(); onNavigate((indexRef.current - 1 + items.length) % items.length); };
  const next = () => { resetView(); onNavigate((indexRef.current + 1) % items.length); };

  // Keyboard: Escape closes; arrows navigate. Focus starts on the close
  // control so keyboard users are inside the dialog immediately. The page
  // behind the modal stays scroll-locked while the viewer is open.
  useEffect(() => {
    closeRef.current?.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); resetView(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = priorOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  };
  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.baseX + (e.clientX - drag.current.startX),
      y: drag.current.baseY + (e.clientY - drag.current.startY),
    });
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div class="awv2-viewer" role="dialog" aria-modal="true" aria-label={`Evidence viewer: ${item.label}`}>
      <div class="awv2-viewer-backdrop" onClick={onClose} />
      <div class="awv2-viewer-body">
        <div
          class={`awv2-viewer-stage${scale > 1 ? ' zoomed' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={tok(item.viewUrl)}
            alt={item.label}
            draggable={false}
            style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${scale});`}
          />
        </div>

        <div class="awv2-viewer-meta">
          {item.kind && <span class="cat">{item.kind}</span>}
          <span class="cap">{item.label}</span>
          <span class="src">
            {item.sourceType || 'LandPortal · verified subject'}
            {item.sourceUrl ? (
              <>
                {' · '}
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">source</a>
              </>
            ) : null}
          </span>
          <span class="pos">{index + 1} / {items.length}</span>
        </div>

        <div class="awv2-viewer-controls" role="toolbar" aria-label="Evidence viewer controls">
          <button type="button" onClick={prev} title="Previous image (←)" aria-label="Previous image"><ChevronLeft size={18} /></button>
          <button type="button" onClick={zoomOut} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={18} /></button>
          <button type="button" onClick={resetView} title="Reset to fit (0)" aria-label="Reset to fit"><Maximize2 size={18} /></button>
          <button type="button" onClick={zoomIn} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={18} /></button>
          <button type="button" onClick={next} title="Next image (→)" aria-label="Next image"><ChevronRight size={18} /></button>
        </div>

        <button ref={closeRef} type="button" class="awv2-viewer-close" onClick={onClose} title="Close (Esc)" aria-label="Close evidence viewer">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
