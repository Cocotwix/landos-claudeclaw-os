import { useEffect, useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { apiGet, apiPatch, apiPost, dashboardToken } from '@/lib/api';

// Property/Lead Kanban board. Property-centered, not chat-centered: each card is
// a lead/property with all its memory behind it. Display + status moves only;
// no scoring/valuation/offer happens here and parcel identity is never inferred.

interface Card {
  id: number;
  entity: string;
  verification_status: string;
  kanban_status: string;
  active_input_address: string;
  county: string;
  state: string;
  apn: string;
  owner: string;
  lp_url: string;
  summary: string;
  open_risks: string; // JSON array string from the board payload (may be '[]')
  updated_at: number;
  // Workspace-readiness summary (from the board payload): what intelligence this
  // property already has, so the operator can prioritise from the board.
  workspace_has_inspection?: boolean;
  workspace_visual_count?: number;
  workspace_comp_count?: number;
  workspace_seller_question_count?: number;
}

interface CardDetail extends Card {
  priorInputs: string[];
  sourceEvidence: any[];
  activity: any[];
  nextActions: any[];
  facts: any[];
}

interface BoardResponse { columns: Record<string, Card[]>; statuses: string[]; }

interface DealReview {
  id: number;
  title: string;
  status: string;
  package_notes: string;
  propertyCount: number;
  hasVerifiedProperty: boolean;
  hasUnverifiedProperty: boolean;
  risks: string[];
  nextActions: any[];
  compCount: number;
  latestWriteback: string | null;
  latestReportStatus: string | null;
  dukePartial: {
    reportType: string;
    compMode: string;
    reportStatus: string;
    taskStatus: string;
    verificationStatus: string;
    parcelVerificationSummary: string;
    localAreaContext: { allowed: boolean; label: string; note: string };
    dueDiligenceSummary: string;
    anomalyFlags: string[];
    evaluationStatus: string;
    evaluationEngine: { parcelSpecific: boolean; missingFacts: string[]; compSource: string; compLimitation: string; confidenceLabel: string; note: string };
    strategyMatrix: { parcelSpecific: boolean; note: string; strategies: Array<{ id: string; label: string; offerBand: string; minNetProfitUsd: number; confirmed: boolean }> };
    offerReadiness: { status: string; reason: string; offerGuidanceAllowed: boolean; compSource: string; missingFormulaWarning: string | null };
    offerGuidance: { allowed: boolean; note: string; strategyBandsSource: string };
    blockedReason: string | null;
    nextBestAction: string | null;
    discoveryQuestions: string[];
    compCreditUsed: boolean;
    compFallbackUsed: boolean;
    compSourceNote: string;
    noCompCreditUsed: boolean;
  };
  combinedAcreage: { acres: number; verified: boolean; label: string };
  propertyCards: any[];
}

interface FactRow { key: string; label: string; value: string; status: 'verified' | 'needs_verification' }
interface FactSheet {
  apn: string | null; owner: string | null; parcelAddress: string | null;
  city: string | null; stateCode: string | null; county: string | null;
  acres: number | null; acresLabel: string | null;
  access: { label: string; landLocked: string | null; roadFrontage: string | null; roadFrontageFt: number | null };
  buildability: { label: string; pct: string | null; acres: string | null };
  environment: { femaFloodZone: string | null; femaCoveragePct: string | null; wetlandsPct: string | null; label: string };
  water: { present: boolean; label: string | null };
  valuation: {
    lastSalePrice: number | null; lastSalePriceLabel: string | null; lastSaleDate: string | null;
    assessedValue: string | null; totalMarketValue: string | null; taxAmount: string | null;
    lpEstimatePrice: string | null; lpEstimatePpa: string | null;
  };
  centroid: { lat: number | null; lng: number | null };
  snapshot: FactRow[];
  sellerQuestions: string[];
  completeness: { exposed: number; total: number };
}

interface DiscoveryReport {
  parcelVerified: boolean;
  contextLabel: string;
  headline: string;
  confidence: string;
  landportalInspection?: null | {
    parcelUrl: string | null;
    comparablesUrl: string | null;
    parcelFacts: Record<string, string>;
    assets: Array<{ key: string; label: string; kind: string; url: string; timestamp: string; overlay?: string; note?: string }>;
    overlays: Array<{ overlay: string; status: string; note: string; confidence: string; screenshotUrl?: string | null }>;
    visualObservations: Array<{ label: string; detail: string; confidence: string; evidence: string }>;
    comparables: Array<{ rawText: string; sourceUrl: string; apn?: string | null; address?: string | null; acres?: number | null; price?: number | null; pricePerAcre?: number | null; status: string; confidence: string }>;
    discoveryQuestions: string[];
    missingInformation: string[];
    factSheet?: FactSheet;
  };
  comparableIntelligence?: {
    subjectClassification: { type: string; confidence: string; note: string };
    selectedComparables: Array<{ apn?: string | null; address: string | null; acreage: number | null; salePrice: number | null; pricePerAcre: number | null; saleDate: string | null; status: string; source: string; sourceUrl: string | null; confidence: string }>;
    estimatedPricePerAcre: { low: number | null; mid: number | null; high: number | null };
    estimatedMarketValue: { low: number | null; mid: number | null; high: number | null } | null;
    confidence: string;
    evidenceUsed: string[];
    evidenceMissing: string[];
  };
  marketIntelligence?: {
    marketPulse: string;
    confidence: string;
    opportunities: string[];
    risks: string[];
    missingInformation: string[];
  };
  strategyEvaluation: Array<{ strategy: string; verdict: string; potential?: string; reason: string; pricingLogic: string; mainRisk: string; acquisitionRange?: { low: number; high: number } | null }>;
  roughOfferRange: {
    available: boolean;
    marketValue: { low: number | null; mid: number | null; high: number | null } | null;
    acquisition: { low: number | null; high: number | null } | null;
    pricePerAcre: { low: number | null; mid: number | null; high: number | null };
    confidence: string;
    note: string;
  };
}

// Stage -> primary owner role lane. Display only; mirrors the backend routing
// map in src/landos/routing-map.ts (KANBAN_ROUTING). Keep these keys in sync
// with the kanban_status values; a missing key falls back to no owner label.
const STAGE_OWNER: Record<string, string> = {
  new_lead: 'Marketing / Lead Gen',
  needs_parcel_verification: 'Due Diligence',
  needs_seller_discovery: 'Acquisitions',
  researching: 'Due Diligence',
  underwriting: 'Valuation / Comps',
  offer_ready: 'Command Center',
  offer_sent: 'Acquisitions',
  follow_up: 'Acquisitions',
  under_contract: 'Transaction Coordination',
  due_diligence: 'Due Diligence',
  disposition: 'Dispositions',
  closed: 'Transaction Coordination',
  dead: 'Command Center',
  archived: 'Command Center',
};

// Parse a card's open_risks JSON array safely; never throws. Used only to show
// a blocker indicator from data already on the card — no new fetch, no schema.
function parseRisks(openRisks: string | undefined): string[] {
  if (!openRisks) return [];
  try {
    const arr = JSON.parse(openRisks);
    return Array.isArray(arr) ? arr.filter((r) => typeof r === 'string' && r.trim()) : [];
  } catch {
    return [];
  }
}

// Comp source labels / kinds / statuses (mirror the backend model).
const COMP_SOURCE_LABELS = ['LandPortal', 'Zillow', 'Redfin', 'Land.com', 'LandWatch', 'LandsOfAmerica', 'Realtor', 'County', 'Other'] as const;
const COMP_PRICE_KINDS = ['sale', 'list', 'unknown'] as const;
const COMP_STATUSES = ['manual_unverified', 'market_reference', 'verified_sale', 'rejected'] as const;

interface Comp {
  id: number;
  source_label: string;
  source_url: string;
  address_desc: string;
  apn: string;
  county: string;
  state: string;
  price: number | null;
  price_kind: string;
  sale_or_list_date: string;
  acres: number | null;
  price_per_acre: number | null;
  notes: string;
  status: string;
}

const ENTITIES = [
  { id: 'all', label: 'All' },
  { id: 'TY_LAND_BIZ', label: "Ty's Land Biz" },
  { id: 'LAND_ALLY', label: 'Land Ally' },
];

export function PropertyBoard() {
  const [entity, setEntity] = useState('all');
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CardDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [comps, setComps] = useState<Comp[]>([]);
  const [dealReview, setDealReview] = useState<DealReview | null>(null);
  const [discoveryReport, setDiscoveryReport] = useState<DiscoveryReport | null>(null);
  const [showCompForm, setShowCompForm] = useState(false);
  const [compBusy, setCompBusy] = useState(false);
  const emptyComp = {
    sourceLabel: 'Zillow', sourceUrl: '', addressDesc: '', apn: '', county: '', state: '',
    price: '', priceKind: 'sale', saleOrListDate: '', acres: '', notes: '', status: 'manual_unverified',
  };
  const [compForm, setCompForm] = useState<Record<string, string>>({ ...emptyComp });
  const [partialBusy, setPartialBusy] = useState(false);
  const [partialQueued, setPartialQueued] = useState<string | null>(null);
  // Comp source for a Duke Report run. Redfin/Zillow is the default no-credit
  // path; 'landportal_credit' is an explicit per-run approval to spend ONE LP
  // comp credit. The dashboard never spends a credit itself.
  const [compMode, setCompMode] = useState<'redfin_zillow' | 'landportal_credit'>('redfin_zillow');

  function compField(k: string, v: string) {
    setCompForm((f) => ({ ...f, [k]: v }));
  }

  // Run Duke Report: queue a Duke Report for the selected card via the existing
  // mission task system. Comp source is chosen by Tyler. Redfin/Zillow uses no
  // LP comp credit; "LandPortal Comps" carries explicit approval to spend ONE LP
  // comp credit for THIS run only, with a Redfin/Zillow/manual fallback. No Full
  // Report split; no hidden comp spend (the dashboard only records the choice).
  async function runDukeReport() {
    if (!selected) return;
    setPartialBusy(true);
    setPartialQueued(null);
    setError(null);
    try {
      const ident = selected.apn ? `APN ${selected.apn}` : (selected.active_input_address || '(no identifier)');
      const place = [selected.county, selected.state].filter(Boolean).join(', ');
      const compLine = compMode === 'landportal_credit'
        ? 'Comp source: LandPortal Comps. I approve spending ONE LandPortal comp credit for THIS run only. If the comp credit is unavailable, exhausted, blocked, or the comp report fails, fall back to Redfin/Zillow/manual comps and clearly label the comp source/quality.'
        : 'Comp source: Redfin/Zillow (no LandPortal comp credit).';
      // Deterministic machine-readable header the scheduler's Duke Report runner
      // parses (comp mode, card id, and one-run LP comp-credit approval). Only the
      // LandPortal Comps path carries approval; the dashboard never spends a credit.
      const lpApproval = compMode === 'landportal_credit';
      const sentinel = `[[duke_report v1 compMode=${compMode} cardId=${selected.id} lpCompCreditApproval=${lpApproval} source=dashboard]]`;
      const prompt =
        `${sentinel}\n` +
        `Run a Duke Report on: ${ident}${place ? `, ${place}` : ''}. ${compLine} ` +
        `Verify parcel identity first. If it is not verified, return Local Area Context labeled "Local Area Context, Not Parcel Verified", the verification block, and discovery questions only — no parcel-specific scoring, valuation, offer, or strategy.`;
      const res = await apiPost<{ task?: { id: string } }>('/api/mission/tasks', {
        title: `Duke Report (${compMode === 'landportal_credit' ? 'LandPortal Comps' : 'Redfin/Zillow'}): ${ident}`.slice(0, 200),
        prompt,
        assigned_agent: 'duke-due-diligence',
        priority: 5,
      });
      setPartialQueued(res?.task?.id ? `Queued Duke Report (task ${res.task.id}). Track it in Mission Control.` : 'Queued Duke Report.');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setPartialBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<BoardResponse>(`/api/landos/board?entity=${encodeURIComponent(entity)}`);
      setBoard(res);
    } catch (e: any) {
      // The board endpoint may be briefly unavailable (e.g. a backend still
      // rolling out). Degrade to a clean empty board — show "No property cards
      // yet" rather than a red error banner — instead of breaking the page.
      console.warn('Property Board load failed; showing empty board:', e?.message || e);
      setBoard({ columns: {}, statuses: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [entity]);

  async function openCard(id: number) {
    try {
      const res = await apiGet<{ card: CardDetail }>(`/api/landos/property-cards/${id}`);
      setSelected(res.card);
      setShowCompForm(false);
      setCompForm({ ...emptyComp });
      setPartialQueued(null);
      await loadComps(id);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function loadComps(cardId: number) {
    try {
      const res = await apiGet<{ dealCardId: number | null; comps: Comp[] }>(`/api/landos/property-cards/${cardId}/comps`);
      setComps(res.comps || []);
      if (res.dealCardId) {
        try {
          const dr = await apiGet<{ dealCard: DealReview }>(`/api/landos/deal-cards/${res.dealCardId}`);
          setDealReview(dr.dealCard);
          const report = await apiGet<{ discoveryReport?: DiscoveryReport }>(`/api/landos/deal-cards/${res.dealCardId}/report`);
          setDiscoveryReport(report.discoveryReport ?? null);
        } catch {
          setDealReview(null);
          setDiscoveryReport(null);
        }
      } else {
        setDealReview(null);
        setDiscoveryReport(null);
      }
    } catch {
      setComps([]);
      setDealReview(null);
      setDiscoveryReport(null);
    }
  }

  // Save a manual comp to the selected property card's Deal Card. Never changes
  // verification status, identity, owner, contiguity, or facts.
  async function saveComp() {
    if (!selected) return;
    setCompBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        sourceLabel: compForm.sourceLabel,
        sourceUrl: compForm.sourceUrl.trim(),
        addressDesc: compForm.addressDesc.trim(),
        apn: compForm.apn.trim(),
        county: compForm.county.trim(),
        state: compForm.state.trim(),
        priceKind: compForm.priceKind,
        saleOrListDate: compForm.saleOrListDate.trim(),
        notes: compForm.notes.trim(),
        status: compForm.status,
        addedBy: 'tyler/manual',
      };
      const price = parseFloat(compForm.price);
      if (Number.isFinite(price)) payload.price = price;
      const acres = parseFloat(compForm.acres);
      if (Number.isFinite(acres)) payload.acres = acres;
      await apiPost(`/api/landos/property-cards/${selected.id}/comps`, payload);
      setShowCompForm(false);
      setCompForm({ ...emptyComp });
      await loadComps(selected.id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCompBusy(false);
    }
  }

  async function moveCard(id: number, status: string) {
    setBusy(true);
    try {
      await apiPatch(`/api/landos/property-cards/${id}`, { kanbanStatus: status });
      await load();
      if (selected?.id === id) await openCard(id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const statuses = board?.statuses ?? [];
  const nonEmpty = statuses.filter((s) => (board?.columns[s]?.length ?? 0) > 0);
  const columnsToShow = nonEmpty.length ? nonEmpty : statuses.slice(0, 6);

  return (
    <div class="h-full flex flex-col">
      <PageHeader
        title="Property Board"
        breadcrumb="Workspace"
        tabs={ENTITIES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEntity(e.id)}
            class={[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors',
              entity === e.id ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
            ].join(' ')}
          >
            {e.label}
          </button>
        ))}
        actions={
          <button type="button" onClick={() => void load()} class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw size={12} /> Refresh
          </button>
        }
      />

      <div class="flex-1 overflow-auto p-4">
        {error && <div class="text-[12px] text-[var(--color-status-failed)] mb-3">{error}</div>}
        {loading && <PageState loading />}
        {!loading && columnsToShow.every((s) => (board?.columns[s]?.length ?? 0) === 0) && (
          <PageState empty emptyTitle="No property cards yet" emptyDescription="Run Duke on a property address (chat, Mission Control, or batch intake) to create the first Property Card." />
        )}
        {!loading && (
          <div class="flex gap-3 min-w-max">
            {columnsToShow.map((status) => (
              <div key={status} class="w-64 flex-shrink-0">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2 flex items-center justify-between">
                  <span>{status.replace(/_/g, ' ')}</span>
                  <span>{board?.columns[status]?.length ?? 0}</span>
                </div>
                {STAGE_OWNER[status] && (
                  <div class="text-[9.5px] text-[var(--color-text-faint)] mb-2 -mt-1.5">owner: {STAGE_OWNER[status]}</div>
                )}
                <div class="space-y-2">
                  {(board?.columns[status] ?? []).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => void openCard(card.id)}
                      class="w-full text-left bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-2.5 hover:border-[var(--color-accent)] transition-colors"
                    >
                      <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                        <Pill tone={card.verification_status === 'verified_property' ? 'done' : card.verification_status === 'rejected_mismatch' ? 'failed' : 'neutral'}>
                          {card.verification_status === 'verified_property' ? 'verified' : card.verification_status === 'unverified_lead' ? 'unverified' : card.verification_status}
                        </Pill>
                        {parseRisks(card.open_risks).length > 0 && (
                          <Pill tone="failed">⚠ {parseRisks(card.open_risks).length} blocker{parseRisks(card.open_risks).length === 1 ? '' : 's'}</Pill>
                        )}
                      </div>
                      <div class="text-[12px] text-[var(--color-text)] truncate">{card.active_input_address || '(no address)'}</div>
                      <div class="text-[10px] text-[var(--color-text-faint)] truncate">
                        {[card.county, card.state].filter(Boolean).join(', ')}
                      </div>
                      {(card.workspace_has_inspection || card.workspace_visual_count || card.workspace_comp_count || card.workspace_seller_question_count) ? (
                        <div class="mt-2 flex flex-wrap gap-1">
                          {card.workspace_has_inspection ? <span class="text-[9.5px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]" title="This property has an inspection on file">Inspection</span> : null}
                          {card.workspace_visual_count ? <span class="text-[9.5px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]" title="Captured visuals (satellite / street / overlays)">{card.workspace_visual_count} visual{card.workspace_visual_count === 1 ? '' : 's'}</span> : null}
                          {card.workspace_comp_count ? <span class="text-[9.5px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]" title="Comparable sales collected">{card.workspace_comp_count} comp{card.workspace_comp_count === 1 ? '' : 's'}</span> : null}
                          {card.workspace_seller_question_count ? <span class="text-[9.5px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]" title="Seller/discovery questions prepared">{card.workspace_seller_question_count} seller Q{card.workspace_seller_question_count === 1 ? '' : 's'}</span> : null}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={() => setSelected(null)}>
          <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl w-[92vw] h-[92vh] max-w-[1440px] overflow-y-auto p-5 sm:p-6 space-y-4 text-[13px]" onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone={selected.verification_status === 'verified_property' ? 'done' : 'neutral'}>{selected.verification_status}</Pill>
              <span class="text-[14px] font-semibold text-[var(--color-text)]">{selected.active_input_address}</span>
              <span class="text-[10px] text-[var(--color-text-faint)]">card {selected.id}</span>
              {/* Run Duke Report with a chosen comp source. Redfin/Zillow uses no
                  comp credit; LandPortal Comps spends one LP comp credit for this
                  run (explicit approval). No Partial-vs-Full split; no hidden spend. */}
              <div class="hidden">
                <div class="flex items-center rounded-md overflow-hidden border border-[var(--color-border)] text-[10px]">
                  <button
                    type="button"
                    onClick={() => setCompMode('redfin_zillow')}
                    class={['px-2 py-1', compMode === 'redfin_zillow' ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'].join(' ')}
                    title="Default comp source — no LandPortal comp credit"
                  >
                    Redfin/Zillow
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompMode('landportal_credit')}
                    class={['px-2 py-1', compMode === 'landportal_credit' ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'].join(' ')}
                    title="Spends ONE LandPortal comp credit for this run"
                  >
                    LandPortal Comps (1 credit)
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void runDukeReport()}
                  disabled={partialBusy}
                  class="text-[11px] px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
                >
                  {partialBusy ? 'Queuing…' : 'Run Duke Report'}
                </button>
              </div>
            </div>
            {partialQueued && <div class="text-[11px] text-[var(--color-text-muted)]">{partialQueued}</div>}
            {selected.summary && <p class="text-[12px] text-[var(--color-text-muted)]">{selected.summary}</p>}

            <div class="flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
              {selected.apn && <span>APN <span class="text-[var(--color-text)]">{selected.apn}</span></span>}
              {selected.owner && <span>Record Owner <span class="text-[var(--color-text)]">{selected.owner}</span></span>}
              {selected.lp_url && (
                <a
                  href={selected.lp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[var(--color-accent)] hover:underline"
                >
                  Open in LandPortal ↗
                </a>
              )}
            </div>

            <OperatorInspectionBrief selected={selected} discoveryReport={discoveryReport} manualComps={comps} />

            {false && dealReview && (
              <div class="border border-[var(--color-border)] rounded-lg p-3 space-y-2 bg-[var(--color-bg)]">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Deal Review</span>
                  <span class="text-[12.5px] text-[var(--color-text)] font-medium">{dealReview.title || `Deal ${dealReview.id}`}</span>
                  <Pill tone={dealReview.hasVerifiedProperty && !dealReview.hasUnverifiedProperty ? 'done' : 'neutral'}>
                    {dealReview.hasVerifiedProperty && !dealReview.hasUnverifiedProperty ? 'verified' : 'research / unverified'}
                  </Pill>
                  {dealReview.latestReportStatus && (
                    <Pill tone={dealReview.latestReportStatus === 'failed' ? 'failed' : dealReview.hasVerifiedProperty && !dealReview.hasUnverifiedProperty ? 'done' : 'neutral'}>
                      Duke Report
                    </Pill>
                  )}
                  {/* Comp source / status. Redfin/Zillow is the default no-credit path. */}
                  <span class="text-[10px] text-[var(--color-text-faint)]">
                    Comp: {dealReview.dukePartial?.compMode === 'landportal_credit' ? 'LandPortal' : 'Redfin/Zillow'}
                    {dealReview.dukePartial?.compFallbackUsed ? ' (fell back to Redfin/Zillow)' : ''}
                    {' · '}{dealReview.dukePartial?.compCreditUsed ? 'comp credit used' : 'no comp credit used'}
                  </span>
                  <span class="text-[10px] text-[var(--color-text-faint)]">
                    {dealReview.propertyCount} propert{dealReview.propertyCount === 1 ? 'y' : 'ies'}/APN · {dealReview.compCount} comp{dealReview.compCount === 1 ? '' : 's'}
                  </span>
                </div>

                {dealReview.hasUnverifiedProperty && (
                  <div class="text-[11px] text-[var(--color-status-failed)] bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] rounded-md px-2 py-1.5">
                    <span class="font-medium">Blocked before valuation / offer.</span> Research / unverified parcel(s) present. Confirm APN + county/state/FIPS, or LandPortal property ID + FIPS, before scoring, valuing, or offer guidance.
                  </div>
                )}

                {/* Local Area Context label when the parcel is not verified. */}
                {dealReview.dukePartial?.localAreaContext?.label && (
                  <div class="text-[10px] text-[var(--color-text-faint)] italic">{dealReview.dukePartial.localAreaContext.label} — {dealReview.dukePartial.localAreaContext.note}</div>
                )}

                {/* Evaluation engine — parcel-specific only when verified. */}
                {dealReview.dukePartial?.evaluationEngine && (
                  <div class="text-[11px] text-[var(--color-text-muted)]">
                    <span class="uppercase tracking-wider text-[10px] text-[var(--color-text-faint)]">Evaluation engine</span>
                    <div>{dealReview.dukePartial.evaluationStatus} — {dealReview.dukePartial.evaluationEngine.note}</div>
                  </div>
                )}

                {/* Strategy matrix — parcel-specific only when verified. */}
                {dealReview.dukePartial?.strategyMatrix?.parcelSpecific
                  ? <DetailList title="Strategy matrix" items={dealReview.dukePartial.strategyMatrix.strategies.map((s) => `${s.label}: ${s.offerBand}${s.confirmed ? '' : ' (unconfirmed)'}`)} />
                  : <div class="text-[10px] text-[var(--color-text-faint)]">Strategy matrix: {dealReview.dukePartial?.strategyMatrix?.note}</div>}

                {/* Offer readiness — never shows offer guidance when blocked. */}
                {dealReview.dukePartial?.offerReadiness && (
                  <div class="text-[11px] text-[var(--color-text-muted)]">
                    <span class="uppercase tracking-wider text-[10px] text-[var(--color-text-faint)]">Offer readiness</span>
                    <div>{dealReview.dukePartial.offerReadiness.status} — {dealReview.dukePartial.offerReadiness.reason}</div>
                    {dealReview.dukePartial.offerReadiness.missingFormulaWarning && (
                      <div class="text-[var(--color-status-failed)]">Missing formula/rule: {dealReview.dukePartial.offerReadiness.missingFormulaWarning}</div>
                    )}
                    {dealReview.dukePartial.offerGuidance?.allowed && (
                      <div>{dealReview.dukePartial.offerGuidance.note}</div>
                    )}
                  </div>
                )}

                {dealReview.dukePartial?.discoveryQuestions?.length > 0 && (
                  <DetailList title="Discovery questions" items={dealReview.dukePartial.discoveryQuestions} />
                )}
                {dealReview.dukePartial?.compSourceNote && (
                  <div class="text-[10px] text-[var(--color-text-faint)]">{dealReview.dukePartial.compSourceNote}</div>
                )}

                <div class="space-y-1">
                  <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Properties / APNs</div>
                  <ul class="space-y-1">
                    {dealReview.propertyCards.map((p: any) => (
                      <li key={p.id} class="text-[11.5px] flex items-center gap-2 flex-wrap">
                        <Pill tone={p.verification_status === 'verified_property' ? 'done' : 'neutral'}>
                          {p.verification_status === 'verified_property' ? 'verified' : 'research'}
                        </Pill>
                        <span class="text-[var(--color-text)]">{p.apn || p.active_input_address || '(no APN)'}</span>
                        <span class="text-[var(--color-text-faint)]">{[p.county, p.state].filter(Boolean).join(', ')}</span>
                        {typeof p.acres === 'number' && <span class="text-[var(--color-text-muted)]">{p.acres} ac</span>}
                        {p.owner && <span class="text-[var(--color-text-muted)]">owner: {p.owner}</span>}
                        {p.lp_url && <a href={p.lp_url} target="_blank" rel="noopener noreferrer" class="text-[var(--color-accent)] hover:underline">LandPortal ↗</a>}
                      </li>
                    ))}
                  </ul>
                </div>

                {dealReview.risks.length > 0 && (
                  <DetailList title="Risks / anomaly flags" items={dealReview.risks} />
                )}
                {dealReview.nextActions.length > 0 && (
                  <DetailList title="Next actions" items={dealReview.nextActions.map((n: any) => `${n.action} (${n.status})`)} />
                )}
                {dealReview.latestWriteback && (
                  <div class="text-[11px] text-[var(--color-text-muted)]">
                    <span class="uppercase tracking-wider text-[10px] text-[var(--color-text-faint)]">Latest Duke writeback</span>
                    <div>{dealReview.latestWriteback}</div>
                  </div>
                )}
              </div>
            )}

            <label class="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
              Move to
              <select
                value={selected.kanban_status}
                disabled={busy}
                onChange={(e) => void moveCard(selected.id, (e.target as HTMLSelectElement).value)}
                class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
              >
                {statuses.map((s) => <option value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </label>

            {selected.priorInputs.length > 0 && (
              <div class="text-[11px] text-[var(--color-text-muted)]">
                <span class="uppercase tracking-wider text-[10px] text-[var(--color-text-faint)]">Prior inputs</span>
                <div>{selected.priorInputs.join(' · ')}</div>
              </div>
            )}

            {/* Engineering / audit detail — collapsed out of the primary operator
                view (no browser-escalation noise or workflow internals up front). */}
            <details class="border-t border-[var(--color-border)] pt-2">
              <summary class="text-[11px] cursor-pointer text-[var(--color-text-faint)] uppercase tracking-wider">Activity &amp; audit log</summary>
              <div class="pt-2 space-y-2">
                <DetailList title="Next actions" items={selected.nextActions.map((n: any) => `${n.action} (${n.status})`)} />
                <DetailList title="Source evidence" items={selected.sourceEvidence.map((s: any) => `${s.fact} — ${s.source_type}${s.usable_for_offer_logic ? ' (offer-usable)' : ''}`)} />
                <DetailList title="Facts" items={selected.facts.map((f: any) => `${f.fact}: ${f.value} [${f.label}]`)} />
                <DetailList title="Activity" items={selected.activity.map((a: any) => `${a.agent_id}: ${a.summary}`)} />
              </div>
            </details>

            {/* Comps — manual entry. A comp never verifies the parcel or changes
                identity/owner/contiguity/verification; source + status stay visible. */}
            <div class="border-t border-[var(--color-border)] pt-3 space-y-2">
              <div class="flex items-center justify-between">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Comps</div>
                <button
                  type="button"
                  onClick={() => setShowCompForm((v) => !v)}
                  class="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
                >
                  {showCompForm ? 'Cancel' : 'Add Manual Comp'}
                </button>
              </div>

              {comps.length === 0 && !showCompForm && (
                <div class="text-[12px] text-[var(--color-text-muted)]">No manually-added comps. Market comps appear above in Comparable Intelligence.</div>
              )}

              {comps.length > 0 && (
                <ul class="space-y-1.5">
                  {comps.map((cp) => (
                    <li key={cp.id} class="text-[11.5px] border border-[var(--color-border)] rounded-md p-2">
                      <div class="flex items-center gap-2 flex-wrap">
                        <Pill tone="neutral">{cp.source_label}</Pill>
                        {typeof cp.price === 'number' && (
                          <span class="text-[var(--color-text)]">{formatMoney(cp.price)} <span class="text-[var(--color-text-faint)]">({cp.price_kind})</span></span>
                        )}
                        {typeof cp.acres === 'number' && <span class="text-[var(--color-text-muted)]">{cp.acres} ac</span>}
                        {typeof cp.price_per_acre === 'number' && (
                          <span class="text-[var(--color-text-muted)]">{formatMoney(cp.price_per_acre)}/ac</span>
                        )}
                        {cp.sale_or_list_date && <span class="text-[var(--color-text-faint)]">{cp.sale_or_list_date}</span>}
                        <Pill tone={cp.status === 'verified_sale' ? 'done' : cp.status === 'rejected' ? 'failed' : 'neutral'}>{cp.status}</Pill>
                        {cp.source_url && (
                          <a href={cp.source_url} target="_blank" rel="noopener noreferrer" class="text-[var(--color-accent)] hover:underline">source ↗</a>
                        )}
                      </div>
                      {(cp.address_desc || cp.notes) && (
                        <div class="text-[var(--color-text-muted)] mt-0.5">{[cp.address_desc, cp.notes].filter(Boolean).join(' — ')}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {showCompForm && (
                <div class="border border-[var(--color-border)] rounded-md p-2.5 space-y-2 bg-[var(--color-bg)]">
                  <div class="grid grid-cols-2 gap-2">
                    <CompSelect label="Source" value={compForm.sourceLabel} options={COMP_SOURCE_LABELS as readonly string[]} onChange={(v) => compField('sourceLabel', v)} />
                    <CompSelect label="Price kind" value={compForm.priceKind} options={COMP_PRICE_KINDS as readonly string[]} onChange={(v) => compField('priceKind', v)} />
                    <CompInput label="Price" value={compForm.price} onChange={(v) => compField('price', v)} placeholder="42000" type="number" />
                    <CompInput label="Acres" value={compForm.acres} onChange={(v) => compField('acres', v)} placeholder="5" type="number" />
                    <CompInput label="Sale/List date" value={compForm.saleOrListDate} onChange={(v) => compField('saleOrListDate', v)} placeholder="2026-03-01" />
                    <CompSelect label="Status" value={compForm.status} options={COMP_STATUSES as readonly string[]} onChange={(v) => compField('status', v)} />
                    <CompInput label="APN" value={compForm.apn} onChange={(v) => compField('apn', v)} />
                    <CompInput label="County" value={compForm.county} onChange={(v) => compField('county', v)} />
                    <CompInput label="State" value={compForm.state} onChange={(v) => compField('state', v)} />
                    <CompInput label="Source URL" value={compForm.sourceUrl} onChange={(v) => compField('sourceUrl', v)} placeholder="https://..." />
                  </div>
                  <CompInput label="Address / description" value={compForm.addressDesc} onChange={(v) => compField('addressDesc', v)} />
                  <CompInput label="Notes" value={compForm.notes} onChange={(v) => compField('notes', v)} />
                  {parsedPpaPreview(compForm.price, compForm.acres) && (
                    <div class="text-[11px] text-[var(--color-text-muted)]">Price per acre: {parsedPpaPreview(compForm.price, compForm.acres)}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveComp()}
                    disabled={compBusy}
                    class="text-[12px] px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
                  >
                    {compBusy ? 'Saving…' : 'Save comp'}
                  </button>
                </div>
              )}
            </div>

            <button type="button" onClick={() => setSelected(null)} class="text-[12px] px-3 py-1.5 rounded-md bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{title}</div>
      <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
        {items.map((i, idx) => <li key={idx}>{i}</li>)}
      </ul>
    </div>
  );
}

function withToken(url: string): string {
  if (!url.startsWith('/api/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
}

type GalleryImage = { url: string; label: string; kind: string; note?: string };
type UnifiedComp = { source: string; apn: string | null; address: string | null; acres: number | null; price: number | null; ppa: number | null; status: string; confidence: string };

const GALLERY_ORDER = ['parcel_page', 'parcel_boundary', 'comparables_map', 'google', 'parcel_3d', 'overlay'];

// Build the visual gallery from LandPortal inspection assets, suppressing
// duplicates by label+kind and by URL so three near-identical captures never
// read as three distinct pieces of evidence.
function buildGallery(inspection: DiscoveryReport['landportalInspection'] | null | undefined): GalleryImage[] {
  const assets = inspection?.assets ?? [];
  const sorted = [...assets].sort((a, b) => {
    const ai = GALLERY_ORDER.indexOf(a.kind); const bi = GALLERY_ORDER.indexOf(b.kind);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const seen = new Set<string>();
  const out: GalleryImage[] = [];
  for (const a of sorted) {
    const label = a.label || a.kind;
    const sig = `${label}|${a.kind}`.toLowerCase();
    if (seen.has(sig) || seen.has(a.url)) continue;
    seen.add(sig); seen.add(a.url);
    out.push({ url: withToken(a.url), label, kind: a.kind, note: a.note });
  }
  return out;
}

// ONE normalized comparable dataset feeding all comp displays. LandPortal comps
// first (selected/normalized), then manual comps, deduped by APN, then by
// price+acres, then by address. No comp appears twice under different sources.
function buildUnifiedComps(discoveryReport: DiscoveryReport | null, manualComps: Comp[]): UnifiedComp[] {
  const rows: UnifiedComp[] = [];
  const ci = discoveryReport?.comparableIntelligence;
  const lp = (ci?.selectedComparables?.length ? ci.selectedComparables : null)
    ?? (discoveryReport?.landportalInspection?.comparables ?? []).map((c) => ({
      apn: c.apn ?? null, address: c.address ?? null, acreage: c.acres ?? null,
      salePrice: c.price ?? null, pricePerAcre: c.pricePerAcre ?? null, saleDate: null,
      status: c.status, source: 'LandPortal', sourceUrl: c.sourceUrl, confidence: c.confidence,
    }));
  for (const c of lp) rows.push({ source: c.source || 'LandPortal', apn: c.apn ?? null, address: c.address ?? null, acres: c.acreage ?? null, price: c.salePrice ?? null, ppa: c.pricePerAcre ?? null, status: c.status, confidence: c.confidence });
  for (const m of manualComps) rows.push({ source: m.source_label, apn: m.apn || null, address: m.address_desc || null, acres: m.acres, price: m.price, ppa: m.price_per_acre, status: m.status, confidence: 'manual' });
  const seen = new Set<string>();
  const out: UnifiedComp[] = [];
  for (const r of rows) {
    const key = r.apn ? `apn:${r.apn.toLowerCase()}`
      : (r.price != null && r.acres != null) ? `pa:${r.price}:${r.acres}`
      : r.address ? `ad:${r.address.toLowerCase()}`
      : `x:${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

function Lightbox({ images, index, onClose, onNav }: { images: GalleryImage[]; index: number; onClose: () => void; onNav: (i: number) => void }) {
  const img = images[index];
  if (!img) return null;
  const prev = () => onNav((index - 1 + images.length) % images.length);
  const next = () => onNav((index + 1) % images.length);
  return (
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button type="button" onClick={(e) => { e.stopPropagation(); prev(); }} class="absolute left-4 text-white/80 hover:text-white text-3xl px-3 py-2" aria-label="Previous">‹</button>
      <figure class="m-0 max-w-[88vw] max-h-[88vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <img src={img.url} alt={img.label} class="max-w-[88vw] max-h-[80vh] object-contain rounded-lg border border-white/20" />
        <figcaption class="text-[13px] text-white/90 mt-2 text-center">{img.label} <span class="text-white/50">({index + 1}/{images.length})</span>{img.note ? <div class="text-[11px] text-white/50">{img.note}</div> : null}</figcaption>
      </figure>
      <button type="button" onClick={(e) => { e.stopPropagation(); next(); }} class="absolute right-4 text-white/80 hover:text-white text-3xl px-3 py-2" aria-label="Next">›</button>
      <button type="button" onClick={onClose} class="absolute top-4 right-4 text-white/80 hover:text-white text-[13px] px-3 py-1.5 rounded-md border border-white/30">Close ✕</button>
    </div>
  );
}

function potentialTone(p: string): string {
  return p === 'High Potential' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : p === 'Moderate Potential' ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
    : p === 'Low Potential' ? 'text-[var(--color-text-muted)] border-[var(--color-border)]'
    : 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
}

function ReadinessChip({ label, tone }: { label: string; tone: 'good' | 'warn' | 'neutral' }) {
  const cls = tone === 'good' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : tone === 'warn' ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
    : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return <span class={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

function WorkspaceSection({ title, children, accent }: { title: string; children: any; accent?: boolean }) {
  return (
    <section class={`rounded-lg border p-4 space-y-2 ${accent ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'} bg-[var(--color-bg)]`}>
      <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{title}</div>
      {children}
    </section>
  );
}

function OperatorInspectionBrief({ selected, discoveryReport, manualComps }: { selected: CardDetail; discoveryReport: DiscoveryReport | null; manualComps: Comp[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const inspection = discoveryReport?.landportalInspection ?? null;
  const fs = inspection?.factSheet;
  const compIntel = discoveryReport?.comparableIntelligence;
  const marketIntel = discoveryReport?.marketIntelligence;
  const strategies = discoveryReport?.strategyEvaluation ?? [];
  const topStrategy = strategies.find((s) => s.verdict === 'viable') ?? strategies.find((s) => s.verdict === 'maybe');
  const gallery = buildGallery(inspection);
  const unifiedComps = buildUnifiedComps(discoveryReport, manualComps);

  // Comp Sources status — which sources were attempted and what each returned.
  // Counts come from the unified table; per-source result (blocked/none/error)
  // from the persisted status activities. Operator-facing, not the full log.
  const srcCount = (name: string) => unifiedComps.filter((c) => c.source === name).length;
  const parseExtStatus = (kind: string): { status: string; count: number } | null => {
    const a = (selected.activity ?? []).find((x: any) => x.kind === kind);
    const m = a && String((a as any).summary || '').match(/comps:\s*([a-z]+)\s*[—-]\s*(\d+)/i);
    return m ? { status: m[1].toLowerCase(), count: Number(m[2]) } : null;
  };
  const extSource = (name: string, kind: string): { name: string; text: string; ok: boolean } | null => {
    const shown = srcCount(name);
    const st = parseExtStatus(kind);
    if (!st) return shown > 0 ? { name, text: `✓ ${shown} land comps`, ok: true } : null;
    if (st.status === 'retrieved') return { name, text: `✓ ${shown || st.count} land comps`, ok: true };
    if (st.status === 'blocked') return { name, text: 'blocked', ok: false };
    if (st.status === 'none') return { name, text: 'none found', ok: false };
    if (st.status === 'error') return { name, text: 'unavailable', ok: false };
    if (st.status === 'disabled') return { name, text: 'not run', ok: false };
    return { name, text: st.status, ok: false };
  };
  const lpCompCount = srcCount('LandPortal');
  const compSources = [
    { name: 'LandPortal', text: lpCompCount > 0 ? `✓ ${lpCompCount} listed comps` : 'none', ok: lpCompCount > 0 },
    extSource('Zillow', 'zillow_comp_status'),
    extSource('Redfin', 'redfin_comp_status'),
  ].filter((s): s is { name: string; text: string; ok: boolean } => !!s);

  if (!discoveryReport) {
    return (
      <div class="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg)] text-[13px] text-[var(--color-text-muted)]">
        Acquisition workspace is not loaded yet. Refresh the card after the property report finishes.
      </div>
    );
  }

  // Market value read (Low confidence — LandPortal listed/asking evidence).
  const compPrices = unifiedComps.map((c) => c.price).filter((n): n is number => typeof n === 'number' && n > 0).sort((a, b) => a - b);
  // Prefer the analytical estimate band over the raw min/max spread (tighter, less
  // skewed by a single outlier comp), falling back to the comp range.
  const mvLow = compIntel?.estimatedMarketValue?.low ?? compPrices[0] ?? null;
  const mvHigh = compIntel?.estimatedMarketValue?.high ?? compPrices[compPrices.length - 1] ?? null;
  const mvMid = compIntel?.estimatedMarketValue?.mid
    ?? (fs?.valuation.lpEstimatePrice ? Number(fs.valuation.lpEstimatePrice.replace(/[^0-9.]/g, '')) : null)
    ?? (mvLow != null && mvHigh != null ? Math.round((mvLow + mvHigh) / 2) : null);
  const noSoldComps = unifiedComps.every((c) => c.status !== 'sold' && c.status !== 'verified_sale');

  // Decision-first read: recommended strategy (highest potential), offer range,
  // top concerns / opportunities. This is what Tyler looks at before dialing.
  const potentialRank: Record<string, number> = { 'High Potential': 3, 'Moderate Potential': 2, 'Low Potential': 1, 'Not Recommended': 0 };
  const ranked = [...strategies].sort((a, b) => (potentialRank[b.potential || ''] || 0) - (potentialRank[a.potential || ''] || 0));
  const recommended = ranked.find((s) => (potentialRank[s.potential || ''] || 0) >= 2) ?? ranked[0];
  const offerRange = recommended?.acquisitionRange
    ?? discoveryReport.roughOfferRange?.acquisition
    ?? (mvMid != null ? { low: Math.round(0.4 * mvMid), high: Math.round(0.6 * mvMid) } : null);
  const concerns = [
    // Never imply comps are missing when LandPortal comps exist — filter comp-gap
    // noise and state the real reason confidence is low (asking vs sold evidence).
    ...(marketIntel?.risks ?? []).filter((r) => !/comparable evidence gap|no comp|missing comp|gather comp|comp band/i.test(r)),
    ...(fs && fs.access.landLocked && /yes/i.test(fs.access.landLocked) ? ['Parcel may be landlocked — confirm legal access.'] : []),
    'Pricing confidence is low — current evidence is LandPortal listed/asking comps; sold comp support still needed.',
  ].slice(0, 3);
  const opportunities = [
    ...(marketIntel?.opportunities ?? []),
    ...(fs && fs.water.present ? [`${fs.water.label} — potential amenity/appeal (verify easements).`] : []),
    ...(fs && fs.buildability.pct ? [`${fs.buildability.pct} buildable, ${fs.environment.femaFloodZone && /not in/i.test(fs.environment.femaFloodZone) ? 'not in a flood hazard area' : 'low mapped environmental constraint'}.`] : []),
  ].slice(0, 3);

  return (
    <div class="space-y-4">
      {lightbox != null && <Lightbox images={gallery} index={lightbox} onClose={() => setLightbox(null)} onNav={setLightbox} />}

      {/* Discovery Snapshot — the decision-first read */}
      <WorkspaceSection title="Discovery Snapshot" accent>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          <div class="text-[13px]"><span class="text-[var(--color-text-faint)]">Can I buy this?</span> <span class="text-[var(--color-text)]">{discoveryReport.parcelVerified ? 'Yes — parcel identity verified, discovery call can proceed.' : 'Not yet — verify the exact parcel before pricing with conviction.'}</span></div>
          <div class="text-[13px]"><span class="text-[var(--color-text-faint)]">Recommended strategy</span> <span class="text-[var(--color-text)]">{recommended ? `${recommended.strategy}` : '—'}</span>{recommended?.potential ? <span class={`ml-1.5 text-[11px] px-2 py-0.5 rounded-full border ${potentialTone(recommended.potential)}`}>{recommended.potential}</span> : null}</div>
          <div class="text-[13px]"><span class="text-[var(--color-text-faint)]">Estimated Market Value</span> <span class="text-[var(--color-text)]">{mvLow != null && mvHigh != null ? `${formatMoney(mvLow)} – ${formatMoney(mvHigh)}` : mvMid != null ? formatMoney(mvMid) : 'Needs comps'}</span> <span class="text-[var(--color-accent)] text-[11px]">Low confidence</span></div>
          <div class="text-[13px]"><span class="text-[var(--color-text-faint)]">Recommended Offer Range</span> <span class="text-[var(--color-status-done)] font-semibold">{offerRange ? `${formatMoney(offerRange.low)} – ${formatMoney(offerRange.high)}` : '—'}</span> <span class="text-[var(--color-text-faint)] text-[11px]">(40–60% of value)</span></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 pt-1">
          <div class="text-[12px]"><span class="text-[var(--color-status-failed)]">Top concerns</span><ul class="list-disc pl-5 text-[var(--color-text-muted)]">{concerns.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          <div class="text-[12px]"><span class="text-[var(--color-status-done)]">Top opportunities</span><ul class="list-disc pl-5 text-[var(--color-text-muted)]">{opportunities.length ? opportunities.map((o, i) => <li key={i}>{o}</li>) : <li>Clean infill lot — see snapshot.</li>}</ul></div>
        </div>
      </WorkspaceSection>

      {/* Acquisition Readiness */}
      <WorkspaceSection title="Acquisition Readiness" accent>
        <div class="text-[13px] text-[var(--color-text)]">
          {discoveryReport.parcelVerified
            ? 'Parcel identity verified. Discovery call can proceed. Pricing confidence is low because current valuation is based on listed or asking evidence, not confirmed sold comps.'
            : 'Parcel identity is not verified. Confirm the exact parcel (APN + county, official record, or LandPortal property ID + FIPS) before discussing price with conviction.'}
        </div>
        <div class="flex flex-wrap gap-1.5 pt-0.5">
          {discoveryReport.parcelVerified && <ReadinessChip label="Ready for discovery call" tone="good" />}
          <ReadinessChip label="Low pricing confidence" tone="warn" />
          {noSoldComps && <ReadinessChip label="Needs sold comp support" tone="warn" />}
          <ReadinessChip label="Needs utility verification" tone="warn" />
          <ReadinessChip label="No obvious fatal issue found in first-pass review" tone="neutral" />
        </div>
        {topStrategy && <div class="text-[12px] text-[var(--color-text-muted)] pt-1"><span class="text-[var(--color-text)]">Strongest path:</span> {topStrategy.strategy} — {topStrategy.reason}</div>}
      </WorkspaceSection>

      {/* Visuals */}
      <WorkspaceSection title="Visuals">
        {gallery.length ? (
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            {gallery.map((img, i) => (
              <figure key={img.url} class="m-0 cursor-zoom-in group" onClick={() => setLightbox(i)}>
                <img src={img.url} alt={img.label} class="w-full h-44 object-cover rounded-lg border border-[var(--color-border)] group-hover:border-[var(--color-accent)] transition-colors" loading="lazy" />
                <figcaption class="text-[11px] text-[var(--color-text-muted)] mt-1">{img.label}{img.kind === 'overlay' ? ' · visual signal only' : ''}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div class="text-[12px] text-[var(--color-text-muted)]">No LandPortal visuals captured yet.</div>
        )}
        <div class="text-[11px] text-[var(--color-text-faint)]">LandPortal parcel + comps map + overlays and Google Aerial / Street View. Overlays and Google imagery are Visual Signal, Not Verified Fact.</div>
      </WorkspaceSection>

      {/* Property Snapshot */}
      <WorkspaceSection title="Property Snapshot">
        {fs ? (
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {fs.snapshot.map((row) => (
              <div key={row.key} class="text-[12.5px] flex gap-2">
                <span class="text-[var(--color-text-faint)] w-36 shrink-0">{row.label}</span>
                <span class={row.status === 'verified' ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)] italic'}>{row.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div class="text-[12px] text-[var(--color-text-muted)]">Parcel fact sheet not available — re-run the property inspection.</div>
        )}
      </WorkspaceSection>

      {/* Comparable Intelligence (one unified dataset) */}
      <WorkspaceSection title="Comparable Intelligence">
        {/* Comp Sources — attempted sources + what each returned (concise). */}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] pb-1">
          <span class="text-[var(--color-text-faint)] uppercase tracking-wider text-[10px]">Comp Sources</span>
          {compSources.map((s) => (
            <span key={s.name} class={s.ok ? 'text-[var(--color-status-done)]' : 'text-[var(--color-text-faint)]'}>
              <span class="text-[var(--color-text)]">{s.name}</span> {s.text}
            </span>
          ))}
        </div>
        {unifiedComps.length ? (
          <div class="overflow-x-auto">
            <table class="w-full text-[12px] border-collapse">
              <thead>
                <tr class="text-[var(--color-text-faint)] text-left">
                  <th class="py-1 pr-3 font-medium">Source</th><th class="py-1 pr-3 font-medium">APN / Address</th>
                  <th class="py-1 pr-3 font-medium">Acres</th><th class="py-1 pr-3 font-medium">Price</th>
                  <th class="py-1 pr-3 font-medium">$/ac</th><th class="py-1 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {unifiedComps.map((c, i) => (
                  <tr key={i} class="border-t border-[var(--color-border)]">
                    <td class="py-1 pr-3">{c.source}</td>
                    <td class="py-1 pr-3 text-[var(--color-text-muted)]">{c.apn ?? c.address ?? '—'}</td>
                    <td class="py-1 pr-3">{c.acres != null ? `${c.acres}` : '—'}</td>
                    <td class="py-1 pr-3 text-[var(--color-text)]">{c.price != null ? formatMoney(c.price) : '—'}</td>
                    <td class="py-1 pr-3 text-[var(--color-text-muted)]">{c.ppa != null ? formatMoney(c.ppa) : '—'}</td>
                    <td class="py-1 pr-3 text-[var(--color-text-faint)]">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="text-[12px] text-[var(--color-text-muted)]">No comparable rows captured yet.</div>
        )}
        <div class="text-[11px] text-[var(--color-text-faint)]">LandPortal visible comps (no comp report purchased){(() => { const ext = [...new Set(unifiedComps.map((c) => c.source).filter((s) => /zillow|redfin/i.test(s)))]; return ext.length ? ` · plus public ${ext.join(' + ')} land comps (browser search).` : '.'; })()}</div>
      </WorkspaceSection>

      {/* Market Value + confidence */}
      <WorkspaceSection title="Market Value">
        <div class="text-[13px] text-[var(--color-text)]">
          Estimated Market Value: {mvLow != null && mvHigh != null ? `${formatMoney(mvLow)} – ${formatMoney(mvHigh)}` : mvMid != null ? formatMoney(mvMid) : 'Needs sold comps'}
          {mvMid != null && <span class="text-[var(--color-text-muted)]"> · mid ~{formatMoney(mvMid)}</span>}
        </div>
        <div class="text-[12px] text-[var(--color-text-muted)]">Evidence: LandPortal listed/asking comparable evidence{fs?.valuation.totalMarketValue ? ` · county market value ${fs.valuation.totalMarketValue}` : ''}. <span class="text-[var(--color-accent)]">Confidence: Low</span> until sold comps are confirmed. Not final underwriting.</div>
        {marketIntel && <div class="text-[12px] text-[var(--color-text-muted)] pt-1">{marketIntel.marketPulse}</div>}
      </WorkspaceSection>

      {/* Five Acquisition Strategies */}
      <WorkspaceSection title="Acquisition Strategies">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          {ranked.map((s) => (
            <div key={s.strategy} class="rounded-md border border-[var(--color-border)] p-2.5 space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[12.5px] font-semibold text-[var(--color-text)]">{s.strategy}</span>
                <span class={`text-[11px] px-2 py-0.5 rounded-full border ${potentialTone(s.potential || '')}`}>{s.potential || s.verdict}</span>
                {s.acquisitionRange && <span class="text-[11px] text-[var(--color-status-done)]">acquire {formatMoney(s.acquisitionRange.low)}–{formatMoney(s.acquisitionRange.high)}</span>}
              </div>
              <div class="text-[12px] text-[var(--color-text-muted)]">{s.reason}</div>
              {s.pricingLogic && <div class="text-[11px] text-[var(--color-text-muted)]"><span class="text-[var(--color-text-faint)]">Pricing:</span> {s.pricingLogic}</div>}
              {s.mainRisk && <div class="text-[11px]"><span class="text-[var(--color-status-failed)]">Risk:</span> <span class="text-[var(--color-text-muted)]">{s.mainRisk}</span></div>}
            </div>
          ))}
        </div>
      </WorkspaceSection>

      {/* Seller Call Questions (property-specific) */}
      <WorkspaceSection title="Seller Call Questions">
        <ul class="list-disc pl-5 space-y-1 text-[12.5px] text-[var(--color-text-muted)]">
          {(fs?.sellerQuestions ?? inspection?.discoveryQuestions ?? []).map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      </WorkspaceSection>
    </div>
  );
}

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Preview price-per-acre in the form ONLY when both price and acreage parse to
// positive numbers. Never fabricates a value when either is missing.
function parsedPpaPreview(priceStr: string, acresStr: string): string | null {
  const price = parseFloat(priceStr);
  const acres = parseFloat(acresStr);
  if (!Number.isFinite(price) || !Number.isFinite(acres) || acres <= 0) return null;
  return formatMoney(price / acres) + '/ac';
}

const fieldCls =
  'mt-0.5 w-full bg-[var(--color-card)] border border-[var(--color-border)] rounded px-2 py-1 text-[11.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';

function CompInput({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label class="block">
      <span class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <input type={type || 'text'} value={value} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLInputElement).value)} class={fieldCls} />
    </label>
  );
}

function CompSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <label class="block">
      <span class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} class={fieldCls}>
        {options.map((o) => <option value={o}>{o}</option>)}
      </select>
    </label>
  );
}
