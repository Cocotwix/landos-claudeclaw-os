// LandOS — LandPortal Research Capability.
//
// This is a PLACEMENT, not a new researcher. Every LandPortal read LandOS
// already performs stays exactly where it is; this module is the Slice 7
// runtime Capability envelope around it, so Tools, New Lead and the V2 Deal
// Card reach ONE LandPortal implementation through one contract instead of
// each wiring its own path into the provider.
//
// The three existing execution paths it wraps, all reused verbatim:
//
//   1. `lpResolveForPreflight()` — the deterministic, non-credit LandPortal
//      property read. It is what already carries the parcel facts an operator
//      asks LandPortal for: acreage, road frontage, land-locked status,
//      wetlands and FEMA coverage, buildability, slope and elevation, building
//      area, assessed and market value, and the embedded similar sales.
//   2. The authenticated parcel-page inspection (`runPropertyInspection` behind
//      the single-tab browser mission gate). The browser factories and the
//      LandPortal auth path live in the route layer, so that executor is
//      INJECTED rather than imported — the capability owns the invocation, not
//      the browser.
//   3. The Hermes LandPortal specialist lane (`runHermesLandPortalLane`), also
//      injected. Hermes stays an executor beneath the capability; it never
//      becomes canonical LandOS state.
//
// Hard rules carried over from the underlying implementation:
//   - The canonical subject comes from Property Resolution. This capability
//     never decides that a different parcel is the subject; on raw input it
//     delegates to the Property Resolution Capability and consumes what that
//     returns. A rerun cannot silently repoint the property: when LandPortal
//     answers with a different APN than the canonical subject carries, the run
//     reports the conflict instead of adopting it.
//   - Missing stays missing. A field LandPortal did not publish is null, never
//     inferred, and never filled from another property.
//   - Provenance travels with the fact. Every projected record keeps the
//     LandPortal surface that carried it.
//
// Not in scope, and deliberately so: Property Resolution's own LandPortal
// identity lane. That lane exists to ESTABLISH the subject this capability is
// handed, so routing it through here would be circular. LandPortal *research*
// on an established subject is what this capability owns.

import type {
  CanonicalSubjectReference,
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  CapabilityResult,
  JsonObject,
  LandosCapability,
  SubjectResolutionState,
} from './capability-contract.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { decodeLandPortalCanonicalIdentity } from './landportal-canonical-identity.js';
import {
  apnMatchKey,
  landPortalConfigured,
  lpResolveForPreflight,
  type LpPropertySummary,
  type LpResolveArgs,
  type LpResolveResult,
} from './landportal-client.js';
import { loadPropertyInspection, type PropertyInspectionRecord } from './property-card.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';

export const LANDPORTAL_RESEARCH_CAPABILITY_ID = 'landportal-research';

/** How long the deterministic LandPortal property read gets. */
const DEFAULT_LOOKUP_TIMEOUT_MS = 25_000;

/**
 * The three existing LandPortal execution paths, named.
 *
 * `parcel_facts` is the default because it is the one path that answers for
 * every caller: it needs no browser, consumes no comp credit, and works the
 * same for a Tools one-off and a Deal Card rerun.
 */
export type LandPortalResearchLane = 'parcel_facts' | 'parcel_inspection' | 'agentic_specialists';

export type LandPortalResearchOutcome =
  | 'record_returned'
  | 'lane_completed'
  | 'retained_only'
  | 'not_available';

/** What the injected authenticated parcel-page inspection is asked for. */
export interface LandPortalInspectionRequest {
  propertyCardId: number;
  dealCardId: number;
  searchKey: {
    address: string | null;
    apn: string | null;
    county: string | null;
    state: string | null;
    city: string | null;
    owner: string | null;
  };
}

/** What that inspection reports back. Unchanged from the existing lane. */
export type LandPortalInspectionOutcome = {
  ok: boolean;
  note: string;
  comparableCount: number;
};

/** What the injected Hermes LandPortal specialist lane is asked for. */
export interface LandPortalAgenticRequest {
  runId: string;
  dealCardId: number;
  propertyCardId: number;
  address: string;
  apn: string | null;
  owner: string | null;
  county: string | null;
  state: string | null;
  landPortalPropertyId: string | null;
}

/** The compact honest projection of a Hermes lane run. */
export type LandPortalAgenticOutcome = {
  status: string;
  runId: string;
  note: string;
  persistedCategories: string[];
  workUnits: Array<{ specialist: string; status: string; note: string }>;
};

export interface LandPortalResearchRuntime {
  /**
   * Raw operator input is resolved by the Property Resolution Capability, never
   * here. The registry injects the real invoker; tests inject a stub.
   */
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /** The existing deterministic LandPortal property read. Tests override it. */
  lpResolve?: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
  /** Presence-only LandPortal configuration check. Never reads the token. */
  landPortalAvailable?: () => boolean;
  /** The existing authenticated parcel-page inspection, owned by the route layer. */
  runParcelInspection?: (input: LandPortalInspectionRequest) => Promise<LandPortalInspectionOutcome>;
  /** The existing Hermes LandPortal specialist lane, owned by the route layer. */
  runAgenticSpecialists?: (input: LandPortalAgenticRequest) => Promise<LandPortalAgenticOutcome>;
  /** Retained LandPortal evidence for a Property Card. Tests override it. */
  loadInspection?: (propertyCardId: number) => PropertyInspectionRecord | null;
  lookupTimeoutMs?: number;
}

export type LandPortalParcelFacts = {
  parcelUrl: string | null;
  apn: string | null;
  situsAddress: string | null;
  owner: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  landUse: string | null;
  municipality: string | null;
  acres: number | null;
  calculatedAcres: number | null;
  lotSizeSqft: number | null;
  roadFrontageFeet: number | null;
  landLocked: string | null;
  nearWater: string | null;
  wetlandsPct: number | null;
  femaPct: number | null;
  buildabilityPct: number | null;
  buildabilityAcres: number | null;
  slopeAvgDegrees: number | null;
  elevationAvgFeet: number | null;
  buildingAreaSqft: number | null;
  assessedTotal: number | null;
  assessedLand: number | null;
  marketTotal: number | null;
  marketLand: number | null;
};

export type LandPortalComparableFact = {
  saleYear: string | null;
  salePrice: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  apn: string | null;
  location: string | null;
};

export type LandPortalRetainedEvidence = {
  parcelUrl: string | null;
  parcelFactCount: number;
  assetCount: number;
  comparableCount: number;
  visualObservationCount: number;
  overlayCount: number;
  sources: Array<{ provider: string; status: string; note: string; url: string | null }>;
};

export type LandPortalResearchSubjectFacts = {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  owner: string | null;
  landPortalPropertyId: string | null;
};

export type LandPortalResearchFacts = JsonObject & {
  lane: LandPortalResearchLane;
  executed: boolean;
  outcome: LandPortalResearchOutcome;
  subject: LandPortalResearchSubjectFacts;
  parcel: LandPortalParcelFacts | null;
  comparables: LandPortalComparableFact[];
  retained: LandPortalRetainedEvidence;
  inspection: LandPortalInspectionOutcome | null;
  agentic: LandPortalAgenticOutcome | null;
  sourceAttempts: Array<{ source: string; status: string; note: string }>;
  summary: string;
};

/** The canonical subject this capability was handed, never one it chose. */
interface LandPortalSubject {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  landPortalPropertyId: string | null;
}

const str = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return raw && !/^(?:-|--|n\/?a|none|unknown)$/i.test(raw) ? raw : null;
};

const num = (value: unknown): number | null => {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const laneOf = (parameters: JsonObject | undefined): LandPortalResearchLane => {
  const raw = typeof parameters?.lane === 'string' ? parameters.lane : 'parcel_facts';
  return raw === 'parcel_inspection' || raw === 'agentic_specialists' ? raw : 'parcel_facts';
};

function emptyRetained(): LandPortalRetainedEvidence {
  return {
    parcelUrl: null,
    parcelFactCount: 0,
    assetCount: 0,
    comparableCount: 0,
    visualObservationCount: 0,
    overlayCount: 0,
    sources: [],
  };
}

/** What this Property Card already holds from LandPortal, with its provenance. */
function retainedEvidence(
  propertyCardId: number | null,
  runtime: LandPortalResearchRuntime,
): { retained: LandPortalRetainedEvidence; record: PropertyInspectionRecord | null } {
  if (propertyCardId == null) return { retained: emptyRetained(), record: null };
  let record: PropertyInspectionRecord | null = null;
  try {
    record = (runtime.loadInspection ?? loadPropertyInspection)(propertyCardId);
  } catch {
    record = null;
  }
  if (!record) return { retained: emptyRetained(), record: null };
  return {
    record,
    retained: {
      parcelUrl: record.parcelUrl ?? null,
      parcelFactCount: Object.keys(record.parcelFacts ?? {}).length,
      assetCount: record.assets.length,
      comparableCount: record.comparables.length,
      visualObservationCount: record.visualObservations.length,
      overlayCount: record.overlays.length,
      sources: record.sources
        .filter((source) => /land\s*portal/i.test(source.provider))
        .map((source) => ({
          provider: source.provider,
          status: source.status,
          note: source.note,
          url: source.url ?? null,
        })),
    },
  };
}

/**
 * The identity this subject already carries on LandPortal.
 *
 * A retained parcel URL decodes to the exact `{fips, apn, propertyId}` triple,
 * which is the strongest read the provider offers: it opens the record itself
 * instead of searching for it.
 */
function lookupArgsFor(subject: LandPortalSubject, retainedParcelUrl: string | null): LpResolveArgs | null {
  const canonical = decodeLandPortalCanonicalIdentity(retainedParcelUrl);
  if (canonical) return { propertyid: canonical.propertyId, fips: canonical.fips, apn: canonical.apn };
  if (subject.apn && (subject.county || subject.state)) {
    return {
      apn: subject.apn,
      county: subject.county ?? undefined,
      state: subject.state ?? undefined,
    };
  }
  if (subject.address) {
    return {
      address: subject.address,
      city: subject.city ?? undefined,
      state: subject.state ?? undefined,
      zip: subject.zip ?? undefined,
    };
  }
  if (subject.owner && (subject.county || subject.state)) {
    return {
      owner: subject.owner,
      county: subject.county ?? undefined,
      state: subject.state ?? undefined,
    };
  }
  return null;
}

/** The provider's property record, projected field by field. Blank stays null. */
function parcelFactsFrom(
  summary: LpPropertySummary | undefined,
  resolved: LpResolveResult,
  retainedParcelUrl: string | null,
): LandPortalParcelFacts {
  const source = summary ?? ({} as Partial<LpPropertySummary>);
  return {
    parcelUrl: retainedParcelUrl,
    apn: str(resolved.apn) ?? str(source.apn),
    situsAddress: str(resolved.situs_address) ?? str(source.situs_address),
    owner: str(resolved.owner) ?? str(source.owner),
    city: str(resolved.city) ?? str(source.city),
    county: str(source.county),
    state: str(resolved.state) ?? str(source.state),
    zip: str(source.zip),
    landUse: str(source.land_use),
    municipality: str(source.municipality),
    acres: num(source.lot_size_acres),
    calculatedAcres: num(source.calc_acres),
    lotSizeSqft: num(source.lot_size_sqft),
    roadFrontageFeet: num(source.road_frontage_ft),
    landLocked: str(source.land_locked),
    nearWater: str(source.near_water),
    wetlandsPct: num(source.wetlands_pct),
    femaPct: num(source.fema_pct),
    buildabilityPct: num(source.buildability_pct),
    buildabilityAcres: num(source.buildability_acres),
    slopeAvgDegrees: num(source.slope_avg_deg),
    elevationAvgFeet: num(source.elevation_avg_ft),
    buildingAreaSqft: num(source.building_area_sqft),
    assessedTotal: num(source.assessed_total),
    assessedLand: num(source.assessed_land),
    marketTotal: num(source.market_total),
    marketLand: num(source.market_land),
  };
}

function comparablesFrom(summary: LpPropertySummary | undefined): LandPortalComparableFact[] {
  return (summary?.similar_sales ?? []).map((row) => ({
    saleYear: str(row.saleYear),
    salePrice: row.salePrice ?? null,
    acres: row.acres ?? null,
    pricePerAcre: row.pricePerAcre ?? null,
    apn: str(row.apn),
    location: str(row.addressOrCounty),
  }));
}

function emptyFacts(
  lane: LandPortalResearchLane,
  subject: LandPortalSubject,
  retained: LandPortalRetainedEvidence,
  summary: string,
): LandPortalResearchFacts {
  return {
    lane,
    executed: false,
    outcome: retained.parcelFactCount || retained.comparableCount || retained.assetCount
      ? 'retained_only'
      : 'not_available',
    subject: {
      propertyCardId: subject.propertyCardId,
      dealCardId: subject.dealCardId,
      address: subject.address,
      apn: subject.apn,
      county: subject.county,
      state: subject.state,
      owner: subject.owner,
      landPortalPropertyId: subject.landPortalPropertyId,
    },
    parcel: null,
    comparables: [],
    retained,
    inspection: null,
    agentic: null,
    sourceAttempts: [],
    summary,
  };
}

/** Property Resolution owns raw input. This capability only consumes it. */
async function resolveRawSubject(
  request: CapabilityInvocationRequest,
  runtime: LandPortalResearchRuntime,
): Promise<CapabilityResult> {
  if (runtime.resolveSubject) return runtime.resolveSubject(request);
  const { invokeRuntimeCapability } = await import('./capability-registry.js');
  return invokeRuntimeCapability({
    capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
    caller: request.caller,
    subject: request.subject,
    mode: request.mode ?? 'reuse',
    // The envelope is forwarded verbatim so a resolution the same caller has
    // already run for this input is reused rather than resolved twice.
    context: request.context ?? {},
  });
}

function subjectFromCanonicalIdentity(
  identity: Record<string, unknown>,
  canonical: CanonicalSubjectReference | null,
): LandPortalSubject {
  return {
    propertyCardId: canonical?.propertyCardId ?? null,
    dealCardId: canonical?.dealCardId ?? null,
    address: str(identity.address),
    city: str(identity.city),
    county: str(identity.county),
    state: str(identity.state),
    zip: str(identity.zip),
    apn: str(identity.apn),
    owner: str(identity.owner),
    landPortalPropertyId: str(identity.lpPropertyId) ?? str(identity.landPortalPropertyId),
  };
}

export const LANDPORTAL_RESEARCH_CAPABILITY: LandosCapability<LandPortalResearchFacts, LandPortalResearchRuntime> = {
  metadata: {
    id: LANDPORTAL_RESEARCH_CAPABILITY_ID,
    name: 'LandPortal Research',
    contractVersion: '1.0',
    description: 'Runs LandOS LandPortal research for the canonical property subject: the exact-subject parcel record, acreage, road frontage, land-locked status, wetlands and FEMA coverage, buildability, slope and elevation, improvements, comparable sales, and the retained authenticated parcel evidence.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['lane', 'runId', 'lookupTimeoutMs']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`LandPortal Research does not accept caller-supplied ${unsupported.join(', ')}; LandPortal facts come from the record, not the caller`);
    }
    const lane = request.parameters?.lane;
    if (lane != null && !['parcel_facts', 'parcel_inspection', 'agentic_specialists'].includes(String(lane))) {
      throw new Error(`unknown LandPortal Research lane ${String(lane)}`);
    }
    const reserved = /^(?:apn|acres|acreage|owner|parcelUrl|wetlands|fema|buildability|roadFrontage|landLocked|comparables|comps|facts|evidence)$/i;
    const asserts = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(asserts);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => reserved.test(key) || asserts(child));
    };
    if (asserts(request.context ?? {})) {
      throw new Error('LandPortal Research context cannot contain caller-supplied parcel, comparable, or evidence assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: LandPortalResearchRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<LandPortalResearchFacts>> {
    const lane = laneOf(request.parameters);
    const warnings: string[] = [];
    let subject: LandPortalSubject;
    let canonicalSubject: CanonicalSubjectReference | null;
    let subjectResolution: SubjectResolutionState;
    let resolutionEvidence: CapabilityEvidenceReference[] = [];

    if (request.subject.kind === 'canonical_property') {
      // The Deal Card and New Lead path. The subject already exists; reading it
      // is the whole identity step, and nothing here may change it.
      const propertyCardId = request.subject.propertyCardId;
      const dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId);
      if (!dealCardId) throw new Error(`canonical property ${propertyCardId} is not linked to a Deal Card`);
      const retainedSubject = readResolverSubject(dealCardId);
      if (!retainedSubject
        || retainedSubject.propertyCardId !== propertyCardId
        || retainedSubject.entity !== request.subject.entity) {
        throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
      }
      subject = {
        propertyCardId,
        dealCardId,
        address: retainedSubject.address,
        city: retainedSubject.city,
        county: retainedSubject.county,
        state: retainedSubject.state,
        zip: retainedSubject.zip,
        apn: retainedSubject.apn,
        owner: retainedSubject.owner,
        landPortalPropertyId: retainedSubject.lpPropertyId,
      };
      canonicalSubject = { kind: 'property', id: String(propertyCardId), propertyCardId, dealCardId, temporary: false };
      const evaluation = evaluateResolverIdentity(retainedSubject);
      subjectResolution = evaluation.sufficient ? 'RESOLVED' : 'UNRESOLVED';
      if (!evaluation.sufficient) warnings.push(...evaluation.conflicts);
    } else {
      // Tools. Raw operator input is resolved by the Property Resolution
      // Capability; this capability consumes whatever subject that returns and
      // creates nothing of its own — no Property Card, no Deal Card, no lead.
      const resolution = await resolveRawSubject(request, runtime);
      subjectResolution = resolution.subjectResolution;
      canonicalSubject = resolution.canonicalSubject;
      resolutionEvidence = resolution.evidence;
      const identity = (resolution.facts.canonicalIdentity ?? {}) as Record<string, unknown>;
      subject = subjectFromCanonicalIdentity(identity, canonicalSubject);
      warnings.push(...resolution.warnings);
      if (subjectResolution !== 'RESOLVED') {
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(lane, subject, emptyRetained(),
            'LandPortal research did not run: Property Resolution has not established one canonical parcel for this input.'),
          evidence: resolutionEvidence,
          warnings,
          missingInformation: resolution.missingInformation.length
            ? resolution.missingInformation
            : ['One canonical parcel from Property Resolution'],
        };
      }
    }

    const { retained } = retainedEvidence(subject.propertyCardId, runtime);
    const evidence: CapabilityEvidenceReference[] = [];
    const sourceAttempts: Array<{ source: string; status: string; note: string }> = [];
    const missingInformation: string[] = [];
    const now = new Date().toISOString();

    if (retained.parcelUrl) {
      evidence.push({
        source: 'LandPortal authenticated parcel record',
        sourceUrl: retained.parcelUrl,
        sourceType: 'retained_provider_record',
        retrievedAt: now,
        details: {
          retained: true,
          parcelFacts: retained.parcelFactCount,
          assets: retained.assetCount,
          comparables: retained.comparableCount,
        },
      });
    }

    // A released exact parcel is required to ADOPT provider facts, and that
    // gate lives on the `parcel_facts` lane below. It deliberately does NOT
    // gate the two execution lanes: on a new lead the authenticated parcel read
    // and the specialist lane are what SUPPLY the parcel URL, APN and
    // jurisdiction that Property Resolution then releases. Gating them on a
    // released resolution would be circular and would silently kill the primary
    // New Lead LandPortal lane. Both lanes report `subjectResolution` honestly
    // in their result, and neither writes canonical property identity.

    // ── The authenticated parcel-page inspection lane ────────────────────────
    if (lane === 'parcel_inspection') {
      if (!runtime.runParcelInspection || subject.propertyCardId == null || subject.dealCardId == null) {
        warnings.push('The authenticated LandPortal parcel inspection is not available in this environment.');
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(lane, subject, retained,
            'The authenticated LandPortal parcel inspection was not available for this subject.'),
          evidence,
          warnings,
          missingInformation: ['An authenticated LandPortal browser session'],
        };
      }
      const inspection = await runtime.runParcelInspection({
        propertyCardId: subject.propertyCardId,
        dealCardId: subject.dealCardId,
        searchKey: {
          address: subject.address,
          apn: subject.apn,
          county: subject.county,
          state: subject.state,
          city: subject.city,
          owner: subject.owner,
        },
      });
      // The inspection persists its own cumulative evidence; read it back so
      // the capability result reports what the parcel actually now holds.
      const after = retainedEvidence(subject.propertyCardId, runtime).retained;
      sourceAttempts.push({
        source: 'LandPortal authenticated parcel page',
        status: inspection.ok ? 'used' : 'no_result',
        note: inspection.note,
      });
      if (after.parcelUrl && after.parcelUrl !== retained.parcelUrl) {
        evidence.push({
          source: 'LandPortal authenticated parcel record',
          sourceUrl: after.parcelUrl,
          sourceType: 'provider_record',
          retrievedAt: now,
          details: { parcelFacts: after.parcelFactCount, comparables: after.comparableCount },
        });
      }
      if (!inspection.ok) missingInformation.push('A readable LandPortal parcel page for this subject');
      const facts: LandPortalResearchFacts = {
        ...emptyFacts(lane, subject, after, inspection.note),
        executed: true,
        outcome: inspection.ok ? 'lane_completed' : after.parcelFactCount ? 'retained_only' : 'not_available',
        inspection,
        sourceAttempts,
      };
      return {
        status: inspection.ok ? 'SUCCEEDED' : 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts,
        evidence,
        warnings,
        missingInformation,
      };
    }

    // ── The Hermes specialist lane ───────────────────────────────────────────
    if (lane === 'agentic_specialists') {
      const runId = str(request.parameters?.runId);
      if (!runtime.runAgenticSpecialists || subject.propertyCardId == null || subject.dealCardId == null
        || !subject.address || !runId) {
        warnings.push('The LandPortal specialist lane needs a canonical Deal Card subject with an address and a run id.');
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(lane, subject, retained,
            'The LandPortal specialist lane did not run for this subject.'),
          evidence,
          warnings,
          missingInformation: ['A canonical Deal Card subject with an address for the LandPortal specialist lane'],
        };
      }
      const agentic = await runtime.runAgenticSpecialists({
        runId,
        dealCardId: subject.dealCardId,
        propertyCardId: subject.propertyCardId,
        address: subject.address,
        apn: subject.apn,
        owner: subject.owner,
        county: subject.county,
        state: subject.state,
        landPortalPropertyId: subject.landPortalPropertyId,
      });
      const after = retainedEvidence(subject.propertyCardId, runtime).retained;
      sourceAttempts.push({
        source: 'LandPortal specialist lane',
        status: agentic.status,
        note: agentic.note,
      });
      const succeeded = agentic.status === 'exact_match';
      if (!succeeded) missingInformation.push('An exact-subject LandPortal specialist handback');
      const facts: LandPortalResearchFacts = {
        ...emptyFacts(lane, subject, after, agentic.note),
        executed: true,
        outcome: succeeded ? 'lane_completed' : after.parcelFactCount ? 'retained_only' : 'not_available',
        agentic,
        sourceAttempts,
      };
      return {
        status: succeeded ? 'SUCCEEDED' : 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts,
        evidence,
        warnings,
        missingInformation,
      };
    }

    // ── The deterministic property-record lane (default) ─────────────────────
    //
    // This lane ADOPTS provider facts as this subject's LandPortal record, so
    // it runs only against a parcel Property Resolution has actually released.
    if (subjectResolution !== 'RESOLVED') {
      warnings.push('Property Resolution has not released one exact parcel for this Deal Card, so no LandPortal record was requested.');
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts(lane, subject, retained,
          'The LandPortal record was not read: this Deal Card has no released exact parcel.'),
        evidence,
        warnings,
        missingInformation: ['One exact parcel released by Property Resolution'],
      };
    }

    const available = (runtime.landPortalAvailable ?? landPortalConfigured)();
    if (!available) {
      warnings.push('LandPortal is not configured in this environment, so no property record could be requested.');
      sourceAttempts.push({
        source: 'LandPortal property record',
        status: 'not_configured',
        note: 'No LandPortal credential is configured for this environment.',
      });
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: {
          ...emptyFacts(lane, subject, retained,
            'LandPortal is not configured in this environment; only retained LandPortal evidence is reported.'),
          sourceAttempts,
        },
        evidence,
        warnings,
        missingInformation: ['A configured LandPortal connection'],
      };
    }

    const args = lookupArgsFor(subject, retained.parcelUrl);
    if (!args) {
      warnings.push('This subject carries no LandPortal-searchable identity: no parcel record, APN with jurisdiction, address, or owner with jurisdiction.');
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts(lane, subject, retained,
          'No LandPortal lookup could be built from this subject.'),
        evidence,
        warnings,
        missingInformation: ['An APN with jurisdiction, an address, or a retained LandPortal parcel record'],
      };
    }

    const resolved = await (runtime.lpResolve ?? lpResolveForPreflight)(
      args,
      runtime.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS,
    );
    sourceAttempts.push({
      source: str(resolved.source) ?? 'LandPortal property record',
      status: resolved.status,
      note: resolved.match_notes || 'No note was returned with this lookup.',
    });

    if (!resolved.verified) {
      warnings.push(`LandPortal did not return a verified record for this subject: ${resolved.match_notes || resolved.status}.`);
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: {
          ...emptyFacts(lane, subject, retained,
            `LandPortal returned ${resolved.status} for this subject; no parcel record was retrieved in this run.`),
          executed: true,
          sourceAttempts,
        },
        evidence,
        warnings,
        missingInformation: ['A verified LandPortal record for this exact subject'],
      };
    }

    // Identity gate. A rerun may refresh the record; it may never repoint the
    // property. When LandPortal answers with a different parcel than the
    // canonical subject carries, the conflict is reported, not adopted.
    const subjectApnKey = subject.apn ? apnMatchKey(subject.apn) : '';
    const returnedApnKey = resolved.apn ? apnMatchKey(resolved.apn) : '';
    if (subjectApnKey && returnedApnKey && subjectApnKey !== returnedApnKey) {
      warnings.push(`LandPortal returned APN ${resolved.apn} for a subject whose canonical APN is ${subject.apn}. The canonical property is unchanged and no LandPortal facts were adopted.`);
      return {
        status: 'NEEDS_INPUT',
        subjectResolution: 'AMBIGUOUS',
        canonicalSubject,
        facts: {
          ...emptyFacts(lane, subject, retained,
            'LandPortal returned a different parcel than this subject; no facts were adopted and the canonical property is unchanged.'),
          executed: true,
          sourceAttempts,
        },
        evidence,
        warnings,
        missingInformation: ['A LandPortal record matching this subject’s canonical APN'],
      };
    }

    const parcel = parcelFactsFrom(resolved.property_summary, resolved, retained.parcelUrl);
    const comparables = comparablesFrom(resolved.property_summary);
    evidence.push({
      source: str(resolved.source) ?? 'LandPortal property record',
      sourceUrl: retained.parcelUrl,
      sourceType: 'provider_record',
      retrievedAt: now,
      details: {
        apn: parcel.apn,
        propertyId: str(resolved.propertyid),
        fips: str(resolved.fips),
        comparables: comparables.length,
      },
    });

    if (parcel.acres == null && parcel.calculatedAcres == null) missingInformation.push('Parcel acreage from the LandPortal record');
    if (parcel.roadFrontageFeet == null) missingInformation.push('Road frontage from the LandPortal record');
    if (parcel.landLocked == null) missingInformation.push('Land-locked status from the LandPortal record');
    if (!comparables.length) missingInformation.push('LandPortal comparable sales for this subject');

    const facts: LandPortalResearchFacts = {
      ...emptyFacts(lane, subject, retained, ''),
      executed: true,
      outcome: 'record_returned',
      parcel,
      comparables,
      sourceAttempts,
      summary: `LandPortal returned the verified record for ${parcel.situsAddress ?? subject.address ?? 'this subject'}${parcel.apn ? ` (APN ${parcel.apn})` : ''}, with ${comparables.length} embedded comparable sale(s).`,
    };

    return {
      status: 'SUCCEEDED',
      subjectResolution,
      canonicalSubject,
      facts,
      evidence: [...resolutionEvidence, ...evidence],
      warnings,
      missingInformation,
    };
  },
};
