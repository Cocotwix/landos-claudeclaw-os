// LandOS — explicit per-property Google visual CAPTURE (network + local store).
//
// This is the ONLY path that calls Google. It is invoked exclusively by an
// explicit operator-run capture for a single property — NEVER by tests, dashboard
// startup, or any automatic/looping workflow. It fetches the Static Map + Street
// View images once, stores the bytes locally (gitignored store/visuals/), records
// usage via the light guard, and returns captured-asset metadata for the Visual
// Property Context. The API key is read here only and never returned/logged.
//
// Street View is a real visual investigation, not a guess:
//
//   1. the aerial/parcel view is captured first, so the apparent driveway or
//      private-road route can actually be looked at;
//   2. junction candidates traced from that imagery are accepted from the caller
//      — coordinates only, never a road name, address, or remembered description;
//   3. the parcel frontage is probed first, then every traced junction, then a
//      systematic sweep of the surrounding roads, so several plausible
//      connection points are inspected when several exist;
//   4. a panorama is only used when it genuinely stands within frontage distance
//      of the parcel; and
//   5. when no usable panorama exists anywhere, that is reported truthfully
//      instead of degrading into an assumption.
//
// A VISUAL OBSERVATION MAY ONLY EXIST WHERE AN IMAGE EXISTS. `visualObservation`
// is the only constructor for one, and it refuses unless the stored artifact is
// present on disk and hashes. Prompt text, remembered descriptions and
// assumptions therefore cannot become a finding.
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
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

/**
 * A connection point between the apparent physical route and a public road,
 * TRACED FROM RETAINED IMAGERY. Coordinates only: a road name or address would
 * be an assumption about where the access meets the road, and this module never
 * accepts one.
 */
export interface TracedAccessJunction {
  label: string;
  coords: Coords;
  /** The retained aerial/parcel artifact the route was traced on. */
  tracedFromArtifact: string;
}

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
    basis: 'verified_parcel_coordinates' | 'verified_parcel_centroid' | 'verified_parcel_geometry' | 'landportal_matched_parcel_coordinates';
  };
  /** Junctions traced from the aerial toward the nearest public/named road. */
  tracedJunctions?: TracedAccessJunction[];
}
export interface CaptureDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchBinary;          // injected in tests; default = global fetch
  now?: () => string;
  storeDir?: string;                // default store/visuals (gitignored)
  usageFile?: string;
  /** Shared network deadline for metadata plus every image request. */
  timeoutMs?: number;
  nowMs?: () => number;
  /**
   * Distances (metres) at which the surrounding roads are swept for a panorama
   * when the parcel frontage itself has none. Bounded on purpose — this is an
   * investigation, not an unbounded search.
   */
  surroundingSweepMeters?: number[];
}
export interface CapturedAsset { service: VisualService; storedPath: string; timestamp: string }

/** One connection point that was actually looked at. */
export interface StreetViewProbe {
  label: string;
  /** Where the workflow looked from (a plausible access-to-road junction). */
  origin: Coords;
  /** The panorama Google actually holds there, or null when it holds none. */
  pano: Coords | null;
  distanceToParcelM: number | null;
  headingToParcelDeg: number | null;
  usable: boolean;
  note: string;
}

export interface StreetViewInvestigation {
  attempted: boolean;
  coverage: 'captured' | 'no_usable_coverage' | 'not_attempted';
  reason: string;
  /** Every connection point inspected, in probe order. */
  probes: StreetViewProbe[];
  /** The junction the panorama was captured at, when one was usable. */
  junction: StreetViewProbe | null;
}

export interface CaptureResult {
  captured: boolean;
  reason: string;
  assets: Partial<Record<VisualService, { storedPath: string; timestamp: string; sha256?: string; association?: VisualAssociation }>>;
  /**
   * What the Street View investigation actually did and found.
   * `capturePropertyVisuals` always populates this; it is optional only so an
   * injected test double may omit it.
   */
  streetView?: StreetViewInvestigation;
}

/**
 * A finding that is BACKED BY A RETAINED IMAGE. There is no other shape a
 * visual observation can take in LandOS, and no way to build one without the
 * artifact — see `visualObservation`.
 */
export interface VisualObservation {
  label: string;
  detail: string;
  service: VisualService;
  basis: 'direct_observation';
  artifact: { storedPath: string; sha256: string; bytes: number; timestamp: string };
}

/**
 * The ONLY constructor for a visual observation. Returns null unless the named
 * artifact is a real retained image on disk, so a description that no image
 * supports cannot become a finding. Callers record `null` as "not observed",
 * never as an unbacked claim.
 */
export function visualObservation(
  asset: { service: VisualService; storedPath: string; timestamp: string } | null | undefined,
  finding: { label: string; detail: string },
): VisualObservation | null {
  const label = finding.label.trim();
  const detail = finding.detail.trim();
  if (!asset?.storedPath || !label || !detail) return null;
  let bytes: Buffer;
  try {
    if (!fs.statSync(asset.storedPath).isFile()) return null;
    bytes = fs.readFileSync(asset.storedPath);
  } catch {
    return null;
  }
  if (!bytes.byteLength) return null;
  return {
    label,
    detail,
    service: asset.service,
    basis: 'direct_observation',
    artifact: {
      storedPath: asset.storedPath,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      timestamp: asset.timestamp,
    },
  };
}

/** True when this observation is genuinely backed by a retained image. */
export function observationIsArtifactBacked(observation: VisualObservation | null | undefined): boolean {
  if (!observation?.artifact?.sha256 || !observation.artifact.storedPath) return false;
  try {
    return fs.statSync(observation.artifact.storedPath).isFile();
  } catch {
    return false;
  }
}

// Card-scoped filename: the cardId is part of the hash so two Deal Cards that
// share the same address label can NEVER write/read the same file. When no cardId
// is supplied the label still scopes it, but callers should always pass cardId.
function safeName(cardId: number | undefined, label: string, service: string): string {
  const scope = cardId != null ? `card${cardId}` : label;
  const h = crypto.createHash('sha256').update(`${scope}:${label}:${service}`).digest('hex').slice(0, 16);
  return `${service}_${cardId != null ? `c${cardId}_` : ''}${h}.png`;
}

const NOT_ATTEMPTED = (reason: string): StreetViewInvestigation => ({
  attempted: false, coverage: 'not_attempted', reason, probes: [], junction: null,
});

/** Offset a coordinate by metres along a compass bearing. */
function offsetCoords(from: Coords, bearingDeg: number, meters: number): Coords {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const δ = meters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(from.lat);
  const λ1 = toRad(from.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
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
    return { captured: false, reason: 'Google visual not configured (no GOOGLE_MAPS_API_KEY). No call made.', assets, streetView: NOT_ATTEMPTED('Google visual is not configured, so no Street View investigation ran.') };
  }
  // ── Parcel-association gate (the De Queen regression fix) ──────────────────
  // Google imagery is generated ONLY from verified parcel coordinates with a
  // recorded association basis. Raw intake text, multi-APN strings, and bare
  // address strings are NEVER sent to Google — a geocoder would happily return a
  // city centroid or a nearby business and the image would look plausible while
  // depicting the wrong place.
  if (isMultiApnString(input.address) || isMultiApnString(input.propertyLabel)) {
    return { captured: false, reason: 'Parcel location not yet resolved — capture target is an unresolved multi-APN intake string. No Google imagery generated.', assets, streetView: NOT_ATTEMPTED('Capture target is an unresolved multi-APN intake string.') };
  }
  const inputCoords = input.coords ?? null;
  const inputAssociation = input.association ?? null;
  if (!inputCoords) {
    return { captured: false, reason: 'Parcel image unavailable — verified parcel coordinates are not available yet, so no Static Map or Street View was generated (never from raw text).', assets, streetView: NOT_ATTEMPTED('Verified parcel coordinates are not available yet.') };
  }
  if (!inputAssociation?.basis) {
    return { captured: false, reason: 'Parcel image unavailable — the coordinates lack a recorded parcel-association basis, so no Google imagery was generated.', assets, streetView: NOT_ATTEMPTED('The coordinates lack a recorded parcel-association basis.') };
  }
  // Coordinates drive the capture; an APN-shaped address string must not ride
  // along into any Google URL (it is not an address). Addresses are never used
  // as a capture target in any case — URLs below are coords-only.

  const key = (env[GOOGLE_MAPS_ENV_KEY] ?? '').trim();
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchBinary);
  const storeDir = deps.storeDir ?? landosArtifactPath('visuals');
  fs.mkdirSync(storeDir, { recursive: true });
  const nowMs = deps.nowMs ?? Date.now;
  const deadlineMs = nowMs() + Math.max(1, deps.timeoutMs ?? 25_000);
  const fetchWithDeadline = async (url: string): ReturnType<FetchBinary> => {
    const remaining = deadlineMs - nowMs();
    if (remaining <= 0) throw new Error('Google visual capture deadline exhausted.');
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        fetchImpl(url, { signal: abort.signal }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error('Google visual request timed out.'));
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const coords = inputCoords;
  const coordQuery = `${coords.lat},${coords.lng}`;

  // ── Street View: position proof, from a real investigation ─────────────────
  // A panorama is only used when it actually STANDS within frontage distance of
  // the verified parcel. The parcel frontage is probed first — when Google holds
  // a panorama there, that IS the point where the access meets the public road.
  // Only when it does not are the traced junctions and the surrounding roads
  // swept, so several plausible connection points get inspected rather than one
  // assumption being made.
  const probes: StreetViewProbe[] = [];
  const probeJunction = async (label: string, origin: Coords): Promise<StreetViewProbe> => {
    const probe: StreetViewProbe = {
      label, origin, pano: null, distanceToParcelM: null, headingToParcelDeg: null,
      usable: false, note: 'No Street View panorama is published within range of this point.',
    };
    try {
      const metaUrl = buildStreetViewMetadataUrl({ address: null, coords: origin, key, radius: MAX_PARCEL_CONTEXT_DISTANCE_M });
      const metaRes = await fetchWithDeadline(metaUrl);
      if (metaRes.ok) {
        const meta = JSON.parse(Buffer.from(await metaRes.arrayBuffer()).toString('utf8')) as { status?: string; location?: { lat?: number; lng?: number } };
        if (meta.status === 'OK' && typeof meta.location?.lat === 'number' && typeof meta.location?.lng === 'number') {
          const pano = { lat: meta.location.lat, lng: meta.location.lng };
          const distance = haversineMeters(pano, coords);
          probe.pano = pano;
          probe.distanceToParcelM = distance;
          probe.headingToParcelDeg = bearingDegrees(pano, coords);
          probe.usable = distance <= MAX_PARCEL_CONTEXT_DISTANCE_M;
          probe.note = probe.usable
            ? `A published panorama stands ${distance} m from the parcel; the camera is aimed at the parcel from it.`
            : `The nearest published panorama is ${distance} m from the parcel, beyond the ${MAX_PARCEL_CONTEXT_DISTANCE_M} m frontage limit, so it would not show this parcel.`;
        }
      }
    } catch {
      probe.note = 'The Street View coverage lookup for this point did not complete within the capture deadline.';
    }
    probes.push(probe);
    return probe;
  };

  let junction = await probeJunction('Parcel frontage', coords);
  if (!junction.usable) {
    // Junctions traced from the retained aerial — coordinates only, never a
    // road name. A candidate without traced coordinates is refused rather than
    // guessed at.
    const traced = (input.tracedJunctions ?? []).filter((candidate) =>
      Number.isFinite(candidate.coords?.lat) && Number.isFinite(candidate.coords?.lng)
      && !!candidate.tracedFromArtifact?.trim());
    for (const candidate of traced) {
      if (nowMs() >= deadlineMs) break;
      const probe = await probeJunction(`Traced junction — ${candidate.label}`, candidate.coords);
      if (probe.usable) { junction = probe; break; }
    }
  }
  if (!junction.usable) {
    // Systematic sweep of the surrounding roads, so a parcel set back from its
    // road is still inspected from several sides before anything is concluded.
    const sweep = deps.surroundingSweepMeters ?? [MAX_PARCEL_CONTEXT_DISTANCE_M];
    outer: for (const meters of sweep) {
      for (const bearing of [0, 90, 180, 270]) {
        if (nowMs() >= deadlineMs) break outer;
        const probe = await probeJunction(`Surrounding road sweep — ${bearing}° at ${meters} m`, offsetCoords(coords, bearing, meters));
        if (probe.usable) { junction = probe; break outer; }
      }
    }
  }
  const usableJunction = junction.usable ? junction : null;

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
  if (usableJunction?.pano && usableJunction.distanceToParcelM != null) {
    plan.push({
      service: 'street_view_static',
      // Target the exact metadata-returned panorama. Querying the parcel centroid
      // again would use Google's smaller default search radius and can return no
      // image even after the wider, distance-checked metadata lookup succeeded.
      url: buildStreetViewUrl({ address: null, coords: usableJunction.pano, key, heading: usableJunction.headingToParcelDeg ?? undefined }),
      association: {
        ...baseAssociation,
        basis: 'parcel_nearby_street_view',
        sourceService: 'street_view_static',
        distanceToParcelM: Math.round(usableJunction.distanceToParcelM),
      },
    });
  } else {
    recordVisualCapture({ property: input.propertyLabel, service: 'street_view_static', success: false, now }, deps.usageFile);
  }

  for (const { service, url, association } of plan) {
    let success = false;
    try {
      const res = await fetchWithDeadline(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const file = path.join(storeDir, safeName(input.cardId, input.propertyLabel, service));
        fs.writeFileSync(file, buf);
        assets[service] = {
          storedPath: file,
          timestamp: now(),
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          association,
        };
        success = true;
      }
    } catch {
      success = false;
    }
    recordVisualCapture({ property: input.propertyLabel, service, success, now }, deps.usageFile);
  }

  const streetViewCaptured = !!assets.street_view_static;
  const anyPano = probes.some((probe) => probe.pano);
  const streetView: StreetViewInvestigation = {
    attempted: true,
    coverage: streetViewCaptured ? 'captured' : 'no_usable_coverage',
    reason: streetViewCaptured
      ? `Street View captured at ${usableJunction!.label}, ${usableJunction!.distanceToParcelM} m from the parcel, aimed at it.`
      : usableJunction
        ? 'A usable panorama was found but the Street View image request failed, so no Street View evidence was retained.'
        : anyPano
          ? `Street View coverage exists nearby but every panorama found across ${probes.length} inspected connection point(s) stands beyond the ${MAX_PARCEL_CONTEXT_DISTANCE_M} m frontage limit, so none of them shows this parcel.`
          : `No published Street View panorama was found at any of the ${probes.length} connection point(s) inspected, so usable Street View coverage does not exist for this parcel.`,
    probes,
    junction: streetViewCaptured ? usableJunction : null,
  };

  const capturedAny = Object.keys(assets).length > 0;
  return {
    captured: capturedAny,
    reason: capturedAny
      ? 'Captured verified parcel image(s) from verified parcel coordinates.'
      : !anyPano
        ? 'No parcel image captured — no Street View coverage proof and the satellite request failed or returned nothing.'
        : 'No parcel image captured (provider error or no coverage).',
    assets,
    streetView,
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
