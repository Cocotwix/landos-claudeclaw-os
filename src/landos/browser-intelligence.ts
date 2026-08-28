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
  /** An already-retained, verified canonical LandPortal parcel URL for THIS
   *  subject. When present the LandPortal workflow opens the parcel record
   *  directly instead of hopping surfaces and re-running its ranked search; the
   *  record is still visually verified before anything is extracted from it. */
  landPortalParcelUrl?: string;
  /**
   * The subject as the OPERATOR described it, supplied only when
   * `landPortalParcelUrl` is the operator's OWN link rather than a parcel URL
   * LandOS retained and verified.
   *
   * A record opened from the operator's own link is checked against this instead
   * of against the search key, because the search key is read off a property
   * card that a previous unverified run may already have written the WRONG
   * parcel's identity onto — in which case the wrong answer would veto the right
   * one and send the run back to the search that produced it. It is never used
   * to search, and it is never supplied for an accepted (verified) card.
   */
  operatorSuppliedSubject?: {
    address?: string; apn?: string; city?: string; county?: string; state?: string; zip?: string;
  };
  /** Already-confirmed subject measures, when the caller holds them (e.g. from an
   *  official assessor record). They are never used to SEARCH — they are used to
   *  cross-check that the parcel a site opened is actually the subject. */
  acreage?: number | null;
  lat?: number | null;
  lng?: number | null;
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
  captureLandPortalVisuals?(url: string, opts: {
    timeoutMs: number;
    captureLabels?: string[];
    /** Called the moment the verified parcel's own facts have been read, before
     *  any imagery work. The capture continues; this only lets a caller that
     *  needs the subject (identity) stop waiting on the visual half. */
    onSubjectFacts?: (payload: { url: string; fields: Record<string, string> }) => void;
  }): Promise<{
    fields: Record<string, string>;
    parcelShotPath: string | null;
    compsMapShotPath: string | null;
    overlayShots?: Array<{ overlay: string; path: string; purpose: string }>;
    /** Individually framed, semantic visual captures. The labels are stable
     * inspection keys; a caller can request only a subset so a visual repair
     * never replaces unrelated, already-accepted evidence. */
    visualShots?: Array<{
      label: string;
      path: string;
      kind: 'parcel_page' | 'overlay' | 'parcel_3d';
      purpose: string;
      overlay?: string;
      soilDetails?: Array<{
        symbol: string | null;
        name: string | null;
        fields: Record<string, string>;
      }>;
    }>;
    /** Overlays that were ATTEMPTED but produced no distinct rendered image
     *  (control absent, layer never painted, or capture identical to the base
     *  map). Recorded honestly as unavailable — never substituted. */
    overlayMisses?: Array<{ overlay: string; reason: string }>;
    terrainShotPath?: string | null;
    compRows: string[];
    /** Structured comparable cards (JSON strings). These carry LandPortal's own
     *  `data-mlsstatus` and its identity triple (propertyid + fips + apn); the
     *  row text states neither, so a text-only read loses the sold status. */
    compCards?: string[];
    /** Per-comparable reads of that comp's OWN parcel page (JSON strings) —
     *  the second surface, supplying address, sale date and improvement facts. */
    compDetails?: string[];
    mapRows?: string[];
    mapReached: boolean;
    capturedAtIso: string;
  }>;
  /** LANDPORTAL SUBJECT/COMP RECORD READ (no imagery, never enters comp-search
   *  mode): authenticated parcel panel + internal endpoint + optional MLS
   *  Details block with listing remarks and exact source listing links.
   *  Optional; live driver only. */
  readLandPortalRecord?(url: string, opts: { timeoutMs: number; includeMls?: boolean }): Promise<{
    url: string;
    authenticated: boolean;
    panelReady: boolean;
    apn: string | null;
    fields: Record<string, string>;
    mlsFields: Record<string, string>;
    listingLinks: Array<{ text: string; href: string }>;
    redfinUrl: string | null;
    apiFactCount: number;
    dismissedOverlays: number;
    capturedAtIso: string;
  }>;
  /** LANDPORTAL TOP-BAR MAP SEARCH: applies the plan's Status/Details/Type
   *  quick filters on the verified subject's map workspace, zooms out until
   *  returned comps are spatially visible, and reads the structured List View
   *  rows without clicking them. Optional; live driver only. */
  runLandPortalMapSearch?(url: string, plan: import('./landportal-map-search.js').LandPortalMapSearchPlan, opts: { timeoutMs: number }): Promise<{
    authenticated: boolean;
    panelApn: string | null;
    applied: boolean;
    pills: string;
    zoomStepsUsed: number;
    noPropertiesFound: boolean | null;
    resultCount: number | null;
    rows: Array<{ attrs: Record<string, string>; text: string }>;
    mapShotPath: string | null;
    listShotPath: string | null;
    dismissedOverlays: number;
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
  /** BROWSER LIFECYCLE — open an owned-page scope for this driver instance.
   *  The driver's registered lane pages are its to close. Pages owned by other
   *  lanes and pages with unknown provenance are preserved, regardless of when
   *  they appeared. */
  beginOwnedPageScope?(): Promise<string>;
  /** Close this driver's registered pages, whatever the outcome — success,
   *  partial, failure, timeout, cancellation, or a visual rejection. Never
   *  closes another lane's page or an operator page. Returns what was closed
   *  for the operator-facing cleanup record. */
  closeOwnedPageScope?(token: string): Promise<{ closed: number; failed: number; preserved: number }>;
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
  /** Execute arbitrary JavaScript in the page context (read-only). Returns the
   *  serialized result. Useful for complex form interactions, DOM inspection,
   *  and platform-specific workflows that the generic primitives cannot express. */
  evaluate?: <T>(fn: (() => T) | string, ...args: unknown[]) => Promise<T>;
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
   *  Clears any stale selection first, waits for a DEPENDENT list (county) to be
   *  populated by the parent selection, and returns only the values whose
   *  rendered display it read back on screen. A value it could not see selected
   *  is not returned — this method never reports a filter it did not apply. */
  setScope?(values: string[], opts: { timeoutMs: number }): Promise<string[]>;
  /** READ the jurisdiction scope controls exactly as the page renders them.
   *  This is the visual read the search-configuration checkpoint compares
   *  against — never what the automation believes it set. `available` reports
   *  whether the controls EXIST (so a surface with no county filter is not
   *  faulted for lacking one), `state`/`county` are the displayed labels with
   *  placeholders such as "Select Value" normalized to null, and `extras` are
   *  any other filters still visibly applied. */
  readScope?(opts: { timeoutMs: number }): Promise<{
    available: boolean; state: string | null; county: string | null; extras: string[];
  }>;
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
   *  record', 'interactive APN search → record'). A source URL alone is never
   *  a fact. Required provenance. */
  extractionMethod?: string;
}

/** Two search modes. Parcel Fact Retrieval is fast (assessor/GIS/tax parcel facts);
 *  Deep Record Retrieval explores recorded documents (deeds/plats/permits) and
 *  legitimately takes longer. */
export type BrowserSearchMode = 'parcel_fact' | 'deep_record';

export type BrowserRunStatus = 'retrieved' | 'partial' | 'no_match' | 'parked' | 'blocked' | 'error';

export type BrowserAttemptStage = 'navigate' | 'retrieve' | 'extract' | 'interpret';
export interface BrowserAttemptStep {
  stage: BrowserAttemptStage;
  outcome: 'succeeded' | 'no_match' | 'unavailable' | 'failed' | 'skipped';
  detail: string;
  url?: string;
}

/**
 * One source that the browser actually opened. `sourcesUsed` is routing
 * context; this is execution truth and must never include a source that was
 * merely discovered but not visited.
 */
export interface BrowserSourceAttempt {
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  attemptedAt: string;
  result:
    | 'retrieved'
    | 'useful_indication'
    | 'attempted_inconclusive'
    | 'source_unavailable'
    | 'not_found'
    | 'execution_failure';
  factCount: number;
  note: string;
  /** Final page reached after search/result navigation, when different from the
   * routed landing page. */
  reachedUrl?: string;
  /** Identifier paths actually submitted, in order (for example `apn`, then
   * `owner`). Merely available controls are not listed. */
  searchMethods?: string[];
  /** Practical alternate routes that were really exercised, not suggestions. */
  alternateRoutesAttempted?: string[];
  /** Exact subject-fact keys emitted from this source. A URL/link is never a
   * subject fact and therefore never appears here. */
  extractedFactKeys?: string[];
  /** Stable machine-readable reason for a zero-fact attempt. */
  failureCode?:
    | 'no_subject_identifier'
    | 'no_search_control'
    | 'no_subject_match'
    | 'record_not_reached'
    | 'no_extractable_subject_fields'
    | 'source_unavailable'
    | 'timeout_or_cancelled'
    | 'execution_failure';
  /** Navigate → retrieve → extract → interpret trace for this exact source. */
  steps?: BrowserAttemptStep[];
}

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
  /** Per-source execution outcomes. Optional for older/non-county providers. */
  sourceAttempts?: BrowserSourceAttempt[];
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
  /** The visual checkpoints the run actually performed, in order — what was
   *  looked at before each consequential action, what was confirmed, what the
   *  page never displayed, and what blocked. "Verified" becomes auditable. */
  visualCheckpoints?: Array<{
    kind: string; passed: boolean; confirmed: string[]; blockers: string[]; unverified: string[]; screenshotPath: string | null;
  }>;
  /** Every capture verdict including rejections. A rejected capture is history,
   *  never evidence. */
  captureVerdicts?: Array<{ purpose: string; path: string | null; result: string; reason: string }>;
  /** What the job's browser cleanup actually closed. `preserved` counts pages
   *  that were already open — the operator's own tabs, never touched. */
  browserCleanup?: { closed: number; failed: number; preserved: number };
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
  /** Canonical persistence scope for provider evidence. */
  propertyCardId?: number;
  dealCardId?: number;
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
  /** Fired when the verified subject parcel's own facts have been read, ahead of
   *  the run's imagery and deep-record work. A caller that only needs identity
   *  can settle on this instead of the whole run.
   *
   *  `verifiedParcelApn` is set when the run reached this record through an
   *  operator entry link and the parcel checkpoint has PASSED on it. It carries
   *  the identifier the opened record itself stated, so the consumer can record
   *  the verification this run performed instead of a later run discovering it
   *  through persistence. Absent means "not verified by this hook's caller". */
  onSubjectFacts?: (payload: { url: string; fields: Record<string, string>; verifiedParcelApn?: string | null }) => void;
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
