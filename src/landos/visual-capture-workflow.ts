// LandOS — explicit per-property visual capture workflow.
//
// Ties the gated Google capture (google-visual-capture.ts) to a Property Card:
// captures the images ONCE for one card, then persists their metadata on the
// card (saveCardVisualCapture). This is the ONLY entry point that triggers a
// Google call, and only when invoked explicitly for a single card — never in
// tests, dashboard startup, or any loop. Visuals are supporting context only.

import { capturePropertyVisuals, type CaptureDeps } from './google-visual-capture.js';
import { getPropertyCardRow, saveCardVisualCapture, type CardVisualAsset } from './property-card.js';

export interface CaptureWorkflowResult {
  ok: boolean;
  cardId: number;
  reason: string;
  captured: string[]; // service ids captured
}

/**
 * Capture + persist visuals for ONE property card. Uses the card's address (never
 * coordinates/proximity for identity — visuals are context only). Persists the
 * stored-image metadata on the card. Returns which services were captured.
 */
export async function captureAndPersistCardVisuals(cardId: number, deps: CaptureDeps = {}): Promise<CaptureWorkflowResult> {
  const card = getPropertyCardRow(cardId);
  if (!card) return { ok: false, cardId, reason: 'property card not found', captured: [] };
  const address = (card.active_input_address as string | undefined) || null;
  const label = address || `property card ${cardId}`;

  const res = await capturePropertyVisuals({ propertyLabel: label, address }, deps);
  if (!res.captured) return { ok: false, cardId, reason: res.reason, captured: [] };

  const assets: Record<string, CardVisualAsset> = {};
  for (const [svc, a] of Object.entries(res.assets)) {
    if (a) assets[svc] = { storedPath: a.storedPath, timestamp: a.timestamp };
  }
  saveCardVisualCapture(cardId, assets, { provider: 'google' });
  return { ok: true, cardId, reason: res.reason, captured: Object.keys(assets) };
}
