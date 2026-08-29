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
  PropertyIntelligenceOverview,
  PropertyIntelligenceMarket,
  PropertyIntelligenceStrategy,
  PropertyIntelligenceVisuals,
  PropertyIntelligenceEvidence,
  type PiSnapshot,
} from '@/components/PropertyIntelligencePanel';
import { LandPortalBrowserUsePanel } from '@/components/LandPortalBrowserUsePanel';
import { SmartIntakePanel } from '@/components/LeadCardIntake';
import {
  DealWorkspaceOverview,
  type DealWorkspaceAcquisition,
  type DealWorkspaceCrmStatus,
  type DealWorkspaceTab,
} from '@/components/DealWorkspaceOverview';

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

function visibleEvidenceGaps(snapshot: PiSnapshot | null): string[] {
  if (!snapshot) return [];
  const decisionGaps = snapshot.dueDiligence.flatMap((item) => item.missing);
  const fallback = snapshot.missingInformation.filter((item) =>
    !/\b(?:collector|mission|detached frame|arcgis 499|provider error|navigation timeout|cleanup|capture exceeded|no source collector ran|execution failure)\b/i.test(item));
  const seen = new Set<string>();
  return [...decisionGaps, ...fallback]
    .map((item) => item.replace(/^[^:]{1,80}:\s*(?:partial result\s*[—-]\s*)?/i, '').trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export interface ParcelScopeNeighbor {
  apn: string | null;
  displayedOwner: string | null;
  ownerRelationLabel: string;
  improvement: 'improved' | 'vacant' | 'unknown';
  scope: string;
  scopeLabel: string;
  basis: string;
}

export interface ParcelScopeView {
  subjectApn: string | null;
  subjectOwner: string | null;
  subjectAcres: number | null;
  subjectIsVacant: boolean;
  operatorContext: {
    statement: string;
    clusterParcelCount: number | null;
    adjoiningManufacturedHome: boolean;
    corroborationLabel: string;
  } | null;
  neighbors: ParcelScopeNeighbor[];
  listing: { label: string; basis: string; acres: number | null; price: number | null; apn: string | null; buildingSqft: number | null; beds: number | null; carriesSubjectFacts: boolean } | null;
  landHome: { triggered: boolean; legallyApproved: boolean; label: string; reason: string; openQuestions: string[] };
  subjectFactGuard: string;
}

// Parcel scope. A subject investigation retains whatever sat next to the subject
// on the map, so the Deal has to say out loud which parcel is being bought,
// which ones the sellers keep, and which belong to somebody else entirely.
export function ParcelScopePanel({ scope }: { scope: ParcelScopeView | null }) {
  if (!scope) return null;
  const sellerSide = scope.neighbors.filter((n) => n.scope === 'related_seller_parcel');
  const others = scope.neighbors.filter((n) => n.scope !== 'related_seller_parcel');
  return (
    <section data-testid="parcel-scope" class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="text-sm font-semibold text-[var(--color-text)]">Parcel scope</h3>
        <span class="text-[11px] text-[var(--color-muted)]">Subject, seller holding, and neighbouring land kept apart.</span>
      </div>

      <div data-testid="parcel-scope-subject" class="rounded-lg border border-[var(--color-accent)] p-3">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">Transaction subject</div>
        <div class="mt-1 text-[13px] font-semibold text-[var(--color-text)]">
          APN {scope.subjectApn ?? 'unresolved'}
          {scope.subjectAcres != null ? ` · ${scope.subjectAcres} AC` : ''}
          {scope.subjectIsVacant ? ' · vacant land' : ''}
        </div>
        {scope.subjectOwner && <div class="text-[12px] text-[var(--color-muted)]">{scope.subjectOwner}</div>}
      </div>

      {scope.operatorContext && (
        <div data-testid="parcel-scope-operator" class="rounded-lg border border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Operator-confirmed context
            {scope.operatorContext.clusterParcelCount != null ? ` · ${scope.operatorContext.clusterParcelCount} seller parcels` : ''}
          </div>
          <p class="mt-1 text-[12px] text-[var(--color-text)]">{scope.operatorContext.statement}</p>
          <p class="mt-1 text-[11px] text-[var(--color-muted)]">{scope.operatorContext.corroborationLabel}</p>
        </div>
      )}

      {sellerSide.length > 0 && (
        <div data-testid="parcel-scope-seller-cluster" class="rounded-lg border border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Seller ownership cluster</div>
          <ul class="mt-1 space-y-1">
            {sellerSide.map((n) => (
              <li key={n.apn ?? n.displayedOwner} class="text-[12px] text-[var(--color-text)]">
                <span class="font-semibold">{n.apn ?? 'APN not displayed'}</span>
                {n.displayedOwner ? ` · ${n.displayedOwner}` : ''} · <span class="text-[var(--color-muted)]">{n.basis}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {others.length > 0 && (
        <div data-testid="parcel-scope-neighbors" class="rounded-lg border border-dashed border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Not part of this deal</div>
          <ul class="mt-1 space-y-1">
            {others.map((n) => (
              <li key={n.apn ?? n.displayedOwner} class="text-[12px] text-[var(--color-text)]">
                <span class="font-semibold">{n.apn ?? 'APN not displayed'}</span>
                {n.displayedOwner ? ` · ${n.displayedOwner}` : ''}
                {' · '}<span class="rounded bg-[var(--color-bg)] px-1 text-[11px] text-[var(--color-muted)]">{n.scopeLabel}</span>
                {n.improvement !== 'unknown' ? ` · ${n.improvement}` : ''}
                <div class="text-[11px] text-[var(--color-muted)]">{n.basis}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scope.listing && (
        <div data-testid="parcel-scope-listing" class="rounded-lg border border-[var(--color-border)] p-3">
          <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Retained listing · {scope.listing.label}</div>
          <div class="mt-1 text-[12px] text-[var(--color-text)]">
            {scope.listing.apn ? `APN ${scope.listing.apn} · ` : ''}
            {scope.listing.acres != null ? `${scope.listing.acres} acres` : 'acreage not stated'}
            {scope.listing.buildingSqft != null ? ` · ${scope.listing.buildingSqft.toLocaleString()} sqft` : ''}
            {scope.listing.beds != null ? ` · ${scope.listing.beds} bd` : ''}
            {scope.listing.price != null ? ` · asking $${scope.listing.price.toLocaleString()}` : ''}
          </div>
          <p class="mt-1 text-[11px] text-[var(--color-muted)]">{scope.listing.basis}</p>
        </div>
      )}

      <div data-testid="parcel-scope-land-home" class={`rounded-lg border p-3 ${scope.landHome.triggered ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
        <div class="text-[12px] font-semibold text-[var(--color-text)]">{scope.landHome.label}</div>
        <p class="mt-1 text-[11px] text-[var(--color-muted)]">{scope.landHome.reason}</p>
        {scope.landHome.triggered && (
          <>
            <p class="mt-1 text-[11px] font-semibold text-[var(--color-muted)]">Not a finding that a manufactured home may lawfully be placed on the subject. Still to establish:</p>
            <ul class="mt-1 list-disc pl-4">
              {scope.landHome.openQuestions.map((q) => (
                <li key={q} class="text-[11px] text-[var(--color-muted)]">{q}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p class="text-[11px] text-[var(--color-muted)]">{scope.subjectFactGuard}</p>
    </section>
  );
}

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
  const withToken = (u: string) => u;

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

// ── Activity timeline — meaningful CRM events ───────────────────────────────
// The underlying audit log intentionally retains every provider/run/capture
// record. This projection is the owner timeline: it groups related research
// writes and keeps only events that changed the deal or the operator's next move.
interface ActivityEventView { id: number; kind: string; summary: string; agentId: string; createdAt: number }

type CrmActivityCategory =
  | 'lead'
  | 'research_started'
  | 'research_updated'
  | 'government'
  | 'property'
  | 'document'
  | 'comps'
  | 'market'
  | 'valuation'
  | 'strategy'
  | 'score'
  | 'communication'
  | 'task'
  | 'offer'
  | 'note';

interface CrmActivityEvent extends ActivityEventView {
  category: CrmActivityCategory;
  label: string;
  displaySummary: string;
}

const CRM_ACTIVITY_LABEL: Record<CrmActivityCategory, string> = {
  lead: 'Lead created',
  research_started: 'Research launched',
  research_updated: 'Research updated',
  government: 'Government source',
  property: 'Property changed',
  document: 'Document added',
  comps: 'Comp set changed',
  market: 'Market changed',
  valuation: 'Valuation changed',
  strategy: 'Strategy changed',
  score: 'Score changed',
  communication: 'Seller communication',
  task: 'Task created',
  offer: 'Offer started',
  note: 'Note',
};

function crmActivityEvent(event: ActivityEventView): CrmActivityEvent | null {
  const kind = event.kind.toLowerCase();
  const text = `${event.kind} ${event.summary}`.toLowerCase();
  let category: CrmActivityCategory | null = null;

  if (/lead_created|deal_created|new_lead/.test(kind)) category = 'lead';
  else if (/research_started|research_queued|screening_queued/.test(kind)) category = 'research_started';
  else if (/county_verification|government|assessor|county_gis|planning|zoning_source|tax_record/.test(kind)) category = 'government';
  else if (/document_uploaded|document_retrieved|recorded_deed_page|deed_retrieved|plat_retrieved|survey_retrieved/.test(kind)) category = 'document';
  else if (/task_created|next_action/.test(kind)) category = 'task';
  else if (/offer_started|offer_created|begin_offer/.test(kind)) category = 'offer';
  else if (/seller_stated_fact|communication|comm_added|transcript_intake|smart_intake|discovery_note/.test(kind)) category = 'communication';
  else if (/valuation|working_value|price_changed/.test(kind) || /\bvaluation (changed|updated)\b/.test(text)) category = 'valuation';
  else if (/strategy|recommendation_changed/.test(kind)) category = 'strategy';
  else if (/score_changed|property_score|market_score|seller_score/.test(kind)) category = 'score';
  else if (/comparables|comp_|_comp|redfin|zillow/.test(kind)) category = 'comps';
  else if (/market_pulse|market_update/.test(kind)) category = 'market';
  else if (/identity|parcel_resolution|parcel_reconciled|locality_corrected|property_fact|operator_override|lead_contact_differs/.test(kind)) category = 'property';
  else if (/property_inspection|landportal_inspection|visual_intelligence|visual_capture|vision_analysis|duke_.*run|public_screening|property_intelligence/.test(kind)) category = 'research_updated';
  else if (kind === 'note' && !/(provider|orchestrat|mission|specialist|cleanup|readiness|classified|guard|browser)/.test(`${event.agentId} ${text}`)) category = 'note';

  if (!category) return null;

  let displaySummary = event.summary.trim() || CRM_ACTIVITY_LABEL[category];
  if (category === 'research_updated') {
    if (kind === 'vision_analysis' && displaySummary.length > 12) {
      displaySummary = `Property imagery reviewed: ${displaySummary}`;
    } else if (/visual|capture|landportal/.test(kind)) {
      displaySummary = 'Property imagery and visual findings were refreshed for the current parcel.';
    } else if (/public_screening/.test(kind)) {
      displaySummary = 'Property screening was updated with the latest available public-source findings.';
    } else {
      displaySummary = 'Property research was refreshed; the current facts and analysis were updated together.';
    }
  } else if (category === 'government' && !/attempt|retriev|found|unavailable|inconclusive|failed|saved/i.test(displaySummary)) {
    displaySummary = `${displaySummary}. The result remains preliminary until a useful record is retained.`;
  }

  return { ...event, category, label: CRM_ACTIVITY_LABEL[category], displaySummary };
}

function normalizedActivitySummary(value: string): string {
  return value
    .toLowerCase()
    .replace(/\brun\s*#?\s*\d+\b/g, 'run')
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/g, '')
    .trim();
}

function ownerActivityEvents(events: ActivityEventView[]): CrmActivityEvent[] {
  const projected = events.map(crmActivityEvent).filter((event): event is CrmActivityEvent => Boolean(event));
  const accepted: CrmActivityEvent[] = [];
  const exactSeen = new Map<string, number>();
  for (const event of projected) {
    const exactKey = `${event.category}:${normalizedActivitySummary(event.displaySummary)}`;
    const priorExactAt = exactSeen.get(exactKey);
    if (priorExactAt != null && Math.abs(priorExactAt - event.createdAt) <= 86_400) continue;

    // A single research action writes inspection, visual, analysis, and report
    // rows within minutes. One concise research update is the CRM event.
    if (event.category === 'research_updated') {
      const priorResearch = accepted.find((candidate) => candidate.category === 'research_updated' && Math.abs(candidate.createdAt - event.createdAt) <= 1_800);
      if (priorResearch) continue;
    }

    exactSeen.set(exactKey, event.createdAt);
    accepted.push(event);
  }
  return accepted;
}

function offerStatusLabel(acquisitionStage: string | null | undefined, dealStage: string): string {
  const stage = acquisitionStage || dealStage;
  const labels: Record<string, string> = {
    ready_for_offer_prep: 'Ready to prepare',
    offer_ready: 'Ready to prepare',
    offer_sent: 'Offer sent',
    under_contract: 'Under contract',
    closed: 'Closed',
  };
  return labels[stage] ?? 'Not started';
}

function ActivityTimeline({ events }: { events: ActivityEventView[] | null }) {
  if (!events) return <Placeholder text="Loading activity…" />;
  const visibleEvents = ownerActivityEvents(events);
  if (visibleEvents.length === 0) return <Placeholder text="No owner-facing activity recorded yet." />;
  return (
    <ol class="m-0 list-none space-y-2 p-0">
      {visibleEvents.map((e) => (
        <li key={e.id} class="flex items-start gap-3 border-b border-[var(--color-border)]/60 pb-2 last:border-0">
          <span class="mt-0.5 shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-[9.5px] font-semibold text-[var(--color-text-muted)]">{e.label}</span>
          <div class="min-w-0 flex-1">
            <div class="break-words text-[11.5px] leading-relaxed text-[var(--color-text)]">{e.displaySummary}</div>
            <div class="mt-0.5 text-[9.5px] text-[var(--color-text-faint)]">{formatRelativeTime(e.createdAt)}</div>
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
  id?: number;
  name?: string | null;
  role?: string | null;
  roles?: string[];
  authority_status?: string | null;
  authority_source?: string | null;
  phone?: string | null;
  email?: string | null;
  mailing_address?: string | null;
  preferred_contact_method?: string | null;
  notes?: string | null;
  link_note?: string | null;
  primary_contact?: number | boolean | null;
}

interface DealTaskLite {
  id: number;
  card_id?: number;
  action: string;
  status?: string;
  due_date?: string | null;
  dueDate?: string | null;
  assigned_owner?: string | null;
  assignedOwner?: string | null;
  priority?: string | null;
  reminder_at?: string | null;
  reminderAt?: string | null;
  created_at?: number;
  updated_at?: number;
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
  nextActions?: DealTaskLite[];
}

interface AcquisitionOverviewResponse {
  acquisition: DealWorkspaceAcquisition;
  stageLabel?: string;
  nextAction?: { label?: string; reason?: string };
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
type DealTab = DealWorkspaceTab;
const DEAL_TABS: Array<{ id: DealTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'market', label: 'Comps & Market' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'seller', label: 'Seller & Comms' },
  { id: 'documents', label: 'Documents & Visuals' },
];
const DEAL_TAB_IDS = new Set<string>([...DEAL_TABS.map((t) => t.id), 'intake']);
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
    <div role="tablist" aria-label="Deal Card workspaces" data-testid="deal-tabbar" class="inline-flex min-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-1 sm:min-w-0">
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
            class={`relative z-10 rounded-lg px-3 py-2 text-[11.5px] font-semibold whitespace-nowrap transition ${
              selected
                ? 'bg-[var(--color-accent)] text-white shadow-sm'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]'
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

type ContactFormState = {
  name: string;
  phone: string;
  email: string;
  mailingAddress: string;
  role: string;
  relationshipToOwner: string;
  authorityStatus: string;
  primaryContact: boolean;
  preferredContactMethod: string;
  notes: string;
};

const EMPTY_CONTACT_FORM: ContactFormState = {
  name: '',
  phone: '',
  email: '',
  mailingAddress: '',
  role: 'contact',
  relationshipToOwner: '',
  authorityStatus: 'unknown',
  primaryContact: false,
  preferredContactMethod: '',
  notes: '',
};

type DealTaskFormState = {
  title: string;
  dueDate: string;
  assignedOwner: string;
  priority: string;
  reminderAt: string;
};

const EMPTY_TASK_FORM: DealTaskFormState = {
  title: '',
  dueDate: '',
  assignedOwner: '',
  priority: 'normal',
  reminderAt: '',
};

type CrmCommunication = DealWorkspaceAcquisition['commLog'][number] & {
  id?: number | string;
  type?: string;
};

type CommunicationKind = 'call' | 'text' | 'email' | 'note' | 'transcript';

type CommunicationDraft = {
  kind: CommunicationKind;
  direction: 'inbound' | 'outbound';
  occurredAt: string;
  details: string;
  outcome: string;
  followUpDate: string;
  taskTitle: string;
};

function contactRoleForForm(role: string | null | undefined): string {
  const mapped: Record<string, string> = {
    lead_contact: 'lead',
    unknown_relation: 'contact',
    record_owner: 'owner',
  };
  return mapped[String(role ?? '')] ?? String(role ?? 'contact');
}

function contactFormFor(person?: PersonLite): ContactFormState {
  if (!person) return { ...EMPTY_CONTACT_FORM };
  return {
    name: person.name ?? '',
    phone: person.phone ?? '',
    email: person.email ?? '',
    mailingAddress: person.mailing_address ?? '',
    role: contactRoleForForm(person.role),
    relationshipToOwner: person.link_note ?? '',
    authorityStatus: person.authority_status ?? 'unknown',
    primaryContact: person.primary_contact === true || person.primary_contact === 1,
    preferredContactMethod: person.preferred_contact_method ?? '',
    notes: person.notes ?? '',
  };
}

function crmInputClass(): string {
  return 'mt-1.5 w-full min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';
}

function CrmField({
  label,
  value,
  onInput,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'date' | 'datetime-local';
  placeholder?: string;
}) {
  return (
    <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
        class={crmInputClass()}
      />
    </label>
  );
}

function ContactManager({
  dealId,
  people,
  acquisition,
  onSaved,
}: {
  dealId: number;
  people: PersonLite[];
  acquisition: DealWorkspaceAcquisition | null;
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<ContactFormState>({ ...EMPTY_CONTACT_FORM });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const setField = <K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const beginNew = () => {
    setForm({ ...EMPTY_CONTACT_FORM });
    setEditing('new');
    setMessage(null);
  };
  const beginEdit = (person: PersonLite) => {
    if (person.id == null) {
      setMessage('This legacy contact has no editable record ID. Refresh the Deal Card before editing it.');
      return;
    }
    setForm(contactFormFor(person));
    setEditing(person.id);
    setMessage(null);
  };
  const save = async (event: Event) => {
    event.preventDefault();
    if (!form.name.trim() || editing == null || busy) return;
    setBusy(true);
    setMessage(null);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      mailingAddress: form.mailingAddress.trim() || null,
      role: form.role,
      relationshipNote: form.relationshipToOwner.trim() || null,
      authorityStatus: form.authorityStatus,
      primaryContact: form.primaryContact,
      preferredContactMethod: form.preferredContactMethod || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing === 'new') {
        await apiPost(`/api/landos/deal-cards/${dealId}/people`, payload);
      } else {
        await apiPatch(`/api/landos/deal-cards/${dealId}/people/${editing}`, payload);
      }
      await onSaved();
      setEditing(null);
      setMessage(editing === 'new' ? 'Contact added.' : 'Contact updated.');
    } catch (error: any) {
      setMessage(error?.message || 'The contact could not be saved. Your entries are still here.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (person: PersonLite) => {
    if (person.id == null || busy) return;
    if (!window.confirm(`Remove ${person.name || 'this contact'} from this Deal Card? The person record is not erased from other deals.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiDelete(`/api/landos/deal-cards/${dealId}/people/${person.id}`);
      await onSaved();
      if (editing === person.id) setEditing(null);
      setMessage('Contact removed from this Deal Card.');
    } catch (error: any) {
      setMessage(error?.message || 'The contact could not be removed.');
    } finally {
      setBusy(false);
    }
  };
  const profilePrimaryName = acquisition?.profile.primaryContact ? acquisition.profile.name : null;
  return (
    <section class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-[13px] font-bold text-[var(--color-text)]">Contacts & decision-makers</h3>
          <p class="mt-1 break-words text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">Seller contacts stay separate from the government owner-of-record identity.</p>
        </div>
        <button type="button" onClick={beginNew} class="shrink-0 rounded-lg border border-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-[var(--color-accent)]">Add contact</button>
      </div>
      {people.length === 0 ? (
        <div class="mt-3 rounded-lg border border-dashed border-[var(--color-border)] p-3 text-[11px] text-[var(--color-text-faint)]">No contact has been captured yet.</div>
      ) : (
        <div class="mt-3 grid min-w-0 gap-2 lg:grid-cols-2">
          {people.map((person, index) => {
            const isPrimary = person.primary_contact === true || person.primary_contact === 1 || (!!profilePrimaryName && profilePrimaryName === person.name);
            return (
              <article key={person.id ?? `${person.name}-${index}`} class="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <span class="break-words text-[12px] font-bold text-[var(--color-text)]">{person.name || 'Unnamed contact'}</span>
                      {isPrimary && <span class="rounded-full border border-[var(--color-accent)] px-2 py-0.5 text-[9px] font-semibold text-[var(--color-accent)]">Primary</span>}
                    </div>
                    <div class="mt-0.5 break-words text-[10px] text-[var(--color-text-faint)]">{contactRoleForForm(person.role).replace(/_/g, ' ')}{person.link_note ? ` · ${person.link_note}` : ''}</div>
                  </div>
                  <div class="flex shrink-0 flex-wrap gap-1.5">
                    <button type="button" onClick={() => beginEdit(person)} class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-semibold">Edit</button>
                    <button type="button" onClick={() => void remove(person)} class="rounded-md border border-rose-500/40 px-2 py-1 text-[10px] font-semibold text-rose-400">Delete</button>
                  </div>
                </div>
                <dl class="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                  <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Phone</dt><dd class="break-all text-[11px] text-[var(--color-text)]">{person.phone || 'Not captured'}</dd></div>
                  <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Email</dt><dd class="break-all text-[11px] text-[var(--color-text)]">{person.email || 'Not captured'}</dd></div>
                  <div class="min-w-0 sm:col-span-2"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Mailing address</dt><dd class="break-words text-[11px] text-[var(--color-text)]">{person.mailing_address || 'Not captured'}</dd></div>
                  <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Decision authority</dt><dd class="break-words text-[11px] text-[var(--color-text)]">{person.authority_status && person.authority_status !== 'unknown' ? person.authority_status.replace(/_/g, ' ') : 'Needs confirmation'}</dd></div>
                  <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Preferred method</dt><dd class="break-words text-[11px] text-[var(--color-text)]">{person.preferred_contact_method || 'Not captured'}</dd></div>
                  {person.notes && <div class="min-w-0 sm:col-span-2"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Notes</dt><dd class="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-text)]">{person.notes}</dd></div>}
                </dl>
              </article>
            );
          })}
        </div>
      )}
      {editing != null && (
        <form onSubmit={save} class="mt-3 min-w-0 rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-elevated)] p-3">
          <div class="flex items-center justify-between gap-3">
            <h4 class="text-[11.5px] font-bold text-[var(--color-text)]">{editing === 'new' ? 'New contact' : 'Edit contact'}</h4>
            <button type="button" aria-label="Close contact editor" onClick={() => setEditing(null)} class="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)]">×</button>
          </div>
          <div class="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CrmField label="Full name" value={form.name} onInput={(value) => setField('name', value)} />
            <CrmField label="Phone" type="tel" value={form.phone} onInput={(value) => setField('phone', value)} />
            <CrmField label="Email" type="email" value={form.email} onInput={(value) => setField('email', value)} />
            <CrmField label="Mailing address" value={form.mailingAddress} onInput={(value) => setField('mailingAddress', value)} />
            <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Role<select value={form.role} onChange={(event) => setField('role', (event.currentTarget as HTMLSelectElement).value)} class={crmInputClass()}><option value="seller">Seller</option><option value="lead">Lead</option><option value="contact">Contact</option><option value="owner">Record owner</option><option value="heir">Heir</option><option value="agent">Agent</option></select></label>
            <CrmField label="Relationship to owner" value={form.relationshipToOwner} onInput={(value) => setField('relationshipToOwner', value)} placeholder="Trustee, spouse, broker…" />
            <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Decision authority<select value={form.authorityStatus} onChange={(event) => setField('authorityStatus', (event.currentTarget as HTMLSelectElement).value)} class={crmInputClass()}><option value="unknown">Needs confirmation</option><option value="title_to_confirm">Title to confirm</option><option value="can_sign">Can sign — verified</option><option value="cannot_sign">Cannot sign</option></select></label>
            <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Preferred contact method<select value={form.preferredContactMethod} onChange={(event) => setField('preferredContactMethod', (event.currentTarget as HTMLSelectElement).value)} class={crmInputClass()}><option value="">Not captured</option><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="voicemail">Voicemail</option><option value="in_person">In person</option></select></label>
            <label class="flex min-w-0 items-center gap-2 self-end rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[11px] text-[var(--color-text)]"><input type="checkbox" checked={form.primaryContact} onChange={(event) => setField('primaryContact', (event.currentTarget as HTMLInputElement).checked)} />Primary contact</label>
            <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)] sm:col-span-2 lg:col-span-3">Notes<textarea rows={3} value={form.notes} onInput={(event) => setField('notes', (event.currentTarget as HTMLTextAreaElement).value)} class={`${crmInputClass()} resize-y`} /></label>
          </div>
          <div class="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold">Cancel</button>
            <button type="submit" disabled={busy || !form.name.trim()} class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save contact'}</button>
          </div>
        </form>
      )}
      {message && <div role="status" class="mt-2 break-words text-[10.5px] text-[var(--color-text-muted)]">{message}</div>}
    </section>
  );
}

function TaskManager({
  propertyCardId,
  tasks,
  onSaved,
}: {
  propertyCardId: number | null;
  tasks: DealTaskLite[];
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<DealTaskFormState>({ ...EMPTY_TASK_FORM });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const setField = <K extends keyof DealTaskFormState>(key: K, value: DealTaskFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const edit = (task: DealTaskLite) => {
    setEditingId(task.id);
    setForm({
      title: task.action,
      dueDate: task.due_date ?? task.dueDate ?? '',
      assignedOwner: task.assigned_owner ?? task.assignedOwner ?? '',
      priority: task.priority ?? 'normal',
      reminderAt: task.reminder_at ?? task.reminderAt ?? '',
    });
    setMessage(null);
  };
  const reset = () => {
    setEditingId(null);
    setForm({ ...EMPTY_TASK_FORM });
  };
  const save = async (event: Event) => {
    event.preventDefault();
    if (!propertyCardId || !form.title.trim() || busyId != null) return;
    setBusyId(editingId ?? 'new');
    setMessage(null);
    const payload = {
      action: form.title.trim(),
      dueDate: form.dueDate || null,
      assignedOwner: form.assignedOwner.trim() || null,
      priority: form.priority,
      reminderAt: form.reminderAt || null,
      createdBy: 'landos/deal-card',
    };
    try {
      if (editingId == null) await apiPost(`/api/landos/property-cards/${propertyCardId}/next-action`, payload);
      else await apiPatch(`/api/landos/property-cards/${propertyCardId}/next-actions/${editingId}`, payload);
      await onSaved();
      setMessage(editingId == null ? 'Task added.' : 'Task updated.');
      reset();
    } catch (error: any) {
      setMessage(error?.message || 'The task could not be saved. Your entries are still here.');
    } finally {
      setBusyId(null);
    }
  };
  const setTaskStatus = async (task: DealTaskLite, status: 'completed' | 'open') => {
    if (!propertyCardId || busyId != null) return;
    setBusyId(task.id);
    setMessage(null);
    try {
      await apiPatch(`/api/landos/property-cards/${propertyCardId}/next-actions/${task.id}`, { status });
      await onSaved();
      setMessage(status === 'completed' ? 'Task completed.' : 'Task reopened.');
    } catch (error: any) {
      setMessage(error?.message || 'The task status could not be changed.');
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (task: DealTaskLite) => {
    if (!propertyCardId || busyId != null || !window.confirm(`Delete task “${task.action}”?`)) return;
    setBusyId(task.id);
    setMessage(null);
    try {
      await apiDelete(`/api/landos/property-cards/${propertyCardId}/next-actions/${task.id}`);
      await onSaved();
      if (editingId === task.id) reset();
      setMessage('Task deleted.');
    } catch (error: any) {
      setMessage(error?.message || 'The task could not be deleted.');
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section id="seller-tasks" class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div>
        <h3 class="text-[13px] font-bold text-[var(--color-text)]">Tasks & follow-up</h3>
        <p class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Keep the next move, owner, due date, priority, and reminder together.</p>
      </div>
      {tasks.length > 0 && (
        <div class="mt-3 space-y-2">
          {tasks.map((task) => {
            const due = task.due_date ?? task.dueDate;
            const owner = task.assigned_owner ?? task.assignedOwner;
            const reminder = task.reminder_at ?? task.reminderAt;
            const complete = task.status === 'complete' || task.status === 'completed' || task.status === 'done';
            return (
              <article key={task.id} class={`min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 ${complete ? 'opacity-65' : ''}`}>
                <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class={`break-words text-[11.5px] font-semibold text-[var(--color-text)] ${complete ? 'line-through' : ''}`}>{task.action}</div>
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-[var(--color-text-faint)]">
                      <span>Due {due || 'not set'}</span><span>Owner {owner || 'unassigned'}</span><span class="capitalize">Priority {task.priority || 'normal'}</span>{reminder && <span>Reminder {String(reminder).replace('T', ' ')}</span>}
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-wrap gap-1.5">
                    <button type="button" disabled={busyId != null} onClick={() => void setTaskStatus(task, complete ? 'open' : 'completed')} class="rounded-md border border-[var(--color-accent)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent)]">{complete ? 'Reopen' : 'Complete'}</button>
                    <button type="button" disabled={busyId != null} onClick={() => edit(task)} class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-semibold">Edit</button>
                    <button type="button" disabled={busyId != null} onClick={() => void remove(task)} class="rounded-md border border-rose-500/40 px-2 py-1 text-[10px] font-semibold text-rose-400">Delete</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <form onSubmit={save} class="mt-3 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
        <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">{editingId == null ? 'Add task' : 'Edit task'}</div>
        <div class="mt-2 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div class="min-w-0 sm:col-span-2"><CrmField label="Title" value={form.title} onInput={(value) => setField('title', value)} placeholder="Next action for this deal…" /></div>
          <CrmField label="Due date" type="date" value={form.dueDate} onInput={(value) => setField('dueDate', value)} />
          <CrmField label="Assigned owner" value={form.assignedOwner} onInput={(value) => setField('assignedOwner', value)} />
          <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Priority<select value={form.priority} onChange={(event) => setField('priority', (event.currentTarget as HTMLSelectElement).value)} class={crmInputClass()}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
          <div class="min-w-0 sm:col-span-2"><CrmField label="Reminder" type="datetime-local" value={form.reminderAt} onInput={(value) => setField('reminderAt', value)} /></div>
        </div>
        <div class="mt-3 flex flex-wrap justify-end gap-2">
          {editingId != null && <button type="button" onClick={reset} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold">Cancel edit</button>}
          <button type="submit" disabled={!propertyCardId || !form.title.trim() || busyId != null} class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{busyId != null ? 'Saving…' : editingId == null ? 'Add task' : 'Save task'}</button>
        </div>
      </form>
      {message && <div role="status" class="mt-2 break-words text-[10.5px] text-[var(--color-text-muted)]">{message}</div>}
    </section>
  );
}

function communicationIdentifier(entry: CrmCommunication): string {
  return String(entry.id ?? entry.createdAt);
}

function localDateTimeValue(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function communicationKind(entry: CrmCommunication): CommunicationKind {
  if (entry.type === 'transcript' || /transcript/i.test(entry.type ?? '')) return 'transcript';
  if (entry.channel === 'call' || entry.channel === 'text' || entry.channel === 'email') return entry.channel;
  return 'note';
}

function communicationDraftFor(entry?: CrmCommunication): CommunicationDraft {
  return {
    kind: entry ? communicationKind(entry) : 'call',
    direction: entry?.direction ?? 'inbound',
    occurredAt: localDateTimeValue(entry?.at) || localDateTimeValue(new Date().toISOString()),
    details: entry?.notes || entry?.summary || '',
    outcome: entry?.outcome ?? '',
    followUpDate: entry?.followUpDate ?? '',
    taskTitle: '',
  };
}

function CommunicationDialog({
  dealCardId,
  propertyCardId,
  entry,
  onClose,
  onSaved,
}: {
  dealCardId: number;
  propertyCardId: number | null;
  entry?: CrmCommunication;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const initial = useRef<CommunicationDraft>(communicationDraftFor(entry)).current;
  const [draft, setDraft] = useState<CommunicationDraft>(() => ({ ...initial }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLTextAreaElement | null>(null);
  const setField = <K extends keyof CommunicationDraft>(key: K, value: CommunicationDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Discard this unsaved communication?')) return;
    onClose();
  };
  useEffect(() => {
    firstField.current?.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = priorOverflow; };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirty, busy]);
  const save = async (event: Event) => {
    event.preventDefault();
    if (!draft.details.trim() || busy) return;
    setBusy(true);
    setError(null);
    const payload = {
      at: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : new Date().toISOString(),
      type: draft.kind,
      channel: draft.kind === 'transcript' || draft.kind === 'note' ? 'other' : draft.kind,
      direction: draft.direction,
      summary: draft.details.trim().slice(0, 500),
      notes: draft.details.trim(),
      outcome: draft.outcome.trim() || null,
      followUpDate: draft.followUpDate || null,
      sentiment: 'unknown',
      followUpNeeded: Boolean(draft.followUpDate),
    };
    try {
      if (entry) {
        await apiPatch(`/api/landos/deal-cards/${dealCardId}/acquisition/comm/${encodeURIComponent(communicationIdentifier(entry))}`, payload);
      } else {
        await apiPost(`/api/landos/deal-cards/${dealCardId}/acquisition/comm`, payload);
      }
      if (draft.followUpDate) {
        await apiPost(`/api/landos/deal-cards/${dealCardId}/acquisition/profile`, { profile: { nextFollowUpDate: draft.followUpDate } });
      }
      if (draft.taskTitle.trim() && propertyCardId) {
        await apiPost(`/api/landos/property-cards/${propertyCardId}/next-action`, {
          action: draft.taskTitle.trim(),
          dueDate: draft.followUpDate || null,
          createdBy: 'landos/deal-card',
        });
      }
      await onSaved();
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message || 'Communication could not be saved. Your entries are still here.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      class="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="crm-communication-title" class="flex max-h-[92vh] w-full max-w-2xl min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <header class="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
          <div class="min-w-0">
            <h2 id="crm-communication-title" class="text-[15px] font-bold text-[var(--color-text)]">{entry ? 'Edit communication' : 'Add communication'}</h2>
            <p class="mt-1 break-words text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">Record the interaction and its operational next step. Nothing is sent to the seller.</p>
          </div>
          <button type="button" aria-label="Close communication dialog" onClick={requestClose} class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[17px] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">×</button>
        </header>
        <form onSubmit={save} class="min-h-0 min-w-0 overflow-y-auto p-4 sm:p-5">
          <div class="grid min-w-0 gap-3 sm:grid-cols-2">
            <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Type<select value={draft.kind} onChange={(event) => setField('kind', (event.currentTarget as HTMLSelectElement).value as CommunicationKind)} class={crmInputClass()}><option value="call">Call</option><option value="text">Text</option><option value="email">Email</option><option value="note">Note</option><option value="transcript">Transcript</option></select></label>
            <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Direction<select value={draft.direction} onChange={(event) => setField('direction', (event.currentTarget as HTMLSelectElement).value as 'inbound' | 'outbound')} class={crmInputClass()}><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label>
            <CrmField label="Date & time" type="datetime-local" value={draft.occurredAt} onInput={(value) => setField('occurredAt', value)} />
            <CrmField label="Follow-up date" type="date" value={draft.followUpDate} onInput={(value) => setField('followUpDate', value)} />
          </div>
          <label class="mt-3 block min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
            Details
            <textarea
              ref={firstField}
              rows={8}
              value={draft.details}
              onInput={(event) => setField('details', (event.currentTarget as HTMLTextAreaElement).value)}
              placeholder={draft.kind === 'transcript' ? 'Paste the call transcript…' : 'What happened?'}
              class={`${crmInputClass()} resize-y whitespace-pre-wrap leading-relaxed`}
            />
          </label>
          <div class="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
            <CrmField label="Outcome" value={draft.outcome} onInput={(value) => setField('outcome', value)} placeholder="Reached seller, agreed next step…" />
            <CrmField label="Create follow-up task (optional)" value={draft.taskTitle} onInput={(value) => setField('taskTitle', value)} placeholder="Call after survey arrives" />
          </div>
          {error && <div role="alert" class="mt-3 break-words rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{error}</div>}
          <footer class="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={requestClose} disabled={busy} class="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold text-[var(--color-text)] disabled:opacity-40">Cancel</button>
            <button type="submit" disabled={!draft.details.trim() || busy} class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2.5 text-[11px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : entry ? 'Save changes' : 'Save communication'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CommunicationTimeline({
  dealCardId,
  propertyCardId,
  entries,
  openNewSignal,
  onSaved,
}: {
  dealCardId: number;
  propertyCardId: number | null;
  entries: CrmCommunication[];
  openNewSignal: number;
  onSaved: () => Promise<void> | void;
}) {
  const [dialogEntry, setDialogEntry] = useState<CrmCommunication | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (openNewSignal > 0) setDialogEntry('new');
  }, [openNewSignal]);
  const close = () => {
    setDialogEntry(null);
    window.setTimeout(() => addButton.current?.focus(), 0);
  };
  const remove = async (entry: CrmCommunication) => {
    const id = communicationIdentifier(entry);
    if (busyId || !window.confirm('Delete this communication from the Deal Card timeline?')) return;
    setBusyId(id);
    setMessage(null);
    try {
      await apiDelete(`/api/landos/deal-cards/${dealCardId}/acquisition/comm/${encodeURIComponent(id)}`);
      await onSaved();
      setMessage('Communication deleted.');
    } catch (error: any) {
      setMessage(error?.message || 'The communication could not be deleted.');
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section id="communication-timeline" class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-[13px] font-bold text-[var(--color-text)]">Communication timeline</h3>
          <p class="mt-1 break-words text-[10.5px] text-[var(--color-text-muted)]">Calls, texts, emails, notes, transcripts, outcomes, and follow-up stay in one history.</p>
        </div>
        <button ref={addButton} type="button" onClick={() => setDialogEntry('new')} class="shrink-0 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white">Add communication</button>
      </div>
      {entries.length === 0 ? (
        <div class="mt-3 rounded-lg border border-dashed border-[var(--color-border)] p-3 text-[11px] text-[var(--color-text-faint)]">No calls, texts, emails, notes, or transcripts recorded yet.</div>
      ) : (
        <ol class="mt-3 m-0 list-none space-y-2 p-0">
          {entries.map((entry, index) => {
            const id = communicationIdentifier(entry);
            return (
              <li key={`${id}-${index}`} class="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2 text-[9.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
                      <span class="font-bold text-[var(--color-text)]">{entry.direction} {communicationKind(entry)}</span>
                      <span>{new Date(entry.at).toLocaleString()}</span>
                      {entry.followUpDate && <span class="rounded-full border border-[var(--color-border)] px-2 py-0.5">Follow up {entry.followUpDate}</span>}
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-wrap gap-1.5">
                    <button type="button" disabled={busyId != null} onClick={() => setDialogEntry(entry)} class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-semibold">Edit</button>
                    <button type="button" disabled={busyId != null} onClick={() => void remove(entry)} class="rounded-md border border-rose-500/40 px-2 py-1 text-[10px] font-semibold text-rose-400">Delete</button>
                  </div>
                </div>
                <div class="mt-2 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--color-text)]">{entry.notes || entry.summary}</div>
                {entry.outcome && <div class="mt-2 break-words rounded-md border-l-2 border-[var(--color-accent)] bg-[var(--color-elevated)] px-2.5 py-2 text-[10.5px] text-[var(--color-text-muted)]"><strong class="text-[var(--color-text)]">Outcome:</strong> {entry.outcome}</div>}
              </li>
            );
          })}
        </ol>
      )}
      {message && <div role="status" class="mt-2 break-words text-[10.5px] text-[var(--color-text-muted)]">{message}</div>}
      {dialogEntry && (
        <CommunicationDialog
          key={dialogEntry === 'new' ? 'new' : communicationIdentifier(dialogEntry)}
          dealCardId={dealCardId}
          propertyCardId={propertyCardId}
          entry={dialogEntry === 'new' ? undefined : dialogEntry}
          onClose={close}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

function normalizedCrmText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function usefulSellerNote(note: string, propertyAddress: string | null | undefined): string {
  const normalized = normalizedCrmText(note);
  const address = normalizedCrmText(propertyAddress ?? '');
  if (!normalized) return '';
  if (address && (normalized === address || normalized.startsWith(`${address} `) || address.startsWith(`${normalized} `))) return '';
  if (/^(seller|contact|details|notes) (pending|unknown|not captured|to be captured)$/.test(normalized)) return '';
  return note;
}

function SellerCrmWorkspace({
  snapshot,
  deal,
  propertyCardId,
  propertyAddress,
  acquisition,
  onSaved,
}: {
  snapshot: PiSnapshot | null;
  deal: DealCardDetail;
  propertyCardId: number | null;
  propertyAddress?: string | null;
  acquisition: DealWorkspaceAcquisition | null;
  onSaved: () => Promise<void> | void;
}) {
  const people = deal.people ?? [];
  const profile = acquisition?.profile ?? {};
  const seller = people.find((person) => person.role === 'seller' || person.role === 'lead_contact') ?? people[0];
  const phone = profile.phone || seller?.phone || '';
  const email = profile.email || seller?.email || '';
  const ownerOfRecord = snapshot?.identity.owner?.trim() || '';
  const sellerName = String(profile.name || seller?.name || '').trim();
  const ownerMatchesSeller = Boolean(
    ownerOfRecord
    && sellerName
    && normalizedCrmText(ownerOfRecord) === normalizedCrmText(sellerName),
  );
  const actualSellerSignals = [
    deal.asking_price != null || Boolean(profile.askingPrice),
    Boolean(profile.motivation),
    Boolean(profile.timeline),
    Boolean(profile.decisionMakers) || Boolean(seller?.authority_status && seller.authority_status !== 'unknown'),
    Boolean(profile.priceFlexibility),
    Boolean(acquisition?.commLog.length),
  ];
  const hasSellerEvidence = actualSellerSignals.some(Boolean);
  const sellerScore = snapshot?.operatorAnalysis?.scores.seller;
  const missingInputs = [
    { label: 'Contact', captured: Boolean((profile.name || seller?.name) && (phone || email)) },
    { label: 'Asking price', captured: deal.asking_price != null || Boolean(profile.askingPrice) },
    { label: 'Motivation', captured: Boolean(profile.motivation) },
    { label: 'Timeline', captured: Boolean(profile.timeline) },
    { label: 'Responsiveness', captured: Boolean(acquisition?.commLog.length) },
    { label: 'Authority', captured: Boolean(profile.decisionMakers) || Boolean(seller?.authority_status && seller.authority_status !== 'unknown') },
    { label: 'Flexibility', captured: Boolean(profile.priceFlexibility) },
    { label: 'Cooperation', captured: Boolean(profile.communicationStyle || profile.personalityNotes || acquisition?.commLog.some((entry) => Boolean(entry.outcome))) },
  ];
  const [stage, setStage] = useState(acquisition?.stage ?? 'new_lead');
  const [assignedOwner, setAssignedOwner] = useState(profile.assignedOwner ?? '');
  const [followUpDate, setFollowUpDate] = useState(profile.nextFollowUpDate ?? '');
  const [crmBusy, setCrmBusy] = useState(false);
  const [crmMessage, setCrmMessage] = useState<string | null>(null);
  const [openCommunicationSignal, setOpenCommunicationSignal] = useState(0);
  useEffect(() => {
    setStage(acquisition?.stage ?? 'new_lead');
    setAssignedOwner(acquisition?.profile.assignedOwner ?? '');
    setFollowUpDate(acquisition?.profile.nextFollowUpDate ?? '');
  }, [acquisition]);
  const saveOperationalStatus = async () => {
    if (crmBusy) return;
    setCrmBusy(true);
    setCrmMessage(null);
    try {
      if (stage !== acquisition?.stage) {
        await apiPost(`/api/landos/deal-cards/${deal.id}/acquisition/stage`, { stage });
      }
      if (assignedOwner !== (acquisition?.profile.assignedOwner ?? '') || followUpDate !== (acquisition?.profile.nextFollowUpDate ?? '')) {
        await apiPost(`/api/landos/deal-cards/${deal.id}/acquisition/profile`, {
          profile: { assignedOwner: assignedOwner.trim() || null, nextFollowUpDate: followUpDate || null },
        });
      }
      await onSaved();
      setCrmMessage('CRM status updated.');
    } catch (error: any) {
      setCrmMessage(error?.message || 'CRM status could not be updated.');
    } finally {
      setCrmBusy(false);
    }
  };
  const sellerNotes = usefulSellerNote(deal.seller_notes, propertyAddress);
  const questions = snapshot?.operatorAnalysis?.seller.discoveryCallQuestions ?? snapshot?.missingInformation ?? [];
  const nextContact = snapshot?.operatorAnalysis?.seller.nextContactAction ?? snapshot?.nextActions?.[0] ?? 'Capture the missing seller inputs before setting offer posture.';
  return (
    <div data-testid="seller-crm-workspace" class="min-w-0 space-y-3">
      <section class="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Primary seller contact</div>
              <h2 class="mt-1 break-words text-[20px] font-bold text-[var(--color-text)]">{profile.name || seller?.name || 'Seller not captured'}</h2>
              <div class="mt-1 break-words text-[10.5px] text-[var(--color-text-muted)]">{profile.relationshipToProperty || contactRoleForForm(seller?.role) || 'Relationship not captured'}{profile.decisionMakers ? ` · ${profile.decisionMakers}` : ''}</div>
            </div>
            <div class="flex shrink-0 flex-wrap gap-2">
              <button type="button" disabled={!phone} onClick={() => phone && window.open(`tel:${phone}`, '_self')} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold disabled:opacity-35">Call</button>
              <button type="button" disabled={!phone} onClick={() => phone && window.open(`sms:${phone}`, '_self')} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold disabled:opacity-35">Text</button>
              <button type="button" disabled={!email} onClick={() => email && window.open(`mailto:${email}`, '_self')} class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold disabled:opacity-35">Email</button>
              <button type="button" onClick={() => setOpenCommunicationSignal((value) => value + 1)} class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white">Record outcome</button>
            </div>
          </div>
          <dl class="mt-4 grid min-w-0 gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2">
            <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Phone</dt><dd class="break-all text-[11.5px] font-semibold text-[var(--color-text)]">{phone || 'Not captured'}</dd></div>
            <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Email</dt><dd class="break-all text-[11.5px] font-semibold text-[var(--color-text)]">{email || 'Not captured'}</dd></div>
            <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Asking price</dt><dd class="break-words text-[11.5px] font-semibold text-[var(--color-text)]">{profile.askingPrice || (deal.asking_price == null ? 'Not captured' : `$${deal.asking_price.toLocaleString()}`)}</dd></div>
            <div class="min-w-0"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Preferred method</dt><dd class="break-words text-[11.5px] font-semibold text-[var(--color-text)]">{profile.preferredChannel || seller?.preferred_contact_method || 'Not captured'}</dd></div>
            <div class="min-w-0 sm:col-span-2"><dt class="text-[9px] uppercase text-[var(--color-text-faint)]">Government owner of record</dt><dd class="break-words text-[11.5px] font-semibold text-[var(--color-text)]">{ownerOfRecord || 'Not retrieved'}</dd><div class={`mt-1 break-words text-[9.5px] ${ownerMatchesSeller ? 'text-emerald-400' : 'text-[var(--color-text-faint)]'}`}>{ownerMatchesSeller ? 'Contact name matches the owner-of-record name.' : 'Confirm this contact’s relationship and signing authority before contracting.'}</div></div>
          </dl>
        </div>
        <div class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Seller score</div>
              <div class="mt-1 text-[26px] font-bold text-[var(--color-text)]">{hasSellerEvidence && sellerScore ? sellerScore.value : 'Pending'}</div>
            </div>
            {hasSellerEvidence && sellerScore && <span class="rounded-full border border-amber-500/40 px-2 py-1 text-[10px] font-semibold text-amber-400">{sellerScore.label}</span>}
          </div>
          <p class="mt-2 break-words text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">{hasSellerEvidence && sellerScore ? sellerScore.explanation : 'Seller evidence is still too thin to score. Property intake or generic notes do not count as seller motivation.'}</p>
          <div class="mt-3 grid grid-cols-2 gap-1.5">
            {missingInputs.map((item) => <div key={item.label} class={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[9.5px] ${item.captured ? 'border-emerald-500/30 text-emerald-400' : 'border-[var(--color-border)] text-[var(--color-text-faint)]'}`}><span aria-hidden="true">{item.captured ? '✓' : '○'}</span><span class="min-w-0 break-words">{item.label}</span></div>)}
          </div>
        </div>
      </section>
      <section class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div>
          <h3 class="text-[13px] font-bold text-[var(--color-text)]">Operational CRM</h3>
          <p class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Assign the lead, schedule the next touch, and advance stage from one place.</p>
        </div>
        <div class="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <label class="min-w-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Stage<select value={stage} onChange={(event) => setStage((event.currentTarget as HTMLSelectElement).value)} class={crmInputClass()}><option value="new_lead">New lead</option><option value="needs_discovery">Needs discovery</option><option value="discovery_complete">Discovery complete</option><option value="needs_follow_up">Needs follow-up</option><option value="ready_for_offer_prep">Ready for offer prep</option><option value="offer_sent">Offer sent</option><option value="stalled">Stalled</option><option value="paused">Paused</option><option value="pass">Pass</option></select></label>
          <CrmField label="Assigned owner" value={assignedOwner} onInput={setAssignedOwner} placeholder="Who owns this lead?" />
          <CrmField label="Follow-up date" type="date" value={followUpDate} onInput={setFollowUpDate} />
          <button type="button" disabled={crmBusy} onClick={() => void saveOperationalStatus()} class="h-[39px] rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 text-[11px] font-semibold text-white disabled:opacity-40">{crmBusy ? 'Saving…' : 'Save CRM status'}</button>
        </div>
        {crmMessage && <div role="status" class="mt-2 break-words text-[10.5px] text-[var(--color-text-muted)]">{crmMessage}</div>}
      </section>
      <ContactManager dealId={deal.id} people={people} acquisition={acquisition} onSaved={onSaved} />
      <TaskManager propertyCardId={propertyCardId} tasks={deal.nextActions ?? []} onSaved={onSaved} />
      <section class="grid min-w-0 gap-3 lg:grid-cols-2">
        <div class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 class="text-[12px] font-bold text-[var(--color-text)]">Discovery-call questions</h3>
          {questions.length ? <ul class="mt-3 m-0 space-y-2 p-0 pl-4">{questions.map((question, index) => <li key={index} class="break-words text-[11px] leading-relaxed text-[var(--color-text-muted)]">{question}</li>)}</ul> : <p class="mt-3 text-[11px] text-[var(--color-text-faint)]">No property-specific questions generated yet.</p>}
        </div>
        <div class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 class="text-[12px] font-bold text-[var(--color-text)]">Next contact action</h3>
          <p class="mt-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-text-muted)]">{nextContact}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpenCommunicationSignal((value) => value + 1)} class="rounded-lg border border-[var(--color-accent)] px-3 py-2 text-[10.5px] font-semibold text-[var(--color-accent)]">Record contact</button>
            <a href="#seller-tasks" class="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[10.5px] font-semibold text-[var(--color-text)]">Add follow-up task</a>
          </div>
        </div>
      </section>
      {sellerNotes && (
        <section class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <h3 class="text-[12px] font-bold text-[var(--color-text)]">Seller notes & negotiation context</h3>
          <p class="mt-3 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{sellerNotes}</p>
        </section>
      )}
      <CommunicationTimeline
        dealCardId={deal.id}
        propertyCardId={propertyCardId}
        entries={(acquisition?.commLog ?? []) as CrmCommunication[]}
        openNewSignal={openCommunicationSignal}
        onSaved={onSaved}
      />
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
  const [parcelScope, setParcelScope] = useState<ParcelScopeView | null>(null);
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
  const [activityEvents, setActivityEvents] = useState<ActivityEventView[] | null>(null);
  const [acquisitionOverview, setAcquisitionOverview] = useState<AcquisitionOverviewResponse | null>(null);
  const [researchProgress, setResearchProgress] = useState<DealResearchProgress | null>(null);
  const [researchRetrying, setResearchRetrying] = useState(false);
  const [researchActionError, setResearchActionError] = useState('');

  async function loadCanonicalExtras(id: number) {
    const [response, activityResponse, acquisitionResponse] = await Promise.all([
      apiGet<{
        documentRegistry?: DocumentRegistryView | null;
        parcelRoster?: ParcelRosterEntryView[] | null;
      }>('/api/landos/deal-cards/' + id + '/property-intelligence'),
      apiGet<{ events: ActivityEventView[] }>(`/api/landos/deal-cards/${id}/activity`),
      apiGet<AcquisitionOverviewResponse>(`/api/landos/deal-cards/${id}/acquisition`).catch(() => null),
    ]);
    setDocumentRegistry(response.documentRegistry ?? null);
    setParcelRoster(response.parcelRoster ?? null);
    setActivityEvents(activityResponse.events ?? []);
    setAcquisitionOverview(acquisitionResponse);
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
      const res = await apiGet<{ dealCard: DealCardDetail; businessSpine?: BusinessSpineView | null; opportunity?: DealResearchOpportunity | null; researchMission?: DealResearchMission | null; parcelScope?: ParcelScopeView | null }>(`/api/landos/deal-cards/${id}`);
      setDeal(res.dealCard);
      setParcelScope(res.parcelScope ?? null);
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
      setActivityEvents(null);
      setAcquisitionOverview(null);
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

  async function startOfferPreparation() {
    if (!deal) return;
    setResearchActionError('');
    try {
      await apiPost(`/api/landos/deal-cards/${deal.id}/acquisition/stage`, { stage: 'ready_for_offer_prep' });
      selectTab('seller');
      await load(deal.id, false);
    } catch (error) {
      setResearchActionError((error as Error).message || 'Offer preparation could not be started.');
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
  const latestOwnerActivity = ownerActivityEvents(activityEvents ?? [])[0] ?? null;
  const crmStatus: DealWorkspaceCrmStatus | null = deal ? {
    stageLabel: acquisitionOverview?.stageLabel
      || acquisitionOverview?.acquisition.stage.replace(/_/g, ' ')
      || deal.status.replace(/_/g, ' '),
    nextOperationalStep: acquisitionOverview?.nextAction?.label || 'Pending',
    followUpDate: acquisitionOverview?.acquisition.profile?.nextFollowUpDate ?? null,
    taskOwner: acquisitionOverview?.acquisition.profile?.assignedOwner ?? null,
    offerStatus: offerStatusLabel(acquisitionOverview?.acquisition.stage, deal.status),
    latestActivity: latestOwnerActivity ? {
      label: latestOwnerActivity.label,
      summary: latestOwnerActivity.displaySummary,
      createdAt: latestOwnerActivity.createdAt,
    } : null,
  } : null;

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
          <div
            class="sticky top-0 z-20 -mx-6 space-y-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6 pb-3 pt-2"
            data-acceptance-subject="true"
            data-subject-address={piSnapshot?.identity.displayAddress || piSnapshot?.identity.situs || prop?.active_input_address || deal.title || undefined}
            data-subject-apn={piSnapshot?.identity.apn ?? prop?.apn ?? undefined}
            data-subject-property-id={piSnapshot?.identity.lpPropertyId ?? undefined}
          >
            <div class="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div class="min-w-[260px] flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span id="deal-address" class="text-[18px] font-bold tracking-tight text-[var(--color-text)]">{piSnapshot?.identity.displayAddress || piSnapshot?.identity.situs || prop?.active_input_address || deal.title || 'Untitled Deal'}</span>
                  <LeadTypeBadge leadType={(deal as { lead_type?: string }).lead_type} />
                  <span class="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{deal.status.replace(/_/g, ' ')}</span>
                </div>
                <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[var(--color-text-muted)]">
                  <span><strong class="font-semibold text-[var(--color-text)]">{piSnapshot?.identity.acres ?? prop?.acres ?? '—'}</strong> acres</span>
                  <span>APN <strong class="font-semibold text-[var(--color-text)]">{piSnapshot?.identity.apn ?? prop?.apn ?? '—'}</strong></span>
                  {piSnapshot?.identity.lpPropertyId && <span>Property ID <strong class="font-semibold text-[var(--color-text)]">{piSnapshot.identity.lpPropertyId}</strong></span>}
                  <span>Owner <strong class="font-semibold text-[var(--color-text)]">{piSnapshot?.identity.owner ?? prop?.owner ?? '—'}</strong></span>
                  <span>{[piSnapshot?.identity.county ?? prop?.county, piSnapshot?.identity.state_ ?? prop?.state].filter(Boolean).join(', ') || 'Location pending'}</span>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" onClick={startEdit} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[11px] font-semibold text-[var(--color-text)] hover:border-[var(--color-accent)]">Edit deal</button>
                <button type="button" data-testid="open-smart-intake" class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] px-3 py-2 text-[11px] font-semibold text-[var(--color-accent)] shadow-sm" onClick={() => selectTab('intake')}>Update intake</button>
              </div>
            </div>
            <div class="min-w-0 overflow-x-auto"><DealTabBar active={activeTab} onSelect={selectTab} /></div>
          </div>

          {researchProgress && (
            <DealResearchProgressPanel progress={researchProgress} retrying={researchRetrying} actionError={researchActionError} canonicalConfirmed={piSnapshot?.identity.state === 'confirmed' || resolution?.confirmed} onRetry={() => void retryResearch()} />
          )}

          <ParcelScopePanel scope={parcelScope} />

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
          {/* Comps & Market and Documents & Visuals live in their own
              PERSISTENT tabpanels (below) so their canonical counts and
              evidence rows remain in the document — hidden, never unmounted —
              across tab changes. Independent visual acceptance verifies those
              counts after refresh and managed restart while a different tab is
              active, which is impossible when the panels unmount. Every other
              workspace keeps the original replace-on-select wrapper. */}
          {activeTab !== 'market' && activeTab !== 'documents' && (
          <div
            role="tabpanel"
            id={`deal-panel-${activeTab}`}
            data-testid={`deal-panel-${activeTab}`}
            data-active-tab={activeTab}
            aria-labelledby={activeTab === 'intake' ? undefined : `deal-tab-${activeTab}`}
            aria-label={activeTab === 'intake' ? 'Update intake' : undefined}
            class="space-y-3"
          >

          {/* ══ OVERVIEW TAB ══ Property Intelligence first: ONE launch control,
              live specialist progress, then the joined snapshot the operator
              actually decides from. The legacy summary panels follow it. */}
          {activeTab === 'overview' && (
            <div class="space-y-3">
              <DealWorkspaceOverview
                snapshot={piSnapshot}
                title={deal.title}
                stage={deal.status}
                askingPrice={deal.asking_price}
                sellerNotes={deal.seller_notes}
                people={deal.people ?? []}
                crmStatus={crmStatus}
                onNavigate={selectTab}
                onEdit={startEdit}
                onRunResearch={() => void propertyIntelligence.launch()}
                onStartOffer={() => void startOfferPreparation()}
                researchRunning={propertyIntelligence.running || propertyIntelligence.launching}
              />
              <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <summary class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text-muted)]">Research status & update controls</summary>
                <div class="mt-3"><PropertyIntelligenceLaunch state={propertyIntelligence} /></div>
              </details>
            </div>
          )}
          {/* ══ DUE DILIGENCE TAB ══ The full screening detail: every public
              provider finding with evidence links, plus what remains unknown. */}

          {/* ══ VISUALS TAB ══ Every parcel-tied evidence image: official overlay
              maps (exact boundary) + captured live visuals (Street View, 3D,
              LandPortal). */}

          {/* ══ MARKET TAB ══ Rendered in its persistent tabpanel below. */}

          {/* ══ PROPERTY TAB ══ The canonical parcel facts page. Multi-parcel
              leads render Parcel A / Parcel B separately from the backend
              parcel roster — each with its OWN honest state and card-scoped
              imagery. Imagery is never reused across parcels, and an unresolved
              parcel shows its next resolution action, never a stand-in image. */}
          {/* PROPERTY TAB — the versioned Property Summary is the canonical
              identity read; Overview and Property both open on it so identity is
              never asserted differently in two places. */}

          {activeTab === 'overview' && (parcelRoster?.length ?? 0) > 1 && (
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
            <SellerCrmWorkspace
              snapshot={piSnapshot}
              deal={deal}
              propertyCardId={prop?.id ? Number(prop.id) : null}
              propertyAddress={piSnapshot?.identity.situs ?? prop?.active_input_address}
              acquisition={acquisitionOverview?.acquisition ?? null}
              onSaved={() => load(deal.id)}
            />
          )}
          {/* Manual strategy worksheet removed — strategy truth lives in the
              shared strategy-readiness record above. */}

          {/* Manual market worksheet removed — market truth lives in the unique
              comp registry + cluster analysis above. */}

          {/* 8. Documents & quick actions → the persistent Documents tabpanel below. */}

          {activeTab === 'overview' && prop && (
            <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <summary class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text-muted)]">Correct property identity</summary>
              <div class="mt-3">
                <div class="mb-3"><CriticalFactChips facts={currentCriticalFacts(piSnapshot, spine?.header?.criticalFacts)} /></div>
                <PropertyIdentityControl prop={prop} snapshot={piSnapshot} onSaved={() => load(deal.id)} />
              </div>
            </details>
          )}

          </div>
          )}

          {/* ══ MARKET TAB — PERSISTENT PANEL ══ One question: should I want
              land here? Stays mounted (hidden when inactive) so the canonical
              comp counts and rows remain verifiable in the document. */}
          <div
            role="tabpanel"
            id="deal-panel-market"
            data-testid="deal-panel-market"
            aria-labelledby="deal-tab-market"
            hidden={activeTab === 'market' ? undefined : true}
            class="space-y-3"
          >
            <div class="text-[14px] font-bold text-[var(--color-text)] px-1">Should I want land here?</div>
            {/* THE comp result. The Deal Intelligence snapshot is the single
                authoritative operator-facing answer: one comp set, one set of
                counts, one valuation. */}
            <PropertyIntelligenceMarket snapshot={piSnapshot} />
            {/* Browser Use pilot: visible LandPortal comp candidates + the
                recorded attempt. Renders only once a persisted result exists. */}
            <LandPortalBrowserUsePanel dealId={deal?.id ?? dealCardId ?? null} variant="comps" />
          </div>

          {/* ══ DOCUMENTS TAB — PERSISTENT PANEL ══ Every parcel-tied evidence
              image plus reports, document registry, research tasks, and the
              activity log. Stays mounted (hidden when inactive) so the retained
              visual evidence remains verifiable in the document. */}
          <div
            role="tabpanel"
            id="deal-panel-documents"
            data-testid="deal-panel-documents"
            aria-labelledby="deal-tab-documents"
            hidden={activeTab === 'documents' ? undefined : true}
            class="space-y-3"
          >
            <PropertyIntelligenceVisuals snapshot={piSnapshot} />
            <PropertyIntelligenceEvidence snapshot={piSnapshot} />
            {/* Browser Use LandPortal pilot — launch control + the full
                persisted result (facts, visuals, conflicts, honest gaps). */}
            <LandPortalBrowserUsePanel dealId={deal?.id ?? dealCardId ?? null} variant="evidence" />

          <Section title="Reports & Files">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Generated reports</div>
            {piSnapshot ? (
              <div class="rounded-md border border-[var(--color-border)] p-2 space-y-1.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[12px] text-[var(--color-text)]">Property Intelligence Report</span>
                  {piSnapshot.completedAt && <span class="text-[10px] text-[var(--color-text-faint)]">last run {formatRelativeTime(new Date(piSnapshot.completedAt).getTime())}</span>}
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <a href={`/api/landos/deal-cards/${deal.id}/report/download?format=pdf`} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Download PDF</a>
                  <a href={`/api/landos/deal-cards/${deal.id}/report/download?format=md`} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Download Markdown</a>
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

          <Section title="Outstanding research tasks">
            {(piSnapshot?.nextActions.length ?? 0) > 0 || visibleEvidenceGaps(piSnapshot).length > 0 ? (
              <div class="grid gap-3 lg:grid-cols-2">
                <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Next research actions</div>
                  <ul class="mt-2 space-y-1.5">
                    {(piSnapshot?.nextActions ?? []).map((item, index) => <li key={index} class="break-words text-[11px] leading-relaxed text-[var(--color-text-muted)]">• {item}</li>)}
                  </ul>
                </div>
                <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Evidence still needed</div>
                  <ul class="mt-2 space-y-1.5">
                    {visibleEvidenceGaps(piSnapshot).map((item, index) => <li key={index} class="break-words text-[11px] leading-relaxed text-[var(--color-text-muted)]">• {item}</li>)}
                  </ul>
                </div>
              </div>
            ) : <Placeholder text="No outstanding research task is recorded on the current snapshot." />}
          </Section>

          <Section title="Activity">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Activity log</div>
            <ActivityTimeline events={activityEvents} />
          </Section>
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
