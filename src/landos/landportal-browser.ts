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

export const LANDPORTAL_BROWSER_BASE = 'https://www.landportal.com';
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

/**
 * The LandPortal browser workflow. Open → search → open the property page → ONE
 * screenshot immediately after load → read every visible field → extract. ONE
 * screenshot per successful property is enforced by a local guard. A parked
 * driver yields an honest `parked` evidence (no fabrication). Pure given the
 * injected driver.
 */
async function runLandPortalWorkflow(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('landportal', 'workflow');
  // Declare the forbidden actions we will refuse if the workflow ever needs them.
  // (Recorded only if encountered; here we simply never call them.)
  if (!driver.configured()) {
    ev.status = 'parked';
    ev.note = 'LandPortal browser parked: no existing authenticated session / visual stack enabled. Read-only workflow + extraction are defined and will run once a session is provided. No credential is ever stored.';
    return ev;
  }
  const term = searchTermFor(input.searchKey);
  if (!term) {
    ev.status = 'no_match';
    ev.note = 'No address / APN / owner provided to search LandPortal.';
    return ev;
  }
  try {
    await driver.open(LANDPORTAL_BROWSER_BASE, { timeoutMs });
    ev.sourceUrls.push(LANDPORTAL_BROWSER_BASE);
    const searchRead = await driver.search(term.term, { timeoutMs });
    // Navigate into the property page (the search lands on it or a result that
    // opens it). The driver's search returns the resolved property page read.
    const propRead = searchRead.url && /property|parcel|detail/i.test(searchRead.url)
      ? searchRead
      : await driver.readFields({ timeoutMs });
    if (propRead.url) ev.sourceUrls.push(propRead.url);

    // ── ONE screenshot, immediately after the property page loads ──────────
    let screenshotTaken = false;
    const captureOnce = async (): Promise<void> => {
      if (screenshotTaken) return; // exactly one per property
      const shot = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, { timeoutMs });
      ev.screenshots.push(shot);
      screenshotTaken = true;
    };
    await captureOnce();

    // ── Read EVERY visible field (expand panels are read-only) ─────────────
    const fullRead = await driver.readFields({ timeoutMs });
    const merged: BrowserPageRead = {
      url: fullRead.url || propRead.url,
      fields: { ...propRead.fields, ...fullRead.fields },
      snippets: [...propRead.snippets, ...fullRead.snippets],
    };
    const { patch, fields } = extractLandPortalFields(merged);
    ev.patch = patch;
    ev.fields = fields;
    ev.status = Object.keys(fields).length ? 'retrieved' : 'partial';
    ev.note = ev.status === 'retrieved'
      ? `LandPortal property opened (${term.by} search); ${Object.keys(fields).length} fields read; one screenshot captured as visual proof.`
      : 'LandPortal page opened but no readable property fields were found.';
    return ev;
  } catch (err) {
    ev.status = 'error';
    ev.note = `LandPortal browser run failed before any paid action: ${(err as Error)?.message ?? 'unknown error'}. No credit consumed.`;
    return ev;
  }
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
