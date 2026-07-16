// Shared fixtures for the sprint-system tests. Not a test file itself.

import {
  addEvidence,
  createSprint,
  type SprintLedger,
  type WorkstreamSpec,
} from './ledger.js';
import {
  recordBrowserQaResult,
  recordPhase,
  startWorkstream,
  verifyRequirement,
  type NewFinding,
} from './orchestrator.js';

export const FIXED_NOW = () => '2026-07-15T00:00:00.000Z';

export function workstreamSpec(id: string, overrides: Partial<WorkstreamSpec> = {}): WorkstreamSpec {
  return {
    id,
    name: `Workstream ${id}`,
    operatorOutcome: 'Tyler sees the verified value on the live Deal Card.',
    inScope: ['deal card value rendering'],
    backendServices: ['routes.ts'],
    frontendScreens: ['/landos?deal={dealId}'],
    requiredDataState: 'An existing verified deal card.',
    browserJourney: { journeyId: 'dashboard-shell-health', steps: ['Open the dashboard', 'Open the deal card'] },
    testRequirements: ['vitest sprint-system suite'],
    persistence: { refresh: true, restart: false },
    failureConditions: ['backend value missing from the visible card'],
    requiredProofs: ['screenshot', 'browser_journey'],
    dependsOn: [],
    requirements: [{ id: `${id}-R1`, text: 'The value is visible in the live browser.' }],
    ...overrides,
  };
}

export function makeLedger(specs?: WorkstreamSpec[]): SprintLedger {
  return createSprint({
    sprintId: 'sprint-test',
    title: 'Test sprint',
    originalPrompt: 'Build A. Also build B. Both must be visible to the operator.',
    workstreams: specs ?? [workstreamSpec('ws1'), workstreamSpec('ws2', { dependsOn: ['ws1'] })],
    now: FIXED_NOW,
  });
}

export function driveToAwaitingQa(ledger: SprintLedger, wsId: string): void {
  startWorkstream(ledger, wsId, FIXED_NOW);
  const phases = [
    'implementation',
    'targeted_tests',
    'integration_tests',
    'typecheck',
    'production_build',
    'runtime_verification',
  ] as const;
  for (const phase of phases) {
    recordPhase(ledger, wsId, phase, { status: 'pass', detail: `${phase} ok` }, FIXED_NOW);
  }
}

export function passIndependentQa(ledger: SprintLedger, wsId: string): void {
  const shot = addEvidence(ledger, { kind: 'screenshot', summary: 'card screenshot', path: `.runtime/landos/qa/${wsId}.png`, workstreamId: wsId }, FIXED_NOW);
  const journey = addEvidence(ledger, { kind: 'browser_journey', summary: 'journey pass', path: `.runtime/landos/qa/${wsId}.json`, workstreamId: wsId }, FIXED_NOW);
  const refresh = addEvidence(ledger, { kind: 'refresh_persistence', summary: 'data persisted across refresh', workstreamId: wsId }, FIXED_NOW);
  const qa = addEvidence(ledger, { kind: 'independent_browser_qa', summary: 'independent QA pass', workstreamId: wsId }, FIXED_NOW);
  recordBrowserQaResult(
    ledger,
    wsId,
    { result: 'pass', reportPath: `.runtime/landos/qa/${wsId}-report.md`, evidenceIds: [qa.id], findings: [] },
    FIXED_NOW,
  );
  const ws = ledger.workstreams.find((w) => w.id === wsId)!;
  for (const req of ws.requirements) {
    verifyRequirement(ledger, wsId, req.id, [shot.id, journey.id, refresh.id], FIXED_NOW);
  }
}

export function sampleFinding(overrides: Partial<NewFinding> = {}): NewFinding {
  return {
    requirementId: null,
    liveUrl: 'http://localhost:3141/landos?deal=7',
    steps: ['Open the deal card', 'Read the acreage value'],
    expected: 'Backend acreage visible on the card',
    actual: 'Card shows no acreage while the API returns 12.5',
    evidencePaths: ['.runtime/landos/qa/finding.png'],
    apiOrDbEvidence: 'GET /api/landos/deal-cards/7 -> acreage 12.5',
    severity: 'major',
    suspectedSubsystem: 'deal-card frontend payload',
    disposition: 'internally_fixable',
    patternKey: 'frontend-backend-divergence',
    ...overrides,
  };
}
