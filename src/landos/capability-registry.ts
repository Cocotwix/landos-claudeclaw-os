import {
  invokeCapabilityDefinition,
  type CapabilityInvocationRequest,
  type CapabilityMetadata,
  type CapabilityResult,
} from './capability-contract.js';
import { CapabilityInvocationStore } from './capability-store.js';
import {
  PROPERTY_RESOLUTION_CAPABILITY,
  PROPERTY_RESOLUTION_CAPABILITY_ID,
  type PropertyResolutionRuntime,
} from './property-resolution-capability.js';

const CAPABILITIES = new Map([
  [PROPERTY_RESOLUTION_CAPABILITY_ID, PROPERTY_RESOLUTION_CAPABILITY],
]);

export function listRuntimeCapabilities(): CapabilityMetadata[] {
  return [...CAPABILITIES.values()].map((definition) => ({ ...definition.metadata }));
}

export function runtimeCapability(capabilityId: string): CapabilityMetadata | null {
  return CAPABILITIES.get(capabilityId)?.metadata ?? null;
}

export async function invokeRuntimeCapability(
  request: CapabilityInvocationRequest,
  runtime: PropertyResolutionRuntime = {},
): Promise<CapabilityResult> {
  const definition = CAPABILITIES.get(request.capabilityId);
  if (!definition) throw new Error(`unknown LandOS capability ${request.capabilityId}`);
  return invokeCapabilityDefinition({
    definition,
    request,
    runtime,
    persistence: new CapabilityInvocationStore(),
  });
}
