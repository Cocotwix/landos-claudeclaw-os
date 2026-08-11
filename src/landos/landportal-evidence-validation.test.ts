import { describe, expect, it } from 'vitest';
import { validateLandPortalVisualEvidence, type LandPortalVisualValidationInput } from './landportal-evidence-validation.js';

const valid = (overrides: Partial<LandPortalVisualValidationInput> = {}): LandPortalVisualValidationInput => ({
  propertyCardId: 10,
  expectedPropertyCardId: 10,
  subjectClassification: 'verified_subject',
  requestedView: 'wetlands',
  activeView: 'wetlands',
  boundaryRequired: true,
  boundaryVisible: true,
  tilesLoaded: true,
  bytes: 700_000,
  sha256: 'wetlands-hash',
  priorSha256s: ['base-hash'],
  cameraScale: 'parcel',
  clipped: false,
  obstructions: [],
  ...overrides,
});

describe('LandPortal visual evidence admission', () => {
  it('accepts only the verified subject with the requested rendered view', () => {
    expect(validateLandPortalVisualEvidence(valid()).status).toBe('accepted');
  });

  it.each([
    ['neighbor/context parcel', { propertyCardId: 11 }],
    ['national map', { cameraScale: 'national' as const }],
    ['blank image', { bytes: 1_000 }],
    ['duplicate image', { sha256: 'base-hash' }],
    ['incorrect overlay', { activeView: 'fema_flood' as const }],
    ['clipped parcel', { clipped: true }],
  ])('rejects %s evidence', (_label, overrides) => {
    expect(validateLandPortalVisualEvidence(valid(overrides)).status).toBe('rejected');
  });

  it('retains honest context classification without allowing no-match evidence', () => {
    expect(validateLandPortalVisualEvidence(valid({ subjectClassification: 'context_only' })).status).toBe('accepted');
    expect(validateLandPortalVisualEvidence(valid({ subjectClassification: 'no_match' })).status).toBe('rejected');
  });
});

