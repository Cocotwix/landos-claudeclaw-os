// Market Research MULTI-BAND collector — runs OUTSIDE the LandOS server.
//
// A worker process connects to the operator's persistent authenticated Chrome
// (CDP), opens its OWN Market Research tab, selects the acreage band through
// the real Drill Deep dropdown, and captures the page's own states request as
// the exact filter template for that band. It then executes the SAME data
// calls the page's expander clicks fire (identical form bodies, same session,
// read-only market research scope), politely throttled, and retains every
// payload into the band's quarterly snapshot via the shared store functions.
//
// Because this runs in a separate process (SQLite is in WAL mode), the LandOS
// server's event loop — and therefore the dashboard — stays responsive.
// Progress is a per-unit ledger (landos_mr_band_unit), so runs resume exactly
// where they stopped. An empty payload marks the unit 'empty' (a real
// provider absence, never fabricated rows).

import { getLandosDb } from './db.js';
import { US_STATES, type AcreageBand } from './market-matrix.js';
import { drillDeepPageState, isSupportedBand } from './browser-playbook-landportal-market.js';
import { LP, withArgs, clickExactText, setSelect, readLoginLike, dismissDialogs, gridDataReady } from './browser-playbook-landportal-market-live.js';
import {
  backfillMrStructureCounts, fillMissingMrMetrics, fixedInitialFilters, getOrCreateMrSnapshot,
  mrGeoKey, quarterForDate, recordMrMetrics, recordMrZipMembership, type MrSnapshot,
} from './market-research-snapshots.js';
import { mapAjaxItem, MR_PROVIDER, type LandPortalAjaxItem } from './market-research-collector.js';

declare const document: any;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────
// Units + ledger
// ─────────────────────────────────────────────────────────────────────────

export type BandUnit =
  | { level: 'states'; key: string }
  | { level: 'counties'; state: string; key: string }
  | { level: 'zips'; state: string; county: string; key: string };

export const statesUnit = (): BandUnit => ({ level: 'states', key: 'states' });
export const countiesUnit = (state: string): BandUnit => ({ level: 'counties', state, key: `counties:${state}` });
export const zipsUnit = (state: string, county: string): BandUnit => ({ level: 'zips', state, county, key: `zips:${state}:${county}` });

export function unitStatus(snapshotId: number, unitKey: string): string | null {
  const row = getLandosDb().prepare('SELECT status FROM landos_mr_band_unit WHERE snapshot_id = ? AND unit_key = ?').get(snapshotId, unitKey) as { status: string } | undefined;
  return row?.status ?? null;
}

export function markUnit(snapshotId: number, unitKey: string, status: 'retained' | 'empty' | 'failed', items: number): void {
  getLandosDb().prepare(
    `INSERT INTO landos_mr_band_unit (snapshot_id, unit_key, status, items)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(snapshot_id, unit_key) DO UPDATE SET status = excluded.status, items = excluded.items, updated_at = strftime('%s','now')`,
  ).run(snapshotId, unitKey, status, items);
}

export function bandUnitSummary(snapshotId: number): { retained: number; empty: number; failed: number } {
  const rows = getLandosDb().prepare('SELECT status, COUNT(*) n FROM landos_mr_band_unit WHERE snapshot_id = ? GROUP BY status').all(snapshotId) as Array<{ status: string; n: number }>;
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { retained: by.retained ?? 0, empty: by.empty ?? 0, failed: by.failed ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────
// Request building — replicate the page's own call exactly
// ─────────────────────────────────────────────────────────────────────────

/** Build the exact form body the page sends for a unit, from the captured
 *  filter template (verbatim; only level/state/county vary per unit). */
export function buildUnitBody(filtersJson: string, unit: BandUnit): string {
  const state = unit.level === 'states' ? '' : unit.state;
  const county = unit.level === 'zips' ? unit.county : '';
  return `action=tlp_data_market_search&method=get_drill_deep&level=${unit.level}` +
    `&state=${encodeURIComponent(state)}&county=${encodeURIComponent(county)}` +
    `&filters=${encodeURIComponent(filtersJson)}`;
}

/** Parse the filters JSON out of a captured admin-ajax request body. */
export function filtersFromRequestBody(body: string): string | null {
  const m = body.match(/(?:^|&)filters=([^&]*)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, '%20')); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────────────────

export interface UnitRetention { items: number; written: number; filled: number; counts: number; memberships: number }

export function retainItems(snap: MrSnapshot, items: LandPortalAjaxItem[], observedAt: string): UnitRetention {
  const inputs = items.map((it) => mapAjaxItem(it, { sourceRef: LP.url, observedAt })).filter((x): x is NonNullable<ReturnType<typeof mapAjaxItem>> => !!x);
  const res = recordMrMetrics(snap.id, inputs);
  let filled = 0, counts = 0;
  const memberships: Array<{ zip: string; fips: string }> = [];
  for (const input of inputs) {
    const key = mrGeoKey(input.geography);
    filled += fillMissingMrMetrics({ snapshotId: snap.id, geoKey: key, metrics: input.metrics, sourceRef: LP.url, observedAt }).filled.length;
    if (typeof input.zipCount === 'number' || typeof input.countyCount === 'number') {
      if (backfillMrStructureCounts({
        snapshotId: snap.id, geoKey: key,
        ...(typeof input.countyCount === 'number' ? { countyCount: input.countyCount } : {}),
        ...(typeof input.zipCount === 'number' ? { zipCount: input.zipCount } : {}),
      })) counts++;
    }
    if (input.geography.level === 'zip' && input.geography.fips && input.geography.zip) {
      memberships.push({ zip: input.geography.zip, fips: input.geography.fips });
    }
  }
  const added = recordMrZipMembership(memberships, 'landportal-payload');
  return { items: items.length, written: res.written, filled, counts, memberships: added };
}

// ─────────────────────────────────────────────────────────────────────────
// The worker run
// ─────────────────────────────────────────────────────────────────────────

export interface BandRunOptions {
  cdpUrl?: string;
  /** Delay between unit requests in ms (politeness; jitter added). */
  throttleMs?: number;
  /** Stop after this many units this run (resumable; 0 = no cap). */
  maxUnits?: number;
  onProgress?: (m: string) => void;
}

export interface BandRunResult {
  status: 'completed' | 'partial' | 'auth_needed' | 'stalled' | 'unsupported_band';
  band: AcreageBand;
  snapshotId: number | null;
  unitsDone: number;
  unitsEmpty: number;
  unitsFailed: number;
  itemsRetained: number;
  note: string;
}

export async function runBandCollection(band: AcreageBand, opts: BandRunOptions = {}): Promise<BandRunResult> {
  const log = opts.onProgress ?? (() => { /* silent */ });
  const empty = (status: BandRunResult['status'], note: string): BandRunResult => ({
    status, band, snapshotId: null, unitsDone: 0, unitsEmpty: 0, unitsFailed: 0, itemsRetained: 0, note,
  });
  if (!isSupportedBand(band)) return empty('unsupported_band', `Band "${band}" has no native LandPortal option.`);
  const pageState = drillDeepPageState(band);
  const throttle = opts.throttleMs ?? 200;
  const quarter = quarterForDate();
  const snap = getOrCreateMrSnapshot({ quarter, filters: fixedInitialFilters(band), provider: MR_PROVIDER });

  const puppeteer = (await import('puppeteer-core')) as unknown as { connect(o: object): Promise<{ newPage(): Promise<unknown>; disconnect(): Promise<void> }> };
  const browser = await puppeteer.connect({ browserURL: opts.cdpUrl ?? 'http://127.0.0.1:9222', protocolTimeout: 120_000, defaultViewport: null });
  const page = await browser.newPage() as {
    goto(u: string, o?: object): Promise<unknown>;
    evaluate<T>(fn: ((...a: never[]) => T) | string, ...args: unknown[]): Promise<T>;
    close(): Promise<void>;
    on(ev: string, cb: (x: never) => void): void;
  };

  try {
    // Capture the page's own requests: the states request fired after the
    // band is selected supplies the VERBATIM filter template for this band.
    const requestBodies: string[] = [];
    page.on('request', ((req: { url(): string; postData(): string | undefined }) => {
      if (!req.url().includes('admin-ajax.php')) return;
      const body = req.postData();
      if (body && body.includes('get_drill_deep')) requestBodies.push(body);
    }) as never);

    await page.goto(LP.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(5000);
    await page.evaluate<number>(dismissDialogs as never).catch(() => 0);
    if (await page.evaluate<boolean>(readLoginLike as never)) return empty('auth_needed', 'LandPortal presented a login screen.');

    let vis = false;
    for (let i = 0; i < 6 && !vis; i++) {
      await page.evaluate<boolean>(withArgs(clickExactText) as never, LP.drillDeepTab).catch(() => false);
      await sleep(3000);
      vis = await page.evaluate<boolean>((() => { const t = (document as any).querySelector('.drill-table-scroll table'); return !!(t && t.offsetParent); }) as never).catch(() => false);
    }
    if (!vis) return empty('stalled', 'Drill Deep never became active in the worker tab.');

    // Apply page state: Sold / Land / 1 Year / the requested band.
    await page.evaluate<boolean>(withArgs(setSelect) as never, LP.controls.data, LP.filterOptions.dataLand);
    await page.evaluate<boolean>(withArgs(setSelect) as never, LP.controls.time, LP.filterOptions.time1Year);
    await page.evaluate<boolean>(withArgs(clickExactText) as never, LP.toggles.statusSold);
    await page.evaluate<boolean>(withArgs(clickExactText) as never, LP.toggles.groupByState);
    requestBodies.length = 0;
    await page.evaluate<boolean>(withArgs(setSelect) as never, LP.controls.acreage, pageState.acreageOptionMatch);
    // Wait for the page's own band-filtered states request → filter template.
    let template: string | null = null;
    for (let i = 0; i < 30 && !template; i++) {
      await sleep(1000);
      const statesBody = requestBodies.find((b) => b.includes('level=states'));
      if (statesBody) template = filtersFromRequestBody(statesBody);
    }
    if (!template) return empty('stalled', 'The band-filtered states request never fired; no filter template captured.');
    log(`band ${band}: filter template captured (${template.slice(0, 120)}…)`);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) { await sleep(1500); ready = await page.evaluate<boolean>(gridDataReady as never).catch(() => false); }

    const callUnit = async (unit: BandUnit): Promise<LandPortalAjaxItem[] | null> => {
      const body = buildUnitBody(template as string, unit);
      // Transient failures happen (especially right after navigation) — retry
      // briefly before recording a resumable 'failed' unit.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await page.evaluate<{ ok: boolean; json: unknown }>(
          (async (b: string) => {
            const r = await fetch('/wp-admin/admin-ajax.php', {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: b,
              credentials: 'same-origin',
            });
            return { ok: r.ok, json: await r.json().catch(() => null) };
          }) as never, body,
        ).catch(() => null);
        const items = res?.ok ? (res.json as { success?: boolean; data?: { items?: LandPortalAjaxItem[] } })?.data?.items : undefined;
        if (Array.isArray(items)) return items;
        if (attempt < 3) await sleep(attempt * 2500);
      }
      return null;
    };

    const observedAt = new Date().toISOString();
    let unitsDone = 0, unitsEmpty = 0, unitsFailed = 0, itemsRetained = 0, ran = 0;
    const capReached = () => opts.maxUnits !== undefined && opts.maxUnits > 0 && ran >= opts.maxUnits;
    const pace = async () => { await sleep(throttle + Math.floor(throttle * 0.5 * (ran % 3))); };

    const runUnit = async (unit: BandUnit): Promise<LandPortalAjaxItem[] | null> => {
      const prior = unitStatus(snap.id, unit.key);
      if (prior === 'retained' || prior === 'empty') return null;   // resumable skip
      ran++;
      const items = await callUnit(unit);
      if (items === null) { markUnit(snap.id, unit.key, 'failed', 0); unitsFailed++; await pace(); return null; }
      if (items.length === 0) { markUnit(snap.id, unit.key, 'empty', 0); unitsEmpty++; await pace(); return items; }
      const ret = retainItems(snap, items, observedAt);
      markUnit(snap.id, unit.key, 'retained', ret.items);
      unitsDone++; itemsRetained += ret.items;
      await pace();
      return items;
    };

    // 1. States unit.
    await runUnit(statesUnit());
    // 2. Counties per state → discover county display names for ZIP units.
    const states = [...US_STATES].filter((s) => s !== 'DC');
    const db = getLandosDb();
    for (const st of states) {
      if (capReached()) break;
      const items = await runUnit(countiesUnit(st));
      // ZIP-unit discovery must survive resumption: when the counties unit is
      // SKIPPED (already retained), recover the provider county names from the
      // retained band snapshot instead of the (absent) live payload — else
      // previously failed ZIP units are never revisited.
      let countyNames: string[];
      if (items) {
        countyNames = items.filter((i) => i.county && !i.zip).map((i) => String(i.county));
      } else {
        countyNames = (db.prepare(
          `SELECT g.name FROM landos_mr_metric m JOIN landos_mr_geography g ON g.id = m.geography_id
           WHERE m.snapshot_id = ? AND g.level = 'county' AND g.state = ?`,
        ).all(snap.id, st) as Array<{ name: string | null }>)
          .map((r) => (r.name ?? '').replace(/ County$/, ''))
          .filter(Boolean);
      }
      // County payloads can include out-of-state border counties; ZIP units use
      // the state THE PROVIDER groups them under (the request needs that pairing).
      for (const name of countyNames) {
        if (capReached()) break;
        await runUnit(zipsUnit(st, name));
      }
      log(`band ${band}: state ${st} done (${unitsDone} retained, ${unitsEmpty} empty, ${unitsFailed} failed, ${itemsRetained} items)`);
    }

    // Re-derive completion from the ledger: every counties unit retained and
    // no failed units outstanding.
    const summary = bandUnitSummary(snap.id);
    const complete = !capReached() && summary.failed === 0;
    return {
      status: complete ? 'completed' : 'partial', band, snapshotId: snap.id,
      unitsDone, unitsEmpty, unitsFailed, itemsRetained,
      note: `Band ${band}: ${unitsDone} unit(s) retained (${itemsRetained} rows), ${unitsEmpty} provider-empty, ${unitsFailed} failed${capReached() ? '; unit cap reached — resumable' : ''}.`,
    };
  } finally {
    await page.close().catch(() => { /* already gone */ });
    await browser.disconnect().catch(() => { /* already gone */ });
  }
}
