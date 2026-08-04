// Deterministic admission contract for LandPortal visual evidence.

export type LandPortalVisualView =
  | 'parcel_context'
  | 'road_frontage'
  | 'wetlands'
  | 'fema_flood'
  | 'soil'
  | 'contours'
  | 'front_3d'
  | 'rear_3d'
  | 'comparables_map';

export interface LandPortalVisualValidationInput {
  propertyCardId: number;
  expectedPropertyCardId: number;
  subjectClassification: 'verified_subject' | 'context_only' | 'no_match';
  requestedView: LandPortalVisualView;
  activeView: LandPortalVisualView | null;
  boundaryRequired: boolean;
  boundaryVisible: boolean;
  tilesLoaded: boolean;
  bytes: number;
  sha256: string | null;
  priorSha256s: string[];
  cameraScale: 'parcel' | 'context' | 'county' | 'national' | 'unknown';
  clipped: boolean;
  obstructions: string[];
}

export interface LandPortalVisualValidation {
  status: 'accepted' | 'rejected';
  propertyCardId: number;
  subjectClassification: 'verified_subject' | 'context_only';
  requestedView: LandPortalVisualView;
  activeView: LandPortalVisualView | null;
  boundaryVisible: boolean;
  sha256: string | null;
  bytes: number;
  validatedAt: string;
  reasons: string[];
}

export function validateLandPortalVisualEvidence(
  input: LandPortalVisualValidationInput,
  now: () => string = () => new Date().toISOString(),
): LandPortalVisualValidation {
  const reasons: string[] = [];
  if (input.propertyCardId !== input.expectedPropertyCardId) reasons.push('visual belongs to a different Property Card');
  if (input.subjectClassification === 'no_match') reasons.push('no subject parcel match was established');
  if (input.activeView !== input.requestedView) reasons.push(`active view is ${input.activeView ?? 'unknown'}, requested ${input.requestedView}`);
  if (input.boundaryRequired && !input.boundaryVisible) reasons.push('subject parcel boundary is not visible');
  if (!input.tilesLoaded) reasons.push('map tiles are blank or still loading');
  if (!Number.isFinite(input.bytes) || input.bytes < 8 * 1024) reasons.push('image is blank or torn');
  if (!input.sha256) reasons.push('image could not be hashed');
  else if (input.priorSha256s.includes(input.sha256)) reasons.push('image duplicates retained evidence');
  if (input.cameraScale === 'national') reasons.push('image is a national map, not parcel evidence');
  if (input.cameraScale === 'county') reasons.push('image is county-scale and does not prove parcel detail');
  if (input.cameraScale === 'unknown') reasons.push('parcel-scale framing was not proven');
  if (input.clipped) reasons.push('subject parcel or requested map viewport is clipped');
  if (input.obstructions.length) reasons.push(`image is obstructed by ${input.obstructions.join(', ')}`);
  return {
    status: reasons.length ? 'rejected' : 'accepted',
    propertyCardId: input.propertyCardId,
    subjectClassification: input.subjectClassification === 'verified_subject' ? 'verified_subject' : 'context_only',
    requestedView: input.requestedView,
    activeView: input.activeView,
    boundaryVisible: input.boundaryVisible,
    sha256: input.sha256,
    bytes: input.bytes,
    validatedAt: now(),
    reasons,
  };
}

export function isAcceptedLandPortalVisual(value: unknown): value is LandPortalVisualValidation {
  return !!value && typeof value === 'object'
    && (value as LandPortalVisualValidation).status === 'accepted'
    && Array.isArray((value as LandPortalVisualValidation).reasons)
    && (value as LandPortalVisualValidation).reasons.length === 0;
}

export function isAcceptedLandPortalVisualForProperty(value: unknown, propertyCardId: number): value is LandPortalVisualValidation {
  return isAcceptedLandPortalVisual(value) && value.propertyCardId === propertyCardId;
}
