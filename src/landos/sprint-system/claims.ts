// LandOS Sprint System — Proof-Backed Completion Claims.
//
// Agents cannot claim implemented / working / verified / passed / complete /
// live / migrated / fixed unless the requirement ledger contains linked
// evidence. Sprint reports are linted: a claim line must cite ledger evidence
// ids in the form [E:<id>] (for example [E:E3]) or it remains unverified.

import type { SprintLedger } from './ledger.js';

export const CLAIM_WORDS = [
  'implemented',
  'working',
  'verified',
  'passed',
  'complete',
  'completed',
  'live',
  'migrated',
  'fixed',
] as const;

// "live" claims completion only as a predicate ("is live", "now live");
// as an adjective ("the live dashboard", "live page") it describes the
// environment under test, not an achievement.
const CLAIM_RE = new RegExp(
  `\\b(${CLAIM_WORDS.filter((w) => w !== 'live').join('|')})\\b|\\b(?:is|are|now|went|goes)\\s+(live)\\b`,
  'i',
);
const NEGATION_RE = /\b(not|never|un[- ]?verified|unverified|incomplete|awaiting|pending|without|cannot|failed to|must (?:be|remain)|before|until|requires?)\b/i;
const EVIDENCE_REF_RE = /\[E:([A-Za-z0-9_-]+)\]/g;

export interface ClaimFinding {
  line: number;
  text: string;
  word: string;
  supported: boolean;
  problem?: string;
}

/**
 * Lint free-text report content for unsupported completion claims.
 * A line making a positive completion claim must cite at least one ledger
 * evidence id via [E:<id>]. Negated or forward-looking sentences are ignored.
 */
export function lintCompletionClaims(reportText: string, ledger: SprintLedger): ClaimFinding[] {
  const evidenceIds = new Set(ledger.evidence.map((e) => e.id));
  const findings: ClaimFinding[] = [];
  const lines = reportText.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || text.startsWith('>')) return;
    const claim = text.match(CLAIM_RE);
    if (!claim) return;
    const word = (claim[1] ?? claim[2]).toLowerCase();
    if (NEGATION_RE.test(text)) return;
    const refs = [...text.matchAll(EVIDENCE_REF_RE)].map((m) => m[1]);
    if (!refs.length) {
      findings.push({
        line: index + 1,
        text,
        word,
        supported: false,
        problem: 'completion claim without a linked ledger evidence id ([E:<id>])',
      });
      return;
    }
    const unknown = refs.filter((id) => !evidenceIds.has(id));
    if (unknown.length) {
      findings.push({
        line: index + 1,
        text,
        word,
        supported: false,
        problem: `cited evidence not in ledger: ${unknown.join(', ')}`,
      });
      return;
    }
    findings.push({ line: index + 1, text, word, supported: true });
  });
  return findings;
}

export function unsupportedClaims(reportText: string, ledger: SprintLedger): ClaimFinding[] {
  return lintCompletionClaims(reportText, ledger).filter((f) => !f.supported);
}
