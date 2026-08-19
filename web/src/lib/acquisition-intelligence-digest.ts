// Presentation digest for the persisted Acquisition Intelligence result.
//
// The analyst already produced one judgment across the whole property file.
// Nothing here reasons, scores, re-ranks by merit, or invents a fact: these are
// PURE functions over the persisted read that decide what belongs on the
// Overview at a glance and which section of Property & Market each retained
// insight explains. The full structured read stays available behind its own
// expansion; this module only chooses placement and depth.
//
// Two jobs, and they are deliberately separate:
//
//   digestDealRead()      — the compact Overview read: one headline, one
//                           judgment, a few reasons, a few questions, the
//                           strongest strategies, one next move.
//   insightsForTopic()    — routes the same retained insights to the Property &
//                           Market section that each one is ABOUT, so the
//                           analyst explains the evidence next to the evidence
//                           instead of being reprinted whole a second time.

import type { AcquisitionIntelligenceView } from '../components/AcquisitionWorkspaceV2AcquisitionIntelligence';

/** Section identities on Property & Market that can carry an analyst read. */
export type IntelligenceTopic =
  | 'access'
  | 'terrain'
  | 'zoning'
  | 'history'
  | 'utilities'
  | 'market'
  | 'valuation';

export interface TopicInsight {
  /** The retained sentence, verbatim. */
  text: string;
  /** Where in the read it came from, so the surface can label it honestly. */
  kind: 'observation' | 'opportunity' | 'constraint' | 'conflict';
  /** Present on constraints only. */
  severity?: string;
}

export interface DealReadStrategy {
  strategy: string;
  fit: string;
  fitLabel: string;
  whyItFits: string | null;
  blocker: string | null;
  confirm: string | null;
}

export interface DealReadDigest {
  headline: string;
  judgment: string | null;
  confidence: string | null;
  /** Why this is worth an operator's attention. */
  interesting: Array<{ title: string; why: string | null }>;
  /** The questions that would most change the decision. */
  questions: Array<{ title: string; why: string | null }>;
  /** The strongest few exits, ranked as the analyst rated them. */
  strategies: DealReadStrategy[];
  /** One next move, and why it is the one. */
  nextMove: { action: string; why: string | null } | null;
  /** How much more the full read holds, so the link can say so. */
  depth: { insights: number; strategies: number; questions: number };
}

export const FIT_ORDER: Record<string, number> = {
  strong: 0,
  possible: 1,
  weak: 2,
  rejected: 3,
};

export const FIT_LABEL: Record<string, string> = {
  strong: 'Strong fit',
  possible: 'Possible',
  weak: 'Weak',
  rejected: 'Does not fit',
};

const clean = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
};

/** First sentence, for surfaces that show a reason rather than a paragraph. */
export function firstSentence(value: string | null | undefined, max = 190): string | null {
  const text = clean(value);
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.replace(/[\s,;]+$/, '')}…`;
}

/**
 * The Overview read. Everything it drops remains in the persisted result and
 * remains reachable; the counts in `depth` exist so the link to the full read
 * can state exactly how much more there is rather than implying this is all.
 */
export function digestDealRead(read: AcquisitionIntelligenceView | null): DealReadDigest | null {
  if (!read) return null;

  const opportunities = (read.opportunities ?? []).filter((item) => clean(item.title));
  const constraints = (read.constraints ?? []).filter((item) => clean(item.title));
  const unknowns = (read.unknowns ?? []).filter((item) => clean(item.question));
  const nextActions = (read.nextActions ?? []).filter((item) => clean(item.action));
  const strategies = (read.strategies ?? []).filter((item) => clean(item.strategy));

  const interesting = opportunities.slice(0, 4).map((item) => ({
    title: clean(item.title)!,
    why: firstSentence(item.why, 150),
  }));

  // The biggest questions are the analyst's unknowns. A read that named no
  // unknown but named blocking constraints still has questions; use those
  // rather than showing an empty column.
  const questionSource: Array<{ title: string; why: string | null }> = unknowns.length
    ? unknowns.map((item) => ({ title: clean(item.question)!, why: firstSentence(item.whyItMatters, 150) }))
    : constraints
      .filter((item) => (item.severity ?? '').toLowerCase() !== 'low')
      .map((item) => ({ title: clean(item.title)!, why: firstSentence(item.why, 150) }));

  const ranked = [...strategies].sort((a, b) => (
    (FIT_ORDER[(a.fit ?? 'possible').toLowerCase()] ?? 9) - (FIT_ORDER[(b.fit ?? 'possible').toLowerCase()] ?? 9)
  ));

  return {
    headline: clean(read.dealRead?.headline) ?? 'No acquisitions read has been produced for this property yet.',
    judgment: firstSentence(read.dealRead?.judgment, 420),
    confidence: clean(read.dealRead?.confidence),
    interesting,
    questions: questionSource.slice(0, 4),
    strategies: ranked.slice(0, 3).map((item) => {
      const fit = (item.fit ?? 'possible').toLowerCase();
      return {
        strategy: clean(item.strategy)!,
        fit,
        fitLabel: FIT_LABEL[fit] ?? (clean(item.fit) ?? 'Assessed'),
        whyItFits: firstSentence(item.whyItFits, 160),
        blocker: firstSentence(item.whatWeakensIt, 160),
        confirm: firstSentence(item.whatToConfirm, 160),
      };
    }),
    nextMove: nextActions[0]
      ? { action: clean(nextActions[0].action)!, why: firstSentence(nextActions[0].why, 200) }
      : null,
    depth: {
      insights: (read.propertyStory?.length ?? 0)
        + (read.marketStory?.length ?? 0)
        + opportunities.length
        + constraints.length
        + (read.conflicts?.length ?? 0)
        + (read.visualObservations?.length ?? 0),
      strategies: strategies.length,
      questions: unknowns.length,
    },
  };
}

// ── Topic routing ──────────────────────────────────────────────────────
//
// Matching is on the retained wording itself. A sentence that mentions no
// topic is not forced anywhere: the full read holds everything, so an
// unrouted sentence is shown there rather than filed under a heading it does
// not belong to.

const TOPIC_PATTERNS: Record<IntelligenceTopic, RegExp> = {
  access: /\b(access|frontage|entrance|driveway|easement|landlock|ingress|egress|right[- ]of[- ]way|curb cut|road)\b/i,
  terrain: /\b(slope|sloped|terrain|topograph\w*|buildab\w*|elevation|contour|creek|stream|pond|flood|fema|wetland\w*|soil\w*|usable acre\w*)\b/i,
  zoning: /\b(zoning|zoned|zone|district|subdivi\w*|entitle\w*|plat\w*|by[- ]right|rezon\w*|ordinance|setback|density|lot size|minor split|land use)\b/i,
  history: /\b(prior|previous|former|history|historical|master (?:development )?plan|planning commission|preliminary plat|approved lots?|lapsed|expired|abandoned|recorded plan)\b/i,
  utilities: /\b(utilit\w*|water(?: service| line| main)?|sewer|septic|wastewater|power|electric\w*|well|gas line|broadband)\b/i,
  market: /\b(market|comp\w*|days on market|dom\b|absorption|liquid\w*|sell[- ]through|inventory|months supply|acreage band|buyer\w*|demand|pricing|price per acre)\b/i,
  valuation: /\b(valuation|value|assessed|apprais\w*|basis|price|\$\d)/i,
};

const matchesTopic = (text: string, topic: IntelligenceTopic): boolean => TOPIC_PATTERNS[topic].test(text);

function pushInsight(into: TopicInsight[], seen: Set<string>, insight: TopicInsight): void {
  const key = insight.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  if (seen.has(key)) return;
  seen.add(key);
  into.push(insight);
}

/**
 * The retained analyst insights that are ABOUT one section, so the operator
 * reads the interpretation beside the evidence it interprets. Never a second
 * copy of the whole report: each surface takes a small number of the lines
 * that actually name its subject.
 */
export function insightsForTopic(
  read: AcquisitionIntelligenceView | null,
  topic: IntelligenceTopic,
  limit = 3,
): TopicInsight[] {
  if (!read) return [];
  const out: TopicInsight[] = [];
  const seen = new Set<string>();

  // Market reads lead with the market story; every other topic leads with the
  // property story. That ordering is the only topic-specific behavior here.
  const stories = topic === 'market'
    ? [...(read.marketStory ?? []), ...(read.propertyStory ?? [])]
    : [...(read.propertyStory ?? []), ...(read.marketStory ?? [])];

  for (const point of stories) {
    const text = clean(point);
    if (text && matchesTopic(text, topic)) pushInsight(out, seen, { text, kind: 'observation' });
  }
  for (const conflict of read.conflicts ?? []) {
    const text = clean(conflict.resolution) ?? clean(conflict.statement);
    const subject = clean(conflict.subject) ?? '';
    if (text && (matchesTopic(text, topic) || matchesTopic(subject.replace(/_/g, ' '), topic))) {
      pushInsight(out, seen, { text, kind: 'conflict' });
    }
  }
  for (const item of read.constraints ?? []) {
    const title = clean(item.title);
    if (!title) continue;
    const text = [title, clean(item.why)].filter(Boolean).join(' — ');
    if (matchesTopic(text, topic)) {
      pushInsight(out, seen, { text, kind: 'constraint', severity: item.severity });
    }
  }
  for (const item of read.opportunities ?? []) {
    const title = clean(item.title);
    if (!title) continue;
    const text = [title, clean(item.why)].filter(Boolean).join(' — ');
    if (matchesTopic(text, topic)) pushInsight(out, seen, { text, kind: 'opportunity' });
  }
  for (const item of read.visualObservations ?? []) {
    const text = clean(item.observation);
    if (text && matchesTopic(text, topic)) pushInsight(out, seen, { text, kind: 'observation' });
  }

  return out.slice(0, limit);
}

/**
 * The unresolved questions that name one topic, for a section's "still needed"
 * line. Separate from insightsForTopic because a question is a next step, not
 * an interpretation, and the two must not read as the same thing.
 */
export function questionsForTopic(
  read: AcquisitionIntelligenceView | null,
  topic: IntelligenceTopic,
  limit = 3,
): string[] {
  if (!read) return [];
  const out: string[] = [];
  for (const item of read.unknowns ?? []) {
    const text = clean(item.question);
    if (text && matchesTopic(text, topic) && !out.includes(text)) out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The next action that names one topic, so a section can end on the concrete
 * move rather than repeating the Overview's single next move.
 */
export function nextActionForTopic(
  read: AcquisitionIntelligenceView | null,
  topic: IntelligenceTopic,
): string | null {
  for (const item of read?.nextActions ?? []) {
    const text = clean(item.action);
    if (text && matchesTopic(text, topic)) return text;
  }
  return null;
}

export interface DiligencePriority {
  label: string;
  why: string | null;
  tier: 'high' | 'secondary';
}

/**
 * One ranked diligence queue instead of a page of "not established" rows.
 * High priority is what the analyst called blocking or high severity plus its
 * own next actions; everything else it raised follows as secondary. Retained
 * checklist items that the read never mentioned are appended, deduped, so
 * nothing already tracked disappears from the operator's view.
 */
export function diligencePriorities(
  read: AcquisitionIntelligenceView | null,
  retained: string[] = [],
  highLimit = 3,
  secondaryLimit = 5,
): { high: DiligencePriority[]; secondary: DiligencePriority[]; droppedRetained: number } {
  const seen = new Set<string>();
  const high: DiligencePriority[] = [];
  const secondary: DiligencePriority[] = [];
  const take = (label: string | null, why: string | null, tier: 'high' | 'secondary'): void => {
    const text = clean(label);
    if (!text) return;
    const key = text.toLowerCase().replace(/\s+/g, ' ').slice(0, 90);
    if (seen.has(key)) return;
    seen.add(key);
    (tier === 'high' ? high : secondary).push({ label: text, why, tier });
  };

  for (const item of read?.nextActions ?? []) take(item.action ?? null, firstSentence(item.why, 140), 'high');
  for (const item of read?.constraints ?? []) {
    if ((item.severity ?? '').toLowerCase() === 'high') take(item.title ?? null, firstSentence(item.why, 140), 'high');
  }
  for (const item of read?.unknowns ?? []) take(item.question ?? null, firstSentence(item.whyItMatters, 140), 'secondary');
  for (const item of retained) take(item, null, 'secondary');

  const droppedRetained = Math.max(0, (high.length - highLimit)) + Math.max(0, (secondary.length - secondaryLimit));
  return { high: high.slice(0, highLimit), secondary: secondary.slice(0, secondaryLimit), droppedRetained };
}
