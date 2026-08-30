import fs from 'node:fs';
import path from 'node:path';
import { DASHBOARD_TOKEN, PROJECT_ROOT } from '../config.js';
import { generateVisionContent, parseJsonResponse } from '../gemini.js';
import { logger } from '../logger.js';
import { runBrowserQa, type BrowserQaScenario, type BrowserQaSession } from './browser-qa.js';
import { getLandosDb } from './db.js';
import { attachCardActivity, getPropertyCardRow } from './property-card.js';
import { appendDerivedEvidence } from './derived-intelligence-store.js';
import { resolveSubjectPropertyCard } from './deal-card.js';
import { getDealCard } from './deal-card.js';
import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';

/**
 * God's Eye View → Property Intelligence spatial investigation.
 *
 * Bounded, question-driven use of the standalone GEV department as a Property
 * investigation tool: open the real GEV app on the subject through the
 * existing spatial-platform handoff, capture a small set of material views
 * (overhead context, parcel close-up, tilted terrain perspective), and ground
 * every capture through the SAME vision lane the rest of LandOS trusts —
 * actual pixels to a multimodal model, never a narrated file path.
 *
 * Doctrine:
 *  - OBSERVATIONS ONLY. Nothing produced here is a legal/regulatory fact, and
 *    every persisted row is labeled as a visual observation with provider,
 *    view, capture time, and artifact provenance (B7/B8).
 *  - BOUNDED. One browser session, at most GEV_MAX_VIEWS captures, one vision
 *    call. No loops, no per-layer sweeps: the views serve the material spatial
 *    questions derived from the current dossier.
 *  - BEST-EFFORT. A missing browser, missing coordinates, or a vision failure
 *    returns observationCount 0 with honest warnings; the Property read
 *    proceeds on retained evidence.
 *  - ADDITIVE. GEV observations are a separate lane appended to the grounded
 *    observation set — they never replace the aerial-imagery vision lanes.
 */

export const GEV_SPATIAL_ANALYSIS_KIND = 'gev_spatial_analysis';
const GEV_MAX_VIEWS = 3;
const GEV_VISION_MODEL = process.env.BROWSER_VISION_MODEL || 'gemini-3-flash-preview';

export interface GevSpatialObservation {
  question: string;
  view: string;
  observation: string;
  signal: 'positive' | 'concern' | 'neutral';
  confidence: 'high' | 'medium' | 'low';
  sourceImage: string;
}

export interface GevSpatialAnalysis {
  observations: GevSpatialObservation[];
  summary: string;
  questions: string[];
  views: Array<{ label: string; description: string; screenshotPath: string | null }>;
  /** The basemap stack the captures actually rode — honesty about whether the
   *  pixels were photorealistic Google 3D or the keyless OSM/terrain globe. */
  basemap: string;
  provider: string;
  model: string;
  generatedAt: string;
  ok: boolean;
  note?: string;
}

/** Latest persisted GEV spatial analysis for a property card (null when none). */
export function loadCardGevSpatialAnalysis(cardId: number): GevSpatialAnalysis | null {
  const row = getLandosDb()
    .prepare(`SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = '${GEV_SPATIAL_ANALYSIS_KIND}' ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(cardId) as { ref?: string } | undefined;
  if (!row?.ref) return null;
  try { return JSON.parse(row.ref) as GevSpatialAnalysis; } catch { return null; }
}

/** The material spatial questions this dossier actually raises — bounded. */
export function deriveSpatialQuestions(dossier: AcquisitionDossier): string[] {
  const questions: string[] = [
    'How does the terrain organize this parcel: where does the usable/gentler ground appear to sit, is it one contiguous area or split, and does relief appear to isolate any portion?',
  ];
  questions.push(
    'What is the practical road relationship: where does the parcel meet mapped roads, how many practical entrance areas appear possible, and are there apparent road stubs or street patterns terminating at or near the boundary?',
  );
  questions.push(
    'Does surrounding development physically approach the subject — platted street patterns, subdivisions, commercial/industrial uses — and which side of the property would any visible externality affect?',
  );
  const physical = dossier.physical as Record<string, unknown> | undefined;
  const waterish = physical && JSON.stringify(physical).match(/flood|wetland|stream|creek|water/i);
  if (waterish) {
    questions.push('Do mapped waterways, drainages, or low-lying areas appear to cross or divide the parcel in a way that would constrain lot configuration?');
  }
  return questions.slice(0, 4);
}

interface ViewPlan {
  label: string;
  description: string;
  /** Applied via the live viewer after mount. */
  setup: 'initial-close' | 'zoom-wide' | 'terrain-tilt';
}

const VIEW_PLANS: ViewPlan[] = [
  { label: 'gev-parcel-close', description: 'Overhead parcel close-up (~2,500 m)', setup: 'initial-close' },
  { label: 'gev-context-wide', description: 'Overhead surrounding-context view (~7,000 m)', setup: 'zoom-wide' },
  { label: 'gev-terrain-tilt', description: 'Tilted perspective for terrain relief', setup: 'terrain-tilt' },
];

function visionPrompt(ctx: { address: string | null; apn: string | null; acres: number | null; basemap: string; questions: string[]; views: ViewPlan[] }): string {
  return [
    'You are the visual/spatial analysis assistant for LandOS Property Intelligence, examining screenshots captured from the God\'s Eye View 3D geospatial application.',
    `Subject: ${ctx.address ?? 'unknown address'}${ctx.apn ? ` (APN ${ctx.apn})` : ''}${ctx.acres != null ? `, ~${ctx.acres} acres` : ''}. The subject is marked with a cyan point labeled with its address; sold comps are green, active listings are orange.`,
    `Basemap honesty: these views ride "${ctx.basemap}". ${ctx.basemap.includes('google') ? 'The imagery is photorealistic 3D.' : 'This is a CARTOGRAPHIC basemap (OpenStreetMap) draped over real terrain — mapped roads, water features, land shapes and street patterns are real; there is NO photographic vegetation or structure detail, so never describe clearing, tree cover, buildings, or driveways from these views.'}`,
    '',
    'The captured views, in order:',
    ...ctx.views.map((view, index) => `${index + 1}. ${view.label}: ${view.description}`),
    '',
    'Answer ONLY these material questions, strictly from what is visible:',
    ...ctx.questions.map((question, index) => `Q${index + 1}. ${question}`),
    '',
    'HARD RULES: every statement is an OBSERVATION of what appears in the views, never a legal, regulatory, or ownership fact. An apparent road relationship is not legal access; a street pattern nearing the boundary is not a right to connect; a mapped waterway is not a jurisdictional determination. If a question cannot be answered from these views, say exactly that for the question rather than guessing. Do not invent detail the basemap cannot show.',
    '',
    'Reply with ONE JSON object, nothing else:',
    '{"observations":[{"question":"the question text","view":"which numbered view supports it","observation":"what appears","signal":"positive|concern|neutral","confidence":"high|medium|low"}],"summary":"2-3 sentence overall spatial read"}',
  ].join('\n');
}

function subjectCoordinates(dealCardId: number): { lat: number; lon: number; cardId: number } | null {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const resolution = resolveSubjectPropertyCard(deal);
  if (resolution.cardId == null) return null;
  const row = getPropertyCardRow(resolution.cardId) as { lat?: number | null; lng?: number | null } | undefined;
  if (!row || typeof row.lat !== 'number' || typeof row.lng !== 'number') return null;
  return { lat: row.lat, lon: row.lng, cardId: resolution.cardId };
}

export interface GevInvestigationResult {
  observationCount: number;
  warnings: string[];
}

/**
 * Run one bounded GEV investigation for the deal's subject property, persist
 * the grounded observations + provenance, and return the count. Never throws
 * for operational failures — the Property read must proceed either way.
 */
export async function investigatePropertyWithGev(
  dealCardId: number,
  dossier: AcquisitionDossier,
  options: { runId?: string | null; signal?: AbortSignal; isRunAuthoritative?: (runId: string) => boolean } = {},
): Promise<GevInvestigationResult> {
  const warnings: string[] = [];
  const subject = subjectCoordinates(dealCardId);
  if (!subject) {
    return { observationCount: 0, warnings: ['God\'s Eye View investigation skipped: the subject property has no verified coordinates on its card.'] };
  }
  const generatedAt = new Date().toISOString();
  const address = dossier.identity.displayAddress ?? null;
  const questions = deriveSpatialQuestions(dossier);
  const captures: Array<{ plan: ViewPlan; path: string }> = [];
  let basemap = 'osm + reearth-terrain (keyless globe)';

  // WGS84 geodetic → ECEF. Cesium's camera APIs duck-type Cartesian3 as a
  // plain {x,y,z}, which lets the Node side position the camera exactly over
  // the subject without importing Cesium into the page context.
  const ecef = (lat: number, lon: number, heightM: number): { x: number; y: number; z: number } => {
    const a = 6378137;
    const e2 = 0.00669437999014;
    const phi = (lat * Math.PI) / 180;
    const lambda = (lon * Math.PI) / 180;
    const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    return {
      x: (n + heightM) * Math.cos(phi) * Math.cos(lambda),
      y: (n + heightM) * Math.cos(phi) * Math.sin(lambda),
      z: (n * (1 - e2) + heightM) * Math.sin(phi),
    };
  };

  const scenario: BrowserQaScenario = {
    id: `gev-property-${dealCardId}`,
    route: '/dept/gods-eye-view',
    // The key-gated providers' keyless HTTP 503 responses are their HONEST
    // states (FREE — CREDENTIAL REQUIRED), not capture failures — same
    // downgrade the standalone GEV acceptance scenario applies.
    allowIssue(issue) {
      if (issue.kind !== 'http-error' || issue.status !== 503 || !issue.url) return false;
      return ['/api/firms', '/api/ais-live', '/api/tomtom'].some((prefix) => new URL(issue.url!).pathname.startsWith(prefix));
    },
    run: async (qa: BrowserQaSession) => {
      // Land on the SPA first so the spatial handoff (subject marker) and the
      // first-run dismissal are in place before the GEV route mounts.
      await qa.goto('/');
      await qa.waitFor('body');
      await qa.page.evaluate<void>((ctxJson: string) => {
        const storage = (globalThis as { sessionStorage?: { setItem(k: string, v: string): void } }).sessionStorage;
        storage?.setItem('landos.gev.pendingSpatialContext', ctxJson);
        // The first-run mission dialog must not cover the captures.
        storage?.setItem('gev:first-run-mission-session:v1', 'dismissed');
      }, JSON.stringify({
        package: { subject: { lat: subject.lat, lon: subject.lon }, address, apn: dossier.identity.apn ?? null },
        viewHeightM: 2500,
      }));
      await qa.goto('/dept/gods-eye-view');
      // Wait for the real app (viewer present).
      const deadline = Date.now() + 90_000;
      let ready = false;
      while (Date.now() < deadline) {
        ready = await qa.page.evaluate<boolean>(() =>
          Boolean((globalThis as { __godsEyeView?: { viewer?: unknown } }).__godsEyeView?.viewer));
        if (ready) break;
        await qa.delay(500);
      }
      if (!ready) throw new Error('God\'s Eye View viewer did not initialize');
      const googleActive = await qa.page.evaluate<boolean>(() =>
        Boolean((globalThis as { __godsEyeView?: { host?: { googleKeyConfigured?: boolean } } }).__godsEyeView?.host?.googleKeyConfigured));
      if (googleActive) basemap = 'google-photorealistic-3d + reearth-terrain';
      await qa.delay(5_000); // boot animations + spatial-context marker

      // Deterministic placement: overhead at the subject, then VERIFY the
      // camera is actually there. A capture of the wrong location must never
      // become evidence for this parcel (identity invariant), so a failed
      // position check aborts the investigation instead of degrading it.
      const placeOverhead = async (heightM: number): Promise<void> => {
        await qa.page.evaluate<void>((destJson: string) => {
          const viewer = (globalThis as { __godsEyeView?: { viewer?: { camera?: { setView(o: unknown): void } } } }).__godsEyeView?.viewer;
          viewer?.camera?.setView({ destination: JSON.parse(destJson), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
        }, JSON.stringify(ecef(subject.lat, subject.lon, heightM)));
      };
      const assertOverSubject = async (): Promise<void> => {
        const positionJson = await qa.page.evaluate<string>(() => {
          const camera = (globalThis as { __godsEyeView?: { viewer?: { camera?: { positionCartographic?: { latitude: number; longitude: number } } } } }).__godsEyeView?.viewer?.camera;
          const carto = camera?.positionCartographic;
          return JSON.stringify(carto ? { lat: (carto.latitude * 180) / Math.PI, lon: (carto.longitude * 180) / Math.PI } : null);
        });
        const position = JSON.parse(positionJson) as { lat: number; lon: number } | null;
        if (!position
          || Math.abs(position.lat - subject.lat) > 0.2
          || Math.abs(position.lon - subject.lon) > 0.2) {
          throw new Error(`camera is not over the subject (at ${position ? `${position.lat.toFixed(3)},${position.lon.toFixed(3)}` : 'unknown'}; expected ${subject.lat.toFixed(3)},${subject.lon.toFixed(3)})`);
        }
      };

      for (const plan of VIEW_PLANS.slice(0, GEV_MAX_VIEWS)) {
        if (plan.setup === 'initial-close') {
          await placeOverhead(2_500);
          await qa.delay(6_000); // terrain/basemap tile streaming
        } else if (plan.setup === 'zoom-wide') {
          await placeOverhead(7_000);
          await qa.delay(4_000);
        } else if (plan.setup === 'terrain-tilt') {
          await placeOverhead(3_500);
          await qa.page.evaluate<void>(() => {
            const viewer = (globalThis as { __godsEyeView?: { viewer?: { camera?: { setView(o: unknown): void } } } }).__godsEyeView?.viewer;
            viewer?.camera?.setView({ orientation: { heading: 0, pitch: -0.5, roll: 0 } });
          });
          await qa.delay(4_000);
        }
        await assertOverSubject();
        const shot = await qa.screenshot(plan.label);
        captures.push({ plan, path: shot });
      }
    },
  };

  try {
    const report = await runBrowserQa({
      root: PROJECT_ROOT,
      token: DASHBOARD_TOKEN,
      scenario,
    });
    if (report.outcome !== 'PASS' || captures.length === 0) {
      warnings.push(`God's Eye View investigation could not capture views (${report.outcome}: ${report.reason}). The read proceeds on retained visual evidence.`);
      return { observationCount: 0, warnings };
    }
  } catch (error) {
    warnings.push(`God's Eye View investigation browser session failed: ${error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)}.`);
    return { observationCount: 0, warnings };
  }

  // Keep the captures as durable artifacts beside the other visual evidence.
  const artifactDir = path.join(PROJECT_ROOT, 'store', 'visuals', 'gev', String(subject.cardId));
  const storedViews: GevSpatialAnalysis['views'] = [];
  try {
    fs.mkdirSync(artifactDir, { recursive: true });
    for (const capture of captures) {
      const dest = path.join(artifactDir, `${capture.plan.label}-${Date.now()}.png`);
      fs.copyFileSync(capture.path, dest);
      storedViews.push({ label: capture.plan.label, description: capture.plan.description, screenshotPath: dest });
    }
  } catch {
    for (const capture of captures) {
      storedViews.push({ label: capture.plan.label, description: capture.plan.description, screenshotPath: capture.path });
    }
  }

  // One multimodal call: actual pixels from every captured view.
  let analysis: GevSpatialAnalysis;
  try {
    const images = storedViews
      .filter((view) => view.screenshotPath && fs.existsSync(view.screenshotPath))
      .map((view) => ({ data: fs.readFileSync(view.screenshotPath!).toString('base64'), mimeType: 'image/png' }));
    if (!images.length) throw new Error('no capture files available');
    const prompt = visionPrompt({
      address,
      apn: dossier.identity.apn ?? null,
      acres: dossier.identity.acres ?? null,
      basemap,
      questions,
      views: VIEW_PLANS.slice(0, captures.length),
    });
    // One bounded retry: transient provider 503s (high demand) are common and
    // must not cost the whole investigation. Retry once after a short wait,
    // then degrade honestly.
    let raw: string;
    try {
      raw = await generateVisionContent(prompt, images, GEV_VISION_MODEL);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      raw = await generateVisionContent(prompt, images, GEV_VISION_MODEL);
    }
    const parsed = parseJsonResponse<{ observations?: unknown[]; summary?: string }>(raw);
    const observations: GevSpatialObservation[] = (Array.isArray(parsed?.observations) ? parsed!.observations : [])
      .map((item) => {
        const record = item as Record<string, unknown>;
        const observation = typeof record.observation === 'string' ? record.observation.trim() : '';
        if (!observation) return null;
        const signal = record.signal === 'positive' || record.signal === 'concern' ? record.signal : 'neutral';
        const confidence = record.confidence === 'high' || record.confidence === 'low' ? record.confidence : 'medium';
        const view = typeof record.view === 'string' ? record.view : 'gev-view';
        return {
          question: typeof record.question === 'string' ? record.question.slice(0, 300) : 'spatial context',
          view,
          observation: observation.slice(0, 700),
          signal,
          confidence,
          sourceImage: view,
        } satisfies GevSpatialObservation;
      })
      .filter((item): item is GevSpatialObservation => !!item)
      .slice(0, 12);
    analysis = {
      observations,
      summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 800) : '',
      questions,
      views: storedViews,
      basemap,
      provider: 'gods-eye-view',
      model: GEV_VISION_MODEL,
      generatedAt,
      ok: observations.length > 0,
      ...(observations.length ? {} : { note: 'vision model returned no usable observation' }),
    };
  } catch (error) {
    warnings.push(`God's Eye View captures could not be vision-analyzed: ${error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)}.`);
    return { observationCount: 0, warnings };
  }

  // A timed-out/cancelled/superseded parent may finish browser or vision work,
  // but it has lost publication authority before either durable write.
  if (options.signal?.aborted || (options.runId && options.isRunAuthoritative && !options.isRunAuthoritative(options.runId))) {
    return { observationCount: 0, warnings: [...warnings, 'God\'s Eye View completed after its parent run lost authority; late observations were not published.'] };
  }

  // Persist: activity record (the lane the dossier reads) + evidence rows with
  // full provenance for the Evidence store.
  try {
    attachCardActivity({
      cardId: subject.cardId,
      agentId: 'gev-investigation',
      kind: GEV_SPATIAL_ANALYSIS_KIND,
      summary: (analysis.summary || 'GEV spatial investigation').slice(0, 280),
      ref: JSON.stringify(analysis),
    });
  } catch (error) {
    warnings.push(`GEV observations could not be persisted to the activity lane: ${error instanceof Error ? error.message : String(error)}.`);
  }
  try {
    appendDerivedEvidence({
      dealCardId,
      collectorKey: 'gev-spatial-investigation',
      actor: 'gev-investigation',
      capabilityId: 'adaptive-spatial-investigation',
      runId: options.runId,
      rows: analysis.observations.map((observation, index) => ({
        domain: 'property_spatial_visual',
        evidenceKind: 'gev_observation',
        factKey: `gev_spatial_${index + 1}`,
        raw: observation,
        normalized: {
          observation: observation.observation,
          question: observation.question,
          view: observation.view,
          basemap,
          artifact: storedViews.find((view) => view.label === observation.sourceImage)?.screenshotPath ?? null,
          informationType: 'observation',
        },
        sourceName: `God's Eye View (${basemap})`,
        sourceUrl: null,
        sourceTier: 'visual_observation',
        confidence: observation.confidence,
        retrievedAt: generatedAt,
        dedupeOn: `${generatedAt}:${observation.view}:${observation.observation}`,
      })),
    });
  } catch (error) {
    warnings.push(`GEV observations could not be appended to the evidence store: ${error instanceof Error ? error.message : String(error)}.`);
  }

  logger.info({ dealCardId, cardId: subject.cardId, observations: analysis.observations.length, basemap },
    '[gev-investigation] spatial investigation complete');
  return { observationCount: analysis.observations.length, warnings };
}
