// Acquisition Workspace V2 — Pre-Discovery Overview (/dept/acquisitions/v2).
//
// A CRM-style opportunity record for one seller lead + one subject property,
// rendered entirely from the existing canonical read APIs:
//   GET /api/landos/deal-cards/:id                        (deal + property card)
//   GET /api/landos/deal-cards/:id/property-intelligence  (snapshot projection)
//   GET /api/landos/deal-cards/:id/acquisition            (stage + next action)
//   GET /api/landos/deal-cards/:id/activity               (last activity)
//   GET /api/landos/deal-cards/:id/acquisition-intelligence (persisted read)
//
// This route is separate from the existing Deal Card and changes no backend
// behavior. Values missing from the current data interfaces render as missing;
// nothing is fabricated. The page owns loading, record identity, and section
// navigation; each of the three built sections owns its operator presentation.
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import {
  Phone, MessageSquare, Mail, StickyNote, ListPlus, Pencil, ExternalLink,
  LayoutDashboard, Map, UserRound, CalendarClock, Users, FileDown,
  LineChart, Scale, Target, FolderOpen,
} from 'lucide-preact';
import { apiGet, apiPost, chatId, legacyUrl } from '@/lib/api';
import { countyLabel } from '@/lib/format';
import {
  readPage, pageHref, rememberWorkspaceDeal, lastWorkspaceDealId,
  DEAL_PAGES, type WorkspaceV2Page,
} from '@/lib/workspace-v2-nav';
import {
  createDealWorkspaceExecutor, registerDealWorkspaceBridge, unregisterDealWorkspaceBridge,
  type DealWorkspaceBridge,
} from '@/lib/deal-workspace-actions';
import {
  PropertyIntelligenceSection, MarketIntelligencePanel,
  type MarketContextView, type PiCompRow,
  type SoilDetail, type BrowseruseResp, type StreetViewView, type VisualBuyerAnalysisView,
  type MissingDiligenceView, type AccessPresentationView, type SoilsSepticView,
  type ExactAddressListingsView,
  type VisualBuyerNarrativeView, type ResearchStatusView, type ParcelFactSheetView, type TaxStatusView,
} from '../components/AcquisitionWorkspaceV2PropertyIntelligence';
import { ParcelScopePanel, type ParcelScopeView } from '@/components/DealCard';
import {
  CompsValuationSection, type CompsValuationViewData,
} from '../components/AcquisitionWorkspaceV2CompsValuation';
import { PropertyIntelligenceRunStatus } from '../components/AcquisitionWorkspaceV2RunStatus';
import { NapkinUnderwriting } from '../components/AcquisitionWorkspaceV2Napkin';
import {
  OverviewSection, type OverviewSnapshotView,
} from '../components/AcquisitionWorkspaceV2Overview';
import type {
  AcquisitionIntelligenceView,
  AcquisitionIntelligenceReadiness,
  AcquisitionIntelligenceRuntimeStatus,
} from '../components/AcquisitionWorkspaceV2AcquisitionIntelligence';
import type {
  DealBrainThreadEntry,
  IntelligenceScoresView,
  QuickFlipScreenView,
  SellerIntelligenceView,
} from '../components/AcquisitionWorkspaceV2IntelligenceStack';
import {
  PropertyReadCard, MarketReadCard,
  type AcreageExtentView,
  type IntelligenceReconciliationView,
  type MarketIntelligenceReadView,
  type PropertyIntelligenceReadView,
  type ReconcileEligibleView,
  type SellerIntelligenceReadView,
  type SpecialistStaleView,
} from '../components/AcquisitionWorkspaceV2SpecialistReads';
import type { ResearchReadinessManifestView } from '../components/AcquisitionWorkspaceV2ResearchReadiness';
import type { OfficialParcelGisView } from '../components/AcquisitionWorkspaceV2OfficialParcelGis';
import type { DealBrainStrategyFit } from '../lib/napkin-underwriting';
import type { LandUseView, RetainedLandUseIntelligenceView } from '../components/AcquisitionWorkspaceV2LandUse';
import '../styles/workspace-v2.css';
// Loaded AFTER the base sheet: the comps identity + readability corrections
// deliberately override base values on equal specificity.
import '../styles/workspace-v2-comps.css';
// Loaded LAST: the lead-card design system (domain color coding, legend rail,
// type scale). Future sections inherit this layer.
import '../styles/workspace-v2-lead-design.css';

// ── Minimal read-model types (fields this view consumes) ───────────────

/** The server's derived read of the evidence this Deal already retained. */
type EvidenceAcreageView = {
  entries: Array<{ acres: number; basis: string; label: string; source: string }>;
  workingAcres: number | null; workingBasis: string | null; reason: string; bothLegitimate: boolean;
};

interface EvidenceInterpretationView {
  groups: Array<{ kind: string; label: string; artifactIds: number[]; pageCount: number }>;
  claims: Array<{
    field: string; label: string; value: string; relation: string; parcelRelationship: string;
    reason: string; provenance: { artifactId: number; fileName: string; pageLabel: string };
  }>;
  unreadable: Array<{ artifactId: number; fileName: string; reason: string }>;
  acreage: EvidenceAcreageView | null;
  boundary: {
    surveyedRoadFacingFeet: number | null; roadFeature: string | null;
    providerFrontageFeet: number | null; providerFrontageLabel: string | null;
    longestSideDepthFeet: number | null; reason: string;
  } | null;
  narrative: string;
  satisfiedFields: string[];
  relatedParcelReferences: Array<{ artifactId: number; statedApn: string; relationship: string; pageLabel: string }>;
}

interface DdItem {
  key: string; label: string; verdict: string; headline: string; detail?: string;
  missing?: string[];
}
/** The Deal Intelligence product: the evolved Acquisition Intelligence read
 *  plus the stack fields (scores, quick flip, phase, what changed). */
type DealIntelligenceView = AcquisitionIntelligenceView & {
  phase?: string;
  scores?: IntelligenceScoresView;
  reads?: { property?: string | null; market?: string | null; seller?: string | null };
  quickFlip?: QuickFlipScreenView;
  sellerPriceVerdict?: { verdict?: string | null } | null;
  discoveryCallObjective?: string | null;
  negotiationPosture?: string | null;
  whatChanged?: string[];
  guidanceConsidered?: string[];
};

interface IntelligenceStackResp {
  products?: {
    property?: PropertyIntelligenceReadView | null;
    market?: MarketIntelligenceReadView | null;
    seller?: (SellerIntelligenceView & SellerIntelligenceReadView) | null;
    deal?: DealIntelligenceView | null;
  };
  stale?: { property?: boolean; market?: boolean; seller?: boolean; deal?: boolean };
  quickFlip?: QuickFlipScreenView | null;
  phase?: string | null;
  sellerEstablished?: boolean;
  /** Persisted Deal Brain strategy assessments from the retained current
   *  snapshot — served even while the deal read is staleness-hidden, so the
   *  deterministic napkin projection can consume persisted strategy truth. */
  persistedDealStrategies?: {
    strategies?: DealBrainStrategyFit[];
    bestCurrentStrategy?: { strategy?: string; why?: string | null } | null;
    stale?: boolean;
  } | null;
  sufficiency?: { ok?: boolean; reason?: string | null } | null;
  guidance?: DealBrainThreadEntry[];
  runtime?: AcquisitionIntelligenceRuntimeStatus | null;
  /** Present while a coordinated intelligence run is in flight. */
  run?: { startedAt?: string; error?: string | null } | null;
  dealBrainRun?: { startedAt?: string; error?: string | null } | null;
  /** The persisted bounded reconciliation record plus in-flight state and the
   *  conflicts the seam could act on. SELECT-only projection. */
  reconciliation?: IntelligenceReconciliationView | null;
  reconcileRun?: { startedAt?: string; error?: string | null } | null;
  reconcileEligible?: ReconcileEligibleView[];
  /** Official acreage / parcel-extent reconciliation. SELECT-only projection. */
  acreageExtent?: AcreageExtentView | null;
  acreageExtentRun?: { startedAt?: string; error?: string | null } | null;
}

const PHASE_LABEL: Record<string, string> = {
  pre_call: 'Pre-call',
  post_discovery: 'Post-discovery',
  underwriting: 'Underwriting',
  offer: 'Offer',
  under_contract: 'Under contract',
};
interface SnapshotView extends OverviewSnapshotView {
  status?: string;
  dueDiligence?: DdItem[];
  valuation?: {
    priceable?: boolean; pricePerAcreRange?: { low: number; high: number } | null;
    basis?: string; primaryBasis?: string; confidence?: string;
    notPriceableReason?: string; nextActionToPrice?: string;
  };
  headline?: { keyOpportunity?: string; topRisks?: string[]; confidence?: string; confidenceWhy?: string };
  blockers?: string[];
  nextActions?: string[];
  // `strategies` and `recommendation` are declared once, on OverviewSnapshotView,
  // and inherited here. Redeclaring them narrower is what kept the strategy
  // lane's assessed exits out of the view model in the first place.
  comps?: {
    sold?: PiCompRow[]; active?: PiCompRow[]; askingReferences?: PiCompRow[]; summaryLine?: string;
    conclusion?: string; landPortalRowsSeen?: number; totalCollected?: number; duplicatesMerged?: number;
  };
  missingInformation?: unknown[];
}
interface DealResp {
  parcelScope?: ParcelScopeView | null;
  dealCard?: {
    id: number; title?: string; asking_price?: number | null;
    people?: { name?: string; phone?: string; email?: string }[];
    propertyCards?: { id: number; owner?: string; county?: string; state?: string; zip?: string; acres?: number | null; apn?: string }[];
  };
}
interface AcqResp {
  stageLabel?: string;
  acquisition?: {
    stage?: string;
    profile?: { name?: string; phone?: string; email?: string; nextFollowUpDate?: string };
    commLog?: unknown[];
    discovery?: unknown[];
  };
  nextAction?: { label?: string; reason?: string };
}
interface ActivityResp { events?: { kind: string; summary: string; createdAt: number }[] }
interface IntelResp {
  propertyIntelligence?: {
    snapshot?: SnapshotView;
    streetView?: StreetViewView | null;
    visualBuyerAnalysis?: VisualBuyerAnalysisView | null;
    visualBuyerNarrative?: VisualBuyerNarrativeView | null;
    missingDiligence?: MissingDiligenceView | null;
    access?: AccessPresentationView | null;
    soilsSeptic?: SoilsSepticView | null;
    researchStatus?: ResearchStatusView | null;
    compsValuation?: CompsValuationViewData | null;
    officialParcelGis?: OfficialParcelGisView | null;
    landUse?: LandUseView | null;
    landUseIntelligence?: RetainedLandUseIntelligenceView | null;
    exactAddressListings?: ExactAddressListingsView | null;
    landPortalFacts?: ParcelFactSheetView | null;
    taxStatus?: TaxStatusView | null;
    evidenceAcreage?: EvidenceAcreageView | null;
  };
  marketContext?: MarketContextView;
  landPortalFacts?: ParcelFactSheetView | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

const tok = (u: string) => u;
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const matchNum = (s: string | undefined, re: RegExp): string | null => {
  const m = s ? s.match(re) : null;
  return m ? m[1] : null;
};

// Deal sidebar: icon + domain swatch per page (see workspace-v2-lead-design.css
// and workspace-v2-deal-nav.css). This is the deal-contextual navigation, NOT
// the main LandOS department sidebar.
const PAGE_ICONS: Record<WorkspaceV2Page, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  property: Map,
  market: LineChart,
  comps: Scale,
  strategy: Target,
  seller: UserRound,
  documents: FolderOpen,
};
const PAGE_DOMAINS: Record<WorkspaceV2Page, string> = {
  overview: 'action',
  property: 'property',
  market: 'market',
  comps: 'valuation',
  strategy: 'strategy',
  seller: 'action',
  documents: 'evidence',
};

// The acquisition lifecycle this workspace will grow through. "New lead" is
// what the record reports today; the ribbon shows where that sits.
const LIFECYCLE = ['New Lead', 'Pre-Discovery', 'Post-Discovery', 'Underwriting', 'Offer Ready', 'Under Contract', 'Closed'];

function activityLabel(kind: string, summary: string): string {
  if (kind === 'property_inspection') return 'Inspection imagery captured';
  return summary;
}

// ── Page ───────────────────────────────────────────────────────────────

export function AcquisitionWorkspaceV2() {
  const [, navigate] = useLocation();
  // The record identity comes from ?deal=; without it, fall back to the deal
  // most recently worked this session. With neither, this workspace has no
  // identified record — never render an unidentified one; go pick from the
  // pipeline instead.
  const dealId = (() => {
    const q = new URLSearchParams(window.location.search).get('deal');
    const n = Number(q);
    if (Number.isInteger(n) && n > 0) return n;
    return lastWorkspaceDealId();
  })();
  useEffect(() => {
    if (dealId == null) { navigate('/dept/acquisitions', { replace: true }); return; }
    // Canonicalize a session-restored deal into the URL so refresh and
    // share/bookmark keep the exact record.
    const q = new URLSearchParams(window.location.search);
    if (q.get('deal') !== String(dealId)) {
      q.set('deal', String(dealId));
      window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
    }
  }, [dealId]);
  // Section switching is client-side: the record below is loaded once and
  // reused across sections, so a tab change never reloads the document,
  // refetches the property record, or reruns research. pushState keeps the
  // URL shareable and back/forward working; popstate re-derives the section.
  const [page, setPage] = useState<WorkspaceV2Page>(() => readPage(window.location.search));
  const syncNavFromUrl = () => {
    setPage(readPage(window.location.search));
  };
  useEffect(() => {
    const onPop = () => syncNavFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // The ONE canonical client-side page navigation: sidebar clicks and the
  // deal-workspace action layer both resolve here so the two paths can never
  // evolve independently. pushState only — no reload, no refetch, no research.
  const navigateToPage = (slug: string) => {
    const href = pageHref(window.location.pathname, window.location.search, slug);
    if (href !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', href);
    }
    syncNavFromUrl();
  };
  const switchPage = (e: MouseEvent, slug: string) => {
    // Let modified clicks (new tab, etc.) behave like normal links.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateToPage(slug);
  };

  // Deal Workspace Action Layer V1: expose the deterministic read/execute
  // bridge for the future Deal Brain / Max control layer. Context is derived
  // from the live URL so it is always sync-correct after navigation.
  useEffect(() => {
    if (dealId == null) return;
    const getContext = () => ({ dealId, currentPage: readPage(window.location.search) });
    const bridge: DealWorkspaceBridge = {
      getContext,
      executeAction: createDealWorkspaceExecutor({
        getContext,
        navigateToPage: (page) => navigateToPage(page),
      }),
    };
    registerDealWorkspaceBridge(bridge);
    return () => unregisterDealWorkspaceBridge(bridge);
  }, [dealId]);

  // Remember the deal + section the operator is using so every "back to the
  // workspace" path this session restores this exact record and section.
  useEffect(() => {
    if (dealId != null) rememberWorkspaceDeal(dealId, page);
  }, [page, dealId]);

  const [deal, setDeal] = useState<DealResp | null>(null);
  const [market, setMarket] = useState<MarketContextView | null>(null);
  const [snapState, setSnap] = useState<SnapshotView | null>(null);
  const [acq, setAcq] = useState<AcqResp | null>(null);
  const [activity, setActivity] = useState<ActivityResp | null>(null);
  const [soils, setSoils] = useState<SoilDetail[] | null>(null);
  const [streetView, setStreetView] = useState<StreetViewView | null>(null);
  const [vba, setVba] = useState<VisualBuyerAnalysisView | null>(null);
  const [narrative, setNarrative] = useState<VisualBuyerNarrativeView | null>(null);
  const [missingDiligence, setMissingDiligence] = useState<MissingDiligenceView | null>(null);
  const [accessView, setAccessView] = useState<AccessPresentationView | null>(null);
  const [soilsSeptic, setSoilsSeptic] = useState<SoilsSepticView | null>(null);
  const [officialParcelGis, setOfficialParcelGis] = useState<OfficialParcelGisView | null>(null);
  const [landUse, setLandUse] = useState<LandUseView | null>(null);
  const [landUseIntelligence, setLandUseIntelligence] = useState<RetainedLandUseIntelligenceView | null>(null);
  const [exactAddressListings, setExactAddressListings] = useState<ExactAddressListingsView | null>(null);
  const [researchStatus, setResearchStatus] = useState<ResearchStatusView | null>(null);
  const [compsValuation, setCompsValuation] = useState<CompsValuationViewData | null>(null);
  // The canonical retained LandPortal parcel fact sheet. The API has always
  // projected it; nothing passed it to the panels that display those exact
  // fields, so they fell back to a two-key discovery subset of it.
  const [landPortalFacts, setLandPortalFacts] = useState<ParcelFactSheetView | null>(null);
  // Every operator/seller upload retained on this Deal, from the same store
  // Smart Intake writes. A read-only listing: opening Documents & Uploads runs
  // no research and re-reads no artifact.
  const [dealUploads, setDealUploads] = useState<Array<{
    id?: number; title?: string; fileName?: string; mimeType?: string; docType?: string; uploadedAt?: string;
  }>>([]);
  // What those retained uploads actually SAY. Derived server-side from the
  // extractions already on the artifacts, so this fetch runs no research, calls
  // no model, and re-reads no file — which is why a hard refresh reproduces the
  // same grouping, claims and provenance rather than losing them.
  const [evidenceRead, setEvidenceRead] = useState<EvidenceInterpretationView | null>(null);
  // The reconciled acreage as it arrives on the FIRST read, before the deeper
  // evidence projection lands. Same server-side answer, same shape; holding it
  // separately is what keeps the header from painting the GIS figure first.
  const [firstPaintAcreage, setFirstPaintAcreage] = useState<EvidenceAcreageView | null>(null);
  // Property-tax payment status, answered by the collecting office rather than
  // the assessor. Without it the panel could only ever say "not screened".
  const [taxStatus, setTaxStatus] = useState<TaxStatusView | null>(null);
  // Acquisition Intelligence. The read is FETCHED, never generated on render:
  // opening or reloading a Deal Card must not start a reasoning run, so the
  // only thing that produces a new read is the operator pressing refresh.
  const [aiRead, setAiRead] = useState<DealIntelligenceView | null>(null);
  // Persisted strategy truth for the napkin projection: survives the
  // staleness-hiding of the operator deal read (the persisted snapshot is
  // still the retained current strategy assessment).
  const [persistedDealStrategies, setPersistedDealStrategies] = useState<IntelligenceStackResp['persistedDealStrategies']>(null);
  const [aiReadiness, setAiReadiness] = useState<AcquisitionIntelligenceReadiness | null>(null);
  const [aiRuntime, setAiRuntime] = useState<AcquisitionIntelligenceRuntimeStatus | null>(null);
  const [aiStale, setAiStale] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The rest of the Intelligence Stack: live quick-flip economics, seller
  // product, phase and the Deal Brain conversation. All fetched, never
  // generated on render.
  const [intelQuickFlip, setIntelQuickFlip] = useState<QuickFlipScreenView | null>(null);
  const [intelPhase, setIntelPhase] = useState<string | null>(null);
  const [sellerIntel, setSellerIntel] = useState<(SellerIntelligenceView & SellerIntelligenceReadView) | null>(null);
  // The persisted Property and Market specialist products plus the per-layer
  // staleness map. Fetched with the rest of the stack; rendering runs nothing.
  const [propertyIntelRead, setPropertyIntelRead] = useState<PropertyIntelligenceReadView | null>(null);
  const [marketIntelRead, setMarketIntelRead] = useState<MarketIntelligenceReadView | null>(null);
  const [specialistStale, setSpecialistStale] = useState<SpecialistStaleView | null>(null);
  // The bounded intelligence → capability → reconciliation state. Fetched and
  // persisted server-side; only the explicit Verify action starts a run.
  const [reconciliation, setReconciliation] = useState<IntelligenceReconciliationView | null>(null);
  const [reconcileEligible, setReconcileEligible] = useState<ReconcileEligibleView[]>([]);
  const [reconcileRunning, setReconcileRunning] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  // Official acreage / parcel-extent reconciliation. Fetched and persisted
  // server-side; only the explicit Reconcile action starts the bounded run.
  const [acreageExtent, setAcreageExtent] = useState<AcreageExtentView | null>(null);
  const [acreageRunning, setAcreageRunning] = useState(false);
  const [acreageError, setAcreageError] = useState<string | null>(null);
  const [acreageResolvingDependents, setAcreageResolvingDependents] = useState(false);
  const [dealBrainThread, setDealBrainThread] = useState<DealBrainThreadEntry[]>([]);
  const [dealBrainRunning, setDealBrainRunning] = useState(false);
  const [dealBrainError, setDealBrainError] = useState<string | null>(null);
  // Research readiness. The manifest is RECONCILED on the server from retained
  // state and only fetched here: opening or reloading the card runs no research
  // at all. The backfill control below is the only thing that does.
  const [readiness, setReadiness] = useState<ResearchReadinessManifestView | null>(null);
  const [readinessRunning, setReadinessRunning] = useState<string[] | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warRoomBusy, setWarRoomBusy] = useState(false);
  // Bumped when a research run settles, so the workspace re-reads the records
  // that run just rewrote instead of showing the operator a stale page next to
  // a "research complete" indicator.
  const [reloadNonce, setReloadNonce] = useState(0);
  // The retained subject parcel ring for the hero's aerial map mode. A read of
  // already-persisted geometry via the existing comp-map projection; fetching
  // it runs no research, no enrichment, and no model.
  const [subjectPolygon, setSubjectPolygon] = useState<Array<{ lat: number; lng: number }> | null>(null);

  useEffect(() => {
    if (dealId == null) return undefined;
    let dead = false;
    (async () => {
      const resp = await apiGet<{ compMap?: { subject?: { polygon?: Array<{ lat: number; lng: number }> | null } } }>(
        `/api/landos/deal-cards/${dealId}/comp-map`,
      ).catch(() => null);
      if (dead) return;
      const ring = resp?.compMap?.subject?.polygon ?? null;
      setSubjectPolygon(ring && ring.length >= 3 ? ring : null);
    })();
    return () => { dead = true; };
  }, [dealId]);

  useEffect(() => {
    if (dealId == null) return;
    let dead = false;
    (async () => {
      try {
        const [d, i, a, act, bu] = await Promise.all([
          apiGet<DealResp>(`/api/landos/deal-cards/${dealId}`),
          apiGet<IntelResp>(`/api/landos/deal-cards/${dealId}/property-intelligence?view=workspace-v2`),
          apiGet<AcqResp>(`/api/landos/deal-cards/${dealId}/acquisition?view=workspace-v2-overview`).catch(() => null),
          apiGet<ActivityResp>(`/api/landos/deal-cards/${dealId}/activity`).catch(() => null),
          apiGet<BrowseruseResp>(`/api/landos/deal-cards/${dealId}/browseruse`).catch(() => null),
        ]);
        if (dead) return;
        setDeal(d); setSnap(i?.propertyIntelligence?.snapshot ?? null); setMarket(i?.marketContext ?? null); setAcq(a); setActivity(act);
        setSoils(bu?.soilDetails ?? null);
        setStreetView(i?.propertyIntelligence?.streetView ?? null);
        setVba(i?.propertyIntelligence?.visualBuyerAnalysis ?? null);
        setNarrative(i?.propertyIntelligence?.visualBuyerNarrative ?? null);
        setMissingDiligence(i?.propertyIntelligence?.missingDiligence ?? null);
        setAccessView(i?.propertyIntelligence?.access ?? null);
        setSoilsSeptic(i?.propertyIntelligence?.soilsSeptic ?? null);
        setOfficialParcelGis(i?.propertyIntelligence?.officialParcelGis ?? null);
        setLandUse(i?.propertyIntelligence?.landUse ?? null);
        setLandUseIntelligence(i?.propertyIntelligence?.landUseIntelligence ?? null);
        setExactAddressListings(i?.propertyIntelligence?.exactAddressListings ?? null);
        setResearchStatus(i?.propertyIntelligence?.researchStatus ?? null);
        setCompsValuation(i?.propertyIntelligence?.compsValuation ?? null);
        setLandPortalFacts(i?.propertyIntelligence?.landPortalFacts ?? i?.landPortalFacts ?? null);
        setTaxStatus(i?.propertyIntelligence?.taxStatus ?? null);
        setFirstPaintAcreage(i?.propertyIntelligence?.evidenceAcreage ?? null);
        // Overview is usable from the canonical Deal, Property and Acquisition
        // reads above. Research Readiness and the specialist stack are
        // secondary persisted projections; let them hydrate immediately after
        // first paint instead of keeping the entire workspace behind their
        // expensive staleness/read-model rebuilds.
        setLoading(false);
        const [rr, ai, up, ev] = await Promise.all([
          apiGet<{ manifest?: ResearchReadinessManifestView }>(
            `/api/landos/deal-cards/${dealId}/research-readiness`,
          ).catch(() => null),
          apiGet<IntelligenceStackResp>(`/api/landos/deal-cards/${dealId}/intelligence`).catch(() => null),
          apiGet<{ uploads?: Array<Record<string, unknown>> }>(
            `/api/landos/deal-cards/${dealId}/documents/uploads`,
          ).catch(() => null),
          apiGet<{ interpretation?: EvidenceInterpretationView }>(
            `/api/landos/deal-cards/${dealId}/evidence/interpretation`,
          ).catch(() => null),
        ]);
        if (dead) return;
        setDealUploads((up?.uploads ?? []) as typeof dealUploads);
        setEvidenceRead(ev?.interpretation ?? null);
        setReadiness(rr?.manifest ?? null);
        setAiRead(ai?.products?.deal ?? null);
        setPersistedDealStrategies(ai?.persistedDealStrategies ?? null);
        setAiReadiness(ai?.sufficiency ? { ok: ai.sufficiency.ok, reason: ai.sufficiency.reason } : null);
        setAiRuntime(ai?.runtime ?? null);
        setAiStale(ai?.stale?.deal === true);
        // A run started before this page load is still the operator's run:
        // reopening the card rejoins it rather than showing an idle section.
        setAiRunning(!!ai?.run && !ai.run.error);
        setAiError(ai?.run?.error ?? null);
        setIntelQuickFlip(ai?.quickFlip ?? ai?.products?.deal?.quickFlip ?? null);
        setIntelPhase(ai?.phase ?? ai?.products?.deal?.phase ?? null);
        setSellerIntel(ai?.products?.seller ?? null);
        setPropertyIntelRead(ai?.products?.property ?? null);
        setMarketIntelRead(ai?.products?.market ?? null);
        setSpecialistStale(ai?.stale ?? null);
        setReconciliation(ai?.reconciliation ?? null);
        setReconcileEligible(ai?.reconcileEligible ?? []);
        setReconcileRunning(!!ai?.reconcileRun && !ai.reconcileRun.error);
        setReconcileError(ai?.reconcileRun?.error ?? null);
        setAcreageExtent(ai?.acreageExtent ?? null);
        setAcreageRunning(!!ai?.acreageExtentRun && !ai.acreageExtentRun.error);
        setAcreageError(ai?.acreageExtentRun?.error ?? null);
        setDealBrainThread(ai?.guidance ?? []);
        setDealBrainRunning(!!ai?.dealBrainRun && !ai.dealBrainRun.error);
        setDealBrainError(ai?.dealBrainRun?.error ?? null);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [dealId, reloadNonce]);

  // Poll only while a read is actually being produced. Nothing here triggers a
  // reasoning run: this is the SELECT-only projection.
  useEffect(() => {
    if (dealId == null || !aiRunning) return undefined;
    let dead = false;
    const timer = window.setInterval(async () => {
      const ai = await apiGet<IntelligenceStackResp>(`/api/landos/deal-cards/${dealId}/intelligence`).catch(() => null);
      if (dead || !ai) return;
      setAiReadiness(ai.sufficiency ? { ok: ai.sufficiency.ok, reason: ai.sufficiency.reason } : null);
      setAiRuntime(ai.runtime ?? null);
      if (ai.run && !ai.run.error) return;
      setAiRunning(false);
      setAiRead(ai.products?.deal ?? null);
      setPersistedDealStrategies(ai.persistedDealStrategies ?? null);
      setAiStale(ai.stale?.deal === true);
      setAiError(ai.run?.error ?? (ai.products?.deal ? null : 'The analyst did not produce a read for this property.'));
      setIntelQuickFlip(ai.quickFlip ?? ai.products?.deal?.quickFlip ?? null);
      setIntelPhase(ai.phase ?? ai.products?.deal?.phase ?? null);
      setSellerIntel(ai.products?.seller ?? null);
      setPropertyIntelRead(ai.products?.property ?? null);
      setMarketIntelRead(ai.products?.market ?? null);
      setSpecialistStale(ai.stale ?? null);
    }, 5_000);
    return () => { dead = true; window.clearInterval(timer); };
  }, [dealId, aiRunning]);

  // Poll only while a bounded reconciliation run is in flight. SELECT-only:
  // the poll never invokes a capability or a model — it just watches the one
  // explicit run finish and re-reads the persisted state it produced.
  useEffect(() => {
    if (dealId == null || !reconcileRunning) return undefined;
    let dead = false;
    const timer = window.setInterval(async () => {
      const ai = await apiGet<IntelligenceStackResp>(`/api/landos/deal-cards/${dealId}/intelligence`).catch(() => null);
      if (dead || !ai) return;
      if (ai.reconcileRun && !ai.reconcileRun.error) return;
      setReconcileRunning(false);
      setReconcileError(ai.reconcileRun?.error ?? null);
      setReconciliation(ai.reconciliation ?? null);
      setReconcileEligible(ai.reconcileEligible ?? []);
      setPropertyIntelRead(ai.products?.property ?? null);
      setAiRead(ai.products?.deal ?? null);
      setSpecialistStale(ai.stale ?? null);
      setAiStale(ai.stale?.deal === true);
    }, 5_000);
    return () => { dead = true; window.clearInterval(timer); };
  }, [dealId, reconcileRunning]);

  // Poll only while the bounded acreage reconciliation is in flight. SELECT-
  // only: the poll just watches the one explicit run finish and re-reads the
  // persisted record (and the possibly-updated deal identity) it produced.
  useEffect(() => {
    if (dealId == null || !acreageRunning) return undefined;
    let dead = false;
    const timer = window.setInterval(async () => {
      const ai = await apiGet<IntelligenceStackResp>(`/api/landos/deal-cards/${dealId}/intelligence`).catch(() => null);
      if (dead || !ai) return;
      if (ai.acreageExtentRun && !ai.acreageExtentRun.error) return;
      setAcreageRunning(false);
      setAcreageError(ai.acreageExtentRun?.error ?? null);
      setAcreageExtent(ai.acreageExtent ?? null);
      // A resolved adoption changed the property card acreage — re-read the
      // deal so the header shows the reconciled identity, not a stale one.
      setReloadNonce((n) => n + 1);
    }, 5_000);
    return () => { dead = true; window.clearInterval(timer); };
  }, [dealId, acreageRunning]);

  // Poll the Deal Brain conversation only while a reply is being produced.
  useEffect(() => {
    if (dealId == null || !dealBrainRunning) return undefined;
    let dead = false;
    const timer = window.setInterval(async () => {
      const resp = await apiGet<{ thread?: DealBrainThreadEntry[]; run?: { error?: string | null } | null }>(
        `/api/landos/deal-cards/${dealId}/deal-brain`,
      ).catch(() => null);
      if (dead || !resp) return;
      setDealBrainThread(resp.thread ?? []);
      if (resp.run && !resp.run.error) return;
      setDealBrainRunning(false);
      setDealBrainError(resp.run?.error ?? null);
    }, 4_000);
    return () => { dead = true; window.clearInterval(timer); };
  }, [dealId, dealBrainRunning]);

  if (dealId == null) return null;
  if (loading) return <div class="awv2"><div class="awv2-state">Loading the workspace…</div></div>;
  if ((error || !snapState) && !deal?.dealCard) {
    return (
      <div class="awv2">
        <div class="awv2-state">
          <div class="t">This workspace could not load</div>
          <div>{error || 'No property intelligence is available for this lead yet.'}</div>
        </div>
      </div>
    );
  }
  // A brand-new lead has its deal record but no property-intelligence snapshot
  // yet. The workspace still opens on that exact record and states plainly that
  // property identity resolution is pending; it fills in as research lands.
  const pendingResolution = !snapState;
  const snap: SnapshotView = snapState ?? {};

  // The ONLY path that engages the Acquisition Analyst. The analyst reasons
  // locally over the whole property file and inspects the retained imagery,
  // which takes minutes, so the POST just STARTS the run and the section polls
  // for the result. The operator can leave the page and come back to it.
  const runAcquisitionIntelligence = async () => {
    if (dealId == null || aiRunning) return;
    setAiRunning(true);
    setAiError(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/intelligence/run`, {});
    } catch (e) {
      setAiRunning(false);
      setAiError(e instanceof Error ? e.message : String(e));
    }
  };

  // The explicit bounded reconciliation action: the persisted material
  // conflict drives ONE allowlisted governed capability, then ONE targeted
  // Property re-read, then it STOPS. Nothing on page load reaches this.
  const runIntelligenceReconcile = async (conflictSubject?: string | null) => {
    if (dealId == null || reconcileRunning || aiRunning) return;
    setReconcileRunning(true);
    setReconcileError(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/intelligence/reconcile`, conflictSubject ? { conflictSubject } : {});
    } catch (e) {
      setReconcileRunning(false);
      setReconcileError(e instanceof Error ? e.message : String(e));
    }
  };

  // The explicit bounded acreage / parcel-extent reconciliation: reuse the
  // retained assessor record, one county-GIS parcel query, one assessment-
  // database family search, then STOP. Nothing on page load reaches this.
  const runAcreageReconcile = async () => {
    if (dealId == null || acreageRunning) return;
    setAcreageRunning(true);
    setAcreageError(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/acreage-extent/reconcile`, {});
    } catch (e) {
      setAcreageRunning(false);
      setAcreageError(e instanceof Error ? e.message : String(e));
    }
  };

  // The explicit bounded DETERMINISTIC resolution of the stale acreage-
  // dependent products: SELECTs plus one snapshot update; no providers, no
  // model calls, no rescaling. Synchronous — the updated record comes back.
  const runAcreageDependentResolve = async () => {
    if (dealId == null || acreageResolvingDependents) return;
    setAcreageResolvingDependents(true);
    setAcreageError(null);
    try {
      const result = await apiPost<{ acreageExtent?: AcreageExtentView | null }>(
        `/api/landos/deal-cards/${dealId}/acreage-extent/refresh-dependents`, {},
      );
      if (result?.acreageExtent !== undefined) setAcreageExtent(result.acreageExtent ?? null);
    } catch (e) {
      setAcreageError(e instanceof Error ? e.message : String(e));
    } finally {
      setAcreageResolvingDependents(false);
    }
  };

  // Ask the Deal Brain. The message is stored as deal-specific guidance and
  // the grounded reply arrives via the poll above.
  const askDealBrain = async (message: string) => {
    if (dealId == null || dealBrainRunning) return;
    setDealBrainRunning(true);
    setDealBrainError(null);
    setDealBrainThread((thread) => [...thread, { role: 'operator', text: message }]);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/deal-brain`, { message });
    } catch (e) {
      setDealBrainRunning(false);
      setDealBrainError(e instanceof Error ? e.message : String(e));
    }
  };

  // Targeted backfill. The manifest decides WHAT; the server's registered
  // capabilities decide HOW. With no ids this runs every red machine-resolvable
  // item and nothing else — never a full research cycle.
  const runResearchBackfill = async (itemIds?: string[]) => {
    if (dealId == null || readinessRunning) return;
    setReadinessRunning(itemIds ?? readiness?.backfillCandidates ?? []);
    setReadinessError(null);
    try {
      const report = await apiPost<{ after?: ResearchReadinessManifestView }>(
        `/api/landos/deal-cards/${dealId}/research-readiness/backfill`,
        itemIds ? { itemIds } : {},
      );
      if (report?.after) setReadiness(report.after);
      // A backfill rewrites the records the rest of the page reads.
      setReloadNonce((nonce) => nonce + 1);
    } catch (e) {
      setReadinessError(e instanceof Error ? e.message : String(e));
    } finally {
      setReadinessRunning(null);
    }
  };

  // ── View model, straight from canonical data ─────────────────────────
  const id = snap.identity || {};
  const card0 = deal?.dealCard?.propertyCards?.[0];
  // Primary visible label: the address when known; otherwise the best
  // available property identity (APN / owner / county+state) — never the
  // internal deal number.
  const bestIdentity = [
    (id.apn || card0?.apn) ? `APN ${id.apn || card0?.apn}` : '',
    id.owner || card0?.owner || '',
    [id.county || card0?.county, id.state_ || card0?.state].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ');
  const address = id.displayAddress || deal?.dealCard?.title || bestIdentity || 'Property identity pending';
  const addrParts = address.split(',');
  const street = addrParts[0]?.trim() || address;
  const locality = addrParts.slice(1).join(',').trim();
  const zip = matchNum(address, /\b(\d{5})\s*$/) || deal?.dealCard?.propertyCards?.[0]?.zip || '';
  const owner = id.owner || deal?.dealCard?.propertyCards?.[0]?.owner || '';
  // The reconciled canonical acreage governs the header when the official-
  // record reconciliation resolved it; the identity snapshot and property
  // card figures are the fallbacks (and converge with it after adoption).
  const acreageDecision = acreageExtent?.decision ?? null;
  const acreageResolved = acreageDecision?.status === 'resolved_current_canonical'
    || acreageDecision?.status === 'resolved_current_vs_historical_extent';
  // The reconciled working acreage is the shared answer: the same evidence
  // read Documents & Uploads shows, chosen by which basis measured the parcel
  // rather than by which surface asked. Taking the identity snapshot first is
  // what let the header report a GIS polygon area (1.846) while Documents
  // reported the surveyed 1.50 on the same Deal. This is a read of the
  // reconciliation, not a preference: no acreage is named here.
  const acres = (acreageResolved ? acreageDecision?.canonicalAcres : null)
    ?? evidenceRead?.acreage?.workingAcres
    // Present from the first read, so the header never shows the snapshot's
    // GIS acreage while the deeper evidence projection is still in flight.
    ?? firstPaintAcreage?.workingAcres
    ?? id.acres ?? deal?.dealCard?.propertyCards?.[0]?.acres ?? null;

  // Hero preference: widest capture that still reads as the parcel. The tight
  // close crop is LAST — it is the one most likely to clip a long/narrow
  // boundary, and a clipped subject boundary is never an acceptable hero.
  const heroUrl = (snap.evidence || []).find((e) => e.id === 'inspection-landportal_overview')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-parcel_context')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-clean_parcel_aerial')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-wider_context')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-close_parcel_aerial')?.viewUrl;
  const visualCount = (snap.evidence || []).filter((e) => e.viewUrl).length;
  // Every retained parcel/site inspection visual, widest context first, for
  // the hero switcher. Retained evidence only — no visual is ever fabricated.
  const HERO_VISUAL_ORDER = [
    'inspection-landportal_overview', 'inspection-parcel_context', 'inspection-clean_parcel_aerial',
    'inspection-wider_context', 'inspection-close_parcel_aerial',
  ];
  const heroVisuals = (snap.evidence || [])
    .filter((e) => e.viewUrl && e.id.startsWith('inspection-'))
    .slice()
    .sort((a, b) => {
      const ai = HERO_VISUAL_ORDER.indexOf(a.id); const bi = HERO_VISUAL_ORDER.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })
    .map((e) => ({ id: e.id, label: e.label || e.id.replace(/^inspection-/, '').replace(/_/g, ' '), viewUrl: tok(e.viewUrl) }))
    // One tab per distinct retained view: a run that captured several visuals
    // under the same label (e.g. repeated soil overlays) keeps its first.
    .filter((visual, index, all) => all.findIndex((other) => other.label.toLowerCase() === visual.label.toLowerCase()) === index);

  const stageLabel = acq?.stageLabel || 'New lead';
  const nextActionLabel = acq?.nextAction?.label
    || snap.operatorAnalysis?.canonical?.nextActions?.[0]
    || snap.operatorAnalysis?.overall?.nextBestActions?.[0]
    || '';
  const nextActionReason = acq?.nextAction?.reason || '';
  // Recomputed from current accepted research state (server re-derivation),
  // never a stale snapshot count; the exact incomplete area is named below.
  // "Research areas" = the accepted canonical research state. The run-status
  // strip separately reports lanes from the LAST RUN under its own distinct
  // label; the two are different measures and must never share a name.
  const followUp = acq?.acquisition?.profile?.nextFollowUpDate || null;

  // Seller identity belongs to the Acquisitions profile even when the Deal
  // Card has no duplicated person row. This does not manufacture seller
  // intelligence: the specialist layer independently remains pre-contact
  // until communication evidence exists.
  const acquisitionSeller = acq?.acquisition?.profile;
  const seller = acquisitionSeller?.name
    ? { name: acquisitionSeller.name, phone: acquisitionSeller.phone, email: acquisitionSeller.email }
    : deal?.dealCard?.people?.[0] || null;
  const askingPrice = deal?.dealCard?.asking_price ?? null;
  const cvSummary = compsValuation?.summary ?? null;
  const canonicalValuationSummary = cvSummary;
  const valuationBasisLabel = cvSummary ? cvSummary.basisLabel : null;
  const landBasisOpeningReference = cvSummary?.acquisitionLevels ? usd(cvSummary.acquisitionLevels.pct40) : null;
  const visualBuyerSummary = vba?.overviewSummary ? {
    physicalCharacter: vba.overviewSummary.physicalCharacter,
    mainBuyerAppeal: vba.overviewSummary.mainBuyerAppeal,
    topConcern: vba.overviewSummary.topConcern,
  } : null;
  const visualBuyerSummaryLabel = 'Visual buyer summary';
  const visualBuyerAnalysisLabel = 'Open the full Visual Buyer Analysis';
  // Plain text, not markup: JSX escapes strings, so an entity here renders
  // literally as "&amp;" to the operator.
  const openCompsValuationLabel = 'Open Comps & Valuation →';
  const onOpenSection = (slug: 'property-intelligence' | 'comps-valuation' | 'market') => {
    const target = slug === 'comps-valuation' ? 'comps' : slug === 'market' ? 'market' : 'property';
    const href = pageHref(window.location.pathname, window.location.search, target);
    if (href !== window.location.pathname + window.location.search) window.history.pushState(null, '', href);
    // Same contract as switchSection: BOTH the section and the inner view are
    // re-derived from the URL, or a jump between the two Property & Market
    // views rewrites the URL and renders nothing.
    syncNavFromUrl();
  };
  const openCompsValuation = () => onOpenSection('comps-valuation');

  // Enter the existing text War Room already scoped to THIS deal. The server
  // creates (or resumes) the deal's canonical meeting and the room opens with
  // the deal context injected — the operator never re-explains the property.
  const openWarRoom = async () => {
    if (warRoomBusy) return;
    setWarRoomBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; meetingId: string }>('/api/warroom/text/new', { chatId, dealCardId: dealId });
      window.location.href = legacyUrl(`/warroom/text?meetingId=${encodeURIComponent(res.meetingId)}&chatId=${encodeURIComponent(chatId)}`);
    } catch (e) {
      setWarRoomBusy(false);
      alert('War Room failed to open: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div class="awv2" data-testid="acquisition-workspace-root">
      {/* ── CRM header ── */}
      <header class="awv2-header">
        <div class="awv2-eyebrow awv2-eyebrow-row">
          <div class="awv2-crumb">
            <span>Acquisitions</span><span class="sep">/</span>
            <span class="brass">Workspace V2</span><span class="sep">/</span>
            <span>Deal {dealId}</span>
          </div>
          {/* ── Deal pages: the seven pages of THIS deal, horizontal in the
              header beside the deal crumb. Same routing, same selected-page
              state, same record identity on every link — only the placement
              changed, so the body reclaims the full page width. ── */}
          <nav class="awv2-deal-tabs" aria-label="Deal pages" data-testid="deal-sidebar">
            {DEAL_PAGES.map((entry) => {
              const Icon = PAGE_ICONS[entry.slug];
              return (
                <a
                  href={pageHref(window.location.pathname, window.location.search, entry.slug)}
                  class={page === entry.slug ? 'active' : ''}
                  aria-current={page === entry.slug ? 'page' : undefined}
                  data-domain={PAGE_DOMAINS[entry.slug]}
                  data-testid={`deal-nav-${entry.slug}`}
                  title={entry.hint}
                  onClick={(e) => switchPage(e as unknown as MouseEvent, entry.slug)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <b>{entry.label}</b>
                </a>
              );
            })}
          </nav>
        </div>

        <h1 class="awv2-address">
          {street}
          {locality && <span class="locality">, {locality}</span>}
        </h1>
        <div class="awv2-owner-line">
          <span>Owner of record <b>{owner || 'Unknown'}</b></span>
          {(id.apn || card0?.apn) && <span class="mono">APN {id.apn || card0?.apn}</span>}
          {acres != null && <span class="mono">{acres} AC</span>}
          {countyLabel(id.county, card0?.county) && <span class="mono">{(countyLabel(id.county, card0?.county) as string).toUpperCase()}, {id.state_ || ''}</span>}
        </div>

        {pendingResolution && (
          <div class="awv2-pending" role="status">
            Property identity resolution pending — research is still confirming this parcel.
            This workspace is the record's permanent home and fills in as accepted results land.
          </div>
        )}

        <div class="awv2-stages" role="list" aria-label="Acquisition lifecycle">
          {LIFECYCLE.map((s, i) => {
            const current = stageLabel.toLowerCase().replace(/[\s-]/g, '') === s.toLowerCase().replace(/[\s-]/g, '');
            return (
              <>
                {i > 0 && <span class="awv2-stage-arrow">›</span>}
                <span role="listitem" class={`awv2-stage${current ? ' current' : ''}`}>{s}</span>
              </>
            );
          })}
        </div>

        <div class="awv2-controls">
          <button type="button" class="awv2-ctl primary"><Phone size={14} /> Call</button>
          <button type="button" class="awv2-ctl"><MessageSquare size={14} /> Text</button>
          <button type="button" class="awv2-ctl"><Mail size={14} /> Email</button>
          <button type="button" class="awv2-ctl"><StickyNote size={14} /> Add note</button>
          <button type="button" class="awv2-ctl"><ListPlus size={14} /> Add task</button>
          <button type="button" class="awv2-ctl"><Pencil size={14} /> Edit</button>
          <a
            class="awv2-ctl"
            href={`/api/landos/deal-cards/${dealId}/report/download?format=pdf`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="property-intelligence-report-download"
            title="Download the current Property Intelligence report as PDF"
          >
            <FileDown size={14} /> Property Intelligence PDF
          </a>
          <button
            type="button"
            class="awv2-ctl"
            data-testid="open-war-room"
            onClick={openWarRoom}
            disabled={warRoomBusy}
            title="Open this deal's War Room — the agents enter already knowing this property"
          >
            <Users size={14} /> {warRoomBusy ? 'Opening…' : 'War Room'}
          </button>
          {/* Prefer the canonical verified parcel link; fall back to the
              operator's own retained LandPortal entry link. A Deal established
              from an operator-supplied LandPortal URL must be able to reopen
              it — requiring a `?property=` link to render a NAVIGATION button
              hid the operator's own link behind Smart Intake history. */}
          {(snap.subjectParcelUrl || snap.operatorParcelEntryUrl) && (
            <a
              class="awv2-ctl awv2-lp-link"
              href={snap.subjectParcelUrl || snap.operatorParcelEntryUrl!}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="view-in-landportal"
              title={snap.subjectParcelUrl
                ? 'Open the exact subject property in LandPortal (new tab)'
                : 'Open the LandPortal map you supplied for this deal (new tab). This link is an entry point, not verified parcel identity.'}
            >
              <ExternalLink size={14} /> View in LandPortal
            </a>
          )}
        </div>
      </header>

      <div class="awv2-body awv2-body-composed awv2-deal-layout">
        <div class="awv2-col">
        {/* Strategy & Underwriting opens with the deterministic Napkin
            Underwriting screen: Acquisition Napkin on the canonical supported
            FMV, then Strategy Napkins. Rendering runs no model or research. */}
        {page === 'strategy' && (
          <NapkinUnderwriting
            compsValuation={compsValuation}
            quickFlipScreen={intelQuickFlip}
            askingPrice={askingPrice}
            strategies={snap.strategies ?? null}
            dealBrainStrategies={persistedDealStrategies?.strategies ?? aiRead?.strategies ?? null}
            bestCurrentStrategy={persistedDealStrategies?.bestCurrentStrategy ?? aiRead?.bestCurrentStrategy ?? null}
            openCompsValuation={openCompsValuation}
          />
        )}
        {(page === 'overview' || page === 'property' || page === 'market' || page === 'strategy') && (
          <OverviewSection
            pageFilter={page}
            snap={snap}
            address={address}
            zip={zip}
            heroSrc={heroUrl ? tok(heroUrl) : null}
            heroVisuals={heroVisuals}
            subjectPolygon={subjectPolygon}
            topStrategy={persistedDealStrategies?.bestCurrentStrategy?.strategy ?? aiRead?.bestCurrentStrategy?.strategy ?? null}
            dealStrategies={persistedDealStrategies?.strategies ?? aiRead?.strategies ?? null}
            visualCount={visualCount}
            seller={seller}
            askingPrice={askingPrice}
            researchStatus={researchStatus}
            accessView={accessView}
            soilsSeptic={soilsSeptic}
            narrative={narrative}
            visualBuyerSummary={visualBuyerSummary}
            visualBuyerSummaryLabel={visualBuyerSummaryLabel}
            visualBuyerAnalysisLabel={visualBuyerAnalysisLabel}
            onOpenVisualBuyerAnalysis={(e) => switchPage(e as unknown as MouseEvent, 'property')}
            exactAddressListings={exactAddressListings}
            market={market}
            landPortalFacts={landPortalFacts}
            landUseIntelligence={landUseIntelligence}
            acquisitionIntelligence={{
              read: aiRead,
              readiness: aiReadiness,
              runtime: aiRuntime,
              stale: aiStale,
              running: aiRunning,
              error: aiError,
              onRun: runAcquisitionIntelligence,
            }}
            intelligence={{
              scores: aiRead?.scores ?? null,
              quickFlip: intelQuickFlip,
              cashVerdict: aiRead?.sellerPriceVerdict?.verdict ?? null,
              phaseLabel: intelPhase ? PHASE_LABEL[intelPhase] ?? intelPhase : null,
              whatChanged: aiRead?.whatChanged ?? null,
            }}
            workingAcres={evidenceRead?.acreage?.workingAcres ?? firstPaintAcreage?.workingAcres ?? null}
            specialistReads={{
              property: propertyIntelRead,
              market: marketIntelRead,
              seller: sellerIntel,
              stale: specialistStale,
              reconcile: {
                record: reconciliation,
                eligible: reconcileEligible,
                running: reconcileRunning,
                error: reconcileError,
                onReconcile: runIntelligenceReconcile,
              },
              acreage: {
                record: acreageExtent,
                running: acreageRunning,
                error: acreageError,
                onReconcile: runAcreageReconcile,
                resolvingDependents: acreageResolvingDependents,
                onResolveDependents: runAcreageDependentResolve,
              },
            }}
            dealBrain={{
              thread: dealBrainThread,
              running: dealBrainRunning,
              error: dealBrainError,
              onAsk: askDealBrain,
            }}
            compsValuation={compsValuation}
            valuationBasisLabel={valuationBasisLabel}
            landBasisOpeningReference={landBasisOpeningReference}
            openCompsValuationLabel={openCompsValuationLabel}
            openCompsValuation={openCompsValuation}
            acquisitionNextAction={acq?.nextAction ?? null}
            researchReadiness={{
              manifest: readiness,
              loading,
              error: readinessError,
              running: readinessRunning,
              onBackfill: runResearchBackfill,
            }}
            formatUsd={usd}
            onOpenSection={onOpenSection}
          />
        )}
        {page === 'property' && (
          <main class="awv2-main awv2-property-market" data-testid="property-page">
            {/* Which parcel this Deal is actually buying, and which retained
                parcels belong to the sellers or to somebody else entirely. */}
            <ParcelScopePanel scope={deal?.parcelScope ?? null} />
            {/* The Property page owns the full Property Intelligence specialist
                read, including the complete persisted expert review. Rendering
                runs nothing — this is the same fetched product. */}
            {propertyIntelRead && (
              <section class="awv2-specialist-reads awv2-specialist-full" aria-label="Property Intelligence specialist read">
                {/* The Property page owns the conflict wall, the official-record
                    reconciliation controls and the acreage-extent record that
                    the Overview no longer prints. They are passed here, not
                    dropped. */}
                <PropertyReadCard
                  product={propertyIntelRead}
                  stale={specialistStale?.property === true}
                  full
                  reconcile={{
                    record: reconciliation,
                    eligible: reconcileEligible,
                    running: reconcileRunning,
                    error: reconcileError,
                    onReconcile: runIntelligenceReconcile,
                  }}
                  acreage={{
                    record: acreageExtent,
                    running: acreageRunning,
                    error: acreageError,
                    onReconcile: runAcreageReconcile,
                    resolvingDependents: acreageResolvingDependents,
                    onResolveDependents: runAcreageDependentResolve,
                  }}
                />
              </section>
            )}
            {/* Comparable evidence handoff: counts only — the named records
                live on the Comps & Valuation page. */}
            {compsValuation && (
              <section class="awv2-panel awv2-cv-handoff" data-domain="evidence" aria-label="Comparable evidence" data-testid="pi-comps-handoff">
                <div class="awv2-cv-handoffcounts">
                  <span><i>Retained comparables</i><b data-testid="pi-comps-handoff-retained">{compsValuation.canonicalCompCount ?? compsValuation.comps.length}</b></span>
                  <span><i>Strict FMV qualifying</i><b data-testid="pi-comps-handoff-qualifying">{compsValuation.summary.acceptedCount}</b></span>
                </div>
                <p class="awv2-pi-note">
                  Retained comparable evidence is not the same set as the sales allowed to price the subject. Every retained
                  candidate — core, directional and excluded alike — stays visible with its own reason on the comps page.
                </p>
                <button type="button" class="awv2-cv-cta" data-testid="pi-comps-handoff-open" onClick={openCompsValuation}>
                  View comps →
                </button>
              </section>
            )}
            <PropertyIntelligenceSection snap={snap} market={market} soils={soils} streetView={streetView} vba={vba} missingDiligence={missingDiligence} accessView={accessView} soilsSeptic={soilsSeptic} narrative={narrative} dealId={dealId} officialParcelGis={officialParcelGis} landUse={landUse} landUseIntelligence={landUseIntelligence} exactAddressListings={exactAddressListings} valuationSummary={canonicalValuationSummary} landPortalFacts={landPortalFacts} taxStatus={taxStatus} showMarket={false}
              acquisitionIntelligence={{
                read: aiRead,
                readiness: aiReadiness,
                runtime: aiRuntime,
                stale: aiStale,
                running: aiRunning,
                error: aiError,
                onRun: runAcquisitionIntelligence,
              }}
            />
          </main>
        )}
        {page === 'market' && (
          <main class="awv2-main awv2-property-market" data-testid="market-page">
            {/* The Market page owns the full Market Intelligence specialist
                read, including the complete persisted expert review. Rendering
                runs nothing — this is the same fetched product. */}
            {marketIntelRead && (
              <section class="awv2-specialist-reads awv2-specialist-full" aria-label="Market Intelligence specialist read">
                <MarketReadCard product={marketIntelRead} stale={specialistStale?.market === true} full />
              </section>
            )}
            <MarketIntelligencePanel market={market} aiRead={aiRead} />
          </main>
        )}
        {page === 'comps' && (
          <main class="awv2-main awv2-property-market" data-testid="comps-page">
            <CompsValuationSection dealId={dealId} initial={compsValuation} onViewChange={setCompsValuation} />
          </main>
        )}
        {page === 'seller' && (
          <main class="awv2-main awv2-deal-activity" data-testid="seller-activity-page">
            <section class="awv2-activity-seller" data-domain="action">
              <div class="awv2-dom-eyebrow" data-dom="action">Seller</div>
              <UserRound size={34} aria-hidden="true" />
              <h2>{seller?.name || owner || 'Seller not collected'}</h2>
              <p>{seller?.phone || 'No phone retained'}{seller?.email ? ` · ${seller.email}` : ''}</p>
              <div class="awv2-activity-actions"><button type="button"><Phone size={15} /> Call</button><button type="button"><MessageSquare size={15} /> Text</button><button type="button"><Mail size={15} /> Email</button></div>
            </section>
            {/* Seller Intelligence, once seller communication exists. Before
                contact the honest state is a single pre-contact line. */}
            <section class="awv2-activity-seller-intel" data-domain="action" data-testid="seller-intelligence">
              <div class="awv2-dom-eyebrow" data-dom="action">Seller Intelligence</div>
              {sellerIntel?.state === 'established' ? (
                <div class="awv2-seller-intel-body">
                  {/* WHAT IS TRUE NOW + WHAT CHANGED lead; history stays in the
                      versioned snapshot chain, never cluttering this view. */}
                  <h3 data-testid="seller-current-read">{sellerIntel.read}</h3>
                  {sellerIntel.version != null && <p class="awv2-seller-intel-version">Current Seller Read · v{sellerIntel.version}{sellerIntel.generatedAt ? ` · ${new Date(sellerIntel.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}{sellerIntel.evidenceWeight ? ` · ${sellerIntel.evidenceWeight}` : ''}</p>}
                  {sellerIntel.sellerTrajectory && (
                    <div class="awv2-seller-intel-trajectory" data-testid="seller-trajectory">
                      <b>What changed</b>
                      <p>{sellerIntel.sellerTrajectory}</p>
                      {(sellerIntel.materialChanges ?? []).filter((change) => change.dimension).map((change) => (
                        <p class="awv2-seller-intel-change"><span class="tag">{change.direction || 'changed'}</span> <b>{change.dimension}</b>{change.priorState ? ` ${change.priorState} →` : ''} {change.currentState}{change.whyItMatters ? ` — ${change.whyItMatters}` : ''}</p>
                      ))}
                    </div>
                  )}
                  <div class="awv2-seller-intel-grid">
                    {sellerIntel.whatMattersMostNow && <p><b>What matters most now</b> {sellerIntel.whatMattersMostNow}</p>}
                    {sellerIntel.nextConversationObjective && <p><b>Next conversation objective</b> {sellerIntel.nextConversationObjective}</p>}
                    {sellerIntel.transactionLikelihood && <p><b>Transaction likelihood</b> {sellerIntel.transactionLikelihood}</p>}
                    {sellerIntel.motivation && <p><b>Motivation</b> {sellerIntel.motivation}</p>}
                    {sellerIntel.priceExpectation && <p><b>Price expectation</b> {sellerIntel.priceExpectation}</p>}
                    {sellerIntel.priceMovement && <p><b>Price movement</b> {sellerIntel.priceMovement}</p>}
                    {sellerIntel.timeline && <p><b>Timeline</b> {sellerIntel.timeline}</p>}
                    {sellerIntel.urgency && <p><b>Urgency</b> {sellerIntel.urgency}</p>}
                    {sellerIntel.decisionMakers && <p><b>Decision makers</b> {sellerIntel.decisionMakers}</p>}
                    {sellerIntel.negotiationPosture && <p><b>Negotiation posture</b> {sellerIntel.negotiationPosture}</p>}
                    {sellerIntel.bestApproach && <p><b>Best communication approach</b> {sellerIntel.bestApproach}</p>}
                  </div>
                  {!!sellerIntel.unknowns?.filter((item) => item.question).length && (
                    <div class="awv2-seller-intel-unknowns" data-testid="seller-controlling-unknowns">
                      <b>Controlling unknowns</b>
                      {sellerIntel.unknowns.filter((item) => item.question).slice(0, 5).map((item) => <p>? {item.question}{item.whyItMatters ? ` — ${item.whyItMatters}` : ''}</p>)}
                    </div>
                  )}
                  {!!sellerIntel.sellerReportedFacts?.length && (
                    <div class="awv2-seller-intel-reported">
                      <b>Seller-reported (attributed, not verified property facts)</b>
                      {sellerIntel.sellerReportedFacts.map((fact) => <p>“{fact.statement}” — {fact.attribution}</p>)}
                    </div>
                  )}
                  {!!sellerIntel.followUps?.length && <p class="awv2-seller-intel-follow"><b>Follow-ups:</b> {sellerIntel.followUps.join('; ')}</p>}
                  {!!sellerIntel.expertReview && (
                    <details class="awv2-seller-intel-review" data-testid="seller-expert-review">
                      <summary>Full expert seller review</summary>
                      <div class="awv2-seller-intel-review-body">{sellerIntel.expertReview.split(/\n{2,}/).map((paragraph) => <p>{paragraph}</p>)}</div>
                    </details>
                  )}
                </div>
              ) : (
                <p class="awv2-seller-intel-precontact">
                  Current Seller Read: Pending — no meaningful seller communication yet. Seller
                  Trajectory: not established. Seller Intelligence fills in from real
                  communication — nothing is inferred from ownership records.
                </p>
              )}
            </section>
            <section class="awv2-activity-next" data-domain="action">
              <div class="awv2-dom-eyebrow" data-dom="action">Next action</div>
              <h2>{nextActionLabel || 'Assign the next acquisition action'}</h2>
              {nextActionReason && <p>{nextActionReason}</p>}
              <div class="awv2-activity-meta"><span><CalendarClock size={15} /> {followUp || 'No follow-up scheduled'}</span><span>{stageLabel}</span></div>
            </section>
            <section class="awv2-activity-timeline" data-domain="evidence">
              <div class="awv2-dom-eyebrow" data-dom="evidence">Recent activity</div>
              <div class="awv2-timeline">
                {(activity?.events?.length ? activity.events : [{ kind: 'status', summary: 'No activity has been recorded yet.', createdAt: 0 }]).slice(0, 8).map((event) => (
                  <div class="awv2-timeline-event"><span class="dot" /><div><b>{activityLabel(event.kind, event.summary)}</b>{event.createdAt > 0 && <small>{new Date(event.createdAt * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>}</div></div>
                ))}
              </div>
            </section>
          </main>
        )}
        {page === 'documents' && (
          <main class="awv2-main awv2-documents" data-testid="documents-page">
            <section class="awv2-panel" data-domain="evidence">
              <div class="awv2-panel-title">Generated reports</div>
              <p class="awv2-pi-note">Reports are generated from the current retained deal file; downloading one runs no research.</p>
              <a
                class="awv2-ctl"
                href={`/api/landos/deal-cards/${dealId}/report/download?format=pdf`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="documents-property-intelligence-pdf"
              >
                <FileDown size={14} /> Property Intelligence PDF
              </a>
            </section>
            {/* Operator/seller uploads. Read from the SAME Deal-scoped upload
                store Smart Intake writes — no second document system. Anything
                supplied through Smart Intake or any Deal-level upload appears
                here with its original file, type and provenance, including
                files LandOS could not interpret: retained and honestly
                uninterpreted beats silently missing. Listed first so a handful
                of seller documents are not buried under map captures. */}
            <section class="awv2-panel" data-domain="evidence">
              <div class="awv2-panel-title">Operator &amp; seller uploads</div>
              {/* The logical read of those same files. Grouping comes from what
                  each page SAYS, not its filename — all six originals here are
                  named image.png — and every original stays individually
                  listed and openable below. A concise operator read only: the
                  document type, its pages, what it established, and which
                  parcel it concerns. Never a report. */}
              {evidenceRead?.groups?.length ? (
                <div data-testid="documents-evidence-groups">
                  {evidenceRead.groups.map((group) => {
                    const groupClaims = (evidenceRead.claims ?? [])
                      .filter((claim) => group.artifactIds.includes(claim.provenance.artifactId));
                    const subjectScoped = groupClaims.some((claim) => claim.parcelRelationship === 'subject');
                    const other = evidenceRead.relatedParcelReferences
                      ?.find((ref) => group.artifactIds.includes(ref.artifactId));
                    return (
                      <div class="awv2-evidence-group" data-testid={`evidence-group-${group.kind}`}>
                        <div class="awv2-evidence-group-head">
                          <strong>{group.label}</strong>
                          <span class="awv2-pi-note">
                            {group.kind === 'unreadable'
                              ? 'Retained, not interpreted'
                              : subjectScoped
                                ? 'Subject parcel'
                                : other
                                  ? `References parcel ${other.statedApn} — relationship to the subject unresolved`
                                  : 'Parcel relationship unresolved'}
                          </span>
                        </div>
                        {groupClaims.length ? (
                          <ul class="awv2-evidence-claims">
                            {groupClaims.slice(0, 6).map((claim) => (
                              <li data-testid={`evidence-claim-${claim.field}`}>
                                <span class={`awv2-claim-rel awv2-claim-${claim.relation}`}>{claim.relation}</span>
                                {' '}{claim.label}: <strong>{claim.value}</strong>
                                {' '}<span class="awv2-pi-note">{claim.provenance.pageLabel}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p class="awv2-pi-note">
                            Nothing was claimed from {group.pageCount === 1 ? 'this page' : 'these pages'}.
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {evidenceRead.acreage?.bothLegitimate && (
                    <p class="awv2-pi-note" data-testid="evidence-acreage-basis">
                      {evidenceRead.acreage.entries
                        .map((entry) => `${entry.label}: ${entry.acres} AC`).join(' · ')}
                      {' — '}{evidenceRead.acreage.reason}
                    </p>
                  )}
                  {/* Boundary geometry, stated where the operator can see which
                      edge each dimension belongs to. The long side/depth line is
                      the one that gets misread as frontage, so it is named as a
                      side/depth line rather than left to a bare number. */}
                  {evidenceRead.boundary?.reason && (
                    <p class="awv2-pi-note" data-testid="evidence-boundary-frame">
                      {[
                        evidenceRead.boundary.longestSideDepthFeet != null
                          ? `Longest side/depth boundary: ${evidenceRead.boundary.longestSideDepthFeet} ft`
                          : null,
                        evidenceRead.boundary.surveyedRoadFacingFeet != null
                          ? `Surveyed road-facing boundary: ${evidenceRead.boundary.surveyedRoadFacingFeet} ft`
                            + (evidenceRead.boundary.roadFeature ? ` along ${evidenceRead.boundary.roadFeature}` : '')
                          : null,
                        evidenceRead.boundary.providerFrontageFeet != null
                          ? `${evidenceRead.boundary.providerFrontageLabel ?? 'Provider'} road frontage: ${evidenceRead.boundary.providerFrontageFeet} ft`
                          : null,
                      ].filter(Boolean).join(' · ')}
                      {' — '}{evidenceRead.boundary.reason}
                    </p>
                  )}
                </div>
              ) : null}
              {dealUploads.length ? (
                <ul class="awv2-documents-list" data-testid="documents-uploads-list">
                  {dealUploads.map((item) => (
                    <li>
                      <a
                        href={`/api/landos/deal-cards/${dealId}/documents/upload-file/${encodeURIComponent(item.fileName ?? item.title ?? '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink size={13} /> {item.title ?? item.fileName}
                      </a>
                      <span class="awv2-pi-note">
                        {[item.mimeType, item.docType?.replace(/_/g, ' '), item.uploadedAt?.slice(0, 10)]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="awv2-pi-note">No operator or seller uploads have been supplied for this deal yet.</p>
              )}
            </section>
            <section class="awv2-panel" data-domain="evidence">
              <div class="awv2-panel-title">Retrieved documents &amp; evidence</div>
              {(snap.evidence ?? []).filter((item) => item.viewUrl).length ? (
                <ul class="awv2-documents-list" data-testid="documents-evidence-list">
                  {(snap.evidence ?? []).filter((item) => item.viewUrl).map((item) => (
                    <li>
                      <a href={item.viewUrl!} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={13} /> {(item.label ?? item.id).replace(/^inspection-/, '').replace(/[_-]/g, ' ')}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="awv2-pi-note">No document or visual artifacts have been retained for this deal yet.</p>
              )}
              {snap.subjectParcelUrl && (
                <a class="awv2-ctl" href={snap.subjectParcelUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> Subject parcel evidence (LandPortal)
                </a>
              )}
            </section>
          </main>
        )}

        {/* ── Research & system status. These are controls over the research
            SYSTEM, not the deal, so they close the page instead of consuming
            the premium space above the property. Behaviour is unchanged: the
            operator can still inspect lanes, refresh resolution and re-run
            research from here. ── */}
        <section class="awv2-system-status" aria-label="Research and system status" data-testid="research-system-status">
          <div class="awv2-system-status-title">Research &amp; system status</div>
          <div class="awv2-runstatus-slot">
            <PropertyIntelligenceRunStatus dealId={dealId} onRunSettled={() => setReloadNonce((n) => n + 1)} />
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
