// LandOS — explicit per-property visual capture workflow.
//
// Ties the gated Google capture (google-visual-capture.ts) to a Property Card.
// PARCEL-ASSOCIATION RULE: imagery is generated ONLY from the card's VERIFIED
// parcel coordinates. The card's raw input address is never a Google target —
// a raw/multi-APN intake string geocodes to a city centroid or nearby business
// and produces plausible-looking imagery of the wrong place (the De Queen
// regression). No verified coordinates → no capture, honestly reported.

import { capturePropertyVisuals, type CaptureDeps } from './google-visual-capture.js';
import { getPropertyCardRow, saveCardVisualCapture, type CardVisualAsset } from './property-card.js';

export interface CaptureWorkflowResult {
  ok: boolean;
  cardId: number;
  reason: string;
  captured: string[]; // service ids captured
}

/**
 * Capture + persist visuals for ONE property card, from verified parcel
 * coordinates only. Persists the stored-image metadata (with its parcel
 * association) on the card. Returns which services were captured.
 */
export async function captureAndPersistCardVisuals(cardId: number, deps: CaptureDeps = {}): Promise<CaptureWorkflowResult> {
  const card = getPropertyCardRow(cardId);
  if (!card) return { ok: false, cardId, reason: 'property card not found', captured: [] };

  const lat = typeof card.lat === 'number' && Number.isFinite(card.lat) ? card.lat : null;
  const lng = typeof card.lng === 'number' && Number.isFinite(card.lng) ? card.lng : null;
  const verified = String(card.verification_status ?? '').startsWith('verified');
  if (!verified || lat == null || lng == null) {
    return {
      ok: false,
      cardId,
      reason: 'Parcel location not yet resolved — no Google imagery captured. Resolve the parcel (verified coordinates) first; imagery is never generated from raw intake text.',
      captured: [],
    };
  }

  const apn = (card.apn as string | undefined) || null;
  const label = apn ? `APN ${apn}` : `property card ${cardId}`;

  const res = await capturePropertyVisuals({
    propertyLabel: label,
    address: null, // coordinates only — never the raw input address
    coords: { lat, lng },
    cardId,
    association: { apn, basis: 'verified_parcel_coordinates' },
  }, deps);
  if (!res.captured) return { ok: false, cardId, reason: res.reason, captured: [] };

  const assets: Record<string, CardVisualAsset> = {};
  for (const [svc, a] of Object.entries(res.assets)) {
    if (a) assets[svc] = { storedPath: a.storedPath, timestamp: a.timestamp, association: a.association ?? null };
  }
  saveCardVisualCapture(cardId, assets, { provider: 'google' });
  return { ok: true, cardId, reason: res.reason, captured: Object.keys(assets) };
}

export async function captureAndPersistAcceptedIdentityVisuals(input: {
  cardId: number;
  apn: string | null;
  coordinates: { lat: number; lng: number } | null;
  discoveryUsable: boolean;
  discoverySources: string[];
}, deps: CaptureDeps = {}): Promise<CaptureWorkflowResult> {
  const card = getPropertyCardRow(input.cardId);
  if (!card) return { ok: false, cardId: input.cardId, reason: 'property card not found', captured: [] };
  const normalizeApn = (value: string | null | undefined): string => (value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const exactParcelMatch = !!normalizeApn(input.apn)
    && normalizeApn(input.apn) === normalizeApn(card.apn)
    && input.discoveryUsable
    && input.discoverySources.some((source) => /landportal authenticated parcel panel/i.test(source));
  const coords = input.coordinates;
  if (!exactParcelMatch || !coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    return {
      ok: false,
      cardId: input.cardId,
      reason: 'Accepted LandPortal parcel coordinates are unavailable or do not match this card APN; no Google imagery captured.',
      captured: [],
    };
  }

  const res = await capturePropertyVisuals({
    propertyLabel: `APN ${card.apn}`,
    address: null,
    coords,
    cardId: input.cardId,
    association: { apn: card.apn, basis: 'landportal_matched_parcel_coordinates' },
  }, deps);
  if (!res.captured) return { ok: false, cardId: input.cardId, reason: res.reason, captured: [] };
  const assets: Record<string, CardVisualAsset> = {};
  for (const [svc, asset] of Object.entries(res.assets)) {
    if (asset) assets[svc] = { storedPath: asset.storedPath, timestamp: asset.timestamp, association: asset.association ?? null };
  }
  saveCardVisualCapture(input.cardId, assets, { provider: 'google' });
  return { ok: true, cardId: input.cardId, reason: res.reason, captured: Object.keys(assets) };
}
