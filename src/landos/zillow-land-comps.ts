// LandOS — Zillow PUBLIC land comps via a SEPARATE DISPOSABLE Chrome profile.
//
// This NEVER touches the operator's authenticated LandPortal browser session. It
// launches a throwaway Chrome (its own temp profile + its own debug port), opens
// PUBLIC Zillow "Lots/Land" pages without login, extracts visible land listings,
// normalizes them to the subject acreage band, and returns them with a clear
// source status. Best-effort: any failure/blocked/none is reported, never thrown,
// so a report run continues regardless.
//
// The launcher/connector are injectable (tests pass fakes → no browser launch).
// The URL builder + normalizer are PURE and unit-tested without a browser.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import { resolveChromePath, readSessionConfig } from './browser-session.js';
import { parseZillowStructured, parseListingStatus, type CompStatus } from './comp-extraction.js';

// The EXTRACT/IS_BLOCKED functions execute INSIDE the disposable Chrome (not Node),
// so DOM globals are declared as `any` purely to satisfy the Node typechecker.
declare const document: any;
declare const window: any;

export interface ZillowLandComp {
  address: string;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: CompStatus;
  url: string | null;
  source: 'Zillow';
}

export interface ZillowCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: ZillowLandComp[];
  note: string;
  routeTried: string;
}

export interface ZillowFetchInput {
  city?: string;
  state?: string;
  county?: string;
  subjectAcres?: number | null;
}

export interface RawZillowListing { address: string | null; price: number | null; acres: number | null; url: string | null; status?: string | null }
/** DOM read: card rows PLUS the raw __NEXT_DATA__ JSON for structured parsing. */
export interface RawZillowRead { listings: RawZillowListing[]; nextData: string | null }

// ── Pure helpers (unit-tested; no browser) ──────────────────────────────────

/** Public Zillow Lots/Land search URL for a locality (geographic, not ZIP). */
export function zillowLandUrl(city: string, state: string): string {
  const citySlug = city.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const st = state.trim().toLowerCase();
  return `https://www.zillow.com/${citySlug}-${st}/land/`;
}

/** Normalize + filter raw listings to same-acreage-band, sane-priced land comps,
 *  deduped by address. Never fabricates; drops rows without a price+address. */
export function normalizeZillowListings(raw: RawZillowListing[], subjectAcres: number | null): ZillowLandComp[] {
  const band = subjectAcres != null && subjectAcres > 0
    ? { lo: Math.max(0.05, subjectAcres * 0.5), hi: subjectAcres * 2.5 }
    : { lo: 0.1, hi: 1.0 };
  const seen = new Set<string>();
  const out: ZillowLandComp[] = [];
  for (const r of raw) {
    const price = typeof r.price === 'number' ? r.price : null;
    if (!r.address || price == null || price <= 0) continue;
    if (price < 3000 || price > 150000) continue; // land-price sanity band
    const acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    if (acres != null && (acres < band.lo || acres > band.hi)) continue;
    const key = r.address.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const status = r.status ? parseListingStatus(r.status) : 'active'; // public land search defaults to for-sale
    out.push({ address: r.address.replace(/\s+/g, ' ').trim(), price, acres, pricePerAcre: acres ? Math.round(price / acres) : null, status: status === 'unknown' ? 'active' : status, url: r.url ?? null, source: 'Zillow' });
  }
  return out.slice(0, 8);
}

// ── Disposable-profile browser capture (injectable) ─────────────────────────

export interface ZillowFetchDeps {
  /** Resolve the Chrome executable (default = shared resolver). */
  resolveChrome?: () => { path: string | null; checked: string[] };
  /** Launch Chrome detached (default = child_process spawn). */
  spawn?: (cmd: string, args: string[]) => { kill?: () => void };
  /** Connect puppeteer to the disposable Chrome (default = puppeteer-core). */
  connect?: (browserURL: string) => Promise<ZillowBrowserLike | null>;
  /** Debug port for the DISPOSABLE Chrome — MUST differ from BROWSER_INTEL_CDP_URL. */
  port?: number;
  timeoutMs?: number;
  /** Settle after navigation before reading (default 6000ms; tests pass small). */
  settleMs?: number;
  /** Settle after each scroll (default 800ms; tests pass small). */
  scrollSettleMs?: number;
  /** Bypass the live-mode gate (tests). */
  force?: boolean;
}

export interface ZillowPageLike {
  setViewport?(v: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
}
export interface ZillowBrowserLike { newPage(): Promise<ZillowPageLike>; close(): Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultSpawn = (cmd: string, args: string[]) => {
  const child = nodeSpawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { kill: () => { try { child.kill(); } catch { /* ignore */ } } };
};

async function defaultConnect(browserURL: string): Promise<ZillowBrowserLike | null> {
  try {
    const mod = (await import('puppeteer-core')) as unknown as { connect?: (o: { browserURL: string }) => Promise<ZillowBrowserLike>; default?: { connect: (o: { browserURL: string }) => Promise<ZillowBrowserLike> } };
    const connect = mod.connect ?? mod.default?.connect;
    if (!connect) return null;
    return await connect({ browserURL });
  } catch {
    return null;
  }
}

// In-page (runs INSIDE disposable Chrome). Broad selectors + text parsing because
// Zillow's data-test attributes are obfuscated/variable.
const EXTRACT_ZILLOW = (): RawZillowRead => {
  const out: RawZillowListing[] = [];
  const seen = new Set<string>();
  const cards = Array.from((document as any).querySelectorAll('[class*="property-card" i],[class*="ListItem" i],[data-test="property-card"],[class*="HomeCard" i],article'));
  for (const c of cards as any[]) {
    const txt = ((c.textContent as string) || '').replace(/\s+/g, ' ').trim();
    const pm = txt.match(/\$(\d{1,3}(?:,\d{3})+)/);
    const price = pm ? Number(pm[1].replace(/,/g, '')) : null;
    // Whole OR fractional acres, then "X acre lot", then sqft lot.
    const am = txt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*acres?\s*lot/i) || txt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*acres?\b/i) || txt.match(/(\d{1,3}(?:\.\d{1,2})?)\s*ac\b/i);
    let acres = am ? parseFloat(am[1]) : null;
    if (acres == null) { const sm = txt.match(/([\d,]{3,})\s*sq\.?\s*ft\.?\s*lot/i); if (sm) { const sf = Number(sm[1].replace(/,/g, '')); if (sf > 0) acres = Math.round((sf / 43560) * 100) / 100; } }
    const addrM = txt.match(/(\d+\s+[\w .]+?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/);
    const address = addrM ? addrM[1].replace(/\s+/g, ' ').trim() : null;
    const link = ((c.querySelector('a[href*="/homedetails/"]') || {}) as any).href || null;
    const sm2 = txt.match(/\b(sold|pending|under contract|for sale|coming soon)\b/i);
    const status = sm2 ? sm2[1] : null;
    if (price && address && !seen.has(address)) { seen.add(address); out.push({ price, acres, address, url: link, status }); }
  }
  const nd = (document as any).querySelector('#__NEXT_DATA__');
  const nextData = nd && nd.textContent ? String(nd.textContent) : null;
  return { listings: out, nextData };
};

const IS_BLOCKED = (): boolean => /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption/i.test(((document as any).body?.innerText || '').slice(0, 4000));

/**
 * Fetch Zillow public land comps for a locality via a disposable Chrome profile.
 * Gated on live-browser mode (unless deps.force). Always resolves (never throws);
 * status is one of retrieved/blocked/none/error/disabled.
 */
export async function fetchZillowLandComps(input: ZillowFetchInput, deps: ZillowFetchDeps = {}): Promise<ZillowCompsResult> {
  const city = (input.city ?? '').trim();
  const state = (input.state ?? '').trim();
  const url = city && state ? zillowLandUrl(city, state) : '';
  if (!deps.force && !deps.connect) {
    // Production gate: only browse when live-browser mode is enabled.
    try { if (!readSessionConfig().enabled) return { status: 'disabled', comps: [], note: 'Live browser mode off — Zillow not attempted.', routeTried: url }; } catch { /* fall through */ }
  }
  if (!city || !state) return { status: 'disabled', comps: [], note: 'No city/state locality for a Zillow land search.', routeTried: url };

  const chrome = (deps.resolveChrome ?? (() => resolveChromePath()))();
  if (!chrome.path) return { status: 'disabled', comps: [], note: 'Google Chrome not found for a disposable Zillow session.', routeTried: url };

  const spawnImpl = deps.spawn ?? defaultSpawn;
  const connect = deps.connect ?? defaultConnect;
  // Separate debug port from the LandPortal session (BROWSER_INTEL_CDP_URL = 9222).
  const port = deps.port ?? 9334;
  const timeoutMs = deps.timeoutMs ?? 30000;
  const profileDir = path.join(os.tmpdir(), `landos-zillow-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

  let child: { kill?: () => void } | null = null;
  let browser: ZillowBrowserLike | null = null;
  try {
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* ignore */ }
    child = spawnImpl(chrome.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', 'about:blank']);
    for (let i = 0; i < 12 && !browser; i++) { browser = await connect(`http://127.0.0.1:${port}`); if (!browser) await sleep(600); }
    if (!browser) return { status: 'error', comps: [], note: 'Disposable Chrome for Zillow did not start.', routeTried: url };

    const settleMs = deps.settleMs ?? 6000;
    const scrollSettleMs = deps.scrollSettleMs ?? 800;
    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await sleep(settleMs);
    for (let i = 0; i < 4; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
    const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
    const read = await page.evaluate<RawZillowRead>(EXTRACT_ZILLOW as unknown as () => RawZillowRead);
    const raw = read?.listings ?? [];
    if (blocked && raw.length === 0 && !read?.nextData) return { status: 'blocked', comps: [], note: 'Zillow served an anti-bot check (no public listings returned).', routeTried: url };
    // Prefer the embedded structured search results (reliable); fall back to DOM.
    const structured = read?.nextData ? parseZillowStructured(read.nextData, input.subjectAcres ?? null) : [];
    const comps = structured.length
      ? structured.map((s) => ({ address: s.address ?? '', price: s.price, acres: s.acres, pricePerAcre: s.pricePerAcre, status: s.status === 'unknown' ? ('active' as CompStatus) : s.status, url: s.url, source: 'Zillow' as const })).filter((c) => c.address)
      : normalizeZillowListings(raw, input.subjectAcres ?? null);
    const via = structured.length ? 'structured __NEXT_DATA__' : 'visible cards';
    return {
      status: comps.length ? 'retrieved' : 'none',
      comps,
      note: comps.length ? `Zillow public land search returned ${comps.length} in-band comp(s) via ${via}.` : 'Zillow reachable but no in-band land comps found this run.',
      routeTried: url,
    };
  } catch (e) {
    return { status: 'error', comps: [], note: `Zillow capture error: ${(e as Error)?.message ?? 'unknown'}.`, routeTried: url };
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { child?.kill?.(); } catch { /* ignore */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
