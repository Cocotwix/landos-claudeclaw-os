import { useEffect, useRef, useState } from 'preact/hooks';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost, apiPatch, apiDelete, dashboardToken } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { ResolutionView, type ResolutionSnapshotView, type ParcelIdentityView } from '@/components/ResolutionView';
import {
  DocumentRegistryPanel,
  type DocumentRegistryView,
} from '@/components/CanonicalPanels';
import { DocumentUploadPanel } from '@/components/DealCardPanels';
import { TrashCardButton } from '@/components/TrashCardButton';
import {
  usePropertyIntelligence,
  PropertyIntelligenceLaunch,
  PropertyIntelligenceHistory,
  PropertyIntelligenceOverview,
  PropertyIntelligenceProperty,
  PropertyIntelligenceDueDiligence,
  PropertyIntelligenceMarket,
  PropertyIntelligenceStrategy,
  PropertyIntelligenceVisuals,
  PropertyIntelligenceEvidence,
  type PiSnapshot,
} from '@/components/PropertyIntelligencePanel';
import { SmartIntakePanel } from '@/components/LeadCardIntake';

// The Resolution view payload — shown instead of a half-populated Deal Card until
// the parcel is confirmed.
interface ResolutionData {
  parcelIdentity: ParcelIdentityView | null;
  snapshot: ResolutionSnapshotView | null;
  confirmed: boolean;
}

interface DealResearchOpportunity {
  id: number;
  researchStatus: 'not_started' | 'queued' | 'running' | 'partial' | 'complete' | 'failed';
  discoveryStatus: string;
  pipelineStage: string;
}

interface DealResearchMission {
  id: number;
  status: 'queued' | 'running' | 'partial' | 'complete' | 'failed' | 'quarantined';
  attempt: number;
  summary: string;
  safeNextAction: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
  verification?: { accepted?: boolean; identityState?: string } | null;
}

interface DealResearchProgress {
  opportunity: DealResearchOpportunity;
  mission: DealResearchMission | null;
}

const ACTIVE_RESEARCH_STATUSES = new Set(['queued', 'running']);

function DealResearchProgressPanel({ progress, retrying, actionError, canonicalConfirmed, onRetry }: { progress: DealResearchProgress; retrying: boolean; actionError: string; canonicalConfirmed?: boolean; onRetry: () => void }) {
  const mission = progress.mission;
  if (!mission) return null;
  const running = ACTIVE_RESEARCH_STATUSES.has(mission.status);
  const missionVerified = mission.verification?.accepted === true || mission.verification?.identityState === 'confirmed';
  // The accepted canonical identity is authoritative. A mission whose stored
  // identityState is older (e.g. 'candidate') is history superseded by the later
  // accepted confirmation, never the current identity state.
  const verified = missionVerified || !!canonicalConfirmed;
  const missionSuperseded = !!canonicalConfirmed && !missionVerified && !running
    && !!mission.verification && mission.verification.identityState !== 'confirmed';
  const title = running
    ? 'Automatic property research is running'
    : mission.status === 'complete'
      ? 'Automatic property research complete'
      : mission.status === 'partial' && verified
        ? 'Property research updated this card'
        : mission.status === 'quarantined'
          ? 'Research needs parcel confirmation'
          : mission.status === 'failed'
            ? 'Automatic research needs a retry'
            : 'Property research finished with gaps';
  const detail = running
    ? 'Keep this Deal Card open. LandOS checks for new evidence every few seconds and refreshes the facts, visuals, comps, and summary when the run finishes.'
    : mission.summary || (verified ? 'Verified parcel evidence was saved to this Deal Card.' : 'The run finished without enough evidence to confirm the parcel.');
  const tone = running ? 'border-sky-500/50 bg-sky-500/10' : verified ? 'border-emerald-500/45 bg-emerald-500/10' : 'border-amber-500/50 bg-amber-500/10';
  return (
    <section data-testid="deal-card-research-progress" class={`rounded-lg border p-3 ${tone}`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--color-text)]">
            {running && <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" />}
            {title}
          </div>
          <div class="mt-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{detail}</div>
          {missionSuperseded && (
            <div data-testid="deal-card-research-superseded" class="mt-1 text-[11px] text-[var(--color-text-muted)]">
              This run's parcel status ({mission.verification?.identityState ?? 'unknown'}) is earlier history, superseded by the accepted confirmed parcel identity on this card.
            </div>
          )}
          {!running && mission.safeNextAction && !canonicalConfirmed && !missionSuperseded && <div class="mt-1 text-[11px] text-[var(--color-text-muted)]"><span class="font-medium text-[var(--color-text)]">Next:</span> {mission.safeNextAction}</div>}
          {mission.error && <div class="mt-1 text-[11px] text-[var(--color-status-failed)]">{mission.error}</div>}
          {actionError && <div class="mt-1 text-[11px] text-[var(--color-status-failed)]">{actionError}</div>}
        </div>
        {!running && mission.status !== 'complete' && (
          <button type="button" data-testid="deal-card-research-retry" disabled={retrying} onClick={onRetry} class="shrink-0 rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] disabled:opacity-45">
            {retrying ? 'Starting…' : 'Re-run research'}
          </button>
        )}
      </div>
    </section>
  );
}

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

// Land Score (100-pt rubric) + supporting imagery, computed on demand.



// Deal Card panel — a usable list/open/create/edit/save/reload flow over the
// deal-level fields. Data comes from /api/landos/deal-cards (list) and
// /api/landos/deal-cards/:id (detail); writes go to POST /api/landos/deal-cards
// (create) and PATCH /api/landos/deal-cards/:id (update). After any write we
// re-load the same id from the API (proves persistence + keeps us on one record,
// no duplicate) AND refresh the list so a saved card is visible to open again.
//
// Deal-level fields only live here (title, stage, seller notes, asking price,
// strategy, package notes). Parcel identity/verification is never edited here.
// Fields the data model does not yet carry render an explicit "not captured yet"
// placeholder rather than fabricated values. No external CRM/GHL mutation, no
// fake sync, and imagery never drives parcel identity (exact-source only).

// Deal Card stages (mirrors DEAL_CARD_STATUSES in src/landos/db.ts). The backend
// re-validates, so this is just the picker surface.
const DEAL_STAGES = [
  'new', 'researching', 'discovery', 'underwriting', 'offer_ready',
  'offer_sent', 'follow_up', 'under_contract', 'closed', 'dead', 'archived',
] as const;

interface DealForm {
  entity: 'LAND_ALLY' | 'TY_LAND_BIZ';
  title: string;
  status: string;
  sellerNotes: string;
  askingPrice: string;
  combinedStrategy: string;
  packageNotes: string;
}

const EMPTY_FORM: DealForm = {
  entity: 'TY_LAND_BIZ', title: '', status: 'new', sellerNotes: '',
  askingPrice: '', combinedStrategy: '', packageNotes: '',
};

// DD/Research worksheet confidence labels + identity statuses (mirror
// DD_FIELD_LABELS / DD_PARCEL_IDENTITY_STATUSES in src/landos/db.ts; the backend
// re-validates and enforces the "Verified needs a source" guardrail).









// Strategy worksheet offer-readiness labels (mirror STRATEGY_OFFER_READINESS in
// src/landos/db.ts; the backend re-validates). Strategy defaults to 'not_reviewed'
// and is never auto-advanced.






// Market Research demand labels + source-confidence labels (mirror
// MARKET_DEMAND_LABELS / MARKET_SOURCE_CONFIDENCE in src/landos/db.ts; the
// backend re-validates and enforces the honest-conclusion guardrails). Demand
// defaults to 'not_reviewed' and is never auto-advanced.







// DD + Market + Strategy operational report (mirrors DealCardReportView in
// src/landos/deal-card-report.ts). Read-only here: it is produced by the backend
// workflow that runs the safe non-credit parcel resolve, structures Market
// Research source targets, applies Strategy logic, and updates the worksheets.




// ── Reconciliation view mirrors (server: deal-card-reconciliation.ts) ─────────















// Zillow/Redfin read-only browser comp research: the exact search path + honest
// per-source outcomes, so an actor failure never reads as a total comp failure.





// Pre-Call Intelligence (identity tier + property type + readiness).




// Discovery Call Preparation briefing (operator-facing).


// Acquisitions department panel (CRM-independent seller-strategy brain). Loads
// per-deal seller memory; supports paste-discovery, manual comm log, follow-up
// DRAFTS (never sent), call prep, next-best-action, stage. Source = Deal Card.





// Executive Summary — the operator-ready pre-call brief at the top of the file.

// Discovery Call Intelligence Report (Acquisition Specialist v1) — mirrors
// DiscoveryCallReport in src/landos/discovery-call-report.ts.
// Master Market Matrix section (single source of truth; Property Card + Discovery
// Report both render this). Mirrors MarketMatrixReportSection.







// ── Discovery Call Intelligence Report (Acquisition Specialist v1) ────────────
// The cohesive, operator-facing pre-call report: six labeled sections in the
// exact order Tyler runs a lead against. Pulls Smart Input, the five strategy
// evaluations, and the offer range from the backend discovery report; Parcel
// Intelligence / Comps / Market Pulse render from the report + executive summary.

// Master Market Matrix intelligence panel — rendered on the Property Card AND in
// the Discovery Call Report from the SAME resolved section (one source of truth).









// (Legacy DiscoveryCallReportSection removed: the Seller tab now consumes the
// shared pricing/strategy gates via SellerReadinessPanel + CallGuardrailsPanel
// in DealCardPanels.tsx — no stale underwriting values, one-point bands, or
// percentage offer formulas can render.)

// Browser Intelligence — LandPortal first, then County Records routed via NETR
// (semantic extraction, no per-county scrapers). The operator clicks Retrieve to
// pull public-record facts; each fact shows source / type / URL / confidence and
// whether it came from LandPortal, an NETR-routed county source, or a search
// fallback. Read-only; never dumps logs or workflow internals.









// Confirm Before Offer — the single home for "what must be confirmed before an
// offer." Merges verify-before-offer + next confirmations + strategy blockers
// from the report so these items appear ONCE, not scattered across panels.

// Market comps + listings — Realie sold (primary band), Zillow active (asking-
// market evidence, NOT sold), Zillow supplemental sold (separate), provider
// readiness. Active listings never drive the sold-comp valuation band.


// Honest active-listing retrieval state. "Zero active listings" may ONLY be
// stated when active retrieval actually ran and found none; a provider error /
// timeout / not-configured reads as "retrieval incomplete", never "zero".



// LandPortal visible comps + source status. Shows parsed free rows (source =
// LandPortal, with status/price/acreage/$/ac/date/URL) or the exact reason none
// are shown. The paid LandPortal comp report is never triggered.


// Renders the read-only Zillow/Redfin browser comp research: which sources were
// attempted, which succeeded/failed and why, how many comps each produced, the
// filters used, whether acreage/geography were expanded, overall strength, and
// the exact search path — so a thin result reads as an honest search, not silence.



// Deal Card DD readiness (derived from the persisted report).




// DD Command Center header — at-a-glance pre-call readiness: next-best action,
// report state, completeness, provenance, top missing facts + risks.

// Post-discovery DD panel: seller-stated facts (never Verified), manual county
// verification (browser agent dormant), and underwriting prep state. Loads on
// demand; mutations call back to refresh readiness.






// Full DD fact checklist — mirrors the Discovery Call Report. Every standard
// field shows a Verified value (+source) or an explicit Unknown / Needs
// Verification status. Read-only; never fabricated.

// Visual Property Context (Google) — supporting context only, never verification.



// ── Visual Context — the permanent foundation for the future Interactive
//    Intelligence Map. This section is the FIRST thing on the Deal Card. It
//    renders a large satellite image, a parcel boundary when geometry is
//    available (else an honest marker fallback), Street View, and Maps/Earth
//    links + imagery source/date. The data contract here (assets + links +
//    optional parcelBoundary) is shaped so a MapLibre layer stack (pan/zoom,
//    parcel/flood/wetlands/slope/comp pins, measurement) can slot in later
//    WITHOUT a refactor — see the FUTURE MAP note below.





// ── Visual Intelligence — operator-grade multi-source visual workflow ────────
// The full Visuals tab already owns the verified parcel and Google imagery.
// This component adds only concise visual observations there, while the compact
// form supplies a parcel-scoped hero for multi-parcel roster entries.
interface ViSubject { address?: string | null; lat?: number | null; lng?: number | null }
interface ViAsset {
  source: string; label: string; state: 'captured' | 'unavailable' | 'blocked';
  imageRoute?: string; url?: string; storedPath?: string; timestamp: string;
  subject: ViSubject; blocker?: string; fallback?: boolean;
}
interface ViObservation { category: string; observation: string; signal: 'positive' | 'concern' | 'neutral'; confidence: string; sourceImage: string }
interface ViRecord {
  cardId: number; generatedAt: string; subject: ViSubject;
  sources: ViAsset[]; gallery: ViAsset[]; hero: ViAsset | null; heroReason: string;
  observations: ViObservation[]; observationSummary: string; note: string;
}

function VisualIntelligencePanel({ cardId, token, compact }: { cardId: number; token: string; compact?: boolean }) {
  const [rec, setRec] = useState<ViRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const withToken = (u: string) => (u.startsWith('/api/') ? `${u}&token=${encodeURIComponent(token)}` : u);

  async function load() {
    try { const r = await apiGet<{ record: ViRecord | null }>(`/api/landos/property-cards/${cardId}/visual-intelligence`); setRec(r.record); }
    catch (e: any) { setMsg(e?.message || String(e)); }
  }
  async function run() {
    setBusy(true); setMsg(null);
    try { const r = await apiPost<{ record: ViRecord }>(`/api/landos/property-cards/${cardId}/visual-intelligence`, {}); setRec(r.record); }
    catch (e: any) { setMsg(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [cardId]);

  const hero = rec?.hero ?? null;

  // Compact (Overview): hero image + one-line status roll-up + run button.
  if (compact) {
    const capturedCount = rec?.gallery?.length ?? 0;
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Visual Intelligence</span>
          <button type="button" onClick={() => void run()} disabled={busy} class="px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">{busy ? 'Running…' : rec ? 'Re-run' : 'Run'}</button>
        </div>
        {hero?.imageRoute ? (
          <figure class="m-0">
            <img src={withToken(hero.imageRoute)} alt={hero.label} class="w-full h-44 sm:h-52 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
            <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">Hero · {hero.label} · visual signal only</figcaption>
          </figure>
        ) : (
          <div class="text-[11px] text-[var(--color-text-muted)] rounded-lg border border-dashed border-[var(--color-border)] p-3">
            {rec ? 'No hero image captured yet — open Property → Visuals for per-source blockers.' : 'Not run yet. Click Run to attempt all visual sources.'}
          </div>
        )}
        {rec && <div class="text-[10px] text-[var(--color-text-faint)]">{capturedCount} source(s) captured · {rec.observations.length} observation(s)</div>}
        {msg && <div class="text-[11px] text-rose-600">{msg}</div>}
      </div>
    );
  }

  // Full Visuals view: the verified parcel gallery and Google imagery already
  // render immediately above this panel. Keep this section focused on the
  // operator-facing interpretation instead of duplicating images or exposing
  // provider/session diagnostics.
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Visual observations</span>
        <button type="button" onClick={() => void run()} disabled={busy} class="px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">{busy ? 'Refreshing…' : 'Refresh observations'}</button>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">
        Verified parcel imagery and Google road context are shown above. Imagery supports screening only; it does not prove frontage, access, utilities, or buildability.
      </div>
      {!rec && <div class="text-[11px] text-[var(--color-text-muted)]">No visual observations have been saved yet.</div>}
      {rec && rec.observations.length > 0 && (
        <div class="space-y-1">
          {rec.observations.map((o) => (
            <div class="text-[12px] text-[var(--color-text-muted)]">
              <span class="text-[var(--color-text)]">{o.category.replace(/_/g, ' ')}:</span> {o.observation}
            </div>
          ))}
        </div>
      )}
      {rec && rec.observations.length === 0 && <div class="text-[11px] text-[var(--color-text-muted)]">No reliable visual observations were extracted from the saved imagery.</div>}

      {msg && <div class="text-[11px] text-rose-600">{msg}</div>}
    </div>
  );
}

// ── Activity timeline — real recorded Deal Card events ──────────────────────
// Renders the actual landos_card_activity events (report runs, visual
// intelligence/capture, comp research, inspections, notes, stage moves), newest
// first, with human labels + relative time. Never a fabricated timeline.
interface ActivityEventView { id: number; kind: string; summary: string; agentId: string; createdAt: number }
const ACTIVITY_KIND_LABEL: Record<string, string> = {
  property_inspection: 'Property Intelligence', landportal_inspection: 'LandPortal inspection',
  visual_intelligence: 'Visual Intelligence', visual_capture: 'Visual capture', vision_analysis: 'Vision analysis',
  market_pulse: 'Market Pulse', comparables_map: 'Comp research', market: 'Market update',
  duke_deal_writeback: 'Report writeback', note: 'Note', operator_override: 'Operator edit',
  operator_speech: 'Operator note', guard_block: 'Guard block', next_action: 'Next action',
  redfin_comp_status: 'Redfin comps', zillow_comp_status: 'Zillow comps',
  duke_verified_run: 'Property Intelligence (verified)', duke_unverified_run: 'Property Intelligence (unresolved)',
};
function activityKindLabel(kind: string): string {
  return ACTIVITY_KIND_LABEL[kind] ?? 'Activity';
}
function ActivityTimeline({ dealId }: { dealId: number }) {
  const [events, setEvents] = useState<ActivityEventView[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<{ events: ActivityEventView[] }>(`/api/landos/deal-cards/${dealId}/activity`)
      .then((r) => { if (live) setEvents(r.events); })
      .catch((e: any) => { if (live) setMsg(e?.message || String(e)); });
    return () => { live = false; };
  }, [dealId]);
  if (msg) return <div class="text-[11px] text-[var(--color-status-failed)]">{msg}</div>;
  if (!events) return <Placeholder text="Loading activity…" />;
  const visibleEvents = events.filter((event) => !/(orchestrat|provider|contract|evidence|readiness|classified|attempt)/i.test(`${event.kind} ${event.summary}`));
  if (visibleEvents.length === 0) return <Placeholder text="No owner-facing activity recorded yet." />;
  return (
    <ol class="space-y-1.5 m-0 p-0 list-none">
      {visibleEvents.map((e) => (
        <li key={e.id} class="flex items-start gap-2 border-b border-[var(--color-border)]/60 pb-1.5">
          <span class="shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">{activityKindLabel(e.kind)}</span>
          <div class="min-w-0 flex-1">
            <div class="text-[12px] text-[var(--color-text)] break-words">{e.summary || activityKindLabel(e.kind)}</div>
            <div class="text-[10px] text-[var(--color-text-faint)]">{formatRelativeTime(e.createdAt)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Small labeled value for the header / at-a-glance strips.
function HeaderField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div class="min-w-0">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      <div class="text-[13px] text-[var(--color-text)] truncate font-medium">{value || '—'}</div>
    </div>
  );
}

// Property Header — large, readable identity line: seller, address, APN, county,
// state, acreage, verification, entity, stage. Pulls from the DD fact checklist.


// At-A-Glance — the one-line answer strip directly under the header.


// Market Pulse — the completed market read. Phase 7 priorities: land $/ac by
// acreage band, overall county $/ac, active land asking prices, and REAL named
// local developments / rezonings / infrastructure — then what it means for buying
// land here. Absorption metrics (DOM / months-of-inventory / sell-through) are
// deprioritized to a secondary line.




// Land $/ac binned by acreage band (computed from the verified sold comps — no
// new provider). Empty bands are dropped.

// Land Score — the deterministic 100-point rubric, rendered inline in the report
// from the SAME verified property data (never a separate re-resolve). Missing
// source fields score 0 as loud data gaps, never inferred. Honest empty state
// when the parcel is not source-verified.





// Human-readable report status.


// Report status badge. Complete reads as accent; blocked/failed as failed;
// everything else neutral so an un-run report never looks finished. When the
// shared report-readiness classification is available it is the operator label
// (a generator finishing is NOT completed research or decision readiness).

interface PropertyCardLite {
  id: number;
  active_input_address?: string | null;
  apn?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  owner?: string | null;
  acres?: number | null;
  zoning?: string | null;
  verification_status?: string | null;
  open_risks?: string | null;
  lp_url?: string | null;
}

interface PersonLite {
  name?: string | null;
  role?: string | null;
  authority_status?: string | null;
  phone?: string | null;
  email?: string | null;
  mailing_address?: string | null;
}

interface DealCardDetail {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  seller_notes: string;
  asking_price: number | null;
  combined_strategy: string;
  package_notes: string;
  combined_acreage: number | null;
  propertyCards?: PropertyCardLite[];
  people?: PersonLite[];
}

// A row in the saved-cards list (the list route returns the flat deal row).
interface DealCardListItem {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  asking_price: number | null;
  updated_at: number;
  lead_type?: string;
  deleted_at?: number | null;
  reportSummary?: { exists: boolean; reportStatus: string; parcelVerified: boolean; ddPercentComplete: number; generatedAt: number | null };
}

const LEAD_TYPE_LABELS: Record<string, string> = { actual: 'Actual Lead', test: 'TEST LEAD', research: 'Research Lead', imported: 'Imported Lead', manual: 'Manual Lead' };

// Lead-type badge. TEST LEAD is deliberately loud (amber, bordered) so test
// records are never mistaken for real seller leads anywhere in LandOS.
function LeadTypeBadge({ leadType }: { leadType?: string }) {
  const lt = leadType ?? 'actual';
  if (lt === 'actual') return null;
  const tone = lt === 'test'
    ? 'text-[#b45309] border-[#f59e0b] bg-[#fef3c7]'
    : 'text-[var(--color-text-muted)] border-[var(--color-border)]';
  return <span class={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${tone}`}>{LEAD_TYPE_LABELS[lt] ?? lt}</span>;
}

// DD completeness chip for list/board rows.
function DdChip({ s }: { s?: DealCardListItem['reportSummary'] }) {
  if (!s || !s.exists) {
    return <span class="text-[10px] px-1.5 py-0.5 rounded-full border text-[var(--color-text-faint)] border-[var(--color-border)]">DD: not run</span>;
  }
  const pct = s.ddPercentComplete;
  const tone = s.parcelVerified ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border tabular-nums ${tone}`} title={`Parcel ${s.parcelVerified ? 'verified' : 'unverified'} · DD ${pct}%`}>
      {s.parcelVerified ? 'DD' : 'DD (unverified)'} {pct}%
    </span>
  );
}

function entityBadge(entity: string | null): string {
  if (entity === 'LAND_ALLY') return 'Land Ally';
  if (entity === 'TY_LAND_BIZ') return 'My Business';
  return 'Unknown';
}

function Placeholder({ text = 'Not captured yet' }: { text?: string }) {
  return <span class="text-[12px] text-[var(--color-text-faint)] italic">{text}</span>;
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">{title}</h3>
      {children}
    </section>
  );
}

// Collapsible — same chrome as Section but collapsed by default (native <details>).
// Used to demote legacy worksheets, contacts, comms, documents, and call prep out
// of the default DD operator brief without removing them.


function Field({ label, value }: { label: string; value?: string | number | null }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="flex justify-between gap-3 py-0.5">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      {has ? <span class="text-[12px] text-[var(--color-text)] text-right">{value}</span> : <Placeholder />}
    </div>
  );
}

// Human-readable parcel identity status + the verification color cue.



// A small confidence-label pill. 'Verified' is the only "trusted" cue; every
// other label reads as not-yet-verified so research data never looks verified.


// A DD field row: value (or a missing placeholder) plus its confidence label.

// Human-readable offer-readiness label.


// Legacy offer-readiness badge removed: readiness renders ONLY from the shared
// unified readiness record (UnifiedReadinessStrip) — no private badge logic.

// A read-only strategy note row. Renders an honest placeholder when empty so a
// blank strategy lane never looks analyzed.

// Human-readable market demand label.


// Human-readable source-confidence label.


// A demand pill. Only 'strong_demand' reads as an accent (positive) cue; every
// other label reads as neutral so an unreviewed lane never looks like a verified
// market conclusion. Market demand is never a comp, price, or value.


// A market demand lane: a note (or honest placeholder) plus its demand label.

// A read-only market context note row (listing / sold / days-on-market / growth /
// region). Renders an honest placeholder when empty so a blank lane never looks
// like a fabricated market fact.



// ── Business Object Spine v1 (canonical projection) ────────────────────────
// The authoritative decision-grade layer. The Deal Card RENDERS these objects
// in plain business language; it is not the database of truth. Shape mirrors
// BusinessObjectBundle in src/landos/business-object-spine.ts.
interface SpineFactSlot { field: string; value: string | number | null; known: boolean; label: string; verified: boolean; evidenceRefs: string[] }
interface SpineSourceEvidence { sourceId: string; classification: string; sourceName: string; sourceUrlOrRef: string; reliability: string; usableForOfferLogic: boolean; cardId?: number; note: string }
interface SpineVerificationTask { taskId: string; criticality: string; question: string; reason: string; recommendedSource: string; ownerDepartment: string; blocking: boolean }
interface SpineCriticalFact { key: string; label: string; state: 'confirmed' | 'needs_evidence' | 'absent'; value?: string; detail: string }
interface SpineHeader {
  stage: string; parcelCompleteness: number; decisionConfidence: string; decisionGrade: boolean;
  decisionGradeReason: string; missingCriticalInfo: string[]; criticalFacts?: SpineCriticalFact[]; blockingVerificationTasks: SpineVerificationTask[];
  nextBestAction: string; nextActionOwner: string;
}
interface SpinePacket {
  owner: SpineFactSlot; apn: SpineFactSlot; county: SpineFactSlot; state: SpineFactSlot;
  location: SpineFactSlot; acreage: SpineFactSlot; parcelIdentityVerified: boolean; parcelIdentityStatus: string;
  parcelCompletenessScore: number; decisionGrade: boolean; decisionGradeReason: string;
  missingCriticalInfo: string[]; sourceEvidence: SpineSourceEvidence[]; verificationTasks: SpineVerificationTask[];
}
interface SpineLeadIntake { provided: Record<string, unknown>; sellerStatedFacts: Array<{ kind: string; value: string }>; intakeConfidence: string }
interface BusinessSpineView {
  header: SpineHeader; propertyIntelligence: SpinePacket;
  opportunity: { nextBestAction: string; nextActionOwner: string; decisionConfidence: string; criticalBlockers: string[] };
  leadIntake: SpineLeadIntake; sourceEvidence: SpineSourceEvidence[]; verificationTasks: SpineVerificationTask[];
}






// The FIRST thing on an open Deal Card: what LandOS found, what's missing, the
// evidence, whether it's decision-grade, what's blocking, and the next action —
// all sourced from the canonical Business Object Spine, in plain language.


// ── Market Pulse v1 (concise real read) ────────────────────────────────────
// Mirrors MarketPulseRead in src/landos/market-pulse-read.ts. Answers: is the
// area growing/stable/declining, what land goes for per acre, growth signals.








// ── Public Records Research (unresolved-lead usefulness) ────────────────────
// Mirrors PublicRecordsResearchPlan in src/landos/public-records-research.ts.





// ── Deal Card tabs ──────────────────────────────────────────────────────────
// The Deal Card is a compact operator dashboard: identity + critical facts + the
// next action stay pinned at the top; the (formerly endless) report/worksheet
// content is split into tabs so the deal is legible in seconds and long reports
// no longer force an endless scroll. Every existing section is preserved — only
// reorganized behind a tab. No data or backend behavior changes.
// Operator-language tabs (LandOS Vision & Architecture: Overview, Property,
// Market, Strategy, Seller, Documents, Activity). Overview is the main working
// surface — the Property Intelligence Report read. The remaining tabs hold the
// deeper, editable detail (property DD + visuals + browser intelligence live
// under Property; report generation + files under Documents; the report/audit
// timeline under Activity).
type DealTab = 'overview' | 'property' | 'diligence' | 'market' | 'strategy' | 'visuals' | 'seller' | 'documents' | 'activity' | 'intake';
const DEAL_TABS: Array<{ id: DealTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'property', label: 'Property' },
  { id: 'diligence', label: 'Due Diligence' },
  { id: 'market', label: 'Market' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'visuals', label: 'Visuals' },
  { id: 'seller', label: 'Seller' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
  { id: 'intake', label: 'Smart Intake' },
];
const DEAL_TAB_IDS = new Set<string>(DEAL_TABS.map((t) => t.id));
function isDealTab(v: unknown): v is DealTab {
  return typeof v === 'string' && DEAL_TAB_IDS.has(v);
}

// The selected tab is a VIEW preference, not deal data. It is remembered per deal
// in sessionStorage so a refresh deterministically restores the workspace the
// operator was in, and it never touches the database.
const tabStorageKey = (dealCardId: number) => `landos.dealCard.${dealCardId}.tab`;
function rememberDealTab(dealCardId: number, tab: DealTab): void {
  try { sessionStorage.setItem(tabStorageKey(dealCardId), tab); } catch { /* private mode — the tab simply resets */ }
}
function restoreDealTab(dealCardId: number): DealTab {
  try {
    const saved = sessionStorage.getItem(tabStorageKey(dealCardId));
    if (isDealTab(saved)) return saved;
  } catch { /* private mode */ }
  return 'overview';
}

/** The Deal Card workspace switcher. Each tab is a real tab control: it carries
 *  its selected state in `aria-selected`, exposes a stable test id, and its click
 *  handler stops propagation so no surrounding card/section/form handler can
 *  swallow the selection. */
function DealTabBar({ active, onSelect }: { active: DealTab; onSelect: (t: DealTab) => void }) {
  return (
    <div role="tablist" aria-label="Deal Card sections" data-testid="deal-tabbar" class="flex flex-wrap gap-0.5 -mb-px overflow-x-auto">
      {DEAL_TABS.map((t) => {
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`deal-tab-${t.id}`}
            data-testid={`deal-tab-${t.id}`}
            data-active={selected ? 'true' : 'false'}
            aria-selected={selected}
            aria-controls={`deal-panel-${t.id}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(t.id); }}
            class={`relative z-10 px-3 py-1.5 text-[12px] font-medium whitespace-nowrap rounded-t-md border-b-2 ${
              selected
                ? 'border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-elevated)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact, always-visible critical-facts chips for the pinned header — the same
 *  states the Business Spine renders in full below (confirmed / needs_evidence /
 *  absent). Kept short so the deal reads at a glance. */
function CriticalFactChips({ facts }: { facts?: SpineCriticalFact[] }) {
  if (!facts || facts.length === 0) return null;
  return (
    <div class="flex flex-wrap gap-1">
      {facts.map((f) => {
        const tone = f.state === 'confirmed'
          ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
          : f.state === 'needs_evidence'
            ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
            : 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
        const mark = f.state === 'confirmed' ? '✓' : f.state === 'needs_evidence' ? '◐' : '○';
        return (
          <span key={f.key} class={`text-[10px] px-1.5 py-0.5 rounded-full border ${tone}`} title={f.detail}>
            {mark} {f.label}
          </span>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
function currentCriticalFacts(
  snapshot: PiSnapshot | null,
  fallback?: SpineCriticalFact[],
): SpineCriticalFact[] | undefined {
  if (!(snapshot?.identity.state === 'provisional' && snapshot.identity.discoveryUsable)) {
    return fallback;
  }
  const identity = snapshot.identity;
  const basis = identity.discoveryBasis || identity.explanation;
  const discovered = (key: string, label: string, value: string | null): SpineCriticalFact => ({
    key,
    label,
    state: value ? 'needs_evidence' : 'absent',
    ...(value ? { value } : {}),
    detail: value
      ? `${value}. Discovery-stage parcel evidence is consistent; official parcel confirmation remains outstanding. ${basis}`
      : `${label} was not returned by the current parcel evidence.`,
  });
  return [
    {
      key: 'parcel_identity',
      label: 'Discovery-stage parcel identity',
      state: 'needs_evidence',
      detail: basis,
    },
    discovered('owner', 'Owner', identity.owner),
    discovered('apn', 'APN / parcel number', identity.apn),
    discovered('acreage', 'Acreage', identity.acres == null ? null : `${identity.acres} ac`),
    {
      key: 'source_evidence',
      label: 'Parcel evidence',
      state: snapshot.evidence.length > 0 ? 'needs_evidence' : 'absent',
      value: snapshot.evidence.length > 0 ? `${snapshot.evidence.length} retained item(s)` : undefined,
      detail: snapshot.evidence.length > 0
        ? `${snapshot.evidence.length} source artifact(s) support the discovery-stage subject; official confirmation remains outstanding.`
        : 'No parcel evidence is retained for the current snapshot.',
    },
  ];
}

// PROPERTY INTELLIGENCE REPORT — the Deal Card Overview.
//
// The Overview is the primary Acquisitions workspace: ONE complete, professional
// read of a single land opportunity. It SYNTHESIZES intelligence that already
// exists (report, executive summary, discovery, comps, visuals, seller) into a
// report hierarchy — hero, executive summary, key facts, what-the-facts-mean,
// risks/unknowns, market, strategy, seller — instead of scattering department
// outputs across tabs. It reuses existing data only. It never fabricates and it
// never makes the buy/no-buy decision — it explains context and leaves the
// decision to the operator. Deeper, editable detail lives in the tabs below.
// ══════════════════════════════════════════════════════════════════════════



// Pull a fact + its source from the DD checklist (source-labeled by design).




// Best-effort city from the situs address ("123 Rd, Helenwood, TN 37755" -> "Helenwood").
function cityFromSitus(situs: string | null): string | null {
  if (!situs) return null;
  const parts = situs.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

// Enriched identity grid for the pinned header: seller, address, city, county,
// state, acreage, APN / parcel ID, stage, deal status. Business language only.


// Hero visual — the best PARCEL-SPECIFIC image, in strict priority: APN-specific
// LandPortal parcel imagery → county GIS → verified-coordinate Google satellite →
// nearby verified-parcel Street View context → NO image. Generic city / nearby-business
// imagery never renders; an honest empty state beats a misleading visual.






// Executive property summary — synthesized narrative, normal operator language.
// Uses the backend executive summary when present; honest prompt otherwise.


// Prefer the reconciled authoritative value for a field (acreage/frontage/flood/
// wetlands/slope) so the at-a-glance snapshot can NEVER disagree with the
// reconciled facts panel. Falls back to the raw checklist/gov read only when
// reconciliation produced no primary. This is the single-truth rule for the card.


// Key facts — the professional at-a-glance property snapshot, source-labeled.
// Environmental + dimensional facts come from the reconciliation layer (one truth).


// What the facts mean together — the synthesis the brief asks for. Deterministic,
// derived only from present facts. It connects facts into combined context and
// explicitly does NOT make a buy/no-buy call.


// Key risks / unknowns — two honest columns, deduplicated from report + summary.


// Strategy snapshot — property-specific exit evaluation (Acquisitions), compact.
// Neighbor sale is NOT an acquisition strategy and is excluded.


// Seller / discovery snapshot — helps talk to the seller. Full detail on Seller.




// The full Overview composition — the Property Intelligence Report read.
// ── Reconciliation UI: one authoritative story across every tab ──────────────





/** Loud banner when the card's trusted sources disagree — shown on Overview so the
 *  operator never has to hunt for a hidden contradiction. */




/** Reconciled property facts — the Property tab's single fact panel. */


/** Valuation hierarchy — one primary preliminary value + supporting bases. Shared
 *  by Overview and Market so the primary value never differs between tabs. */




/** Single comp-state panel — the same object Strategy reads, so status never
 *  contradicts across Market / Strategy / Activity. */





/** Best comparables — the memo's shortlist of the 3-5 comps that inform value,
 *  each with distance / acreage / price / $-per-acre / sold date / source /
 *  confidence and the plain reason it was picked. Not twenty comps. */


// ── Pursuit decision (Strategy's ONE question) — mirrors deal-card-pursuit.ts ─





/** The Strategy tab's core: should I pursue, and at what price is it attractive. */


/** Recommended + runner-up exits, blockers, and remaining verification — the rest
 *  of the Strategy story, consuming the same pursuit object. */


// ── Executive Orchestrator review — mirrors deal-card-audit.ts ───────────────



/** One quiet line when coherent; a loud, specific banner when the card's tabs
 *  do not tell the same story. */


// ── Next operator actions — the memo's closing section ───────────────────────


// ── Market Scan: Data Center Watch + land-relevant growth signals ────────────






/** Auto-runs on Market open (no buttons). Every item shown answers "why does
 *  this matter for buying this land?" — irrelevant items were already dropped. */


// ── LandPortal imagery + observations (Property tab) ─────────────────────────




// ── Multi-parcel roster (Parcel A / Parcel B — never conflated) ──────────────
// Mirrors parcelRosterFor in routes.ts. Each APN renders its own honest state;
// Parcel B never inherits Parcel A's imagery, and no generic image fills a gap.




function PropertyIdentityControl({ prop, snapshot, onSaved }: {
  prop: PropertyCardLite; snapshot?: PiSnapshot | null; onSaved: () => Promise<void> | void;
}) {
  const situs = snapshot?.identity.situs ?? snapshot?.identity.normalizedAddress ?? prop.active_input_address ?? '';
  const initialAddress = [situs, prop.city, prop.state].filter(Boolean).join(', ');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    address: initialAddress,
    city: prop.city ?? cityFromSitus(situs) ?? '',
    county: snapshot?.identity.county ?? prop.county ?? '',
    state: snapshot?.identity.state_ ?? prop.state ?? '',
    apn: snapshot?.identity.apn ?? prop.apn ?? '',
    owner: snapshot?.identity.owner ?? prop.owner ?? '',
    acres: snapshot?.identity.acres == null ? (prop.acres == null ? '' : String(prop.acres)) : String(snapshot.identity.acres),
    sourceUrl: '',
    sourceLabel: 'Official parcel record',
    confirmed: false,
  });
  useEffect(() => {
    setOpen(false);
    setMessage(null);
    setForm({
      address: initialAddress,
      city: prop.city ?? cityFromSitus(situs) ?? '',
      county: snapshot?.identity.county ?? prop.county ?? '',
      state: snapshot?.identity.state_ ?? prop.state ?? '',
      apn: snapshot?.identity.apn ?? prop.apn ?? '',
      owner: snapshot?.identity.owner ?? prop.owner ?? '',
      acres: snapshot?.identity.acres == null ? (prop.acres == null ? '' : String(prop.acres)) : String(snapshot.identity.acres),
      sourceUrl: '',
      sourceLabel: 'Official parcel record',
      confirmed: false,
    });
  }, [prop.id, snapshot?.runId]);
  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  async function saveIdentity() {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost(`/api/landos/property-cards/${prop.id}/verified-parcel-reconciliation`, {
        address: form.address.trim(), city: form.city.trim(), county: form.county.trim(), state: form.state.trim().toUpperCase(),
        apn: form.apn.trim(), owner: form.owner.trim(), sourceUrl: form.sourceUrl.trim(), sourceLabel: form.sourceLabel.trim(),
        acres: form.acres.trim() ? Number(form.acres) : null,
        confirmAcceptedIdentityReplacement: form.confirmed,
      });
      await onSaved();
      setForm((current) => ({ ...current, confirmed: false }));
      setMessage('Property identity saved. The prior intake address remains in Activity history.');
      setOpen(false);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }
  const inputClass = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px]';
  return (
    <Section title="Property identity">
      <div class="flex flex-wrap items-center gap-2">
        <div class="text-[12px] text-[var(--color-text-muted)] flex-1">Correct the property address or official parcel identity without changing the seller or lead contact.</div>
        <button type="button" onClick={() => setOpen((value) => !value)} class="px-2.5 py-1 rounded-md border border-[var(--color-border)] text-[11px] hover:bg-[var(--color-elevated)]">{open ? 'Cancel' : 'Correct property identity'}</button>
      </div>
      {open && (
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Canonical property address<input class={inputClass} value={form.address} onInput={(e) => setField('address', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">City<input class={inputClass} value={form.city} onInput={(e) => setField('city', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">County<input class={inputClass} value={form.county} onInput={(e) => setField('county', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">State<input class={inputClass} maxLength={2} value={form.state} onInput={(e) => setField('state', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">APN / parcel ID<input class={inputClass} value={form.apn} onInput={(e) => setField('apn', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Owner of record<input class={inputClass} value={form.owner} onInput={(e) => setField('owner', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Official acreage (if shown)<input class={inputClass} type="number" min="0" step="any" value={form.acres} onInput={(e) => setField('acres', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Official source URL<input class={inputClass} type="url" placeholder="https://…" value={form.sourceUrl} onInput={(e) => setField('sourceUrl', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Source name<input class={inputClass} value={form.sourceLabel} onInput={(e) => setField('sourceLabel', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 flex items-start gap-2 text-[11px] text-[var(--color-text-muted)]"><input type="checkbox" checked={form.confirmed} onChange={(e) => setField('confirmed', (e.target as HTMLInputElement).checked)} />I verified these values against the linked official parcel record.</label>
          <button type="button" disabled={busy || !form.confirmed} onClick={() => void saveIdentity()} class="sm:col-span-2 px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white text-[11.5px] font-medium disabled:opacity-40">{busy ? 'Saving…' : 'Save verified property identity'}</button>
        </div>
      )}
      {message && <div class="text-[11px] text-[var(--color-text-muted)] mt-2">{message}</div>}
    </Section>
  );
}

function AddDealContactControl({ dealId, onSaved }: { dealId: number; onSaved: () => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'lead' | 'seller' | 'contact'>('lead');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setName('');
    setRole('lead');
    setMessage(null);
  }, [dealId]);
  async function addContact() {
    if (!name.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const response = await apiPost<{ created: boolean }>(`/api/landos/deal-cards/${dealId}/people`, { name: name.trim(), role });
      await onSaved();
      setMessage(response.created ? 'Contact saved separately from the owner of record.' : 'That contact is already linked to this Deal Card.');
      setName('');
    } catch (error: any) { setMessage(error?.message || String(error)); }
    finally { setBusy(false); }
  }
  return (
    <div class="rounded-md border border-[var(--color-border)] p-2.5 mb-3">
      <div class="text-[11px] font-medium text-[var(--color-text)] mb-1.5">Add lead or contact</div>
      <div class="flex flex-col sm:flex-row gap-2">
        <input class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px]" placeholder="Full name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <select class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px]" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as typeof role)}><option value="lead">Lead</option><option value="seller">Seller</option><option value="contact">Contact</option></select>
        <button type="button" disabled={busy || !name.trim()} onClick={() => void addContact()} class="px-3 py-1.5 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)] text-[11.5px] font-medium disabled:opacity-40">{busy ? 'Saving…' : 'Add contact'}</button>
      </div>
      <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">Contact identity is separate from the parcel’s owner-of-record field. Phone, email, and authority remain blank unless known.</div>
      {message && <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{message}</div>}
    </div>
  );
}

interface ParcelRosterEntryView {
  apn: string;
  label: string;
  cardId: number | null;
  status: 'resolved_verified_imagery' | 'resolved_no_imagery' | 'unresolved';
  nextAction: string | null;
}

const PARCEL_STATUS_LABEL: Record<ParcelRosterEntryView['status'], { text: string; cls: string }> = {
  resolved_verified_imagery: { text: 'Resolved · verified imagery', cls: 'text-[var(--color-status-done)] border-[var(--color-status-done)]' },
  resolved_no_imagery: { text: 'Resolved · no verified imagery yet', cls: 'text-[var(--color-accent)] border-[var(--color-accent)]' },
  unresolved: { text: 'Unresolved · awaiting parcel resolution', cls: 'text-amber-600 dark:text-amber-400 border-amber-500/50' },
};

function ParcelRosterBlock({ entry, cards, token }: { entry: ParcelRosterEntryView; cards: PropertyCardLite[]; token: string }) {
  const tone = PARCEL_STATUS_LABEL[entry.status];
  const card = entry.cardId != null ? cards.find((c) => c.id === entry.cardId) ?? null : null;
  return (
    <div class={`rounded-lg border ${entry.status === 'unresolved' ? 'border-amber-500/40' : 'border-[var(--color-accent)]/40'} bg-[var(--color-card)] p-3 space-y-2`}>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-bold text-[var(--color-text)]">{entry.label}</span>
        <span class="text-[11px] text-[var(--color-text-muted)]">APN {entry.apn}</span>
        <span class={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${tone.cls}`}>{tone.text}</span>
      </div>
      {card && (
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
          <HeaderField label="County / State" value={[card.county, card.state].filter(Boolean).join(', ') || undefined} />
          <HeaderField label="Acreage" value={card.acres != null ? `${card.acres} ac` : undefined} />
          <HeaderField label="Verification" value={card.verification_status ?? undefined} />
        </div>
      )}
      {/* Card-scoped imagery: THIS parcel's verified visuals only. */}
      {card && entry.status === 'resolved_verified_imagery' && (
        <VisualIntelligencePanel cardId={card.id} token={token} compact />
      )}
      {entry.status !== 'resolved_verified_imagery' && (
        <div class="text-[11.5px] text-[var(--color-text-muted)] rounded-md border border-dashed border-[var(--color-border)] p-2.5">
          {entry.status === 'unresolved'
            ? 'Parcel location not yet resolved — no imagery or facts are shown for this parcel.'
            : 'Parcel image unavailable — resolved, but no imagery has passed parcel-association verification yet.'}
          {entry.nextAction && <div class="mt-1"><span class="text-[var(--color-accent)] font-semibold">Next:</span> {entry.nextAction}</div>}
        </div>
      )}
    </div>
  );
}

// ── OVERVIEW — the executive investment memo ─────────────────────────────────
// Reads top-to-bottom like a memo: executive summary first (the thing Tyler
// reads before calling the seller), then who owns it / what it is (key facts),
// what the facts mean, the biggest risks, what it is probably worth (the ONE
// valuation + the five best comps), the recommended strategy, the seller, and
// the next operator actions. No widget clutter — deep detail lives on its tab.


















export function DealCard({ dealCardId, entity = 'all', onOpenDeal }: { dealCardId?: number; entity?: EntityFilter; onOpenDeal?: (id: number) => void }) {
  const [deal, setDeal] = useState<DealCardDetail | null>(null);
  const [spine, setSpine] = useState<BusinessSpineView | null>(null);
  // Property Intelligence: ONE parent mission per Deal Card. The hook owns the
  // launch, live specialist progress polling, and the joined snapshot every tab
  // below reads, so no two tabs can tell different stories.
  const propertyIntelligence = usePropertyIntelligence(deal?.id ?? dealCardId ?? null);
  // The promoted snapshot is always preferred: preliminary in-flight content
  // never displaces a good promoted read. Only while a mission is running AND
  // no promoted snapshot exists yet (a freshly saved lead) do the tabs render
  // the progressive assembly, which arrives clearly marked preliminary and is
  // replaced by the real snapshot at join.
  const piSnapshot = propertyIntelligence.view?.snapshot
    ?? (propertyIntelligence.running ? propertyIntelligence.view?.progressive?.snapshot ?? null : null);
  const [resolution, setResolution] = useState<ResolutionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Active Deal Card tab. It resets to Overview only when a DIFFERENT card opens;
  // an in-place reload (a panel saved, evidence changed, research finished) keeps
  // the operator in the workspace they are working in. Previously every reload
  // snapped back to Overview, which read as "the tabs do not work".
  const [activeTab, setActiveTabState] = useState<DealTab>('overview');
  const openedDealIdRef = useRef<number | null>(null);
  const selectTab = (tab: DealTab) => {
    setActiveTabState(tab);
    if (openedDealIdRef.current != null) rememberDealTab(openedDealIdRef.current, tab);
  };

  // Saved-cards list state. The list is the primary open flow: fetched on mount
  // (unless we were handed a specific dealCardId) and refreshed after any write.
  const [cards, setCards] = useState<DealCardListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Create/edit state. mode 'view' renders the list + read-only panels; 'create'
  // and 'edit' render the deal-level form. saving/saveError gate the Save button.
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [form, setForm] = useState<DealForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Canonical records returned with the Property Intelligence read. They preserve
  // historical documents and per-parcel isolation without loading legacy report
  // or worksheet projections.
  const [parcelRoster, setParcelRoster] = useState<ParcelRosterEntryView[] | null>(null);
  const [documentRegistry, setDocumentRegistry] = useState<DocumentRegistryView | null>(null);
  const [researchProgress, setResearchProgress] = useState<DealResearchProgress | null>(null);
  const [researchRetrying, setResearchRetrying] = useState(false);
  const [researchActionError, setResearchActionError] = useState('');

  async function loadCanonicalExtras(id: number) {
    const response = await apiGet<{
      documentRegistry?: DocumentRegistryView | null;
      parcelRoster?: ParcelRosterEntryView[] | null;
    }>('/api/landos/deal-cards/' + id + '/property-intelligence');
    setDocumentRegistry(response.documentRegistry ?? null);
    setParcelRoster(response.parcelRoster ?? null);
  }

  // Refresh canonical records once when a parent mission settles. No legacy
  // projection is rebuilt or fetched.
  const missionWasRunning = useRef(false);
  useEffect(() => {
    const running = propertyIntelligence.running;
    if (running) { missionWasRunning.current = true; return; }
    if (!missionWasRunning.current || !deal) return;
    missionWasRunning.current = false;
    void loadCanonicalExtras(deal.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyIntelligence.running, deal?.id]);

  async function load(id: number, resetTab = true) {
    try {
      setLoading(true);
      setError(null);
      // Opening a different card restores that card's remembered workspace
      // (Overview by default). Reloading the SAME card never moves the operator.
      if (resetTab && openedDealIdRef.current !== id) setActiveTabState(restoreDealTab(id));
      openedDealIdRef.current = id;
      const res = await apiGet<{ dealCard: DealCardDetail; businessSpine?: BusinessSpineView | null; opportunity?: DealResearchOpportunity | null; researchMission?: DealResearchMission | null }>(`/api/landos/deal-cards/${id}`);
      setDeal(res.dealCard);
      setSpine(res.businessSpine ?? null);
      setResearchProgress(res.opportunity ? { opportunity: res.opportunity, mission: res.researchMission ?? null } : null);
      const [rres] = await Promise.all([
        apiGet<ResolutionData>(`/api/landos/deal-cards/${id}/resolution`),
        loadCanonicalExtras(id),
      ]);
      setResolution(rres);
    } catch (err: any) {
      setError(err?.message || String(err));
      setDeal(null);
      setSpine(null);
      setResolution(null);
      setDocumentRegistry(null);
      setParcelRoster(null);
      setResearchProgress(null);
    } finally {
      setLoading(false);
    }
  }

  async function retryResearch() {
    const opportunityId = researchProgress?.opportunity.id;
    if (!opportunityId || researchRetrying) return;
    setResearchRetrying(true); setResearchActionError('');
    try {
      const result = await apiPost<{ opportunity: DealResearchOpportunity; mission: DealResearchMission }>(`/api/landos/opportunities/${opportunityId}/research`, {});
      setResearchProgress({ opportunity: result.opportunity, mission: result.mission });
    } catch (error) {
      setResearchActionError((error as Error).message || 'Research could not be started.');
    } finally {
      setResearchRetrying(false);
    }
  }

  // Refresh the saved-cards list. Failures surface as a list error but never
  // block the detail/create flow, and never fabricate rows.
  async function refreshList() {
    try {
      setListError(null);
      const res = await apiGet<{ dealCards: DealCardListItem[] }>('/api/landos/deal-cards');
      setCards(Array.isArray(res.dealCards) ? res.dealCards : []);
    } catch (err: any) {
      setListError(err?.message || String(err));
      setCards([]);
    }
  }

  // ── Trash (soft delete) ──────────────────────────────────────────────────
  const [listView, setListView] = useState<'active' | 'trash'>('active');
  const [trash, setTrash] = useState<DealCardListItem[] | null>(null);
  const [trashBusy, setTrashBusy] = useState<number | null>(null);
  // The card id "armed" for permanent deletion — shows the second, irreversible
  // confirmation inline before the hard delete actually runs.
  const [confirmPurgeId, setConfirmPurgeId] = useState<number | null>(null);

  async function refreshTrash() {
    try {
      const res = await apiGet<{ dealCards: DealCardListItem[] }>('/api/landos/deal-cards/trash');
      setTrash(Array.isArray(res.dealCards) ? res.dealCards : []);
    } catch {
      setTrash([]);
    }
  }

  // Soft delete now lives in the shared TrashCardButton control, which every
  // Deal Card surface uses. Restore / purge below remain Trash-view specific.

  async function restoreCard(id: number) {
    setTrashBusy(id);
    try {
      await apiPost(`/api/landos/deal-cards/${id}/restore`, {});
      await refreshTrash();
      await refreshList();
    } catch (err: any) {
      setListError(err?.message || String(err));
    } finally {
      setTrashBusy(null);
    }
  }

  // Permanent delete — ONLY reached after the inline second confirmation below.
  async function purgeCard(id: number) {
    setTrashBusy(id);
    try {
      await apiDelete(`/api/landos/deal-cards/${id}/permanent`);
      setConfirmPurgeId(null);
      await refreshTrash();
    } catch (err: any) {
      setListError(err?.message || String(err));
    } finally {
      setTrashBusy(null);
    }
  }

  useEffect(() => {
    if (dealCardId) void load(dealCardId);
    else void refreshList();
  }, [dealCardId]);

  // A newly-created Lead Card opens immediately while its durable research
  // mission continues in the background. Keep the owner on the same card and
  // automatically replace the initial empty snapshot when evidence arrives.
  useEffect(() => {
    const opportunityId = researchProgress?.opportunity.id;
    const missionStatus = researchProgress?.mission?.status;
    if (!deal?.id || !opportunityId || !missionStatus || !ACTIVE_RESEARCH_STATUSES.has(missionStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await apiGet<{ mission: DealResearchMission | null }>(`/api/landos/opportunities/${opportunityId}/research-mission`);
        if (cancelled || !result.mission) return;
        setResearchProgress((current) => current ? { ...current, mission: result.mission } : current);
        if (!ACTIVE_RESEARCH_STATUSES.has(result.mission.status)) await load(deal.id, false);
      } catch {
        // A transient poll failure must not discard the saved lead or interrupt
        // the research worker. The next interval retries from durable state.
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 3_000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [deal?.id, researchProgress?.opportunity.id, researchProgress?.mission?.status]);

  // Load Trash lazily when the operator switches to the Trash view.
  useEffect(() => {
    if (listView === 'trash') { setConfirmPurgeId(null); void refreshTrash(); }
  }, [listView]);

  function setField<K extends keyof DealForm>(key: K, value: DealForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startCreate() {
    setSaveError(null);
    setForm(EMPTY_FORM);
    setMode('create');
  }

  function startEdit() {
    if (!deal) return;
    setSaveError(null);
    setForm({
      entity: deal.entity === 'LAND_ALLY' ? 'LAND_ALLY' : 'TY_LAND_BIZ',
      title: deal.title ?? '',
      status: deal.status ?? 'new',
      sellerNotes: deal.seller_notes ?? '',
      askingPrice: deal.asking_price != null ? String(deal.asking_price) : '',
      combinedStrategy: deal.combined_strategy ?? '',
      packageNotes: deal.package_notes ?? '',
    });
    setMode('edit');
  }

  function cancelForm() {
    setSaveError(null);
    setMode('view');
  }

  // Return to the saved-cards list (deselect the open card). Refreshes the list
  // so any just-saved edits to title/stage are reflected in the row.
  function backToList() {
    setDeal(null);
    setError(null);
    setMode('view');
    void refreshList();
  }

  // Build a write payload. Entity is only set on create (immutable after). An
  // empty asking price is omitted, never sent as 0.
  function payloadFromForm(isCreate: boolean): Record<string, unknown> {
    const askingNum = form.askingPrice.trim() === '' ? undefined : Number(form.askingPrice);
    const p: Record<string, unknown> = {
      title: form.title,
      status: form.status,
      sellerNotes: form.sellerNotes,
      combinedStrategy: form.combinedStrategy,
      packageNotes: form.packageNotes,
    };
    if (isCreate) p.entity = form.entity;
    if (askingNum !== undefined && Number.isFinite(askingNum)) p.askingPrice = askingNum;
    return p;
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'create') {
        const res = await apiPost<{ dealCard: DealCardDetail }>('/api/landos/deal-cards', payloadFromForm(true));
        // Re-load the same id from the API: proves the record persisted and is
        // recoverable, and keeps us on the one record (no duplicate creation).
        await load(res.dealCard.id);
        // Refresh the list so the new card is openable again later.
        await refreshList();
      } else if (mode === 'edit' && deal) {
        await apiPatch<{ dealCard: DealCardDetail }>(`/api/landos/deal-cards/${deal.id}`, payloadFromForm(false));
        await load(deal.id);
        await refreshList();
      }
      setMode('view');
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const prop = deal?.propertyCards?.[0];
  const seller = deal?.people?.find((p) => p.role === 'seller')
    ?? deal?.people?.find((p) => p.role === 'lead' || p.role === 'lead_contact');
  // Supporting context only — never parcel identity. Identity comes from the
  // canonical snapshot's sourced parcel facts.
  // Show the dedicated Resolution view (not a half-populated Deal Card) whenever
  // the parcel is NOT confirmed and we captured a resolution snapshot for it.
  const rejectedMismatch = prop?.verification_status === 'rejected_mismatch';
  const archivedParcel = prop?.verification_status === 'archived';
  const terminalParcel = rejectedMismatch || archivedParcel;
  const showResolution = terminalParcel
    || (!!resolution && !resolution.confirmed && !!resolution.snapshot);

  return (
    <div data-testid="deal-card-root" class="flex-1 overflow-y-auto px-6 pt-4 pb-40 space-y-4 dealcard-readable">
      {/* Toolbar: back-to-list (when a card is open) + create a new Deal Card. */}
      <div class="flex flex-wrap items-center gap-2">
        {mode === 'view' && deal && !dealCardId && (
          <button
            type="button"
            onClick={backToList}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
          >
            ← Deal Library
          </button>
        )}
        {mode === 'view' && (
          <>
            <button
              type="button"
              onClick={startCreate}
              class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)]"
            >
              New Deal Card
            </button>
            {/* Active / Trash toggle — only on the list surface (no card open). */}
            {!dealCardId && !deal && (
              <div class="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setListView('active')}
                  class={`px-3 py-1.5 text-[12px] font-medium ${listView === 'active' ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]'}`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setListView('trash')}
                  class={`px-3 py-1.5 text-[12px] font-medium border-l border-[var(--color-border)] ${listView === 'trash' ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]'}`}
                >
                  Trash{trash && trash.length > 0 ? ` (${trash.length})` : ''}
                </button>
              </div>
            )}
            {deal && (
              <button
                type="button"
                onClick={startEdit}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
              >
                Edit
              </button>
            )}
            {deal && !dealCardId && (
              <TrashCardButton
                dealCardId={deal.id}
                title={deal.title || `Deal #${deal.id}`}
                variant="labelled"
                onDeleted={() => { backToList(); void refreshTrash(); }}
                onError={setListError}
              />
            )}
          </>
        )}
      </div>

      {/* Create / edit form for the deal-level fields. */}
      {mode !== 'view' && (
        <DealForm
          mode={mode}
          form={form}
          setField={setField}
          onSave={() => void save()}
          onCancel={cancelForm}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Deal Library — the saved-deal list + primary open flow. Shown in view mode
          when no specific card is open and we are not embedded against a single id.
          Clicking a row opens that property's actual Deal Card (Property Intelligence
          Report) in place. This list is NOT itself a Deal Card. */}
      {mode === 'view' && !dealCardId && !deal && listView === 'active' && (
        <Section title="Deal Library">
          {listError && <div class="text-[11px] text-[var(--color-status-failed)]">{listError}</div>}
          {cards === null && !listError && <div class="text-[12px] text-[var(--color-text-muted)]">Loading…</div>}
          {cards !== null && cards.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
              No Deal Cards yet. Click <span class="text-[var(--color-accent)]">New Deal Card</span> to create your first one. It saves to the local LandOS store and will show up here.
            </div>
          )}
          {cards !== null && cards.length > 0 && (
            <div class="space-y-1.5">
              {cards.map((c) => (
                <div
                  key={c.id}
                  class="flex items-center gap-2 rounded-md border border-[var(--color-border)] pr-2 hover:bg-[var(--color-elevated)]"
                >
                  <button
                    type="button"
                    onClick={() => { if (onOpenDeal) onOpenDeal(c.id); else void load(c.id); }}
                    class="min-w-0 flex-1 text-left px-3 py-2"
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-[12px] font-medium truncate">{c.title || `Deal #${c.id}`}</span>
                      <LeadTypeBadge leadType={c.lead_type} />
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                        {entityBadge(c.entity)}
                      </span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                        {c.status}
                      </span>
                      <DdChip s={c.reportSummary} />
                      <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">#{c.id} · {formatRelativeTime(c.updated_at)}</span>
                    </div>
                  </button>
                  <TrashCardButton
                    dealCardId={c.id}
                    title={c.title || `Deal #${c.id}`}
                    onDeleted={() => { void refreshList(); void refreshTrash(); }}
                    onError={setListError}
                  />
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Trash / Deleted Deal Cards view. Soft-deleted cards are restorable, or can
          be permanently deleted after a second, irreversible confirmation. */}
      {mode === 'view' && !dealCardId && !deal && listView === 'trash' && (
        <Section title="Trash — Deleted Deal Cards">
          <div class="text-[11px] text-[var(--color-text-muted)] mb-2">
            Deleted Deal Cards are kept here until you restore them or permanently delete them. Nothing is auto-removed.
          </div>
          {trash === null && <div class="text-[12px] text-[var(--color-text-muted)]">Loading…</div>}
          {trash !== null && trash.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
              Trash is empty. Deleting a Deal Card moves it here.
            </div>
          )}
          {trash !== null && trash.length > 0 && (
            <div class="space-y-1.5">
              {trash.map((c) => (
                <div key={c.id} class="rounded-md border border-[var(--color-border)] px-3 py-2">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-medium truncate">{c.title || `Deal #${c.id}`}</span>
                    <LeadTypeBadge leadType={c.lead_type} />
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {entityBadge(c.entity)}
                    </span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {c.status}
                    </span>
                    <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
                      #{c.id} · deleted {c.deleted_at ? formatRelativeTime(c.deleted_at) : ''}
                    </span>
                  </div>
                  <div class="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void restoreCard(c.id)}
                      disabled={trashBusy === c.id}
                      class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                    >
                      {trashBusy === c.id && confirmPurgeId !== c.id ? 'Restoring…' : 'Restore'}
                    </button>
                    {confirmPurgeId !== c.id ? (
                      <button
                        type="button"
                        onClick={() => setConfirmPurgeId(c.id)}
                        disabled={trashBusy === c.id}
                        class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-status-failed)] text-[var(--color-status-failed)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                      >
                        Delete Permanently
                      </button>
                    ) : (
                      <span class="inline-flex items-center gap-2 rounded-md border border-[var(--color-status-failed)] bg-[var(--color-elevated)] px-2 py-1">
                        <span class="text-[11px] text-[var(--color-status-failed)] font-medium">Permanently delete? This cannot be undone.</span>
                        <button
                          type="button"
                          onClick={() => void purgeCard(c.id)}
                          disabled={trashBusy === c.id}
                          class="px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-status-failed)] text-white hover:opacity-90 disabled:opacity-40"
                        >
                          {trashBusy === c.id ? 'Deleting…' : 'Delete forever'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPurgeId(null)}
                          disabled={trashBusy === c.id}
                          class="px-2 py-0.5 rounded text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-card)] disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {mode === 'view' && error && <PageState error={error} />}
      {mode === 'view' && loading && !deal && <PageState loading />}

      {/* The versioned Property Summary is the identity read. On an unresolved card
          it is the whole story, so it stays pinned; on a tabbed card it belongs to
          the Overview and Property workspaces (below) rather than sitting above
          every tab, where it made switching tabs look like nothing changed. */}
      {/* Resolution view — parcel not yet confirmed. Shown INSTEAD of the Deal Card
          so no property-specific intelligence renders before confirmation. */}
      {mode === 'view' && deal && showResolution && (
        <>
          <div class="sticky top-0 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[14px] font-semibold">
                {prop?.active_input_address || deal.title || 'Untitled Deal'}
              </span>
              <LeadTypeBadge leadType={(deal as { lead_type?: string }).lead_type} />
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {entityBadge(deal.entity)}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-status-warn,var(--color-border))] text-[var(--color-text-muted)]">
                {rejectedMismatch ? 'Rejected mismatch' : archivedParcel ? 'Archived parcel' : 'Resolution pending'}
              </span>
            </div>
          </div>
          {terminalParcel ? (
            <Section title={rejectedMismatch ? 'Rejected parcel mismatch' : 'Archived parcel'}>
              <div class="rounded-lg border border-[var(--color-status-failed)] bg-[var(--color-card)] p-4 space-y-2">
                <div class="text-[13px] font-semibold text-[var(--color-status-failed)]">
                  This candidate is not the requested parcel.
                </div>
                <div class="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  No property intelligence, facts, valuation, Land Score, strategy, report, or offer is shown from this rejected record. Rejected evidence remains historical only.
                </div>
              </div>
            </Section>
          ) : resolution?.snapshot ? (
            <ResolutionView snapshot={resolution.snapshot} identity={resolution.parcelIdentity}
              entity={entity} dealCardId={deal.id} onConfirmed={() => void load(deal.id)} />
          ) : (
            <Section title="Property resolution">
              <div class="rounded-lg border border-[var(--color-status-warn,var(--color-border))] bg-[var(--color-card)] p-4 space-y-2">
                <div class="text-[13px] font-semibold">Exact parcel identity is required</div>
                <div class="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  The versioned Property Summary has withheld parcel-specific imagery, ranked comparables, value, and strategy until the identity conflict is resolved.
                </div>
              </div>
            </Section>
          )}
          {!terminalParcel && (
            <>
              {prop && (
                <PropertyIdentityControl
                  prop={prop}
                  snapshot={piSnapshot}
                  onSaved={() => load(deal.id)}
                />
              )}
              {/* Property Intelligence is what RESOLVES a parcel, so the launch
                  control and its snapshot belong here too. On an unresolved card
                  the snapshot withholds every parcel-specific conclusion and
                  shows only identity state, blockers and next actions — which is
                  exactly what the operator needs to move the card forward. */}
               <PropertyIntelligenceLaunch state={propertyIntelligence} />
               <PropertyIntelligenceOverview snapshot={piSnapshot} />
              <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
                Smart Intake evidence and editable candidates remain available while parcel-specific intelligence stays withheld.
              </div>
              <SmartIntakePanel dealId={deal.id} token={dashboardToken} onChanged={() => void load(deal.id)} />
            </>
          )}
        </>
      )}

      {mode === 'view' && deal && !showResolution && (
        <>
          {/* PINNED HEADER — always visible: identity, the critical-facts chips,
              the single critical next action, and the tab bar. The deal is legible
              in seconds and the next action never scrolls away. */}
          <div class="sticky top-0 z-10 -mx-6 px-6 pt-1 bg-[var(--color-bg)] border-b border-[var(--color-border)] space-y-2">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[15px] font-semibold">{piSnapshot?.identity.situs || prop?.active_input_address || deal.title || 'Untitled Deal'}</span>
                <LeadTypeBadge leadType={(deal as { lead_type?: string }).lead_type} />
                <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{entityBadge(deal.entity)}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">Stage: {deal.status}</span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <HeaderField label="Owner of record" value={piSnapshot?.identity.owner ?? prop?.owner} />
                <HeaderField label="APN / Parcel ID" value={piSnapshot?.identity.apn ?? prop?.apn} />
                <HeaderField
                  label="Acreage"
                  value={(piSnapshot?.identity.acres ?? prop?.acres) == null
                    ? null
                    : `${piSnapshot?.identity.acres ?? prop?.acres} ac`}
                />
                <HeaderField label="County / State" value={[piSnapshot?.identity.county ?? prop?.county, piSnapshot?.identity.state_ ?? prop?.state].filter(Boolean).join(', ')} />
              </div>
              <CriticalFactChips facts={currentCriticalFacts(piSnapshot, spine?.header?.criticalFacts)} />
              {(piSnapshot?.identity.discoveryUsable
                ? piSnapshot.nextActions[0]
                : spine?.header?.nextBestAction) && (
                <div class="text-[12px]"><span class="text-[var(--color-accent)] font-semibold">Next action:</span>{' '}<span class="text-[var(--color-text)]">{piSnapshot?.identity.discoveryUsable ? piSnapshot.nextActions[0] : spine?.header?.nextBestAction}</span></div>
              )}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div class="min-w-0 flex-1"><DealTabBar active={activeTab} onSelect={selectTab} /></div>
              <button type="button" data-testid="open-smart-intake" class="shrink-0 rounded-md border border-[var(--color-accent)] bg-[var(--color-card)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)] shadow-sm" onClick={() => selectTab('intake')}>+ Smart Intake</button>
            </div>
          </div>

          {researchProgress && (
            <DealResearchProgressPanel progress={researchProgress} retrying={researchRetrying} actionError={researchActionError} canonicalConfirmed={piSnapshot?.identity.state === 'confirmed' || resolution?.confirmed} onRetry={() => void retryResearch()} />
          )}

          {/* ── THE ACTIVE WORKSPACE ────────────────────────────────────────
              Exactly one tab's panel is in the document at a time, wrapped in a
              single identified tabpanel. Selecting a tab REPLACES the workspace;
              nothing sits above the panels competing for the viewport, which is
              what made tab clicks read as "nothing happened". Mounting a panel is
              read-only: it never runs research and never writes.

              The one exception is Smart Intake, which is DOCKED below (see the
              dock immediately after this container): retained originals are Deal
              Card evidence, not one tab's content. */}
          <div class="flex flex-col gap-3">
          <div
            role="tabpanel"
            id={`deal-panel-${activeTab}`}
            data-testid={`deal-panel-${activeTab}`}
            data-active-tab={activeTab}
            aria-labelledby={`deal-tab-${activeTab}`}
            class="space-y-3"
          >

          {/* ══ OVERVIEW TAB ══ Property Intelligence first: ONE launch control,
              live specialist progress, then the joined snapshot the operator
              actually decides from. The legacy summary panels follow it. */}
          {activeTab === 'overview' && (
            <div class="space-y-3">
              <PropertyIntelligenceLaunch state={propertyIntelligence} />
              <PropertyIntelligenceOverview snapshot={piSnapshot} />
            </div>
          )}
          {/* ══ DUE DILIGENCE TAB ══ The full screening detail: every public
              provider finding with evidence links, plus what remains unknown. */}
          {activeTab === 'diligence' && (
            <div class="space-y-3">
              <PropertyIntelligenceDueDiligence snapshot={piSnapshot} />
            </div>
          )}

          {/* ══ VISUALS TAB ══ Every parcel-tied evidence image: official overlay
              maps (exact boundary) + captured live visuals (Street View, 3D,
              LandPortal). */}
          {activeTab === 'visuals' && (
            <div class="space-y-3">
              <PropertyIntelligenceVisuals snapshot={piSnapshot} />
            </div>
          )}

          {/* ══ MARKET TAB ══ One question: should I want land here? Market Pulse
              and the growth/Data-Center scan run automatically — no buttons. */}
          {activeTab === 'market' && (
            <div class="space-y-3">
              <div class="text-[14px] font-bold text-[var(--color-text)] px-1">Should I want land here?</div>
              {/* THE comp result. The Deal Intelligence snapshot is the single
                  authoritative operator-facing answer: one comp set, one set of
                  counts, one valuation. */}
              <PropertyIntelligenceMarket snapshot={piSnapshot} />
            </div>
          )}

          {/* ══ PROPERTY TAB ══ The canonical parcel facts page. Multi-parcel
              leads render Parcel A / Parcel B separately from the backend
              parcel roster — each with its OWN honest state and card-scoped
              imagery. Imagery is never reused across parcels, and an unresolved
              parcel shows its next resolution action, never a stand-in image. */}
          {/* PROPERTY TAB — the versioned Property Summary is the canonical
              identity read; Overview and Property both open on it so identity is
              never asserted differently in two places. */}
          {activeTab === 'property' && (
            <div class="space-y-3">
              <PropertyIntelligenceProperty snapshot={piSnapshot} />
              {prop && (
                <PropertyIdentityControl
                  prop={prop}
                  snapshot={piSnapshot}
                  onSaved={() => load(deal.id)}
                />
              )}
            </div>
          )}

          {activeTab === 'property' && (parcelRoster?.length ?? 0) > 1 && (
            <div class="space-y-3">
              <div class="text-[12.5px] font-semibold text-[var(--color-text)] px-1">
                This lead covers {parcelRoster!.length} parcels — each shown separately; imagery is never reused across parcels.
              </div>
              {parcelRoster!.map((entry) => (
                <ParcelRosterBlock key={entry.apn} entry={entry} cards={deal.propertyCards ?? []} token={dashboardToken} />
              ))}
            </div>
          )}

          {/* Property Intelligence run controls + status — Documents tab.
              Preserves the Run / Re-run / Download Property Intelligence actions. */}

          {/* NO TAB IS EVER BLANK. Strategy is composed entirely from the
              Property Intelligence report, so before a report exists the tab
              rendered nothing at all and reading it as "the tabs do not work"
              was fair. Say what is missing and what unlocks it instead. */}
          {/* The five approved strategies + the one recommendation, straight
              from the joined Property Intelligence snapshot. */}
          {activeTab === 'strategy' && <PropertyIntelligenceStrategy snapshot={piSnapshot} />}

          {activeTab === 'strategy' && !piSnapshot && (
            <Section title="Strategy">
              <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
                <div class="text-[13px] font-semibold text-[var(--color-text)]">No strategy read yet</div>
                <div class="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  Exit strategy, pursuit posture, and the comp basis are all derived from Property Intelligence. It has not been run for this Deal Card, so nothing is asserted here — a strategy without evidence would be a guess.
                </div>
                <div class="text-[12px] text-[var(--color-text-muted)]">
                  Run Property Intelligence from the <span class="text-[var(--color-accent)]">Overview</span> tab to populate this workspace.
                </div>
              </div>
            </Section>
          )}

          {/* Visuals before any report/capture — honest placeholder, not a blank tab. */}
          {/* Report-derived sections, routed to their tabs (unchanged data/props). */}
          {/* ── WORKSHEETS + MANUAL SECTIONS — routed to the operator tabs.
              Seller / acquisitions / contacts / comms → Seller; the manual DD /
              Land Data + manual Land Score → Property; Deal Economics / Market
              Research → Market; Exit Strategy / Strategy / Pre-Call Brief →
              Strategy; documents/activity/quick actions → Documents. Same data,
              same handlers. */}
          {/* Seller / Acquisitions — seller profile + next action + call prep → Seller. */}
          {/* Manual DD worksheet removed — canonical reconciled facts render above. */}

          {/* 5. Contacts — every person/role on the deal (inherited leads -> heirs) → Seller */}
          {activeTab === 'seller' && (
          <Section title="Contacts">
            {(() => {
              const ownerName = piSnapshot?.identity.owner ?? prop?.owner ?? '';
              const samePerson = !!seller?.name && !!ownerName && seller.name.trim().toLowerCase() === String(ownerName).trim().toLowerCase();
              return samePerson ? (
                <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 mb-3">
                  <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Lead / contact and owner of record</div>
                  <div class="text-[12.5px] font-semibold text-[var(--color-text)] mt-0.5">{seller?.name}</div>
                  <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">One person record. Original official-record formatting remains available in Public Records and Activity.</div>
                </div>
              ) : (
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"><div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Owner of record</div><div class="text-[12.5px] font-semibold text-[var(--color-text)] mt-0.5">{ownerName || 'Not recorded'}</div></div>
                  <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"><div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Lead / contact</div><div class="text-[12.5px] font-semibold text-[var(--color-text)] mt-0.5">{seller?.name ?? 'Not recorded'}</div></div>
                </div>
              );
            })()}
            <AddDealContactControl dealId={deal.id} onSaved={() => load(deal.id)} />
            {(!deal.people || deal.people.length === 0) ? (
              <Placeholder text="No contacts captured yet" />
            ) : (
              <div class="space-y-2">
                {deal.people.map((p, i) => (
                  <div key={i} class="rounded-md border border-[var(--color-border)] p-2">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-[12px] font-medium text-[var(--color-text)]">{p.name || 'Unnamed'}</span>
                      {p.role && <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{p.role}</span>}
                      {p.authority_status && <span class="text-[10px] text-[var(--color-text-faint)]">{p.authority_status}</span>}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-x-4 mt-1">
                      <Field label="Phone" value={p.phone ?? undefined} />
                      <Field label="Email" value={p.email ?? undefined} />
                      <Field label="Mailing" value={p.mailing_address ?? undefined} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {seller?.name && (piSnapshot?.identity.owner ?? prop?.owner) && seller.name.trim().toLowerCase() !== String(piSnapshot?.identity.owner ?? prop?.owner).trim().toLowerCase() && (
              <div class="text-[11px] text-[var(--color-text-muted)] mt-2 border-t border-[var(--color-border)] pt-2">
                Lead/contact and owner-of-record names do not currently reconcile; confirm the relationship before contracting.
              </div>
            )}
          </Section>
          )}

          {/* Manual strategy worksheet removed — strategy truth lives in the
              shared strategy-readiness record above. */}

          {/* Manual market worksheet removed — market truth lives in the unique
              comp registry + cluster analysis above. */}

          {/* 8. Documents & quick actions → Documents (report controls above) */}
          {activeTab === 'documents' && <PropertyIntelligenceEvidence snapshot={piSnapshot} />}

          {activeTab === 'documents' && (
          <Section title="Reports & Files">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Generated reports</div>
            {piSnapshot ? (
              <div class="rounded-md border border-[var(--color-border)] p-2 space-y-1.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[12px] text-[var(--color-text)]">Property Intelligence Report</span>
                  {piSnapshot.completedAt && <span class="text-[10px] text-[var(--color-text-faint)]">last run {formatRelativeTime(new Date(piSnapshot.completedAt).getTime())}</span>}
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <a href={`/api/landos/deal-cards/${deal.id}/report/download?format=pdf&token=${encodeURIComponent(dashboardToken)}`} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Download PDF</a>
                  <a href={`/api/landos/deal-cards/${deal.id}/report/download?format=md&token=${encodeURIComponent(dashboardToken)}`} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Download Markdown</a>
                </div>
              </div>
            ) : (
              <Placeholder text="No report generated yet — run Property Intelligence (Overview or the report section above) to generate a downloadable report." />
            )}

            {/* Document registry — actual county-sourced pages, findings, and
                open document research; the deed viewer replaces path dumps. */}
            <div class="mt-3">
              <DocumentRegistryPanel registry={documentRegistry} dealId={deal.id} token={dashboardToken} />
            </div>

            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-1">Deal documents</div>
            <DocumentUploadPanel dealId={deal.id} token={dashboardToken} onUploaded={() => void loadCanonicalExtras(deal.id)} />
          </Section>
          )}

          {activeTab === 'activity' && (
          <Section title="Activity">
            <PropertyIntelligenceHistory view={propertyIntelligence.view} />
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Activity log</div>
            <ActivityTimeline dealId={deal.id} />
          </Section>
          )}

          </div>

          {/* ══ SMART INTAKE DOCK ══════════════════════════════════════════
              REGRESSION THIS FIXES: retained Smart Intake originals — the exact
              screenshot the operator submitted, its SHA-256 provenance, and the
              editable candidates — used to be part of the Deal Card body. When
              the tabbed workspace landed, the whole panel moved INSIDE the
              tabpanel, so confirming the parcel (which swaps the resolution view
              for this tabbed view) took the retained screenshot off the card
              entirely, and every tab change unmounted and refetched it.

              Retained originals are Deal Card EVIDENCE, not one tab's content.
              One persistent mount, present on every tab, so tab navigation can
              never unmount, refetch, hide, or detach the artifact, and canonical
              identity confirmation can never remove it from the card. Selecting
              Smart Intake pulls this same mounted panel to the top of the
              workspace (CSS order only) instead of rendering a second copy —
              there is exactly one SmartIntakePanel on the card at all times. */}
          {activeTab === 'intake' && (
            <div data-testid="smart-intake-dock" data-intake-active="true">
              <SmartIntakePanel dealId={deal.id} token={dashboardToken} onChanged={() => void load(deal.id, false)} />
            </div>
          )}

          </div>
        </>
      )}
    </div>
  );
}

// ── Create/edit form for the deal-level fields ──────────────────────────────
// Generic deal-level inputs only. Entity is fixed once a card exists. Parcel
// identity, verification, comps, and any CRM/GHL push are NOT editable here.
function DealForm({
  mode, form, setField, onSave, onCancel, saving, saveError,
}: {
  mode: 'create' | 'edit';
  form: DealForm;
  setField: <K extends keyof DealForm>(key: K, value: DealForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';
  return (
    <section class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
          {mode === 'create' ? 'New Deal Card' : 'Edit Deal Card'}
        </h3>
        <span class="text-[10px] text-[var(--color-text-faint)]">Deal-level fields only · saved to local LandOS store</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Entity</span>
          <select
            value={form.entity}
            disabled={mode === 'edit'}
            onChange={(e) => setField('entity', (e.target as HTMLSelectElement).value as DealForm['entity'])}
            class={`${inputCls} ${mode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="TY_LAND_BIZ">My Business</option>
            <option value="LAND_ALLY">Land Ally</option>
          </select>
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Stage</span>
          <select
            value={form.status}
            onChange={(e) => setField('status', (e.target as HTMLSelectElement).value)}
            class={inputCls}
          >
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Title / label</span>
          <input
            type="text"
            value={form.title}
            placeholder="e.g. Sample seller lead (generic)"
            onInput={(e) => setField('title', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller asking (negotiation context only)</span>
          <input
            type="number"
            value={form.askingPrice}
            placeholder="optional"
            onInput={(e) => setField('askingPrice', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Combined / exit strategy</span>
          <input
            type="text"
            value={form.combinedStrategy}
            placeholder="optional"
            onInput={(e) => setField('combinedStrategy', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller notes</span>
          <textarea
            value={form.sellerNotes}
            rows={2}
            onInput={(e) => setField('sellerNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Package notes</span>
          <textarea
            value={form.packageNotes}
            rows={2}
            onInput={(e) => setField('packageNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      {saveError && <div class="text-[11px] text-[var(--color-status-failed)]">{saveError}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
        <span class="text-[10px] text-[var(--color-text-faint)]">CRM / GHL push is not connected and stays approval-gated.</span>
      </div>
    </section>
  );
}
