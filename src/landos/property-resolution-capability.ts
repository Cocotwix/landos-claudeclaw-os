import type {
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  JsonObject,
  LandosCapability,
  SubjectResolutionState,
} from './capability-contract.js';
import { getLandosDb, type LandosEntity } from './db.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { classifySmartIntake } from './intake-router.js';
import { extractParcelNotations } from './parcel-notation.js';
import { apnIdentifiersCorroborate } from './property-resolution-engine.js';
import {
  applyLaneEvidence,
  evaluateResolverIdentity,
  readResolverSubject,
  reconcileResolverIdentityPatch,
  resolveSubjectProperty,
  type ResolveSubjectPropertyOptions,
  type ResolverIdentityPatch,
  type ResolverSubject,
  type UniversalResolutionResult,
} from './universal-property-resolution.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';

export const PROPERTY_RESOLUTION_CAPABILITY_ID = 'property-resolution';

export type PropertyResolutionFacts = JsonObject & {
  resolutionStatus: SubjectResolutionState;
  released: boolean;
  identityState: string;
  identityBasis: string;
  winner: string | null;
  canonicalIdentity: JsonObject;
  aliases: string[];
  candidates: JsonObject[];
  lanes: JsonObject[];
};

export interface PropertyResolutionRuntime {
  universalOptions?: ResolveSubjectPropertyOptions;
  onUniversalResult?: (result: UniversalResolutionResult) => void;
}

function rawSubject(rawInput: string, entity: LandosEntity): ResolverSubject {
  const fields = classifySmartIntake(rawInput).parsedFields;
  const coordinateMatch = rawInput.match(/(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/);
  return {
    dealCardId: 0,
    propertyCardId: null,
    entity,
    address: fields.address?.trim() || rawInput.trim(),
    city: fields.city?.trim() || null,
    county: fields.county?.trim() || null,
    state: fields.state?.trim() || null,
    zip: fields.zip?.trim() || null,
    apn: fields.apn?.trim() || null,
    owner: fields.owner?.trim() || null,
    acres: null,
    fips: fields.fips?.trim() || null,
    lpPropertyId: fields.propertyId?.trim() || null,
    lat: coordinateMatch ? Number(coordinateMatch[1]) : null,
    lng: coordinateMatch ? Number(coordinateMatch[2]) : null,
    verified: false,
    verificationSource: null,
    notations: extractParcelNotations(rawInput),
    rawIntake: rawInput,
  };
}

function resolveExistingProperty(subject: UniversalResolutionResult['subject'], entity: LandosEntity): number | null {
  if (!subject.apn && !(subject.lpPropertyId && subject.fips)) return null;
  const rows = getLandosDb().prepare(`
    SELECT id, entity, apn, county, state, fips, lp_property_id
    FROM landos_property_card
    WHERE entity = ? AND verification_status = 'verified_property'
  `).all(entity) as Array<{ id: number; entity: LandosEntity; apn: string; county: string; state: string; fips: string; lp_property_id: string }>;
  const county = (subject.county ?? '').toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z]/g, '');
  const state = (subject.state ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const exact = rows.filter((row) => {
    if (subject.lpPropertyId && subject.fips
        && row.lp_property_id === subject.lpPropertyId && row.fips === subject.fips) return true;
    if (!subject.apn || !row.apn || !apnIdentifiersCorroborate(subject.apn, row.apn)) return false;
    const rowCounty = row.county.toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z]/g, '');
    const rowState = row.state.toLowerCase().replace(/[^a-z]/g, '');
    return (!!county && rowCounty === county) || (!!state && rowState === state);
  });
  return exact.length === 1 ? exact[0].id : null;
}

async function resolveRaw(
  rawInput: string,
  entity: LandosEntity,
  runtime: PropertyResolutionRuntime,
): Promise<UniversalResolutionResult> {
  let subject = rawSubject(rawInput, entity);
  const options = runtime.universalOptions ?? {};
  return resolveSubjectProperty(0, {
    ...options,
    actor: options.actor ?? 'capability:property-resolution:tools',
    readSubject: () => subject,
    evaluate: options.evaluate ?? evaluateResolverIdentity,
    applyEvidence: (current, patch: ResolverIdentityPatch | null | undefined, actor) => {
      const reconciled = reconcileResolverIdentityPatch(current, patch, actor);
      subject = reconciled.subject;
      return { applied: reconciled.applied, refusedFor: reconciled.refusedFor, warnings: reconciled.warnings };
    },
    promote: async () => undefined,
    enrichAfterRelease: false,
    documentEnrichment: false,
  });
}

function statusOf(result: UniversalResolutionResult): SubjectResolutionState {
  if (result.status === 'resolved' && result.released) return 'RESOLVED';
  if (result.status === 'ambiguous' || result.status === 'conflicted') return 'AMBIGUOUS';
  return 'UNRESOLVED';
}

function missingInformation(result: UniversalResolutionResult): string[] {
  const subject = result.subject;
  const missing: string[] = [];
  if (!subject.apn && !subject.lpPropertyId) missing.push('A parcel identifier from an official parcel source');
  if (!subject.county && !subject.fips) missing.push('County or county FIPS');
  if (!subject.state) missing.push('State');
  if (result.status === 'ambiguous') missing.push('Operator selection or another identifier that distinguishes the candidates');
  return missing;
}

function factsOf(result: UniversalResolutionResult, resolutionStatus: SubjectResolutionState): PropertyResolutionFacts {
  return {
    resolutionStatus,
    released: result.released,
    identityState: result.identityState,
    identityBasis: result.discoveryBasis,
    winner: result.winner,
    canonicalIdentity: {
      propertyCardId: result.subject.propertyCardId,
      address: result.subject.address,
      apn: result.subject.apn,
      county: result.subject.county,
      state: result.subject.state,
      city: result.subject.city,
      zip: result.subject.zip,
      owner: result.subject.owner,
      acres: result.subject.acres,
      fips: result.subject.fips,
      landPortalPropertyId: result.subject.lpPropertyId,
      parcelNotations: result.subject.parcelNotations.map((notation) => notation.raw),
    },
    aliases: result.subject.parcelNotations.map((notation) => notation.raw),
    candidates: result.ambiguousCandidates.map((candidate) => ({
      address: candidate.address ?? null,
      apn: candidate.apn ?? null,
      county: candidate.county ?? null,
      state: candidate.state ?? null,
      city: candidate.city ?? null,
      owner: candidate.owner ?? null,
      acres: candidate.acres ?? null,
    })),
    lanes: result.lanes.map((lane) => ({
      id: lane.lane,
      status: lane.status,
      note: lane.note,
      applied: lane.applied,
      won: lane.won,
      source: lane.source?.label ?? null,
      sourceUrl: lane.source?.url ?? null,
      startedAtMs: lane.startedAtMs,
      settledAtMs: lane.settledAtMs,
    })),
  };
}

export const PROPERTY_RESOLUTION_CAPABILITY: LandosCapability<PropertyResolutionFacts, PropertyResolutionRuntime> = {
  metadata: {
    id: PROPERTY_RESOLUTION_CAPABILITY_ID,
    name: 'Property Resolution',
    contractVersion: '1.0',
    description: 'Establishes one canonical LandOS property subject before property research can fan out.',
  },
  validate(request: CapabilityInvocationRequest): void {
    if (request.parameters && Object.keys(request.parameters).length > 0) {
      throw new Error('Property Resolution does not accept caller-supplied evidence, confidence, or identity overrides');
    }
    const reserved = /^(?:evidence|confidence|certainty|identity|canonicalSubject|canonical_subject)$/i;
    const containsReservedAssertion = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(containsReservedAssertion);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => reserved.test(key) || containsReservedAssertion(child));
    };
    if (containsReservedAssertion(request.context ?? {})) {
      throw new Error('Property Resolution context cannot contain caller-supplied evidence, confidence, or identity assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: PropertyResolutionRuntime,
    environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<PropertyResolutionFacts>> {
    let universal: UniversalResolutionResult;
    let dealCardId: number | undefined;
    let propertyCardId: number | undefined;
    const transitionWarnings: string[] = [];
    if (request.subject.kind === 'canonical_property') {
      propertyCardId = request.subject.propertyCardId;
      dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId);
      if (!dealCardId) throw new Error(`canonical property ${propertyCardId} is not linked to a Deal Card`);
      const retained = readResolverSubject(dealCardId);
      if (!retained || retained.propertyCardId !== propertyCardId || retained.entity !== request.subject.entity) {
        throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
      }
      universal = await resolveSubjectProperty(dealCardId, runtime.universalOptions ?? {});
    } else {
      universal = await resolveRaw(request.subject.rawInput, request.subject.entity, runtime);
      if (request.subject.target) {
        dealCardId = request.subject.target.dealCardId;
        propertyCardId = request.subject.target.propertyCardId;
        const retained = readResolverSubject(dealCardId);
        if (!retained || retained.propertyCardId !== propertyCardId || retained.entity !== request.subject.entity) {
          throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
        }
        if (universal.status === 'resolved' && universal.released) {
          const applied = applyLaneEvidence(retained, {
            apn: universal.subject.apn,
            county: universal.subject.county,
            state: universal.subject.state,
            city: universal.subject.city,
            zip: universal.subject.zip,
            owner: universal.subject.owner,
            acres: universal.subject.acres,
            fips: universal.subject.fips,
            lpPropertyId: universal.subject.lpPropertyId,
            verified: universal.subject.verified,
            verificationSource: universal.subject.verificationSource,
          }, `capability:property-resolution:raw-target:${environment.invocationId}`);
          if (applied.refusedFor.length) {
            transitionWarnings.push(...applied.refusedFor);
            const retainedEvaluation = evaluateResolverIdentity(retained);
            universal = retainedEvaluation.sufficient
              ? await resolveSubjectProperty(dealCardId, { actor: `capability:property-resolution:retained:${environment.invocationId}`, documentEnrichment: false })
              : { ...universal, status: 'conflicted', released: false, conflicts: [...universal.conflicts, ...applied.refusedFor] };
          } else {
            await reconcileSubjectIdentity(dealCardId, {
              actor: `capability:property-resolution:${environment.invocationId}`,
              censusGeography: null,
            });
            universal = await resolveSubjectProperty(dealCardId, {
              actor: `capability:property-resolution:canonical:${environment.invocationId}`,
              documentEnrichment: false,
            });
          }
        }
      }
    }
    runtime.onUniversalResult?.(universal);

    const subjectResolution = statusOf(universal);
    const existingPropertyId = request.subject.kind === 'raw_property'
      ? request.subject.target?.propertyCardId ?? resolveExistingProperty(universal.subject, request.subject.entity)
      : propertyCardId ?? null;
    const canonicalSubject = existingPropertyId
      ? {
          kind: 'property' as const,
          id: String(existingPropertyId),
          propertyCardId: existingPropertyId,
          ...(dealCardId ? { dealCardId } : {}),
          temporary: false,
        }
      : environment.researchSessionId
        ? { kind: 'research_session' as const, id: environment.researchSessionId, temporary: true }
        : null;
    const evidence = universal.subject.sourceEvidence.map((source) => ({
      source: source.label,
      sourceUrl: source.url,
      sourceType: source.officiality,
      retrievedAt: new Date().toISOString(),
      details: { lane: source.lane },
    }));

    return {
      status: subjectResolution === 'RESOLVED' ? 'SUCCEEDED' : 'NEEDS_INPUT',
      subjectResolution,
      canonicalSubject,
      facts: factsOf(universal, subjectResolution),
      evidence,
      warnings: [...transitionWarnings, ...universal.conflicts, ...universal.notes],
      missingInformation: missingInformation(universal),
    };
  },
};
