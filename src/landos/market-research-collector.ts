// LandOS — "Collect quarterly land market snapshot" workflow.
//
// Drives the operator's persistent authenticated Chrome session through the
// NORMAL visible LandPortal Market Research → Drill Deep workflow (Status=Sold,
// Data=Land, Time=1 Year, Acreage per band config), reads the ACTUAL displayed
// State → County → ZIP values, and retains them in the LandOS-owned quarterly
// Market Research snapshot store. Strictly read-only market-research scope:
// never Buy tokens / exports / report purchases / any paid control (the shared
// dismissDialogs guard refuses paid affordances), never API/MCP routes.
//
// Resumable + idempotent by construction: the snapshot store only ever ADDS
// missing (snapshot, geography) rows, and the collection run record tracks
// which states/counties were expanded so a resumed run continues where the
// last one stopped. Diagnostics stay in landos_mr_collection_run (internal).

import { withWorkingPage, ensureBrowserSession, resetWorkingPage, type PageLike } from './browser-session.js';
import {
  LP, withArgs, readLoginLike, clickExactText, setSelect, gridDataReady,
  expandIfCollapsed, collapseIfExpanded, countRows, dismissDialogs,
} from './browser-playbook-landportal-market-live.js';
import { parseCell, verifyMetricHeaders, resolveHeaderMetric, drillDeepPageState, isSupportedBand } from './browser-playbook-landportal-market.js';
import { FIPS_TO_STATE, US_STATES, type AcreageBand, type MarketMetric, type MarketMetrics } from './market-matrix.js';
import { getLandosDb } from './db.js';
import {
  backfillMrStructureCounts, fillMissingMrMetrics, fixedInitialFilters, getOrCreateMrSnapshot,
  listMrRows, mrGeoKey, quarterForDate, recordMrMetrics, recordMrZipMembership,
  type MrMetricInput, type MrSnapshot,
} from './market-research-snapshots.js';

// In-page code runs INSIDE the operator's browser; DOM globals are typed as
// `any` for the Node typechecker only (same pattern as the live playbook).
declare const document: any;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const MR_PROVIDER = 'LandPortal Market Research (Drill Deep)';
const MARKET_RESEARCH_URL = LP.url;

// ─────────────────────────────────────────────────────────────────────────
// In-page wide reader — every cell of every geography row, plus all headers
// ─────────────────────────────────────────────────────────────────────────

export interface WideRowDump {
  level: string;      // states | counties | zips (LandPortal data-level)
  state: string;
  fips: string;
  county: string;
  zip: string;
  cells: string[];    // ALL td texts in visual order
}
export interface WideDump { headers: string[]; rows: WideRowDump[] }

function readAllRowsWide(): { headers: string[]; rows: { level: string; state: string; fips: string; county: string; zip: string; cells: string[] }[] } {
  const t = (document as any).querySelector('.drill-table-scroll table');
  if (!t) return { headers: [], rows: [] };
  const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
  const trs = Array.from(t.querySelectorAll('tr')) as any[];
  const headers = trs.length ? (Array.from(trs[0].querySelectorAll('th,td')) as any[]).map((c) => clean(c.textContent)) : [];
  const rows: { level: string; state: string; fips: string; county: string; zip: string; cells: string[] }[] = [];
  for (const tr of trs) {
    const level = tr.getAttribute('data-level') || '';
    if (level !== 'states' && level !== 'counties' && level !== 'zips') continue;
    if (/skeleton/i.test(tr.className || '')) continue;
    const cells = (Array.from(tr.querySelectorAll('td')) as any[]).map((c) => clean(c.textContent));
    if (cells.length < 11) continue;
    rows.push({
      level,
      state: tr.getAttribute('data-state') || '',
      fips: tr.getAttribute('data-fips') || '',
      county: tr.getAttribute('data-county') || '',
      zip: tr.getAttribute('data-zip') || '',
      cells,
    });
  }
  return { headers, rows };
}

// ─────────────────────────────────────────────────────────────────────────
// Pure mapping: wide dump → MrMetricInput[] (tested without a browser)
// ─────────────────────────────────────────────────────────────────────────

const LEVEL_MAP: Record<string, 'state' | 'county' | 'zip'> = { states: 'state', counties: 'county', zips: 'zip' };

function normHeader(h: string): string { return h.toLowerCase().replace(/[^a-z0-9]/g, ''); }

export interface WideMapResult {
  inputs: MrMetricInput[];
  headersVerified: boolean;
  duplicatesDropped: number;
  notes: string[];
}

/**
 * Map the raw wide dump into snapshot metric inputs. Metric cells are the 10
 * trailing columns before the action column (header-verified, positional —
 * identical to the proven live playbook contract). The leading structural
 * "Counties" / "Zip Codes" columns are located BY HEADER NAME and retained as
 * provider-displayed structure counts. Only explicitly displayed values are
 * kept; a blank cell stays unknown — never zero, never repaired.
 */
export function mapWideDump(dump: WideDump, meta: { sourceRef: string; observedAt: string }): WideMapResult {
  const notes: string[] = [];
  // The header row ends with the metric headers + one trailing action column.
  const metricHeaders = dump.headers.slice(Math.max(0, dump.headers.length - 11), dump.headers.length - 1);
  const hv = verifyMetricHeaders(metricHeaders, 'sold');
  if (!hv.verified) notes.push(`metric header mismatch: ${hv.mismatches.map((m) => `col${m.index}:"${m.got}"≠${m.expected}`).join('; ')}`);

  // Locate structural columns by header name across the FULL header row.
  let countiesIdx = -1, zipsIdx = -1;
  dump.headers.forEach((h, i) => {
    const n = normHeader(h);
    if (n === 'counties' || n === 'countycount' || n === 'numcounties') countiesIdx = i;
    if (n === 'zipcodes' || n === 'zips' || n === 'zipcodecount' || n === 'numzipcodes') zipsIdx = i;
  });

  const inputs: MrMetricInput[] = [];
  const seen = new Set<string>();
  let duplicatesDropped = 0;

  for (const r of dump.rows) {
    const level = LEVEL_MAP[r.level];
    if (!level) continue;
    // Row cells: trailing 11 = 10 metric cells + action column. The header row
    // can carry extra leading header cells, so index metric cells from the END
    // of the row (stable regardless of leading-column count).
    if (r.cells.length < 11) continue;
    const metricCells = r.cells.slice(r.cells.length - 11, r.cells.length - 1);

    // Identity — a county's canonical state is its FIPS prefix (border rows).
    let state = (r.state || '').toUpperCase();
    if ((level === 'county' || level === 'zip') && r.fips) {
      const fipsState = FIPS_TO_STATE[r.fips.slice(0, 2)];
      if (fipsState) state = fipsState;
    }
    if (!state) continue;

    const idKey = `${level}|${state}|${r.fips || ''}|${r.zip || ''}`;
    if (seen.has(idKey)) { duplicatesDropped++; continue; }
    seen.add(idKey);

    const metrics: Partial<MarketMetrics> = {};
    metricHeaders.forEach((h, i) => {
      const metric: MarketMetric | null = hv.verified ? resolveHeaderMetric(h, 'sold') : null;
      if (!metric) return;
      const v = parseCell(metricCells[i]);
      if (v !== null) metrics[metric] = v;
    });

    // Structural counts read from the row's leading cells (aligned to the full
    // header index — leading cells line up 1:1 with headers on these grids;
    // guard by only reading when the value parses as a plain count).
    const structural = (idx: number): number | null => {
      if (idx < 0 || idx >= r.cells.length - 11) return null;
      const v = parseCell(r.cells[idx]);
      return v !== null && Number.isInteger(v) && v >= 0 ? v : null;
    };
    const countyCount = level !== 'zip' ? structural(countiesIdx) : null;
    const zipCount = level !== 'zip' ? structural(zipsIdx) : null;

    inputs.push({
      geography: {
        level, state,
        ...(r.fips ? { fips: r.fips } : {}),
        ...(r.zip ? { zip: r.zip } : {}),
        ...(level === 'county' && r.county ? { name: `${r.county} County` } : {}),
      },
      metrics,
      ...(countyCount !== null ? { countyCount } : {}),
      ...(zipCount !== null ? { zipCount } : {}),
      provider: MR_PROVIDER,
      sourceRef: meta.sourceRef,
      observedAt: meta.observedAt,
    });
  }
  if (duplicatesDropped > 0) notes.push(`${duplicatesDropped} duplicate grid row(s) dropped`);
  return { inputs, headersVerified: hv.verified, duplicatesDropped, notes };
}

// ─────────────────────────────────────────────────────────────────────────
// Resumable run state (internal only)
// ─────────────────────────────────────────────────────────────────────────

interface RunProgress {
  statesCollected: boolean;
  countyStatesDone: string[];   // states whose county rows were expanded+read
  zipCountiesDone: string[];    // county FIPS whose ZIP rows were expanded+read
}

function loadOrCreateRun(snapshotId: number): { runId: number; progress: RunProgress } {
  const db = getLandosDb();
  // 'failed' resumes too: a page-session crash must never orphan the retained
  // expansion progress — only a truly 'completed' run starts a fresh record.
  // Gap-fill runs keep their own records (mode marker) and never mix.
  const row = db.prepare(
    `SELECT id, progress_json FROM landos_mr_collection_run
     WHERE snapshot_id = ? AND status IN ('running','paused','failed')
       AND progress_json NOT LIKE '%"mode":"gap-fill"%'
     ORDER BY started_at DESC LIMIT 1`,
  ).get(snapshotId) as { id: number; progress_json: string } | undefined;
  if (row) {
    let progress: RunProgress = { statesCollected: false, countyStatesDone: [], zipCountiesDone: [] };
    try { progress = { ...progress, ...JSON.parse(row.progress_json) }; } catch { /* fresh */ }
    db.prepare(`UPDATE landos_mr_collection_run SET status = 'running', updated_at = strftime('%s','now') WHERE id = ?`).run(row.id);
    return { runId: row.id, progress };
  }
  const res = db.prepare(`INSERT INTO landos_mr_collection_run (snapshot_id, status, progress_json) VALUES (?, 'running', '{}')`).run(snapshotId);
  return { runId: res.lastInsertRowid as number, progress: { statesCollected: false, countyStatesDone: [], zipCountiesDone: [] } };
}

function saveRun(runId: number, status: 'running' | 'paused' | 'completed' | 'failed', progress: RunProgress, diagnostics: string): void {
  getLandosDb().prepare(
    `UPDATE landos_mr_collection_run SET status = ?, progress_json = ?, diagnostics = ?, updated_at = strftime('%s','now') WHERE id = ?`,
  ).run(status, JSON.stringify(progress), diagnostics.slice(0, 20000), runId);
}

// ─────────────────────────────────────────────────────────────────────────
// Shared grid operations — storm-tolerant, presence-based (both workflows)
// ─────────────────────────────────────────────────────────────────────────

function makeGridOps(page: PageLike, dlog: (m: string) => void) {
  // Heavy grid rendering can jam the page thread past the CDP protocol
  // timeout on a SINGLE call, and LandPortal re-materializes EVERY remembered
  // row expansion in one render storm on the first expander click of a
  // session. Patience (5 × 60s+8s) outlasts a storm; a call only fails when
  // the page really is gone.
  // Each attempt races a LOCAL 90s timeout: a storm-wedged page can hang a
  // CDP call indefinitely without ever rejecting, and a hung attempt must
  // become a retry, not an invisible stall. The abandoned call settles (or
  // not) harmlessly in the background.
  const ev = async <T>(fn: (() => T) | string, ...args: unknown[]): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await Promise.race([
          page.evaluate<T>(fn, ...args),
          sleep(90_000).then(() => { throw new Error('in-page call hang (>90s) — local timeout'); }),
        ]);
      } catch (e) {
        lastErr = e;
        dlog(`in-page call retry ${attempt}/5: ${String(e).slice(0, 140)}`);
        await sleep(8000);
      }
    }
    throw lastErr;
  };
  // Expansion state is judged by PRESENCE OF CHILD ROWS, never by row CSS
  // classes: the 'active' class does not reliably mark expanded state rows,
  // so class-based toggling silently collapsed/expanded the wrong rows.
  const openStates = () => ev<string[]>(withArgs(() =>
    Array.from(new Set((Array.from((document as any).querySelectorAll('tr.county-row')) as any[])
      .map((r: any) => r.getAttribute('data-state') || '').filter(Boolean)))));
  const clickStateExpander = (st: string) => ev<boolean>(withArgs((s: string) => {
    const row = (document as any).querySelector(`tr.state-row[data-state="${s}"]`);
    const btn = row && row.querySelector('button.expander-btn');
    if (!btn) return false; btn.click(); return true;
  }), st).catch(() => false);
  const stateCountyCount = (st: string) => ev<number>(withArgs(countRows), `${LP.rows.county}[data-state="${st}"]`);
  const countyZipCount = (fips: string) => ev<number>(withArgs(countRows), `${LP.rows.zip}[data-fips="${fips}"]`);
  const clickCountyExpander = (fips: string) => ev<boolean>(withArgs((f: string) => {
    const row = (document as any).querySelector(`tr.county-row[data-fips="${f}"]`);
    const btn = row && row.querySelector('button.expander-btn');
    if (!btn) return false; btn.click(); return true;
  }), fips).catch(() => false);
  /** Collapse every state whose county rows are showing (child-row truth). */
  const collapseAllOpenStates = async (except?: string) => {
    for (let round = 0; round < 3; round++) {
      const open = (await openStates().catch(() => [] as string[])).filter((s) => s !== except);
      if (open.length === 0) return;
      for (const st of open) { await clickStateExpander(st); await sleep(1200); }
      await sleep(2500);
    }
  };
  /** Navigate to Market Research → VERIFIED visible Drill Deep grid with the
   *  exact fixed page state applied (read-only scope). */
  const openDrillDeep = async (pageState: ReturnType<typeof drillDeepPageState>): Promise<'ready' | 'auth' | 'stalled'> => {
    await page.goto(MARKET_RESEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    await ev<number>(dismissDialogs).catch(() => 0);
    if (await ev<boolean>(readLoginLike)) return 'auth';
    // The Drill Deep tab click must be VERIFIED: a fresh session lands on the
    // Heatmap view, which has the same filter dropdowns, so without this check
    // a missed click leaves the whole run polling for a grid that never
    // exists. VISIBLE grid required: the drill table stays mounted (hidden)
    // under the Heatmap view, so mere presence is a false positive.
    let onDrillDeep = false;
    for (let attempt = 0; attempt < 6 && !onDrillDeep; attempt++) {
      await ev<number>(dismissDialogs).catch(() => 0);
      await ev<boolean>(withArgs(clickExactText), LP.drillDeepTab).catch(() => false);
      await sleep(3000);
      onDrillDeep = await ev<boolean>(withArgs((sel: string) => {
        const t = (document as any).querySelector(sel);
        return !!(t && t.offsetParent);
      }), LP.grid).catch(() => false);
    }
    if (!onDrillDeep) { dlog('Drill Deep tab never became active — pausing'); return 'stalled'; }
    const applyPageState = async () => {
      await ev<number>(dismissDialogs).catch(() => 0);
      await ev<boolean>(withArgs(setSelect), LP.controls.data, LP.filterOptions.dataLand);
      await ev<boolean>(withArgs(setSelect), LP.controls.time, LP.filterOptions.time1Year);
      await ev<boolean>(withArgs(setSelect), LP.controls.acreage, pageState.acreageOptionMatch);
      await ev<boolean>(withArgs(clickExactText), LP.toggles.statusSold);
      await ev<boolean>(withArgs(clickExactText), LP.toggles.groupByState);
    };
    let ready = false;
    for (let attempt = 0; attempt < 2 && !ready; attempt++) {
      await applyPageState();
      dlog(`applied ${pageState.status}/${pageState.data}/${pageState.time}/${pageState.acreageLabel}, grouped by State (attempt ${attempt + 1})`);
      for (let i = 0; i < 40 && !ready; i++) { await sleep(1500); ready = await ev<boolean>(gridDataReady); }
    }
    return ready ? 'ready' : 'stalled';
  };
  return { ev, openStates, clickStateExpander, stateCountyCount, countyZipCount, clickCountyExpander, collapseAllOpenStates, openDrillDeep };
}

/** Retained county FIPS for a state that still await ZIP expansion. The RETAINED
 *  store (not the current page session) is the source of truth, so a resumed run
 *  can finish ZIP coverage for states whose county rows were expanded in an
 *  earlier run's page session. */
export function pendingZipCountyFips(snapshotId: number, state: string, done: ReadonlySet<string>): string[] {
  return listMrRows(snapshotId, 'county', `state:${state}`)
    .map((r) => r.fips)
    .filter((f): f is string => !!f && !done.has(f));
}

// ─────────────────────────────────────────────────────────────────────────
// The workflow
// ─────────────────────────────────────────────────────────────────────────

export interface CollectOptions {
  band?: AcreageBand;                 // must be a supported playbook band
  /** States to expand to county rows this run (default: resume order over all states). */
  states?: string[];
  /** Max NEW state→county expansions this run. */
  maxStateExpansions?: number;
  /** Max NEW county→ZIP expansions this run (bounds runtime; resumable). */
  maxZipExpansions?: number;
  onProgress?: (m: string) => void;   // internal logging only
}

export interface CollectResult {
  status: 'collected' | 'auth_needed' | 'not_configured' | 'stalled' | 'unsupported_band';
  snapshotId: number | null;
  quarter: string;
  written: number;
  preserved: number;
  skipped: number;
  rowsRead: number;
  statesExpanded: string[];
  zipCountiesExpanded: number;
  note: string;
}

let activeRun: Promise<CollectResult> | null = null;
let activeFill: Promise<GapFillResult> | null = null;
let activeSweepGate: (() => boolean) | null = null;
/** True while ANY live-browser workflow (collect, gap-fill, verify-sweep) is
 *  running — they all lend the single working tab, so they never overlap. */
export function isCollectionActive(): boolean {
  return activeRun !== null || activeFill !== null || (activeSweepGate !== null && activeSweepGate());
}

/** Serialize collections: only one live browser collection at a time. */
export function collectQuarterlyMarketSnapshot(opts: CollectOptions = {}): Promise<CollectResult> {
  if (activeRun) return activeRun;
  if (activeFill) {
    return Promise.resolve({
      status: 'stalled', snapshotId: null, quarter: quarterForDate(), written: 0, preserved: 0, skipped: 0,
      rowsRead: 0, statesExpanded: [], zipCountiesExpanded: 0,
      note: 'A gap-fill run is using the live browser session; try again when it finishes.',
    });
  }
  activeRun = doCollect(opts).finally(() => { activeRun = null; });
  return activeRun;
}

async function doCollect(opts: CollectOptions): Promise<CollectResult> {
  const band = opts.band ?? '2-5';
  const quarter = quarterForDate();
  const log = (m: string) => opts.onProgress?.(m);
  const empty = (status: CollectResult['status'], note: string): CollectResult => ({
    status, snapshotId: null, quarter, written: 0, preserved: 0, skipped: 0,
    rowsRead: 0, statesExpanded: [], zipCountiesExpanded: 0, note,
  });

  if (!isSupportedBand(band)) {
    return empty('unsupported_band', `Acreage band "${band}" is not enabled in the Drill Deep playbook config; no navigation attempted and nothing presented for it.`);
  }
  const pageState = drillDeepPageState(band);

  const session = await ensureBrowserSession();
  if (session !== 'live') {
    return empty(session === 'auth_needed' ? 'auth_needed' : 'not_configured',
      'The authenticated visible LandPortal browser session is not available; nothing was collected or fabricated.');
  }

  const snap: MrSnapshot = getOrCreateMrSnapshot({ quarter, filters: fixedInitialFilters(band), provider: MR_PROVIDER });
  const { runId, progress } = loadOrCreateRun(snap.id);
  const diag: string[] = [];
  const dlog = (m: string) => { diag.push(`${new Date().toISOString()} ${m}`); log(m); };

  const targetStates = (opts.states && opts.states.length
    ? opts.states.map((s) => s.toUpperCase())
    : [...US_STATES]).filter((s) => s !== 'DC');
  const maxStates = opts.maxStateExpansions ?? 4;
  const maxZips = opts.maxZipExpansions ?? 12;

  let written = 0, preserved = 0, skipped = 0, rowsRead = 0;
  const statesExpanded: string[] = [];
  let zipExpanded = 0;

  const writeDump = (dump: WideDump, stage: string): void => {
    const mapped = mapWideDump(dump, { sourceRef: MARKET_RESEARCH_URL, observedAt: new Date().toISOString() });
    if (!mapped.headersVerified) {
      dlog(`${stage}: metric headers failed verification — refusing to retain values (${mapped.notes.join('; ')})`);
      return;
    }
    const res = recordMrMetrics(snap.id, mapped.inputs);
    written += res.written; preserved += res.preserved; skipped += res.skipped;
    rowsRead += dump.rows.length;
    dlog(`${stage}: read ${dump.rows.length} rows → wrote ${res.written} new, preserved ${res.preserved} retained, skipped ${res.skipped}`);
  };

  const runBody = async (page: PageLike) => {
    const ops = makeGridOps(page, dlog);
    const { ev, stateCountyCount, countyZipCount, clickStateExpander, clickCountyExpander, collapseAllOpenStates } = ops;
    const nav = await ops.openDrillDeep(pageState);
    if (nav !== 'ready') return nav === 'auth' ? { auth: true } as const : { stalled: true } as const;

    // 3. State rows: the grid shows every state — read and retain them all.
    writeDump(await ev<WideDump>(readAllRowsWide), 'state pass');
    progress.statesCollected = true;
    saveRun(runId, 'running', progress, diag.join('\n'));

    // 3b. LandPortal REMEMBERS row expansion across page sessions, so states
    // left expanded by earlier runs re-render their whole subtree here and
    // bloat the grid before this run even starts. Collapse every state whose
    // county rows are showing so the run starts from a bounded DOM.
    await collapseAllOpenStates();

    // 4. Per-state pipeline: expand ONE state, retain its county rows, expand
    // its pending counties' ZIP rows in small retained chunks, then COLLAPSE
    // the state before visiting the next. The grid DOM stays bounded to one
    // state's tree — an ever-growing table previously pushed in-page reads past
    // the CDP protocol timeout and crashed every run. Pending counties come
    // from the RETAINED store, so states finished in an earlier run's page
    // session still get their remaining ZIP rows here.
    const doneSet = new Set(progress.zipCountiesDone);
    let budget = maxZips;
    let newCountyStates = 0;
    for (const st of targetStates) {
      const isNewState = !progress.countyStatesDone.includes(st);
      if (isNewState && newCountyStates >= maxStates) continue;
      if (!isNewState && (budget <= 0 || pendingZipCountyFips(snap.id, st, doneSet).length === 0)) continue;

      // Expand by child-row truth: only click the expander when the state's
      // county rows are NOT showing.
      let countyN = await stateCountyCount(st).catch(() => 0);
      if (countyN === 0) {
        await clickStateExpander(st);
        for (let i = 0; i < 24; i++) {
          countyN = await stateCountyCount(st).catch(() => 0);
          if (countyN > 0) break;
          await sleep(1200);
        }
      }
      dlog(`state ${st}: ${countyN} county rows visible`);
      if (countyN === 0) continue;

      if (isNewState) {
        // Retain this state's county rows NOW (not in a fragile end-of-run
        // pass), then mark the state done.
        writeDump(await ev<WideDump>(readAllRowsWide), `state ${st} counties`);
        progress.countyStatesDone.push(st); statesExpanded.push(st); newCountyStates++;
        saveRun(runId, 'running', progress, diag.join('\n'));
      }

      // ZIP rows for this state's pending counties, in retained chunks. A
      // county is only marked done AFTER a read that included its ZIP rows has
      // been retained — a crash can never mark coverage it didn't collect.
      const pending = pendingZipCountyFips(snap.id, st, doneSet);
      let chunk: string[] = [];
      const flushChunk = async (label: string) => {
        if (chunk.length === 0) return;
        writeDump(await ev<WideDump>(readAllRowsWide), label);
        for (const f of chunk) doneSet.add(f);
        zipExpanded += chunk.length;
        progress.zipCountiesDone = [...doneSet];
        saveRun(runId, 'running', progress, diag.join('\n'));
        chunk = [];
      };
      for (const fips of pending) {
        if (budget <= 0) break;
        // Already-showing ZIP rows mean the county is expanded from a prior
        // session — clicking again would COLLAPSE it and lose the rows.
        let zipN = await countyZipCount(fips).catch(() => 0);
        if (zipN === 0) {
          if (!(await clickCountyExpander(fips))) continue;
          for (let i = 0; i < 12; i++) {
            zipN = await countyZipCount(fips).catch(() => 0);
            if (zipN > 0) break;
            await sleep(1000);
          }
        }
        chunk.push(fips); budget--;
        if (chunk.length >= 15) await flushChunk(`state ${st} ZIP chunk`);
      }
      await flushChunk(`state ${st} ZIP final`);

      // Collapse this state (and anything a render storm re-opened) before
      // moving on, so the working DOM stays bounded.
      await collapseAllOpenStates();
    }
    progress.zipCountiesDone = [...doneSet];
    dlog(`ZIP-expanded ${zipExpanded} counties this run`);
    return { ok: true } as const;
  };

  // A mid-read crash (e.g. a CDP protocol timeout) must save an honest
  // resumable 'failed' record — never leave the record wedged as 'running'
  // with the retained-chunk progress silently discarded.
  let result: { ok: boolean; status: string; value?: { auth?: boolean; stalled?: boolean; ok?: boolean } };
  try {
    result = await withWorkingPage(runBody);
  } catch (err) {
    saveRun(runId, 'failed', progress, [...diag, `run crashed: ${String(err)}`].join('\n'));
    return {
      ...empty('stalled', 'The collection run crashed mid-read; all previously retained chunks are saved and the run resumes where it stopped.'),
      snapshotId: snap.id,
      written, preserved, skipped, rowsRead, statesExpanded, zipCountiesExpanded: zipExpanded,
    };
  }

  if (!result.ok || !result.value) {
    saveRun(runId, 'failed', progress, [...diag, `page session unavailable (status=${result.status})`].join('\n'));
    return { ...empty('stalled', 'The browser page session failed before the grid could be read; nothing was fabricated.'), snapshotId: snap.id };
  }
  const v = result.value as { auth?: boolean; stalled?: boolean; ok?: boolean };
  if (v.auth) {
    saveRun(runId, 'paused', progress, [...diag, 'LandPortal presented a login screen'].join('\n'));
    return { ...empty('auth_needed', 'LandPortal asked for authentication; the run paused without collecting.'), snapshotId: snap.id };
  }
  if (v.stalled) {
    saveRun(runId, 'paused', progress, [...diag, 'grid never finished loading'].join('\n'));
    return { ...empty('stalled', 'The Drill Deep grid never finished loading; the run paused and can resume.'), snapshotId: snap.id };
  }

  const remainingStates = targetStates.filter((s) => !progress.countyStatesDone.includes(s)).length;
  const zipDone = new Set(progress.zipCountiesDone);
  const remainingZipCounties = progress.countyStatesDone
    .reduce((n, st) => n + pendingZipCountyFips(snap.id, st, zipDone).length, 0);
  // A run is only "completed" when every state's county rows AND every retained
  // county's ZIP rows have been expanded — partial ZIP coverage stays resumable.
  const done = remainingStates === 0 && remainingZipCounties === 0;
  saveRun(runId, done ? 'completed' : 'paused', progress, diag.join('\n'));
  return {
    status: 'collected', snapshotId: snap.id, quarter,
    written, preserved, skipped, rowsRead,
    statesExpanded, zipCountiesExpanded: zipExpanded,
    note: `Retained ${written} new geography metric row(s) into the ${quarter} snapshot (${preserved} already retained, immutable). ${remainingStates} state(s) still awaiting county expansion and ${remainingZipCounties} county(ies) still awaiting ZIP expansion in future resumable runs.`,
  };
}

/** Clean, owner-safe status for the workspace header. */
export interface CollectionStatus {
  running: boolean;
  lastRun: { status: string; startedAt: number; updatedAt: number } | null;
}
export function getCollectionStatus(snapshotId?: number): CollectionStatus {
  const db = getLandosDb();
  const row = (snapshotId
    ? db.prepare('SELECT status, started_at, updated_at FROM landos_mr_collection_run WHERE snapshot_id = ? ORDER BY started_at DESC LIMIT 1').get(snapshotId)
    : db.prepare('SELECT status, started_at, updated_at FROM landos_mr_collection_run ORDER BY started_at DESC LIMIT 1').get()) as
    { status: string; started_at: number; updated_at: number } | undefined;
  // Out-of-server band collectors write to the unit ledger from their OWN
  // process, so "running" must be derivable from the DB, not process state.
  const bandActive = db.prepare(
    `SELECT COUNT(*) AS n FROM landos_mr_band_unit WHERE updated_at > strftime('%s','now') - 180`,
  ).get() as { n: number };
  return {
    running: isCollectionActive() || bandActive.n > 0,
    lastRun: row ? { status: row.status, startedAt: row.started_at, updatedAt: row.updated_at } : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Gap-fill workflow — audited ADD-ONLY completion of missing metric cells
// ─────────────────────────────────────────────────────────────────────────

export const MR_METRIC_KEYS = [
  'salesCount', 'daysOnMarket', 'sellThroughRate', 'absorptionRate', 'monthsOfSupply',
  'population', 'populationDensity', 'populationGrowth', 'medianPrice', 'medianPricePerAcre',
] as const;

export interface MrGapGeo { geoKey: string; level: 'state' | 'county' | 'zip'; state: string; fips: string; zip: string; missing: string[] }
export interface MrGaps {
  total: number;
  byState: Map<string, { geos: MrGapGeo[]; countiesToOpen: Set<string> }>;
}

/** Every retained geography in the snapshot with at least one absent metric,
 *  grouped by state, with the county rows that must be opened to see the gap
 *  ZIP rows. Absence means "no retained value", never zero. */
export function computeMrGaps(snapshotId: number): MrGaps {
  const db = getLandosDb();
  const rows = db.prepare(
    `SELECT g.level, g.state, g.fips, g.zip, g.geo_key AS geoKey, m.metrics_json
     FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id
     WHERE m.snapshot_id = ?`,
  ).all(snapshotId) as Array<{ level: 'state' | 'county' | 'zip'; state: string; fips: string | null; zip: string | null; geoKey: string; metrics_json: string }>;
  const byState = new Map<string, { geos: MrGapGeo[]; countiesToOpen: Set<string> }>();
  let total = 0;
  for (const r of rows) {
    let metrics: Record<string, unknown> = {};
    try { metrics = JSON.parse(r.metrics_json); } catch { /* treat all as missing */ }
    const missing = MR_METRIC_KEYS.filter((k) => typeof metrics[k] !== 'number');
    if (missing.length === 0) continue;
    total++;
    const st = (r.state || '').toUpperCase();
    if (!byState.has(st)) byState.set(st, { geos: [], countiesToOpen: new Set() });
    const bucket = byState.get(st)!;
    bucket.geos.push({ geoKey: r.geoKey, level: r.level, state: st, fips: r.fips ?? '', zip: r.zip ?? '', missing });
    if (r.level === 'zip' && r.fips) bucket.countiesToOpen.add(r.fips);
  }
  return { total, byState };
}

interface FillProgress { mode: 'gap-fill'; statesDone: string[] }

function loadOrCreateFillRun(snapshotId: number): { runId: number; progress: FillProgress } {
  const db = getLandosDb();
  const row = db.prepare(
    `SELECT id, progress_json FROM landos_mr_collection_run
     WHERE snapshot_id = ? AND status IN ('running','paused','failed')
       AND progress_json LIKE '%"mode":"gap-fill"%'
     ORDER BY started_at DESC LIMIT 1`,
  ).get(snapshotId) as { id: number; progress_json: string } | undefined;
  if (row) {
    let progress: FillProgress = { mode: 'gap-fill', statesDone: [] };
    try { progress = { ...progress, ...JSON.parse(row.progress_json) }; } catch { /* fresh */ }
    db.prepare(`UPDATE landos_mr_collection_run SET status = 'running', updated_at = strftime('%s','now') WHERE id = ?`).run(row.id);
    return { runId: row.id, progress };
  }
  const res = db.prepare(`INSERT INTO landos_mr_collection_run (snapshot_id, status, progress_json) VALUES (?, 'running', '{"mode":"gap-fill"}')`).run(snapshotId);
  return { runId: res.lastInsertRowid as number, progress: { mode: 'gap-fill', statesDone: [] } };
}

function saveFillRun(runId: number, status: 'running' | 'paused' | 'completed' | 'failed', progress: FillProgress, diagnostics: string): void {
  getLandosDb().prepare(
    `UPDATE landos_mr_collection_run SET status = ?, progress_json = ?, diagnostics = ?, updated_at = strftime('%s','now') WHERE id = ?`,
  ).run(status, JSON.stringify(progress), diagnostics.slice(0, 20000), runId);
}

export interface GapFillOptions {
  band?: AcreageBand;
  /** Max states processed this run (bounds runtime; resumable). */
  maxStateVisits?: number;
  /** Max county-row opens this run across states. */
  maxCountyOpens?: number;
  onProgress?: (m: string) => void;
}

export interface GapFillResult {
  status: 'filled' | 'auth_needed' | 'not_configured' | 'stalled' | 'unsupported_band' | 'no_gaps' | 'busy';
  snapshotId: number | null;
  quarter: string;
  geosChecked: number;
  valuesFilled: number;
  blanksVerified: number;
  statesProcessed: string[];
  remainingGapStates: number;
  note: string;
}

export function collectMarketGapFill(opts: GapFillOptions = {}): Promise<GapFillResult> {
  if (activeFill) return activeFill;
  if (activeRun) {
    return Promise.resolve({
      status: 'busy', snapshotId: null, quarter: quarterForDate(), geosChecked: 0, valuesFilled: 0,
      blanksVerified: 0, statesProcessed: [], remainingGapStates: -1,
      note: 'A collection run is using the live browser session; try again when it finishes.',
    });
  }
  activeFill = doGapFill(opts).finally(() => { activeFill = null; });
  return activeFill;
}

async function doGapFill(opts: GapFillOptions): Promise<GapFillResult> {
  const band = opts.band ?? '2-5';
  const quarter = quarterForDate();
  const log = (m: string) => opts.onProgress?.(m);
  const empty = (status: GapFillResult['status'], note: string): GapFillResult => ({
    status, snapshotId: null, quarter, geosChecked: 0, valuesFilled: 0, blanksVerified: 0,
    statesProcessed: [], remainingGapStates: -1, note,
  });
  if (!isSupportedBand(band)) return empty('unsupported_band', `Acreage band "${band}" is not enabled.`);
  const pageState = drillDeepPageState(band);

  const session = await ensureBrowserSession();
  if (session !== 'live') {
    return empty(session === 'auth_needed' ? 'auth_needed' : 'not_configured',
      'The authenticated visible LandPortal browser session is not available; nothing was read or fabricated.');
  }

  const snap: MrSnapshot = getOrCreateMrSnapshot({ quarter, filters: fixedInitialFilters(band), provider: MR_PROVIDER });
  const gaps = computeMrGaps(snap.id);
  if (gaps.total === 0) return { ...empty('no_gaps', 'Every retained geography has all metrics; nothing to fill.'), snapshotId: snap.id, remainingGapStates: 0 };

  const { runId, progress } = loadOrCreateFillRun(snap.id);
  const diag: string[] = [];
  const dlog = (m: string) => { diag.push(`${new Date().toISOString()} ${m}`); log(m); };

  const maxStates = opts.maxStateVisits ?? 4;
  const maxOpens = opts.maxCountyOpens ?? 250;

  let geosChecked = 0, valuesFilled = 0, blanksVerified = 0;
  const statesProcessed: string[] = [];
  const observedAt = new Date().toISOString();
  const countedGeos = new Set<string>();

  /** Apply fills for every gap geography visible in this dump; count verified
   *  blanks (cell shown by LandPortal with no numeric value) once per geo. */
  const applyDump = (dump: WideDump, gapGeos: Map<string, MrGapGeo>, stage: string): void => {
    const mapped = mapWideDump(dump, { sourceRef: MARKET_RESEARCH_URL, observedAt });
    if (!mapped.headersVerified) {
      dlog(`${stage}: metric headers failed verification — refusing to use this read (${mapped.notes.join('; ')})`);
      return;
    }
    let filledHere = 0, blanksHere = 0, seenHere = 0;
    for (const input of mapped.inputs) {
      const key = mrGeoKey(input.geography);
      const gap = gapGeos.get(key);
      if (!gap || countedGeos.has(key)) continue;
      countedGeos.add(key); seenHere++; geosChecked++;
      const res = fillMissingMrMetrics({ snapshotId: snap.id, geoKey: key, metrics: input.metrics, sourceRef: MARKET_RESEARCH_URL, observedAt });
      valuesFilled += res.filled.length; filledHere += res.filled.length;
      for (const k of gap.missing) {
        if (res.filled.includes(k)) continue;
        blanksVerified++; blanksHere++;   // LandPortal itself shows no value here
      }
    }
    dlog(`${stage}: checked ${seenHere} gap geo(s) → filled ${filledHere} value(s), verified ${blanksHere} live blank(s)`);
  };

  const runBody = async (page: PageLike) => {
    const ops = makeGridOps(page, dlog);
    const { ev, stateCountyCount, countyZipCount, clickCountyExpander, clickStateExpander, collapseAllOpenStates } = ops;
    const nav = await ops.openDrillDeep(pageState);
    if (nav !== 'ready') return nav === 'auth' ? { auth: true } as const : { stalled: true } as const;

    // State-level gaps are visible in the base grid.
    const stateGapGeos = new Map<string, MrGapGeo>();
    for (const [, bucket] of gaps.byState) for (const g of bucket.geos) if (g.level === 'state') stateGapGeos.set(g.geoKey, g);
    if (stateGapGeos.size > 0) applyDump(await ev<WideDump>(readAllRowsWide), stateGapGeos, 'state-level pass');
    await collapseAllOpenStates();

    // Per-state: open the state, open the counties that contain gap ZIPs,
    // read once per chunk, fill, collapse. Resumable at state granularity.
    let opens = 0;
    let visited = 0;
    for (const [st, bucket] of [...gaps.byState.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const pendingHere = bucket.geos.filter((g) => g.level !== 'state');
      if (pendingHere.length === 0 || progress.statesDone.includes(st)) continue;
      if (visited >= maxStates || opens >= maxOpens) break;
      visited++;

      let countyN = await stateCountyCount(st).catch(() => 0);
      if (countyN === 0) {
        await clickStateExpander(st);
        for (let i = 0; i < 24 && countyN === 0; i++) { await sleep(1200); countyN = await stateCountyCount(st).catch(() => 0); }
      }
      dlog(`state ${st}: ${countyN} county rows visible; ${pendingHere.length} gap geo(s), ${bucket.countiesToOpen.size} county row(s) to open`);
      if (countyN === 0) continue;

      const gapGeoMap = new Map<string, MrGapGeo>(pendingHere.map((g) => [g.geoKey, g]));
      let sinceRead = 0;
      let openedAll = true;
      for (const fips of bucket.countiesToOpen) {
        if (opens >= maxOpens) { openedAll = false; break; }
        let zipN = await countyZipCount(fips).catch(() => 0);
        if (zipN === 0) {
          if (!(await clickCountyExpander(fips))) continue;
          for (let i = 0; i < 12 && zipN === 0; i++) { await sleep(1000); zipN = await countyZipCount(fips).catch(() => 0); }
        }
        opens++; sinceRead++;
        if (sinceRead >= 15) { applyDump(await ev<WideDump>(readAllRowsWide), gapGeoMap, `state ${st} chunk`); sinceRead = 0; }
      }
      applyDump(await ev<WideDump>(readAllRowsWide), gapGeoMap, `state ${st} final`);
      if (openedAll) { progress.statesDone.push(st); statesProcessed.push(st); }
      saveFillRun(runId, 'running', progress, diag.join('\n'));
      await collapseAllOpenStates();
    }
    return { ok: true } as const;
  };

  let result: { ok: boolean; status: string; value?: { auth?: boolean; stalled?: boolean; ok?: boolean } };
  try {
    result = await withWorkingPage(runBody);
  } catch (err) {
    saveFillRun(runId, 'failed', progress, [...diag, `run crashed: ${String(err)}`].join('\n'));
    return {
      ...empty('stalled', 'The gap-fill run crashed mid-read; audited fills so far are saved and the run resumes where it stopped.'),
      snapshotId: snap.id, geosChecked, valuesFilled, blanksVerified, statesProcessed,
    };
  }
  if (!result.ok || !result.value) {
    saveFillRun(runId, 'failed', progress, [...diag, `page session unavailable (status=${result.status})`].join('\n'));
    return { ...empty('stalled', 'The browser page session failed; nothing was fabricated.'), snapshotId: snap.id };
  }
  const v = result.value;
  if (v.auth) {
    saveFillRun(runId, 'paused', progress, [...diag, 'LandPortal presented a login screen'].join('\n'));
    return { ...empty('auth_needed', 'LandPortal asked for authentication; the run paused.'), snapshotId: snap.id };
  }
  if (v.stalled) {
    saveFillRun(runId, 'paused', progress, [...diag, 'grid never became ready'].join('\n'));
    return { ...empty('stalled', 'The Drill Deep grid never became ready; the run paused and can resume.'), snapshotId: snap.id };
  }

  const statesWithNonStateGaps = [...gaps.byState.entries()].filter(([, b]) => b.geos.some((g) => g.level !== 'state')).map(([s]) => s);
  const remaining = statesWithNonStateGaps.filter((s) => !progress.statesDone.includes(s)).length;
  saveFillRun(runId, remaining === 0 ? 'completed' : 'paused', progress, diag.join('\n'));
  return {
    status: 'filled', snapshotId: snap.id, quarter,
    geosChecked, valuesFilled, blanksVerified, statesProcessed, remainingGapStates: remaining,
    note: `Checked ${geosChecked} gap geography(ies): filled ${valuesFilled} missing value(s) from the live grid (audited, add-only) and verified ${blanksVerified} cell(s) as blank on LandPortal itself. ${remaining} state(s) still pending in future resumable runs.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Verify-and-complete sweep — retention from the page's OWN JSON payloads
// ─────────────────────────────────────────────────────────────────────────
//
// LandPortal's Drill Deep grid is rendered from admin-ajax JSON: expanding a
// state loads one payload with EVERY county row (including the county's
// declared ZIP count), and expanding a county loads one payload with every
// ZIP row — full precision, explicit nulls, population included. The sweep
// performs the SAME visible clicks as always and passively reads those
// responses instead of scraping rendered cells. It never issues requests of
// its own. Declared ZIP counts make completeness PROVABLE per county.

export interface LandPortalAjaxItem {
  state?: string; fips?: number | string; county?: string; zips?: number;
  zip?: string; city_name?: string;
  properties?: number | null; median_price?: number | null; median_ppa?: number | null;
  avg_dom?: number | null; sell_rate?: number | null; month_of_supply?: number | null;
  absorption?: number | null; population?: number | null; population_density?: number | null;
  population_growth?: number | null;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Map one payload item to a retention input, mirroring exactly what the grid
 *  DISPLAYS: null → absent; 0 in rate/supply fields → displayed zero, retained;
 *  price/dom filler zeros on no-sale rows → absent (never fabricated). */
export function mapAjaxItem(it: LandPortalAjaxItem, meta: { sourceRef: string; observedAt: string }): MrMetricInput | null {
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const props = num(it.properties);
  const metrics: Record<string, number> = {};
  if (props !== undefined) metrics.salesCount = props;
  const price = num(it.median_price); if (price !== undefined && price > 0) metrics.medianPrice = price;
  const ppa = num(it.median_ppa); if (ppa !== undefined && ppa > 0) metrics.medianPricePerAcre = ppa;
  const dom = num(it.avg_dom); if (dom !== undefined && (dom > 0 || (props ?? 0) > 0)) metrics.daysOnMarket = round2(dom);
  const str = num(it.sell_rate); if (str !== undefined) metrics.sellThroughRate = round2(str);
  const ar = num(it.absorption); if (ar !== undefined) metrics.absorptionRate = round2(ar);
  const mos = num(it.month_of_supply); if (mos !== undefined) metrics.monthsOfSupply = round2(mos);
  const pop = num(it.population); if (pop !== undefined) metrics.population = pop;
  const dens = num(it.population_density); if (dens !== undefined) metrics.populationDensity = round2(dens);
  const grow = num(it.population_growth); if (grow !== undefined) metrics.populationGrowth = round2(grow);

  const state = (it.state ?? '').toUpperCase();
  if (!state) return null;
  const fipsStr = it.fips === undefined || it.fips === null ? '' : String(it.fips).padStart(5, '0');
  if (it.zip) {
    return {
      geography: { level: 'zip', state, zip: String(it.zip), ...(fipsStr ? { fips: fipsStr } : {}) },
      metrics, provider: MR_PROVIDER, sourceRef: meta.sourceRef, observedAt: meta.observedAt,
    };
  }
  if (it.county && fipsStr) {
    return {
      geography: { level: 'county', state, fips: fipsStr, name: `${it.county} County` },
      metrics, ...(num(it.zips) !== undefined ? { zipCount: num(it.zips) } : {}),
      provider: MR_PROVIDER, sourceRef: meta.sourceRef, observedAt: meta.observedAt,
    };
  }
  return {
    geography: { level: 'state', state },
    metrics, provider: MR_PROVIDER, sourceRef: meta.sourceRef, observedAt: meta.observedAt,
  };
}

/** Counties in a state whose declared ZIP count exceeds the ZIP rows the
 *  county can RENDER (canonical parent ∪ provider-listed membership).
 *  Declared counts come from the provider's own payloads, so this is a
 *  PROVABLE completeness check, not an assumption. */
export function zipShortfalls(snapshotId: number, state: string): Array<{ fips: string; name: string; declared: number; retained: number }> {
  const db = getLandosDb();
  // Aggregate in JS from three flat scans. The previous correlated
  // OR-subquery form cost ~(counties × zip-rows × membership-rows) row visits
  // per call, executed SYNCHRONOUSLY — it starved the server's event loop and
  // froze the whole dashboard while a sweep ran.
  const counties = db.prepare(
    `SELECT g.fips, g.name, m.zip_count AS declared
     FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id
     WHERE m.snapshot_id = ? AND g.level = 'county' AND g.state = ?`,
  ).all(snapshotId, state) as Array<{ fips: string; name: string | null; declared: number | null }>;
  const zipRows = db.prepare(
    `SELECT g.zip, g.fips FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id
     WHERE m.snapshot_id = ? AND g.level = 'zip'`,
  ).all(snapshotId) as Array<{ zip: string; fips: string | null }>;
  const retainedZips = new Set(zipRows.map((r) => r.zip));
  const renderable = new Map<string, Set<string>>();
  const add = (fips: string | null, zip: string) => {
    if (!fips) return;
    if (!renderable.has(fips)) renderable.set(fips, new Set());
    renderable.get(fips)!.add(zip);
  };
  for (const r of zipRows) add(r.fips, r.zip);
  for (const m of db.prepare('SELECT zip, fips FROM landos_mr_zip_county').all() as Array<{ zip: string; fips: string }>) {
    if (retainedZips.has(m.zip)) add(m.fips, m.zip);
  }
  return counties
    .map((c) => ({ fips: c.fips, name: c.name ?? c.fips, declared: c.declared, retained: renderable.get(c.fips)?.size ?? 0 }))
    .filter((c): c is { fips: string; name: string; declared: number; retained: number } =>
      typeof c.declared === 'number' && c.declared > 0 && c.retained < c.declared);
}

interface SweepProgress { mode: 'verify-sweep'; statesDone: string[] }

function loadOrCreateSweepRun(snapshotId: number): { runId: number; progress: SweepProgress } {
  const db = getLandosDb();
  const row = db.prepare(
    `SELECT id, progress_json FROM landos_mr_collection_run
     WHERE snapshot_id = ? AND status IN ('running','paused','failed')
       AND progress_json LIKE '%"mode":"verify-sweep"%'
     ORDER BY started_at DESC LIMIT 1`,
  ).get(snapshotId) as { id: number; progress_json: string } | undefined;
  if (row) {
    let progress: SweepProgress = { mode: 'verify-sweep', statesDone: [] };
    try { progress = { ...progress, ...JSON.parse(row.progress_json) }; } catch { /* fresh */ }
    db.prepare(`UPDATE landos_mr_collection_run SET status = 'running', updated_at = strftime('%s','now') WHERE id = ?`).run(row.id);
    return { runId: row.id, progress };
  }
  const res = db.prepare(`INSERT INTO landos_mr_collection_run (snapshot_id, status, progress_json) VALUES (?, 'running', '{"mode":"verify-sweep"}')`).run(snapshotId);
  return { runId: res.lastInsertRowid as number, progress: { mode: 'verify-sweep', statesDone: [] } };
}

export interface VerifySweepOptions {
  band?: AcreageBand;
  /** Max states fully processed this run (bounds runtime; resumable). */
  maxStateVisits?: number;
  onProgress?: (m: string) => void;
}

export interface VerifySweepResult {
  status: 'swept' | 'auth_needed' | 'not_configured' | 'stalled' | 'unsupported_band' | 'busy';
  snapshotId: number | null;
  quarter: string;
  statesVisited: string[];
  payloadsCaptured: number;
  rowsRetained: number;
  valuesFilled: number;
  countsBackfilled: number;
  residualShortfalls: Array<{ state: string; fips: string; name: string; declared: number; retained: number }>;
  remainingStates: number;
  note: string;
}

let activeSweep: Promise<VerifySweepResult> | null = null;
activeSweepGate = () => activeSweep !== null;

export function collectMarketVerifySweep(opts: VerifySweepOptions = {}): Promise<VerifySweepResult> {
  if (activeSweep) return activeSweep;
  if (activeRun || activeFill) {
    return Promise.resolve({
      status: 'busy', snapshotId: null, quarter: quarterForDate(), statesVisited: [], payloadsCaptured: 0,
      rowsRetained: 0, valuesFilled: 0, countsBackfilled: 0, residualShortfalls: [], remainingStates: -1,
      note: 'Another live-browser workflow is running; try again when it finishes.',
    });
  }
  activeSweep = doVerifySweep(opts).finally(() => { activeSweep = null; });
  return activeSweep;
}

async function doVerifySweep(opts: VerifySweepOptions): Promise<VerifySweepResult> {
  const band = opts.band ?? '2-5';
  const quarter = quarterForDate();
  const log = (m: string) => opts.onProgress?.(m);
  const empty = (status: VerifySweepResult['status'], note: string): VerifySweepResult => ({
    status, snapshotId: null, quarter, statesVisited: [], payloadsCaptured: 0, rowsRetained: 0,
    valuesFilled: 0, countsBackfilled: 0, residualShortfalls: [], remainingStates: -1, note,
  });
  if (!isSupportedBand(band)) return empty('unsupported_band', `Acreage band "${band}" is not enabled.`);
  const pageState = drillDeepPageState(band);

  const session = await ensureBrowserSession();
  if (session !== 'live') {
    return empty(session === 'auth_needed' ? 'auth_needed' : 'not_configured',
      'The authenticated visible LandPortal browser session is not available; nothing was read or fabricated.');
  }

  const snap: MrSnapshot = getOrCreateMrSnapshot({ quarter, filters: fixedInitialFilters(band), provider: MR_PROVIDER });
  const { runId, progress } = loadOrCreateSweepRun(snap.id);
  const diag: string[] = [];
  const dlog = (m: string) => { diag.push(`${new Date().toISOString()} ${m}`); log(m); };
  const saveSweep = (status: 'running' | 'paused' | 'completed' | 'failed') =>
    getLandosDb().prepare(
      `UPDATE landos_mr_collection_run SET status = ?, progress_json = ?, diagnostics = ?, updated_at = strftime('%s','now') WHERE id = ?`,
    ).run(status, JSON.stringify(progress), diag.join('\n').slice(0, 20000), runId);

  const maxStates = opts.maxStateVisits ?? 5;
  const observedAt = new Date().toISOString();
  let payloadsCaptured = 0, rowsRetained = 0, valuesFilled = 0, countsBackfilled = 0;
  const statesVisited: string[] = [];
  const residualShortfalls: VerifySweepResult['residualShortfalls'] = [];

  const targetStates = [...US_STATES].filter((s) => s !== 'DC');

  const runBody = async (page: PageLike) => {
    const ops = makeGridOps(page, dlog);
    const { stateCountyCount, countyZipCount, clickStateExpander, clickCountyExpander } = ops;

    // Passive capture of the grid's own data responses.
    const captures: LandPortalAjaxItem[][] = [];
    // County FIPS whose ZIP payload has been seen (and losslessly retained)
    // this run. A seen payload PROVES the county's ZIP coverage — comparing
    // declared counts against zips parented to the county over-reports,
    // because cross-county ZIPs are canonically parented to ONE county while
    // LandPortal lists them under every county they touch.
    const seenCountyPayloads = new Set<string>();
    let itemsSkipped = 0;
    const onResponse = (res: { url(): string; json(): Promise<unknown> }) => {
      if (!res.url().includes('admin-ajax.php')) return;
      void res.json().then((j) => {
        const items = (j as { success?: boolean; data?: { items?: LandPortalAjaxItem[] } })?.data?.items;
        if (Array.isArray(items) && items.length > 0) captures.push(items);
      }).catch(() => { /* non-JSON admin-ajax response — not grid data */ });
    };
    page.on?.('response', onResponse as never);

    /** Retain everything captured so far: new rows, missing-value fills, and
     *  NULL-only structural count backfills. */
    const drainCaptures = (stage: string): void => {
      const batches = captures.splice(0, captures.length);
      if (batches.length === 0) return;
      let retained = 0, filled = 0, counts = 0, items = 0;
      for (const batch of batches) {
        payloadsCaptured++;
        const inputs = batch.map((it) => mapAjaxItem(it, { sourceRef: MARKET_RESEARCH_URL, observedAt })).filter((x): x is MrMetricInput => !!x);
        items += inputs.length;
        const res = recordMrMetrics(snap.id, inputs);
        retained += res.written;
        itemsSkipped += res.skipped;
        const memberships: Array<{ zip: string; fips: string }> = [];
        for (const input of inputs) {
          if (input.geography.level === 'zip' && input.geography.fips) {
            seenCountyPayloads.add(input.geography.fips);
            if (input.geography.zip) memberships.push({ zip: input.geography.zip, fips: input.geography.fips });
          }
        }
        recordMrZipMembership(memberships, 'landportal-payload');
        for (const input of inputs) {
          const key = mrGeoKey(input.geography);
          filled += fillMissingMrMetrics({ snapshotId: snap.id, geoKey: key, metrics: input.metrics, sourceRef: MARKET_RESEARCH_URL, observedAt }).filled.length;
          if (typeof input.zipCount === 'number' || typeof input.countyCount === 'number') {
            if (backfillMrStructureCounts({
              snapshotId: snap.id, geoKey: key,
              ...(typeof input.countyCount === 'number' ? { countyCount: input.countyCount } : {}),
              ...(typeof input.zipCount === 'number' ? { zipCount: input.zipCount } : {}),
            })) counts++;
          }
        }
      }
      rowsRetained += retained; valuesFilled += filled; countsBackfilled += counts;
      dlog(`${stage}: ${batches.length} payload(s), ${items} item(s) → ${retained} new row(s), ${filled} value(s) filled, ${counts} count(s) backfilled`);
    };

    try {
      const nav = await ops.openDrillDeep(pageState);
      if (nav !== 'ready') return nav === 'auth' ? { auth: true } as const : { stalled: true } as const;
      await sleep(2000);
      drainCaptures('navigation');
      // NO bulk collapse here: this workflow reads PAYLOADS, not the DOM, so
      // it tolerates a huge grid — and mass expander-clicking is what
      // triggers the provider's page-freezing render storms.

      // Storm-settling gate. Re-materializing every remembered expansion can
      // jam the page thread for tens of minutes, during which evaluate calls
      // HANG rather than time out. Probe with locally-timed-out calls
      // (discarding hung promises) and keep draining the payloads that arrive
      // during the storm — they carry the memberships this pass needs.
      const settled = await (async (maxMs: number): Promise<boolean> => {
        const start = Date.now();
        let consecutive = 0;
        dlog('waiting for the grid to settle (remembered-expansion render storm)');
        while (Date.now() - start < maxMs) {
          // A REAL DOM-walking function probe — trivial string evaluates can
          // succeed while function evaluates on the storming grid still hang.
          const probe = await Promise.race([
            page.evaluate<number>(() => (document as any).querySelectorAll('tr.state-row').length).then((n) => n > 0).catch(() => false),
            sleep(20000).then(() => false),
          ]);
          drainCaptures('storm-settle');
          if (probe) { consecutive++; if (consecutive >= 2) { dlog(`grid settled after ${Math.round((Date.now() - start) / 1000)}s`); return true; } }
          else consecutive = 0;
          await sleep(5000);
        }
        return false;
      })(30 * 60 * 1000);
      if (!settled) { dlog('grid never settled within 30 minutes'); return { stalled: true } as const; }
      await (page.bringToFront?.() ?? Promise.resolve()).catch(() => { /* best effort */ });

      let visited = 0;
      for (const st of targetStates) {
        if (progress.statesDone.includes(st)) continue;
        if (visited >= maxStates) break;
        visited++;

        let countyN = await stateCountyCount(st).catch(() => 0);
        if (countyN === 0) {
          await clickStateExpander(st);
          for (let i = 0; i < 24 && countyN === 0; i++) { await sleep(1200); countyN = await stateCountyCount(st).catch(() => 0); }
        }
        await sleep(1500);
        drainCaptures(`state ${st} counties (${countyN} rows)`);

        // Open ONLY counties whose ZIP payload has not been seen this run and
        // whose parented count is below the declared count. A drained payload
        // is PROOF of coverage (cross-county ZIPs live under one parent).
        const shortfalls = zipShortfalls(snap.id, st).filter((sf) => !seenCountyPayloads.has(sf.fips));
        for (const sf of shortfalls) {
          const zipN = await countyZipCount(sf.fips).catch(() => 0);
          if (zipN === 0) await clickCountyExpander(sf.fips);
          for (let i = 0; i < 10; i++) {
            await sleep(1000);
            if ((await countyZipCount(sf.fips).catch(() => 0)) > 0 || captures.length > 0) break;
          }
          drainCaptures(`county ${sf.fips} ${sf.name}`);
        }

        const unverified = zipShortfalls(snap.id, st).filter((sf) => !seenCountyPayloads.has(sf.fips));
        if (unverified.length > 0) {
          dlog(`state ${st}: ${unverified.length} county(ies) produced no ZIP payload to verify against — recorded honestly`);
          residualShortfalls.push(...unverified.map((sf) => ({ state: st, ...sf })));
        }
        progress.statesDone.push(st); statesVisited.push(st);
        saveSweep('running');
        drainCaptures(`state ${st} tail`);
      }
      if (itemsSkipped > 0) dlog(`WARNING: ${itemsSkipped} payload item(s) were rejected by validation and NOT retained`);
      return { ok: true } as const;
    } finally {
      page.off?.('response', onResponse as never);
    }
  };

  // A provider render storm can wedge the page so hard that CDP calls hang
  // WITHOUT ever timing out. The watchdog converts that into an honest failed
  // (resumable) run and discards the poisoned working tab so the next run
  // starts on a fresh one.
  const WATCHDOG_MS = 50 * 60 * 1000;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let result: { ok: boolean; status: string; value?: { auth?: boolean; stalled?: boolean; ok?: boolean } };
  try {
    result = await Promise.race([
      withWorkingPage(runBody),
      new Promise<never>((_, rej) => { watchdog = setTimeout(() => rej(new Error('sweep watchdog: no completion within 18 minutes — working tab presumed wedged')), WATCHDOG_MS); }),
    ]);
  } catch (err) {
    resetWorkingPage();
    diag.push(`run crashed: ${String(err)}`);
    saveSweep('failed');
    return { ...empty('stalled', 'The sweep crashed or wedged mid-run; retained progress is saved, the working tab was reset, and the run resumes.'), snapshotId: snap.id, statesVisited, payloadsCaptured, rowsRetained, valuesFilled, countsBackfilled };
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
  const v = result.value;
  if (!result.ok || !v) { saveSweep('failed'); return { ...empty('stalled', 'The browser page session failed; nothing was fabricated.'), snapshotId: snap.id }; }
  if (v.auth) { saveSweep('paused'); return { ...empty('auth_needed', 'LandPortal asked for authentication; the run paused.'), snapshotId: snap.id }; }
  if (v.stalled) { saveSweep('paused'); return { ...empty('stalled', 'The Drill Deep grid never became ready; the run paused and can resume.'), snapshotId: snap.id }; }

  const remaining = targetStates.filter((s) => !progress.statesDone.includes(s)).length;
  saveSweep(remaining === 0 ? 'completed' : 'paused');
  return {
    status: 'swept', snapshotId: snap.id, quarter, statesVisited, payloadsCaptured, rowsRetained,
    valuesFilled, countsBackfilled, residualShortfalls, remainingStates: remaining,
    note: `Visited ${statesVisited.length} state(s): captured ${payloadsCaptured} payload(s), retained ${rowsRetained} new row(s), filled ${valuesFilled} value(s), backfilled ${countsBackfilled} structural count(s). ${residualShortfalls.length} county ZIP shortfall(s) recorded. ${remaining} state(s) remaining.`,
  };
}
