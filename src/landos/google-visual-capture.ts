// LandOS — explicit per-property Google visual CAPTURE (network + local store).
//
// This is the ONLY path that calls Google. It is invoked exclusively by an
// explicit operator-run capture for a single property — NEVER by tests, dashboard
// startup, or any automatic/looping workflow. It fetches the Static Map + Street
// View images once, stores the bytes locally (gitignored store/visuals/), records
// usage via the light guard, and returns captured-asset metadata for the Visual
// Property Context. The API key is read here only and never returned/logged.
//
// Tests exercise this with an INJECTED fetch (no real Google call, no key, no
// network) to prove store/record behavior.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { landosArtifactPath } from './storage-profile.js';

import {
  GOOGLE_MAPS_ENV_KEY,
  buildStaticMapUrl,
  buildStreetViewUrl,
  buildStreetViewMetadataUrl,
  bearingDegrees,
  googleVisualConfigured,
  type Coords,
  type VisualService,
} from './providers/google-visual.js';
import { recordVisualCapture } from './google-visual-guard.js';
import {
  isMultiApnString,
  looksLikeApnIntakeText,
  MAX_PARCEL_CONTEXT_DISTANCE_M,
  type VisualAssociation,
} from './visual-eligibility.js';

export type FetchBinary = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

export interface CaptureInput {
  propertyLabel: string;            // address/identifier label for the usage log (never a secret)
  address: string | null;
  coords?: Coords | null;
  /** The owning Deal Card / property card id. REQUIRED for correct image
   *  association — the stored filename is keyed by it so two cards that share an
   *  address label never collide onto the same file (the cross-card image bug). */
  cardId?: number;
  /** Parcel-association evidence for the coordinates. REQUIRED for a capture:
   *  which verified parcel evidence produced `coords`. Without it the capture is
   *  refused — a filename or address string is never association proof. */
  association?: {
    apn?: string | null;
    basis: 'verified_parcel_coordinates' | 'verified_parcel_centroid' | 'verified_parcel_geometry';
  };
}
export interface CaptureDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchBinary;          // injected in tests; default = global fetch
  now?: () => string;
  storeDir?: string;                // default store/visuals (gitignored)
  usageFile?: string;
}
export interface CapturedAsset { service: VisualService; storedPath: string; timestamp: string }
export interface CaptureResult {
  captured: boolean;
  reason: string;
  assets: Partial<Record<VisualService, { storedPath: string; timestamp: string; association?: VisualAssociation }>>;
}

// Card-scoped filename: the cardId is part of the hash so two Deal Cards that
// share the same address label can NEVER write/read the same file. When no cardId
// is supplied the label still scopes it, but callers should always pass cardId.
function safeName(cardId: number | undefined, label: string, service: string): string {
  const scope = cardId != null ? `card${cardId}` : label;
  const h = crypto.createHash('sha256').update(`${scope}:${label}:${service}`).digest('hex').slice(0, 16);
  return `${service}_${cardId != null ? `c${cardId}_` : ''}${h}.png`;
}

/**
 * Explicitly capture and store visuals for ONE property. Gated: makes no call
 * unless configured AND a target (address/coords) exists. One request per image
 * type, no loops, no batch. Records each capture in the usage guard.
 */
export async function capturePropertyVisuals(input: CaptureInput, deps: CaptureDeps = {}): Promise<CaptureResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date().toISOString());
  const assets: CaptureResult['assets'] = {};

  if (!googleVisualConfigured(env)) {
    return { captured: false, reason: 'Google visual not configured (no GOOGLE_MAPS_API_KEY). No call made.', assets };
  }
  // ── Parcel-association gate (the De Queen regression fix) ──────────────────
  // Google imagery is generated ONLY from verified parcel coordinates with a
  // recorded association basis. Raw intake text, multi-APN strings, and bare
  // address strings are NEVER sent to Google — a geocoder would happily return a
  // city centroid or a nearby business and the image would look plausible while
  // depicting the wrong place.
  if (isMultiApnString(input.address) || isMultiApnString(input.propertyLabel)) {
    return { captured: false, reason: 'Parcel location not yet resolved — capture target is an unresolved multi-APN intake string. No Google imagery generated.', assets };
  }
  const inputCoords = input.coords ?? null;
  const inputAssociation = input.association ?? null;
  if (!inputCoords) {
    return { captured: false, reason: 'Parcel image unavailable — verified parcel coordinates are not available yet, so no Static Map or Street View was generated (never from raw text).', assets };
  }
  if (!inputAssociation?.basis) {
    return { captured: false, reason: 'Parcel image unavailable — the coordinates lack a recorded parcel-association basis, so no Google imagery was generated.', assets };
  }
  // Coordinates drive the capture; an APN-shaped address string must not ride
  // along into any Google URL (it is not an address). Addresses are never used
  // as a capture target in any case — URLs below are coords-only.

  const key = (env[GOOGLE_MAPS_ENV_KEY] ?? '').trim();
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchBinary);
  const storeDir = deps.storeDir ?? landosArtifactPath('visuals');
  fs.mkdirSync(storeDir, { recursive: true });

  const coords = inputCoords;
  const coordQuery = `${coords.lat},${coords.lng}`;

  // Street View requires POSITION PROOF: the pano must actually stand within an
  // accepted distance of the verified parcel location (frontage). Look up the
  // real pano location (free metadata call); aim the camera at the parcel; and
  // when the nearest pano is too far — or metadata is unavailable — capture NO
  // Street View at all rather than a misleading nearby street.
  let svHeading: number | undefined;
  let svPano: Coords | null = null;
  let svDistanceM: number | null = null;
  try {
    const metaUrl = buildStreetViewMetadataUrl({ address: null, coords, key, radius: MAX_PARCEL_CONTEXT_DISTANCE_M });
    const metaRes = await fetchImpl(metaUrl);
    if (metaRes.ok) {
      const meta = JSON.parse(Buffer.from(await metaRes.arrayBuffer()).toString('utf8')) as { status?: string; location?: { lat?: number; lng?: number } };
      if (meta.status === 'OK' && typeof meta.location?.lat === 'number' && typeof meta.location?.lng === 'number') {
        svPano = { lat: meta.location.lat, lng: meta.location.lng };
        svHeading = bearingDegrees(svPano, coords);
        svDistanceM = haversineMeters(svPano, coords);
      }
    }
  } catch { /* no metadata → no Street View capture (never an unproven pano) */ }

  const baseAssociation: VisualAssociation = {
    targetKind: 'parcel',
    cardId: input.cardId ?? null,
    apn: inputAssociation.apn ?? null,
    sourceCoords: coords,
    basis: inputAssociation.basis,
    captureQuery: coordQuery,
    parcelBasis: inputAssociation.basis === 'verified_parcel_geometry' ? 'geometry' : inputAssociation.basis === 'verified_parcel_centroid' ? 'centroid' : 'coordinates',
    capturedAt: now(),
  };

  // Every Google URL is built from COORDINATES ONLY — never an address string.
  const plan: Array<{ service: VisualService; url: string; association: VisualAssociation }> = [
    {
      service: 'maps_static',
      url: buildStaticMapUrl({ address: null, coords, key }),
      association: { ...baseAssociation, sourceService: 'maps_static' },
    },
  ];
  if (svPano && svDistanceM != null && svDistanceM <= MAX_PARCEL_CONTEXT_DISTANCE_M) {
    plan.push({
      service: 'street_view_static',
      // Target the exact metadata-returned panorama. Querying the parcel centroid
      // again would use Google's smaller default search radius and can return no
      // image even after the wider, distance-checked metadata lookup succeeded.
      url: buildStreetViewUrl({ address: null, coords: svPano, key, heading: svHeading }),
      association: {
        ...baseAssociation,
        basis: 'parcel_nearby_street_view',
        sourceService: 'street_view_static',
        distanceToParcelM: Math.round(svDistanceM),
      },
    });
  } else {
    recordVisualCapture({ property: input.propertyLabel, service: 'street_view_static', success: false, now }, deps.usageFile);
  }

  for (const { service, url, association } of plan) {
    let success = false;
    try {
      const res = await fetchImpl(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const file = path.join(storeDir, safeName(input.cardId, input.propertyLabel, service));
        fs.writeFileSync(file, buf);
        assets[service] = { storedPath: file, timestamp: now(), association };
        success = true;
      }
    } catch {
      success = false;
    }
    recordVisualCapture({ property: input.propertyLabel, service, success, now }, deps.usageFile);
  }

  const capturedAny = Object.keys(assets).length > 0;
  return {
    captured: capturedAny,
    reason: capturedAny
      ? 'Captured verified parcel image(s) from verified parcel coordinates.'
      : svPano == null
        ? 'No parcel image captured — no Street View coverage proof and the satellite request failed or returned nothing.'
        : 'No parcel image captured (provider error or no coverage).',
    assets,
  };
}

/** Great-circle distance in meters (pano-to-parcel frontage check). */
function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
