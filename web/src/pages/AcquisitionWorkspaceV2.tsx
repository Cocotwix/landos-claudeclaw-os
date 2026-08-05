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
// nothing is fabricated. Only the Overview is built; the other workspace
// sections are visible navigation placeholders.
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
  type MarketContextView, type PiCompRow, type PiEvidenceItem, type PiFact,
  type SoilDetail, type BrowseruseResp, type StreetViewView, type VisualBuyerAnalysisView,
  type MissingDiligenceView, type AccessPresentationView, type SoilsSepticView,
  type VisualBuyerNarrativeView, type ResearchStatusView,
} from '../components/AcquisitionWorkspaceV2PropertyIntelligence';
import '../styles/workspace-v2.css';

// ── Minimal read-model types (fields this view consumes) ───────────────

interface DdItem {
  key: string; label: string; verdict: string; headline: string; detail?: string;
  missing?: string[];
}
interface ScoreView {
  score: number | null; rating: string; explanation?: string;
  strongestPositiveFactors?: string[]; mainDeductions?: string[];
  materiallyChangeWith?: string[];
}
interface SnapshotView {
  status?: string;
  identity?: {
    displayAddress?: string; normalizedAddress?: string; owner?: string | null;
    county?: string; state_?: string; apn?: string; acres?: number | null;
    lpPropertyId?: string | null; hasParcelGeometry?: boolean;
  };
  facts?: PiFact[];
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
  evidence?: PiEvidenceItem[];
  operatorAnalysis?: { scores?: { property?: ScoreView; market?: ScoreView; seller?: ScoreView } };
  missingInformation?: unknown[];
  subjectParcelUrl?: string | null;
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
  const [researchStatus, setResearchStatus] = useState<ResearchStatusView | null>(null);
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
        setResearchStatus(i?.propertyIntelligence?.researchStatus ?? null);
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

  const dd = new Map<string, DdItem>((snap.dueDiligence || []).map((x) => [x.key, x]));
  const access = dd.get('access');
  const wetlands = dd.get('wetlands');
  const flood = dd.get('flood');
  const terrain = dd.get('terrain');
  const frontageFt = matchNum(access?.headline, /([\d.]+)\s*ft frontage/);
  const landlocked = matchNum(access?.headline, /landlocked flag:\s*(\w+)/);
  const wetPct = matchNum(wetlands?.headline, /([\d.]+)%/);
  const floodPct = matchNum(flood?.headline, /(\d+(?:\.\d+)?)/);
  const slopePct = matchNum(terrain?.headline, /([\d.]+)%\s*average slope/);
  const buildPct = matchNum(terrain?.headline, /([\d.]+)%\s*buildability/);

  const heroUrl = (snap.evidence || []).find((e) => e.id === 'inspection-close_parcel_aerial')?.viewUrl;
  const visualCount = (snap.evidence || []).filter((e) => e.viewUrl).length;

  const scores = snap.operatorAnalysis?.scores || {};
  const val = snap.valuation || {};
  const perAcre = val.pricePerAcreRange || null;
  const totalLow = perAcre && acres ? perAcre.low * acres : null;
  const totalHigh = perAcre && acres ? perAcre.high * acres : null;
  const lpEstimate = (snap.facts || []).find((f) => f.key === 'lpEstimateTotal')?.value || null;
  const lpEstimatePerAcre = (snap.facts || []).find((f) => f.key === 'lpEstimatePerAcre')?.value || null;

  const marketSubject = (snap.facts || []).find((f) => f.key === 'market_matrix_subject')?.value;
  const marketOverall = (snap.facts || []).find((f) => f.key === 'market_matrix_overall')?.value;
  const subjPpa = matchNum(marketSubject, /Price per Acre:\s*\$([\d,]+)/);
  const subjDom = matchNum(marketSubject, /Days on Market:\s*(\d+)/);
  const overallPpa = matchNum(marketOverall, /Price per Acre:\s*\$([\d,]+)/);
  const overallDom = matchNum(marketOverall, /Days on Market:\s*(\d+)/);

  const stageLabel = acq?.stageLabel || 'New lead';
  const nextActionLabel = acq?.nextAction?.label || snap.nextActions?.[0] || '';
  const nextActionReason = acq?.nextAction?.reason || '';
  // Recomputed from current accepted research state (server re-derivation),
  // never a stale snapshot count; the exact incomplete area is named below.
  const researchProgress = researchStatus
    ? researchStatus.headline
    : (() => {
        const m = snap.headline?.confidenceWhy?.match(/(\d+)\s+of\s+(\d+)/);
        return m ? `${m[1]} of ${m[2]} research areas delivered` : (snap.status === 'complete_with_gaps' ? 'Complete with gaps' : '—');
      })();
  const incompleteArea = researchStatus?.incomplete?.[0] ?? null;
  const lastEvent = activity?.events?.[0];
  const lastActivity = lastEvent
    ? `${activityLabel(lastEvent.kind, lastEvent.summary)} · ${new Date(lastEvent.createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'None recorded';
  const followUp = acq?.acquisition?.profile?.nextFollowUpDate || null;

  const seller = deal?.dealCard?.people?.[0] || null;
  const askingPrice = deal?.dealCard?.asking_price ?? null;
  const discoveryDone = (acq?.acquisition?.discovery || []).length > 0;

  const rec = snap.recommendation || {};
  const strategies = snap.strategies || [];
  const soldCount = snap.comps?.sold?.length ?? 0;
  const activeCount = snap.comps?.active?.length ?? 0;
  const askingCount = snap.comps?.askingReferences?.length ?? 0;

  // Missing information, grouped compactly. Sourced from unresolved diligence,
  // valuation gaps, and the not-yet-collected seller record.
  const missingProperty: string[] = [];
  for (const k of ['zoning', 'septic', 'utilities']) {
    const item = dd.get(k);
    if (item && (item.verdict === 'unknown' || item.verdict === 'unresolved')) missingProperty.push(item.label);
  }
  if (access?.missing?.some((m) => /legal access/i.test(m))) missingProperty.push('Legal access (recorded instruments)');
  if (id.hasParcelGeometry === false) missingProperty.push('Parcel boundary / survey');
  if (!(snap.facts || []).some((f) => f.key === 'lp_sidebar_water_feature_type' && f.value)) missingProperty.push('Water features');
  const missingValuation = val.priceable ? [] : ['A closed in-band land sale (price + date)'];
  const missingSeller: string[] = [];
  if (!seller?.name) missingSeller.push('Seller contact');
  if (!seller?.phone) missingSeller.push('Phone');
  if (!seller?.email) missingSeller.push('Email');
  if (askingPrice == null) missingSeller.push('Asking price');
  if (!discoveryDone) missingSeller.push('Motivation', 'Timeline', 'Decision-makers');

  return (
    <div class="awv2">
      {/* ── CRM header ── */}
      <header class="awv2-header">
        <div class="awv2-eyebrow">
          <span>Acquisitions</span><span class="sep">/</span>
          <span class="brass">Workspace V2</span><span class="sep">/</span>
          <span>Deal {dealId}</span>
          {id.apn && (<><span class="sep">·</span><span>APN {id.apn}</span></>)}
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
            <div class="k">Research</div>
            <div class="v"><b>{researchProgress}</b></div>
            {incompleteArea && (
              <div class="awv2-status-sub">
                Missing: <b>{incompleteArea.label}</b>{incompleteArea.reason ? ` — ${incompleteArea.reason}` : ''}{incompleteArea.nextAction ? ` Next: ${incompleteArea.nextAction}` : ''}
              </div>
            )}
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
            {/* ── Scores first: the operator's opening read ── */}
            <div class="awv2-grid cols-3 awv2-scorestrip">
              <ScoreCard title="Property score" view={scores.property} />
              <ScoreCard title="Market score" view={scores.market} />
              <ScoreCard title="Seller score" view={scores.seller} />
            </div>
            <PropertyIntelligenceSection snap={snap} market={market} soils={soils} streetView={streetView} vba={vba} missingDiligence={missingDiligence} accessView={accessView} soilsSeptic={soilsSeptic} narrative={narrative} />
          </main>
        ) : (
        <main class="awv2-main">
          {/* ── Scores first: the operator's opening read ── */}
          <div class="awv2-grid cols-3 awv2-scorestrip">
            <ScoreCard title="Property score" view={scores.property} />
            <ScoreCard title="Market score" view={scores.market} />
            <ScoreCard title="Seller score" view={scores.seller} />
          </div>

          {/* ── Property hero: full uncropped parcel aerial + site facts ── */}
          <section class="awv2-hero" aria-label="Property hero">
            <div class="awv2-hero-media">
              <span class="tick tl" /><span class="tick tr" /><span class="tick bl" /><span class="tick br" />
              {heroUrl && <img src={tok(heroUrl)} alt={`Satellite view of ${address} with the full parcel boundary`} />}
            </div>
            <aside class="awv2-hero-side">
              <div class="awv2-hero-facts">
                {acres != null && <div class="f"><span class="u">Acreage</span><span class="v">{acres} AC</span></div>}
                {id.apn && <div class="f"><span class="u">APN</span><span class="v">{id.apn}</span></div>}
                {id.county && <div class="f"><span class="u">County</span><span class="v">{id.county}</span></div>}
                {zip && <div class="f"><span class="u">ZIP</span><span class="v">{zip}</span></div>}
                {frontageFt && <div class="f"><span class="u">Frontage</span><span class="v">{Math.round(Number(frontageFt))} FT</span></div>}
                {landlocked && (
                  <div class="f"><span class="u">Landlocked</span>
                    <span class={`v ${landlocked.toLowerCase() === 'no' ? 'good' : 'warn'}`}>{landlocked.toUpperCase()}</span>
                  </div>
                )}
                {wetPct && <div class="f"><span class="u">Wetlands</span><span class="v warn">{wetPct}%</span></div>}
                {floodPct && <div class="f"><span class="u">Flood overlay</span><span class="v warn">{floodPct}%</span></div>}
                {slopePct && <div class="f"><span class="u">Avg slope</span><span class="v">{slopePct}%</span></div>}
                {buildPct && <div class="f"><span class="u">Buildable</span><span class="v good">{buildPct}%</span></div>}
                {accessView?.established && (
                  <div class="f"><span class="u">Legal access</span><span class="v good">YES</span></div>
                )}
                {soilsSeptic && (
                  <div class="f"><span class="u">Septic outlook</span>
                    <span class={`v ${soilsSeptic.category === 'high' ? 'good' : 'warn'}`}>
                      {soilsSeptic.category === 'low' ? 'LOW (PRELIM)' : soilsSeptic.category === 'high' ? 'FAVORABLE (PRELIM)' : soilsSeptic.category.toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <div class="awv2-hero-caption">
                <b>{acres != null ? `${acres}-acre` : 'A'} vacant parcel</b> in {id.county || '—'} County
                {frontageFt ? ` with ${Math.round(Number(frontageFt))} ft of mapped road frontage` : ''}
                {landlocked?.toLowerCase() === 'no' ? ', not flagged landlocked' : ''}
                {wetPct && floodPct ? `, light wetlands (${wetPct}%) and flood (${floodPct}%) coverage` : ''}
                {buildPct ? `, and ${Math.round(Number(buildPct))}% of the site shown buildable` : ''}.
                {' '}{accessView?.established
                  ? `Legal access: ${accessView.legalAccess}. Apparent entrance: ${accessView.apparentEntrance.charAt(0).toLowerCase()}${accessView.apparentEntrance.slice(1)}. Zoning, septic and utilities still need confirmation.`
                  : 'Legal access, zoning, septic and utilities still need confirmation.'}
                {' '}{visualCount > 0 && <span>{visualCount} verified visuals on file → Evidence & Documents.</span>}
              </div>
              {snap.subjectParcelUrl && (
                <a
                  class="awv2-hero-lp"
                  href={snap.subjectParcelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} /> Open this subject in LandPortal
                </a>
              )}
            </aside>
          </section>

          {/* ── Visual Buyer Summary (grounded in the multi-view analysis) ── */}
          {vba?.overviewSummary && (
            <section class="awv2-panel" aria-label="Visual Buyer Summary">
              <div class="awv2-panel-title">
                Visual buyer summary <span class="awv2-src-tag">Multi-view visual analysis</span>
              </div>
              <div class="awv2-kv">
                <span class="k">Physical character</span>
                <span class="v">{vba.overviewSummary.physicalCharacter}</span>
                <span class="k">Main buyer appeal</span>
                <span class="v">{vba.overviewSummary.mainBuyerAppeal}</span>
                <span class="k">Top visual concern</span>
                <span class="v">{vba.overviewSummary.topConcern}</span>
                {narrative?.overviewMarketLine && (
                  <>
                    <span class="k">Market context</span>
                    <span class="v">{narrative.overviewMarketLine}</span>
                  </>
                )}
              </div>
              <button
                type="button"
                class="awv2-vbs-open"
                onClick={(e) => {
                  switchSection(e as unknown as MouseEvent, 'property-intelligence');
                  requestAnimationFrame(() => document.getElementById('visual-buyer-analysis')?.scrollIntoView({ behavior: 'smooth' }));
                }}
              >
                Open the full Visual Buyer Analysis →
              </button>
            </section>
          )}

          {/* ── Septic outlook (compact, grounded in mapped soils) ── */}
          {soilsSeptic && (
            <section class="awv2-panel" aria-label="Septic outlook">
              <div class="awv2-panel-title">
                Septic outlook <span class="awv2-src-tag">Mapped soils · preliminary screening</span>
              </div>
              <div class="awv2-kv">
                <span class="k">Preliminary outlook</span>
                <span class="v"><b>{soilsSeptic.categoryLabel}</b></span>
                <span class="k">Read</span>
                <span class="v">
                  {soilsSeptic.category === 'low'
                    ? 'Mapped soils carry official limitations for a conventional in-ground system; engineered options stay possible.'
                    : soilsSeptic.category === 'insufficient'
                      ? 'Not enough retained soil data for a parcel-level read.'
                      : 'Mapped soils suggest potentially suitable areas.'}
                  {' '}Field testing remains required.
                </span>
              </div>
              <button
                type="button"
                class="awv2-vbs-open"
                onClick={(e) => {
                  switchSection(e as unknown as MouseEvent, 'property-intelligence');
                  requestAnimationFrame(() => document.getElementById('soils-septic')?.scrollIntoView({ behavior: 'smooth' }));
                }}
              >
                Open Soils &amp; Preliminary Septic Outlook →
              </button>
            </section>
          )}

          {/* ── Valuation + Seller ── */}
          <div class="awv2-grid cols-3-2">
            <section class="awv2-panel">
              <div class="awv2-panel-title">Valuation</div>
              {!val.priceable && <div class="awv2-val-status">Not priceable yet · confidence {val.confidence || 'low'}</div>}
              <div class="awv2-val-figures">
                {perAcre && (
                  <div class="awv2-val-fig">
                    <div class="k">Asking-market indication</div>
                    <div class="v">{usd(perAcre.low)}–{usd(perAcre.high)} / ac</div>
                    {totalLow != null && totalHigh != null && (
                      <div class="s">≈ {usd(totalLow)}–{usd(totalHigh)} across {acres} acres · what sellers ask, not what buyers paid</div>
                    )}
                  </div>
                )}
                {lpEstimate && (
                  <div class="awv2-val-fig">
                    <div class="k">LandPortal estimate</div>
                    <div class="v">{lpEstimate}</div>
                    <div class="s">{lpEstimatePerAcre ? `${lpEstimatePerAcre} / ac · ` : ''}marketplace indication only</div>
                  </div>
                )}
                <div class="awv2-val-fig">
                  <div class="k">Closed-sale evidence</div>
                  <div class="v">{soldCount}</div>
                  <div class="s">{activeCount} active competitor · {askingCount} asking references</div>
                </div>
              </div>

              <div class="awv2-ladder">
                <div class="awv2-ladder-title">Acquisition levels — locked until fair market value is supported</div>
                <div class="awv2-rungs">
                  {[40, 50, 60].map((p) => (
                    <div class="awv2-rung">
                      <div class="pct">{p}%</div>
                      <div class="lbl">of FMV</div>
                      <div class="val">—</div>
                    </div>
                  ))}
                </div>
                <div class="awv2-ladder-note">
                  {val.notPriceableReason || 'Fair market value is not yet supported.'}
                  {' '}<b>To price it: {val.nextActionToPrice || 'confirm one closed in-band sale.'}</b>
                </div>
              </div>

              {(subjPpa || overallPpa) && (
                <div class="awv2-market-context">
                  {subjPpa && (
                    <div class="item">County 10–20 ac band (2026-Q3): <b>${subjPpa}/ac</b>{subjDom ? ` · ${subjDom} days on market` : ''}</div>
                  )}
                  {overallPpa && (
                    <div class="item">County overall: <b>${overallPpa}/ac</b>{overallDom ? ` · ${overallDom} days on market` : ''}</div>
                  )}
                </div>
              )}
            </section>

            <section class="awv2-panel">
              <div class="awv2-panel-title">Seller & lead</div>
              <div class="awv2-kv">
                <span class="k">Seller</span>
                {seller?.name ? <span class="v">{seller.name}</span> : <span class="v empty">Not collected</span>}
                <span class="k">Phone</span>
                {seller?.phone ? <span class="v">{seller.phone}</span> : <span class="v empty">Not collected</span>}
                <span class="k">Email</span>
                {seller?.email ? <span class="v">{seller.email}</span> : <span class="v empty">Not collected</span>}
                <span class="k">Asking price</span>
                {askingPrice != null ? <span class="v">{usd(askingPrice)}</span> : <span class="v empty">Not stated</span>}
                <span class="k">Motivation</span>
                <span class="v empty">Unknown — establish on the next call</span>
                <span class="k">Timeline</span>
                <span class="v empty">Unknown</span>
                <span class="k">Last contact</span>
                <span class="v empty">None yet</span>
                <span class="k">Follow-up</span>
                <span class="v">{followUp || <span class="v empty">None scheduled</span>}</span>
                <span class="k">Discovery call</span>
                <span class="v">{discoveryDone ? 'Captured' : <span class="v empty">Not run</span>}</span>
              </div>
              <div class="awv2-seller-callout">
                <b>This record is intentionally thin.</b> The owner of record is {owner || 'unknown'}; no seller
                contact has been collected yet. The discovery call fills in motivation, timeline, price
                expectation and decision-makers.
              </div>
            </section>
          </div>

          {/* ── Decision summary ── */}
          <section class="awv2-panel">
            <div class="awv2-panel-title">Decision summary</div>
            <div class="awv2-decision">
              <div class="awv2-dec-block">
                <div class="h brass">Primary opportunity</div>
                <p>{snap.headline?.keyOpportunity || '—'}</p>
                <div class="h rust" style="margin-top:14px">Top blockers</div>
                <ul>
                  {(snap.blockers?.length ? snap.blockers : ['None recorded']).map((b) => <li>{b}</li>)}
                </ul>
              </div>
              <div class="awv2-dec-block">
                <div class="h brass">Recommended next action</div>
                <ul>
                  {nextActionLabel && <li><b>{nextActionLabel}</b>{nextActionReason ? ` — ${nextActionReason}` : ''}</li>}
                  {(snap.nextActions || []).map((a) => <li>{a}</li>)}
                </ul>
                <div class="h" style="margin-top:14px">Current strategy</div>
                <div class="awv2-posture">Posture · {rec.posture || '—'}</div>
                <p>{rec.why || rec.postureWhy || ''}</p>
              </div>
              <div class="awv2-dec-block">
                <div class="h">Alternative strategies</div>
                {strategies.slice(0, 5).map((s) => (
                  <div class="awv2-strategy-row">
                    <span class="name">{s.strategy}</span>
                    <span class="st">{s.applicability}</span>
                  </div>
                ))}
                <div class="h" style="margin-top:14px">What unlocks a decision</div>
                <ul>
                  {(rec.nextConfirmations || []).slice(0, 4).map((c) => <li>{c}</li>)}
                </ul>
              </div>
            </div>
          </section>

          {/* ── Missing information (compact) ── */}
          <section class="awv2-missing">
            <div class="awv2-panel-title">Missing information</div>
            <div class="awv2-missing-groups">
              <div class="awv2-missing-group">
                <div class="g">Property</div>
                <div class="awv2-missing-chips">
                  {missingProperty.map((m) => <span class="awv2-chip">{m}</span>)}
                </div>
              </div>
              <div class="awv2-missing-group">
                <div class="g">Valuation</div>
                <div class="awv2-missing-chips">
                  {missingValuation.map((m) => <span class="awv2-chip">{m}</span>)}
                </div>
              </div>
              <div class="awv2-missing-group">
                <div class="g">Seller</div>
                <div class="awv2-missing-chips">
                  {missingSeller.map((m) => <span class="awv2-chip">{m}</span>)}
                </div>
              </div>
            </div>
          </section>
        </main>
        )}
      </div>
    </div>
  );
}

// ── Score card ─────────────────────────────────────────────────────────

function ScoreCard({ title, view }: { title: string; view?: ScoreView }) {
  const score = view?.score ?? null;
  const rating = view?.rating || 'Pending';
  const tone = score == null ? 'pending' : score < 50 ? 'weak' : score < 70 ? 'moderate' : 'strong';
  return (
    <section class="awv2-panel">
      <div class="awv2-panel-title">{title}</div>
      <div class="awv2-score-head">
        <span class={`awv2-score-num ${tone}`}>{score ?? 'Pending'}</span>
        <span class={`awv2-score-rating ${tone}`}>{score == null ? '' : rating}</span>
      </div>
      {score != null && (
        <div class="awv2-meter"><span class={`fill ${tone}`} style={`width:${Math.max(2, Math.min(100, score))}%`} /></div>
      )}
      {view?.explanation && (
        <p class="awv2-score-expl">{view.explanation}</p>
      )}
      {(view?.strongestPositiveFactors || []).slice(0, 2).map((f) => (
        <div class="awv2-reason"><span class="sig plus">+</span><span>{f}</span></div>
      ))}
      {(view?.mainDeductions || []).slice(0, 2).map((f) => (
        <div class="awv2-reason"><span class="sig minus">−</span><span>{f}</span></div>
      ))}
      {score == null && (view?.materiallyChangeWith || []).slice(0, 2).map((f) => (
        <div class="awv2-reason"><span class="sig dot">·</span><span>{f}</span></div>
      ))}
    </section>
  );
}
