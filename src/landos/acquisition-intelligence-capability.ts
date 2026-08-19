// LandOS — the Acquisition Intelligence Capability.
//
// The system-wide capability that sits ABOVE the research capabilities. Tools,
// the Deal Card and any internal workflow reach one implementation through the
// same contract every other LandOS capability uses.
//
// What this capability is:
//
//   assemble the canonical property file  →  reconcile it  →  have the
//   Acquisition Analyst reason over it  →  persist ONE structured read.
//
// What it deliberately is not:
//
//   • It is not research. It launches no lane, opens no browser, and touches no
//     provider. Its whole input is what LandOS already established. When it
//     finds an unanswered question that matters, it returns the question and
//     the next action — it does not go and answer it.
//   • It is not an authority. Identity, zoning, valuation, comps and evidence
//     remain owned by the capabilities that produced them. A judgment here can
//     never rewrite a fact there.
//   • It is not tied to a model. The runtime engine arrives through the
//     injected analyst; nothing in this file knows which model reasoned.
//
// Reuse vs refresh follows the capability contract: opening a Deal Card reads
// the persisted result, and only an explicit refresh invokes the analyst.

import type {
  CanonicalSubjectReference,
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  CapabilityResult,
  JsonObject,
  JsonValue,
  LandosCapability,
  SubjectResolutionState,
} from './capability-contract.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import {
  buildAcquisitionDossier,
  type AcquisitionDossier,
  type PropertyFileSource,
} from './acquisition-intelligence-dossier.js';
import {
  normalizeAcquisitionIntelligence,
  type AcquisitionIntelligenceResult,
} from './acquisition-intelligence-contract.js';
import { dossierFingerprint, type AcquisitionAnalyst } from './acquisition-analyst.js';
import {
  persistAcquisitionIntelligence,
  readAcquisitionIntelligence,
} from './acquisition-intelligence-store.js';

export const ACQUISITION_INTELLIGENCE_CAPABILITY_ID = 'acquisition-intelligence';

export type AcquisitionIntelligenceOutcome =
  | 'read_produced'
  | 'retained_read'
  | 'analyst_unavailable'
  | 'insufficient_property_file'
  | 'not_available';

/**
 * The property file is not required to be complete — an operator asks "what do
 * you see" long before every lane has landed. It IS required to identify a
 * parcel, because a judgment about an unidentified property is a judgment about
 * nothing.
 */
export function propertyFileIsSufficient(dossier: AcquisitionDossier): { ok: boolean; reason: string | null } {
  if (!dossier.identity.confirmed) {
    return {
      ok: false,
      reason: 'Parcel identity is not confirmed for this Deal Card, so there is no established subject to read.',
    };
  }
  if (dossier.coverage.present.length < 2) {
    return {
      ok: false,
      reason: 'Almost nothing has been established about this property yet; run the research capabilities before asking for an acquisitions read.',
    };
  }
  return { ok: true, reason: null };
}

export interface AcquisitionIntelligenceFacts extends JsonObject {
  outcome: AcquisitionIntelligenceOutcome;
  headline: string | null;
  /** The full structured read. Typed as JSON at this boundary because the
   *  capability envelope carries JSON facts; the shape is
   *  `AcquisitionIntelligenceResult`. */
  read: JsonValue;
  dossierFingerprint: string | null;
  /** True when the retained read was formed from an older property file. */
  stale: boolean;
  coverage: { present: string[]; absent: string[] };
  conflictCount: number;
  strategyCount: number;
  summary: string;
}

export interface AcquisitionIntelligenceRuntimeDeps {
  /** Raw operator input resolves through Property Resolution, never here. */
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /** Read the complete canonical property file for one Deal Card. The route
   *  layer owns this: the capability owns the question, not the plumbing. */
  readPropertyFile?: (dealCardId: number) => PropertyFileSource | null;
  /** The reasoning executor. Injected so the capability never imports one. */
  analyst?: AcquisitionAnalyst;
  now?: () => Date;
}

function canonicalSubjectFrom(request: CapabilityInvocationRequest): {
  subject: CanonicalSubjectReference | null;
  resolution: SubjectResolutionState;
} {
  if (request.subject.kind !== 'canonical_property') return { subject: null, resolution: 'UNRESOLVED' };
  const propertyCardId = request.subject.propertyCardId;
  const dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId) ?? undefined;
  return {
    subject: {
      kind: 'property',
      id: String(propertyCardId),
      propertyCardId,
      dealCardId,
      temporary: false,
    },
    resolution: 'RESOLVED',
  };
}

function facts(input: Partial<AcquisitionIntelligenceFacts> & { outcome: AcquisitionIntelligenceOutcome; summary: string }): AcquisitionIntelligenceFacts {
  return {
    outcome: input.outcome,
    headline: input.headline ?? null,
    read: input.read ?? null,
    dossierFingerprint: input.dossierFingerprint ?? null,
    stale: input.stale ?? false,
    coverage: input.coverage ?? { present: [], absent: [] },
    conflictCount: input.conflictCount ?? 0,
    strategyCount: input.strategyCount ?? 0,
    summary: input.summary,
  } as AcquisitionIntelligenceFacts;
}

function evidenceFor(result: AcquisitionIntelligenceResult): CapabilityEvidenceReference[] {
  return [{
    source: `${result.runtime.agentProfile} (${result.runtime.engine} · ${result.runtime.provider}/${result.runtime.model})`,
    sourceType: 'landos_acquisition_judgment',
    retrievedAt: result.generatedAt,
    details: {
      dossierFingerprint: result.dossierFingerprint,
      visualsInspected: result.visualObservations.map((observation) => observation.visual),
      // A judgment is never a property fact, and saying so travels with it.
      note: 'Derived acquisitions judgment over already-established LandOS evidence. It establishes no property fact.',
    },
  }];
}

export const ACQUISITION_INTELLIGENCE_CAPABILITY: LandosCapability<AcquisitionIntelligenceFacts, AcquisitionIntelligenceRuntimeDeps> = {
  metadata: {
    id: ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
    name: 'Acquisition Intelligence',
    contractVersion: '1.0.0',
    description:
      'Reads the complete canonical property file together and returns one structured acquisitions judgment: what this property is, what matters, which strategies fit, what conflicts, what is unknown, and what to do next.',
  },

  validate(request) {
    if (request.subject.kind === 'canonical_property' && request.subject.dealCardId != null
      && (!Number.isInteger(request.subject.dealCardId) || request.subject.dealCardId < 1)) {
      throw new Error('dealCardId must be a positive integer');
    }
  },

  async execute(request, runtime, _environment: CapabilityExecutionEnvironment): Promise<CapabilityExecutionOutcome<AcquisitionIntelligenceFacts>> {
    // Raw operator input is resolved by Property Resolution. This capability
    // never decides which parcel the subject is.
    let effective = request;
    if (request.subject.kind === 'raw_property') {
      if (!runtime.resolveSubject) {
        return {
          status: 'NEEDS_INPUT',
          subjectResolution: 'UNRESOLVED',
          canonicalSubject: null,
          facts: facts({ outcome: 'not_available', summary: 'Raw property input needs the Property Resolution Capability, which was not available here.' }),
          missingInformation: [`Invoke ${PROPERTY_RESOLUTION_CAPABILITY_ID} first, or call this capability with a canonical property.`],
        };
      }
      const resolved = await runtime.resolveSubject(request);
      const propertyCardId = resolved.canonicalSubject?.propertyCardId;
      if (resolved.subjectResolution !== 'RESOLVED' || !propertyCardId) {
        return {
          status: 'NEEDS_INPUT',
          subjectResolution: resolved.subjectResolution,
          canonicalSubject: resolved.canonicalSubject,
          facts: facts({ outcome: 'not_available', summary: 'The subject property could not be resolved, so no acquisitions read was attempted.' }),
          missingInformation: resolved.missingInformation,
          warnings: resolved.warnings,
        };
      }
      effective = {
        ...request,
        subject: {
          kind: 'canonical_property',
          entity: request.subject.entity,
          propertyCardId,
          dealCardId: resolved.canonicalSubject?.dealCardId,
        },
      };
    }

    const { subject, resolution } = canonicalSubjectFrom(effective);
    const dealCardId = subject?.dealCardId ?? null;
    if (!subject || dealCardId == null) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution: resolution,
        canonicalSubject: subject,
        facts: facts({ outcome: 'not_available', summary: 'This capability needs a canonical property attached to a Deal Card.' }),
        missingInformation: ['A Deal Card for the subject property.'],
      };
    }

    const retained = readAcquisitionIntelligence(dealCardId);
    const source = runtime.readPropertyFile?.(dealCardId) ?? null;

    // Without the property file there is nothing to reason over — but a read
    // already produced is still the operator's answer, so it is returned.
    if (!source) {
      return retained
        ? {
          status: 'SUCCEEDED',
          subjectResolution: resolution,
          canonicalSubject: subject,
          facts: facts({
            outcome: 'retained_read',
            headline: retained.dealRead.headline,
            read: retained as unknown as JsonValue,
            dossierFingerprint: retained.dossierFingerprint,
            coverage: { present: retained.basis.coveragePresent, absent: retained.basis.coverageAbsent },
            conflictCount: retained.conflicts.length,
            strategyCount: retained.strategies.length,
            summary: retained.dealRead.headline,
          }),
          evidence: evidenceFor(retained),
        }
        : {
          status: 'NEEDS_INPUT',
          subjectResolution: resolution,
          canonicalSubject: subject,
          facts: facts({ outcome: 'not_available', summary: 'No canonical property file is available for this Deal Card.' }),
          missingInformation: ['The canonical property-intelligence record for this Deal Card.'],
        };
    }

    const dossier = buildAcquisitionDossier({ ...source, dealCardId, now: runtime.now });
    const fingerprint = dossierFingerprint(dossier);

    // Reuse: the retained read still describes the current property file.
    if (effective.mode !== 'refresh' && retained) {
      return {
        status: 'SUCCEEDED',
        subjectResolution: resolution,
        canonicalSubject: subject,
        facts: facts({
          outcome: 'retained_read',
          headline: retained.dealRead.headline,
          read: retained as unknown as JsonValue,
          dossierFingerprint: retained.dossierFingerprint,
          stale: retained.dossierFingerprint !== fingerprint,
          coverage: { present: dossier.coverage.present, absent: dossier.coverage.absent },
          conflictCount: retained.conflicts.length,
          strategyCount: retained.strategies.length,
          summary: retained.dealRead.headline,
        }),
        evidence: evidenceFor(retained),
        warnings: retained.dossierFingerprint !== fingerprint
          ? ['New property evidence has landed since this read was produced. Refresh it to reason over the current file.']
          : [],
      };
    }

    const sufficiency = propertyFileIsSufficient(dossier);
    if (!sufficiency.ok) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution: resolution,
        canonicalSubject: subject,
        facts: facts({
          outcome: 'insufficient_property_file',
          dossierFingerprint: fingerprint,
          coverage: { present: dossier.coverage.present, absent: dossier.coverage.absent },
          summary: sufficiency.reason ?? 'The property file is not yet sufficient for an acquisitions read.',
        }),
        missingInformation: [sufficiency.reason ?? 'A confirmed parcel identity and at least some established research.'],
      };
    }

    if (!runtime.analyst) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution: resolution,
        canonicalSubject: subject,
        facts: facts({
          outcome: 'analyst_unavailable',
          dossierFingerprint: fingerprint,
          coverage: { present: dossier.coverage.present, absent: dossier.coverage.absent },
          summary: 'The Acquisition Analyst is not available in this runtime.',
        }),
        missingInformation: ['A configured Acquisition Analyst runtime.'],
      };
    }

    let run;
    try {
      run = await runtime.analyst.run({
        dossier,
        requestedProvider: typeof effective.parameters?.provider === 'string' ? effective.parameters.provider : null,
        requestedModel: typeof effective.parameters?.model === 'string' ? effective.parameters.model : null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error);
      return {
        status: 'FAILED',
        subjectResolution: resolution,
        canonicalSubject: subject,
        facts: facts({
          outcome: 'analyst_unavailable',
          dossierFingerprint: fingerprint,
          coverage: { present: dossier.coverage.present, absent: dossier.coverage.absent },
          summary: `The Acquisition Analyst could not complete this read: ${detail}`,
        }),
        warnings: [detail],
      };
    }

    const normalized = normalizeAcquisitionIntelligence({
      raw: run.raw,
      dealCardId,
      runtime: run.runtime,
      dossierFingerprint: fingerprint,
      allowedVisualKeys: dossier.visuals.map((visual) => visual.key),
      landosConflicts: dossier.conflicts.map((conflict) => ({
        subject: conflict.subject,
        statement: conflict.statement,
        resolution: conflict.resolution === 'resolved' ? conflict.reason : `Unresolved. ${conflict.reason} ${conflict.decisionAtRisk}`.trim(),
      })),
      coveragePresent: dossier.coverage.present,
      coverageAbsent: dossier.coverage.absent,
      now: runtime.now,
    });

    if (!normalized.ok) {
      return {
        status: 'FAILED',
        subjectResolution: resolution,
        canonicalSubject: subject,
        facts: facts({
          outcome: 'analyst_unavailable',
          dossierFingerprint: fingerprint,
          coverage: { present: dossier.coverage.present, absent: dossier.coverage.absent },
          summary: normalized.reason,
        }),
        warnings: [normalized.reason, ...run.warnings],
      };
    }

    // The analyst's own per-image observations are the floor: whatever the
    // judgment pass did or did not cite, what was actually seen is retained.
    const result: AcquisitionIntelligenceResult = {
      ...normalized.result,
      visualObservations: mergeObservations(normalized.result.visualObservations, run.observations),
      warnings: [...normalized.result.warnings, ...run.warnings],
    };

    const persisted = persistAcquisitionIntelligence({ dealCardId, result });

    return {
      status: 'SUCCEEDED',
      subjectResolution: resolution,
      canonicalSubject: subject,
      facts: facts({
        outcome: 'read_produced',
        headline: result.dealRead.headline,
        read: result as unknown as JsonValue,
        dossierFingerprint: fingerprint,
        coverage: { present: dossier.coverage.present, absent: dossier.coverage.absent },
        conflictCount: result.conflicts.length,
        strategyCount: result.strategies.length,
        summary: result.dealRead.headline,
      }),
      evidence: evidenceFor(result),
      warnings: [
        ...result.warnings,
        ...(persisted.skippedReason ? [`The read was produced but not persisted: ${persisted.skippedReason}`] : []),
      ],
      missingInformation: result.unknowns.map((unknown) => unknown.question),
    };
  },
};

/** Observations the analyst reported, plus every image it actually inspected. */
function mergeObservations(
  cited: AcquisitionIntelligenceResult['visualObservations'],
  inspected: Array<{ visual: string; observation: string; basis: string }>,
): AcquisitionIntelligenceResult['visualObservations'] {
  const merged = [...cited];
  for (const observation of inspected) {
    if (merged.some((existing) => existing.visual === observation.visual)) continue;
    merged.push({ visual: observation.visual, observation: observation.observation, basis: observation.basis });
  }
  return merged;
}
