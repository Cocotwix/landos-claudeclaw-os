import {
  invokeCapabilityDefinition,
  type CapabilityInvocationRequest,
  type CapabilityMetadata,
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
  PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY,
  PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
  type PropertyDevelopmentHistoryRuntime,
} from './property-development-history-capability.js';
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
  & UtilityServiceScreenRuntime & AcquisitionIntelligenceRuntimeDeps;

const CAPABILITIES = new Map<string, LandosCapability<JsonObject, never>>([
  [PROPERTY_RESOLUTION_CAPABILITY_ID, PROPERTY_RESOLUTION_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [ASSESSOR_TAX_CAPABILITY_ID, ASSESSOR_TAX_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [LANDPORTAL_RESEARCH_CAPABILITY_ID, LANDPORTAL_RESEARCH_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
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
]);

export function listRuntimeCapabilities(): CapabilityMetadata[] {
  return [...CAPABILITIES.values()].map((definition) => ({ ...definition.metadata }));
}

export function runtimeCapability(capabilityId: string): CapabilityMetadata | null {
  return CAPABILITIES.get(capabilityId)?.metadata ?? null;
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
