// LandOS — Redfin PUBLIC land comps via a SEPARATE DISPOSABLE Chrome profile.
//
// Mirrors zillow-land-comps.ts. NEVER touches the operator's authenticated
// LandPortal session AND never reuses the Zillow disposable profile/port. It
// launches its own throwaway Chrome (own temp profile, own debug port), resolves
// the subject city via Redfin's PUBLIC location-autocomplete (Redfin land URLs
// require a numeric city id), opens the PUBLIC Lots/Land filter page without
// login, extracts visible LAND listings (residential homes filtered out),
// normalizes to the subject acreage band, and returns a clear source status.
// Best-effort: any failure/blocked/none is reported, never thrown.
//
// Launcher/connector are injectable (tests pass fakes → no browser). The URL
// builders + parsers + normalizer are PURE and unit-tested without a browser.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import { resolveChromePath, readSessionConfig } from './browser-session.js';

// The EXTRACT/IS_BLOCKED functions execute INSIDE the disposable Chrome (not Node),
// so DOM globals are declared as `any` purely to satisfy the Node typechecker.
declare const document: any;
declare const window: any;

export interface RedfinLandComp {
  address: string;
  price: number;
  acres: number | null;
  pricePerAcre: number | null;
  status: string;
  url: string | null;
  source: 'Redfin';
}

export interface RedfinCompsResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: RedfinLandComp[];
  note: string;
  routeTried: string;
}

export interface RedfinFetchInput {
  city?: string;
  state?: string;
  county?: string;
  subjectAcres?: number | null;
}

export interface RawRedfinListing { address: string | null; price: number | null; acres: number | null; sqftLot: number | null; residential: boolean; url: string | null }

// ── Pure helpers (unit-tested; no browser) ──────────────────────────────────

export const REDFIN_HOME = 'https://www.redfin.com/';

/** Extract the first `/city/{id}/{ST}/{Name}` path from any text (used on the
 *  on-page search-suggestion hrefs — the stingray autocomplete API is CloudFront
 *  403-blocked, but the UI search dropdown exposes the correct city URL). */
export function parseRedfinCityPath(responseText: string): string | null {
  if (!responseText) return null;
  const m = responseText.match(/\/city\/\d+\/[A-Z]{2}\/[A-Za-z0-9._-]+/);
  return m ? m[0] : null;
}

/** Public Redfin Lots/Land filter URL for a resolved city path. */
export function redfinLandFilterUrl(cityPath: string): string {
  return `https://www.redfin.com${cityPath}/filter/property-type=land`;
}

/** Normalize + filter raw listings to same-acreage-band, sane-priced LAND comps,
 *  dropping residential homes and deduping by address. Never fabricates. */
export function normalizeRedfinListings(raw: RawRedfinListing[], subjectAcres: number | null): RedfinLandComp[] {
  const band = subjectAcres != null && subjectAcres > 0
    ? { lo: Math.max(0.05, subjectAcres * 0.5), hi: subjectAcres * 2.5 }
    : { lo: 0.1, hi: 1.0 };
  const seen = new Set<string>();
  const out: RedfinLandComp[] = [];
  for (const r of raw) {
    if (r.residential) continue; // never compare vacant land against homes
    const price = typeof r.price === 'number' ? r.price : null;
    if (!r.address || price == null || price <= 0) continue;
    if (price < 3000 || price > 150000) continue; // land-price sanity band
    let acres = typeof r.acres === 'number' && Number.isFinite(r.acres) && r.acres > 0 ? r.acres : null;
    if (acres == null && typeof r.sqftLot === 'number' && r.sqftLot > 0) acres = Math.round((r.sqftLot / 43560) * 100) / 100;
    if (acres != null && (acres < band.lo || acres > band.hi)) continue;
    const key = r.address.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: r.address.replace(/\s+/g, ' ').trim(), price, acres, pricePerAcre: acres ? Math.round(price / acres) : null, status: 'listed', url: r.url ?? null, source: 'Redfin' });
  }
  return out.slice(0, 8);
}

// ── Disposable-profile browser capture (injectable) ─────────────────────────

export interface RedfinFetchDeps {
  resolveChrome?: () => { path: string | null; checked: string[] };
  spawn?: (cmd: string, args: string[]) => { kill?: () => void };
  connect?: (browserURL: string) => Promise<RedfinBrowserLike | null>;
  /** Debug port for the DISPOSABLE Redfin Chrome — MUST differ from LandPortal (9222) and Zillow (9334). */
  port?: number;
  timeoutMs?: number;
  settleMs?: number;
  scrollSettleMs?: number;
  force?: boolean;
}

export interface RedfinPageLike {
  setViewport?(v: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | string, ...args: unknown[]): Promise<T>;
  keyboard?: { type(text: string, opts?: { delay?: number }): Promise<void>; press(key: string): Promise<void> };
}
export interface RedfinBrowserLike { newPage(): Promise<RedfinPageLike>; close(): Promise<void> }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultSpawn = (cmd: string, args: string[]) => {
  const child = nodeSpawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { kill: () => { try { child.kill(); } catch { /* ignore */ } } };
};

async function defaultConnect(browserURL: string): Promise<RedfinBrowserLike | null> {
  try {
    const mod = (await import('puppeteer-core')) as unknown as { connect?: (o: { browserURL: string }) => Promise<RedfinBrowserLike>; default?: { connect: (o: { browserURL: string }) => Promise<RedfinBrowserLike> } };
    const connect = mod.connect ?? mod.default?.connect;
    if (!connect) return null;
    return await connect({ browserURL });
  } catch {
    return null;
  }
}

// Focus Redfin's on-page search box + set the query (React-safe) so the UI
// autocomplete dropdown renders (the stingray autocomplete API is 403-blocked).
const FOCUS_AND_SET_SEARCH = (query: string): boolean => {
  const inp: any = (document as any).querySelector('input[data-rf-test-name="search-box-input"], #search-box-input, input[name="searchInputBox"], input[type="search"], input[placeholder*="Address" i], input[placeholder*="City" i]');
  if (!inp) return false;
  inp.focus();
  const proto = Object.getPrototypeOf(inp);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(inp, query); else inp.value = query;
  inp.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
  inp.dispatchEvent(new (window as any).KeyboardEvent('keyup', { bubbles: true }));
  return true;
};

// Collect suggestion anchor hrefs from the search dropdown (the correct city URL
// is exposed here even though the autocomplete API is blocked).
const READ_SUGGESTION_HREFS = (): string => Array.from((document as any).querySelectorAll('a[href*="/city/"], [class*="item-row" i] a, [role="option"] a, [class*="Autocomplete" i] a')).map((a: any) => a.href || '').join(' ');

// In-page (runs INSIDE disposable Chrome). Broad selectors + text parsing.
const EXTRACT_REDFIN = (): RawRedfinListing[] => {
  const out: RawRedfinListing[] = [];
  const seen = new Set<string>();
  const cards = Array.from((document as any).querySelectorAll('.HomeCardContainer,[class*="HomeCard" i],.bp-Homecard,[class*="MapHomeCard" i],[data-rf-test-id*="mapHomeCard" i],div[class*="homecard" i]'));
  for (const c of cards as any[]) {
    const txt = ((c.textContent as string) || '').replace(/\s+/g, ' ').trim();
    const priceEl: any = c.querySelector('[class*="Price" i]');
    const priceText = (priceEl && priceEl.textContent) || txt;
    const pm = String(priceText).match(/\$(\d{1,3}(?:,\d{3})+)/) || txt.match(/\$(\d{1,3}(?:,\d{3})+)/);
    const price = pm ? Number(pm[1].replace(/,/g, '')) : null;
    // Fractional acres (single leading digit avoids grabbing the ZIP), then sqft lot.
    const am = txt.match(/(\d\.\d{1,3})\s*acres?\b/i);
    const acres = am ? parseFloat(am[1]) : null;
    const sm = txt.match(/([\d,]{4,})\s*sq\.?\s*ft\.?\s*lot/i);
    const sqftLot = sm ? Number(sm[1].replace(/,/g, '')) : null;
    // Address: prefer a dedicated address element, else a street-address regex.
    const addrEl: any = c.querySelector('[class*="Address" i],address');
    const addrText = (addrEl && (addrEl.textContent || '').replace(/\s+/g, ' ').trim()) || '';
    const addrM = addrText.match(/(\d+\s+[\w .]+,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/) || txt.match(/(\d+\s+[\w .]+?,\s*[A-Za-z .]+,\s*[A-Z]{2}\s*\d{5})/);
    const address = addrM ? addrM[1].replace(/\s+/g, ' ').trim() : null;
    // Residential ONLY when a POSITIVE bed/bath count is present (Redfin land cards
    // still render "— beds / — baths" placeholders, which must NOT flag as a home).
    const residential = /\b[1-9]\d*\s*(?:beds?|bd)\b/i.test(txt) || /\b[1-9]\d*\s*(?:baths?|ba)\b/i.test(txt);
    const link = ((c.querySelector('a[href*="/FL/"],a[href*="/home/"],a[href]') || {}) as any).href || null;
    if (price && address && !seen.has(address)) { seen.add(address); out.push({ price, acres, sqftLot, address, residential, url: link }); }
  }
  return out;
};

const IS_BLOCKED = (): boolean => /press and hold|are you a human|captcha|verify you are|unusual traffic|pardon our interruption|access denied|blocked/i.test(((document as any).body?.innerText || '').slice(0, 4000));

/**
 * Fetch Redfin public land comps for a locality via a disposable Chrome profile.
 * Route: PUBLIC on-page search box → resolved /city/ URL → PUBLIC Lots/Land filter
 * page → extract (residential homes filtered out). Gated on live-browser mode
 * (unless deps.force). Always resolves (never throws).
 */
export async function fetchRedfinLandComps(input: RedfinFetchInput, deps: RedfinFetchDeps = {}): Promise<RedfinCompsResult> {
  const city = (input.city ?? '').trim();
  const state = (input.state ?? '').trim();
  if (!deps.force && !deps.connect) {
    try { if (!readSessionConfig().enabled) return { status: 'disabled', comps: [], note: 'Live browser mode off — Redfin not attempted.', routeTried: '' }; } catch { /* fall through */ }
  }
  if (!city || !state) return { status: 'disabled', comps: [], note: 'No city/state locality for a Redfin land search.', routeTried: '' };

  const chrome = (deps.resolveChrome ?? (() => resolveChromePath()))();
  if (!chrome.path) return { status: 'disabled', comps: [], note: 'Google Chrome not found for a disposable Redfin session.', routeTried: '' };

  const spawnImpl = deps.spawn ?? defaultSpawn;
  const connect = deps.connect ?? defaultConnect;
  const port = deps.port ?? 9335; // separate from LandPortal (9222) and Zillow (9334)
  const timeoutMs = deps.timeoutMs ?? 30000;
  const settleMs = deps.settleMs ?? 5000;
  const scrollSettleMs = deps.scrollSettleMs ?? 800;
  const profileDir = path.join(os.tmpdir(), `landos-redfin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  let routeTried = REDFIN_HOME;

  let child: { kill?: () => void } | null = null;
  let browser: RedfinBrowserLike | null = null;
  try {
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* ignore */ }
    child = spawnImpl(chrome.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled', 'about:blank']);
    for (let i = 0; i < 12 && !browser; i++) { browser = await connect(`http://127.0.0.1:${port}`); if (!browser) await sleep(600); }
    if (!browser) return { status: 'error', comps: [], note: 'Disposable Chrome for Redfin did not start.', routeTried };

    const page = await browser.newPage();
    try { await page.setViewport?.({ width: 1400, height: 950 }); } catch { /* best-effort */ }

    // Step 1: resolve the Redfin city path via the ON-PAGE search box (the stingray
    // autocomplete API is CloudFront 403-blocked; the UI dropdown is not). Type the
    // locality, let the dropdown render, then read the correct /city/{id}/... href.
    await page.goto(REDFIN_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await sleep(Math.min(settleMs, 4000));
    const focused = await page.evaluate<boolean>(FOCUS_AND_SET_SEARCH as unknown as () => boolean, `${city}, ${state}`);
    if (focused && page.keyboard) { try { await page.keyboard.press('Space'); await page.keyboard.press('Backspace'); } catch { /* nudge the debounced dropdown */ } }
    await sleep(2500);
    const hrefs = await page.evaluate<string>(READ_SUGGESTION_HREFS as unknown as () => string);
    const cityPath = parseRedfinCityPath(hrefs);
    if (!cityPath) return { status: 'none', comps: [], note: 'Redfin search did not surface a city page for this locality (dropdown empty or blocked).', routeTried: REDFIN_HOME };

    // Step 2: public Lots/Land filter page.
    const landUrl = redfinLandFilterUrl(cityPath);
    routeTried = landUrl;
    await page.goto(landUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await sleep(settleMs);
    for (let i = 0; i < 4; i++) { try { await page.evaluate('window.scrollBy(0,1200)'); } catch { /* ignore */ } await sleep(scrollSettleMs); }
    const blocked = await page.evaluate<boolean>(IS_BLOCKED as unknown as () => boolean);
    const rawList = await page.evaluate<RawRedfinListing[]>(EXTRACT_REDFIN as unknown as () => RawRedfinListing[]);
    if (blocked && (!rawList || rawList.length === 0)) return { status: 'blocked', comps: [], note: 'Redfin served an anti-bot check (no public listings returned).', routeTried: landUrl };
    const comps = normalizeRedfinListings(rawList ?? [], input.subjectAcres ?? null);
    return {
      status: comps.length ? 'retrieved' : 'none',
      comps,
      note: comps.length ? `Redfin public land search returned ${comps.length} in-band land comp(s).` : 'Redfin reachable but no in-band land comps found (sparse / out-of-band / residential-only).',
      routeTried: landUrl,
    };
  } catch (e) {
    return { status: 'error', comps: [], note: `Redfin capture error: ${(e as Error)?.message ?? 'unknown'}.`, routeTried };
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { child?.kill?.(); } catch { /* ignore */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
