// Acquisition Workspace V2 — Pre-Discovery Overview (/dept/acquisitions/v2).
//
// A CRM-style opportunity record for one seller lead + one subject property,
// rendered entirely from the existing canonical read APIs:
//   GET /api/landos/deal-cards/:id                        (deal + property card)
//   GET /api/landos/deal-cards/:id/property-intelligence  (snapshot projection)
//   GET /api/landos/deal-cards/:id/acquisition            (stage + next action)
//   GET /api/landos/deal-cards/:id/activity               (last activity)
//
// This route is separate from the existing Deal Card and changes no backend
// behavior. Values missing from the current data interfaces render as missing;
// nothing is fabricated. The page owns loading, record identity, and section
// navigation; each of the three built sections owns its operator presentation.
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import {
  Phone, MessageSquare, Mail, StickyNote, ListPlus, Pencil, ExternalLink,
} from 'lucide-preact';
import { apiGet, dashboardToken } from '@/lib/api';
import {
  readSection, sectionHref, rememberWorkspaceDeal, lastWorkspaceDealId,
  SECTION_SLUGS, type WorkspaceV2Section,
} from '@/lib/workspace-v2-nav';
import {
  PropertyIntelligenceSection,
  type MarketContextView, type PiCompRow,
  type SoilDetail, type BrowseruseResp, type StreetViewView, type VisualBuyerAnalysisView,
  type MissingDiligenceView, type AccessPresentationView, type SoilsSepticView,
  type ExactAddressListingsView,
  type VisualBuyerNarrativeView, type ResearchStatusView,
} from '../components/AcquisitionWorkspaceV2PropertyIntelligence';
import {
  CompsValuationSection, type CompsValuationViewData,
} from '../components/AcquisitionWorkspaceV2CompsValuation';
import {
  OverviewSection, type OverviewSnapshotView,
} from '../components/AcquisitionWorkspaceV2Overview';
import type { OfficialParcelGisView } from '../components/AcquisitionWorkspaceV2OfficialParcelGis';
import type { LandUseView } from '../components/AcquisitionWorkspaceV2LandUse';
import '../styles/workspace-v2.css';
// Loaded AFTER the base sheet: the comps identity + readability corrections
// deliberately override base values on equal specificity.
import '../styles/workspace-v2-comps.css';

// ── Minimal read-model types (fields this view consumes) ───────────────

interface DdItem {
  key: string; label: string; verdict: string; headline: string; detail?: string;
  missing?: string[];
}
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
  recommendation?: {
    posture?: string; postureWhy?: string; preferredStrategy?: string | null; why?: string;
    whatWouldChangeIt?: string[]; nextConfirmations?: string[]; dealKillers?: string[];
  };
  strategies?: { strategy: string; applicability: string }[];
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
    exactAddressListings?: ExactAddressListingsView | null;
  };
  marketContext?: MarketContextView;
}

// ── Helpers ────────────────────────────────────────────────────────────

const tok = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const matchNum = (s: string | undefined, re: RegExp): string | null => {
  const m = s ? s.match(re) : null;
  return m ? m[1] : null;
};

const WORKSPACE_SECTIONS = [
  'Overview', 'Property Intelligence', 'Comps & Valuation', 'Market Intelligence',
  'Seller & Communications', 'Strategy', 'Evidence & Documents', 'Tasks & Timeline',
];

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
  useEffect(() => {
    const onPop = () => setSection(readSection(window.location.search));
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
    setSection(readSection(window.location.search));
  };

  // Remember the deal + section the operator is using so every "back to the
  // workspace" path this session restores this exact record and section.
  useEffect(() => {
    if (dealId != null) rememberWorkspaceDeal(dealId, SECTION_SLUGS[section] ?? 'overview');
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
  const [exactAddressListings, setExactAddressListings] = useState<ExactAddressListingsView | null>(null);
  const [researchStatus, setResearchStatus] = useState<ResearchStatusView | null>(null);
  const [compsValuation, setCompsValuation] = useState<CompsValuationViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setExactAddressListings(i?.propertyIntelligence?.exactAddressListings ?? null);
        setResearchStatus(i?.propertyIntelligence?.researchStatus ?? null);
        setCompsValuation(i?.propertyIntelligence?.compsValuation ?? null);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [dealId]);

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

  const heroUrl = (snap.evidence || []).find((e) => e.id === 'inspection-landportal_overview')?.viewUrl
    ?? (snap.evidence || []).find((e) => e.id === 'inspection-parcel_context')?.viewUrl
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
  const researchProgress = researchStatus
    ? `${researchStatus.delivered} of ${researchStatus.total} research lanes delivered`
    : (() => {
        const m = snap.headline?.confidenceWhy?.match(/(\d+)\s+of\s+(\d+)/);
        return m ? `${m[1]} of ${m[2]} research areas delivered` : (snap.status === 'complete_with_gaps' ? 'Complete with gaps' : '—');
      })();
  const incompleteArea = researchStatus?.incomplete?.[0] ?? null;
  const researchQuestions = researchStatus as (ResearchStatusView & { questionsHeadline?: string }) | null;
  const lastEvent = activity?.events?.[0];
  const lastActivity = lastEvent
    ? `${activityLabel(lastEvent.kind, lastEvent.summary)} · ${new Date(lastEvent.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'None recorded';
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
  const openCompsValuationLabel = 'Open Comps &amp; Valuation →';
  const onOpenSection = (slug: 'property-intelligence' | 'comps-valuation') => {
    const href = sectionHref(window.location.pathname, window.location.search, slug);
    if (href !== window.location.pathname + window.location.search) window.history.pushState(null, '', href);
    setSection(readSection(window.location.search));
  };
  const openCompsValuation = () => onOpenSection('comps-valuation');

  return (
    <div class="awv2">
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

        <div class="awv2-statusbar">
          <div class="awv2-status-item">
            <div class="k">Research lanes</div>
            <div class="v"><b>{researchProgress}</b></div>
            {incompleteArea && (
              <div class="awv2-status-sub">
                Missing: <b>{incompleteArea.label}</b>{incompleteArea.reason ? ` — ${incompleteArea.reason}` : ''}{incompleteArea.nextAction ? ` Next: ${incompleteArea.nextAction}` : ''}
              </div>
            )}
          </div>
          <div class="awv2-status-item">
            <div class="k">Diligence questions</div>
            <div class="v"><b>{researchQuestions?.questionsHeadline || 'Resolution status not yet recorded'}</b></div>
          </div>
          <div class="awv2-status-item">
            <div class="k">Last activity</div>
            <div class="v">{lastActivity}</div>
          </div>
          <div class="awv2-status-item">
            <div class="k">Follow-up</div>
            <div class="v">{followUp || 'None scheduled'}</div>
          </div>
          {nextActionLabel && (
            <div class="awv2-next-action">
              <span class="pulse" />
              <div>
                <div class="label">Next action</div>
                <div class="act">{nextActionLabel}</div>
                {nextActionReason && <div class="why">{nextActionReason}</div>}
              </div>
            </div>
          )}
        </div>

        <div class="awv2-controls">
          <button type="button" class="awv2-ctl primary"><Phone size={14} /> Call</button>
          <button type="button" class="awv2-ctl"><MessageSquare size={14} /> Text</button>
          <button type="button" class="awv2-ctl"><Mail size={14} /> Email</button>
          <button type="button" class="awv2-ctl"><StickyNote size={14} /> Add note</button>
          <button type="button" class="awv2-ctl"><ListPlus size={14} /> Add task</button>
          <button type="button" class="awv2-ctl"><Pencil size={14} /> Edit</button>
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

      <div class="awv2-body">
        {/* ── Workspace navigation ── */}
        <nav class="awv2-rail" aria-label="Workspace sections">
          <div class="awv2-rail-title">Workspace</div>
          {WORKSPACE_SECTIONS.map((s) => (
            SECTION_SLUGS[s]
              ? (
                <a
                  href={sectionHref(window.location.pathname, window.location.search, SECTION_SLUGS[s])}
                  class={section === s ? 'active' : ''}
                  onClick={(e) => switchSection(e as unknown as MouseEvent, SECTION_SLUGS[s])}
                >
                  {s}
                </a>
              )
              : <span class="soon">{s}<span class="tag">Soon</span></span>
          ))}
        </nav>

        {section === 'Property Intelligence' ? (
          <main class="awv2-main">
            <PropertyIntelligenceSection snap={snap} market={market} soils={soils} streetView={streetView} vba={vba} missingDiligence={missingDiligence} accessView={accessView} soilsSeptic={soilsSeptic} narrative={narrative} dealId={dealId} officialParcelGis={officialParcelGis} landUse={landUse} exactAddressListings={exactAddressListings} valuationSummary={canonicalValuationSummary} />
          </main>
        ) : section === 'Comps & Valuation' ? (
          <main class="awv2-main">
            <CompsValuationSection dealId={dealId} initial={compsValuation} />
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
          compsValuation={compsValuation}
          valuationBasisLabel={valuationBasisLabel}
          landBasisOpeningReference={landBasisOpeningReference}
          openCompsValuationLabel={openCompsValuationLabel}
          openCompsValuation={openCompsValuation}
          acquisitionNextAction={acq?.nextAction ?? null}
          formatUsd={usd}
          onOpenSection={onOpenSection}
        />
        )}
      </div>
    </div>
  );
}
