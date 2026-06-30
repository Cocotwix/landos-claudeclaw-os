// LandOS — County Records Browser service (Phase 4).
//
// Fills gaps left by LandPortal and verifies critical PUBLIC records. It browses
// county sites like an experienced land researcher — assessor, tax office, GIS,
// recorder, clerk, planning, zoning, deeds, plat maps, tax history, ownership,
// parcel maps, road frontage, recorded documents, and other public resources. It
// is NOT a restricted robot: it follows links, opens PDFs, reads tables, and
// extracts data. If NETR links fail, it searches intelligently for the current
// county site and continues — it never stops because a link changed.
//
// Workflow mode retrieves ONLY what is still missing after LandPortal (gap-fill,
// no duplicate retrieval). Ask mode answers natural public-record questions and
// determines the correct workflow automatically. Public records require no login;
// it only stops for payments, credentialed logins, destructive actions, or
// unsolvable CAPTCHAs. Driver is injectable; the default parked stub never fakes.

import {
  type BrowserService, type BrowserDriver, type BrowserEvidence, type BrowserWorkflowInput,
  type BrowserSearchKey, type BrowserFact,
  makeParkedDriver, emptyEvidence, routeBrowserQuestion, recordBlocked,
} from './browser-intelligence.js';
import type { PropertyPatch } from './normalized-property.js';
import { planNetrWorkflow, buildNetrStateUrl, type NetrStep } from './browser-retrieval.js';
import { COUNTY_WORKFLOW_FOR, type DdField } from './missing-field-analysis.js';
import {
  extractCountySources, officialSearchQuery, pickOfficialResult, netrIsStale,
  searchEngineUrl, unwrapSearchResults,
  COUNTY_SOURCE_TYPES, type CountySourceLink, type CountySourceType,
} from './netr-routing.js';
import { extractRecordFacts } from './semantic-extract.js';
import { getCountySources, saveCountySources, isCountyCacheFresh } from './county-source-map.js';

/** County workflow targets (the public resources the researcher navigates). */
export const COUNTY_WORKFLOWS = [
  'assessor', 'tax_office', 'gis', 'recorder', 'clerk', 'planning_zoning',
] as const;
export type CountyWorkflow = (typeof COUNTY_WORKFLOWS)[number];

/** Map a county workflow to the NETR navigation step it begins from. */
const WORKFLOW_NETR_STEP: Record<string, NetrStep> = {
  assessor: 'locate_assessor',
  tax_office: 'locate_tax_records',
  gis: 'locate_gis',
  recorder: 'locate_recorder',
  clerk: 'locate_recorder',
  planning_zoning: 'locate_county',
};

export interface CountyRecordsBrowserDeps {
  driver?: BrowserDriver;
  now?: () => string;
}

/** Reasons the county researcher legitimately stops (and records as blocked). */
export const COUNTY_STOP_CONDITIONS = ['payment', 'credentialed_login', 'destructive_action', 'unsolvable_captcha'] as const;

function workflowsForNeeded(neededFields?: string[]): CountyWorkflow[] {
  if (!neededFields || neededFields.length === 0) return [...COUNTY_WORKFLOWS];
  const set = new Set<string>();
  for (const f of neededFields) {
    const wf = COUNTY_WORKFLOW_FOR[f as DdField];
    if (wf) set.add(wf);
  }
  // Always include planning_zoning if zoning-ish gaps exist; assessor as baseline.
  return [...set].filter((w): w is CountyWorkflow => (COUNTY_WORKFLOWS as readonly string[]).includes(w));
}

/**
 * County Records workflow — REAL NETR-routed semantic retrieval (no county-
 * specific scrapers). Runs only after LandPortal. Steps:
 *   1. Reuse the County Source Map cache when fresh (routing is reused per county).
 *   2. Else route via NETR Online: open the state page → find the county link →
 *      read the county page links → classify official sources semantically.
 *   3. If NETR is stale/missing core sources → intelligent web search for the
 *      official county site (prefer .gov / county-owned), labeled search_fallback.
 *   4. Persist the routing to the County Source Map.
 *   5. Visit the official sources → semantic-extract public-record facts with full
 *      provenance (never guessing). GIS/recorder/planning are kept as labeled links.
 * Parked driver returns honest `parked` evidence with the planned routing.
 */
async function runCountyWorkflow(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('county_records', 'workflow');
  const key = input.searchKey;
  const state = (key.state ?? '').trim();
  const county = (key.county ?? '').replace(/\s+county$/i, '').trim();
  const targets = workflowsForNeeded(input.neededFields);
  const plan = planNetrWorkflow({ county, state }, { configured: driver.configured() });

  if (!driver.configured()) {
    ev.status = 'parked';
    ev.sourceUrls.push(plan.directoryUrl);
    ev.note = `County Records parked (no live session). Plan: route ${county || '<county>'}, ${state || '<state>'} via NETR → official sources (${targets.join(', ')}); search fallback if NETR is stale. Runs only after LandPortal; no credential/login for public records.`;
    return ev;
  }
  if (!state || !county) {
    ev.status = 'no_match';
    ev.note = 'Need state + county to route county records (provide a verified locality first).';
    return ev;
  }

  // ── 1. County Source Map cache (reuse routing across leads) ─────────────
  let sources: CountySourceLink[] = [];
  let netrUrl: string | null = null;
  let usedSearchFallback = false;
  const cached = getCountySources(state, county);
  if (isCountyCacheFresh(cached) && cached) {
    sources = cached.sources; netrUrl = cached.netrUrl; usedSearchFallback = cached.usedSearchFallback;
    ev.sourceUrls.push('cache:county-source-map');
  } else {
    // ── 2. NETR routing: state page → county link → county sources ────────
    try {
      const stateUrl = buildNetrStateUrl(state);
      await driver.open(stateUrl, { timeoutMs });
      const stateLinks = (await driver.readLinks?.({ timeoutMs })) ?? [];
      const countyRx = new RegExp(`\\b${county.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const countyLink = stateLinks.find((l) => countyRx.test(l.text) && /netronline/i.test(l.href));
      netrUrl = countyLink?.href ?? stateUrl;
      const countyPage = await driver.open(netrUrl, { timeoutMs });
      ev.sourceUrls.push(countyPage.url || netrUrl);
      const countyLinks = (await driver.readLinks?.({ timeoutMs })) ?? [];
      sources = extractCountySources(countyLinks, { origin: 'netr', county, state });
    } catch { sources = []; }

    // ── 3. Search fallback for missing core sources (NETR stale/dead) ──────
    // Real web search (static-results engine the browser can read), not a page
    // form. Prefer official .gov / county sources; label as search_fallback.
    if (netrIsStale(sources)) {
      usedSearchFallback = true;
      for (const type of ['assessor', 'appraiser', 'tax', 'recorder', 'gis'] as CountySourceType[]) {
        if (sources.some((s) => s.type === type)) continue;
        try {
          await driver.open(searchEngineUrl(officialSearchQuery(type, county, state)), { timeoutMs });
          const raw = (await driver.readLinks?.({ timeoutMs })) ?? [];
          const picked = pickOfficialResult(unwrapSearchResults(raw), type, county, state);
          if (picked) sources.push(picked);
        } catch { /* keep going */ }
      }
    }

    // ── 4. Persist routing to the County Source Map ───────────────────────
    const status: 'routed' | 'partial' | 'not_found' = sources.length === 0 ? 'not_found' : netrIsStale(sources) ? 'partial' : 'routed';
    const confidence: 'high' | 'medium' | 'low' = status === 'routed' ? 'high' : status === 'partial' ? 'medium' : 'low';
    try {
      saveCountySources({ state, county, netrUrl, sources, usedSearchFallback, status, confidence, notes: usedSearchFallback ? 'NETR thin/stale — used official search fallback for missing sources.' : 'Routed via NETR Online.' });
    } catch { /* cache best-effort */ }
  }

  ev.sourcesUsed = sources.map((s) => ({ type: s.type, url: s.url, origin: s.origin === 'netr' ? 'netr_county' as const : 'search_fallback' as const, confidence: s.confidence }));

  // ── 5. Visit official sources → semantic-extract facts (with provenance) ─
  const facts: BrowserFact[] = [];
  const priority: CountySourceType[] = ['assessor', 'appraiser', 'tax', 'recorder', 'gis', 'planning', 'building'];
  const ordered = [...sources].sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
  let screenshotTaken = false;
  for (const src of ordered) {
    try {
      const page = await driver.open(src.url, { timeoutMs });
      const read = await driver.readFields({ timeoutMs });
      const merged = { ...page.fields, ...read.fields };
      const ext = extractRecordFacts(merged, {
        sourceName: `${county} County ${labelFor(src.type)}`, sourceType: src.type, sourceUrl: src.url,
        origin: src.origin === 'netr' ? 'netr_county' : 'search_fallback',
      });
      // Any official source with no labeled record fields (landing/search pages,
      // map portals) is still surfaced as a clickable, provenance-labeled LINK so
      // the operator gets every official county source on the Deal Card.
      if (ext.length === 0) {
        facts.push({ key: `${src.type}Link`, label: `${labelFor(src.type)} link`, value: src.url, sourceName: `${county} County ${labelFor(src.type)}`, sourceType: src.type, sourceUrl: src.url, confidence: src.confidence >= 0.7 ? 'high' : 'medium', origin: src.origin === 'netr' ? 'netr_county' : 'search_fallback', status: 'extracted' });
      } else {
        facts.push(...ext);
      }
      if (!screenshotTaken && ext.length > 0) { try { ev.screenshots.push(await driver.screenshot(`county_${src.type}_record`, { timeoutMs })); } catch { /* optional */ } screenshotTaken = true; }
    } catch { /* try the next source; never stop on one */ }
  }

  ev.facts = facts;
  ev.patch = factsToPatch(facts);
  const extractedCount = facts.filter((f) => f.status === 'extracted').length;
  ev.status = extractedCount > 0 ? 'retrieved' : sources.length > 0 ? 'partial' : 'no_match';
  ev.note = sources.length === 0
    ? `No official county source could be routed for ${county}, ${state} (NETR + search). Records marked Needs Verification.`
    : `County Records via ${usedSearchFallback ? 'NETR + official search fallback' : 'NETR Online'}: ${sources.length} official source(s) (${ev.sourcesUsed.map((s) => s.type).join(', ')}); ${extractedCount} public-record fact(s) extracted with provenance. LandPortal-first; no duplicate retrieval.`;
  return ev;
}

function labelFor(t: CountySourceType): string {
  return ({ assessor: 'Assessor', appraiser: 'Property Appraiser', tax: 'Tax Office', gis: 'GIS', recorder: 'Recorder / Register of Deeds', planning: 'Planning & Zoning', building: 'Building Dept' } as Record<CountySourceType, string>)[t];
}

/** Map extracted county facts → a property patch (gap-fill only; mergeNormalized
 *  never overwrites a verified-source value). Identity facts only when official. */
function factsToPatch(facts: BrowserFact[]): PropertyPatch {
  const patch: PropertyPatch = {};
  const fact = (key: string) => facts.find((f) => f.key === key && f.status === 'extracted');
  const owner = fact('owner'); if (owner) patch.owner = owner.value;
  const apn = fact('apn'); if (apn) patch.apn = apn.value;
  const situs = fact('situsAddress'); if (situs) patch.address = situs.value;
  const acreage = fact('acreage'); if (acreage) { const n = Number(acreage.value.replace(/[^0-9.]/g, '')); if (Number.isFinite(n) && n > 0) patch.acres = n; }
  return patch;
}

export function makeCountyRecordsBrowser(deps: CountyRecordsBrowserDeps = {}): BrowserService {
  const driver = deps.driver ?? makeParkedDriver('county_records');
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    id: 'county_records',
    label: 'County Records Browser (public-record research)',
    modes: ['workflow', 'ask'],
    configured() { return driver.configured(); },
    runWorkflow(input, opts) { return runCountyWorkflow(input, driver, now, opts.timeoutMs); },
    async ask(question, ctx, opts) {
      const route = routeBrowserQuestion(question, ctx);
      // Map the asked intent to its county workflow target.
      const wf = COUNTY_WORKFLOW_FOR[route.intent as DdField] ?? 'assessor';
      const ev = await runCountyWorkflow({ searchKey: route.searchKey, neededFields: [route.intent] }, driver, now, opts.timeoutMs);
      ev.mode = 'ask';
      if (ev.status !== 'parked' && ev.status !== 'error') ev.note = `Asked: "${route.intent}" → ${wf}. ${ev.note}`;
      return ev;
    },
  };
}

/** The county researcher legitimately stops only for payment/login/destructive/
 *  CAPTCHA — recorded as blocked, never a refusal to do normal public research. */
export function countyStopExample(condition: (typeof COUNTY_STOP_CONDITIONS)[number]): BrowserEvidence {
  const ev = emptyEvidence('county_records', 'workflow');
  if (condition === 'payment') recordBlocked(ev, 'purchase', 'A paid record purchase was required — stopped (no payment).');
  else if (condition === 'credentialed_login') recordBlocked(ev, 'store_credentials', 'A credentialed login was required — stopped (no credential stored).');
  else if (condition === 'destructive_action') recordBlocked(ev, 'any_write', 'A write/destructive action was required — stopped.');
  else recordBlocked(ev, 'navigate', 'An unsolvable CAPTCHA blocked navigation — stopped.');
  ev.status = 'blocked';
  ev.note = `County research stopped only for: ${condition}. It otherwise browses public records freely.`;
  return ev;
}
