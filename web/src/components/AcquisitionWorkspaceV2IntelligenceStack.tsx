// LandOS Intelligence Stack — the Overview's decision-area score strip and the
// Deal Brain conversation.
//
// Three canonical specialist scores (PROPERTY / MARKET / SELLER) with the current
// quick-flip economic status beside them. The explanation always outranks the
// number: each tile is shorthand for a full product that lives behind the Deal
// Read and Page 2, never a replacement for it. SELLER honestly shows "Pending"
// pre-contact.
//
// The Deal Brain input stores the operator's message as DEAL-SPECIFIC GUIDANCE
// — never a canonical property fact — and the reply is reasoned from the
// current deal file. Rendering never runs a model; only sending a message does.

import { useState } from 'preact/hooks';
import { Brain, Send } from 'lucide-preact';

import '../styles/workspace-v2-intelligence-stack.css';

// ── View types (fields this surface consumes) ──────────────────────────────

export interface QuickFlipScreenView {
  status?: 'viable' | 'pending' | 'not_economic' | string;
  statusLabel?: string;
  reason?: string;
  missing?: string[];
  economics?: {
    supportedFmv?: number | null;
    levels?: { pct40?: number; pct50?: number; pct60?: number };
    cashMao?: number | null;
    bindingConstraint?: string;
    projectedNetAtMao?: number | null;
    totalSellingCostsUsd?: number | null;
  } | null;
  resaleWindow?: { expectedDays?: number | null; targetDays?: number; maxDays?: number; read?: string } | null;
}

export interface IntelligenceScoresView {
  property?: { score?: number | null; quality?: string | null; source?: string };
  market?: { score?: number | null; quality?: string | null; source?: string };
  seller?: { score?: number | null; state?: string };
  deal?: { score?: number | null; label?: string | null };
}

export interface SellerIntelligenceView {
  state?: string;
  score?: number | null;
  read?: string;
  motivation?: string | null;
  priceExpectation?: string | null;
  timeline?: string | null;
  decisionMakers?: string | null;
  objections?: string[];
  negotiationPosture?: string | null;
  bestApproach?: string | null;
  sellerReportedFacts?: Array<{ statement?: string; attribution?: string }>;
  followUps?: string[];
}

export interface DealBrainThreadEntry {
  id?: number;
  role: 'operator' | 'deal_brain' | string;
  text: string;
  createdAt?: number;
}

const usdCompact = (value: number): string =>
  value >= 1_000 ? `$${Math.round(value / 1_000)}K` : `$${value.toLocaleString('en-US')}`;

const FLIP_TONE: Record<string, string> = { viable: 'green', pending: 'yellow', not_economic: 'red' };

const VERDICT_LINE: Record<string, string> = {
  cash_deal_pass: 'Cash deal pass',
  cash_deal_fails_at_seller_price: 'Cash does not work at seller price',
};

export function QuickFlipBadge({ flip, cashVerdict }: { flip: QuickFlipScreenView | null | undefined; cashVerdict?: string | null }) {
  const status = flip?.status ?? 'pending';
  const tone = FLIP_TONE[status] ?? 'yellow';
  const economics = flip?.economics ?? null;
  const window = flip?.resaleWindow;
  const verdictLine = cashVerdict ? VERDICT_LINE[cashVerdict] : undefined;
  return (
    <div class={`awv2-flip-badge f-${tone}`} data-testid="quick-flip-badge">
      <b>{verdictLine ?? flip?.statusLabel ?? 'Quick-flip pending'}</b>
      {economics?.supportedFmv != null && <span>FMV {usdCompact(economics.supportedFmv)}</span>}
      {economics?.cashMao != null && economics.cashMao > 0 && <span>Cash MAO {usdCompact(economics.cashMao)}</span>}
      {window?.expectedDays != null && <span>~{Math.round(window.expectedDays)}d resale</span>}
      {status === 'pending' && economics?.supportedFmv == null && <span>FMV not established</span>}
    </div>
  );
}

/** The one status of a retained Stage 3 artifact, as the server maps it. The
 *  same object the Deal Brain records as its input. */
export interface Stage3StatusView {
  product?: string;
  status?: 'current' | 'partial_current' | 'pending' | 'historical' | string;
  label?: string;
  snapshotId?: number | null;
  contractVersion?: string | null;
  retainedAt?: string | null;
  subjectVersion?: string | null;
  correlation?: string | null;
  coverage?: string | null;
  limitation?: string | null;
  consumedByDealBrain?: boolean;
  link?: string;
}

const STAGE3_TONE: Record<string, string> = { current: 'strong', partial_current: 'moderate', pending: 'pending', historical: 'weak' };

/** Short lineage line: contract, snapshot, read time, accepted subject. */
export function stage3Lineage(status: Stage3StatusView | null | undefined): string | null {
  if (!status || status.snapshotId == null) return null;
  return [
    status.contractVersion ? `v${status.contractVersion}` : null,
    `snapshot #${status.snapshotId}`,
    status.retainedAt ? `read ${new Date(status.retainedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null,
    status.subjectVersion ? `subject ${status.subjectVersion}` : null,
  ].filter(Boolean).join(' · ');
}

function ScoreTile({ label, score, sub, stage3 }: { label: string; score: number | null | undefined; sub: string | null | undefined; stage3?: Stage3StatusView | null }) {
  // A Stage 3 status outranks the score's own quality text: the card and the
  // Deal Brain read the same retained artifact, so they say the same thing.
  const tone = stage3?.status ? STAGE3_TONE[stage3.status] ?? 'pending' : score == null ? 'pending' : score >= 65 ? 'strong' : score >= 50 ? 'moderate' : 'weak';
  const lineage = stage3Lineage(stage3);
  return (
    <div class={`awv2-intel-tile s-${tone}`} data-testid={`intel-score-${label.toLowerCase()}`} data-stage3-status={stage3?.status ?? undefined} data-snapshot-id={stage3?.snapshotId ?? undefined}>
      <small>{label}</small>
      <b>{score ?? '—'}</b>
      <span data-testid={`intel-status-${label.toLowerCase()}`}>{stage3?.label ?? sub ?? (score == null ? 'Unknown' : '')}</span>
      {lineage && <span class="awv2-intel-tile-lineage">{lineage}</span>}
      {stage3?.coverage && <span class="awv2-intel-tile-lineage">{stage3.coverage}</span>}
      {stage3?.limitation && <span class="awv2-intel-tile-lineage">{stage3.limitation}</span>}
      {stage3?.link && <a class="awv2-intel-tile-link" href={stage3.link}>Open {label} output</a>}
    </div>
  );
}

export function IntelligenceScoreStrip({ scores, quickFlip, cashVerdict, phaseLabel, whatChanged, stage3, sellerStatusLabel }: {
  scores: IntelligenceScoresView | null;
  quickFlip: QuickFlipScreenView | null;
  cashVerdict?: string | null;
  phaseLabel?: string | null;
  whatChanged?: string[] | null;
  /** Stage 3 Property and Market status, from the same retained rows the Deal Brain consumes. */
  stage3?: { property?: Stage3StatusView | null; market?: Stage3StatusView | null } | null;
  /** The one seller read status label, so the Seller tile agrees with the Seller page. */
  sellerStatusLabel?: string | null;
}) {
  return (
    <section class="awv2-intel-strip" data-domain="action" aria-label="Intelligence scores" data-testid="intelligence-score-strip">
      <div class="awv2-intel-tiles">
        <ScoreTile label="Property" score={scores?.property?.score} sub={scores?.property?.quality} stage3={stage3?.property} />
        <ScoreTile label="Market" score={scores?.market?.score} sub={scores?.market?.quality} stage3={stage3?.market} />
        <ScoreTile
          label="Seller"
          score={scores?.seller?.score}
          sub={sellerStatusLabel ?? (scores?.seller?.state === 'established' ? 'Workability' : 'Pending · pre-contact')}
        />
      </div>
      <div class="awv2-intel-side">
        <QuickFlipBadge flip={quickFlip} cashVerdict={cashVerdict} />
        {phaseLabel && <span class="awv2-intel-phase">{phaseLabel}</span>}
      </div>
      {!!whatChanged?.length && (
        <p class="awv2-intel-changed" data-testid="intel-what-changed">
          <b>Since last read:</b> {whatChanged.slice(0, 3).join(' ')}
        </p>
      )}
    </section>
  );
}

// ── Deal Brain conversation ────────────────────────────────────────────────

export function DealBrainAsk({ thread, historyOnly = false, running, error, onAsk }: {
  thread: DealBrainThreadEntry[];
  historyOnly?: boolean;
  running: boolean;
  error: string | null;
  onAsk: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = (event: Event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || running) return;
    setDraft('');
    onAsk(message);
  };
  return (
    <section class="awv2-dealbrain" data-domain="action" aria-label="Deal Brain" data-testid="deal-brain">
      <div class="awv2-dom-eyebrow" data-dom="action"><Brain size={13} /> Deal Brain</div>
      {thread.length > 0 && !historyOnly && (
        <div class="awv2-dealbrain-thread">
          {thread.slice(-6).map((entry) => (
            <div class={`awv2-dealbrain-turn t-${entry.role === 'operator' ? 'operator' : 'brain'}`}>
              <small>{entry.role === 'operator' ? 'You (guidance)' : 'Deal Brain'}</small>
              <p>{entry.text}</p>
            </div>
          ))}
        </div>
      )}
      {thread.length > 0 && historyOnly && (
        <details class="awv2-overview-methodology">
          <summary>Historical / superseded Deal Brain guidance</summary>
          <div class="awv2-dealbrain-thread">
            {thread.slice(-6).map((entry) => (
              <div class={`awv2-dealbrain-turn t-${entry.role === 'operator' ? 'operator' : 'brain'}`}>
                <small>{entry.role === 'operator' ? 'You (guidance)' : 'Deal Brain'}</small>
                <p>{entry.text}</p>
              </div>
            ))}
          </div>
        </details>
      )}
      {running && <p class="awv2-dealbrain-note">The Deal Brain is reading the current deal file…</p>}
      {error && <p class="awv2-dealbrain-note bad">{error}</p>}
      <form class="awv2-dealbrain-input" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          placeholder="Ask LandOS about this deal…"
          onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
          disabled={running}
        />
        <button type="submit" disabled={running || !draft.trim()} aria-label="Send"><Send size={14} /></button>
      </form>
      <p class="awv2-dealbrain-caveat">Your input is deal-specific guidance for this read. It never becomes a canonical property fact.</p>
    </section>
  );
}
