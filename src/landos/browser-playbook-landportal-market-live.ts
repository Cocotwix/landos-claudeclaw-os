// LandOS — LandPortal Market Research playbook: LIVE browser backend.
//
// The REAL backend for Browser Playbook #1. It drives the operator's persistent,
// already-authenticated Chrome (over the existing CDP session in browser-session)
// to run LandPortal › Market Research › Drill Deep and read the visible table into
// a RawMarketTable — the SAME shape the replay capture produces, so the playbook +
// ingestion pipeline are identical for live and replay.
//
// STRICT READ-ONLY, MARKET-RESEARCH SCOPE ONLY. It navigates to /market-research/,
// opens the Drill Deep tab, sets Status=Sold / Data=Land / Time=1 Year /
// Acreage=2–5, groups by State, expands State→County→(ZIP for a bounded set of
// counties), and reads explicit cell values + row identity (data-state / data-fips
// / data-county / data-zip). It NEVER clicks Buy tokens / Comp reports / Export /
// Unlock / add-to-cart (paid), never writes, never reads or prints cookies/tokens.
//
// Live navigation requires the built server (node dist): page.evaluate function
// refs don't survive the tsx/esbuild name-helper transform. This matches the rest
// of the live browser stack (browser-session.ts).

import path from 'path';
import { withWorkingPage, browserSessionStatus, ensureBrowserSession, type PageLike } from './browser-session.js';
import { STATE_FIPS } from './market-matrix.js';
import { FIPS_TO_STATE } from './market-matrix.js';
import { verifyMetricHeaders } from './browser-playbook-landportal-market.js';
import type { MarketResearchBackend, RawMarketTable, RawMarketRow, MarketRowLevel, ExtractionDiagnostics } from './browser-playbook-landportal-market.js';

// These functions execute INSIDE the operator's browser (not Node), so DOM
// globals are declared as `any` purely for the Node typechecker (same pattern as
// browser-session.ts). They are never executed in this process.
declare const document: any;
declare const Event: any;

// page.evaluate() in PageLike is typed as (() => T) — a helper to pass an
// argument-taking in-page function without losing type-safety at the call site.
type EvalFn<T> = (() => T);
const withArgs = <T>(fn: (...a: any[]) => T): EvalFn<T> => fn as unknown as EvalFn<T>;

// LandPortal Drill Deep selector/config map — the ONE place DOM coordinates live.
// These are STABLE SEMANTIC selectors (element IDs + data-* attributes + a
// dedicated grid class), not brittle nth-child paths, so a LandPortal markup
// change is a config edit here, not a code rewrite.
const LP = {
  url: 'https://landportal.com/market-research/',
  drillDeepTab: 'Drill Deep',
  grid: '.drill-table-scroll table',
  controls: { data: 'mrdrill_source', time: 'mrdrill_date', acreage: 'acre_range' }, // native <select> ids
  filterOptions: { dataLand: 'Land', time1Year: '1 year' },
  toggles: { statusSold: 'Sold', groupByState: 'State' },
  rows: { state: 'tr.state-row', county: 'tr.county-row', zip: 'tr.zip-row', expander: 'button.expander-btn' },
} as const;
const MARKET_RESEARCH_URL = LP.url;
const GRID_SELECTOR = LP.grid;

/** The 10 canonical metric columns, in the fixed trailing order LandPortal renders
 *  them (Count … PPA), for every row level. Used as the discovered header set. */
const METRIC_HEADERS = ['Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Current quarter key (YYYY-Qn) — the snapshot period the "1 Year" window rolls into. */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

// ── In-page readers/actions (run INSIDE the operator's browser) ─────────────
// Kept as plain function refs (compiled by tsc for the built server). Read-only.

function readLoginLike(): boolean {
  const body = ((document as any).body?.innerText || '').slice(0, 2000);
  const hasGrid = !!(document as any).querySelector('.drill-table-scroll, .drill_deep');
  return /sign in|log in|password/i.test(body) && !hasGrid;
}

function clickExactText(t: string): boolean {
  const norm = (e: any) => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const els = Array.from((document as any).querySelectorAll('a,button,[role=tab],li,span,div'));
  const el = els.find((e: any) => norm(e).toLowerCase() === t.toLowerCase() && e.getBoundingClientRect && e.getBoundingClientRect().width > 1) as any;
  if (el) { el.click(); return true; }
  return false;
}

function setSelect(id: string, rx: string): boolean {
  const s = (document as any).getElementById(id); if (!s) return false;
  const re = new RegExp(rx, 'i');
  const opt = Array.from(s.options).find((o: any) => re.test((o.textContent || '').trim())) as any;
  if (!opt) return false;
  s.value = opt.value;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function gridDataReady(): boolean {
  const t = (document as any).querySelector('.drill-table-scroll table');
  if (!t) return false;
  const rows = Array.from(t.querySelectorAll('tr')).slice(1) as any[];
  const real = rows.filter((tr) => !/skeleton/i.test(tr.className || '') && /\d/.test(tr.textContent || ''));
  return real.length > 0;
}

// The expander is a TOGGLE, and LandPortal persists expansion state across
// reloads — so expand IDEMPOTENTLY: only click when the row is not already
// expanded (an already-expanded '.active' row would otherwise collapse).
function expandIfCollapsed(sel: string): string {
  const row = (document as any).querySelector(sel); if (!row) return 'norow';
  if ((row.className || '').includes('active')) return 'already';
  const btn = row.querySelector('button.expander-btn'); if (!btn) return 'nobtn';
  btn.click(); return 'expanded';
}

function countRows(sel: string): number {
  return (document as any).querySelectorAll(sel).length;
}

// Best-effort, GUARDED dismissal of unexpected modals/overlays (promos, tips).
// Only clicks generic close affordances, and NEVER anything whose text implies a
// paid/irreversible action (buy/unlock/cart/export/purchase/upgrade/token/report).
function dismissDialogs(): number {
  const FORBIDDEN = /buy|unlock|cart|export|purchase|upgrade|subscribe|token|report|checkout/i;
  let closed = 0;
  const closers = Array.from((document as any).querySelectorAll(
    '[class*="modal" i] [class*="close" i],[class*="dialog" i] [class*="close" i],[role="dialog"] [aria-label*="close" i],[aria-label="Close"],button.close,.modal-close,[data-dismiss],[data-close]',
  )) as any[];
  for (const el of closers) {
    const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`;
    if (FORBIDDEN.test(t)) continue;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0 };
    if (r.width > 0) { try { el.click(); closed++; } catch { /* ignore */ } }
  }
  return closed;
}

export interface RawRowDump { level: string; state: string; fips: string; county: string; zip: string; metrics: string[] }
function readAllRows(): { headers: string[]; rows: RawRowDump[] } {
  const t = (document as any).querySelector('.drill-table-scroll table');
  if (!t) return { headers: [], rows: [] };
  const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
  const trs = Array.from(t.querySelectorAll('tr')) as any[];
  // header = first row; the 10 metric labels are the cells before the trailing "Open"/action cell
  const headCells = trs.length ? (Array.from(trs[0].querySelectorAll('th,td')) as any[]).map((c) => clean(c.textContent)) : [];
  const headers = headCells.slice(Math.max(0, headCells.length - 11), headCells.length - 1);
  const rows: RawRowDump[] = [];
  for (const tr of trs) {
    const level = tr.getAttribute('data-level') || '';
    if (level !== 'states' && level !== 'counties' && level !== 'zips') continue;
    if (/skeleton/i.test(tr.className || '')) continue;
    const tds = Array.from(tr.querySelectorAll('td')) as any[];
    if (tds.length < 11) continue;
    const metrics = tds.slice(tds.length - 11, tds.length - 1).map((c) => clean(c.textContent));
    rows.push({
      level,
      state: tr.getAttribute('data-state') || '',
      fips: tr.getAttribute('data-fips') || '',
      county: tr.getAttribute('data-county') || '',
      zip: tr.getAttribute('data-zip') || '',
      metrics,
    });
  }
  return { headers, rows };
}

// ── Backend ─────────────────────────────────────────────────────────────────

export interface LiveMarketBackendOptions {
  /** Max counties to ZIP-expand (bounds runtime; all county rows are still read). */
  maxCountiesForZip?: number;
  /** Resume intelligently: county FIPS whose ZIPs are already collected — skip
   *  re-expanding them (they are still re-read as county rows, idempotently). */
  skipCountyFips?: string[];
  /** Poll budget for the grid to finish loading. */
  gridLoadPolls?: number;
  onProgress?: (m: string) => void;
}

const LEVEL_MAP: Record<string, MarketRowLevel> = { states: 'state', counties: 'county', zips: 'zip' };

export interface RawTableMeta {
  state: string; side: RawMarketTable['side']; acreageBand: RawMarketTable['acreageBand'];
  period: string; sourcePage: string; scopeVisited: string[]; screenshots: string[]; authRequired?: boolean;
}

/**
 * Pure mapping: the raw in-page row dump (LandPortal data-* identity + the fixed
 * trailing 10 metric cells) → a RawMarketTable for the shared playbook/ingestion
 * pipeline. Kept pure + exported so the REAL extraction shape is regression-tested
 * without a live browser. Reads explicit cells only; never repairs a value.
 */
export function buildRawTableFromDump(
  dump: { headers: string[]; rows: RawRowDump[] },
  meta: RawTableMeta,
  extra: { retries?: number; stageMs?: Record<string, number>; countiesExpanded?: number } = {},
): RawMarketTable {
  const side = meta.side;
  // Header verification: LandPortal renders 10 metric columns in a fixed order and
  // the backend reads them POSITIONALLY — verify the discovered header row still
  // matches so a column reorder/rename can't silently mis-map a metric.
  const hv = verifyMetricHeaders(dump.headers, side);
  // Use the discovered headers when they verify; otherwise fall back to the
  // canonical labels but record the mismatch loudly (never trust a bad mapping).
  const headers = hv.verified && dump.headers.length === METRIC_HEADERS.length ? dump.headers : [...METRIC_HEADERS];
  const stateAbbr = meta.state.toUpperCase();
  const notes: string[] = [];

  const rows: RawMarketRow[] = [];
  const seen = new Set<string>();
  let duplicatesDropped = 0;
  let borderCounties = 0;
  const byLevel = { state: 0, county: 0, zip: 0 };
  for (const r of dump.rows) {
    const level = LEVEL_MAP[r.level];
    if (!level) continue;
    // Drop the OTHER 50 states' state-rows (all states are in the grid); keep only
    // the requested state's row. County/ZIP rows only exist because we expanded THIS
    // state, so they are kept and attributed to their TRUE state below.
    if (level === 'state' && r.state && r.state.toUpperCase() !== stateAbbr) continue;
    // ROOT-CAUSE FIX for border counties: LandPortal shows counties from adjacent
    // states under a state's expansion (e.g. Stephens County GA under SC), tagging
    // them data-state="SC" (the grouping) while data-fips is the county's REAL FIPS
    // (13257 = GA). A county's canonical state is its FIPS prefix, not the grouping —
    // so derive it from the FIPS. This attributes the county correctly (and it then
    // validates) instead of a state/FIPS contradiction that was being rejected.
    let rowState = (r.state || stateAbbr).toUpperCase();
    if (level === 'county' && r.fips) {
      const fipsState = FIPS_TO_STATE[r.fips.slice(0, 2)];
      if (fipsState) { if (fipsState !== rowState) borderCounties++; rowState = fipsState; }
    }
    // Dedup by geographic identity (defends against grid re-render duplicates).
    const idKey = `${level}|${rowState}|${r.fips || ''}|${r.zip || ''}`;
    if (seen.has(idKey)) { duplicatesDropped++; continue; }
    seen.add(idKey);
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => { cells[h] = r.metrics[i] ?? ''; });
    rows.push({
      level,
      state: rowState,
      ...(r.county ? { county: r.county } : {}),
      ...(r.fips ? { fips: r.fips } : {}),
      ...(r.zip ? { zip: r.zip } : {}),
      cells,
      confidence: level === 'zip' ? 'medium' : 'high',
    });
    byLevel[level]++;
  }

  if (!hv.verified) notes.push(`Header mismatch — extracted with canonical column order as a fallback. ${hv.mismatches.map((m) => `col${m.index}:"${m.got}"≠${m.expected}`).join('; ')}`);
  if (duplicatesDropped > 0) notes.push(`${duplicatesDropped} duplicate row(s) dropped`);
  if (borderCounties > 0) notes.push(`${borderCounties} border county(ies) attributed to their true state via FIPS (shown under ${stateAbbr}'s expansion by LandPortal)`);
  if (byLevel.state === 0) notes.push('no state row captured (state may not have expanded)');
  if (byLevel.county > 0 && byLevel.zip === 0) notes.push('counties captured but no ZIP rows (ZIP expansion may have been skipped or unavailable)');

  const diagnostics: ExtractionDiagnostics = {
    rowsByLevel: byLevel,
    duplicatesDropped,
    headersVerified: hv.verified,
    headerMismatches: hv.mismatches.map((m) => `col${m.index}: got "${m.got}", expected ${m.expected}`),
    countiesExpanded: extra.countiesExpanded ?? 0,
    countiesTotal: byLevel.county,
    retries: extra.retries ?? 0,
    stageMs: extra.stageMs,
    notes,
  };
  return {
    headers, rows, period: meta.period, side, acreageBand: meta.acreageBand,
    state: stateAbbr, sourcePage: meta.sourcePage, scopeVisited: meta.scopeVisited,
    screenshots: meta.screenshots, diagnostics, ...(meta.authRequired ? { authRequired: true } : {}),
  };
}

export function makeLiveMarketResearchBackend(opts: LiveMarketBackendOptions = {}): MarketResearchBackend {
  const maxZip = opts.maxCountiesForZip ?? 10;
  const skip = new Set(opts.skipCountyFips ?? []);
  const log = (m: string) => opts.onProgress?.(m);

  return {
    id: 'landportal_market_live',
    configured: () => browserSessionStatus() === 'live',
    async collect({ pageState, request }): Promise<RawMarketTable> {
      const stateAbbr = request.state.toUpperCase();
      const scopeVisited: string[] = [];
      const screenshots: string[] = [];
      const emptyTable = (over: Partial<RawMarketTable> = {}): RawMarketTable => ({
        headers: [], rows: [], period: currentPeriod(), side: request.side ?? 'sold',
        acreageBand: request.acreageBand ?? '2-5', state: stateAbbr,
        sourcePage: MARKET_RESEARCH_URL, scopeVisited, screenshots, ...over,
      });

      // Ensure the live session (so a not-live backend reports honestly, no nav).
      const status = await ensureBrowserSession();
      if (status !== 'live' && status !== 'auth_needed') {
        return emptyTable({ authRequired: false });
      }

      const stageMs: Record<string, number> = {};
      let retries = 0;
      const timed = async <T>(k: string, fn: () => Promise<T>): Promise<T> => {
        const s = Date.now(); const r = await fn(); stageMs[k] = (stageMs[k] ?? 0) + (Date.now() - s); return r;
      };

      const result = await withWorkingPage(async (page: PageLike) => {
        // 1. NAVIGATE to Market Research (scope) — read-only.
        await timed('navigate', async () => { await page.goto(MARKET_RESEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(4000); });
        scopeVisited.push('Market Research');
        await page.evaluate<number>(dismissDialogs).catch(() => 0);
        if (await page.evaluate<boolean>(readLoginLike)) return { authRequired: true } as const;

        // 2. Open Drill Deep (scope).
        await timed('drillDeep', async () => { await page.evaluate<boolean>(withArgs(clickExactText), LP.drillDeepTab); await sleep(2500); });
        scopeVisited.push('Drill Deep');

        // 3+4. Apply page state and wait for the grid — RETRY once on a stall or a
        //      loading race (re-dismiss dialogs, re-apply filters, re-wait).
        const applyPageState = async () => {
          await page.evaluate<number>(dismissDialogs).catch(() => 0);
          await page.evaluate<boolean>(withArgs(setSelect), LP.controls.data, LP.filterOptions.dataLand);
          await page.evaluate<boolean>(withArgs(setSelect), LP.controls.time, LP.filterOptions.time1Year);
          // Acreage is CONFIG-DRIVEN: the option matcher comes from the acreage band
          // config via pageState — a future band is a config change, not code here.
          await page.evaluate<boolean>(withArgs(setSelect), LP.controls.acreage, pageState.acreageOptionMatch);
          await page.evaluate<boolean>(withArgs(clickExactText), LP.toggles.statusSold);
          await page.evaluate<boolean>(withArgs(clickExactText), LP.toggles.groupByState);
        };
        const waitGrid = async (): Promise<boolean> => {
          const polls = opts.gridLoadPolls ?? 40;
          for (let i = 0; i < polls; i++) { await sleep(1500); if (await page.evaluate<boolean>(gridDataReady)) return true; }
          return false;
        };
        let ready = false;
        for (let attempt = 0; attempt < 2 && !ready; attempt++) {
          if (attempt > 0) { retries++; log(`grid stalled — retry ${attempt}`); }
          await timed('applyFilters', applyPageState);
          log(`applied page state ${pageState.status}/${pageState.data}/${pageState.time}/${pageState.acreageLabel}, grouped by State`);
          ready = await timed('gridLoad', waitGrid);
        }
        if (!ready) return { stalled: true } as const;

        // 5. Expand the target STATE → county rows (idempotent; retry once if 0).
        let countyN = 0;
        for (let attempt = 0; attempt < 2 && countyN === 0; attempt++) {
          if (attempt > 0) { retries++; log(`0 county rows — retry state expansion ${attempt}`); }
          await timed('expandState', async () => {
            const stateExp = await page.evaluate<string>(withArgs(expandIfCollapsed), `${LP.rows.state}[data-state="${stateAbbr}"]`);
            for (let i = 0; i < 24; i++) { if (await page.evaluate<number>(withArgs(countRows), `${LP.rows.county}[data-state="${stateAbbr}"]`) > 0) break; await sleep(1200); }
            log(`state ${stateAbbr} expand=${stateExp}`);
          });
          countyN = await page.evaluate<number>(withArgs(countRows), `${LP.rows.county}[data-state="${stateAbbr}"]`);
        }
        log(`county rows=${countyN}`);

        // 6. Expand a bounded set of COUNTIES → ZIP rows (proves the third level).
        const countiesExpanded = await timed('expandZips', async () => {
          const countyFips = await page.evaluate<string[]>(withArgs((st: string) => {
            const rows = Array.from((document as any).querySelectorAll(`tr.county-row[data-state="${st}"]`)) as any[];
            return rows.map((r) => r.getAttribute('data-fips') || '').filter(Boolean);
          }), stateAbbr);
          // Resume intelligently: skip counties already ZIP-collected.
          const remaining = countyFips.filter((f) => !skip.has(f));
          if (skip.size) log(`resume: ${skip.size} counties already have ZIPs; expanding ${Math.min(remaining.length, maxZip)} of ${remaining.length} remaining`);
          const toExpand = remaining.slice(0, maxZip);
          let expanded = 0;
          for (const fips of toExpand) {
            const r = await page.evaluate<string>(withArgs(expandIfCollapsed), `${LP.rows.county}[data-fips="${fips}"]`);
            if (r === 'expanded' || r === 'already') { expanded++; for (let i = 0; i < 12; i++) { if (await page.evaluate<number>(withArgs(countRows), `${LP.rows.zip}[data-fips="${fips}"]`) > 0) break; await sleep(1000); } }
          }
          log(`ZIP-expanded ${expanded}/${countyFips.length} counties`);
          return expanded;
        });

        // 7. READ the visible table (state + county + zip rows) and one screenshot.
        const dump = await timed('read', () => page.evaluate<{ headers: string[]; rows: RawRowDump[] }>(readAllRows));
        let shotPath: string | null = null;
        try {
          const dir = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'landos-browser-shots');
          const file = path.join(dir, `drilldeep-${stateAbbr}-${Date.now()}.png`);
          const fs = await import('fs'); fs.mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: file, fullPage: false });
          shotPath = file;
        } catch { /* screenshot is proof-only; never fatal */ }
        return { dump, shotPath, countiesExpanded } as const;
      });

      if (!result.ok || !result.value) return emptyTable({ authRequired: status === 'auth_needed' });
      const v = result.value as { authRequired?: boolean; stalled?: boolean; dump?: { headers: string[]; rows: RawRowDump[] }; shotPath?: string | null; countiesExpanded?: number };
      if (v.authRequired) return emptyTable({ authRequired: true });
      if (v.stalled || !v.dump) return emptyTable({ diagnostics: { rowsByLevel: { state: 0, county: 0, zip: 0 }, duplicatesDropped: 0, headersVerified: false, headerMismatches: [], countiesExpanded: 0, countiesTotal: 0, retries, stageMs, notes: ['grid never finished loading (stalled) after retries'] } });
      if (v.shotPath) screenshots.push(v.shotPath);

      // Pure mapping (tested in isolation): raw dump → RawMarketTable + diagnostics.
      return buildRawTableFromDump(v.dump, {
        state: stateAbbr, side: request.side ?? 'sold', acreageBand: request.acreageBand ?? '2-5',
        period: currentPeriod(), sourcePage: MARKET_RESEARCH_URL, scopeVisited, screenshots,
      }, { retries, stageMs, countiesExpanded: v.countiesExpanded ?? 0 });
    },
  };
}

export { STATE_FIPS };
