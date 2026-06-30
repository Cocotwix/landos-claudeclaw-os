// LandOS — LandPortal Browser service (Phase 2).
//
// The FIRST browser retrieval service: retrieve the largest amount of useful
// property intelligence in one place. Search by address / APN / owner, navigate
// the property page exactly as a human analyst would, read EVERY visible field,
// and return structured evidence. Capture exactly ONE screenshot — immediately
// after the property page loads (visual proof the right property opened). The
// extracted structured data is the real output; the screenshot is only proof.
//
// STRICT READ-ONLY. Allowed: search / navigate / zoom / pan / expand panels /
// read / copy visible / capture screenshots. Forbidden (recorded as blocked,
// never performed): billing, credit-consuming reports, paid exports/downloads,
// purchases, account/settings changes, writes/edits/deletes. Uses an EXISTING
// authenticated session only; never stores a credential. Driver is injectable —
// the live Puppeteer driver plugs in; the default parked stub never fabricates.

import {
  type BrowserService, type BrowserDriver, type BrowserEvidence, type BrowserWorkflowInput,
  type BrowserSearchKey, type BrowserPageRead,
  makeParkedDriver, emptyEvidence, recordBlocked, routeBrowserQuestion,
} from './browser-intelligence.js';
import type { PropertyPatch } from './normalized-property.js';
import { extractRecordFacts } from './semantic-extract.js';
import {
  understandPlatform, planNavigationStrategy, verifyTargetReached, findGuidanceLinks,
  pickBestCandidate, pageServesTask, findWorkSurfaceNav, classifySurface, deriveTaskBoundary, isForbiddenTarget,
  type PageObservation, type SearchMethod, type ResultCandidate,
} from './website-intelligence.js';
import { getPlatformIntel, rememberPlatform } from './platform-library.js';
import { pickParcelRecordLink } from './browser-navigator.js';

// NOTE: the apex domain (no www) serves the app; www.landportal.com returns 404.
export const LANDPORTAL_BROWSER_BASE = 'https://landportal.com';
export const LANDPORTAL_SCREENSHOT_PURPOSE = 'landportal_property_loaded';

export interface LandPortalBrowserDeps {
  driver?: BrowserDriver;
  now?: () => string;
}

/** Map LandPortal's visible field labels → the normalized property fields. The
 *  page exposes many labels; we read them all and normalize the known ones.
 *  Unknown-but-visible fields are still returned in `fields` (raw evidence). */
const FIELD_MAP: Array<{ rx: RegExp; key: keyof PropertyPatch | 'tax' | 'fema' | 'wetlands' | 'road_frontage' | 'buildable' | 'slope' | 'utilities' | 'land_use' }> = [
  { rx: /^(situs|property|site)?\s*address$/i, key: 'address' },
  { rx: /^apn$|parcel\s*(number|no|#)/i, key: 'apn' },
  { rx: /^parcel\s*id$/i, key: 'propertyId' },
  { rx: /^owner(\s*name)?$/i, key: 'owner' },
  { rx: /^county$/i, key: 'county' },
  { rx: /^city$/i, key: 'city' },
  { rx: /^state$/i, key: 'state' },
  { rx: /^zip|postal/i, key: 'zip' },
  { rx: /^fips$/i, key: 'fips' },
  { rx: /acre|lot\s*size/i, key: 'acres' },
];

function num(v: string): number | undefined {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Normalize a raw page read into a PropertyPatch + a normalized fields map. The
 *  structured patch is the real output. Coordinates are supporting-only (never
 *  identity). parcelVerified is NEVER set here — a browser read is evidence, not a
 *  named-source verification. */
export function extractLandPortalFields(read: BrowserPageRead): { patch: PropertyPatch; fields: Record<string, string> } {
  const patch: PropertyPatch = {};
  const fields: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(read.fields)) {
    const val = (rawVal ?? '').toString().trim();
    if (!val) continue;
    fields[rawKey.trim()] = val;
    const m = FIELD_MAP.find((f) => f.rx.test(rawKey.trim()));
    if (!m) continue;
    if (m.key === 'acres') { const a = num(val); if (a) patch.acres = a; continue; }
    if (typeof m.key === 'string' && (m.key in ({} as PropertyPatch) || ['address', 'apn', 'propertyId', 'owner', 'county', 'city', 'state', 'zip', 'fips'].includes(m.key))) {
      (patch as Record<string, unknown>)[m.key] = val;
    }
  }
  // Coordinates: only from an explicit lat/lng field, sign-aware, supporting-only.
  const lat = num((read.fields['Latitude'] ?? read.fields['lat'] ?? '').replace(/[^0-9.\-]/g, '')) ?? signedNum(read.fields['Latitude'] ?? read.fields['lat']);
  const lng = signedNum(read.fields['Longitude'] ?? read.fields['lng'] ?? read.fields['lon']);
  if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
    patch.coordinates = { lat, lng };
  }
  return { patch, fields };
}

function signedNum(v?: string): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Build the LandPortal search query from a key, preferring the strongest. */
function searchTermFor(key: BrowserSearchKey): { term: string; by: 'apn' | 'owner' | 'address' } | null {
  if (key.apn) return { term: [key.apn, key.county, key.state].filter(Boolean).join(' '), by: 'apn' };
  if (key.address) return { term: [key.address, key.county, key.state].filter(Boolean).join(' '), by: 'address' };
  if (key.owner) return { term: [key.owner, key.county, key.state].filter(Boolean).join(' '), by: 'owner' };
  return null;
}

function identifierFor(key: BrowserSearchKey): { kind: SearchMethod; value: string } | null {
  // Structured identifiers (APN, owner) are searched BARE — a dedicated APN/owner
  // search method rejects appended county/state. Only an address (a geocoder
  // input) benefits from location context. Generic across platforms.
  if (key.apn) return { kind: 'apn', value: key.apn };
  if (key.address) return { kind: 'address', value: [key.address, key.county, key.state].filter(Boolean).join(' ') };
  if (key.owner) return { kind: 'owner', value: key.owner };
  return null;
}

/**
 * LandPortal workflow driven by GENERALIZED Website Intelligence (no LandPortal-
 * specific selectors): Observe → Understand → Research → Plan → Navigate →
 * Verify → Extract → Remember. The platform is learned in the Platform
 * Intelligence Library so reasoning improves over time. It only EXTRACTS after
 * verifying a real record page (never a search/filter form) — Unknown over
 * incorrect. ONE screenshot per verified property. A driver without observe() (or
 * parked) yields honest non-fabricated evidence.
 */
async function runLandPortalWorkflow(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('landportal', 'workflow');
  const t = () => ({ timeoutMs });
  if (!driver.configured()) {
    ev.status = 'parked';
    ev.note = 'LandPortal browser parked: no authenticated session. Read-only Website-Intelligence workflow runs once a session is provided. No credential stored.';
    return ev;
  }
  const id = identifierFor(input.searchKey);
  if (!id) { ev.status = 'no_match'; ev.note = 'No APN / address / owner provided to search LandPortal.'; return ev; }
  // A driver without page observation can't apply Website Intelligence reasoning;
  // fall back to the simple search → read → extract path (used by simpler drivers).
  if (!driver.observe) return runLandPortalLegacy(input, driver, ev, timeoutMs);

  try {
    // ── OBSERVE ───────────────────────────────────────────────────────────
    await driver.open(LANDPORTAL_BROWSER_BASE, t());
    ev.sourceUrls.push(LANDPORTAL_BROWSER_BASE);
    let obs = (await driver.observe(t())) as PageObservation;
    if (obs.loginLike) { ev.status = 'blocked'; ev.note = 'LandPortal requires login (not authenticated in the persistent session).'; rememberPlatform(LANDPORTAL_BROWSER_BASE, { authRequired: true, used: true, knownLimitations: ['requires manual login'] }); return ev; }

    // ── UNDERSTAND (+ consult memory) ─────────────────────────────────────
    const understanding = understandPlatform(obs);
    const memory = getPlatformIntel(LANDPORTAL_BROWSER_BASE);
    // ── RESEARCH (guidance available if needed; not blindly clicked) ──────
    const guidance = findGuidanceLinks(obs).length;

    // Learn the platform's allowed/restricted/forbidden work surfaces (task boundary).
    const taskBoundary = deriveTaskBoundary(obs);

    // ── TASK SURFACE — if we landed on the wrong page (orders/account/billing/
    //    dashboard), navigate via the nav menu to the parcel-search surface.
    //    NEVER click a forbidden target (billing/orders/purchase/payment). ─────
    const surfaceTrail: string[] = [classifySurface(obs)];
    for (let hop = 0; hop < 3 && !pageServesTask(obs, id.kind); hop++) {
      const nav = findWorkSurfaceNav(obs, id.kind);
      if (!nav || isForbiddenTarget(nav.text) || !driver.clickByText) break;
      await driver.clickByText(nav.text, t());
      obs = (await driver.observe(t())) as PageObservation;
      surfaceTrail.push(`→ ${nav.text} (${classifySurface(obs)})`);
    }
    if (!pageServesTask(obs, id.kind)) {
      ev.status = 'partial';
      ev.note = `Landed on a "${classifySurface(obs)}" surface (trail: ${surfaceTrail.join(' ')}) and could not reach the parcel-search work surface via the nav menu. No forbidden surface was touched. No facts (Unknown over incorrect).`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, taskBoundary, used: true, navPatterns: `task-surface trail: ${surfaceTrail.join(' ')}`, knownLimitations: ['could not reach the parcel-search surface from the landing page'] });
      return ev;
    }

    // ── PLAN — choose the search method that matches the identifier ───────
    let strategy = planNavigationStrategy(obs, id);
    if (!strategy) {
      ev.status = 'partial';
      ev.note = `Understood LandPortal as "${understanding.platformClass}" (methods: ${understanding.availableSearchMethods.join('/') || 'none detected'}${guidance ? `; ${guidance} help links`: ''}), but found no usable ${id.kind} search control to plan a navigation.`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, used: true, knownLimitations: ['no usable search control detected on landing'] });
      return ev;
    }

    // ── NAVIGATE — execute the planned steps (select method, fill, submit) ─
    for (const step of strategy.steps) {
      if (step.action === 'select_method' && step.selector && step.text) {
        if (driver.selectByText) await driver.selectByText(step.selector, step.text, t());
        else if (driver.clickByText) await driver.clickByText(step.text, t());
      } else if (step.action === 'fill' && step.selector && step.value && driver.fillAndSubmit) {
        await driver.fillAndSubmit(step.selector, step.value, undefined, t());
      } else if (step.action === 'click' && step.text && driver.clickByText) {
        await driver.clickByText(step.text, t());
      }
    }

    // ── VERIFY — confirm a record page before extracting (no false facts) ─
    obs = (await driver.observe(t())) as PageObservation;
    let verify = verifyTargetReached(obs, { expectIdentifier: input.searchKey.apn });
    let interaction = '';

    // (a) Standard anchor result → open it.
    if (!verify.reached && (verify.pageType === 'results_list' || verify.pageType === 'dashboard')) {
      const rec = pickParcelRecordLink(obs.links, input.searchKey);
      if (rec) { await driver.open(rec.href, t()); obs = (await driver.observe(t())) as PageObservation; verify = verifyTargetReached(obs, { expectIdentifier: input.searchKey.apn }); interaction = 'anchor result'; }
    }

    // (b) GENERIC non-anchor result interaction (GIS rows/cards/popups/JS lists):
    //     read candidate elements, score against the parcel, click the best ONLY
    //     at high confidence, then re-observe + re-verify. No weak-match, no guess.
    if (!verify.reached && driver.readCandidates && driver.clickCandidate && (verify.pageType === 'results_list' || verify.pageType === 'dashboard' || verify.pageType === 'unknown')) {
      const candidates = (await driver.readCandidates(t())) as ResultCandidate[];
      const best = pickBestCandidate(candidates, input.searchKey);
      if (best) {
        await driver.clickCandidate(best.index, t());
        obs = (await driver.observe(t())) as PageObservation;
        verify = verifyTargetReached(obs, { expectIdentifier: input.searchKey.apn });
        interaction = `non-anchor result (high-confidence ${best.matched.join('+') || 'match'}, score ${best.score.toFixed(2)})`;
      } else {
        ev.status = 'partial';
        ev.note = `Reached a ${verify.pageType} of ${candidates.length} non-anchor result(s) but none scored a HIGH-confidence match to APN ${input.searchKey.apn || ''}/${input.searchKey.address || ''} — refusing to select (no weak-match, no false facts).`;
        rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, taskBoundary, used: true, navPatterns: `${strategy.method} search → results; non-anchor candidates read (${candidates.length})`, knownLimitations: [`no high-confidence result candidate for the parcel on the ${verify.pageType}`] });
        return ev;
      }
    }
    if (obs.url) ev.sourceUrls.push(obs.url);

    if (!verify.reached) {
      ev.status = 'partial';
      ev.note = `Navigated LandPortal (${understanding.platformClass}, ${strategy.method} search) but did not reach a parcel record (page: ${verify.pageType}). ${verify.reason} No facts extracted (Unknown over incorrect).`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, used: true, navPatterns: strategy.reason, knownLimitations: [`${strategy.method} search did not reach a record page (${verify.pageType})`] });
      return ev;
    }

    // ── EXTRACT (verified record) + ONE screenshot ────────────────────────
    const shot = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, t());
    ev.screenshots.push(shot);
    const method = `${strategy.method} search${interaction ? ` → ${interaction}` : ''} → verified record`;
    ev.fields = obs.fields;
    ev.facts = extractRecordFacts(obs.fields, { sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal' }).map((f) => ({ ...f, extractionMethod: method }));
    ev.patch = extractLandPortalFields({ url: obs.url, fields: obs.fields, snippets: [] }).patch;
    ev.sourcesUsed = [{ type: 'landportal', url: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal', confidence: 0.85 }];
    ev.status = ev.facts.length ? 'retrieved' : 'partial';

    // ── REMEMBER / IMPROVE — store the validated strategy + interaction pattern ─
    const validatedStrategy = { ...strategy, steps: interaction ? [...strategy.steps, { action: 'click' as const, text: `result candidate: ${interaction}` }] : strategy.steps, reason: `${strategy.reason}${interaction ? ` Then select ${interaction}.` : ''}` };
    rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, validatedStrategy, navPatterns: validatedStrategy.reason, authRequired: true, confidence: 'high', taskBoundary, used: true, succeeded: ev.status === 'retrieved', validatedNow: ev.status === 'retrieved', knownLimitations: [] });
    ev.note = `LandPortal understood as "${understanding.platformClass}"; ${method} (${verify.reason}); ${ev.facts.length} fact(s) extracted with provenance; one screenshot.`;
    return ev;
  } catch (err) {
    ev.status = 'error';
    ev.note = `LandPortal Website-Intelligence run failed before any paid action: ${(err as Error)?.message ?? 'unknown error'}. No credit consumed.`;
    return ev;
  }
}

/** Legacy retrieval for drivers without observe(): open → search → read →
 *  extract. The structured fields are the real output; one screenshot per page. */
async function runLandPortalLegacy(input: BrowserWorkflowInput, driver: BrowserDriver, ev: BrowserEvidence, timeoutMs: number): Promise<BrowserEvidence> {
  const term = searchTermFor(input.searchKey);
  if (!term) { ev.status = 'no_match'; ev.note = 'No address / APN / owner to search LandPortal.'; return ev; }
  try {
    await driver.open(LANDPORTAL_BROWSER_BASE, { timeoutMs });
    ev.sourceUrls.push(LANDPORTAL_BROWSER_BASE);
    const searchRead = await driver.search(term.term, { timeoutMs });
    const propRead = searchRead.url && /property|parcel|detail/i.test(searchRead.url) ? searchRead : await driver.readFields({ timeoutMs });
    if (propRead.url) ev.sourceUrls.push(propRead.url);
    ev.screenshots.push(await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, { timeoutMs }));
    const fullRead = await driver.readFields({ timeoutMs });
    const merged: BrowserPageRead = { url: fullRead.url || propRead.url, fields: { ...propRead.fields, ...fullRead.fields }, snippets: [] };
    const { patch, fields } = extractLandPortalFields(merged);
    ev.patch = patch; ev.fields = fields;
    ev.facts = extractRecordFacts(fields, { sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: merged.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal' });
    ev.sourcesUsed = [{ type: 'landportal', url: merged.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal', confidence: 0.8 }];
    ev.status = Object.keys(fields).length ? 'retrieved' : 'partial';
    ev.note = ev.status === 'retrieved' ? `LandPortal property opened (${term.by} search); ${Object.keys(fields).length} fields read; one screenshot.` : 'LandPortal page opened but no readable property fields were found.';
    return ev;
  } catch (err) { ev.status = 'error'; ev.note = `LandPortal run failed before any paid action: ${(err as Error)?.message ?? 'unknown'}. No credit consumed.`; return ev; }
}

export function makeLandPortalBrowser(deps: LandPortalBrowserDeps = {}): BrowserService {
  const driver = deps.driver ?? makeParkedDriver('landportal');
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    id: 'landportal',
    label: 'LandPortal Browser (read-only property intelligence)',
    modes: ['workflow', 'ask'],
    configured() { return driver.configured(); },
    runWorkflow(input, opts) { return runLandPortalWorkflow(input, driver, now, opts.timeoutMs); },
    async ask(question, ctx, opts) {
      // Ask mode: LandPortal shows the full property on one page, so any property
      // question is answered by running the property workflow and reading the
      // relevant field from the loaded page. The router records the intent.
      const route = routeBrowserQuestion(question, ctx);
      const ev = await runLandPortalWorkflow({ searchKey: route.searchKey }, driver, now, opts.timeoutMs);
      ev.mode = 'ask';
      if (ev.status !== 'parked' && ev.status !== 'error') {
        ev.note = `Asked: "${route.intent}". ${ev.note}`;
      }
      return ev;
    },
  };
}

/** Demonstrate the read-only contract: a billing/credit action is always blocked. */
export function landPortalBlockedExample(): BrowserEvidence {
  const ev = emptyEvidence('landportal', 'workflow');
  recordBlocked(ev, 'generate_paid_report', 'LandPortal paid report would consume credits — blocked by read-only contract.');
  recordBlocked(ev, 'paid_export', 'Paid export would incur cost — blocked.');
  ev.note = 'Read-only contract: credit/billing actions are recorded as blocked and never performed.';
  return ev;
}
