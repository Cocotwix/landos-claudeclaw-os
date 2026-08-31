import {
  invokeCapabilityDefinition,
  type CapabilityInvocationRequest,
  type CapabilityMetadata,
  type CapabilityOperatorManifest,
  type CapabilityPrerequisiteClause,
  type CapabilityResult,
  type JsonObject,
  type LandosCapability,
} from './capability-contract.js';
import {
  ACQUISITION_INTELLIGENCE_CAPABILITY,
  ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
  type AcquisitionIntelligenceRuntimeDeps,
} from './acquisition-intelligence-capability.js';
import {
  ASSESSOR_TAX_CAPABILITY,
  ASSESSOR_TAX_CAPABILITY_ID,
  type AssessorTaxRuntime,
} from './assessor-tax-capability.js';
import { CapabilityInvocationStore } from './capability-store.js';
import {
  COMPS_VALUATION_CAPABILITY,
  COMPS_VALUATION_CAPABILITY_ID,
  type CompsValuationRuntime,
} from './comps-valuation-capability.js';
import {
  LANDPORTAL_RESEARCH_CAPABILITY,
  LANDPORTAL_RESEARCH_CAPABILITY_ID,
  type LandPortalResearchRuntime,
} from './landportal-research-capability.js';
import {
  LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY,
  LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID,
  type LandPortalPropertyCharacteristicsRuntime,
} from './landportal-property-characteristics-capability.js';
import {
  LANDPORTAL_VISUAL_CAPTURE_CAPABILITY,
  LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID,
  type LandPortalVisualCaptureRuntime,
} from './landportal-visual-capture-capability.js';
import {
  LANDPORTAL_COMP_SEARCH_CAPABILITY,
  LANDPORTAL_COMP_SEARCH_CAPABILITY_ID,
  type LandPortalCompSearchRuntime,
} from './landportal-comp-search-capability.js';
import {
  PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY,
  PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
  type PropertyDevelopmentHistoryRuntime,
} from './property-development-history-capability.js';
import {
  COUNTY_MARKET_RESEARCH_CAPABILITY,
  COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
  MARKET_PULSE_CAPABILITY,
  MARKET_PULSE_CAPABILITY_ID,
  ZIP_MARKET_RESEARCH_CAPABILITY,
  ZIP_MARKET_RESEARCH_CAPABILITY_ID,
  type MarketGeographyRuntime,
} from './market-geography-capabilities.js';
import {
  PROPERTY_RESOLUTION_CAPABILITY,
  PROPERTY_RESOLUTION_CAPABILITY_ID,
  type PropertyResolutionRuntime,
} from './property-resolution-capability.js';
import {
  UTILITY_SERVICE_SCREEN_CAPABILITY,
  UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
  type UtilityServiceScreenRuntime,
} from './utility-service-screen-capability.js';
import {
  ZONING_SUBDIVISION_CAPABILITY,
  ZONING_SUBDIVISION_CAPABILITY_ID,
  type ZoningSubdivisionRuntime,
} from './zoning-subdivision-capability.js';

/** Every runtime a registered LandOS capability accepts. */
export type RuntimeCapabilityRuntime = PropertyResolutionRuntime & AssessorTaxRuntime & LandPortalResearchRuntime
  & CompsValuationRuntime & ZoningSubdivisionRuntime & PropertyDevelopmentHistoryRuntime
  & UtilityServiceScreenRuntime & AcquisitionIntelligenceRuntimeDeps
  & LandPortalPropertyCharacteristicsRuntime & LandPortalVisualCaptureRuntime & LandPortalCompSearchRuntime
  & MarketGeographyRuntime;

const CAPABILITIES = new Map<string, LandosCapability<JsonObject, never>>([
  [PROPERTY_RESOLUTION_CAPABILITY_ID, PROPERTY_RESOLUTION_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [ASSESSOR_TAX_CAPABILITY_ID, ASSESSOR_TAX_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [LANDPORTAL_RESEARCH_CAPABILITY_ID, LANDPORTAL_RESEARCH_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  // The LandPortal three-tool split: property characteristics, visual capture
  // and comp search are DIFFERENT jobs with separate run states/results. Each
  // ensures its own authenticated session and verifies the canonical subject.
  [
    LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID,
    LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  [
    LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID,
    LANDPORTAL_VISUAL_CAPTURE_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  [
    LANDPORTAL_COMP_SEARCH_CAPABILITY_ID,
    LANDPORTAL_COMP_SEARCH_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  [COMPS_VALUATION_CAPABILITY_ID, COMPS_VALUATION_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  // Two SEPARATE business capabilities sharing search and official-document
  // infrastructure: the first answers what rules apply because of WHERE the
  // parcel is (jurisdiction-scoped, reusable), the second what has happened to
  // THIS parcel (canonical-property-specific, never reused across parcels).
  [ZONING_SUBDIVISION_CAPABILITY_ID, ZONING_SUBDIVISION_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [
    PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
    PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  // The narrowest research capability here: it owns public water, public sewer
  // and their onsite fallbacks, and reuses the existing official parcel lookup
  // and utilities intelligence lane rather than adding a second path to them.
  [
    UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
    UTILITY_SERVICE_SCREEN_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  // The one capability ABOVE the research capabilities: it consumes what they
  // established and returns a judgment. It collects nothing and owns no fact.
  [
    ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
    ACQUISITION_INTELLIGENCE_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  // Geography-scoped market capabilities: placements over the EXISTING Market
  // Matrix / Market Pulse engines. Their prerequisite is county or ZIP — a
  // market question never waits on, or manufactures, a property subject.
  [
    COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
    COUNTY_MARKET_RESEARCH_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  [
    ZIP_MARKET_RESEARCH_CAPABILITY_ID,
    ZIP_MARKET_RESEARCH_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
  [
    MARKET_PULSE_CAPABILITY_ID,
    MARKET_PULSE_CAPABILITY as unknown as LandosCapability<JsonObject, never>,
  ],
]);

// ── Declared capability prerequisites ────────────────────────────────────────
// The minimum context each registered capability itself requires. This is the
// authoritative declaration the orchestrator and Research Readiness plan from;
// there is no global parcel gate. `property-resolution` requires nothing — it
// is the capability that ESTABLISHES the working subject from raw input.
const CAPABILITY_PREREQUISITES: Record<string, CapabilityPrerequisiteClause[]> = {
  [PROPERTY_RESOLUTION_CAPABILITY_ID]: [],
  [ASSESSOR_TAX_CAPABILITY_ID]: ['parcel'],
  [LANDPORTAL_RESEARCH_CAPABILITY_ID]: ['parcel'],
  [LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID]: ['parcel'],
  [LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID]: ['parcel'],
  [LANDPORTAL_COMP_SEARCH_CAPABILITY_ID]: ['parcel'],
  [COMPS_VALUATION_CAPABILITY_ID]: ['parcel'],
  [ZONING_SUBDIVISION_CAPABILITY_ID]: ['parcel'],
  [PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID]: ['parcel'],
  [UTILITY_SERVICE_SCREEN_CAPABILITY_ID]: ['parcel'],
  [ACQUISITION_INTELLIGENCE_CAPABILITY_ID]: ['parcel'],
  [COUNTY_MARKET_RESEARCH_CAPABILITY_ID]: ['county'],
  [ZIP_MARKET_RESEARCH_CAPABILITY_ID]: ['zip'],
  [MARKET_PULSE_CAPABILITY_ID]: ['county'],
};

/** Declared minimum context for a registered capability. An UNDECLARED
 *  capability conservatively requires an established subject. */
export function capabilityPrerequisites(capabilityId: string): CapabilityPrerequisiteClause[] {
  return CAPABILITY_PREREQUISITES[capabilityId] ?? ['parcel'];
}

// ── Operator manifest ────────────────────────────────────────────────────────
// What the Tools catalog needs to present each capability honestly. Declared
// HERE, next to the prerequisites, so there is exactly one registry; the
// per-capability metadata carries it out through the same contract every
// caller already reads. A capability with no entry is not operator-facing.
const PROPERTY_INPUT_HINT = 'An address, APN, owner + county, LandPortal URL, or an existing Deal.';
const CAPABILITY_OPERATOR_MANIFEST: Record<string, CapabilityOperatorManifest> = {
  [PROPERTY_RESOLUTION_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: false,
    inputHint: 'Any raw property reference — address, APN, owner + county, coordinates, or a messy description.',
  },
  [ASSESSOR_TAX_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT,
    skill: 'Public Records Research / Recovery',
    recovery: 'Deterministic official retrieval first; at most one governed specialist recovery when the official paths fall short.',
  },
  [LANDPORTAL_RESEARCH_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT,
    skill: 'LandPortal Research',
    recovery: 'Deterministic LandPortal workflow with governed recovery when required outputs are incomplete.',
  },
  [LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT, skill: 'LandPortal Research',
  },
  [LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT, skill: 'LandPortal Research',
  },
  [LANDPORTAL_COMP_SEARCH_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT, skill: 'LandPortal Research',
  },
  [COMPS_VALUATION_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT,
    skill: 'Comp / Valuation Research',
  },
  [ZONING_SUBDIVISION_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT,
    skill: 'Government / Zoning & Planning Research',
    recovery: 'Deterministic official-source race first; bounded research only after genuine insufficiency. Zoning is never guessed.',
  },
  [PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: true,
    inputHint: PROPERTY_INPUT_HINT,
    skill: 'Government / Zoning & Planning Research',
  },
  [UTILITY_SERVICE_SCREEN_CAPABILITY_ID]: {
    manualInvocation: false, runsWithoutDeal: false, writesAuthoritativeEvidence: true,
    inputHint: 'Runs from a Deal Card subject.',
  },
  [ACQUISITION_INTELLIGENCE_CAPABILITY_ID]: {
    manualInvocation: false, runsWithoutDeal: false, writesAuthoritativeEvidence: false,
    inputHint: 'Runs from a Deal Card once research capabilities have established facts.',
  },
  [COUNTY_MARKET_RESEARCH_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: false,
    inputHint: 'A county with its state, e.g. "Iredell County, NC".',
  },
  [ZIP_MARKET_RESEARCH_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: false,
    inputHint: 'A 5-digit ZIP, e.g. "28115".',
  },
  [MARKET_PULSE_CAPABILITY_ID]: {
    manualInvocation: true, runsWithoutDeal: true, writesAuthoritativeEvidence: false,
    inputHint: 'A county with its state, e.g. "Iredell County, NC".',
  },
};

/** Operator manifest for a registered capability, or null when it is not
 *  operator-facing. */
export function capabilityOperatorManifest(capabilityId: string): CapabilityOperatorManifest | null {
  return CAPABILITY_OPERATOR_MANIFEST[capabilityId] ?? null;
}

export function listRuntimeCapabilities(): CapabilityMetadata[] {
  return [...CAPABILITIES.values()].map((definition) => ({
    ...definition.metadata,
    prerequisites: capabilityPrerequisites(definition.metadata.id),
    ...(capabilityOperatorManifest(definition.metadata.id) ? { operator: capabilityOperatorManifest(definition.metadata.id)! } : {}),
  }));
}

export function runtimeCapability(capabilityId: string): CapabilityMetadata | null {
  const definition = CAPABILITIES.get(capabilityId);
  if (!definition) return null;
  return {
    ...definition.metadata,
    prerequisites: capabilityPrerequisites(capabilityId),
    ...(capabilityOperatorManifest(capabilityId) ? { operator: capabilityOperatorManifest(capabilityId)! } : {}),
  };
}

export async function invokeRuntimeCapability(
  request: CapabilityInvocationRequest,
  runtime: RuntimeCapabilityRuntime = {},
): Promise<CapabilityResult> {
  const definition = CAPABILITIES.get(request.capabilityId);
  if (!definition) throw new Error(`unknown LandOS capability ${request.capabilityId}`);
  return invokeCapabilityDefinition({
    definition,
    request,
    runtime: runtime as never,
    persistence: new CapabilityInvocationStore(),
  });
}
