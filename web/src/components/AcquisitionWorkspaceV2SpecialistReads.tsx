// LandOS specialist intelligence reads — the three persisted specialist
// products (PROPERTY / MARKET + AREA / SELLER), rendered compactly on the
// Overview so the operator can answer "what does Property think, what does
// Market think, what does Seller think?" without hunting through diagnostics.
//
// Everything here is FETCHED, persisted state: rendering never runs a model.
// These are the specialists' current opinions, not the raw reports — the deep
// evidence stays on Property & Market and the activity surfaces. Seller shows
// the honest pre-contact state until real communication exists, and every
// seller-reported statement stays visibly SELLER-REPORTED, never a canonical
// fact. Deal Brain remains the separate synthesizer above these three.

import { Landmark, Sparkles, TrendingUp, UserRound } from 'lucide-preact';

import '../styles/workspace-v2-specialist-reads.css';

// ── View types (fields these cards consume from the persisted products) ────

interface RuntimeView { agentProfile?: string; provider?: string; model?: string }

/** The persisted outlook change state, as the cards consume it. */
export interface OutlookView {
  status?: string;
  readVersion?: number;
  previousReadVersion?: number | null;
  changedAt?: string | null;
  changeSummary?: string | null;
  changeDrivers?: string[];
}

/** UPDATED is the only state the operator is signalled about — an INITIAL read
 *  has no prior opinion to have moved, and UNCHANGED means the specialist
 *  looked again and thinks the same thing. Neither may glow. */
export function outlookIsUpdated(outlook?: OutlookView | null): boolean {
  return (outlook?.status ?? '').toUpperCase() === 'UPDATED';
}

/** The badge + optional one-line WHAT CHANGED. Never a text wall. */
export function UpdatedOutlookBadge({ outlook, testid }: { outlook?: OutlookView | null; testid: string }) {
  if (!outlookIsUpdated(outlook)) return null;
  return (
    <div class="awv2-outlook-flag" data-testid={testid}>
      <span class="awv2-outlook-chip"><Sparkles size={11} aria-hidden="true" /> UPDATED OUTLOOK</span>
      {outlook?.changeSummary && (
        <p class="awv2-outlook-what"><b>WHAT CHANGED</b> {outlook.changeSummary}</p>
      )}
    </div>
  );
}

export interface PropertyIntelligenceReadView {
  score?: number | null;
  quality?: string | null;
  read?: string;
  /** Persisted CURRENT EXPERT READ — the specialist's concise operator brief
   *  produced with the product. Absent on pre-upgrade snapshots. */
  currentExpertRead?: string | null;
  /** Semantic outlook change state for the current read. UPDATED is the only
   *  state that earns the stronger card treatment. */
  outlook?: OutlookView | null;
  strengths?: string[];
  constraints?: Array<{ title?: string; why?: string | null; severity?: string }>;
  potential?: string[];
  unusual?: string[];
  externalities?: string[];
  developmentPotential?: string | null;
  conflicts?: Array<{ subject?: string; statement?: string; resolution?: string }>;
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  nextActions?: Array<{ action?: string; why?: string | null }>;
  visualObservations?: Array<{ visual?: string; observation?: string; basis?: string | null }>;
  configurations?: Array<{ label?: string; status?: string; prerequisites?: string[] }>;
  /** Stage A prose, preserved verbatim — the full expert review behind the
   *  structured extraction above. */
  expertReview?: string;
  generatedAt?: string;
  runtime?: RuntimeView;
}

export interface MarketIntelligenceReadView {
  score?: number | null;
  quality?: string | null;
  read?: string;
  /** Persisted CURRENT EXPERT READ — the specialist's concise operator brief
   *  produced with the product. Absent on pre-upgrade snapshots. */
  currentExpertRead?: string | null;
  /** Semantic outlook change state for the current read. UPDATED is the only
   *  state that earns the stronger card treatment. */
  outlook?: OutlookView | null;
  liquidityRead?: string | null;
  areaStory?: string | null;
  buyerPool?: string | null;
  bestSignals?: string[];
  risks?: string[];
  exitImplications?: string[];
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  subjectBand?: {
    band?: string | null; medianDaysOnMarket?: number | null; sellThroughRate?: number | null;
    monthsOfSupply?: number | null; medianPricePerAcre?: number | null;
  } | null;
  fastestBand?: string | null;
  overallMarketQuality?: { grade?: string | null; read?: string | null };
  /** The persisted free-form expert market review (verbatim). Rendered only
   * on the Market page; Overview keeps the concise read. */
  expertReview?: string;
  exitProductFits?: Array<{ product?: string; grade?: string | null; expectedDays?: number | null; confidence?: string | null; read?: string | null }>;
  generatedAt?: string;
  runtime?: RuntimeView;
}

export interface SellerIntelligenceReadView {
  state?: string;
  version?: number;
  phase?: string;
  read?: string;
  /** Semantic outlook change state for the current read. UPDATED is the only
   *  state that earns the stronger card treatment. */
  outlook?: OutlookView | null;
  sellerTrajectory?: string | null;
  materialChanges?: Array<{ dimension?: string; priorState?: string | null; currentState?: string; direction?: string | null; evidence?: string | null; whyItMatters?: string | null }>;
  whatMattersMostNow?: string | null;
  nextConversationObjective?: string | null;
  transactionLikelihood?: string | null;
  urgency?: string | null;
  priceMovement?: string | null;
  priceFlexibility?: string | null;
  responsiveness?: string | null;
  followThrough?: string | null;
  termsFlexibility?: string | null;
  evidenceWeight?: string | null;
  expertReview?: string;
  motivation?: string | null;
  priceExpectation?: string | null;
  timeline?: string | null;
  decisionMakers?: string | null;
  objections?: string[];
  negotiationPosture?: string | null;
  bestApproach?: string | null;
  sellerReportedFacts?: Array<{ statement?: string; attribution?: string }>;
  followUps?: string[];
  contradictions?: Array<{ subject?: string; earlier?: string | null; later?: string | null; interpretation?: string | null }>;
  unknowns?: Array<{ question?: string; whyItMatters?: string | null }>;
  nextQuestion?: string | null;
  generatedAt?: string;
  runtime?: RuntimeView;
}

export interface SpecialistStaleView { property?: boolean; market?: boolean; seller?: boolean }

/** The persisted bounded reconciliation record, as the card consumes it. */
export interface IntelligenceReconciliationView {
  request?: {
    question?: string;
    requestedCapability?: string;
    issueType?: string;
    reasonMaterial?: string;
    evidenceConflictRefs?: string[];
  } | null;
  validation?: { decision?: string; refusalReason?: string | null };
  execution?: {
    executionCount?: number;
    capabilityId?: string | null;
    reusedExistingEvidence?: boolean;
    status?: string | null;
    recordStatus?: string | null;
    summary?: string | null;
    evidence?: Array<{ source?: string; sourceUrl?: string | null; retrievedAt?: string }>;
    attemptNote?: string | null;
  };
  reread?: { rereadCount?: number; layers?: string[]; outcome?: string | null };
  before?: { conflictStatement?: string | null; conflictResolution?: string | null; read?: string | null };
  after?: { conflictStatement?: string | null; conflictResolution?: string | null; read?: string | null };
  status?: string;
  statusReason?: string;
  readiness?: string;
  recommendedNextAction?: string | null;
  completedAt?: string;
}

export interface ReconcileEligibleView {
  conflictSubject?: string | null;
  issueType?: string;
  requestedCapability?: string;
}

/** Explicit operator verification controls + the persisted record. Rendering
 *  never runs anything; only the button's handler starts the bounded run. */
export interface PropertyReconcileControls {
  record: IntelligenceReconciliationView | null;
  eligible: ReconcileEligibleView[];
  running: boolean;
  error: string | null;
  onReconcile: (conflictSubject?: string | null) => void;
}

/** The persisted official acreage / parcel-extent reconciliation, as consumed. */
export interface AcreageExtentView {
  decision?: {
    status?: string;
    canonicalAcres?: number | null;
    canonicalSource?: string | null;
    confidence?: string;
    parcelExtent?: string | null;
    extentExplanation?: string | null;
    retained?: Array<{ valueAcres?: number; valueType?: string; source?: string; vintage?: string; note?: string }>;
    reasoning?: Array<{ classification?: string; statement?: string }>;
    canonicalChanged?: boolean;
    staleProducts?: string[];
    unresolvedQuestions?: string[];
  } | null;
  adoption?: { adopted?: boolean; previousAcres?: number | null; newAcres?: number | null; note?: string } | null;
  staleSince?: string | null;
  /** The recorded per-product resolution of the stale markers, when the
   *  bounded dependent-product resolver has run. */
  dependentRefresh?: {
    runAt?: string;
    canonicalAcres?: number;
    outcomes?: Array<{ product?: string; status?: string; basis?: string; evidence?: string[] }>;
    remainingStale?: string[];
  } | null;
  completedAt?: string;
  refusalReason?: string | null;
}

/** Explicit operator controls for the bounded acreage reconciliation run. */
export interface AcreageExtentControls {
  record: AcreageExtentView | null;
  running: boolean;
  error: string | null;
  onReconcile: () => void;
  /** Runs the bounded deterministic stale-product resolver. */
  resolvingDependents?: boolean;
  onResolveDependents?: (() => void) | null;
}

// ── Shared pieces ──────────────────────────────────────────────────────────

function ScoreChip({ score, quality }: { score: number | null | undefined; quality?: string | null }) {
  const tone = score == null ? 'pending' : score >= 65 ? 'strong' : score >= 50 ? 'moderate' : 'weak';
  return (
    <span class={`awv2-specialist-score s-${tone}`}>
      <b>{score ?? '—'}</b>
      <small>{score == null ? 'No score' : quality ?? '/100'}</small>
    </span>
  );
}

function ReadFooter({ generatedAt, runtime, stale }: { generatedAt?: string; runtime?: RuntimeView; stale?: boolean }) {
  const when = generatedAt ? new Date(generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <footer class="awv2-specialist-foot">
      {when && <span>Read {when}{runtime?.model ? ` · ${runtime.model}` : ''}</span>}
      {stale && <span class="stale" data-testid="specialist-stale">New evidence since this read — refresh from the Deal Read controls</span>}
    </footer>
  );
}

const lines = (items: Array<string | undefined> | undefined, limit: number): string[] =>
  (items ?? []).filter((item): item is string => !!item?.trim()).slice(0, limit);

// ── Property Intelligence ──────────────────────────────────────────────────

const RECONCILE_STATUS_LABEL: Record<string, string> = {
  resolved: 'Resolved',
  partially_resolved: 'Partially resolved',
  unresolved: 'Unresolved',
  refused: 'Request refused',
  no_material_request: 'No supported conflict',
};

/** CONFLICT / VERIFICATION / RESULT / CURRENT READ / STATUS — the persisted
 *  outcome of one bounded intelligence → capability → re-read run. */
function ReconciliationPanel({ record }: { record: IntelligenceReconciliationView }) {
  const status = record.status ?? 'unresolved';
  const tone = status === 'resolved' ? 'strong' : status === 'partially_resolved' ? 'moderate' : 'weak';
  const evidence = (record.execution?.evidence ?? []).filter((item) => item.source);
  const verification = [
    record.execution?.capabilityId ? `Requested capability: ${record.execution.capabilityId}` : null,
    record.execution?.reusedExistingEvidence
      ? 'Fresh retained official evidence answered without a re-run'
      : record.execution?.executionCount != null
        ? `Executed ${record.execution.executionCount}×`
        : null,
    record.reread?.rereadCount != null ? `targeted re-read ${record.reread.rereadCount}×` : null,
    record.validation?.refusalReason ? `Refused: ${record.validation.refusalReason}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div class="awv2-specialist-reconcile" data-testid="specialist-property-reconciliation">
      <b>Official-record verification</b>
      <p><i>Conflict</i> {record.request?.reasonMaterial ?? record.before?.conflictStatement ?? '—'}</p>
      <p><i>Verification</i> {verification || '—'}</p>
      <p><i>Result</i> {record.execution?.summary ?? record.execution?.attemptNote ?? 'No capability result was produced.'}
        {evidence.length > 0 && <small> — {evidence.map((item) => item.source).join('; ')}</small>}
      </p>
      <p><i>Current read</i> {record.after?.conflictResolution ?? record.after?.read ?? record.statusReason ?? '—'}</p>
      <p class="awv2-specialist-reconcile-status">
        <i>Status</i>{' '}
        <span class={`awv2-reconcile-chip s-${tone}`} data-testid="reconcile-status">{RECONCILE_STATUS_LABEL[status] ?? status}</span>
        {' '}{record.statusReason}
      </p>
      {record.recommendedNextAction && <p><i>Next</i> {record.recommendedNextAction}</p>}
    </div>
  );
}

const ACREAGE_STATUS_LABEL: Record<string, string> = {
  resolved_current_canonical: 'Resolved — current canonical acreage',
  resolved_current_vs_historical_extent: 'Resolved — current parcel vs historical extent',
  partially_resolved: 'Partially resolved',
  unresolved: 'Unresolved',
};

const VALUE_TYPE_LABEL: Record<string, string> = {
  official_reported: 'official reported',
  gis_reported: 'GIS attribute',
  gis_calculated: 'GIS calculated',
  historical_project: 'historical project',
  provider_reported: 'provider reported',
  provider_calculated: 'provider calculated',
};

/** CURRENT PARCEL / OTHER RETAINED ACREAGE / RECONCILIATION — the persisted
 *  official acreage + parcel-extent reconciliation. Rendering runs nothing. */
function AcreageExtentPanel({ acreage }: { acreage: AcreageExtentControls }) {
  const record = acreage.record;
  const decision = record?.decision ?? null;
  const status = decision?.status ?? null;
  const resolved = status === 'resolved_current_canonical' || status === 'resolved_current_vs_historical_extent';
  const tone = resolved ? 'strong' : status === 'partially_resolved' ? 'moderate' : 'weak';
  const retained = (decision?.retained ?? []).filter((item) => item.valueAcres != null);
  const others = retained.filter((item) => !(resolved && item.valueType === 'official_reported'));
  const staleProducts = decision?.staleProducts ?? [];
  return (
    <div class="awv2-specialist-reconcile" data-testid="specialist-acreage-extent">
      <b>Acreage & parcel extent</b>
      {!record ? (
        <p>The conflicting acreage figures on this deal have not been reconciled against the current official parcel record yet.</p>
      ) : (
        <>
          <p>
            <i>Current parcel</i>{' '}
            {resolved && decision?.canonicalAcres != null
              ? <span data-testid="acreage-canonical"><b>{decision.canonicalAcres} AC</b> — {decision.canonicalSource}{decision.confidence ? ` (${decision.confidence.replace(/_/g, ' ')})` : ''}</span>
              : 'Not established by the evidence in hand.'}
          </p>
          {others.length > 0 && (
            <p data-testid="acreage-retained">
              <i>Other retained acreage</i>{' '}
              {others.map((item) => `${item.valueAcres} AC — ${item.source}${item.valueType ? ` (${VALUE_TYPE_LABEL[item.valueType] ?? item.valueType}${item.vintage === 'stale' ? ', stale vintage' : ''})` : ''}`).join(' · ')}
            </p>
          )}
          <p data-testid="acreage-reconciliation-explanation">
            <i>Reconciliation</i>{' '}
            {decision?.extentExplanation
              ?? decision?.parcelExtent
              ?? (decision?.unresolvedQuestions?.length ? decision.unresolvedQuestions.join(' ') : '—')}
          </p>
          {record.adoption?.adopted && (
            <p><i>Adopted</i> {record.adoption.note}</p>
          )}
          {staleProducts.length > 0 && (
            <p class="awv2-specialist-error" data-testid="acreage-stale-products">
              Marked STALE pending recompute on the reconciled acreage (not rerun automatically):{' '}
              {staleProducts.map((item) => item.replace(/_/g, ' ')).join(', ')}
              {record.staleSince ? ` — since ${new Date(record.staleSince).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.
            </p>
          )}
          {(record.dependentRefresh?.outcomes?.length ?? 0) > 0 && (
            <div data-testid="acreage-dependent-resolution">
              <p>
                <i>Dependent products</i>{' '}
                {staleProducts.length === 0
                  ? <span data-testid="acreage-dependents-resolved">All reconciled against the canonical {record.dependentRefresh?.canonicalAcres} AC.</span>
                  : `${(record.dependentRefresh?.outcomes ?? []).length - staleProducts.length} of ${(record.dependentRefresh?.outcomes ?? []).length} reconciled against the canonical ${record.dependentRefresh?.canonicalAcres} AC.`}
              </p>
              <details class="awv2-specialist-details">
                <summary>Resolution record ({(record.dependentRefresh?.outcomes ?? []).length})</summary>
                {(record.dependentRefresh?.outcomes ?? []).map((outcome) => (
                  <p data-testid={`acreage-dependent-${outcome.product}`}>
                    <i>{(outcome.product ?? '').replace(/_/g, ' ')}</i>{' '}
                    <b>{(outcome.status ?? '').replace(/_/g, ' ')}</b> — {outcome.basis}
                  </p>
                ))}
              </details>
            </div>
          )}
          <p class="awv2-specialist-reconcile-status">
            <i>Status</i>{' '}
            <span class={`awv2-reconcile-chip s-${tone}`} data-testid="acreage-status">{status ? ACREAGE_STATUS_LABEL[status] ?? status : '—'}</span>
          </p>
          {(decision?.reasoning ?? []).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Evidence reasoning ({(decision?.reasoning ?? []).length})</summary>
              {(decision?.reasoning ?? []).map((line) => (
                <p><i>{line.classification}</i> {line.statement}</p>
              ))}
            </details>
          )}
        </>
      )}
      {acreage.error && <p class="awv2-specialist-error" data-testid="acreage-error">{acreage.error}</p>}
      {(!record || !resolved) && (
        // Explicit action only: this click starts the ONE bounded run (reuse
        // the retained assessor record, one county-GIS query, one family
        // search). Page loads and refreshes never trigger it.
        <button
          type="button"
          class="awv2-reconcile-btn"
          data-testid="acreage-reconcile-run"
          disabled={acreage.running}
          onClick={() => acreage.onReconcile()}
          title="Reconciles the conflicting acreage figures against the current official county parcel record and GIS depiction"
        >
          {acreage.running ? 'Reconciling official acreage…' : 'Reconcile official acreage & extent'}
        </button>
      )}
      {record && staleProducts.length > 0 && acreage.onResolveDependents && (
        // Explicit action only: one bounded DETERMINISTIC pass that classifies
        // each stale product against the canonical acreage and records the
        // classification. No providers, no model calls, no rescaling.
        <button
          type="button"
          class="awv2-reconcile-btn"
          data-testid="acreage-resolve-dependents"
          disabled={acreage.resolvingDependents}
          onClick={() => acreage.onResolveDependents?.()}
          title="Classifies each stale acreage-dependent product against the canonical acreage and records the resolution — nothing is rerun or rescaled"
        >
          {acreage.resolvingDependents ? 'Resolving dependent products…' : 'Resolve acreage-dependent products'}
        </button>
      )}
    </div>
  );
}

/** The Overview face of a specialist product: the persisted CURRENT EXPERT
 *  READ, rendered verbatim — never generated, excerpted, or truncated at
 *  render time. A pre-upgrade snapshot without one falls back to the existing
 *  concise structured read and says when the real read will exist. */
function CurrentExpertRead({ current, fallback, testid, pending }: {
  current?: string | null;
  fallback?: string | null;
  testid: string;
  pending: string;
}) {
  if (current) {
    return (
      <div class="awv2-specialist-currentread" data-testid={testid}>
        {current.split(/\n{2,}/).map((paragraph) => <p class="awv2-specialist-read">{paragraph}</p>)}
      </div>
    );
  }
  return (
    <>
      {fallback && <p class="awv2-specialist-read">{fallback}</p>}
      <p class="awv2-specialist-line" data-testid={`${testid}-pending`}><i>{pending}</i></p>
    </>
  );
}

export function PropertyReadCard({ product, stale, reconcile, acreage, full = false, onOpenFull }: {
  /** true only on the Property page — the owner of the full expert review. */
  full?: boolean;
  onOpenFull?: () => void;
  product: PropertyIntelligenceReadView | null;
  stale?: boolean;
  reconcile?: PropertyReconcileControls | null;
  acreage?: AcreageExtentControls | null;
}) {
  return (
    <article class="awv2-panel awv2-specialist" data-domain="property" data-testid="specialist-read-property" data-outlook={outlookIsUpdated(product?.outlook) && !full ? 'UPDATED' : undefined}>
      <header class="awv2-specialist-head">
        <div class="awv2-dom-eyebrow" data-dom="property"><Landmark size={13} /> Property Intelligence</div>
        {product && <ScoreChip score={product.score} quality={product.quality} />}
      </header>
      {!product ? (
        <p class="awv2-specialist-empty">No Property Intelligence read has been produced yet. Run the intelligence read from the Deal Read card.</p>
      ) : (
        <>
          {!full
            ? (
              <>
              <UpdatedOutlookBadge outlook={product.outlook} testid="specialist-property-outlook" />
              <CurrentExpertRead
                current={product.currentExpertRead}
                fallback={product.read}
                testid="specialist-property-current-read"
                pending="The Current Expert Read is produced with the next Property Intelligence refresh — nothing is generated by viewing this page."
              />
              </>
            )
            : product.read && <p class="awv2-specialist-read">{product.read}</p>}
          {full && lines(product.strengths, 3).length > 0 && (
            <div class="awv2-specialist-list good"><b>Materially good</b>{lines(product.strengths, 3).map((item) => <span>+ {item}</span>)}</div>
          )}
          {full && (product.constraints ?? []).slice(0, 3).filter((item) => item.title).length > 0 && (
            <div class="awv2-specialist-list bad"><b>Constraints & risks</b>
              {(product.constraints ?? []).slice(0, 3).filter((item) => item.title).map((item) => (
                <span>− {item.title}{item.severity === 'high' ? ' (high)' : ''}</span>
              ))}
            </div>
          )}
          {(() => {
            // Grounded visual/record conflicts lead: a record claim the retained
            // imagery disputes is the finding the operator must not scroll past.
            const conflicts = (product.conflicts ?? []).filter((item) => item.subject || item.statement);
            const grounded = conflicts.filter((item) => /grounded visual/i.test(item.statement ?? ''));
            const rest = conflicts.filter((item) => !grounded.includes(item));
            const lead = [...grounded, ...rest].slice(0, 3);
            const remaining = [...grounded, ...rest].slice(3);
            if (!conflicts.length) return null;
            return (
              <div class="awv2-specialist-conflicts" data-testid="specialist-property-conflicts">
                <b>Conflicting evidence</b>
                {lead.map((item) => (
                  <p><i>{item.subject}</i> {item.statement}{item.resolution ? ` — ${item.resolution}` : ''}</p>
                ))}
                {remaining.length > 0 && (
                  <details class="awv2-specialist-details">
                    <summary>More conflicts ({remaining.length})</summary>
                    {remaining.map((item) => (
                      <p><i>{item.subject}</i> {item.statement}{item.resolution ? ` — ${item.resolution}` : ''}</p>
                    ))}
                  </details>
                )}
                {reconcile && reconcile.eligible.length > 0 && (
                  // The explicit action. Rendering runs nothing; only this
                  // click starts the bounded capability → re-read loop, at
                  // most one capability execution and one targeted re-read.
                  <button
                    type="button"
                    class="awv2-reconcile-btn"
                    data-testid="reconcile-run"
                    disabled={reconcile.running}
                    onClick={() => reconcile.onReconcile(reconcile.eligible[0]?.conflictSubject ?? null)}
                    title={`Requests the ${reconcile.eligible[0]?.requestedCapability ?? 'official record'} capability for the "${reconcile.eligible[0]?.conflictSubject ?? ''}" conflict, then re-reads Property Intelligence once`}
                  >
                    {reconcile.running
                      ? 'Verifying against the official record…'
                      : `Verify "${reconcile.eligible[0]?.conflictSubject ?? 'conflict'}" against the official record`}
                  </button>
                )}
              </div>
            );
          })()}
          {reconcile?.error && <p class="awv2-specialist-error" data-testid="reconcile-error">{reconcile.error}</p>}
          {reconcile?.record && <ReconciliationPanel record={reconcile.record} />}
          {full && (product.visualObservations ?? []).filter((item) => item.observation).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Grounded visual observations ({(product.visualObservations ?? []).filter((item) => item.observation).length})</summary>
              {(product.visualObservations ?? []).filter((item) => item.observation).slice(0, 6).map((item) => (
                <p>[{item.visual}] {item.observation}{item.basis ? <small> — {item.basis}</small> : null}</p>
              ))}
            </details>
          )}
          {full && product.developmentPotential && <p class="awv2-specialist-line"><b>Development / subdivision potential</b> {product.developmentPotential}</p>}
          {full && (product.configurations ?? []).filter((item) => item.label).length > 0 && (
            <div class="awv2-specialist-list" data-testid="specialist-property-configurations">
              <b>Plausible configurations</b>
              {(product.configurations ?? []).filter((item) => item.label).slice(0, 6).map((item) => (
                <span>
                  • {item.label}
                  {item.status ? ` — ${item.status.replace(/_/g, ' ')}` : ''}
                  {(item.prerequisites ?? []).length > 0 ? ` (needs: ${(item.prerequisites ?? []).slice(0, 3).join('; ')})` : ''}
                </span>
              ))}
            </div>
          )}
          {full && product.expertReview && (
            <details class="awv2-specialist-details" data-testid="specialist-property-expert-review">
              <summary>Full expert review ({Math.round(product.expertReview.length / 1000)}k chars)</summary>
              {product.expertReview.split(/\n{2,}/).map((paragraph) => <p style="white-space:pre-wrap">{paragraph}</p>)}
            </details>
          )}
          {!full && product.expertReview && (
            <p class="awv2-specialist-line" data-testid="specialist-property-expert-review-pointer">
              <b>Full expert review</b> {Math.round(product.expertReview.length / 1000)}k chars —{' '}
              {onOpenFull
                ? <button type="button" class="awv2-specialist-openfull" onClick={onOpenFull}>read it on the Property page →</button>
                : 'on the Property page.'}
            </p>
          )}
          {full && lines(product.unusual, 3).length > 0 && (
            <div class="awv2-specialist-list"><b>Unusual</b>{lines(product.unusual, 3).map((item) => <span>• {item}</span>)}</div>
          )}
          {full && lines(product.externalities, 3).length > 0 && (
            <div class="awv2-specialist-list"><b>Important externalities</b>{lines(product.externalities, 3).map((item) => <span>• {item}</span>)}</div>
          )}
          {full && (product.unknowns ?? []).filter((item) => item.question).length > 0 && (
            <div class="awv2-specialist-list"><b>Material unknowns</b>
              {(product.unknowns ?? []).filter((item) => item.question).slice(0, 3).map((item) => <span>? {item.question}</span>)}
            </div>
          )}
          {full && (product.nextActions ?? []).filter((item) => item.action).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Recommended verification</summary>
              {(product.nextActions ?? []).filter((item) => item.action).slice(0, 4).map((item) => (
                <p>{item.action}{item.why ? <small> — {item.why}</small> : null}</p>
              ))}
            </details>
          )}
        </>
      )}
      {acreage && <AcreageExtentPanel acreage={acreage} />}
      <ReadFooter generatedAt={product?.generatedAt} runtime={product?.runtime} stale={stale} />
    </article>
  );
}

// ── Market + Area Intelligence ─────────────────────────────────────────────

const perAcre = (value: number): string => `$${Math.round(value).toLocaleString('en-US')}/ac`;

export function MarketReadCard({ product, stale, full = false, onOpenFull }: {
  product: MarketIntelligenceReadView | null;
  stale?: boolean;
  /** true only on the Market page — the owner of the full expert review. */
  full?: boolean;
  onOpenFull?: () => void;
}) {
  const band = product?.subjectBand;
  return (
    <article class="awv2-panel awv2-specialist" data-domain="market" data-testid="specialist-read-market" data-outlook={outlookIsUpdated(product?.outlook) && !full ? 'UPDATED' : undefined}>
      <header class="awv2-specialist-head">
        <div class="awv2-dom-eyebrow" data-dom="market"><TrendingUp size={13} /> Market + Area Intelligence</div>
        {product && <ScoreChip score={product.score} quality={product.quality} />}
      </header>
      {!product ? (
        <p class="awv2-specialist-empty">No Market Intelligence read has been produced yet. Run the intelligence read from the Deal Read card.</p>
      ) : (
        <>
          {!full
            ? (
              <>
              <UpdatedOutlookBadge outlook={product.outlook} testid="specialist-market-outlook" />
              <CurrentExpertRead
                current={product.currentExpertRead}
                fallback={product.read}
                testid="specialist-market-current-read"
                pending="The Current Expert Read is produced with the next Market Intelligence refresh — nothing is generated by viewing this page."
              />
              </>
            )
            : product.read && <p class="awv2-specialist-read">{product.read}</p>}
          {full && product.overallMarketQuality?.read && (
            <p class="awv2-specialist-line"><b>Overall market quality{product.overallMarketQuality.grade ? ` · ${product.overallMarketQuality.grade}` : ''}</b> {product.overallMarketQuality.read}</p>
          )}
          {full && product.liquidityRead && <p class="awv2-specialist-line"><b>Liquidity</b> {product.liquidityRead}</p>}
          {band && (band.band || band.medianDaysOnMarket != null || band.medianPricePerAcre != null) && (
            <p class="awv2-specialist-line"><b>Subject band</b> {[
              band.band,
              band.medianDaysOnMarket != null ? `~${Math.round(band.medianDaysOnMarket)}d on market` : null,
              band.medianPricePerAcre != null ? perAcre(band.medianPricePerAcre) : null,
              band.monthsOfSupply != null ? `${band.monthsOfSupply} mo supply` : null,
            ].filter(Boolean).join(' · ')}{product.fastestBand ? ` · fastest band ${product.fastestBand}` : ''}</p>
          )}
          {full && product.buyerPool && <p class="awv2-specialist-line"><b>Buyer pool</b> {product.buyerPool}</p>}
          {full && !!product.exitProductFits?.length && (
            <details class="awv2-specialist-details" open>
              <summary>Exit / product market fit</summary>
              {product.exitProductFits.slice(0, 6).map((item) => (
                <p><b>{item.product}</b>{item.grade ? ` · Grade ${item.grade}` : ''}{item.expectedDays != null ? ` · ~${Math.round(item.expectedDays)} days` : ''}{item.read ? ` — ${item.read}` : ''}</p>
              ))}
            </details>
          )}
          {full && product.areaStory && (
            <details class="awv2-specialist-details"><summary>Area story</summary><p>{product.areaStory}</p></details>
          )}
          {full && lines(product.bestSignals, 3).length > 0 && (
            <div class="awv2-specialist-list good"><b>Best signals</b>{lines(product.bestSignals, 3).map((item) => <span>+ {item}</span>)}</div>
          )}
          {full && lines(product.risks, 3).length > 0 && (
            <div class="awv2-specialist-list bad"><b>Risks & caveats</b>{lines(product.risks, 3).map((item) => <span>− {item}</span>)}</div>
          )}
          {full && lines(product.exitImplications, 3).length > 0 && (
            <details class="awv2-specialist-details">
              <summary>Exit implications</summary>
              {lines(product.exitImplications, 3).map((item) => <p>{item}</p>)}
            </details>
          )}
          {full && (product.unknowns ?? []).filter((item) => item.question).length > 0 && (
            <div class="awv2-specialist-list"><b>Unknowns</b>
              {(product.unknowns ?? []).filter((item) => item.question).slice(0, 3).map((item) => <span>? {item.question}</span>)}
            </div>
          )}
          {full && product.expertReview && (
            <details class="awv2-specialist-details" data-testid="specialist-market-expert-review">
              <summary>Full expert review ({Math.round(product.expertReview.length / 1000)}k chars)</summary>
              {product.expertReview.split(/\n{2,}/).map((paragraph) => <p style="white-space:pre-wrap">{paragraph}</p>)}
            </details>
          )}
          {!full && product.expertReview && (
            <p class="awv2-specialist-line" data-testid="specialist-market-expert-review-pointer">
              <b>Full expert review</b> {Math.round(product.expertReview.length / 1000)}k chars —{' '}
              {onOpenFull
                ? <button type="button" class="awv2-specialist-openfull" onClick={onOpenFull}>read it on the Market page →</button>
                : 'on the Market page.'}
            </p>
          )}
        </>
      )}
      <ReadFooter generatedAt={product?.generatedAt} runtime={product?.runtime} stale={stale} />
    </article>
  );
}

// ── Seller Intelligence ────────────────────────────────────────────────────

function SellerReadCard({ product, stale }: { product: SellerIntelligenceReadView | null; stale?: boolean }) {
  const established = product?.state === 'established';
  return (
    <article class="awv2-panel awv2-specialist" data-domain="action" data-testid="specialist-read-seller" data-outlook={outlookIsUpdated(product?.outlook) ? 'UPDATED' : undefined}>
      <header class="awv2-specialist-head">
        <div class="awv2-dom-eyebrow" data-dom="action"><UserRound size={13} /> Seller Intelligence</div>
        {established && product?.version != null && <span class="awv2-specialist-version">Read v{product.version}</span>}
      </header>
      {!established ? (
        <p class="awv2-specialist-empty" data-testid="specialist-seller-precontact">
          Pending · pre-contact. No meaningful seller communication has been recorded for this
          deal yet. Seller Intelligence reasons only over the real communication record — nothing
          is inferred from ownership records.
        </p>
      ) : (
        <>
          <UpdatedOutlookBadge outlook={product?.outlook} testid="specialist-seller-outlook" />
          {product?.read && <p class="awv2-specialist-read" data-testid="seller-current-read"><b>Current seller read</b> {product.read}</p>}
          {product?.sellerTrajectory && <p class="awv2-specialist-line" data-testid="seller-trajectory"><b>What changed</b> {product.sellerTrajectory}</p>}
          {product?.whatMattersMostNow && <p class="awv2-specialist-line"><b>What matters most now</b> {product.whatMattersMostNow}</p>}
          {product?.nextConversationObjective && <p class="awv2-specialist-line"><b>Next conversation</b> {product.nextConversationObjective}</p>}
          {product?.motivation && <p class="awv2-specialist-line"><b>Motivation</b> {product.motivation}</p>}
          {product?.priceExpectation && <p class="awv2-specialist-line"><b>Price</b> {product.priceExpectation}</p>}
          {product?.timeline && <p class="awv2-specialist-line"><b>Timing</b> {product.timeline}</p>}
          {product?.decisionMakers && <p class="awv2-specialist-line"><b>Decision authority</b> {product.decisionMakers}</p>}
          {product?.negotiationPosture && <p class="awv2-specialist-line"><b>Posture</b> {product.negotiationPosture}</p>}
          {(product?.sellerReportedFacts ?? []).filter((item) => item.statement).length > 0 && (
            <div class="awv2-specialist-reported" data-testid="specialist-seller-reported">
              <b>Seller-reported <em>(attributed to the seller — not verified property facts)</em></b>
              {(product?.sellerReportedFacts ?? []).filter((item) => item.statement).slice(0, 4).map((item) => (
                <p><span class="tag">SELLER-REPORTED</span> “{item.statement}”{item.attribution ? <small> — {item.attribution}</small> : null}</p>
              ))}
            </div>
          )}
          {(product?.contradictions ?? []).filter((item) => item.subject).length > 0 && (
            <div class="awv2-specialist-conflicts" data-testid="specialist-seller-contradictions">
              <b>Contradictions over time</b>
              {(product?.contradictions ?? []).filter((item) => item.subject).slice(0, 3).map((item) => (
                <p><i>{item.subject}</i> {[item.earlier ? `Earlier: ${item.earlier}` : null, item.later ? `Later: ${item.later}` : null].filter(Boolean).join(' — ')}{item.interpretation ? ` (${item.interpretation})` : ''}</p>
              ))}
            </div>
          )}
          {(product?.unknowns ?? []).filter((item) => item.question).length > 0 && (
            <div class="awv2-specialist-list"><b>Still unknown</b>
              {(product?.unknowns ?? []).filter((item) => item.question).slice(0, 3).map((item) => <span>? {item.question}</span>)}
            </div>
          )}
          {product?.nextQuestion && <p class="awv2-specialist-next"><b>Ask next</b> {product.nextQuestion}</p>}
          {!!product?.followUps?.length && (
            <details class="awv2-specialist-details"><summary>Follow-ups</summary>{product.followUps.slice(0, 5).map((item) => <p>{item}</p>)}</details>
          )}
        </>
      )}
      <ReadFooter generatedAt={product?.generatedAt} runtime={product?.runtime} stale={stale} />
    </article>
  );
}

// ── The strip ──────────────────────────────────────────────────────────────

export function SpecialistReadsPanel({ property, market: marketProduct, seller, stale, reconcile, acreage, onOpenPropertyPage, onOpenMarketPage }: {
  property: PropertyIntelligenceReadView | null;
  market: MarketIntelligenceReadView | null;
  seller: SellerIntelligenceReadView | null;
  stale: SpecialistStaleView | null;
  reconcile?: PropertyReconcileControls | null;
  acreage?: AcreageExtentControls | null;
  onOpenPropertyPage?: () => void;
  onOpenMarketPage?: () => void;
}) {
  // Overview strip: concise current reads only. The full Property and Market
  // expert reviews are owned by their deal pages (full={false} here).
  return (
    <section class="awv2-specialist-reads" aria-label="Specialist intelligence reads" data-testid="specialist-reads">
      <PropertyReadCard product={property} stale={stale?.property === true && !!property} reconcile={reconcile} acreage={acreage} full={false} onOpenFull={onOpenPropertyPage} />
      <MarketReadCard product={marketProduct} stale={stale?.market === true && !!marketProduct} full={false} onOpenFull={onOpenMarketPage} />
      <SellerReadCard product={seller} stale={stale?.seller === true && !!seller} />
    </section>
  );
}
