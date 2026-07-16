// LandOS Sprint System — Accepted-Capability Freeze.
//
// Once an operator capability passes all workstream browser journeys, the
// final combined regression, the independent final review, and (where
// required) Tyler acceptance, it is frozen in the capability registry with
// its golden journeys, regression fixtures, invariants, browser assertions,
// and proof artifacts. Future work touching shared dependencies must rerun
// the protected regression journey, and an accepted capability cannot be
// casually reopened. This prevents endlessly rebuilding one capability while
// other departments remain unfinished.

import fs from 'fs';
import path from 'path';
import { type SprintLedger } from './ledger.js';
import { completeSprintRefusals } from './orchestrator.js';

export const CAPABILITIES_PATH = path.join('.landos', 'capabilities.json');

export interface AcceptedCapability {
  id: string;
  name: string;
  department: string;
  acceptedAt: string;
  /** Version anchor: git HEAD or checkpoint reference at acceptance. */
  acceptedVersion: string;
  sprintId: string;
  goldenJourneyIds: string[];
  regressionFixtures: string[];
  sharedInvariants: string[];
  browserAssertions: string[];
  proofArtifacts: string[];
  knownLimitations: string[];
  deliberateExternalBlockers: string[];
  /** Repo paths whose change requires rerunning this capability's journeys. */
  sharedDependencyPaths: string[];
  tylerAcceptance: { required: boolean; grantedAt: string | null };
}

export interface CapabilityRegistry {
  schema: 1;
  capabilities: AcceptedCapability[];
}

export function emptyCapabilityRegistry(): CapabilityRegistry {
  return { schema: 1, capabilities: [] };
}

export function loadCapabilityRegistry(root: string): CapabilityRegistry {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, CAPABILITIES_PATH), 'utf8'));
    return value?.schema === 1 ? (value as CapabilityRegistry) : emptyCapabilityRegistry();
  } catch {
    return emptyCapabilityRegistry();
  }
}

export function saveCapabilityRegistry(root: string, registry: CapabilityRegistry): string {
  const file = path.join(root, CAPABILITIES_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return file;
}

export interface FreezeSpec {
  id: string;
  name: string;
  department: string;
  acceptedVersion: string;
  goldenJourneyIds: string[];
  regressionFixtures: string[];
  sharedInvariants: string[];
  browserAssertions: string[];
  proofArtifacts: string[];
  knownLimitations: string[];
  deliberateExternalBlockers: string[];
  sharedDependencyPaths: string[];
  tylerAcceptance: { required: boolean; grantedAt: string | null };
}

export function freezeRefusals(ledger: SprintLedger, spec: FreezeSpec): string[] {
  const refusals: string[] = [];
  if (ledger.sprintStatus === 'active') {
    refusals.push(...completeSprintRefusals(ledger).map((r) => `sprint incomplete: ${r}`));
  }
  if (!ledger.finalRegression || ledger.finalRegression.result !== 'pass') {
    refusals.push('final combined regression did not pass');
  }
  if (!ledger.finalReview || ledger.finalReview.result !== 'pass') {
    refusals.push('independent final review did not pass');
  }
  if (!spec.goldenJourneyIds.length) refusals.push('a frozen capability requires at least one golden journey');
  if (!spec.proofArtifacts.length) refusals.push('a frozen capability requires proof artifacts');
  if (spec.tylerAcceptance.required && !spec.tylerAcceptance.grantedAt) {
    refusals.push('Tyler acceptance is required but not granted');
  }
  return refusals;
}

export function freezeCapability(
  registry: CapabilityRegistry,
  ledger: SprintLedger,
  spec: FreezeSpec,
  now: () => string = () => new Date().toISOString(),
): AcceptedCapability {
  const refusals = freezeRefusals(ledger, spec);
  if (refusals.length) throw new Error(`refusing to freeze ${spec.id}: ${refusals.join('; ')}`);
  if (registry.capabilities.some((c) => c.id === spec.id)) {
    throw new Error(`capability ${spec.id} is already frozen; reopening requires an approved justification`);
  }
  const capability: AcceptedCapability = { ...spec, acceptedAt: now(), sprintId: ledger.sprintId };
  registry.capabilities.push(capability);
  return capability;
}

export type ReopenReason =
  | 'verified_regression'
  | 'approved_enhancement'
  | 'shared_dependency_change';

export function reopenProblems(
  registry: CapabilityRegistry,
  capabilityId: string,
  request: { reason: ReopenReason; justification: string; approvedBy?: string },
): string[] {
  const capability = registry.capabilities.find((c) => c.id === capabilityId);
  if (!capability) return [`capability ${capabilityId} is not frozen; nothing to reopen`];
  const problems: string[] = [];
  if (!request.justification.trim()) problems.push('reopening requires a written justification');
  if (request.reason === 'approved_enhancement' && !request.approvedBy?.trim()) {
    problems.push('an enhancement reopen requires explicit approval (for example Tyler)');
  }
  if (request.reason === 'verified_regression' && !/\b(journey|regression|finding|test)\b/i.test(request.justification)) {
    problems.push('a regression reopen must cite the failing journey, test, or finding');
  }
  return problems;
}

/** Capabilities whose protected journeys must rerun because shared paths changed. */
export function capabilitiesTouchedBy(
  registry: CapabilityRegistry,
  changedPaths: string[],
): { capability: AcceptedCapability; journeyIds: string[] }[] {
  const normalized = changedPaths.map((p) => p.replace(/\\/g, '/'));
  return registry.capabilities
    .filter((capability) =>
      capability.sharedDependencyPaths.some((dep) => {
        const depNorm = dep.replace(/\\/g, '/');
        return normalized.some((p) => p === depNorm || p.startsWith(`${depNorm.replace(/\/$/, '')}/`));
      }),
    )
    .map((capability) => ({ capability, journeyIds: capability.goldenJourneyIds }));
}
