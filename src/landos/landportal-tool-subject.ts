// LandOS — shared canonical-subject handoff for the three LandPortal tools
// (Property Characteristics, Visual Capture, Comp Search).
//
// One rule, shared verbatim with LandPortal Research: the canonical subject
// comes from Property Resolution or the Deal Card, never from the tool. Raw
// operator input is delegated to the Property Resolution Capability; a
// canonical property is cross-checked against its Deal Card; and the tool may
// refresh the record but never repoint the property.

import type {
  CanonicalSubjectReference,
  CapabilityEvidenceReference,
  CapabilityInvocationRequest,
  CapabilityResult,
  SubjectResolutionState,
} from './capability-contract.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { getLandosDb } from './db.js';
import { landPortalParcelUrl } from './landportal-api.js';
import { validateLandPortalSubjectUrl } from './landportal-operating-rules.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';

export interface LandPortalToolSubject {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  owner: string | null;
  acres: number | null;
  lat: number | null;
  lng: number | null;
  fips: string | null;
  landPortalPropertyId: string | null;
  /** The retained canonical parcel deep link, when one exists. */
  parcelUrl: string | null;
}

export interface LandPortalToolSubjectResolution {
  subject: LandPortalToolSubject;
  canonicalSubject: CanonicalSubjectReference | null;
  subjectResolution: SubjectResolutionState;
  warnings: string[];
  resolutionEvidence: CapabilityEvidenceReference[];
  missingInformation: string[];
}

export interface LandPortalToolSubjectRuntime {
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /** Property-card enrichment read (lp_url/fips/lat/lng/acres). Tests override. */
  loadCardFacts?: (propertyCardId: number) => CardFacts | null;
}

interface CardFacts {
  lpUrl: string | null;
  fips: string | null;
  lat: number | null;
  lng: number | null;
  acres: number | null;
  lpPropertyId: string | null;
}

const str = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return raw && !/^(?:-|--|n\/?a|none|unknown)$/i.test(raw) ? raw : null;
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

function loadCardFactsFromDb(propertyCardId: number): CardFacts | null {
  try {
    const row = getLandosDb()
      .prepare('SELECT lp_url, fips, lat, lng, acres, lp_property_id FROM landos_property_card WHERE id = ?')
      .get(propertyCardId) as { lp_url?: string; fips?: string; lat?: number; lng?: number; acres?: number; lp_property_id?: string } | undefined;
    if (!row) return null;
    return {
      lpUrl: str(row.lp_url),
      fips: str(row.fips),
      lat: num(row.lat),
      lng: num(row.lng),
      acres: num(row.acres),
      lpPropertyId: str(row.lp_property_id),
    };
  } catch {
    return null;
  }
}

/** The subject's canonical LandPortal parcel deep link: the retained/validated
 *  card URL when present, else deterministically rebuilt from the identity
 *  triple. Null when neither exists — a tool never searches for a subject. */
export function subjectCanonicalParcelUrl(subject: LandPortalToolSubject): string | null {
  if (subject.parcelUrl) {
    const validated = validateLandPortalSubjectUrl(subject.parcelUrl);
    if (validated.valid && validated.canonicalUrl) return validated.canonicalUrl;
  }
  if (subject.fips && subject.apn && subject.landPortalPropertyId) {
    return landPortalParcelUrl({ fips: subject.fips, apn: subject.apn, propertyId: subject.landPortalPropertyId });
  }
  return null;
}

/** Resolve the tool's subject exactly the way LandPortal Research does. */
export async function resolveLandPortalToolSubject(
  request: CapabilityInvocationRequest,
  runtime: LandPortalToolSubjectRuntime,
): Promise<LandPortalToolSubjectResolution> {
  const warnings: string[] = [];
  const loadFacts = runtime.loadCardFacts ?? loadCardFactsFromDb;

  if (request.subject.kind === 'canonical_property') {
    const propertyCardId = request.subject.propertyCardId;
    const dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId);
    if (!dealCardId) throw new Error(`canonical property ${propertyCardId} is not linked to a Deal Card`);
    const retained = readResolverSubject(dealCardId);
    if (!retained || retained.propertyCardId !== propertyCardId || retained.entity !== request.subject.entity) {
      throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
    }
    const card = loadFacts(propertyCardId);
    const evaluation = evaluateResolverIdentity(retained);
    if (!evaluation.sufficient) warnings.push(...evaluation.conflicts);
    return {
      subject: {
        propertyCardId,
        dealCardId,
        address: retained.address,
        city: retained.city,
        county: retained.county,
        state: retained.state,
        zip: retained.zip,
        apn: retained.apn,
        owner: retained.owner,
        acres: retained.acres ?? card?.acres ?? null,
        lat: retained.lat ?? card?.lat ?? null,
        lng: retained.lng ?? card?.lng ?? null,
        fips: retained.fips ?? card?.fips ?? null,
        landPortalPropertyId: retained.lpPropertyId ?? card?.lpPropertyId ?? null,
        parcelUrl: card?.lpUrl ?? null,
      },
      canonicalSubject: { kind: 'property', id: String(propertyCardId), propertyCardId, dealCardId, temporary: false },
      subjectResolution: evaluation.sufficient ? 'RESOLVED' : 'UNRESOLVED',
      warnings,
      resolutionEvidence: [],
      missingInformation: [],
    };
  }

  // Raw operator input: Property Resolution owns it; the tool consumes.
  const resolution = runtime.resolveSubject
    ? await runtime.resolveSubject(request)
    : await (await import('./capability-registry.js')).invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: request.caller,
      subject: request.subject,
      mode: request.mode ?? 'reuse',
      context: request.context ?? {},
    });
  warnings.push(...resolution.warnings);
  const identity = (resolution.facts.canonicalIdentity ?? {}) as Record<string, unknown>;
  const canonicalSubject = resolution.canonicalSubject;
  const propertyCardId = canonicalSubject?.propertyCardId ?? null;
  const card = propertyCardId != null ? loadFacts(propertyCardId) : null;
  return {
    subject: {
      propertyCardId,
      dealCardId: canonicalSubject?.dealCardId ?? null,
      address: str(identity.address),
      city: str(identity.city),
      county: str(identity.county),
      state: str(identity.state),
      zip: str(identity.zip),
      apn: str(identity.apn),
      owner: str(identity.owner),
      acres: card?.acres ?? num(identity.acres),
      lat: card?.lat ?? null,
      lng: card?.lng ?? null,
      fips: card?.fips ?? str(identity.fips),
      landPortalPropertyId: str(identity.lpPropertyId) ?? str(identity.landPortalPropertyId) ?? card?.lpPropertyId ?? null,
      parcelUrl: card?.lpUrl ?? str(identity.landPortalParcelUrl),
    },
    canonicalSubject,
    subjectResolution: resolution.subjectResolution,
    warnings,
    resolutionEvidence: resolution.evidence,
    missingInformation: resolution.missingInformation,
  };
}

/** Shared context guard: a caller may never smuggle facts in as the subject. */
export function assertNoCallerAssertions(context: Record<string, unknown> | undefined, toolName: string): void {
  const reserved = /^(?:apn|acres|acreage|owner|parcelUrl|wetlands|fema|buildability|roadFrontage|landLocked|comparables|comps|facts|evidence|price|valuation)$/i;
  const asserts = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(asserts);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => reserved.test(key) || asserts(child));
  };
  if (asserts(context ?? {})) {
    throw new Error(`${toolName} context cannot contain caller-supplied parcel, comparable, or evidence assertions`);
  }
}
