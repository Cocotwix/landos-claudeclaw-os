// LandOS — Browser Intelligence Vision.
//
// Browser Intelligence captures screenshots (LandPortal parcel/overlays/comps map,
// Google satellite, Street View, 3D/terrain). A trained land-acquisition employee
// does not hand those images to Tyler to interpret — it LOOKS at them and writes
// useful visual observations: access, road frontage, landlocked risk, visible
// easements, neighboring development, clearing, wetlands/water, terrain/slope, and
// visible improvements.
//
// Rules:
//  - Observations are VISUAL SIGNALS, never verified facts (Tyler's doctrine). The
//    Deal Card must present them as such.
//  - Bad/duplicate screenshots are filtered BEFORE analysis (no wasted vision call,
//    no duplicate evidence on the card).
//  - Honest: when nothing useful is visible, it says so rather than inventing.
//
// Pure analysis (analyzeScreenshots) + a card driver (runBrowserVisionForCard) that
// gathers the persisted screenshots, dedupes them, analyzes, and merges the result
// into the property inspection so the existing Deal Card renders it.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { generateVisionContent, parseJsonResponse } from '../gemini.js';
import { getLandosDb } from './db.js';
import {
  loadPropertyInspection,
  loadCardVisualCapture,
  savePropertyInspection,
  attachCardActivity,
  getPropertyCard,
  type LandPortalVisualObservation,
  type PendingPropertyInspectionRecord,
} from './property-card.js';

export interface VisionSourceImage {
  label: string;
  kind: string;
  path: string;
}

export type VisionCategory =
  | 'access'
  | 'road_frontage'
  | 'landlocked_risk'
  | 'easement'
  | 'clearing'
  | 'wetlands_water'
  | 'terrain_slope'
  | 'neighboring_development'
  | 'improvements'
  | 'other';

export interface VisualObservation {
  category: VisionCategory;
  observation: string;
  signal: 'positive' | 'concern' | 'neutral';
  confidence: 'high' | 'medium' | 'low';
  sourceImage: string;
}

export interface VisionAnalysis {
  observations: VisualObservation[];
  summary: string;
  analyzed: Array<{ label: string; kind: string }>;
  skipped: Array<{ label: string; reason: string }>;
  model: string;
  generatedAt: string;
  ok: boolean;
  note?: string;
}

// gemini-2.5-flash is multimodal and has working quota on this project; the older
// gemini-2.0-flash returns 429 (limit:0) here. Override with BROWSER_VISION_MODEL.
const VISION_MODEL = process.env.BROWSER_VISION_MODEL || 'gemini-2.5-flash';
// PNG smaller than this is almost always a blank/errored capture, not a real view.
const MIN_USEFUL_BYTES = 8 * 1024;

/**
 * PURE: dedupe + drop bad screenshots BEFORE spending a vision call. Exact-content
 * duplicates (same bytes) and tiny/blank captures are skipped with a reason.
 */
export function dedupeImages(images: VisionSourceImage[]): {
  keep: VisionSourceImage[];
  skipped: Array<{ label: string; reason: string }>;
} {
  const keep: VisionSourceImage[] = [];
  const skipped: Array<{ label: string; reason: string }> = [];
  const seen = new Map<string, string>(); // hash -> label already kept
  for (const img of images) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(img.path);
    } catch {
      skipped.push({ label: img.label, reason: 'file missing or unreadable' });
      continue;
    }
    if (bytes.length < MIN_USEFUL_BYTES) {
      skipped.push({ label: img.label, reason: `blank/too small (${bytes.length}B)` });
      continue;
    }
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const dup = seen.get(hash);
    if (dup) {
      skipped.push({ label: img.label, reason: `duplicate of "${dup}"` });
      continue;
    }
    seen.set(hash, img.label);
    keep.push(img);
  }
  return { keep, skipped };
}

function buildPrompt(ctx: PropertyContext, kept: VisionSourceImage[]): string {
  const where = [ctx.address, ctx.county && `${ctx.county} County`, ctx.state]
    .filter(Boolean)
    .join(', ');
  const list = kept.map((k, i) => `  ${i + 1}. "${k.label}" (${k.kind})`).join('\n');
  return `You are a land-acquisition analyst inspecting screenshots of a rural/vacant land parcel${where ? ` near ${where}` : ''}. The images, in order, are:
${list}

Look at EACH image as a land investor would. Report only what is actually VISIBLE. Do not invent, and do not repeat the same observation across images. For each meaningful thing you see, produce one observation.

Focus on what changes an offer decision:
- access: is there a visible driveway/road touching the parcel? gated? shared?
- road_frontage: does the parcel front a paved/dirt road, and roughly how much?
- landlocked_risk: any sign the parcel has NO road touching it (surrounded by other parcels)?
- easement: visible power lines, pipelines, cleared linear corridors, right-of-way.
- clearing: cleared vs wooded; % rough.
- wetlands_water: standing water, ponds, streams, marsh, wet/dark low ground.
- terrain_slope: flat / rolling / steep; visible grade or drainage.
- neighboring_development: nearby homes, subdivisions, commercial, construction.
- improvements: any structures/utilities visible on the parcel itself.

Return STRICT JSON:
{
  "observations": [
    { "category": "access|road_frontage|landlocked_risk|easement|clearing|wetlands_water|terrain_slope|neighboring_development|improvements|other",
      "observation": "one concrete sentence of what is visible",
      "signal": "positive|concern|neutral",
      "confidence": "high|medium|low",
      "sourceImage": "the exact image label it came from" }
  ],
  "summary": "2-3 sentence plain-English read of the parcel from the imagery, for a land investor. Say plainly if the imagery is inconclusive."
}
If an image is unusable (blank, a map UI with no parcel, an error page), do not force observations from it. If NOTHING useful is visible across all images, return an empty observations array and say so in the summary.`;
}

export interface PropertyContext {
  address?: string;
  county?: string;
  state?: string;
}

/**
 * Analyze a set of screenshots with a vision model and return structured visual
 * observations. Dedupes/filters bad shots first. Never throws for a bad image —
 * returns ok:false with a note when the vision call cannot run.
 */
export async function analyzeScreenshots(
  images: VisionSourceImage[],
  ctx: PropertyContext = {},
): Promise<VisionAnalysis> {
  const now = new Date().toISOString();
  const { keep, skipped } = dedupeImages(images);
  if (keep.length === 0) {
    return {
      observations: [], summary: 'No usable screenshots to analyze.',
      analyzed: [], skipped, model: VISION_MODEL, generatedAt: now,
      ok: false, note: 'no usable images',
    };
  }
  const encoded = keep.map((k) => ({ data: fs.readFileSync(k.path).toString('base64'), mimeType: 'image/png' }));
  let raw = '';
  try {
    raw = await generateVisionContent(buildPrompt(ctx, keep), encoded, VISION_MODEL);
  } catch (err) {
    return {
      observations: [], summary: 'Vision analysis could not run.',
      analyzed: keep.map((k) => ({ label: k.label, kind: k.kind })), skipped,
      model: VISION_MODEL, generatedAt: now, ok: false,
      note: (err as Error)?.message ?? 'vision call failed',
    };
  }
  const parsed = parseJsonResponse<{ observations?: unknown[]; summary?: string }>(raw);
  const observations = normalizeObservations(parsed?.observations, keep);
  return {
    observations,
    summary: typeof parsed?.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : (observations.length ? 'Visual signals extracted from the captured imagery.' : 'Imagery was inconclusive.'),
    analyzed: keep.map((k) => ({ label: k.label, kind: k.kind })),
    skipped, model: VISION_MODEL, generatedAt: now, ok: true,
  };
}

const CATEGORIES: VisionCategory[] = ['access', 'road_frontage', 'landlocked_risk', 'easement', 'clearing', 'wetlands_water', 'terrain_slope', 'neighboring_development', 'improvements', 'other'];

function normalizeObservations(raw: unknown, kept: VisionSourceImage[]): VisualObservation[] {
  if (!Array.isArray(raw)) return [];
  const labels = new Set(kept.map((k) => k.label));
  const out: VisualObservation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const observation = typeof o.observation === 'string' ? o.observation.trim() : '';
    if (!observation) continue;
    const category = (CATEGORIES.includes(o.category as VisionCategory) ? o.category : 'other') as VisionCategory;
    const signal = (['positive', 'concern', 'neutral'].includes(o.signal as string) ? o.signal : 'neutral') as VisualObservation['signal'];
    const confidence = (['high', 'medium', 'low'].includes(o.confidence as string) ? o.confidence : 'low') as VisualObservation['confidence'];
    const src = typeof o.sourceImage === 'string' && labels.has(o.sourceImage) ? o.sourceImage : (kept[0]?.label ?? 'imagery');
    out.push({ category, observation, signal, confidence, sourceImage: src });
  }
  return out;
}

const CATEGORY_LABEL: Record<VisionCategory, string> = {
  access: 'Access', road_frontage: 'Road frontage', landlocked_risk: 'Landlocked risk',
  easement: 'Easement', clearing: 'Clearing', wetlands_water: 'Wetlands / water',
  terrain_slope: 'Terrain / slope', neighboring_development: 'Neighboring development',
  improvements: 'Improvements', other: 'Visual note',
};

/** Map a vision observation into the inspection's visual-observation shape so the
 *  existing Deal Card renders it. Always framed as a VISUAL SIGNAL (capped at
 *  medium confidence — imagery is a signal, not a verified fact). */
export function toInspectionObservation(o: VisualObservation): LandPortalVisualObservation {
  const tone = o.signal === 'concern' ? ' ⚠' : '';
  return {
    label: `${CATEGORY_LABEL[o.category]} (visual signal)${tone}`,
    detail: o.observation,
    confidence: o.confidence === 'high' ? 'medium' : 'low',
    evidence: `Vision read of ${o.sourceImage}`,
  };
}

/** Gather every persisted screenshot for a card (LandPortal inspection assets +
 *  Google visual captures), in a sensible viewing order. */
export function gatherCardImages(cardId: number): VisionSourceImage[] {
  const images: VisionSourceImage[] = [];
  const insp = loadPropertyInspection(cardId);
  for (const a of insp?.assets ?? []) {
    if (a.storedPath) images.push({ label: a.label, kind: a.kind, path: a.storedPath });
  }
  const visuals = loadCardVisualCapture(cardId);
  for (const [service, asset] of Object.entries(visuals)) {
    if (asset?.storedPath) images.push({ label: googleServiceLabel(service), kind: `google_${service}`, path: asset.storedPath });
  }
  return images;
}

function googleServiceLabel(service: string): string {
  const m: Record<string, string> = {
    satellite: 'Google Satellite', street_view: 'Google Street View', streetview: 'Google Street View',
    map: 'Google Map', aerial: 'Aerial', earth: 'Google Earth 3D',
  };
  return m[service] ?? `Google ${service}`;
}

export interface RunVisionResult {
  ok: boolean;
  analysis: VisionAnalysis;
  merged: number;
  note?: string;
}

/**
 * Card driver: gather this card's screenshots, dedupe, run vision, MERGE the
 * observations into the property inspection (so the Deal Card shows them), and
 * store the full analysis as a card activity. Idempotent-ish: replaces prior
 * vision-sourced observations before merging so re-runs don't stack duplicates.
 */
export async function runBrowserVisionForCard(cardId: number): Promise<RunVisionResult> {
  const images = gatherCardImages(cardId);
  if (images.length === 0) {
    const empty: VisionAnalysis = { observations: [], summary: 'No screenshots captured yet.', analyzed: [], skipped: [], model: VISION_MODEL, generatedAt: new Date().toISOString(), ok: false, note: 'no images' };
    return { ok: false, analysis: empty, merged: 0, note: 'no screenshots' };
  }
  const card = getPropertyCard(cardId) as Record<string, unknown> | undefined;
  const analysis = await analyzeScreenshots(images, {
    address: typeof card?.active_input_address === 'string' ? card.active_input_address : undefined,
    county: typeof card?.county === 'string' ? card.county : undefined,
    state: typeof card?.state === 'string' ? card.state : undefined,
  });

  let merged = 0;
  const insp = loadPropertyInspection(cardId);
  if (insp && analysis.observations.length > 0) {
    const pending = toPending(insp);
    // Drop prior vision-sourced observations so re-runs don't stack.
    pending.visualObservations = pending.visualObservations.filter((v) => !/^Vision read of /.test(v.evidence));
    for (const o of analysis.observations) { pending.visualObservations.push(toInspectionObservation(o)); merged++; }
    savePropertyInspection(cardId, pending);
  }

  try {
    attachCardActivity({
      cardId, agentId: 'browser-vision', kind: 'vision_analysis',
      summary: analysis.summary.slice(0, 280),
      ref: JSON.stringify(analysis),
    });
  } catch { /* activity is best-effort */ }

  return { ok: analysis.ok, analysis, merged };
}

/** Convert a loaded inspection record back to the pending (save) shape, preserving
 *  images by pointing sourcePath at the already-stored file (copy is idempotent). */
function toPending(insp: ReturnType<typeof loadPropertyInspection>): PendingPropertyInspectionRecord {
  const rec = insp!;
  return {
    parcelUrl: rec.parcelUrl,
    comparablesUrl: rec.comparablesUrl,
    parcelFacts: rec.parcelFacts,
    assets: rec.assets.map((a) => ({ key: a.key, label: a.label, kind: a.kind, purpose: a.purpose, sourcePath: a.storedPath, timestamp: a.timestamp, overlay: a.overlay, note: a.note })),
    overlays: rec.overlays,
    visualObservations: [...rec.visualObservations],
    comparables: rec.comparables,
    sources: rec.sources,
    evidence: rec.evidence,
    discoveryQuestions: rec.discoveryQuestions,
    missingInformation: rec.missingInformation,
  };
}

/** Read the latest stored vision analysis for a card (null when none). */
export function loadCardVisionAnalysis(cardId: number): VisionAnalysis | null {
  const row = getLandosDb()
    .prepare("SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = 'vision_analysis' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(cardId) as { ref?: string } | undefined;
  if (!row?.ref) return null;
  try { return JSON.parse(row.ref) as VisionAnalysis; } catch { return null; }
}
