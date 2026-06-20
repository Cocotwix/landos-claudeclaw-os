// LandOS imagery capture — free, local, best-effort drop-in interface.
//
// Defines the slot for capturing supporting imagery (Google Earth web via LOCAL
// Playwright, plus optional LandPortal satellite / Redfin / Zillow property
// photos) and describing it with a LOCAL model (Gemma). It uses NO Google API
// and NO key. Everything here is a pure interface + a never-faking stub; the
// live Playwright capturer and the Gemma describer are documented drop-ins that
// require a package install / local model and are therefore registered, not run,
// until approved.
//
// HARD RULE — imagery NEVER verifies, promotes, or confirms parcel identity. It
// is SUPPORTING CONTEXT ONLY. Coordinates may center a camera view but are never
// used to identify or score a parcel. On timeout/failure within the budget, the
// report still ships with "visual not captured yet".

export const IMAGERY_SUPPORTING_CONTEXT_LABEL = 'Supporting context — not identity verification';
export const IMAGERY_NOT_CAPTURED_NOTE = 'visual not captured yet';

/** Shared best-effort budget so imagery never blows the 90s research cap. */
export const IMAGERY_OVERALL_BUDGET_MS = 90_000;
export const IMAGERY_SOURCE_TIMEOUT_MS = 30_000;

/** Documented live drop-ins (install / local-model gated; not run here). */
export const PLANNED_IMAGERY_CAPTURER =
  'Google Earth web via LOCAL Playwright (no API/key): open address/coords, capture satellite + 3D screenshot. ' +
  'Drop-in: implement ImageryCapturer.capture(); requires the playwright package (install-gated).';
export const PLANNED_IMAGERY_DESCRIBER =
  'Gemma (LOCAL slot) reads the screenshot and writes a plain-language description. ' +
  'Drop-in: implement ImageryDescriber.describe(); requires the local model runtime.';

export type ImagerySourceId = 'google_earth' | 'landportal_satellite' | 'redfin_photo' | 'zillow_photo';
export type ImageryCaptureStatus = 'captured' | 'not_connected' | 'timeout' | 'error' | 'skipped';

export interface ImageryQuery {
  address?: string;
  apn?: string;
  county?: string;
  state?: string;
  /** Optional camera-centering coordinates ONLY. Never used for identity/scoring. */
  lat?: number;
  lng?: number;
}

export interface CapturedImagery {
  sourceId: ImagerySourceId;
  status: ImageryCaptureStatus;
  /** Local file path to the screenshot when captured; absent otherwise. */
  imagePath?: string;
  capturedAtIso?: string;
  /** Always present — supporting context only. */
  label: typeof IMAGERY_SUPPORTING_CONTEXT_LABEL;
  note: string;
}

export interface ImageryDescription {
  /** Plain-language description, or the not-captured note. Never invented. */
  text: string;
  producedBy: string;
  model?: string;
  available: boolean;
  label: typeof IMAGERY_SUPPORTING_CONTEXT_LABEL;
}

export interface ImageryCapturer {
  id: ImagerySourceId;
  label: string;
  capture(query: ImageryQuery, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<CapturedImagery>;
}

export interface ImageryDescriber {
  describe(image: CapturedImagery, opts: { timeoutMs: number }): Promise<ImageryDescription>;
}

export interface ImageryResult {
  captures: CapturedImagery[];
  description: ImageryDescription;
  label: typeof IMAGERY_SUPPORTING_CONTEXT_LABEL;
  /** True when nothing was captured within budget — report ships without it. */
  notCaptured: boolean;
  note: string;
}

function notCaptured(sourceId: ImagerySourceId, status: ImageryCaptureStatus, note: string): CapturedImagery {
  return { sourceId, status, label: IMAGERY_SUPPORTING_CONTEXT_LABEL, note };
}

/** A capturer with no live backend yet. Returns not_connected and NO image — it
 *  never fabricates a visual. Default until the Playwright drop-in is registered. */
export function makeStubImageryCapturer(id: ImagerySourceId, label: string): ImageryCapturer {
  return {
    id,
    label,
    async capture(): Promise<CapturedImagery> {
      return notCaptured(id, 'not_connected', IMAGERY_NOT_CAPTURED_NOTE);
    },
  };
}

/** A describer with no local model wired yet. Returns the not-captured note,
 *  never an invented description. */
export function makeStubImageryDescriber(): ImageryDescriber {
  return {
    async describe(image: CapturedImagery): Promise<ImageryDescription> {
      const hasImage = image.status === 'captured' && !!image.imagePath;
      return {
        text: hasImage
          ? 'image captured; local describer (Gemma) not connected — no description generated, never invented'
          : IMAGERY_NOT_CAPTURED_NOTE,
        producedBy: 'stub',
        available: false,
        label: IMAGERY_SUPPORTING_CONTEXT_LABEL,
      };
    },
  };
}

export function defaultImageryCapturers(): ImageryCapturer[] {
  return [
    makeStubImageryCapturer('google_earth', 'Google Earth (local Playwright)'),
    makeStubImageryCapturer('landportal_satellite', 'LandPortal satellite'),
    makeStubImageryCapturer('redfin_photo', 'Redfin property photo'),
    makeStubImageryCapturer('zillow_photo', 'Zillow property photo'),
  ];
}

async function captureWithTimeout(c: ImageryCapturer, query: ImageryQuery, timeoutMs: number): Promise<CapturedImagery> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<CapturedImagery>((resolve) => {
    timer = setTimeout(() => resolve(notCaptured(c.id, 'timeout', `${IMAGERY_NOT_CAPTURED_NOTE} (timed out after ${timeoutMs}ms)`)), timeoutMs);
  });
  try {
    return await Promise.race<CapturedImagery>([c.capture(query, { timeoutMs }), timeoutP]);
  } catch {
    return notCaptured(c.id, 'error', IMAGERY_NOT_CAPTURED_NOTE);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Best-effort imagery capture + description within the overall budget. Injected
 * capturers/describer so tests need no browser/model. Returns the not-captured
 * state cleanly (report still ships) and labels everything supporting-context.
 */
export async function captureImagery(
  query: ImageryQuery,
  opts: {
    capturers?: ImageryCapturer[];
    describer?: ImageryDescriber;
    overallBudgetMs?: number;
    sourceTimeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<ImageryResult> {
  const capturers = opts.capturers ?? defaultImageryCapturers();
  const describer = opts.describer ?? makeStubImageryDescriber();
  const budget = opts.overallBudgetMs ?? IMAGERY_OVERALL_BUDGET_MS;
  const sourceTimeoutMs = opts.sourceTimeoutMs ?? IMAGERY_SOURCE_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());

  const start = now();
  const captures: CapturedImagery[] = [];
  for (const c of capturers) {
    if (now() - start >= budget) {
      captures.push(notCaptured(c.id, 'skipped', `${IMAGERY_NOT_CAPTURED_NOTE} (budget cap reached)`));
      continue;
    }
    captures.push(await captureWithTimeout(c, query, sourceTimeoutMs));
  }

  const primary = captures.find((c) => c.status === 'captured' && c.imagePath);
  const description = primary
    ? await describer.describe(primary, { timeoutMs: sourceTimeoutMs })
    : { text: IMAGERY_NOT_CAPTURED_NOTE, producedBy: 'none', available: false, label: IMAGERY_SUPPORTING_CONTEXT_LABEL } as ImageryDescription;

  const notCapturedAny = !primary;
  return {
    captures,
    description,
    label: IMAGERY_SUPPORTING_CONTEXT_LABEL,
    notCaptured: notCapturedAny,
    note: notCapturedAny
      ? `${IMAGERY_NOT_CAPTURED_NOTE}. Imagery is supporting context only and never verifies parcel identity.`
      : 'Imagery captured as supporting context only; it does not verify parcel identity.',
  };
}
