import { createHash, randomUUID } from 'node:crypto';

export type CapabilityCallerType = 'tools' | 'new_lead' | 'deal_card' | 'internal_workflow';
export type CapabilityInvocationMode = 'reuse' | 'refresh';
export type CapabilityRunStatus = 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
export type SubjectResolutionState = 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CapabilityMetadata {
  id: string;
  name: string;
  contractVersion: string;
  description: string;
}

export type CapabilityEntity = 'LAND_ALLY' | 'TY_LAND_BIZ';

export type CapabilitySubjectInput =
  | {
      kind: 'raw_property';
      entity: CapabilityEntity;
      rawInput: string;
      target?: { propertyCardId: number; dealCardId: number };
    }
  | { kind: 'canonical_property'; entity: CapabilityEntity; propertyCardId: number; dealCardId?: number };

export interface CapabilityInvocationRequest {
  capabilityId: string;
  invocationId?: string;
  caller: { type: CapabilityCallerType; ref?: string };
  subject: CapabilitySubjectInput;
  parameters?: JsonObject;
  context?: JsonObject;
  mode?: CapabilityInvocationMode;
}

export interface CanonicalSubjectReference {
  kind: 'property' | 'research_session';
  id: string;
  propertyCardId?: number;
  dealCardId?: number;
  temporary: boolean;
}

export interface CapabilityEvidenceReference {
  id?: string;
  source: string;
  sourceUrl?: string | null;
  sourceType?: string | null;
  retrievedAt: string;
  details?: JsonObject;
}

export interface CapabilityResult<TFacts extends JsonObject = JsonObject> {
  invocationId: string;
  capability: CapabilityMetadata;
  status: CapabilityRunStatus;
  subjectResolution: SubjectResolutionState;
  canonicalSubject: CanonicalSubjectReference | null;
  facts: TFacts;
  evidence: CapabilityEvidenceReference[];
  warnings: string[];
  missingInformation: string[];
  timestamps: { startedAt: string; completedAt: string };
  execution: {
    mode: CapabilityInvocationMode;
    durationMs: number;
    reused: boolean;
    reusedFromInvocationId?: string;
  };
}

export interface CapabilityExecutionOutcome<TFacts extends JsonObject = JsonObject> {
  status: CapabilityRunStatus;
  subjectResolution: SubjectResolutionState;
  canonicalSubject: CanonicalSubjectReference | null;
  facts: TFacts;
  evidence?: CapabilityEvidenceReference[];
  warnings?: string[];
  missingInformation?: string[];
}

export interface CapabilityExecutionEnvironment {
  invocationId: string;
  researchSessionId: string | null;
  startedAt: string;
}

export interface LandosCapability<TFacts extends JsonObject = JsonObject, TRuntime = unknown> {
  metadata: CapabilityMetadata;
  validate(request: CapabilityInvocationRequest): void;
  execute(
    request: CapabilityInvocationRequest,
    runtime: TRuntime,
    environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<TFacts>>;
}

export interface CapabilityInvocationPersistence {
  findReusable(capabilityId: string, idempotencyKey: string): CapabilityResult | null;
  begin(input: {
    request: CapabilityInvocationRequest;
    metadata: CapabilityMetadata;
    invocationId: string;
    idempotencyKey: string;
    startedAt: string;
  }): { started: true; researchSessionId: string | null } | { started: false; existingInvocationId: string };
  waitForResult(invocationId: string): Promise<CapabilityResult>;
  complete(request: CapabilityInvocationRequest, result: CapabilityResult): CapabilityResult;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function capabilityIdempotencyKey(request: CapabilityInvocationRequest): string {
  const canonical = stable({
    capabilityId: request.capabilityId,
    caller: request.caller,
    subject: request.subject,
    parameters: request.parameters ?? {},
    context: request.context ?? {},
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function validateInvocationEnvelope(request: CapabilityInvocationRequest): void {
  if (!request.capabilityId.trim()) throw new Error('capabilityId is required');
  if (!['tools', 'new_lead', 'deal_card', 'internal_workflow'].includes(request.caller.type)) {
    throw new Error(`unsupported capability caller ${String(request.caller.type)}`);
  }
  if (request.subject.kind === 'raw_property' && !request.subject.rawInput.trim()) {
    throw new Error('raw property input is required');
  }
  if (request.subject.kind === 'raw_property' && request.subject.target
      && (!Number.isInteger(request.subject.target.propertyCardId) || request.subject.target.propertyCardId < 1
        || !Number.isInteger(request.subject.target.dealCardId) || request.subject.target.dealCardId < 1)) {
    throw new Error('raw property target IDs must be positive integers');
  }
  if (request.subject.kind === 'canonical_property'
      && (!Number.isInteger(request.subject.propertyCardId) || request.subject.propertyCardId < 1)) {
    throw new Error('canonical propertyCardId must be a positive integer');
  }
}

export async function invokeCapabilityDefinition<TFacts extends JsonObject, TRuntime>(input: {
  definition: LandosCapability<TFacts, TRuntime>;
  request: CapabilityInvocationRequest;
  runtime: TRuntime;
  persistence: CapabilityInvocationPersistence;
  now?: () => Date;
}): Promise<CapabilityResult<TFacts>> {
  const { definition, request, persistence } = input;
  validateInvocationEnvelope(request);
  if (request.capabilityId !== definition.metadata.id) {
    throw new Error(`capability ${request.capabilityId} is not ${definition.metadata.id}`);
  }
  definition.validate(request);

  const mode = request.mode ?? 'reuse';
  const baseKey = capabilityIdempotencyKey(request);
  if (mode === 'reuse') {
    const reusable = persistence.findReusable(definition.metadata.id, baseKey) as CapabilityResult<TFacts> | null;
    if (reusable) {
      return {
        ...reusable,
        execution: {
          ...reusable.execution,
          reused: true,
          reusedFromInvocationId: reusable.invocationId,
        },
      };
    }
  }

  const invocationId = request.invocationId?.trim() || `cap_${randomUUID()}`;
  const idempotencyKey = mode === 'refresh' ? `${baseKey}:${invocationId}` : baseKey;
  const startedAt = (input.now?.() ?? new Date()).toISOString();
  const prepared = persistence.begin({ request: { ...request, mode }, metadata: definition.metadata, invocationId, idempotencyKey, startedAt });
  if (!prepared.started) {
    const reusable = await persistence.waitForResult(prepared.existingInvocationId) as CapabilityResult<TFacts>;
    return {
      ...reusable,
      execution: {
        ...reusable.execution,
        reused: true,
        reusedFromInvocationId: reusable.invocationId,
      },
    };
  }
  const startedMs = Date.parse(startedAt);

  let outcome: CapabilityExecutionOutcome<TFacts>;
  try {
    outcome = await definition.execute(
      { ...request, mode },
      input.runtime,
      { invocationId, researchSessionId: prepared.researchSessionId, startedAt },
    );
  } catch (error) {
    outcome = {
      status: 'FAILED',
      subjectResolution: 'ERROR',
      canonicalSubject: null,
      facts: {} as TFacts,
      evidence: [],
      warnings: [error instanceof Error ? error.message : String(error)],
      missingInformation: [],
    };
  }

  const completedAt = (input.now?.() ?? new Date()).toISOString();
  const completedMs = Date.parse(completedAt);
  const result: CapabilityResult<TFacts> = {
    invocationId,
    capability: definition.metadata,
    status: outcome.status,
    subjectResolution: outcome.subjectResolution,
    canonicalSubject: outcome.canonicalSubject,
    facts: outcome.facts,
    evidence: outcome.evidence ?? [],
    warnings: outcome.warnings ?? [],
    missingInformation: outcome.missingInformation ?? [],
    timestamps: { startedAt, completedAt },
    execution: {
      mode,
      durationMs: Number.isFinite(completedMs - startedMs) ? Math.max(0, completedMs - startedMs) : 0,
      reused: false,
    },
  };
  return persistence.complete({ ...request, mode }, result) as CapabilityResult<TFacts>;
}
