// LandOS — LandPortal Property Characteristics Capability.
//
// Tool 1 of the LandPortal three-tool split: "What does LandPortal know about
// THIS subject property?" — subject-property data extraction ONLY. It ensures
// its own authenticated session, visually inspects the page (readiness gates +
// blocking-overlay dismissal) before interacting, verifies the canonical
// subject by APN, extracts the parcel record (panel rows + the parcel's own
// internal endpoint), and persists it through the normal cumulative property
// inspection. It NEVER enters comp-search mode and never changes the Deal
// Card's canonical property identity.
//
// The browser engine is `driver.readLandPortalRecord` (browser-session.ts),
// injected by the route layer; tests inject a stub.

import type {
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  CapabilityResult,
  JsonObject,
  LandosCapability,
} from './capability-contract.js';
import { apnIdentifiersEquivalent } from './landportal-capability.js';
import { buildParcelFactSheet } from './landportal-facts.js';
import {
  assertNoCallerAssertions,
  resolveLandPortalToolSubject,
  subjectCanonicalParcelUrl,
  type LandPortalToolSubjectRuntime,
} from './landportal-tool-subject.js';
import { savePropertyInspection, type PendingPropertyInspectionRecord } from './property-card.js';

export const LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID = 'landportal-property-characteristics';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface LandPortalRecordRead {
  url: string;
  authenticated: boolean;
  panelReady: boolean;
  apn: string | null;
  fields: Record<string, string>;
  mlsFields: Record<string, string>;
  listingLinks: Array<{ text: string; href: string }>;
  redfinUrl: string | null;
  apiFactCount: number;
  dismissedOverlays: number;
  capturedAtIso: string;
}

export interface LandPortalPropertyCharacteristicsRuntime extends LandPortalToolSubjectRuntime {
  /** The live browser record read (route layer injects the real driver call,
   *  wrapped in auth + owned-page lifecycle). Tests inject a stub. */
  readRecord?: (url: string, opts: { timeoutMs: number; includeMls?: boolean }) => Promise<LandPortalRecordRead>;
  /** Persistence override for tests. */
  persistInspection?: (cardId: number, record: PendingPropertyInspectionRecord) => void;
  timeoutMs?: number;
}

export type LandPortalPropertyCharacteristicsFacts = JsonObject & {
  executed: boolean;
  outcome: 'record_extracted' | 'auth_needed' | 'subject_mismatch' | 'not_available';
  parcelUrl: string | null;
  panelApn: string | null;
  factCount: number;
  apiFactCount: number;
  dismissedOverlays: number;
  persisted: boolean;
  facts: Record<string, string>;
  factSheet: JsonObject | null;
  summary: string;
};

export const LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY: LandosCapability<
  LandPortalPropertyCharacteristicsFacts,
  LandPortalPropertyCharacteristicsRuntime
> = {
  metadata: {
    id: LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID,
    name: 'LandPortal Property Characteristics',
    contractVersion: '1.0',
    description: 'Extracts the canonical subject\'s LandPortal property record — APN, owner, acreage, situs, land use, improvements, access/land-locked, frontage, FEMA/flood, wetlands, water, soils, elevation, slope, buildability and valuation facts — through its own authenticated browser run. Never enters comp-search mode.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['timeoutMs']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`LandPortal Property Characteristics does not accept caller-supplied ${unsupported.join(', ')}`);
    }
    assertNoCallerAssertions(request.context as Record<string, unknown> | undefined, 'LandPortal Property Characteristics');
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: LandPortalPropertyCharacteristicsRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<LandPortalPropertyCharacteristicsFacts>> {
    const resolved = await resolveLandPortalToolSubject(request, runtime);
    const { subject, canonicalSubject, warnings } = resolved;
    let { subjectResolution } = resolved;
    const evidence: CapabilityEvidenceReference[] = [...resolved.resolutionEvidence];
    const nowIso = new Date().toISOString();
    const emptyFacts = (outcome: LandPortalPropertyCharacteristicsFacts['outcome'], summary: string): LandPortalPropertyCharacteristicsFacts => ({
      executed: false,
      outcome,
      parcelUrl: null,
      panelApn: null,
      factCount: 0,
      apiFactCount: 0,
      dismissedOverlays: 0,
      persisted: false,
      facts: {},
      factSheet: null,
      summary,
    });

    if (subjectResolution !== 'RESOLVED') {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts('not_available', 'Property Characteristics did not run: no released canonical parcel for this input.'),
        evidence,
        warnings,
        missingInformation: resolved.missingInformation.length ? resolved.missingInformation : ['One canonical parcel from Property Resolution'],
      };
    }

    const parcelUrl = subjectCanonicalParcelUrl(subject);
    if (!parcelUrl) {
      warnings.push('This subject carries no retained LandPortal parcel identity (fips + apn + property id), so the record cannot be opened deterministically.');
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts('not_available', 'No canonical LandPortal parcel URL exists for this subject.'),
        evidence,
        warnings,
        missingInformation: ['A retained LandPortal parcel identity for this subject'],
      };
    }
    if (!runtime.readRecord) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts('not_available', 'The authenticated LandPortal browser engine is not available in this environment.'),
        evidence,
        warnings,
        missingInformation: ['An authenticated LandPortal browser session'],
      };
    }

    const read = await runtime.readRecord(parcelUrl, {
      timeoutMs: runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      includeMls: false,
    });
    if (!read.authenticated || !read.panelReady) {
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: {
          ...emptyFacts('auth_needed', 'The LandPortal session could not present the authenticated property panel for this subject.'),
          executed: true,
          parcelUrl,
        },
        evidence,
        warnings: [...warnings, 'LandPortal authentication or the property panel was unavailable; no facts were extracted.'],
        missingInformation: ['An authenticated LandPortal property panel for this subject'],
      };
    }

    // Subject identity gate: the panel's APN must be the canonical APN.
    if (subject.apn && read.apn && !apnIdentifiersEquivalent(subject.apn, read.apn)) {
      subjectResolution = 'AMBIGUOUS';
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: {
          ...emptyFacts('subject_mismatch', `LandPortal rendered APN ${read.apn} where the canonical subject is APN ${subject.apn}; no facts were adopted and the canonical property is unchanged.`),
          executed: true,
          parcelUrl,
          panelApn: read.apn,
        },
        evidence,
        warnings: [...warnings, `LandPortal panel APN ${read.apn} conflicts with canonical APN ${subject.apn}.`],
        missingInformation: ['A LandPortal panel matching this subject\'s canonical APN'],
      };
    }

    const factCount = Object.keys(read.fields).length;
    let persisted = false;
    if (subject.propertyCardId != null && factCount) {
      const pending: PendingPropertyInspectionRecord = {
        parcelUrl,
        comparablesUrl: null,
        parcelFacts: read.fields,
        assets: [],
        overlays: [],
        visualObservations: [],
        comparables: [],
        sources: [{
          provider: 'LandPortal authenticated parcel panel',
          stage: 'property_characteristics',
          status: 'used',
          resultKind: 'retrieved',
          attemptedAt: read.capturedAtIso,
          confidence: 'high',
          url: parcelUrl,
          note: `Property Characteristics run extracted ${factCount} fact(s) (${read.apiFactCount} from the parcel endpoint); ${read.dismissedOverlays} blocking overlay(s) dismissed.`,
        }],
      };
      (runtime.persistInspection ?? savePropertyInspection)(subject.propertyCardId, pending);
      persisted = true;
    }

    evidence.push({
      source: 'LandPortal authenticated parcel panel',
      sourceUrl: parcelUrl,
      sourceType: 'provider_record',
      retrievedAt: nowIso,
      details: { apn: read.apn, factCount, apiFactCount: read.apiFactCount },
    });

    let factSheet: JsonObject | null = null;
    try { factSheet = buildParcelFactSheet(read.fields) as unknown as JsonObject; } catch { factSheet = null; }

    const missingInformation: string[] = [];
    if (!read.fields['Acres'] && !read.fields['Calc Acres']) missingInformation.push('Parcel acreage from the LandPortal record');
    if (!read.fields['Road Frontage']) missingInformation.push('Road frontage from the LandPortal record');

    return {
      status: 'SUCCEEDED',
      subjectResolution,
      canonicalSubject,
      facts: {
        executed: true,
        outcome: 'record_extracted',
        parcelUrl,
        panelApn: read.apn,
        factCount,
        apiFactCount: read.apiFactCount,
        dismissedOverlays: read.dismissedOverlays,
        persisted,
        facts: read.fields,
        factSheet,
        summary: `LandPortal Property Characteristics extracted ${factCount} fact(s) for APN ${read.apn ?? subject.apn ?? 'unknown'}${persisted ? ' and persisted them to the property inspection record' : ''}. Comp-search mode was never entered.`,
      },
      evidence,
      warnings,
      missingInformation,
    };
  },
};
