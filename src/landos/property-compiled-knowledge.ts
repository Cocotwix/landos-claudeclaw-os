// Property Intelligence's compiled-knowledge consumer.
//
// This is the FIRST cross-department reuse of the Knowledge Compiler. Property
// Intelligence READS already-verified jurisdiction knowledge and receives it as
// reusable evidence. It never compiles, never researches, never suppresses
// research, never refreshes stale knowledge and never resolves a conflict:
// those stay with the deterministic knowledge-research planner upstream.

import { readCompiledKnowledge, type CompiledKnowledgeFact } from './compiled-knowledge-read.js';
import { jurisdictionKnowledgeJurisdiction, jurisdictionKnowledgeScopeKey } from './jurisdiction-knowledge.js';
import { readControllingAuthority } from './land-use-intelligence-store.js';

export interface PropertyCompiledKnowledge {
  /** Null when the controlling jurisdiction is not resolved for this deal. */
  scopeKey: string | null;
  jurisdictionLabel: string | null;
  /** Settled reusable jurisdiction rules only. */
  current: CompiledKnowledgeFact[];
  /** Verified but past freshness policy. Named as needing refresh, never current. */
  stale: CompiledKnowledgeFact[];
  /** Conflicting or unresolved retained claims. Never settled truth. */
  notSettled: CompiledKnowledgeFact[];
  modelCalls: 0;
  researchRuns: 0;
  knowledgeWrites: 0;
}

export const EMPTY_PROPERTY_COMPILED_KNOWLEDGE: PropertyCompiledKnowledge = {
  scopeKey: null,
  jurisdictionLabel: null,
  current: [],
  stale: [],
  notSettled: [],
  modelCalls: 0,
  researchRuns: 0,
  knowledgeWrites: 0,
};

/**
 * Deterministic SELECT-only read of the CURRENT compiled jurisdiction knowledge
 * for a deal's resolved controlling jurisdiction. Zero model calls, zero
 * research runs, zero writes.
 */
export function readPropertyCompiledKnowledge(
  dealCardId: number,
  options: { now?: string } = {},
): PropertyCompiledKnowledge {
  const jurisdiction = jurisdictionKnowledgeJurisdiction(readControllingAuthority(dealCardId));
  const scopeKey = jurisdiction ? jurisdictionKnowledgeScopeKey(jurisdiction) : null;
  // Fail closed: an unresolved or ambiguous authority reuses nothing rather
  // than reaching for another jurisdiction's rules.
  if (!scopeKey) return { ...EMPTY_PROPERTY_COMPILED_KNOWLEDGE };

  const read = readCompiledKnowledge({
    domain: 'jurisdiction',
    scopeKind: 'jurisdiction',
    scopeKey,
    now: options.now,
  });
  return {
    scopeKey,
    jurisdictionLabel: jurisdiction
      ? `${jurisdiction.authorityName} (${jurisdiction.level}), ${jurisdiction.state}`
      : null,
    current: read.current,
    stale: read.stale,
    notSettled: read.notSettled,
    modelCalls: 0,
    researchRuns: 0,
    knowledgeWrites: 0,
  };
}

function sourceLine(fact: CompiledKnowledgeFact): string {
  const source = fact.sources.find((row) => row.url) ?? fact.sources[0] ?? null;
  const locator = source ? `${source.label}${source.url ? ` <${source.url}>` : ''}` : 'no retained source locator';
  return `source: ${fact.sourceAuthority} — ${locator}`;
}

function factLine(fact: CompiledKnowledgeFact): string {
  return `- [${fact.state}] ${fact.subjectKey}: ${fact.statement} `
    + `(confidence ${fact.confidence}; last verified ${fact.lastVerifiedAt}; ${sourceLine(fact)})`;
}

/**
 * The labeled Property evidence section. Compiled knowledge is reusable
 * VERIFIED JURISDICTION evidence and stays distinguishable from parcel-specific
 * observed fact, seller-reported fact, interpretation and hypothesis.
 */
export function compiledJurisdictionKnowledgeSection(knowledge: PropertyCompiledKnowledge): string {
  if (!knowledge.scopeKey || (!knowledge.current.length && !knowledge.stale.length && !knowledge.notSettled.length)) {
    return '';
  }
  const lines = [
    '=== COMPILED JURISDICTION KNOWLEDGE (REUSABLE VERIFIED EVIDENCE) ===',
    `Controlling jurisdiction: ${knowledge.jurisdictionLabel ?? knowledge.scopeKey} [scope ${knowledge.scopeKey}]`,
    'These rules were compiled from already-verified official jurisdiction evidence on earlier work in this same jurisdiction. They are REUSABLE JURISDICTION-LEVEL EVIDENCE, not parcel-specific fact. A jurisdiction rule never becomes a fact about THIS parcel on its own: combine it with parcel-specific evidence before concluding anything about this property. Do not treat an absent rule as permission or prohibition, and do not infer this parcel\'s zoning, dimensions or subdivision eligibility from jurisdiction-level knowledge alone.',
  ];
  if (knowledge.current.length) {
    lines.push('', `CURRENT compiled jurisdiction rules (${knowledge.current.length}) — settled reusable knowledge:`);
    lines.push(...knowledge.current.map(factLine));
  }
  if (knowledge.stale.length) {
    lines.push(
      '',
      `PAST FRESHNESS — NOT CURRENT (${knowledge.stale.length}). Previously verified, now due for re-verification. Do not rely on these as current rules; name them as needing refresh:`,
    );
    lines.push(...knowledge.stale.map(factLine));
  }
  if (knowledge.notSettled.length) {
    lines.push(
      '',
      `NOT SETTLED (${knowledge.notSettled.length}). Competing or unresolved verified claims retained without resolution. These are NOT truth and must not be presented as a settled rule:`,
    );
    lines.push(...knowledge.notSettled.map(factLine));
  }
  lines.push('', '=== END COMPILED JURISDICTION KNOWLEDGE ===');
  return lines.join('\n');
}
