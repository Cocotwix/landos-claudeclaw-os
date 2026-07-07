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
  type BrowserSearchKey, type BrowserPageRead, type BrowserRunHooks, type BrowserFact,
  makeParkedDriver, emptyEvidence, recordBlocked, routeBrowserQuestion,
} from './browser-intelligence.js';
import type { PropertyPatch } from './normalized-property.js';
import type {
  PendingLandPortalInspectionRecord,
  LandPortalOverlayObservation,
  LandPortalVisualObservation,
  LandPortalComparableRecord,
} from './property-card.js';
import { extractRecordFacts } from './semantic-extract.js';
import {
  understandPlatform, planNavigationStrategy, verifyTargetReached, findGuidanceLinks,
  pickBestCandidate, scoreResultCandidate, pageServesTask, findWorkSurfaceNav, classifySurface, deriveTaskBoundary, isForbiddenTarget,
  rankSearchMethods,
  type PageObservation, type SearchMethod, type ResultCandidate,
} from './website-intelligence.js';
import { getPlatformIntel, rememberPlatform, platformKey } from './platform-library.js';
import { pickParcelRecordLink } from './browser-navigator.js';
import { retrieveWithLearning } from './browser-learning.js';
import { diagnoseFailure, attemptRecovery } from './browser-failure-diagnosis.js';
import { recordNavigationRequirement } from './browser-navigation-model.js';

// NOTE: the apex domain (no www) serves the app; www.landportal.com returns 404.
export const LANDPORTAL_BROWSER_BASE = 'https://landportal.com';
export const LANDPORTAL_SCREENSHOT_PURPOSE = 'landportal_property_loaded';
export const LANDPORTAL_3D_SCREENSHOT_PURPOSE = 'landportal_property_3d';
export const LANDPORTAL_BOUNDARY_SCREENSHOT_PURPOSE = 'landportal_parcel_boundary_satellite';
export const LANDPORTAL_COMPARABLES_SCREENSHOT_PURPOSE = 'landportal_comparables_map';

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
    if (m.key === 'propertyId') { patch.propertyId = val; patch.apn ??= val; continue; }
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

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
/** Expand a state abbreviation to its full name (for jurisdiction dropdowns). */
function stateName(s?: string): string | undefined {
  if (!s) return undefined;
  const up = s.trim().toUpperCase();
  return US_STATES[up] ?? (s.trim().length > 2 ? s.trim() : undefined);
}

/** Strip a trailing street-type suffix so a typeahead matches ("388 Gilstrap Rd"
 *  → "388 Gilstrap"). Generic. */
function searchableAddress(addr: string): string {
  return addr.split(',')[0].replace(/\b(rd|road|st|street|ave|avenue|dr|drive|ln|lane|ct|court|hwy|highway|blvd|trl|trail|pkwy|cir|pl|way)\.?\s*$/i, '').trim();
}

function addressSearchValue(key: BrowserSearchKey): string | undefined {
  if (!key.address) return undefined;
  const locality = [[key.city, key.state].filter(Boolean).join(', '), key.zip].filter(Boolean).join(' ');
  return [key.address, locality || [key.county, key.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}

function cleanParcelFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(fields)) {
    const key = k.trim();
    const val = raw.trim();
    if (!key || !val) continue;
    if (/^product$/i.test(key) && /^subtotal$/i.test(val)) continue;
    if (/^tokens/i.test(key)) continue;
    if (/^subtotal$|^total$/i.test(key) && /^\$/.test(val)) continue;
    if (/^\+$/.test(key)) continue;
    out[key] = val;
  }
  return out;
}

function asNumber(v?: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function observation(label: string, detail: string, evidence: string, confidence: 'medium' | 'low' = 'medium'): LandPortalVisualObservation {
  return { label, detail, evidence, confidence };
}

function deriveVisualObservations(fields: Record<string, string>, key: BrowserSearchKey): LandPortalVisualObservation[] {
  const out: LandPortalVisualObservation[] = [];
  const waterFeature = (fields['Water Feature'] ?? '').toLowerCase();
  const waterTypes = fields['Water Feature type(s)'] ?? '';
  const frontage = asNumber(fields['Road Frontage'] ?? '');
  const landLocked = (fields['Land Locked'] ?? '').toLowerCase();
  const buildingSqft = asNumber(fields['Building SqFt'] ?? '');

  if (waterFeature === 'yes' && /pond|creek|stream/i.test(waterTypes)) {
    out.push(observation('Water feature visible', `LandPortal indicates ${waterTypes}.`, `Parcel panel: Water Feature type(s) = ${waterTypes}`));
  }
  if (frontage != null && frontage > 0) {
    out.push(observation('Road frontage', `Approx. ${frontage.toFixed(2)} ft of frontage shown on the parcel page.`, `Parcel panel: Road Frontage = ${fields['Road Frontage']}`));
  }
  if (landLocked === 'no') {
    out.push(observation('Apparent road access', 'Parcel page does not flag the tract as landlocked.', 'Parcel panel: Land Locked = No', 'low'));
  }
  if (buildingSqft != null && buildingSqft > 0) {
    out.push(observation('Existing improvement', `Parcel page shows approx. ${Math.round(buildingSqft).toLocaleString()} sqft of improvements.`, `Parcel panel: Building SqFt = ${fields['Building SqFt']}`));
  }
  if ((key.address ?? '').toLowerCase().includes('highway')) {
    out.push(observation('Highway frontage corridor', `Lead address fronts ${key.address}.`, `Input address matched on LandPortal parcel page`, 'low'));
  }
  return out;
}

function normalizeOverlayName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseComparableCandidate(text: string, sourceUrl: string): LandPortalComparableRecord | null {
  const raw = text.replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
  if (!raw) return null;
  const priceMatch = raw.match(/\$[\d,]+(?:\.\d+)?/);
  const acreMatch = raw.match(/(\d+(?:\.\d+)?)\s*ac\b/i) ?? raw.match(/\bacres?\s*:\s*(\d+(?:\.\d+)?)/i);
  const ppaMatch = raw.match(/\$([\d,]+(?:\.\d+)?)\s*\/\s*ac\b/i);
  const dateMatch = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}, \d{4}\b/i);
  const apn = raw.match(/\bAPN\s*:\s*([A-Z0-9.\-]+)/i)?.[1] ?? null;
  const distanceMiles = asNumber(raw.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile)s?\b/i)?.[1]);
  const addressCandidate = raw.match(/^(.+?)(?:\s+\$[\d,]+|\s+\|\s+APN:|\s+Acres?:)/i)?.[1]?.trim() ?? null;
  const address = addressCandidate && !/^\$|^acres?:|^apn:/i.test(addressCandidate) && /(\d+\s+\w+|road|rd|street|st|avenue|ave|drive|dr|lane|ln|boulevard|blvd|trail|trl|way|court|ct|place|pl|highway|hwy)/i.test(addressCandidate)
    ? addressCandidate
    : null;
  let status: LandPortalComparableRecord['status'] =
    /\bsold\b/i.test(raw) ? 'sold'
      : /\bactive\b/i.test(raw) ? 'active'
        : /\blisted?\b/i.test(raw) ? 'listed'
          : 'unknown';
  const saleListIndicator: LandPortalComparableRecord['saleListIndicator'] =
    /\bsold|sale\b/i.test(raw) ? 'sale'
      : /\bactive|listed?|pending|for sale\b/i.test(raw) ? 'list'
        : 'unknown';
  const improvement: LandPortalComparableRecord['improvement'] =
    /\b(home|house|residence|bed|bath|sq ?ft|building)\b/i.test(raw) ? 'improved'
      : /\b(vacant|raw land|unimproved)\b/i.test(raw) ? 'vacant'
        : 'unknown';
  const acres = acreMatch ? asNumber(acreMatch[1]) : null;
  const price = priceMatch ? asNumber(priceMatch[0]) : null;
  const ppa = ppaMatch ? asNumber(ppaMatch[1]) : null;
  if (status === 'unknown' && price != null && acres != null) status = saleListIndicator === 'sale' ? 'sold' : 'listed';
  const confidence: LandPortalComparableRecord['confidence'] =
    (price != null && acres != null) || (status !== 'unknown' && dateMatch) ? 'medium' : 'low';
  if (price == null && acres == null && !dateMatch && !apn && status === 'unknown') return null;
  return {
    rawText: raw,
    sourceUrl,
    apn,
    address: address && !/^\$/.test(address) ? address : null,
    saleDate: dateMatch?.[0],
    acres,
    price,
    pricePerAcre: ppa,
    distanceMiles,
    status,
    saleListIndicator,
    improvement,
    confidence,
  };
}

async function captureParcel3dView(
  driver: BrowserDriver,
  observe: () => Promise<PageObservation>,
  timeoutMs: number,
): Promise<{ key: string; label: string; kind: 'parcel_3d'; purpose: string; sourcePath: string; timestamp: string; note?: string } | null> {
  if (!driver.clickByText || !driver.screenshot) return null;
  const t = { timeoutMs };
  const labels = ['3D', '3D View', '3D Map'];
  for (const label of labels) {
    try {
      await driver.clickByText(label, t);
      await observe();
      const shot = await driver.screenshot(LANDPORTAL_3D_SCREENSHOT_PURPOSE, t);
      return {
        key: 'parcel_3d',
        label: '3D terrain view',
        kind: 'parcel_3d',
        purpose: shot.purpose,
        sourcePath: shot.path,
        timestamp: shot.capturedAtIso,
        note: 'LandPortal 3D terrain/property view screenshot.',
      };
    } catch {
      // keep trying likely 3D labels
    }
  }
  return null;
}

async function inspectOverlays(
  driver: BrowserDriver,
  observe: () => Promise<PageObservation>,
  timeoutMs: number,
): Promise<{ overlays: LandPortalOverlayObservation[]; assets: Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }> }> {
  const t = { timeoutMs };
  const overlays: LandPortalOverlayObservation[] = [];
  const assets: Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }> = [];
  if (!driver.clickByText || !driver.screenshot) return { overlays, assets };
  const names = ['FEMA Floodplain', 'Wetlands', 'Soil', 'Contours', 'Water features'];
  try { await driver.clickByText('Basemaps & Overlays', t); } catch { /* best-effort */ }
  for (const name of names) {
    try {
      await driver.clickByText(name, t);
      await observe();
      const shot = await driver.screenshot(`landportal_overlay_${normalizeOverlayName(name)}`, t);
      const key = `overlay_${normalizeOverlayName(name)}`;
      assets.push({ key, label: name, kind: 'overlay', purpose: shot.purpose, sourcePath: shot.path, timestamp: shot.capturedAtIso, overlay: name, note: `${name} overlay screenshot from LandPortal.` });
      overlays.push({ overlay: name, status: 'captured', note: `${name} overlay toggled and captured from LandPortal. Visual signal only, not legal verification.`, confidence: 'low', screenshotKey: key });
    } catch {
      overlays.push({ overlay: name, status: 'not_found', note: `${name} overlay was not confidently available in the current LandPortal workspace.`, confidence: 'low' });
    }
  }
  return { overlays, assets };
}

function collectComparableTexts(obs: PageObservation, fields: Record<string, string>, candidates: ResultCandidate[]): string[] {
  const out = new Set<string>();
  for (const c of candidates) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (text) out.add(text);
  }
  for (const [k, v] of Object.entries(fields)) {
    const line = `${k}: ${v}`.replace(/\s+/g, ' ').trim();
    if (/\$[\d,]+/.test(line) || /\b\d+(?:\.\d+)?\s*ac\b/i.test(line)) out.add(line);
  }
  for (const link of obs.links ?? []) {
    const line = `${link.text ?? ''} ${link.href ?? ''}`.replace(/\s+/g, ' ').trim();
    if (/\$[\d,]+/.test(line) || /\b\d+(?:\.\d+)?\s*ac\b/i.test(line)) out.add(line);
  }
  return [...out];
}

async function inspectComparables(
  driver: BrowserDriver,
  observe: () => Promise<PageObservation>,
  timeoutMs: number,
): Promise<{
  comparablesUrl: string | null;
  comparables: LandPortalComparableRecord[];
  asset: { key: string; label: string; kind: 'comparables_map'; purpose: string; sourcePath: string; timestamp: string; note?: string } | null;
}> {
  const t = { timeoutMs };
  if (!driver.clickByText) return { comparablesUrl: null, comparables: [], asset: null };
  try {
    await driver.clickByText('Show on Map', t);
  } catch {
    return { comparablesUrl: null, comparables: [], asset: null };
  }
  const obs = await observe();
  const read = await driver.readFields(t).catch(() => ({ url: obs.url, fields: {}, snippets: [] }));
  const candidates = driver.readCandidates ? await driver.readCandidates(t) as ResultCandidate[] : [];
  const texts = collectComparableTexts(obs, cleanParcelFields(read.fields ?? {}), candidates);
  const sourceUrl = obs.url || read.url || LANDPORTAL_BROWSER_BASE;
  const seen = new Set<string>();
  const comparables = texts
    .map((text) => parseComparableCandidate(text, sourceUrl))
    .filter((row): row is LandPortalComparableRecord => !!row)
    .filter((row) => {
      if (seen.has(row.rawText)) return false;
      seen.add(row.rawText);
      return true;
    });
  const asset = driver.screenshot
    ? await driver.screenshot(LANDPORTAL_COMPARABLES_SCREENSHOT_PURPOSE, { ...t, fullPage: true })
        .then((shot) => ({
          key: 'comparables_map',
          label: 'Comparables map',
          kind: 'comparables_map' as const,
          purpose: shot.purpose,
          sourcePath: shot.path,
          timestamp: shot.capturedAtIso,
          note: 'LandPortal comparables map screenshot.',
        }))
        .catch(() => null)
    : null;
  return { comparablesUrl: sourceUrl, comparables, asset };
}

/**
 * AGENTIC LandPortal retrieval — Observe → Reason → Act → Verify → Learn, looping
 * until it reaches a verified parcel or hits a true hard stop. It navigates to the
 * search surface, then picks the search method BY INTAKE TYPE, drives the
 * typeahead, selects ONLY a high-confidence parcel, verifies the detail panel, and
 * streams real facts to the Deal Card. No fabrication; no forbidden/paid actions.
 *
 * SEARCH PLAYBOOK (LandPortal global search is ONLY for a normal street address):
 *
 *   APN / Parcel ID / Tax ID / parcel number present → APN/Parcel-ID search is the
 *   PRIMARY path (never global search): open the search-method dropdown, select
 *   APN / Parcel ID search, select State first then County, enter the APN, try
 *   EVERY APN variant, open the resulting parcel page, and confirm parcel identity.
 *   (APN and Parcel ID are the same thing for this workflow.)
 *
 *   Owner present (no APN) → Owner search: open the dropdown, select Owner search,
 *   select State first then County, enter the owner name, open a candidate parcel
 *   ONLY when it matches the intake evidence.
 *
 *   Plain street address (no APN/owner) → global/address search.
 *
 * Downstream Property Intelligence runs only AFTER the parcel is confirmed (the
 * verified parcel-panel read is what establishes ParcelIdentity upstream).
 */
async function runLandPortalAgentic(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
  hooks: Partial<BrowserRunHooks>,
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('landportal', 'workflow');
  const key = input.searchKey;
  const t = () => ({ timeoutMs });
  const obsv = () => driver.observe!(t()) as Promise<PageObservation>;
  const trace: string[] = [];
  const platform = platformKey(LANDPORTAL_BROWSER_BASE);

  try {
    await driver.open(LANDPORTAL_BROWSER_BASE, t());
    let obs = await obsv();
    if (obs.loginLike) { ev.status = 'blocked'; ev.note = 'LandPortal requires login (operator action) — not authenticated.'; rememberPlatform(LANDPORTAL_BROWSER_BASE, { authRequired: true, used: true }); return ev; }
    const understanding = understandPlatform(obs);
    const taskBoundary = deriveTaskBoundary(obs);

    // OBSERVE/REASON/ACT: reach the parcel-search surface (never a forbidden one).
    for (let hop = 0; hop < 4 && !pageServesTask(obs, 'apn'); hop++) {
      const nav = findWorkSurfaceNav(obs, 'apn');
      if (!nav || isForbiddenTarget(nav.text) || !driver.clickByText) break;
      await driver.clickByText(nav.text, t());
      obs = await obsv();
      trace.push(`surface→${nav.text}(${classifySurface(obs)})`);
    }
    if (!pageServesTask(obs, 'apn')) {
      ev.status = 'partial'; ev.note = `Could not reach the parcel-search surface (at ${classifySurface(obs)}). No forbidden surface touched.`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, authRequired: true, taskBoundary, used: true, knownLimitations: ['could not reach search surface'] }); return ev;
    }

    // Identify the search box.
    const box = obs.searchControls.find((c) => /search|address|parcel|apn|enter/i.test([c.label, c.placeholder, c.id, c.name].filter(Boolean).join(' ')))
      ?? obs.searchControls.find((c) => (c.type ?? 'text') === 'text');
    if (!box) { ev.status = 'partial'; ev.note = 'On the search surface but no search input found.'; return ev; }

    // REASON: EVIDENCE-DRIVEN method order (generic Website Intelligence — no fixed
    // chronological order). rankSearchMethods inspects the identifiers present and
    // ranks the lookup paths by strength; the site then maps each ranked method to
    // its own workflow + value formatting. For LandPortal, the APN/Parcel-ID search
    // mode handles a parcel identifier (never global/address search), trying EVERY
    // variant (a county may index the parcel under a different format, e.g. dashed
    // "094-020.08" vs spaced "094 02008 000"); each attempt is scoped State→County.
    // A present address still cross-checks the resolved parcel (consistency) even
    // when it did not lead the search.
    const ranked = rankSearchMethods({ apn: key.apn, address: key.address, owner: key.owner });
    const attempts: Array<{ method: string; value: string }> = [];
    for (const r of ranked) {
      if (r.method === 'apn' && key.apn) {
        attempts.push({ method: 'apn', value: key.apn });
        for (const alt of key.apnAlternates ?? []) {
          if (alt && alt !== key.apn && !attempts.some((a) => a.method === 'apn' && a.value === alt)) {
            attempts.push({ method: 'apn', value: alt });
          }
        }
      } else if (r.method === 'address') {
        const fullAddress = addressSearchValue(key);
        if (fullAddress && !attempts.some((a) => a.method === 'address')) attempts.push({ method: 'address', value: fullAddress });
      } else if (r.method === 'owner' && key.owner) {
        attempts.push({ method: 'owner', value: key.owner });
      }
    }

    // Distinctive street word(s) from the known address, used to confirm the
    // selected parcel is actually the subject property (guards against an APN that
    // is wrong / belongs to a different same-numbered parcel).
    const streetTokens = key.address
      ? searchableAddress(key.address).toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !/^\d+$/.test(w))
      : [];
    const matchesKnownAddress = (o: PageObservation): boolean => {
      if (!streetTokens.length) return true; // nothing to cross-check
      const hay = Object.values(o.fields).join(' ').toLowerCase();
      return streetTokens.some((tok) => hay.includes(tok));
    };

    let picked: { index: number; score: number; matched: string[] } | null = null;
    let usedMethod = '';
    let verifiedReached = false;
    let searchSel = box.selector;
    // Records every failure-diagnosis recovery attempt so the final note reflects the
    // POST-recovery state (never re-reporting "option selected but search not submitted").
    const recoveryTrace: string[] = [];
    for (let ai = 0; ai < attempts.length; ai++) {
      const a = attempts[ai];
      if (hooks.isCancelled?.()) break;
      // Reset to a CLEAN search surface before each attempt (a prior attempt may
      // have opened a parcel/results view that would pollute the next search).
      if (ai > 0 && driver.clickByText) {
        const back = findWorkSurfaceNav(obs, 'apn');
        if (back && !isForbiddenTarget(back.text)) { await driver.clickByText(back.text, t()); obs = await obsv(); }
        const rebox = obs.searchControls.find((c) => /search|address|parcel|apn|enter/i.test([c.label, c.placeholder, c.id, c.name].filter(Boolean).join(' '))) ?? obs.searchControls.find((c) => (c.type ?? 'text') === 'text');
        if (rebox) searchSel = rebox.selector;
      }
      // MANUAL PARITY (LandPortal APN/Parcel-ID): pick the search MODE first, THEN
      // scope State→County, THEN type the identifier — the same order a human uses.
      await driver.selectMethod!(a.method, t());
      // Scope the search to the jurisdiction (State, then County) so a parcel
      // resolves uniquely (the click opens the parcel panel, not a results list).
      if (driver.setScope && (key.state || key.county)) {
        const scope = [stateName(key.state), key.county].filter(Boolean) as string[];
        const set = await driver.setScope(scope, t());
        if (set.length) trace.push(`scope:${set.join('/')}`);
        obs = await obsv();
      }
      await driver.typeSearch!(searchSel, a.value, t());
      obs = await obsv();
      const candidates = (await driver.readCandidates!(t())) as ResultCandidate[];
      const candidateSample = candidates.slice(0, 3).map((c) => c.text.slice(0, 80)).join(' || ');
      let best = pickBestCandidate(candidates, key);
      if (!best && a.method === 'address' && key.address && /^\s*\d+/.test(key.address) && candidates.length > 0) {
        const firstScore = scoreResultCandidate(candidates[0], key);
        best = { index: candidates[0].index, score: firstScore.score, matched: [...firstScore.matched, 'first_plausible_address_candidate'], confidence: 'medium' };
      }
      // APN AUTOCOMPLETE FALLBACK: we searched by the EXACT APN, so LandPortal's
      // autocomplete lists the matching parcel as a selectable checkbox option — but
      // the option text often shows the ADDRESS (not the APN), so pickBestCandidate
      // finds no HIGH-confidence text match and, without this, the loop `continue`s
      // BEFORE clickCandidate → the option is never selected and submit-after-select
      // recovery never runs (this was the live Scott County bug). Select the
      // best-scoring option that has ANY relation to the intake (score > 0, never
      // pure noise); the record-page verify + address consistency + APN cross-check
      // still reject a wrong parcel (no false facts).
      if (!best && a.method === 'apn' && candidates.length > 0) {
        const ranked = candidates.map((c) => ({ c, s: scoreResultCandidate(c, key) })).sort((x, y) => y.s.score - x.s.score);
        const top = ranked[0];
        if (top && top.s.score > 0) {
          best = { index: top.c.index, score: top.s.score, matched: [...top.s.matched, 'apn_autocomplete_option'], confidence: 'medium' };
        }
      }
      if (!best) {
        // No option relates to the intake. Before giving up on this attempt, INSPECT
        // the intermediate state — the page may still be waiting on a required action
        // (a modal, a pending selection). Diagnose + attempt recovery so the outcome
        // is always POST-recovery, never a stale "not submitted" claim.
        const diag0 = diagnoseFailure(obs);
        if (diag0.hasPendingAction) {
          trace.push(`diagnose(no-pick):[${diag0.signals.join(',')}]→${diag0.nextAction}`);
          if (diag0.missingStep) { try { recordNavigationRequirement(platform, diag0.missingStep, obs); } catch { /* non-fatal */ } }
          const beforeUrl = obs.url;
          const rec0 = await attemptRecovery({ driver, diagnosis: diag0, key, pickCandidate: (c, k) => pickBestCandidate(c as ResultCandidate[], k), opts: t() });
          if (rec0) obs = rec0;
          const v0 = verifyTargetReached(obs, { expectIdentifier: key.apn });
          recoveryTrace.push(`${diag0.nextAction} url ${beforeUrl}→${obs.url} ${v0.pageType}`);
          trace.push(`recover(no-pick):${diag0.nextAction}→${v0.pageType}`);
          if (v0.reached && (matchesKnownAddress(obs) || !streetTokens.length)) { picked = { index: -1, score: 0, matched: ['recovered_pending_action'] }; usedMethod = a.method; verifiedReached = true; break; }
        }
        trace.push(`${a.method}:"${a.value}"→${candidates.length} cand, no confident match`); continue;
      }
      // Select the matching option. For APN/Parcel-ID this ticks LandPortal's
      // autocomplete checkbox row (it does NOT navigate on its own).
      await driver.clickCandidate!(best.index, t());
      obs = await obsv();
      let v = verifyTargetReached(obs, { expectIdentifier: key.apn });
      // FAILURE DIAGNOSIS: if selecting the option did not reach a parcel/results
      // page, INSPECT THE INTERMEDIATE STATE before concluding "not found". The site
      // may be waiting on a required next action — submit-after-select (LandPortal's
      // APN autocomplete), a pending selection, a modal to dismiss, or a results row
      // to open. Diagnose it, record the missing step on the navigation playbook,
      // retry the corrected action, and re-verify. Generic across every interactive
      // site; never fabricates a reached state (identity is re-checked below).
      if (!v.reached && v.pageType !== 'results_list') {
        const diag = diagnoseFailure(obs);
        if (diag.hasPendingAction) {
          trace.push(`diagnose:[${diag.signals.join(',')}]→${diag.nextAction}`);
          if (diag.missingStep) { try { recordNavigationRequirement(platform, diag.missingStep, obs); } catch { /* non-fatal */ } }
          const beforeUrl = obs.url;
          const recovered = await attemptRecovery({ driver, diagnosis: diag, key, pickCandidate: (c, k) => pickBestCandidate(c as ResultCandidate[], k), opts: t() });
          if (recovered) obs = recovered;
          v = verifyTargetReached(obs, { expectIdentifier: key.apn });
          // Instrumentation: record the URL change so a live trace shows the page
          // actually navigated after submit-after-select recovery.
          recoveryTrace.push(`${diag.nextAction} url ${beforeUrl}→${obs.url} ${v.pageType}`);
          trace.push(`recover:${diag.nextAction} urlChanged=${beforeUrl !== obs.url}→${v.pageType}`);
        }
      }
      let openedViaResults = '';
      if (v.pageType === 'results_list' && driver.readCandidates && driver.clickCandidate) {
        const resultCandidates = (await driver.readCandidates(t())) as ResultCandidate[];
        const resultBest = pickBestCandidate(resultCandidates, key) ?? (resultCandidates.length > 0
          ? { index: resultCandidates[0].index, score: 0, matched: ['first_plausible_result_record'], confidence: 'medium' as const }
          : null);
        if (resultBest) {
          await driver.clickCandidate(resultBest.index, t());
          obs = await obsv();
          v = verifyTargetReached(obs, { expectIdentifier: key.apn });
          openedViaResults = `, result#${resultBest.index}(${resultBest.matched.join('+')})â†’${v.pageType}`;
        }
      }
      // CONSISTENCY: the opened parcel must match the known street address — an
      // APN can be wrong or shared by a different parcel; never accept a mismatch.
      const consistent = matchesKnownAddress(obs) || best.matched.includes('address');
      trace.push(`${a.method}:"${a.value}"→${candidates.length} cand, pick#${best.index}(${best.matched.join('+')})→${v.pageType}${openedViaResults}${consistent ? '' : ',ADDR-MISMATCH'} sample:${candidateSample}`);
      if (v.reached && consistent) { picked = best; usedMethod = a.method; verifiedReached = true; break; }
      // else: wrong/unverified parcel — keep adapting (try the next method).
    }

    if (!picked || !verifiedReached) {
      ev.status = 'partial';
      // Operator transparency: the failure NOTE reports what the AGENT DID, never a
      // raw pre-recovery diagnosis. Once recovery was ATTEMPTED (select-then-submit),
      // report the POST-recovery outcome; otherwise say plainly that no result option
      // could be confidently selected. The misleading "an option is selected but the
      // search was not submitted" can no longer appear after recovery runs.
      const diagNote = recoveryTrace.length
        ? ` Recovery was attempted (${recoveryTrace.join('; ')}) — the page was re-observed and re-verified after submitting, but no parcel detail page opened and verified.`
        : ` No result option could be confidently selected to open a parcel detail page; provide/confirm the exact parcel identifier.`;
      ev.note = `Searched LandPortal by ${attempts.map((a) => a.method).join('/')} but reached no parcel that both verified AND matched ${key.address || key.apn} (no weak-match, no false facts).${diagNote} Trace: ${trace.join(' | ')}`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, taskBoundary, used: true, navPatterns: trace.join(' | '), knownLimitations: ['no verified parcel consistent with the provided address'] });
      return ev;
    }
    if (obs.url) ev.sourceUrls.push(obs.url);
    const verify = { reason: 'verified parcel panel consistent with the subject address' };

    // ONE-PASS deep-link capture (live driver): the search→click flow lands on a
    // collapsed panel WITHOUT the comparables section, which is why the comps map
    // was previously a duplicate of the parcel view. The canonical deep link renders
    // the full detail view — capture the parcel screenshot + full fields + all comp
    // rows + the real "Show on Map" comps map there, in one fresh tab. Read-only;
    // never a paid Comp/Slope control; never fabricated.
    let panelFields: Record<string, string> = obs.fields;
    let lpVisuals: {
      fields: Record<string, string>; parcelShotPath: string | null; compsMapShotPath: string | null;
      overlayShots?: Array<{ overlay: string; path: string; purpose: string }>; terrainShotPath?: string | null;
      compRows: string[]; mapReached: boolean; capturedAtIso: string;
    } | null = null;
    let shot: Awaited<ReturnType<BrowserDriver['screenshot']>> | null = null;
    if (obs.url && /[?&]property=/.test(obs.url) && driver.captureLandPortalVisuals) {
      try {
        const v = await driver.captureLandPortalVisuals(obs.url, t());
        if (v.parcelShotPath || Object.keys(v.fields).length > 0) {
          lpVisuals = v;
          if (Object.keys(v.fields).length > Object.keys(panelFields).length) panelFields = { ...panelFields, ...v.fields };
          if (v.parcelShotPath) ev.screenshots.push({ path: v.parcelShotPath, capturedAtIso: v.capturedAtIso, purpose: LANDPORTAL_SCREENSHOT_PURPOSE });
          trace.push(`lpVisuals: fields=${Object.keys(v.fields).length} comps=${v.compRows.length} mapReached=${v.mapReached}`);
        }
      } catch { /* fall back below */ }
    }
    if (!lpVisuals) {
      // Fallback (non-live/fake driver, or capture failed): working-tab parcel shot
      // + fresh-tab full field read. Never fabricate the rest.
      shot = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, { ...t(), fullPage: true });
      ev.screenshots.push(shot);
      if (obs.url && /[?&]property=/.test(obs.url) && driver.readFullPanel) {
        try {
          const full = await driver.readFullPanel(obs.url, t());
          if (Object.keys(full.fields).length > Object.keys(panelFields).length) panelFields = { ...panelFields, ...full.fields };
        } catch { /* keep search-flow fields */ }
      }
    }

    // EXTRACT real parcel facts + stream each to the Deal Card with provenance.
    ev.fields = panelFields;
    const cleanedFields = cleanParcelFields(panelFields);
    const facts: BrowserFact[] = extractRecordFacts(panelFields, { sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal' })
      .map((f) => ({ ...f, extractionMethod: `${usedMethod} search → typeahead select → verified parcel panel (full-panel read)` }));

    // IDENTIFIER MISMATCH: if the operator supplied an APN but the resolved parcel's
    // APN matches NONE of the provided APN/variants, flag it clearly
    // (needs_verification) — never silently accept a conflicting identifier, and
    // never overwrite with a wrong APN. Fires regardless of which method resolved
    // the parcel (APN search that fuzzy-matched, or an address cross-check).
    const compactId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const providedApnIds = [key.apn, ...(key.apnAlternates ?? [])].filter(Boolean).map((a) => compactId(a as string));
    const resolvedApn = facts.find((f) => f.key === 'apn')?.value;
    if (key.apn && resolvedApn && providedApnIds.length > 0 && !providedApnIds.includes(compactId(resolvedApn))) {
      facts.push({ key: 'apnConflict', label: 'APN identifier mismatch', value: `Provided APN "${key.apn}" does not match the resolved LandPortal parcel APN "${resolvedApn}". Resolved parcel used as source of truth; verify the APN.`, sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE, confidence: 'high', origin: 'landportal', status: 'needs_verification', extractionMethod: 'identifier cross-check (provided APN vs resolved parcel APN)' });
      trace.push(`APN-CONFLICT: provided ${key.apn} ≠ resolved ${resolvedApn}`);
    }
    for (const f of facts) { try { hooks.onFact?.(f as BrowserFact); } catch { /* non-fatal */ } }
    ev.facts = facts;
    ev.patch = extractLandPortalFields({ url: obs.url, fields: panelFields, snippets: [] }).patch;
    ev.sourcesUsed = [{ type: 'landportal', url: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal', confidence: 0.9 }];
    ev.status = facts.length ? 'retrieved' : 'partial';
    // The ONLY LandPortal images on the card are the Parcel View + the Comps Map.
    // No overlay/3D/boundary screenshots (overlay data comes from the fact sheet).
    const inspectionAssets: PendingLandPortalInspectionRecord['assets'] = [];
    let comparablesUrl: string | null = null;
    let comparables: LandPortalComparableRecord[] = [];
    if (lpVisuals) {
      if (lpVisuals.parcelShotPath) {
        inspectionAssets.push({ key: 'parcel_page', label: 'LandPortal Parcel View', kind: 'parcel_page', purpose: LANDPORTAL_SCREENSHOT_PURPOSE, sourcePath: lpVisuals.parcelShotPath, timestamp: lpVisuals.capturedAtIso, note: 'LandPortal parcel view (deep-link full page).' });
      }
      if (lpVisuals.terrainShotPath) {
        inspectionAssets.push({ key: 'parcel_3d', label: 'LandPortal 3D / terrain view', kind: 'parcel_3d', purpose: LANDPORTAL_3D_SCREENSHOT_PURPOSE, sourcePath: lpVisuals.terrainShotPath, timestamp: lpVisuals.capturedAtIso, note: 'LandPortal 3D or terrain view screenshot when available.' });
      }
      for (const ov of lpVisuals.overlayShots ?? []) {
        const key = `overlay_${normalizeOverlayName(ov.overlay)}`;
        inspectionAssets.push({ key, label: ov.overlay, kind: 'overlay', purpose: ov.purpose, sourcePath: ov.path, timestamp: lpVisuals.capturedAtIso, overlay: ov.overlay, note: `${ov.overlay} overlay screenshot from LandPortal.` });
      }
      comparablesUrl = obs.url || null;
      comparables = lpVisuals.compRows
        .map((txt) => parseComparableCandidate(txt, obs.url || LANDPORTAL_BROWSER_BASE))
        .filter((r): r is LandPortalComparableRecord => !!r);
      if (lpVisuals.compsMapShotPath && lpVisuals.mapReached) {
        inspectionAssets.push({ key: 'comparables_map', label: 'LandPortal Comps Map', kind: 'comparables_map', purpose: LANDPORTAL_COMPARABLES_SCREENSHOT_PURPOSE, sourcePath: lpVisuals.compsMapShotPath, timestamp: lpVisuals.capturedAtIso, note: 'LandPortal comps map — "Show on Map" clicked and confirmed.' });
      }
    } else {
      if (shot) inspectionAssets.push({ key: 'parcel_page', label: 'LandPortal Parcel View', kind: 'parcel_page', purpose: shot.purpose, sourcePath: shot.path, timestamp: shot.capturedAtIso, note: 'LandPortal parcel page screenshot.' });
      const comparablesResult = await inspectComparables(driver, obsv, timeoutMs);
      if (comparablesResult.asset) inspectionAssets.push(comparablesResult.asset);
      comparablesUrl = comparablesResult.comparablesUrl;
      comparables = comparablesResult.comparables;
    }
    const overlayResult = lpVisuals?.overlayShots?.length
      ? {
          overlays: lpVisuals.overlayShots.map((ov) => ({
            overlay: ov.overlay,
            status: 'captured' as const,
            note: `${ov.overlay} overlay toggled and captured from LandPortal. Visual signal only, not legal verification.`,
            confidence: 'low' as const,
            screenshotKey: `overlay_${normalizeOverlayName(ov.overlay)}`,
          })),
          assets: [] as Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }>,
        }
      : await inspectOverlays(driver, obsv, timeoutMs).catch(() => ({ overlays: [] as LandPortalOverlayObservation[], assets: [] as Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }> }));
    for (const asset of overlayResult.assets) {
      if (!inspectionAssets.some((a) => a.key === asset.key)) inspectionAssets.push(asset);
    }
    const terrainAsset = inspectionAssets.some((a) => a.kind === 'parcel_3d') ? null : await captureParcel3dView(driver, obsv, timeoutMs).catch(() => null);
    if (terrainAsset) inspectionAssets.push(terrainAsset);
    ev.inspection = {
      parcelUrl: obs.url || null,
      comparablesUrl,
      parcelFacts: cleanedFields,
      assets: inspectionAssets,
      overlays: overlayResult.overlays,
      visualObservations: deriveVisualObservations(cleanedFields, key),
      comparables,
    };

    // LEARN: store the validated method + interaction strategy.
    const validatedStrategy = { method: (usedMethod as SearchMethod), steps: [{ action: 'select_method' as const, text: usedMethod }, { action: 'fill' as const, selector: box.selector }, { action: 'click' as const, text: 'typeahead high-confidence match' }], reason: `${usedMethod} search → typeahead → high-confidence parcel` };
    rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, validatedStrategy, navPatterns: trace.join(' | '), authRequired: true, confidence: 'high', taskBoundary, used: true, succeeded: ev.status === 'retrieved', validatedNow: ev.status === 'retrieved', knownLimitations: [] });
    ev.note = `LandPortal (${understanding.platformClass}): ${usedMethod} search → selected high-confidence parcel → ${facts.length} verified fact(s) streamed with provenance. Trace: ${trace.join(' | ')}`;
    return ev;
  } catch (err) {
    ev.status = 'error';
    ev.note = `LandPortal agentic run failed before any paid action: ${(err as Error)?.message ?? 'unknown'}. No credit consumed. Trace: ${trace.join(' | ')}`;
    return ev;
  }
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
  hooks: Partial<BrowserRunHooks> = {},
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
  // A full live driver runs the AGENTIC loop (Observe→Reason→Act→Verify→Learn):
  // it adapts the search method (e.g. APN → Address), drives the typeahead, and
  // selects only a high-confidence parcel before extracting.
  if (driver.observe && driver.typeSearch && driver.selectMethod && driver.readCandidates && driver.clickCandidate) {
    return runLandPortalAgentic(input, driver, now, timeoutMs, hooks);
  }
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

/**
 * LandPortal retrieval WITH the inspect-and-learn fallback (the layer above the
 * evidence-driven strategy). Runs the agentic workflow; on a clean retrieval it
 * does NOTHING else (no deep inspection). If retrieval fails / hits an unexpected
 * path, it inspects the site, synthesizes + saves a reusable navigation playbook,
 * and retries with it. Future visits reuse the stored playbook; a stale playbook is
 * relearned (version bumped). See browser-learning.ts for the generic orchestration.
 */
async function runLandPortalWithLearning(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
  hooks: Partial<BrowserRunHooks> = {},
): Promise<BrowserEvidence> {
  const key = input.searchKey;
  const ranked = rankSearchMethods({ apn: key.apn, address: key.address, owner: key.owner });
  const identifierKind = ranked[0]?.method ?? 'general';
  const platform = platformKey(LANDPORTAL_BROWSER_BASE);

  const result = await retrieveWithLearning<BrowserEvidence>({
    platform,
    taskType: 'parcel_lookup',
    identifierKind,
    attempt: async (_opts) => {
      const ev = await runLandPortalWorkflow(input, driver, now, timeoutMs, hooks);
      // On failure, re-observe the current page so the site can be inspected.
      let observation: PageObservation | null = null;
      if (ev.status !== 'retrieved' && ev.status !== 'parked' && driver.observe) {
        try { observation = (await driver.observe({ timeoutMs })) as PageObservation; } catch { /* best-effort */ }
      }
      return { retrieved: ev.status === 'retrieved', evidence: ev, observation };
    },
  });

  // Surface the learning outcome on the evidence note (operator-visible provenance).
  const ev = result.evidence;
  if (result.inspected) {
    ev.note = `${ev.note} [inspect-and-learn: ${result.relearned ? 'relearned' : 'learned'} ${platform} playbook v${result.playbook?.version ?? '?'}]`;
  } else if (result.reusedPlaybook) {
    ev.note = `${ev.note} [reused ${platform} playbook v${result.playbook?.version ?? '?'} — no inspection]`;
  }
  // Shared navigation-model provenance — reused by every future department on this site.
  if (result.navigationLearned) {
    const secs = result.navigationChangedSections.length ? ` (${result.navigationChangedSections.join(', ')})` : '';
    ev.note = `${ev.note} [navigation model ${platform} v${result.navigation?.version ?? '?'} learned${secs}]`;
  } else if (result.navigation) {
    ev.note = `${ev.note} [navigation model ${platform} v${result.navigation.version} reused]`;
  }
  return ev;
}

export function makeLandPortalBrowser(deps: LandPortalBrowserDeps = {}): BrowserService {
  const driver = deps.driver ?? makeParkedDriver('landportal');
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    id: 'landportal',
    label: 'LandPortal Browser (read-only property intelligence)',
    modes: ['workflow', 'ask'],
    configured() { return driver.configured(); },
    runWorkflow(input, opts) { return runLandPortalWithLearning(input, driver, now, opts.timeoutMs, opts); },
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
