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

export type FetchBinary = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

export interface CaptureInput {
  propertyLabel: string;            // address/identifier label for the usage log (never a secret)
  address: string | null;
  coords?: Coords | null;
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
  assets: Partial<Record<VisualService, { storedPath: string; timestamp: string }>>;
}

function safeName(label: string, service: string): string {
  const h = crypto.createHash('sha256').update(`${label}:${service}`).digest('hex').slice(0, 16);
  return `${service}_${h}.png`;
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
  const target = input.coords ?? input.address ?? null;
  if (!target) {
    return { captured: false, reason: 'No address or coordinates for this property — nothing to capture (never uses proximity).', assets };
  }

  const key = (env[GOOGLE_MAPS_ENV_KEY] ?? '').trim();
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchBinary);
  const storeDir = deps.storeDir ?? path.join(process.cwd(), 'store', 'visuals');
  fs.mkdirSync(storeDir, { recursive: true });

  // Aim Street View AT the parcel: look up the actual pano location (free
  // metadata call), then set heading = bearing(pano → parcel) so the camera faces
  // the subject instead of a default direction / meaningless pavement. Best-effort;
  // falls back to an un-oriented Street View when metadata/coords are unavailable.
  let svHeading: number | undefined;
  if (input.coords) {
    try {
      const metaUrl = buildStreetViewMetadataUrl({ address: input.address, coords: input.coords, key });
      const metaRes = await fetchImpl(metaUrl);
      if (metaRes.ok) {
        const meta = JSON.parse(Buffer.from(await metaRes.arrayBuffer()).toString('utf8')) as { status?: string; location?: { lat?: number; lng?: number } };
        if (meta.status === 'OK' && typeof meta.location?.lat === 'number' && typeof meta.location?.lng === 'number') {
          svHeading = bearingDegrees({ lat: meta.location.lat, lng: meta.location.lng }, input.coords);
        }
      }
    } catch { /* no metadata → un-oriented Street View */ }
  }

  const plan: Array<{ service: VisualService; url: string }> = [
    { service: 'maps_static', url: buildStaticMapUrl({ address: input.address, coords: input.coords ?? null, key }) },
    { service: 'street_view_static', url: buildStreetViewUrl({ address: input.address, coords: input.coords ?? null, key, heading: svHeading }) },
  ];

  for (const { service, url } of plan) {
    let success = false;
    try {
      const res = await fetchImpl(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const file = path.join(storeDir, safeName(input.propertyLabel, service));
        fs.writeFileSync(file, buf);
        assets[service] = { storedPath: file, timestamp: now() };
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
    reason: capturedAny ? 'Captured Google visual(s). Visual Signal, Not Verified Fact.' : 'No visual captured (provider error or no coverage).',
    assets,
  };
}
