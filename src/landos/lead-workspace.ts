// Lead Workspace read model.  This is a composition boundary, not a new source
// of business truth: callers pass the already-canonical records owned by the
// existing services.

export const LEAD_WORKSPACE_CONTRACT_VERSION = '1.0';

export interface DepartmentOutput {
  department: string;
  capability: string;
  outputType: string;
  version: string;
  status: 'current' | 'stale' | 'partial' | 'unavailable' | 'blocked' | 'unresolved';
  summary: string;
  findings: unknown;
  evidenceRefs: unknown[];
  observedAt: number | string | null;
  confidence: string | null;
  completeness: unknown;
  blockers: string[];
  dependencies: string[];
  recommendedActions: string[];
  provenance: { producer: string; author: string | null };
}

export interface LeadWorkspaceInput {
  deal: Record<string, unknown>;
  report: Record<string, unknown>;
  acquisition: Record<string, unknown>;
  nextAction: Record<string, unknown>;
  operatorRecord: Record<string, unknown>;
  canonical: Record<string, unknown>;
  compRegistry: Record<string, unknown>;
  documents: Record<string, unknown>;
  mission: Record<string, unknown>;
  activity: unknown[];
  marketPulse: unknown;
  marketMatrix: unknown;
  /** Recorded resolution snapshot (landos_resolution_snapshot) or null when no
   *  resolution attempt was ever recorded for this lead. */
  resolution?: Record<string, unknown> | null;
}

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown): string[] => array(value).filter((x): x is string => typeof x === 'string');
const text = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value : fallback;

export function buildLeadWorkspace(input: LeadWorkspaceInput) {
  const readiness = (input.canonical.unifiedReadiness ?? {}) as Record<string, unknown>;
  const strategy = (input.canonical.strategyReadiness ?? {}) as Record<string, unknown>;
  const research = (input.operatorRecord.researchCompleteness ?? {}) as Record<string, unknown>;
  const identity = (input.operatorRecord.identity ?? {}) as Record<string, unknown>;
  // Canonical WS1 acreage & spatial basis lives on the operator record's
  // identity. The legacy per-report reconciliation is tolerated ONLY when no
  // canonical basis exists (partial legacy data) — it must never outrank it.
  const acreage = (identity.acreageBasis ?? input.report.reconciliation ?? {}) as Record<string, unknown>;
  // Recorded resolution provenance: a lead whose resolution attempt ran and
  // honestly stayed unresolved must never present as "Not run".
  const snapshot = (input.resolution ?? null) as Record<string, unknown> | null;
  const identityConflict = (snapshot?.identityConflict ?? null) as Record<string, unknown> | null;
  const verified = input.report.parcelVerified === true;
  const snapshotState = snapshot ? text(snapshot.state, 'unresolved') : null;
  // A snapshot recorded BEFORE the parcel was verified is history, not the
  // current state: it must never contradict the verified provenance on the
  // same panel (QA finding W2-F3). It stays available, clearly labeled.
  const historical = verified && snapshotState !== null && snapshotState !== 'confirmed' && !identityConflict;
  const resolution = {
    attempted: snapshot !== null,
    state: verified && !identityConflict ? 'confirmed' : (snapshotState ?? (verified ? 'confirmed' : 'not_run')),
    // The current verification provenance for a verified lead (never the
    // pre-verification snapshot's language).
    verifiedStatus: verified ? text(input.report.parcelVerificationStatus, 'verified') : null,
    historical,
    confidence: snapshot?.confidence ?? null,
    basis: snapshot ? text(snapshot.basis, '') || null : null,
    matchedReason: snapshot ? text(snapshot.matchedReason, '') || null : null,
    missing: strings(snapshot?.missing),
    smallestNextIdentifier: snapshot ? text(snapshot.smallestNextIdentifier, '') || null : null,
    identityConflict,
    capturedAt: snapshot?.capturedAt ?? null,
  };
  const resolutionState = verified
    ? (input.report.parcelVerificationStatus ?? 'verified')
    : snapshot ? text(snapshot.state, 'unresolved') : (input.report.parcelVerificationStatus ?? 'unresolved');
  const reportGaps = strings(input.report.dataGaps);
  const reportRisks = strings(input.report.riskFlags);
  const blockers = [...new Set([
    ...(identityConflict ? [
      `Parcel identity conflict: requested APN ${text(identityConflict.requestedApn, 'unknown')} but ${text(identityConflict.source, 'a parcel-level source')} resolved APN ${text(identityConflict.resolvedApn, 'unknown')}. This lead is blocked until the correct parcel is confirmed; no property intelligence, valuation, or strategy work may proceed.`,
    ] : []),
    ...strings(readiness.blockers),
    ...strings(input.operatorRecord.tylerDecisions),
    ...strings(input.report.strategyBlockers),
    ...reportRisks,
  ])];
  const status = input.report.parcelVerified === true ? 'current' : 'unresolved';
  const outputs: DepartmentOutput[] = [
    {
      department: 'Acquisitions', capability: 'seller-intelligence', outputType: 'seller-and-communications', version: '1.0',
      status: 'current', summary: text((input.acquisition as Record<string, unknown>).stage, 'Seller profile has not been captured yet.'),
      findings: { profile: input.acquisition.profile ?? {}, communications: input.acquisition.commLog ?? [], discovery: input.acquisition.discovery ?? [] }, evidenceRefs: [], observedAt: input.acquisition.updatedAt as number | string | null ?? null,
      confidence: 'operator-recorded', completeness: null, blockers: [], dependencies: ['Deal Card acquisition state'], recommendedActions: [text(input.nextAction.label, 'Review the current lead')], provenance: { producer: 'acquisitions', author: 'operator or acquisition service' },
    },
    {
      department: 'Property Intelligence', capability: 'canonical-property-research', outputType: 'property-research', version: '1.0',
      status: status as DepartmentOutput['status'], summary: text(input.report.ddSummary, 'Property research has not been generated yet.'), findings: { acreage, research, readiness }, evidenceRefs: array(input.report.sourceTable), observedAt: input.report.generatedAt as number | null ?? null,
      confidence: text(input.report.parcelVerificationStatus, 'unresolved'), completeness: research, blockers, dependencies: ['WS1 acreage basis', 'WS2 research completeness', 'WS3 unified readiness'], recommendedActions: strings(input.operatorRecord.sellerQuestions), provenance: { producer: 'canonical Deal Card services', author: input.report.updatedBy as string ?? null },
    },
    {
      department: 'Market Research', capability: 'market-and-valuation', outputType: 'market-context', version: '1.0',
      status: input.report.parcelVerified === true ? 'partial' : 'unresolved', summary: text(input.report.marketSummary, 'Market context is unavailable.'), findings: { marketPulse: input.marketPulse, marketMatrix: input.marketMatrix, valuation: input.report.valuation, comparables: input.compRegistry }, evidenceRefs: array(input.report.bestComps), observedAt: input.report.generatedAt as number | null ?? null,
      confidence: null, completeness: input.compRegistry.counts ?? null, blockers: strings((strategy as Record<string, unknown>).pricingBlockers), dependencies: ['validated comp registry'], recommendedActions: [], provenance: { producer: 'market/valuation shared services', author: null },
    },
  ];
  return {
    contract: { type: 'lead-workspace', version: LEAD_WORKSPACE_CONTRACT_VERSION, generatedAt: new Date().toISOString() },
    lead: { id: input.deal.id, title: input.deal.title, lifecycle: input.deal.status ?? input.acquisition.stage ?? 'unknown', entity: input.deal.entity ?? null },
    property: { identity, resolutionState, resolution, canonicalAcreage: acreage, intelligence: { summary: input.report.ddSummary ?? null, research, gaps: reportGaps } },
    seller: { people: input.deal.people ?? [], profile: input.acquisition.profile ?? {}, communications: input.acquisition.commLog ?? [], notes: input.acquisition.discovery ?? [] },
    market: { pulse: input.marketPulse, matrix: input.marketMatrix, summary: input.report.marketSummary ?? null, valuation: input.report.valuation ?? null, comparables: input.compRegistry },
    strategies: { approvedOnly: true, entries: array(strategy.strategies), summary: strategy.summaryLine ?? null, pricingAllowed: strategy.pricingAllowed ?? false, pricingBlockers: strings(strategy.pricingBlockers) },
    offerAndNegotiation: { readiness: readiness.offer ?? input.report.offerReadiness ?? null, history: [], availability: 'No dedicated offer/negotiation history is currently published by the existing record adapters.' },
    work: { tasks: array(input.deal.nextActions), blockers, decisions: strings(input.operatorRecord.tylerDecisions), recommendedNextAction: input.nextAction, agentWork: input.operatorRecord.workStatus ?? [], activity: input.activity, mission: input.mission },
    evidence: { visuals: input.report.visualContext ?? null, documents: input.documents, sources: array(input.report.sourceTable), reports: { generatedAt: input.report.generatedAt ?? null } },
    readiness,
    departmentOutputs: outputs,
    freshness: { reportGeneratedAt: input.report.generatedAt ?? null, status },
  };
}
