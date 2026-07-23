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

// The functions passed to driver.evaluate() execute INSIDE the operator's
// browser (not Node), so the DOM globals are declared as `any` purely to satisfy
// the Node typechecker. They are never executed in this process.
declare const document: any;
declare const Event: any;
declare const window: any;
declare const HTMLFormElement: any;
declare const HTMLSelectElement: any;
declare const HTMLInputElement: any;

import {
  type BrowserService, type BrowserDriver, type BrowserEvidence, type BrowserWorkflowInput,
  type BrowserSearchKey, type BrowserFact, type BrowserRunHooks,
  makeParkedDriver, emptyEvidence, routeBrowserQuestion, recordBlocked,
} from './browser-intelligence.js';
import type { PropertyPatch } from './normalized-property.js';
import { planParcelSearch, pickParcelRecordLink, type FormInfo, type NavSearchKey } from './browser-navigator.js';
import { planNetrWorkflow, buildNetrStateUrl, type NetrStep } from './browser-retrieval.js';
import { COUNTY_WORKFLOW_FOR, type DdField } from './missing-field-analysis.js';
import {
  extractCountySources, officialSearchQuery, pickOfficialResult, netrIsStale,
  searchEngineUrl, unwrapSearchResults,
  governmentSourceScopePriority, orderCountySourcesLocalFirst,
  COUNTY_SOURCE_TYPES, type CountySourceLink, type CountySourceType,
} from './netr-routing.js';
import { extractRecordFacts, extractAgencyContact, parcelRecordSignal, type ExtractContext } from './semantic-extract.js';
import { getCountySources, saveCountySources, isCountyCacheFresh } from './county-source-map.js';
import { CountyResearchCapability } from './county-research-capability.js';
import { apnSearchVariants } from './opportunity-research-mission.js';
import { statewidePortalFor, type StatewidePortal } from './statewide-assessment-portals.js';

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
  hooks: Partial<BrowserRunHooks> = {},
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('county_records', 'workflow');
  const key = input.searchKey;
  const mode = input.mode ?? 'parcel_fact';
  // timeoutMs is a workflow budget, not a fresh allowance for every page,
  // form, and fallback. Reissuing the full timeout at each step made a
  // 45-second call-prep lane run for many minutes on counties with several
  // official sources. Every browser operation now receives only the remaining
  // budget and the workflow stops cleanly when that shared deadline expires.
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  const expired = () => Date.now() >= deadline;
  const remaining = () => Math.max(250, deadline - Date.now());
  const cancelled = () => (hooks.isCancelled ? hooks.isCancelled() : false);
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

  let sources: CountySourceLink[] = [];
  let netrUrl: string | null = null;
  let usedSearchFallback = false;
  const cached = getCountySources(state, county);
  if (isCountyCacheFresh(cached) && cached) {
    sources = cached.sources; netrUrl = cached.netrUrl; usedSearchFallback = cached.usedSearchFallback;
    ev.sourceUrls.push('cache:county-source-map');
  } else {
    try {
      const stateUrl = buildNetrStateUrl(state);
      await driver.open(stateUrl, { timeoutMs: remaining() });
      const stateLinks = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
      const countyRx = new RegExp(`\\b${county.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const countyLink = stateLinks.find((l) => countyRx.test(l.text) && /netronline/i.test(l.href));
      netrUrl = countyLink?.href ?? stateUrl;
      const countyPage = await driver.open(netrUrl, { timeoutMs: remaining() });
      ev.sourceUrls.push(countyPage.url || netrUrl);
      const countyLinks = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
      sources = extractCountySources(countyLinks, { origin: 'netr', county, state });
    } catch { sources = []; }

    if (netrIsStale(sources)) {
      usedSearchFallback = true;
      for (const type of ['assessor', 'appraiser', 'tax', 'recorder', 'gis'] as CountySourceType[]) {
        if (expired()) break;
        if (sources.some((s) => s.type === type)) continue;
        try {
          await driver.open(searchEngineUrl(officialSearchQuery(type, county, state)), { timeoutMs: remaining() });
          const raw = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
          const picked = pickOfficialResult(unwrapSearchResults(raw), type, county, state);
          if (picked) sources.push(picked);
        } catch { /* keep going */ }
      }
    }

    const status: 'routed' | 'partial' | 'not_found' = sources.length === 0 ? 'not_found' : netrIsStale(sources) ? 'partial' : 'routed';
    const confidence: 'high' | 'medium' | 'low' = status === 'routed' ? 'high' : status === 'partial' ? 'medium' : 'low';
    try {
      saveCountySources({ state, county, netrUrl, sources, usedSearchFallback, status, confidence, notes: usedSearchFallback ? 'NETR thin/stale — used official search fallback for missing sources.' : 'Routed via NETR Online.' });
    } catch { /* cache best-effort */ }

    const deepLinks = new Map<string, CountySourceLink>();
    for (const src of sources) {
      if (expired()) break;
      try {
        await driver.open(src.url, { timeoutMs: remaining() });
        const found = await scanPageForSearchLinks(driver, src.url, remaining());
        for (const dl of found) {
          const k = dl.url;
          if (!deepLinks.has(k)) deepLinks.set(k, dl);
        }
      } catch { /* skip */ }
    }
    if (deepLinks.size > 0) {
      sources = [...sources, ...deepLinks.values()];
    }
  }

  ev.sourcesUsed = sources.map((s) => ({ type: s.type, url: s.url, origin: s.origin === 'netr' ? 'netr_county' as const : 'search_fallback' as const, confidence: s.confidence }));
  const countyCapability = new CountyResearchCapability();
  const runReference = `county-records/${state.toLowerCase()}/${county.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${now()}`;
  let guidanceKind: 'county_verified' | 'platform_template' | 'none' = 'none';
  try {
    countyCapability.observeLocalSources({ state, county, sources, observedAt: now(), runReference });
    guidanceKind = countyCapability.guidance(state, county).kind;
  } catch { /* capability memory must never prevent public-record retrieval */ }

  const facts: BrowserFact[] = [];
  const emit = (f: BrowserFact) => { facts.push(f); try { hooks.onFact?.(f); } catch { /* non-fatal */ } };
  const factPriority: CountySourceType[] = ['assessor', 'appraiser', 'tax', 'gis', 'recorder', 'planning', 'building'];
  const deepPriority: CountySourceType[] = ['recorder', 'planning', 'building', 'assessor', 'appraiser', 'tax', 'gis'];
  const locality = { county, city: key.city, state };
  const ordered = orderCountySourcesLocalFirst(sources, locality).sort((a, b) => {
    const localDiff = governmentSourceScopePriority(a, locality) - governmentSourceScopePriority(b, locality);
    if (localDiff !== 0) return localDiff;
    return (mode === 'deep_record' ? deepPriority : factPriority).indexOf(a.type) - (mode === 'deep_record' ? deepPriority : factPriority).indexOf(b.type);
  });
  let screenshotTaken = false;
  let stopped = false;
  let recipeRecorded = false;
  for (const src of ordered) {
    if (cancelled() || expired()) { stopped = true; break; }
    const ctx = { sourceName: `${county} County ${labelFor(src.type)}`, sourceType: src.type, sourceUrl: src.url, origin: src.origin === 'netr' ? 'netr_county' as const : 'search_fallback' as const };
    try {
      let page = await driver.open(src.url, { timeoutMs: remaining() });
      let merged: Record<string, string> = { ...page.fields };
      let method = 'official source link';
      const forms: FormInfo[] = (await driver.readForms?.({ timeoutMs: remaining() })) ?? [];
      let plan = planParcelSearch(forms, key);
      let foundRecord = false;
      let searchKey = key;
      const identifierFallbacks: Array<NavSearchKey> = [];
      if (key.apn) identifierFallbacks.push({ apn: key.apn, county: key.county, state: key.state });
      if (key.owner) identifierFallbacks.push({ owner: key.owner, county: key.county, state: key.state });
      if (key.address) identifierFallbacks.push({ address: key.address, county: key.county, state: key.state });
      for (const fallbackKey of identifierFallbacks) {
        if (foundRecord) break;
        plan = planParcelSearch(forms, fallbackKey);
        if (!plan || !driver.fillAndSubmit) continue;
        const values = plan.idKind === 'apn'
          ? [plan.value, ...apnSearchVariants(plan.value).slice(1)].slice(0, 6)
          : [plan.value, ...plan.valueAlternates].slice(0, 4);
        for (const value of values) {
          if (cancelled() || expired()) { stopped = true; break; }
          const after = await driver.fillAndSubmit(plan.fieldSelector, value, plan.submitSelector, { timeoutMs: remaining() });
          const links = (await driver.readLinks?.({ timeoutMs: remaining() })) ?? [];
          const record = pickParcelRecordLink(links, fallbackKey);
          if (record) {
            const rp = await driver.open(record.href, { timeoutMs: remaining() });
            merged = { ...merged, ...rp.fields, ...(await driver.readFields({ timeoutMs: remaining() })).fields };
            method = `parcel search (${plan.idKind}) → record`;
            foundRecord = true;
            break;
          }
          if (Object.keys(after.fields).length > Object.keys(page.fields).length) {
            merged = { ...merged, ...after.fields };
            method = `parcel search (${plan.idKind})`;
          }
        }
      }
      if (!foundRecord) {
        merged = { ...merged, ...(await driver.readFields({ timeoutMs: remaining() })).fields };
      }
      if (stopped) break;
      const pageIsRecord = parcelRecordSignal(merged) >= 2;
      const ext = pageIsRecord
        ? extractRecordFacts(merged, ctx, { pageIsRecord: true }).map((f) => ({ ...f, extractionMethod: method }))
        : [];
      const linkFact: BrowserFact = { key: `${src.type}Link`, label: `${labelFor(src.type)} link`, value: src.url, sourceName: ctx.sourceName, sourceType: src.type, sourceUrl: src.url, confidence: src.confidence >= 0.7 ? 'high' : 'medium', origin: ctx.origin, status: 'extracted', extractionMethod: 'official source link' };
      if (ext.length > 0) {
        for (const f of ext) emit(f);
        if (!recipeRecorded) {
          try {
            const searchMethods = [key.apn ? 'apn' : null, key.address ? 'address' : null, key.owner ? 'owner' : null]
              .filter((value): value is 'apn' | 'address' | 'owner' => value !== null);
            countyCapability.recordSuccessfulLookup({
              state, county, source: src, searchMethods: searchMethods.length ? searchMethods : ['address'],
              validatedFacts: [...new Set(ext.map((fact) => fact.key))], observedAt: now(), runReference,
            });
            recipeRecorded = true;
          } catch { /* real facts remain usable even if reusable memory cannot update */ }
        }
        if (!screenshotTaken && !expired()) { try { ev.screenshots.push(await driver.screenshot(`county_${src.type}_record`, { timeoutMs: remaining() })); } catch { /* optional */ } screenshotTaken = true; }
      } else {
        emit(linkFact);
        for (const a of extractAgencyContact(merged, ctx)) emit({ ...a, extractionMethod: 'agency contact page (not a parcel record)' });
      }
    } catch { /* try the next source; never stop on one */ }
  }

  const statewideFacts = !expired() && facts.filter((f) => f.status === 'extracted').length === 0
    ? await (async (): Promise<BrowserFact[] | null> => {
        const portal = statewidePortalFor(state);
        if (!portal || !driver.evaluate) return null;
        const portalCtx: ExtractContext = {
          sourceName: `${state} Statewide Assessment Portal`,
          sourceType: 'assessor',
          sourceUrl: portal.url,
          origin: 'search_fallback',
        };
        return tryStatewidePortalFallback(driver, portal, key, portalCtx, remaining(), now, countyCapability, runReference);
      })()
    : null;
  if (statewideFacts) {
    for (const f of statewideFacts) emit(f);
    ev.sourceUrls.push(`statewide:${state}`);
  }

  ev.facts = facts;
  ev.patch = factsToPatch(facts);
  const extractedCount = facts.filter((f) => f.status === 'extracted').length;
  ev.status = extractedCount > 0 ? 'retrieved' : sources.length > 0 ? 'partial' : 'no_match';
  const stoppedNote = stopped ? 'Stopped by operator — facts already found are saved. ' : '';
  ev.note = sources.length === 0
    ? `${stoppedNote}No official county source could be routed for ${county}, ${state} (NETR + search). Records marked Needs Verification.`
    : `${stoppedNote}County Records (${mode}) via ${usedSearchFallback ? 'NETR + official search fallback' : 'NETR Online'}: ${sources.length} official source(s) (${ev.sourcesUsed.map((s) => s.type).join(', ')}); ${extractedCount} public-record fact(s) with provenance. ${guidanceKind === 'county_verified' ? 'Reused a verified county navigation recipe.' : guidanceKind === 'platform_template' ? 'Started from value-free guidance learned from this portal family; county facts were still independently verified.' : 'No prior county/platform recipe was assumed.'} LandPortal-first; no duplicate retrieval.`;
  return ev;
}

function labelFor(t: CountySourceType): string {
  return ({ assessor: 'Assessor', appraiser: 'Property Appraiser', tax: 'Tax Office', gis: 'GIS', recorder: 'Recorder / Register of Deeds', planning: 'Planning & Zoning', building: 'Building Dept' } as Record<CountySourceType, string>)[t];
}

// ── Deep-link following + statewide fallback ──────────────────────────────────

async function scanPageForSearchLinks(
  driver: BrowserDriver,
  baseUrl: string,
  timeoutMs: number,
): Promise<CountySourceLink[]> {
  const links = (await driver.readLinks?.({ timeoutMs })) ?? [];
  const searchRx = /property\s+search|parcel\s+search|parcel\s+viewer|gis\s+map|assessment|tax\s+search|record\s+search|deed\s+search/i;
  const vendorRx = /tylertech|tylerhost|governmax|qpublic|schneidercorp|schneidergis|beacon|arcgis\.com/i;
  const out: CountySourceLink[] = [];
  for (const l of links) {
    const hay = `${l.text} ${l.href}`.toLowerCase();
    if (!/^https?:/i.test(l.href)) continue;
    if (/netronline|zillow|realtor|redfin|trulia|spokeo|whitepages|propertyshark|landglide|regrid|loopnet|facebook|google\.com\/search/i.test(l.href)) continue;
    const isSearch = searchRx.test(hay) || vendorRx.test(hay);
    if (!isSearch) continue;
    let type: CountySourceType = 'gis';
    if (/assessor|appraisal|assessment/i.test(hay)) type = 'assessor';
    else if (/tax\s+search|tax\s+collector|treasurer|property\s+tax/i.test(hay)) type = 'tax';
    else if (/recorder|register\s+of\s+deeds|deed/i.test(hay)) type = 'recorder';
    else if (/planning|zoning/i.test(hay)) type = 'planning';
    out.push({ type, url: l.href, label: l.text.slice(0, 80).trim(), origin: 'search_fallback', confidence: 0.6 });
  }
  return out;
}

async function tryStatewidePortalFallback(
  driver: BrowserDriver,
  portal: StatewidePortal,
  key: BrowserSearchKey,
  ctx: ExtractContext,
  timeoutMs: number,
  now: () => string,
  countyCapability: CountyResearchCapability,
  runReference: string,
): Promise<BrowserFact[] | null> {
  const facts: BrowserFact[] = [];
  try {
    if (!driver.evaluate) return null;
    let page = await driver.open(portal.url, { timeoutMs });
    await new Promise((r) => setTimeout(r, 3000));
    let merged: Record<string, string> = { ...page.fields };

    const evaluate = <T>(fn: (() => T) | string, ...args: unknown[]): Promise<T | undefined> => driver.evaluate!(fn as unknown as () => T, ...args);

    if (portal.platform === 'aspnet') {
      const GET_COUNTY_CODE = (() => {
        const fn = (countyName: string): string | null => {
          const sel = document.querySelector('#countySelect, select[name="Jur"]');
          if (!sel) return null;
          for (const opt of (sel as any).options) {
            if ((opt.textContent || '').toLowerCase().includes(countyName.toLowerCase())) return opt.value;
          }
          return null;
        };
        return fn as unknown as () => string;
      })();
      const countyCode = await evaluate(GET_COUNTY_CODE, key.county ?? '');

      const FILL_FORM = (() => {
        const fn = (params: Record<string, string | undefined>): string => {
          const out: string[] = [];
          if (params.countyCode) {
            const sel = document.querySelector('#countySelect, select[name="Jur"]') as any;
            if (sel) { sel.value = params.countyCode; sel.dispatchEvent(new Event('change', { bubbles: true })); out.push('county=' + params.countyCode); }
          }
          const parts = (params.apn || '').replace(/[^0-9A-Za-z]/g, ' ').trim().split(/\s+/);
          const cm = parts[0] || '';
          const pn = parts[parts.length - 1] || '';
          const cmInput = document.querySelector('#controlMapSelect, input[name="ControlMap"]') as any;
          if (cmInput) { cmInput.value = cm; cmInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('cm=' + cm); }
          const pnInput = document.querySelector('#parcelSelect, input[name="ParcelNumber"]') as any;
          if (pnInput) { pnInput.value = pn; pnInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('pn=' + pn); }
          const qInput = document.querySelector('#Query, input[name="Query"]') as any;
          if (qInput) { qInput.value = params.apn; qInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('query=' + params.apn); }
          const oInput = document.querySelector('#ownerSelect, input[name="Owner"]') as any;
          if (oInput && params.owner) { oInput.value = params.owner; oInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('owner=' + params.owner); }
          const aInput = document.querySelector('#propertyAddressSelect, input[name="PropertyAddress"]') as any;
          if (aInput && params.address) { aInput.value = params.address; aInput.dispatchEvent(new Event('input', { bubbles: true })); out.push('addr=' + params.address); }
          return out.join(',');
        };
        return fn as unknown as () => string;
      })();
      await evaluate(FILL_FORM, { countyCode: countyCode ?? undefined, apn: key.apn ?? '', owner: key.owner, address: key.address });

      const CLICK_SEARCH = (() => {
        const fn = (): string => {
          const btns = Array.from(document.querySelectorAll('button.searchButton, input.searchButton, button[type="submit"], input[type="submit"]'));
          const searchBtn = btns.find((b: any) => ((b.textContent || b.getAttribute?.('value') || '')).trim() === 'Search') as any;
          if (searchBtn) { searchBtn.click(); return 'clicked_search'; }
          const form = document.querySelector('#advancedSearchForm, #basicSearchForm, form');
          if (form) { form.submit(); return 'submitted_form'; }
          return 'not_found';
        };
        return fn as unknown as () => string;
      })();
      const clicked = await evaluate(CLICK_SEARCH);

      if (clicked === 'clicked_search' || clicked === 'submitted_form') {
        await new Promise((r) => setTimeout(r, 5000));
        const afterPage = await driver.readFields?.({ timeoutMs });
        if (afterPage) merged = { ...merged, ...afterPage.fields };
      }
    }

    const GET_BODY = (() => {
      const fn = (): string => { return (document.body?.innerText || '').slice(0, 2000); };
      return fn as unknown as () => string;
    })();
    const bodySnippet = (await evaluate(GET_BODY)) ?? '';
    const resultsRx = /showing\s+\d+\s+to\s+\d+\s+of\s+\d+\s+entries|results\s+for/i;
    if (bodySnippet && resultsRx.test(bodySnippet.toLowerCase())) {
      const GET_PARCEL_LINKS = (() => {
        const fn = (): Array<{ text: string; href: string }> => {
          const out: Array<{ text: string; href: string }> = [];
          document.querySelectorAll('a').forEach((a: any) => {
            const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
            const href = a.getAttribute('href') || '';
            if (/view|parcel|detail|property/i.test(text) && href && !/^(https?:)?\/\/tnmap/.test(href)) {
              out.push({ text, href });
            }
          });
          return out;
        };
        return fn as unknown as () => Array<{ text: string; href: string }>;
      })();
      const parcelLinks = await evaluate(GET_PARCEL_LINKS);

      if (parcelLinks && parcelLinks.length > 0) {
        let detailPage = await driver.open(parcelLinks[0].href, { timeoutMs });
        await new Promise((r) => setTimeout(r, 4000));
        const detailFields = await driver.readFields?.({ timeoutMs }) ?? detailPage;
        merged = { ...merged, ...detailFields.fields };

        const pageIsRecord = parcelRecordSignal(merged) >= 2;
        if (pageIsRecord) {
          const ext = extractRecordFacts(merged, ctx, { pageIsRecord: true });
          facts.push(...ext);
          try {
            countyCapability.recordSuccessfulLookup({
              state: ctx.sourceUrl.includes('tn.gov') ? 'TN' : '',
              county: key.county ?? '',
              source: { type: 'assessor', url: portal.url, label: `${key.county} County Assessor (statewide)`, origin: 'search_fallback', confidence: 0.7 },
              searchMethods: key.apn ? ['apn'] : key.owner ? ['owner'] : ['address'],
              validatedFacts: [...new Set(ext.map((f) => f.key))],
              observedAt: now(),
              runReference,
            });
          } catch { /* best-effort */ }
        }
      }
    }
  } catch { /* statewide portal is best-effort */ }
  return facts.length > 0 ? facts : null;
}

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
    runWorkflow(input, opts) { return runCountyWorkflow(input, driver, now, opts.timeoutMs, opts); },
    async ask(question, ctx, opts) {
      const route = routeBrowserQuestion(question, ctx);
      const wf = COUNTY_WORKFLOW_FOR[route.intent as DdField] ?? 'assessor';
      const ev = await runCountyWorkflow({ searchKey: route.searchKey, neededFields: [route.intent] }, driver, now, opts.timeoutMs);
      ev.mode = 'ask';
      if (ev.status !== 'parked' && ev.status !== 'error') ev.note = `Asked: "${route.intent}" → ${wf}. ${ev.note}`;
      return ev;
    },
  };
}

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
