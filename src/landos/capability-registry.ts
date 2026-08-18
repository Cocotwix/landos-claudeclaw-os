import {
  invokeCapabilityDefinition,
  type CapabilityInvocationRequest,
  type CapabilityMetadata,
  type CapabilityResult,
  type JsonObject,
  type LandosCapability,
} from './capability-contract.js';
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
  PROPERTY_RESOLUTION_CAPABILITY,
  PROPERTY_RESOLUTION_CAPABILITY_ID,
  type PropertyResolutionRuntime,
} from './property-resolution-capability.js';

/** Every runtime a registered LandOS capability accepts. */
export type RuntimeCapabilityRuntime = PropertyResolutionRuntime & AssessorTaxRuntime & LandPortalResearchRuntime
  & CompsValuationRuntime;

const CAPABILITIES = new Map<string, LandosCapability<JsonObject, never>>([
  [PROPERTY_RESOLUTION_CAPABILITY_ID, PROPERTY_RESOLUTION_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [ASSESSOR_TAX_CAPABILITY_ID, ASSESSOR_TAX_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [LANDPORTAL_RESEARCH_CAPABILITY_ID, LANDPORTAL_RESEARCH_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
  [COMPS_VALUATION_CAPABILITY_ID, COMPS_VALUATION_CAPABILITY as unknown as LandosCapability<JsonObject, never>],
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
