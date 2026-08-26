// Research Readiness — the compact strip near the top of the Deal Card.
//
// One glance answers "what research does this property actually have?" without
// printing a checklist. The strip shows the ready count, the tallies that
// matter (needs research / unresolved / stale / expected unknown) and one chip
// per item in its status color. Everything else is one control away.
//
// RENDERING NEVER RUNS RESEARCH. The manifest is reconciled from retained state
// on the server; opening or refreshing this card invokes no capability. The
// backfill control and the per-item run controls are the ONLY things here that
// cause research to happen, and they say so.
//
// The four states an operator has to tell apart, in the order they matter:
//   red    something is missing that LandOS can still go and get
//   yellow a proper attempt already ran and settled nothing — do not loop
//   blue   there is an answer, but it has aged
//   gray   nobody expected a machine to answer this
//   green  ready

import { useState } from 'preact/hooks';
import { ClipboardCheck, RefreshCw, Play, ChevronDown, ChevronRight } from 'lucide-preact';

import '../styles/workspace-v2-research-readiness.css';

export type ResearchReadinessStatus = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

export interface ResearchReadinessItemView {
  id: string;
  label: string;
  group: 'property' | 'market' | 'seller';
  question: string;
  status: ResearchReadinessStatus;
  statusLabel: string;
  owner: { kind: string; capabilityId: string | null; label: string };
  machineBackfillAllowed: boolean;
  lastSuccessAt: string | null;
  reason: string;
  nextAction: string | null;
  blocksIntelligence: boolean;
}

export interface ResearchReadinessGroupView {
  group: string;
  label: string;
  ready: boolean;
  readyCount: number;
  total: number;
  blockingMachineGaps: string[];
  knownUnresolvedInputs: string[];
  expectedUnknowns: string[];
  staleInputs: string[];
}

export interface ResearchReadinessManifestView {
  dealCardId: number;
  generatedAt: string;
  items: ResearchReadinessItemView[];
  counts: {
    total: number; ready: number; needsMachineAttention: number;
    unresolved: number; stale: number; expectedUnknown: number;
  };
  headline: string;
  groups: {
    property: ResearchReadinessGroupView;
    market: ResearchReadinessGroupView;
    seller: ResearchReadinessGroupView;
    deal: ResearchReadinessGroupView;
  };
  backfillCandidates: string[];
  operatorCompleteness?: {
    returned: number; denominator: number; partial: number; unresolved: number;
    blocked: number; notRequired: number; headline: string;
    items: Array<{ id: string; label: string; outcome: 'returned' | 'partial' | 'unresolved' | 'blocked' | 'not_required'; reason: string }>;
  };
}

interface Props {
  manifest: ResearchReadinessManifestView | null;
  loading: boolean;
  error: string | null;
  /** Running backfill: null when idle, otherwise the item ids being worked. */
  running: string[] | null;
  /** Runs the bounded backfill. No ids = every red machine-resolvable item. */
  onBackfill: (itemIds?: string[]) => void;
}

const GROUP_ORDER: Array<keyof ResearchReadinessManifestView['groups']> = ['property', 'market', 'seller'];

const shortDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export function ResearchReadinessStrip({ manifest, loading, error, running, onBackfill }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (loading && !manifest) {
    return (
      <section class="awv2-panel awv2-rr" data-domain="property" aria-label="Research readiness">
        <div class="awv2-rr-empty">Reading the research record…</div>
      </section>
    );
  }
  if (!manifest) {
    return (
      <section class="awv2-panel awv2-rr" data-domain="property" aria-label="Research readiness">
        <div class="awv2-rr-empty">
          {error ?? 'No research readiness manifest is available for this Deal Card yet.'}
        </div>
      </section>
    );
  }

  const { counts, groups } = manifest;
  const operator = manifest.operatorCompleteness ?? {
    returned: counts.ready,
    denominator: counts.total - counts.expectedUnknown,
    partial: counts.stale,
    unresolved: counts.unresolved,
    blocked: counts.needsMachineAttention,
    notRequired: counts.expectedUnknown,
    headline: `${counts.ready} / ${counts.total - counts.expectedUnknown} Returned`,
    items: [],
  };
  const candidates = manifest.backfillCandidates;
  const busy = !!running;
  const tallies = [
    { key: 'green', label: `${operator.returned} returned` },
    { key: 'blue', label: `${operator.partial} partial` },
    { key: 'yellow', label: `${operator.unresolved} unresolved` },
    { key: 'red', label: `${operator.blocked} blocked` },
    { key: 'gray', label: `${operator.notRequired} not required` },
  ].filter((tally): tally is { key: string; label: string } => tally != null);

  return (
    <section class="awv2-panel awv2-rr" data-domain="property" aria-label="Research readiness" id="research-readiness">
      <header class="awv2-rr-head">
        <div class="awv2-rr-title">
          <div class="awv2-dom-eyebrow" data-dom="property"><ClipboardCheck size={13} /> Research readiness</div>
          {/*
            Name the unit. This strip counts the 19 diligence INPUTS a deal
            needs; the run panel counts the 12 research LANES a run dispatched.
            Rendered as a bare "10 / 19" beside "7 of 12 required lanes
            returned", the two read as contradictory completion claims of the
            same thing — which they are not, and never were.
          */}
          <h2>{operator.headline}</h2>
        </div>
        <div class="awv2-rr-tallies">
          {tallies.map((tally) => (
            <span key={tally.key} class={`awv2-rr-tally t-${tally.key}`}>{tally.label}</span>
          ))}
        </div>
      </header>

      {/* The strip itself: one chip per checklist item, color-coded. */}
      <ul class="awv2-rr-strip">
        {manifest.items.map((item) => (
          <li
            key={item.id}
            class={`awv2-rr-chip s-${item.status}${item.blocksIntelligence ? ' blocking' : ''}`}
            title={`${item.statusLabel} — ${item.reason}`}
          >
            <i class="dot" aria-hidden="true" />
            <span class="lbl">{item.label}</span>
          </li>
        ))}
      </ul>

      <div class="awv2-rr-actions">
        <button
          type="button"
          class="awv2-rr-backfill"
          disabled={busy || candidates.length === 0}
          onClick={() => onBackfill()}
        >
          <RefreshCw size={13} class={busy ? 'spin' : undefined} />
          {busy
            ? 'Backfilling…'
            : candidates.length
              ? `Backfill missing research (${candidates.length})`
              : 'Nothing needs machine backfill'}
        </button>
        <button type="button" class="awv2-rr-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          View research readiness
        </button>
        <span class="awv2-rr-note">
          One operator projection over all required property research. Not Required is excluded from the denominator.
          Reading this card runs no research. Backfill runs only blocked items a registered capability owns.
        </span>
      </div>
      {error && <p class="awv2-rr-error">{error}</p>}

      {expanded && (
        <div class="awv2-rr-detail">
          {GROUP_ORDER.map((key) => {
            const group = groups[key];
            const items = manifest.items.filter((item) => item.group === key);
            return (
              <div class="awv2-rr-group" key={key}>
                <div class="awv2-rr-group-head">
                  <b>{group.label}</b>
                  <span class={`awv2-rr-groupstate ${group.ready ? 'ok' : 'blocked'}`}>
                    {group.ready
                      ? `Ready to reason on — ${group.readyCount}/${group.total} resolved`
                      : `Blocked by ${group.blockingMachineGaps.join(', ')}`}
                  </span>
                </div>
                <ul class="awv2-rr-rows">
                  {items.map((item) => {
                    const runnable = item.machineBackfillAllowed;
                    const itemBusy = !!running?.includes(item.id);
                    return (
                      <li key={item.id} class={`awv2-rr-row s-${item.status}`}>
                        <span class="st"><i class="dot" aria-hidden="true" />{item.statusLabel}</span>
                        <div class="body">
                          <div class="lbl">
                            {item.label}
                            <small>{item.question}</small>
                          </div>
                          <p class="why">{item.reason}</p>
                          {item.nextAction && <p class="next">→ {item.nextAction}</p>}
                          <p class="meta">
                            {item.owner.capabilityId
                              ? `Owned by the ${item.owner.label} capability`
                              : `Owned by ${item.owner.label}`}
                            {shortDate(item.lastSuccessAt) ? ` · last usable result ${shortDate(item.lastSuccessAt)}` : ''}
                          </p>
                        </div>
                        {runnable && (
                          <button
                            type="button"
                            class="awv2-rr-run"
                            disabled={!!running}
                            onClick={() => onBackfill([item.id])}
                          >
                            {itemBusy ? <RefreshCw size={12} class="spin" /> : <Play size={12} />}
                            {item.status === 'blue' ? 'Refresh' : 'Run'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
