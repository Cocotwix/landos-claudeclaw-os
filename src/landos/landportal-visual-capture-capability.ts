// LandOS — LandPortal Visual Capture Capability.
//
// Tool 2 of the LandPortal three-tool split: "What does this subject property
// and its surrounding context LOOK like?" It is independent of Property
// Characteristics: it ensures its own authenticated session, performs the
// visual page preflight and blocking-overlay dismissal (both built into the
// one-pass capture engine), verifies the canonical subject by APN, retains the
// existing subject captures (close/clean aerials, wider + surrounding context,
// road frontage, wetlands/FEMA/soil/contour overlays, front/rear 3D) and adds
// the ZIP / city / county BOUNDARY-CONTEXT captures. A boundary LandPortal
// does not expose is reported unavailable honestly, never manufactured.
// It never enters comp-search mode.
//
// Engine: `driver.captureLandPortalVisuals` (browser-session.ts), reused
// verbatim; the boundary frames ride the same overlay-dialog machinery.

import type {
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  JsonObject,
  LandosCapability,
} from './capability-contract.js';
import { apnIdentifiersEquivalent } from './landportal-capability.js';
import { BOUNDARY_CONTEXT_PLAN } from './parcel-visual-framing.js';
import {
  assertNoCallerAssertions,
  resolveLandPortalToolSubject,
  subjectCanonicalParcelUrl,
  type LandPortalToolSubjectRuntime,
} from './landportal-tool-subject.js';
import { savePropertyInspection, type PendingPropertyInspectionRecord } from './property-card.js';

export const LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID = 'landportal-visual-capture';

const DEFAULT_TIMEOUT_MS = 420_000;

/** The full visual set this tool attempts, in capture order. */
export const VISUAL_CAPTURE_LABELS = [
  'close_parcel_aerial', 'clean_parcel_aerial', 'wider_context', 'surrounding_area_aerial',
  'road_frontage_aerial',
  'wetlands_overlay', 'fema_flood_overlay', 'soil_overlay', 'contour_terrain_view',
  'front_side_3d', 'rear_side_3d',
  'zip_boundary_context', 'city_boundary_context', 'county_boundary_context',
] as const;

export interface LandPortalVisualCaptureResult {
  fields: Record<string, string>;
  visualShots?: Array<{
    label: string;
    path: string;
    kind: 'parcel_page' | 'overlay' | 'parcel_3d';
    purpose: string;
    overlay?: string;
    soilDetails?: Array<{ symbol: string | null; name: string | null; fields: Record<string, string> }>;
  }>;
  overlayMisses?: Array<{ overlay: string; reason: string }>;
  capturedAtIso: string;
}

export interface LandPortalVisualCaptureRuntime extends LandPortalToolSubjectRuntime {
  /** The live one-pass capture (route layer injects the real driver call). */
  captureVisuals?: (url: string, opts: { timeoutMs: number; captureLabels: string[] }) => Promise<LandPortalVisualCaptureResult>;
  persistInspection?: (cardId: number, record: PendingPropertyInspectionRecord) => void;
  timeoutMs?: number;
}

export type BoundaryContextOutcome = {
  label: string;
  boundary: string;
  status: 'captured' | 'unavailable';
  reason: string | null;
};

export type LandPortalVisualCaptureFacts = JsonObject & {
  executed: boolean;
  outcome: 'visuals_captured' | 'auth_needed' | 'subject_mismatch' | 'not_available';
  parcelUrl: string | null;
  capturedLabels: string[];
  missingLabels: string[];
  boundaryContexts: BoundaryContextOutcome[];
  overlayMisses: Array<{ overlay: string; reason: string }>;
  persisted: boolean;
  summary: string;
};

export const LANDPORTAL_VISUAL_CAPTURE_CAPABILITY: LandosCapability<
  LandPortalVisualCaptureFacts,
  LandPortalVisualCaptureRuntime
> = {
  metadata: {
    id: LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID,
    name: 'LandPortal Visual Capture',
    contractVersion: '1.0',
    description: 'Captures the canonical subject\'s LandPortal imagery through its own authenticated run: close/clean/wider aerials, surrounding-area context, road frontage, thematic overlays, 3D views, and the subject\'s position inside its ZIP, city and county boundaries. Never enters comp-search mode.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['timeoutMs', 'captureLabels']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`LandPortal Visual Capture does not accept caller-supplied ${unsupported.join(', ')}`);
    }
    const labels = request.parameters?.captureLabels;
    if (labels != null && (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string'))) {
      throw new Error('captureLabels must be a list of capture label strings');
    }
    assertNoCallerAssertions(request.context as Record<string, unknown> | undefined, 'LandPortal Visual Capture');
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: LandPortalVisualCaptureRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<LandPortalVisualCaptureFacts>> {
    const resolved = await resolveLandPortalToolSubject(request, runtime);
    const { subject, canonicalSubject, warnings } = resolved;
    let { subjectResolution } = resolved;
    const evidence: CapabilityEvidenceReference[] = [...resolved.resolutionEvidence];
    const emptyFacts = (outcome: LandPortalVisualCaptureFacts['outcome'], summary: string): LandPortalVisualCaptureFacts => ({
      executed: false,
      outcome,
      parcelUrl: null,
      capturedLabels: [],
      missingLabels: [],
      boundaryContexts: [],
      overlayMisses: [],
      persisted: false,
      summary,
    });

    if (subjectResolution !== 'RESOLVED') {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts('not_available', 'Visual Capture did not run: no released canonical parcel for this input.'),
        evidence,
        warnings,
        missingInformation: resolved.missingInformation.length ? resolved.missingInformation : ['One canonical parcel from Property Resolution'],
      };
    }
    const parcelUrl = subjectCanonicalParcelUrl(subject);
    if (!parcelUrl || !runtime.captureVisuals) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts('not_available', !parcelUrl
          ? 'No canonical LandPortal parcel URL exists for this subject.'
          : 'The authenticated LandPortal capture engine is not available in this environment.'),
        evidence,
        warnings,
        missingInformation: [!parcelUrl ? 'A retained LandPortal parcel identity for this subject' : 'An authenticated LandPortal browser session'],
      };
    }

    const requested = Array.isArray(request.parameters?.captureLabels) && request.parameters.captureLabels.length
      ? (request.parameters.captureLabels as string[])
      : [...VISUAL_CAPTURE_LABELS];
    const capture = await runtime.captureVisuals(parcelUrl, {
      timeoutMs: runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      captureLabels: requested,
    });
    const shots = capture.visualShots ?? [];
    const overlayMisses = capture.overlayMisses ?? [];
    const panelApn = capture.fields?.['Parcel ID'] ?? null;

    if (!shots.length && !Object.keys(capture.fields ?? {}).length) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: {
          ...emptyFacts('auth_needed', 'The LandPortal capture returned no authenticated parcel view; no visuals were adopted.'),
          executed: true,
          parcelUrl,
        },
        evidence,
        warnings: [...warnings, 'The authenticated LandPortal parcel view was unavailable for this capture.'],
        missingInformation: ['An authenticated LandPortal property panel for this subject'],
      };
    }

    // Subject identity gate: imagery from the wrong parcel is never adopted.
    if (subject.apn && panelApn && !apnIdentifiersEquivalent(subject.apn, panelApn)) {
      subjectResolution = 'AMBIGUOUS';
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: {
          ...emptyFacts('subject_mismatch', `LandPortal rendered APN ${panelApn} where the canonical subject is APN ${subject.apn}; no visuals were adopted.`),
          executed: true,
          parcelUrl,
        },
        evidence,
        warnings: [...warnings, `LandPortal panel APN ${panelApn} conflicts with canonical APN ${subject.apn}.`],
        missingInformation: ['A LandPortal panel matching this subject\'s canonical APN'],
      };
    }

    const capturedLabels = shots.map((shot) => shot.label);
    const missingLabels = requested.filter((label) => !capturedLabels.includes(label));
    const boundaryContexts: BoundaryContextOutcome[] = BOUNDARY_CONTEXT_PLAN
      .filter((planned) => requested.includes(planned.label))
      .map((planned) => {
        const captured = shots.some((shot) => shot.label === planned.label);
        const miss = overlayMisses.find((row) => row.overlay === planned.boundary);
        return {
          label: planned.label,
          boundary: planned.boundary,
          status: captured ? 'captured' as const : 'unavailable' as const,
          reason: captured ? null : miss?.reason ?? 'LandPortal did not produce a distinct boundary frame for this property.',
        };
      });

    let persisted = false;
    if (subject.propertyCardId != null && shots.length) {
      const pending: PendingPropertyInspectionRecord = {
        parcelUrl,
        comparablesUrl: null,
        parcelFacts: capture.fields ?? {},
        assets: shots.map((shot) => ({
          key: shot.label,
          label: shot.label,
          kind: shot.kind === 'overlay' ? 'overlay' as const : shot.kind === 'parcel_3d' ? 'parcel_3d' as const : 'parcel_page' as const,
          purpose: shot.purpose,
          sourcePath: shot.path,
          timestamp: capture.capturedAtIso,
          overlay: shot.overlay,
        })),
        overlays: shots
          .filter((shot) => shot.kind === 'overlay' && shot.overlay)
          .map((shot) => ({
            overlay: shot.overlay as string,
            status: 'captured' as const,
            note: shot.purpose,
            confidence: 'medium' as const,
            screenshotKey: shot.label,
          })),
        visualObservations: [],
        comparables: [],
        sources: [{
          provider: 'LandPortal authenticated parcel panel',
          stage: 'visual_capture',
          status: 'used',
          resultKind: 'retrieved',
          attemptedAt: capture.capturedAtIso,
          confidence: 'high',
          url: parcelUrl,
          note: `Visual Capture run retained ${shots.length} image(s): ${capturedLabels.join(', ')}.`,
        }],
      };
      (runtime.persistInspection ?? savePropertyInspection)(subject.propertyCardId, pending);
      persisted = true;
    }

    evidence.push({
      source: 'LandPortal authenticated parcel imagery',
      sourceUrl: parcelUrl,
      sourceType: 'provider_record',
      retrievedAt: capture.capturedAtIso,
      details: { captured: capturedLabels.length, missing: missingLabels.length, boundaries: boundaryContexts.map((row) => `${row.label}:${row.status}`).join(',') },
    });

    return {
      status: 'SUCCEEDED',
      subjectResolution,
      canonicalSubject,
      facts: {
        executed: true,
        outcome: 'visuals_captured',
        parcelUrl,
        capturedLabels,
        missingLabels,
        boundaryContexts,
        overlayMisses,
        persisted,
        summary: `LandPortal Visual Capture retained ${capturedLabels.length} of ${requested.length} requested frame(s)`
          + `${boundaryContexts.length ? ` (boundary context: ${boundaryContexts.map((row) => `${row.boundary} ${row.status}`).join('; ')})` : ''}`
          + '. Comp-search mode was never entered.',
      },
      evidence,
      warnings,
      missingInformation: missingLabels.length ? [`Visual frames LandPortal did not produce: ${missingLabels.join(', ')}`] : [],
    };
  },
};
