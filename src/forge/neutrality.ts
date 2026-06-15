// Forge neutrality scanner — pure Forge Core.
//
// Deterministic, dependency-free. Forge is a universal builder: its core,
// generated output, and docs stay industry-neutral and define what Forge IS in
// positive language. This module is a lightweight regression guard. It scans a
// string for two things that erode that neutrality:
//
//   1. Negative self-framing — defining Forge or an agent by what it is NOT
//      ("Forge is not...", "not just a persona/prompt/chatbot").
//   2. Domain leakage — business-, industry-, or legacy-project-specific terms
//      that have no place in universal Forge core or generated output.
//
// It reads no files and runs nothing; callers (typically tests) pass text in.
// The whole-word, narrowly scoped patterns are deliberately conservative to
// avoid flagging legitimate technical caveats (e.g. "not a security boundary").

export type NeutralityIssueKind = 'negative_framing' | 'domain_specific' | 'named_entity';

export interface NeutralityIssue {
  kind: NeutralityIssueKind;
  /** The rule label that fired. */
  rule: string;
  /** The exact text that matched, so the caller can see why. */
  matchedText: string;
}

interface NeutralityRule {
  kind: NeutralityIssueKind;
  rule: string;
  pattern: RegExp;
}

// Narrow: only flag defining-by-negation of the product/agent itself, not every
// sentence containing "not". Technical caveats like "not a security boundary"
// stay allowed on purpose.
const NEGATIVE_FRAMING_RULES: readonly NeutralityRule[] = [
  { kind: 'negative_framing', rule: 'Forge defined by negation', pattern: /\bforge\s+is\s+not\b/i },
  { kind: 'negative_framing', rule: 'Forge defined by negation', pattern: /\bforge\s+isn'?t\b/i },
  { kind: 'negative_framing', rule: 'Agent defined by negation', pattern: /\b(the|this|a|an)\s+agent\s+is\s+not\s+(a|an|just)\b/i },
  { kind: 'negative_framing', rule: '"not just a ..." framing', pattern: /\bnot\s+just\s+a[n]?\s+(persona|prompt|chatbot|assistant|tool)\b/i },
  { kind: 'negative_framing', rule: '"rather than a ..." framing', pattern: /\brather\s+than\s+a[n]?\s+(persona|prompt|chatbot|assistant)\b/i },
];

// Whole-word business/industry-specific terms that should never appear in
// universal Forge core or generated output. Kept to clearly domain-specific
// words to avoid false positives on ordinary software language.
const DOMAIN_TERMS = [
  'real estate', 'realtor', 'mls', 'parcel', 'acreage', 'mineral rights',
  'mortgage', 'escrow', 'appraisal', 'patient', 'clinical', 'diagnosis',
  'prescription', 'attorney', 'litigation', 'plaintiff', 'defendant',
  'underwriting', 'crop', 'livestock',
];

// Legacy project / personal names that would tie universal output to one host.
const NAMED_ENTITIES = ['landos', 'landportal', 'landally', 'claudeclaw', 'tyler', 'buttleman'];

function wordRule(kind: NeutralityIssueKind, term: string): NeutralityRule {
  // Escape regex metachars, then require word boundaries around the term.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { kind, rule: term, pattern: new RegExp(`\\b${escaped}\\b`, 'i') };
}

const ALL_RULES: readonly NeutralityRule[] = [
  ...NEGATIVE_FRAMING_RULES,
  ...DOMAIN_TERMS.map((t) => wordRule('domain_specific', t)),
  ...NAMED_ENTITIES.map((t) => wordRule('named_entity', t)),
];

/**
 * Scan text for neutrality issues. Pure and deterministic. Returns one issue
 * per rule that fired, with the matched substring.
 */
export function scanForNeutralityIssues(text: string): NeutralityIssue[] {
  const input = text ?? '';
  const issues: NeutralityIssue[] = [];
  for (const r of ALL_RULES) {
    const m = input.match(r.pattern);
    if (m && m[0]) {
      issues.push({ kind: r.kind, rule: r.rule, matchedText: m[0] });
    }
  }
  return issues;
}

/** True when no neutrality issue was found. */
export function isNeutral(text: string): boolean {
  return scanForNeutralityIssues(text).length === 0;
}
