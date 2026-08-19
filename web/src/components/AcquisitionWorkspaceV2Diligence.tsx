// Property & Market presentation primitives — the diligence workspace.
//
// Property & Market holds the evidence, and evidence is why the page had
// become a research dump: every retained rule, source excerpt, diagnostic and
// failed attempt printed at the same weight as the conclusion it supports.
//
// These primitives impose ONE reading order on every section:
//
//     CONCLUSION FIRST → IMPORTANT FACTS → WHAT IT MEANS HERE
//     → WHAT IS STILL UNKNOWN / NEXT ACTION → [evidence ▾]
//
// Nothing is deleted to achieve it. `Disclosure` is the single control every
// section uses to keep rules, sources, provenance and diagnostics reachable
// but out of the default scan, and `WhatItMeans` carries the persisted
// Acquisition Intelligence interpretation to the section it is ABOUT instead
// of reprinting the whole analyst read a second time.

import type { ComponentChildren } from 'preact';
import { AlertTriangle, ArrowUpRight, Brain, HelpCircle } from 'lucide-preact';

import {
  insightsForTopic, questionsForTopic, nextActionForTopic,
  type IntelligenceTopic,
} from '../lib/acquisition-intelligence-digest';
import type { AcquisitionIntelligenceView } from './AcquisitionWorkspaceV2AcquisitionIntelligence';
import '../styles/workspace-v2-diligence.css';

/** Collapsed evidence. The default state is closed; the content is intact. */
export function Disclosure({ label, children, count }: {
  label: string;
  children: ComponentChildren;
  /** How much is inside, so a closed control never hides an unknown volume. */
  count?: number | null;
}) {
  return (
    <details class="awv2-dx-disclosure">
      <summary>{label}{count != null ? <span class="n">{count}</span> : null}</summary>
      <div class="awv2-dx-disclosure-body">{children}</div>
    </details>
  );
}

/** The section's answer, before any of its evidence. */
export function Conclusion({ label, value, tone, note, testId }: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
  note?: string | null;
  testId?: string;
}) {
  return (
    <div class={`awv2-dx-conclusion tone-${tone ?? 'neutral'}`} data-testid={testId}>
      <small>{label}</small>
      <b>{value}</b>
      {note && <p>{note}</p>}
    </div>
  );
}

export interface DxMetric {
  label: string;
  value: string;
  sub?: string | null;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

/** The numbers a land investor scans, as figures rather than sentences. */
export function MetricRow({ metrics, label }: { metrics: DxMetric[]; label?: string }) {
  const shown = metrics.filter((metric) => !!metric.value);
  if (!shown.length) return null;
  return (
    <div class="awv2-dx-metrics" aria-label={label ?? 'Key figures'}>
      {shown.map((metric) => (
        <div class={`awv2-dx-metric tone-${metric.tone ?? 'neutral'}`}>
          <small>{metric.label}</small>
          <b>{metric.value}</b>
          {metric.sub && <i>{metric.sub}</i>}
        </div>
      ))}
    </div>
  );
}

/**
 * Two retained sources that disagree. Printing both numbers with no
 * explanation is the failure this replaces: it states the span, says plainly
 * that the sources conflict, and names what would settle it.
 */
export function ConflictBanner({ subject, span, resolution }: {
  subject: string;
  span: string;
  resolution: string;
}) {
  return (
    <div class="awv2-dx-conflict" data-testid="dx-conflict">
      <AlertTriangle size={15} aria-hidden="true" />
      <div>
        <small>{subject}</small>
        <b>{span}</b>
        <p>Retained sources conflict. {resolution}</p>
      </div>
    </div>
  );
}

/**
 * The analyst's interpretation of THIS section's evidence, drawn from the
 * persisted read. Renders nothing when the read said nothing about this
 * subject — an empty "what it means" block would be worse than no block.
 */
export function WhatItMeans({ read, topic, limit = 3, heading = 'What it means for this property' }: {
  read: AcquisitionIntelligenceView | null;
  topic: IntelligenceTopic;
  limit?: number;
  heading?: string;
}) {
  const insights = insightsForTopic(read, topic, limit);
  if (!insights.length) return null;
  return (
    <div class="awv2-dx-means" data-topic={topic}>
      <h4><Brain size={13} aria-hidden="true" /> {heading}</h4>
      <ul>
        {insights.map((insight) => (
          <li data-kind={insight.kind}><span class="tag">{insight.kind}</span>{insight.text}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the section still cannot answer, and the concrete move that would.
 * Separate from WhatItMeans because an unknown is a next step, not a finding.
 */
export function StillNeeded({ read, topic, extra = [], limit = 3 }: {
  read: AcquisitionIntelligenceView | null;
  topic: IntelligenceTopic;
  extra?: string[];
  limit?: number;
}) {
  const questions = [...questionsForTopic(read, topic, limit), ...extra.filter(Boolean)].slice(0, limit);
  const action = nextActionForTopic(read, topic);
  if (!questions.length && !action) return null;
  return (
    <div class="awv2-dx-needed">
      {questions.length > 0 && (
        <div class="awv2-dx-needed-list">
          <h4><HelpCircle size={13} aria-hidden="true" /> Still needed</h4>
          <ul>{questions.map((question) => <li>{question}</li>)}</ul>
        </div>
      )}
      {action && (
        <div class="awv2-dx-needed-action">
          <ArrowUpRight size={15} aria-hidden="true" />
          <div><small>Next action</small><b>{action}</b></div>
        </div>
      )}
    </div>
  );
}

/**
 * History is not entitlement. A prior approval, plan or lot count is real
 * intelligence and must be visible, but it never establishes what the parcel
 * may do today, so it carries that warning wherever it is shown.
 */
export function HistoryWarning() {
  return (
    <div class="awv2-dx-history-warn" data-testid="dx-history-warning">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>Historical development activity does <b>not</b> establish current zoning or entitlement.</span>
    </div>
  );
}
