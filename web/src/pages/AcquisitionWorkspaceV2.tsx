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
  LayoutDashboard, Map, Activity, UserRound, CalendarClock, Users,
} from 'lucide-preact';
import { apiGet, apiPost, dashboardToken, chatId, legacyUrl } from '@/lib/api';
import {
  readSection, readPropertyMarketView, sectionHref, rememberWorkspaceDeal, lastWorkspaceDealId,
  SECTION_SLUGS, type WorkspaceV2Section, type PropertyMarketView,
} from '@/lib/workspace-v2-nav';
import {
  PropertyIntelligenceSection,
  type MarketContextView, type PiCompRow,
  type SoilDetail, type BrowseruseResp, type StreetViewView, type VisualBuyerAnalysisView,
  type MissingDiligenceView, type AccessPresentationView, type SoilsSepticView,
  type ExactAddressListingsView,
  type VisualBuyerNarrativeView, type ResearchStatusView, type ParcelFactSheetView, type TaxStatusView,
} from '../components/AcquisitionWorkspaceV2PropertyIntelligence';
import {
  CompsValuationSection, type CompsValuationViewData,
} from '../components/AcquisitionWorkspaceV2CompsValuation';
import { PropertyIntelligenceRunStatus } from '../components/AcquisitionWorkspaceV2RunStatus';
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
import type {
  MarketIntelligenceReadView,
  PropertyIntelligenceReadView,
  SellerIntelligenceReadView,
  SpecialistStaleView,
} from '../components/AcquisitionWorkspaceV2SpecialistReads';
import type { ResearchReadinessManifestView } from '../components/AcquisitionWorkspaceV2ResearchReadiness';
import type { OfficialParcelGisView } from '../components/AcquisitionWorkspaceV2OfficialParcelGis';
import type { LandUseView, RetainedLandUseIntelligenceView } from '../components/AcquisitionWorkspaceV2LandUse';
import '../styles/workspace-v2.css';
// Loaded AFTER the base sheet: the comps identity + readability corrections
// deliberately override base values on equal specificity.
import '../styles/workspace-v2-comps.css';
// Loaded LAST: the lead-card design system (domain color coding, legend rail,
// type scale). Future sections inherit this layer.
import '../styles/workspace-v2-lead-design.css';

// ── Minimal read-model types (fields this view consumes) ───────────────

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
  sufficiency?: { ok?: boolean; reason?: string | null } | null;
  guidance?: DealBrainThreadEntry[];
  runtime?: AcquisitionIntelligenceRuntimeStatus | null;
  /** Present while a coordinated intelligence run is in flight. */
  run?: { startedAt?: string; error?: string | null } | null;
  dealBrainRun?: { startedAt?: string; error?: string | null } | null;
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
  dealCard?: {
    id: number; title?: string; asking_price?: number | null;
    people?: { name?: string; phone?: string; email?: string }[];
    propertyCards?: { id: number; owner?: string; county?: string; state?: string; zip?: string; acres?: number | null; apn?: string }[];
  };
}
interface AcqResp {
  stageLabel?: string;
  acquisition?: { stage?: string; profile?: { nextFollowUpDate?: string }; commLog?: unknown[]; discovery?: unknown[] };
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
  };
  marketContext?: MarketContextView;
  landPortalFacts?: ParcelFactSheetView | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

const tok = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const matchNum = (s: string | undefined, re: RegExp): string | null => {
  const m = s ? s.match(re) : null;
  return m ? m[1] : null;
};

const WORKSPACE_SECTIONS = ['Overview', 'Property & Market', 'Deal Activity'] as const;

// Legend rail: each section's swatch matches the domain hue its surfaces use,
// so the nav reads as the legend for the page (see workspace-v2-lead-design.css).
const SECTION_DOMAINS: Record<string, string> = {
  'Overview': 'action',
  'Property & Market': 'property',
  'Deal Activity': 'action',
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
  const [section, setSection] = useState<WorkspaceV2Section>(() => readSection(window.location.search));
  // The Property & Market inner view is STATE, not a value derived at render
  // time from window.location. Both inner views live under the same top-level
  // section, so switching between them leaves `section` unchanged; a derived
  // read of window.location.search therefore never re-evaluated and the URL and
  // the rendered view drifted apart — clicking "Valuation & comps" rewrote the
  // URL while the Property & diligence view stayed mounted, so the comps
  // workspace (and with it the whole persisted comparable universe) never
  // rendered at all. Deriving it into state keeps the rendered view and the URL
  // the same fact for every section change, forward, back, and inner tab.
  const [propertyMarketView, setPropertyMarketView] = useState<PropertyMarketView>(
    () => readPropertyMarketView(window.location.search),
  );
  const syncNavFromUrl = () => {
    setSection(readSection(window.location.search));
    setPropertyMarketView(readPropertyMarketView(window.location.search));
  };
  useEffect(() => {
    const onPop = () => syncNavFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const switchSection = (e: MouseEvent, slug: string) => {
    // Let modified clicks (new tab, etc.) behave like normal links.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = sectionHref(window.location.pathname, window.location.search, slug);
    if (href !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', href);
    }
    syncNavFromUrl();
  };

  // Remember the deal + section the operator is using so every "back to the
  // workspace" path this session restores this exact record and section.
  useEffect(() => {
    if (dealId != null) rememberWorkspaceDeal(
      dealId,
      new URLSearchParams(window.location.search).get('section') ?? 'overview',
    );
  }, [section, dealId]);

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
  // Property-tax payment status, answered by the collecting office rather than
  // the assessor. Without it the panel could only ever say "not screened".
  const [taxStatus, setTaxStatus] = useState<TaxStatusView | null>(null);
  // Acquisition Intelligence. The read is FETCHED, never generated on render:
  // opening or reloading a Deal Card must not start a reasoning run, so the
  // only thing that produces a new read is the operator pressing refresh.
  const [aiRead, setAiRead] = useState<DealIntelligenceView | null>(null);
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

  useEffect(() => {
    if (dealId == null) return;
    let dead = false;
    (async () => {
      try {
        const [d, i, a, act, bu] = await Promise.all([
          apiGet<DealResp>(`/api/landos/deal-cards/${dealId}`),
          apiGet<IntelResp>(`/api/landos/deal-cards/${dealId}/property-intelligence`),
          apiGet<AcqResp>(`/api/landos/deal-cards/${dealId}/acquisition`).catch(() => null),
          apiGet<ActivityResp>(`/api/landos/deal-cards/${dealId}/activity`).catch(() => null),
          apiGet<BrowseruseResp>(`/api/landos/deal-cards/${dealId}/browseruse`).catch(() => null),
        ]);
        const rr = await apiGet<{ manifest?: ResearchReadinessManifestView }>(
          `/api/landos/deal-cards/${dealId}/research-readiness`,
        ).catch(() => null);
        const ai = await apiGet<IntelligenceStackResp>(`/api/landos/deal-cards/${dealId}/intelligence`).catch(() => null);
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
        setReadiness(rr?.manifest ?? null);
        setAiRead(ai?.products?.deal ?? null);
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
  const acres = id.acres ?? deal?.dealCard?.propertyCards?.[0]?.acres ?? null;

  // Hero preference: widest capture that still reads as the parcel. The tight
  // close crop is LAST — it is the one most likely to clip a long/narrow
  // boundary, and a clipped subject boundary is never an acceptable hero.
  const heroUrl = (snap.evidence || []).find((e) => e.id === 'inspection-landportal_overview')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-parcel_context')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-clean_parcel_aerial')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-wider_context')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-close_parcel_aerial')?.viewUrl;
  const visualCount = (snap.evidence || []).filter((e) => e.viewUrl).length;

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

  const seller = deal?.dealCard?.people?.[0] || null;
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
  const onOpenSection = (slug: 'property-intelligence' | 'comps-valuation') => {
    const href = sectionHref(window.location.pathname, window.location.search, slug);
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
      window.location.href = legacyUrl(`/warroom/text?token=${encodeURIComponent(dashboardToken)}&meetingId=${encodeURIComponent(res.meetingId)}&chatId=${encodeURIComponent(chatId)}`);
    } catch (e) {
      setWarRoomBusy(false);
      alert('War Room failed to open: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div class="awv2" data-testid="acquisition-workspace-root">
      {/* ── CRM header ── */}
      <header class="awv2-header">
        <div class="awv2-eyebrow">
          <span>Acquisitions</span><span class="sep">/</span>
          <span class="brass">Workspace V2</span><span class="sep">/</span>
          <span>Deal {dealId}</span>
        </div>

        <h1 class="awv2-address">
          {street}
          {locality && <span class="locality">, {locality}</span>}
        </h1>
        <div class="awv2-owner-line">
          <span>Owner of record <b>{owner || 'Unknown'}</b></span>
          {(id.apn || card0?.apn) && <span class="mono">APN {id.apn || card0?.apn}</span>}
          {acres != null && <span class="mono">{acres} AC</span>}
          {id.county && <span class="mono">{id.county.toUpperCase()} COUNTY, {id.state_ || ''}</span>}
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
          {snap.subjectParcelUrl && (
            <a
              class="awv2-ctl awv2-lp-link"
              href={snap.subjectParcelUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the exact subject property in LandPortal (new tab)"
            >
              <ExternalLink size={14} /> View in LandPortal
            </a>
          )}
        </div>
      </header>

      <div class="awv2-body awv2-body-composed">
        {/* ── Workspace navigation ── */}
        <nav class="awv2-workspace-nav" aria-label="Lead workspace areas">
          {WORKSPACE_SECTIONS.map((s, index) => {
            const Icon = index === 0 ? LayoutDashboard : index === 1 ? Map : Activity;
            return (
              <a
                href={sectionHref(window.location.pathname, window.location.search, SECTION_SLUGS[s])}
                class={section === s ? 'active' : ''}
                data-domain={SECTION_DOMAINS[s]}
                onClick={(e) => switchSection(e as unknown as MouseEvent, SECTION_SLUGS[s])}
              >
                <Icon size={17} aria-hidden="true" />
                <span>
                  <b>{s}</b>
                  <small>{index === 0 ? 'Decision command center' : index === 1 ? 'Property, valuation, comps & evidence' : 'Seller, next action & timeline'}</small>
                </span>
              </a>
            );
          })}
        </nav>

        <div class="awv2-col">
        {/* Research run status. Rendered outside the section switch because
            "is research still gathering, and what is it retrieving right now?"
            is a question about the lead, not about the tab being viewed. */}
        <div class="awv2-runstatus-slot">
          <PropertyIntelligenceRunStatus dealId={dealId} onRunSettled={() => setReloadNonce((n) => n + 1)} />
        </div>
        {section === 'Property & Market' ? (
          <main class="awv2-main awv2-property-market" data-testid="property-market-workspace">
            <div class="awv2-property-market-head">
              <div>
                <span class="awv2-dom-eyebrow" data-dom="property">Property &amp; Market</span>
                <h2>One due-diligence workspace</h2>
                <p>Parcel facts, physical evidence, market context and the valuation decision share one canonical record.</p>
              </div>
              <div class="awv2-property-market-tabs" role="tablist" aria-label="Property and market views">
                <a role="tab" aria-selected={propertyMarketView === 'property-intelligence'} class={propertyMarketView === 'property-intelligence' ? 'active' : ''} href={sectionHref(window.location.pathname, window.location.search, 'property-intelligence')} onClick={(e) => switchSection(e as unknown as MouseEvent, 'property-intelligence')}>Property &amp; diligence</a>
                <a role="tab" aria-selected={propertyMarketView === 'comps-valuation'} class={propertyMarketView === 'comps-valuation' ? 'active' : ''} href={sectionHref(window.location.pathname, window.location.search, 'comps-valuation')} onClick={(e) => switchSection(e as unknown as MouseEvent, 'comps-valuation')}>Valuation &amp; comps</a>
              </div>
            </div>
            <nav class="awv2-zone-index" aria-label="Workspace zones">
              {propertyMarketView === 'property-intelligence' ? <>
                <a href="#pi-subject">Subject</a><a href="#access-road-frontage">Access</a><a href="#terrain-buildability">Terrain</a><a href="#environmental-soils">Environmental</a><a href="#zoning-land-use">Zoning</a><a href="#utilities-septic">Utilities</a><a href="#assessment-tax">Assessment</a><a href="#visual-evidence">Visual evidence</a><a href="#market-intelligence">Market</a><a href="#research-status">Diligence</a><a href="#remaining-diligence">Remaining</a><a href="#full-acquisition-intelligence">Full read</a>
              </> : <>
                <a href="#valuation-decision">Valuation</a><a href="#comparable-sales">Comparable sales</a><a href="#valuation-market-intelligence">Market</a><a href="#valuation-methodology">Methodology</a>
              </>}
            </nav>
            {/* Comparable evidence handoff. The diligence view is NOT the comp
                surface and must not restate the comparables, but it also must
                not let a thin FMV set read as "there are no comps": the retained
                universe and the strict FMV-qualifying set are stated as two
                separate numbers, with one obvious way through to the real
                records. Counts only — the named properties live one click away
                on the canonical surface. */}
            {propertyMarketView === 'property-intelligence' && compsValuation && (
              <section class="awv2-panel awv2-cv-handoff" data-domain="evidence" aria-label="Comparable evidence" data-testid="pi-comps-handoff">
                <div class="awv2-cv-handoffcounts">
                  <span><i>Retained comparables</i><b data-testid="pi-comps-handoff-retained">{compsValuation.canonicalCompCount ?? compsValuation.comps.length}</b></span>
                  <span><i>Strict FMV qualifying</i><b data-testid="pi-comps-handoff-qualifying">{compsValuation.summary.acceptedCount}</b></span>
                </div>
                <p class="awv2-pi-note">
                  Retained comparable evidence is not the same set as the sales allowed to price the subject. Every retained
                  candidate — core, directional and excluded alike — stays visible with its own reason on the comps surface.
                </p>
                <button type="button" class="awv2-cv-cta" data-testid="pi-comps-handoff-open" onClick={openCompsValuation}>
                  View comps →
                </button>
              </section>
            )}
            {propertyMarketView === 'comps-valuation' ? (
              <CompsValuationSection dealId={dealId} initial={compsValuation} onViewChange={setCompsValuation} />
            ) : (
              <PropertyIntelligenceSection snap={snap} market={market} soils={soils} streetView={streetView} vba={vba} missingDiligence={missingDiligence} accessView={accessView} soilsSeptic={soilsSeptic} narrative={narrative} dealId={dealId} officialParcelGis={officialParcelGis} landUse={landUse} landUseIntelligence={landUseIntelligence} exactAddressListings={exactAddressListings} valuationSummary={canonicalValuationSummary} landPortalFacts={landPortalFacts} taxStatus={taxStatus}
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
            )}
          </main>
        ) : section === 'Deal Activity' ? (
          <main class="awv2-main awv2-deal-activity" data-testid="deal-activity-workspace">
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
                  <h3>{sellerIntel.read}</h3>
                  <div class="awv2-seller-intel-grid">
                    {sellerIntel.score != null && <p><b>Workability</b> {sellerIntel.score}/100</p>}
                    {sellerIntel.motivation && <p><b>Motivation</b> {sellerIntel.motivation}</p>}
                    {sellerIntel.priceExpectation && <p><b>Price expectation</b> {sellerIntel.priceExpectation}</p>}
                    {sellerIntel.timeline && <p><b>Timeline</b> {sellerIntel.timeline}</p>}
                    {sellerIntel.decisionMakers && <p><b>Decision makers</b> {sellerIntel.decisionMakers}</p>}
                    {sellerIntel.negotiationPosture && <p><b>Negotiation posture</b> {sellerIntel.negotiationPosture}</p>}
                    {sellerIntel.bestApproach && <p><b>Best way to work this seller</b> {sellerIntel.bestApproach}</p>}
                  </div>
                  {!!sellerIntel.sellerReportedFacts?.length && (
                    <div class="awv2-seller-intel-reported">
                      <b>Seller-reported (attributed, not verified property facts)</b>
                      {sellerIntel.sellerReportedFacts.map((fact) => <p>“{fact.statement}” — {fact.attribution}</p>)}
                    </div>
                  )}
                  {!!sellerIntel.followUps?.length && <p class="awv2-seller-intel-follow"><b>Follow-ups:</b> {sellerIntel.followUps.join('; ')}</p>}
                </div>
              ) : (
                <p class="awv2-seller-intel-precontact">
                  Seller score: not established · Pre-contact. Seller Intelligence fills in from real
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
        ) : (
        <OverviewSection
          snap={snap}
          address={address}
          zip={zip}
          heroSrc={heroUrl ? tok(heroUrl) : null}
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
          onOpenVisualBuyerAnalysis={(e) => switchSection(e as unknown as MouseEvent, 'property-intelligence')}
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
          specialistReads={{
            property: propertyIntelRead,
            market: marketIntelRead,
            seller: sellerIntel,
            stale: specialistStale,
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
        </div>
      </div>
    </div>
  );
}
