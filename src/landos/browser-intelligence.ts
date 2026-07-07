// LandOS — Browser Intelligence (shared capability layer).
//
// Reusable browser CAPABILITIES that ANY future department can call — not DD-only
// agents. Each browser service exposes two modes:
//   • workflow mode — runs automatically when another workflow needs retrieval.
//   • ask mode      — answers free-form operator questions; the service
//                     intelligently determines the workflow required (NOT a fixed
//                     list of hardcoded commands).
//
// This module is the shared contract + the deterministic ask-mode intent router +
// the read-only safety surface. The actual page driving is behind an injectable
// BrowserDriver, so the logic is pure + unit-testable and the live driver
// (Puppeteer + an EXISTING authenticated session) plugs in without a rewrite.
// Default driver is an honest parked stub — it never fabricates a page read and
// never stores a credential.
//
// Safety is inherited from browser-retrieval.ts: read-only allow-list +
// forbidden-action list (billing / credit / purchase / paid export / writes), and
// assertReadOnly() gates every action before it runs.

import {
  assertReadOnly, isForbiddenAction, READONLY_FORBIDDEN_ACTIONS,
  type ReadOnlyAction,
} from './browser-retrieval.js';
import type { PropertyPatch } from './normalized-property.js';
import type { PendingLandPortalInspectionRecord } from './property-card.js';

export type BrowserMode = 'workflow' | 'ask';
export const BROWSER_MODES: readonly BrowserMode[] = ['workflow', 'ask'];

// ─────────────────────────────────────────────────────────────────────────
// Intent taxonomy (ask mode) — broad, not a few hardcoded commands
// ─────────────────────────────────────────────────────────────────────────

/** Every question intent the browser layer understands. New intents append here;
 *  the router maps free text → one of these + the owning service + workflow. */
export const BROWSER_INTENTS = [
  // identity / property summary
  'property_summary', 'search_address', 'search_apn', 'search_owner',
  'owner', 'mailing_address', 'coordinates', 'acreage', 'land_use', 'parcel_id',
  // environmental / physical
  'fema_flood', 'wetlands', 'road_frontage', 'buildable_area', 'slope', 'utilities',
  // records / county
  'recorded_deed', 'deed_book', 'ownership_history', 'transfers',
  'tax_history', 'tax_status', 'tax_delinquency', 'tax_values',
  'zoning', 'zoning_ordinance', 'gis_map', 'plat', 'subdivision_restrictions',
  'permits', 'planning_cases',
  // fallback
  'general',
] as const;
export type BrowserIntent = (typeof BROWSER_INTENTS)[number];

export type BrowserServiceId = 'landportal' | 'county_records';

/** Which service owns each intent. LandPortal is the first/primary property
 *  intelligence source; county records own recorded-document + official queries. */
const INTENT_SERVICE: Record<BrowserIntent, BrowserServiceId> = {
  property_summary: 'landportal', search_address: 'landportal', search_apn: 'landportal',
  search_owner: 'landportal', owner: 'landportal', coordinates: 'landportal',
  acreage: 'landportal', land_use: 'landportal', parcel_id: 'landportal',
  fema_flood: 'landportal', wetlands: 'landportal', buildable_area: 'landportal', slope: 'landportal',
  utilities: 'landportal',
  // records live at the county
  mailing_address: 'county_records', road_frontage: 'county_records',
  recorded_deed: 'county_records', deed_book: 'county_records', ownership_history: 'county_records',
  transfers: 'county_records', tax_history: 'county_records', tax_status: 'county_records',
  tax_delinquency: 'county_records', tax_values: 'county_records', zoning: 'county_records',
  zoning_ordinance: 'county_records', gis_map: 'county_records', plat: 'county_records',
  subdivision_restrictions: 'county_records', permits: 'county_records', planning_cases: 'county_records',
  general: 'landportal',
};

/** Pattern → intent. Order matters (more specific first). A real classifier over
 *  verbs + nouns, deliberately broad so the operator can ask freely. */
const INTENT_PATTERNS: Array<{ rx: RegExp; intent: BrowserIntent }> = [
  { rx: /\b(last|latest|recent|recorded)\s+deed\b|\bdeed\b(?!\s*book)/i, intent: 'recorded_deed' },
  { rx: /\bdeed\s*book\b|\bbook\s*(?:&|and|\/)?\s*page\b/i, intent: 'deed_book' },
  { rx: /\b(every|all)\s+transfer|transfer\s+history|chain of title\b/i, intent: 'transfers' },
  { rx: /\bownership\s+(history|verif)|history of ownership\b/i, intent: 'ownership_history' },
  { rx: /\bmailing\s+address\b/i, intent: 'mailing_address' },
  { rx: /\btax\s+(delinquen|owed|unpaid|behind)\b/i, intent: 'tax_delinquency' },
  { rx: /\btax\s+status\b/i, intent: 'tax_status' },
  { rx: /\btax\s+(history|record)\b/i, intent: 'tax_history' },
  { rx: /\btax\s+(value|assess|amount)\b/i, intent: 'tax_values' },
  { rx: /\bsubdivision\s+(restriction|covenant)|\bcovenants?\b|\bdeed restriction/i, intent: 'subdivision_restrictions' },
  { rx: /\bzoning\s+ordinance\b/i, intent: 'zoning_ordinance' },
  { rx: /\bzoning\b|\bzoned\b/i, intent: 'zoning' },
  { rx: /\bgis\b|parcel\s+map|map\s+the\s+parcel|open the (gis|map)/i, intent: 'gis_map' },
  { rx: /\b(latest\s+)?plat\b|plat\s+map\b/i, intent: 'plat' },
  { rx: /\bpermit/i, intent: 'permits' },
  { rx: /\bplanning\s+(case|application|board)\b/i, intent: 'planning_cases' },
  { rx: /\bfema\b|\bflood\s*(map|zone|plain)?\b/i, intent: 'fema_flood' },
  { rx: /\bwetland/i, intent: 'wetlands' },
  { rx: /\broad\s+frontage|frontage\b/i, intent: 'road_frontage' },
  { rx: /\bbuildable\b/i, intent: 'buildable_area' },
  { rx: /\bslope|topograph/i, intent: 'slope' },
  { rx: /\butilit(y|ies)|water|sewer|septic|power|electric\b/i, intent: 'utilities' },
  { rx: /\bland\s*use\b/i, intent: 'land_use' },
  { rx: /\bacre|acreage|lot\s*size\b/i, intent: 'acreage' },
  { rx: /\bcoordinate|lat\/?long|latitude|gps\b/i, intent: 'coordinates' },
  { rx: /\bwho\s+owns\b|owner(ship)?\b/i, intent: 'owner' },
  { rx: /\bsearch\s+(this\s+)?apn\b|\bapn\b/i, intent: 'search_apn' },
  { rx: /\bsearch\s+(this\s+)?owner\b/i, intent: 'search_owner' },
  { rx: /\bsearch\s+(this\s+)?address\b/i, intent: 'search_address' },
];

/** The search key the question targets, extracted from the free text or context. */
export interface BrowserSearchKey {
  address?: string;
  apn?: string;
  /** Alternate APN formats the same county may index the parcel under (e.g. a
   *  dashed vs. spaced form). The agent tries these when the primary APN yields no
   *  confident match, rather than giving up after one search. */
  apnAlternates?: string[];
  owner?: string;
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
}

export interface BrowserQuestionRoute {
  intent: BrowserIntent;
  service: BrowserServiceId;
  /** workflow vs ask provenance; ask routes still produce a workflow plan. */
  mode: BrowserMode;
  searchKey: BrowserSearchKey;
  /** Deterministic reason for the routing. */
  reason: string;
}

/** Classify a free-form operator question into an intent + owning service +
 *  search key. Intelligent, not a fixed command list: unknown phrasing falls back
 *  to a full property workflow rather than refusing. Pure + deterministic. */
export function routeBrowserQuestion(text: string, ctx: BrowserSearchKey = {}): BrowserQuestionRoute {
  const t = (text ?? '').trim();
  let intent: BrowserIntent = 'general';
  for (const p of INTENT_PATTERNS) {
    if (p.rx.test(t)) { intent = p.intent; break; }
  }
  const searchKey = { ...ctx, ...extractSearchKey(t, ctx) };
  const service = INTENT_SERVICE[intent];
  return {
    intent,
    service,
    mode: 'ask',
    searchKey,
    reason: intent === 'general'
      ? `No specific record intent recognized — running a full ${service} property workflow.`
      : `Question maps to "${intent}" → ${service === 'landportal' ? 'LandPortal' : 'County Records'} browser.`,
  };
}

/** Extract an APN / owner / address from question text (falls back to context). */
export function extractSearchKey(text: string, ctx: BrowserSearchKey = {}): BrowserSearchKey {
  const out: BrowserSearchKey = {};
  const apn = text.match(/\bapn[:\s#]*([0-9][0-9A-Za-z.\-\/ ]{3,})/i)?.[1]?.trim()
    ?? text.match(/\b(\d{2,6}-\d{2,6}-\d{2,6}(?:-\d+)?)\b/)?.[1];
  if (apn) out.apn = apn.replace(/\s+/g, ' ').trim();
  const owner = text.match(/\bowner[:\s]+([A-Za-z][A-Za-z.'\- ]{2,})/i)?.[1]?.trim();
  if (owner) out.owner = owner;
  const addr = text.match(/\b(\d+[A-Za-z]?\s+[A-Za-z0-9][\w ]*?\s+(?:road|rd|street|st|ave|avenue|dr|drive|ln|lane|ct|court|way|trl|trail|hwy|highway|pl|place|cir|circle|blvd|pike|loop))\b/i)?.[1];
  if (addr) out.address = addr.trim();
  return { ...ctx, ...out };
}

// ─────────────────────────────────────────────────────────────────────────
// Driver contract (the injectable, pluggable page driver)
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserScreenshot {
  /** Local file path to the saved screenshot, when captured. Never a remote URL. */
  path: string;
  capturedAtIso: string;
  /** What the shot is meant to prove (e.g. 'landportal_property_loaded'). */
  purpose: string;
}

/** A page the driver has loaded. Field reads are key→value of visible text. */
export interface BrowserPageRead {
  url: string;
  /** Visible property/record fields the driver could read. Never invented. */
  fields: Record<string, string>;
  /** Visible evidence snippets (table rows, panel text). Never secrets. */
  snippets: string[];
}

/** The pluggable page driver. A live implementation wraps Puppeteer + an EXISTING
 *  authenticated session; the default is an honest parked stub. Read-only: every
 *  method maps to an allow-listed action and never writes/purchases. */
export interface BrowserDriver {
  readonly id: string;
  /** True only when a live session + stack are available and enabled. */
  configured(): boolean;
  open(url: string, opts: { timeoutMs: number }): Promise<BrowserPageRead>;
  /** Type into the site's search and submit. action='search'. */
  search(query: string, opts: { timeoutMs: number }): Promise<BrowserPageRead>;
  /** Read all visible fields on the current page. action='read'. */
  readFields(opts: { timeoutMs: number }): Promise<BrowserPageRead>;
  /** Full-panel read: opens the parcel's deep link in a fresh tab and reads
   *  label/value pairs from definition lists, two-cell rows, AND two-span detail
   *  rows WITHOUT an off-screen filter (captures below-the-fold valuation/zoning/
   *  environmental/terrain sections). Optional; live driver only. */
  readFullPanel?(url: string, opts: { timeoutMs: number }): Promise<BrowserPageRead>;
  /** ONE-PASS LandPortal capture on the deep-link full view: parcel fields + a
   *  wide parcel screenshot + all comparable rows + the real "Show on Map" comps
   *  map screenshot (mapReached proves it was clicked). Optional; live driver only. */
  captureLandPortalVisuals?(url: string, opts: { timeoutMs: number }): Promise<{
    fields: Record<string, string>;
    parcelShotPath: string | null;
    compsMapShotPath: string | null;
    overlayShots?: Array<{ overlay: string; path: string; purpose: string }>;
    terrainShotPath?: string | null;
    compRows: string[];
    mapReached: boolean;
    capturedAtIso: string;
  }>;
  /** Capture ONE screenshot of the current page. action='capture_screenshots'.
   *  fullPage captures the entire scrollable page (uncropped) when supported. */
  screenshot(purpose: string, opts: { timeoutMs: number; fullPage?: boolean }): Promise<BrowserScreenshot>;
  /** Read visible anchor links (text + href) — used for NETR routing. Read-only. */
  readLinks?(opts: { timeoutMs: number }): Promise<Array<{ text: string; href: string }>>;
  /** Read the page's forms (inputs + labels/placeholders + submit) for semantic
   *  parcel-search navigation. Read-only. */
  readForms?(opts: { timeoutMs: number }): Promise<Array<{ formIndex: number; fields: Array<{ selector: string; name?: string; id?: string; label?: string; placeholder?: string; type?: string }>; submitLabel?: string; submitSelector?: string }>>;
  /** Type a value into a selector + submit (read-only navigation of a public
   *  search form). action='search'. Returns the resulting page read. */
  fillAndSubmit?(fieldSelector: string, value: string, submitSelector: string | undefined, opts: { timeoutMs: number }): Promise<BrowserPageRead>;
  /** OBSERVE: rich page signals for Website Intelligence (title/headings/nav/
   *  search controls + select options/buttons/links/map/table/fields). Read-only. */
  observe?(opts: { timeoutMs: number }): Promise<unknown>;
  /** Select an option (by visible text) in a select/dropdown — for a method
   *  selector (Address/APN/Owner). Read-only navigation. */
  selectByText?(selector: string, optionText: string, opts: { timeoutMs: number }): Promise<void>;
  /** Click a control by its visible text (tab/button/menu). Read-only navigation. */
  clickByText?(text: string, opts: { timeoutMs: number }): Promise<void>;
  /** INTERACT: read NON-ANCHOR result candidates (GIS rows/cards/popups/clickable
   *  divs/list items) in deterministic order. Read-only. */
  readCandidates?(opts: { timeoutMs: number }): Promise<Array<{ index: number; text: string; kind: string }>>;
  /** Click the candidate at the given deterministic index (re-collected in the
   *  same order). Read-only navigation (opens a detail panel/popup/record). */
  clickCandidate?(index: number, opts: { timeoutMs: number }): Promise<void>;
  /** Type a value into a search box WITHOUT submitting (drives a typeahead). */
  typeSearch?(selector: string, value: string, opts: { timeoutMs: number }): Promise<void>;
  /** Submit the current search AFTER a typeahead option was selected — some sites
   *  (e.g. LandPortal's APN / Parcel-ID autocomplete) require selecting the matching
   *  parcel option first, THEN clicking Search / pressing Enter to open the parcel.
   *  Read-only navigation. */
  submitSearch?(opts: { timeoutMs: number }): Promise<void>;
  /** Switch a search-method selector (Address/APN/Owner/Lat) to `method` by
   *  opening the toggle near the search bar and clicking the option. Read-only. */
  selectMethod?(method: string, opts: { timeoutMs: number }): Promise<void>;
  /** Set scope filter dropdowns (e.g. State, then County) so a search resolves to
   *  a single jurisdiction. Drives standard Select2/native dropdowns. Read-only.
   *  Returns the values it confirmed it set. */
  setScope?(values: string[], opts: { timeoutMs: number }): Promise<string[]>;
  /** Optional UI nudges — all read-only (zoom/pan/expand panels). */
  act?(action: ReadOnlyAction, arg?: string, opts?: { timeoutMs: number }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────
// Evidence + blocked-action records
// ─────────────────────────────────────────────────────────────────────────

export interface BlockedAction {
  action: string;
  reason: string;
}

/** A single browser-derived public-record fact with MANDATORY provenance. Never
 *  a guess: status is 'extracted' only when confidently read; otherwise
 *  'needs_verification' or 'not_found'. Origin records where it came from. */
export type FactOrigin = 'landportal' | 'netr_county' | 'search_fallback';
export interface BrowserFact {
  key: string;
  label: string;
  value: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  confidence: 'high' | 'medium' | 'low';
  origin: FactOrigin;
  /** Found = 'extracted'. The four operator statuses are extracted (Found),
   *  needs_verification, not_found, blocked. */
  status: 'extracted' | 'needs_verification' | 'not_found' | 'blocked';
  /** How the value was obtained (e.g. 'semantic field match', 'parcel search →
   *  record', 'official source link'). Required provenance. */
  extractionMethod?: string;
}

/** Two search modes. Parcel Fact Retrieval is fast (assessor/GIS/tax parcel facts);
 *  Deep Record Retrieval explores recorded documents (deeds/plats/permits) and
 *  legitimately takes longer. */
export type BrowserSearchMode = 'parcel_fact' | 'deep_record';

export type BrowserRunStatus = 'retrieved' | 'partial' | 'no_match' | 'parked' | 'blocked' | 'error';

/** The normalized output of a browser service run. The structured `patch` +
 *  `fields` are the REAL output; the screenshot is only visual proof. */
export interface BrowserEvidence {
  service: BrowserServiceId;
  mode: BrowserMode;
  status: BrowserRunStatus;
  /** Normalized fields contributed to the property object. */
  patch: PropertyPatch;
  /** All visible fields read (superset of patch — raw evidence). */
  fields: Record<string, string>;
  /** Provenance-labeled public-record facts extracted (the operator-facing
   *  enrichment). Empty until a real page is read. */
  facts: BrowserFact[];
  /** County source routing actually used (NETR vs search fallback), when county. */
  sourcesUsed: Array<{ type: string; url: string; origin: FactOrigin; confidence: number }>;
  /** ONE screenshot per successful property (LandPortal); county may add useful shots. */
  screenshots: BrowserScreenshot[];
  /** Actions that were NOT performed because they could spend money / write. */
  blocked: BlockedAction[];
  /** Public source URLs read, when safe. Never credentialed URLs. */
  sourceUrls: string[];
  /** Short, operator-facing note. Never a raw log dump. */
  note: string;
  /** Optional structured LandPortal inspection payload for persistence/reporting. */
  inspection?: PendingLandPortalInspectionRecord;
}

/** Record a forbidden action as blocked (never performed). The single place a
 *  "could this spend money?" decision is logged. */
export function recordBlocked(ev: BrowserEvidence, action: string, reason?: string): void {
  ev.blocked.push({ action, reason: reason ?? (isForbiddenAction(action) ? 'Forbidden read-only-mode action (billing/credit/purchase/write).' : 'Action not allowed.') });
}

/** Guard wrapper every driver action passes through. Throws ReadOnlyViolation on
 *  a forbidden action so a service can record it as blocked rather than run it. */
export function guardedAction(action: string): ReadOnlyAction {
  assertReadOnly(action);
  return action;
}

export function emptyEvidence(service: BrowserServiceId, mode: BrowserMode): BrowserEvidence {
  return { service, mode, status: 'parked', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: '' };
}

// ─────────────────────────────────────────────────────────────────────────
// Service contract + parked default driver
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserWorkflowInput {
  searchKey: BrowserSearchKey;
  /** In workflow mode, only these fields are still needed (gap-fill). Empty =
   *  collect the full property. */
  neededFields?: string[];
  /** Parcel Fact Retrieval (fast) vs Deep Record Retrieval (deeds/plats/permits). */
  mode?: BrowserSearchMode;
}

/** Per-run hooks: stream each found fact to the Deal Card immediately, and let
 *  the operator cancel mid-run (preserving everything already found). */
export interface BrowserRunHooks {
  timeoutMs: number;
  /** Called as soon as a fact is confidently found (incremental Deal Card write). */
  onFact?: (fact: BrowserFact) => void;
  /** Polled between steps; true → stop now (operator cancelled). */
  isCancelled?: () => boolean;
}

export interface BrowserService {
  readonly id: BrowserServiceId;
  readonly label: string;
  readonly modes: readonly BrowserMode[];
  /** True only when its driver has a live session + stack. */
  configured(): boolean;
  /** Workflow mode — automatic retrieval for another workflow. opts may carry an
   *  onFact stream + isCancelled hook for incremental Deal Card updates. */
  runWorkflow(input: BrowserWorkflowInput, opts: { timeoutMs: number } & Partial<BrowserRunHooks>): Promise<BrowserEvidence>;
  /** Ask mode — answer a free-form question (routes to the right workflow). */
  ask(question: string, ctx: BrowserSearchKey, opts: { timeoutMs: number }): Promise<BrowserEvidence>;
}

/** Honest parked driver — the default. It NEVER opens a page, fabricates a read,
 *  or stores a credential. configured() is false until a live session is wired. */
export function makeParkedDriver(id: string): BrowserDriver {
  const parked = (): never => { throw new Error(`${id} driver parked: no authenticated browser session / visual stack enabled.`); };
  return {
    id,
    configured() { return false; },
    async open() { return parked(); },
    async search() { return parked(); },
    async readFields() { return parked(); },
    async screenshot() { return parked(); },
  };
}

/** Re-export the read-only forbidden set so services can declare it. */
export { READONLY_FORBIDDEN_ACTIONS };
