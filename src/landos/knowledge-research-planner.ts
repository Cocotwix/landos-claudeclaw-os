// Shared deterministic knowledge-aware research planning.
//
// This module does no I/O. It turns an exact knowledge read plus the business
// contract's expected subjects into one auditable per-subject plan.

import type {
  ExpectedKnowledgeSubject,
  KnowledgeReadBundle,
  KnowledgeResearchPlan,
  KnowledgeSubjectPlan,
} from './knowledge-contract.js';

/** Small jurisdiction-source alias rule; original URLs remain provenance. */
export function normalizeJurisdictionSourceLocator(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();
    url.pathname = url.pathname
      .replace(/\/content\/uploads\//i, '/wp-content/uploads/')
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return raw.replace(/\/content\/uploads\//i, '/wp-content/uploads/').replace(/\/$/, '');
  }
}

export function dedupeExpectedKnowledgeSubjects(
  subjects: readonly ExpectedKnowledgeSubject[],
): ExpectedKnowledgeSubject[] {
  const byKey = new Map<string, ExpectedKnowledgeSubject>();
  for (const subject of subjects) {
    const subjectKey = subject.subjectKey.trim();
    if (subjectKey && !byKey.has(subjectKey)) byKey.set(subjectKey, { ...subject, subjectKey });
  }
  return [...byKey.values()].sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
}

export function buildKnowledgeResearchPlan(
  bundle: KnowledgeReadBundle,
  expected: readonly ExpectedKnowledgeSubject[],
): KnowledgeResearchPlan {
  const started = performance.now();
  const subjects = dedupeExpectedKnowledgeSubjects(expected);
  const plans: KnowledgeSubjectPlan[] = subjects.map((subject) => {
    const items = bundle.items.filter((item) => item.record.subjectKey === subject.subjectKey);
    const current = items.filter((item) => item.state === 'CURRENT');
    const drifted = current.some((item) => item.sources.some((source) => source.fingerprintDrifted || !source.supportStillAccepted));
    const blocked = items.filter((item) => item.state === 'CONFLICTING' || item.state === 'UNRESOLVED');
    const stale = items.filter((item) => item.state === 'STALE');
    const historical = items.filter((item) => item.state === 'SUPERSEDED');

    let decision: KnowledgeSubjectPlan['decision'];
    let reason: string;
    let freshnessState: KnowledgeSubjectPlan['freshnessState'];
    if (blocked.length) {
      decision = 'BLOCKED_CONFLICT';
      freshnessState = blocked[0].state;
      reason = 'Conflicting or unresolved accepted knowledge requires bounded resolution before reuse.';
    } else if (current.length && drifted) {
      decision = 'REFRESH';
      freshnessState = 'DRIFTED';
      reason = 'Supporting evidence changed after acceptance; the stored value remains unchanged pending refresh.';
    } else if (current.length) {
      decision = 'REUSE';
      freshnessState = 'CURRENT';
      reason = 'Current accepted compiled knowledge satisfies this expected subject.';
    } else if (stale.length || historical.length) {
      decision = 'REFRESH';
      freshnessState = stale[0]?.state ?? historical[0]?.state ?? 'STALE';
      reason = historical.length && !stale.length
        ? 'Only historical/superseded knowledge exists; it cannot be reused as current.'
        : 'Accepted knowledge exists but is stale and is eligible for bounded refresh.';
    } else {
      decision = 'RESEARCH_NEW';
      freshnessState = 'MISSING';
      reason = 'No accepted compiled knowledge exists for this expected subject.';
    }
    const researchAllowed = decision === 'REFRESH' || decision === 'RESEARCH_NEW';
    return {
      subjectKey: subject.subjectKey,
      label: subject.label,
      decision,
      reason,
      knowledgeRecordIds: items.map((item) => item.record.id),
      evidenceRefs: [...new Set(items.flatMap((item) => item.sources.map((source) =>
        `${source.evidenceNamespace}:${source.evidenceRef}`)))],
      freshnessState,
      researchAllowed,
      providerLaneIfNeeded: researchAllowed ? subject.providerLane : null,
    };
  });

  const providerLanes = [...new Set(subjects.map((subject) => subject.providerLane))].sort();
  const providerLanesEligible = [...new Set(plans
    .filter((plan) => plan.researchAllowed && plan.providerLaneIfNeeded)
    .map((plan) => plan.providerLaneIfNeeded as string))].sort();
  return {
    scopeKey: bundle.scopeKey,
    subjects: plans,
    counts: {
      expected: plans.length,
      reuse: plans.filter((plan) => plan.decision === 'REUSE').length,
      refresh: plans.filter((plan) => plan.decision === 'REFRESH').length,
      researchNew: plans.filter((plan) => plan.decision === 'RESEARCH_NEW').length,
      blockedConflict: plans.filter((plan) => plan.decision === 'BLOCKED_CONFLICT').length,
    },
    researchEligibleSubjectKeys: plans.filter((plan) => plan.researchAllowed).map((plan) => plan.subjectKey),
    providerLanesEligible,
    providerLanesSkipped: providerLanes.filter((lane) => !providerLanesEligible.includes(lane)),
    constructedInMs: Math.max(0, performance.now() - started),
    modelCalls: 0,
  };
}
