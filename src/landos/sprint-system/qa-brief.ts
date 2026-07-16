// LandOS Sprint System — Independent Browser-QA Brief.
//
// The browser-QA role is distinct from the builder. Its packet contains the
// original workstream requirements, the live URL, the required operator
// journey, relevant accepted facts, known historical failure patterns, and
// the requirement-ledger path — and deliberately EXCLUDES the builder's
// completion narrative, so QA inspects the live application instead of
// repeating the builder's conclusions. QA's job is to try to prove the
// implementation wrong.

import { type SprintLedger, findWorkstream, ledgerPath, redactUrl } from './ledger.js';

export interface QaBrief {
  sprintId: string;
  workstreamId: string;
  workstreamName: string;
  operatorOutcome: string;
  requirements: { id: string; text: string }[];
  liveUrl: string;
  journey: { journeyId?: string; steps: string[] };
  requiredVisibleOutcomes: string[];
  acceptedFacts: string[];
  knownFailurePatterns: string[];
  persistence: { refresh: boolean; restart: boolean };
  ledgerPath: string;
  mandate: string[];
}

export const QA_MANDATE = [
  'Actively attempt to prove the implementation wrong; never repeat the builder\'s conclusions.',
  'Open the actual running localhost dashboard in a real browser.',
  'Navigate the full affected workflow; click every relevant control and open every affected tab.',
  'Exercise relevant forms, maps, filters, tables, links, and actions.',
  'Compare visible frontend output with API responses and, when appropriate, database records.',
  'Compare visible output with accepted operator facts.',
  'Refresh the browser and verify persistence; when restart persistence is required, restart via npm run landos:restart and reopen the workflow.',
  'Capture fresh screenshots and exact reproduction steps for every failure.',
  'Judge business meaning and operator usability, not merely whether pages load.',
  'Return a non-passing result whenever an internally fixable issue remains.',
  'After repairs, run the exact same journey again.',
];

export function buildQaBrief(
  root: string,
  ledger: SprintLedger,
  workstreamId: string,
  input: { liveUrl: string; acceptedFacts?: string[]; knownFailurePatterns?: string[] },
): QaBrief {
  const ws = findWorkstream(ledger, workstreamId);
  return {
    sprintId: ledger.sprintId,
    workstreamId: ws.id,
    workstreamName: ws.name,
    operatorOutcome: ws.operatorOutcome,
    requirements: ws.requirements.map(({ id, text }) => ({ id, text })),
    liveUrl: redactUrl(input.liveUrl),
    journey: ws.browserJourney,
    requiredVisibleOutcomes: ws.failureConditions.map((condition) => `Must NOT occur: ${condition}`),
    acceptedFacts: input.acceptedFacts ?? [],
    knownFailurePatterns: input.knownFailurePatterns ?? [],
    persistence: ws.persistence,
    ledgerPath: ledgerPath(root, ledger.sprintId),
    mandate: QA_MANDATE,
  };
}

/** Assert the brief never leaks builder narrative. */
export function briefLeakProblems(brief: QaBrief, ledger: SprintLedger): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(brief).toLowerCase();
  for (const ws of ledger.workstreams) {
    if (ws.builderResult && ws.builderResult.length > 20 && text.includes(ws.builderResult.toLowerCase())) {
      problems.push(`brief contains the builder narrative for ${ws.id}`);
    }
  }
  if (/token=(?!redacted)[^&\s"']+/i.test(text)) problems.push('brief contains an unredacted token');
  return problems;
}

export function renderQaBrief(brief: QaBrief): string {
  return [
    `# Independent Browser-QA Brief — ${brief.workstreamId}: ${brief.workstreamName}`,
    '',
    `- Sprint: ${brief.sprintId}`,
    `- Live URL: ${brief.liveUrl}`,
    `- Ledger: ${brief.ledgerPath}`,
    `- Persistence checks: refresh=${brief.persistence.refresh} restart=${brief.persistence.restart}`,
    '',
    `Operator outcome under test: ${brief.operatorOutcome}`,
    '',
    '## Requirements to disprove',
    ...brief.requirements.map((r) => `- ${r.id}: ${r.text}`),
    '',
    '## Required operator journey',
    ...brief.journey.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Prohibited outcomes',
    ...brief.requiredVisibleOutcomes.map((o) => `- ${o}`),
    '',
    '## Accepted operator facts (must not be contradicted)',
    ...(brief.acceptedFacts.length ? brief.acceptedFacts.map((f) => `- ${f}`) : ['- none supplied']),
    '',
    '## Known historical failure patterns',
    ...(brief.knownFailurePatterns.length ? brief.knownFailurePatterns.map((p) => `- ${p}`) : ['- none recorded']),
    '',
    '## Mandate',
    ...brief.mandate.map((m) => `- ${m}`),
    '',
  ].join('\n');
}
