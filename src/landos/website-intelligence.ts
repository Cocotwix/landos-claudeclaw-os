// LandOS — Website Intelligence (generalized; NO platform-specific logic).
//
// Browser Intelligence should LEARN websites, not just automate them. Any LandOS
// department can hand it an unfamiliar site; it reasons like an experienced human
// operator using a site for the first time:
//   Observe → Understand → Research → Plan → Navigate → Verify → Extract →
//   Remember → Improve.
//
// This module is the pure, deterministic reasoning core (the live driver supplies
// the raw page observation; the Platform Intelligence Library supplies memory).
// It contains ZERO LandPortal / county / vendor code — only generic semantics.

// ── OBSERVE — the raw signals a driver reads from any page ────────────────────

export interface ObservedControl {
  /** A driver-usable selector. */
  selector: string;
  label?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  type?: string;
  /** For selects/option groups: the visible option texts. */
  options?: string[];
}

export interface PageObservation {
  url: string;
  title: string;
  headings: string[];
  /** Navigation / sidebar / menu item texts. */
  navItems: string[];
  /** Text inputs / selects that look like search controls. */
  searchControls: ObservedControl[];
  /** Buttons (visible text). */
  buttons: string[];
  /** Anchor links (text + href) — for Research (help/docs) + navigation. */
  links: Array<{ text: string; href: string }>;
  hasMap: boolean;
  hasTable: boolean;
  /** Visible label→value pairs (used only after Verify). */
  fields: Record<string, string>;
  loginLike: boolean;
  /** A CUSTOM (non-<select>) search-method toggle, e.g. an "Address ▾" pill whose
   *  click opens a method menu (Address / APN / Owner / Lat-Long). `current` is the
   *  visible method it currently shows. Generic across modern SPAs. */
  methodToggle?: { current: string };
  /** INTERMEDIATE-STATE signals used by failure diagnosis: after a search appears
   *  to fail, these describe what the page is actually asking for (a pending
   *  selection, a checkbox/radio to tick, a disabled submit, a validation message,
   *  a modal, a results table). Optional — populated by the live observer; absent
   *  on simple/fake observations. Generic across every interactive site. */
  interactive?: InteractiveState;
}

/** Pending intermediate-state signals a failed page reveals (generic; no site
 *  specifics). All counts are of VISIBLE elements only. */
export interface InteractiveState {
  /** Unchecked/checked checkboxes present (a "select this parcel" tick, etc.). */
  checkboxes: number;
  /** Radio buttons present (choose-one option). */
  radios: number;
  /** Selectable option rows present (autocomplete/typeahead/listbox suggestions). */
  selectableOptions: number;
  /** The primary submit/search control, if one is visible. */
  submit?: { present: boolean; disabled: boolean; label?: string };
  /** Visible validation / error / "required" messages. */
  validationMessages: string[];
  /** A modal/dialog is open (intercepts clicks). */
  hasModal: boolean;
  /** An option/checkbox/radio/row currently appears SELECTED (a pending selection
   *  that has been satisfied — ready to submit). */
  hasSelection: boolean;
  /** A filter/refine state appears applied. */
  filterActive: boolean;
}

// ── UNDERSTAND — classify the platform from generic signals ───────────────────

export const PLATFORM_CLASSES = [
  'gis_map', 'property_database', 'county_assessor', 'county_appraiser',
  'recorder_deeds', 'planning_zoning', 'tax_office', 'crm', 'marketing',
  'document_portal', 'ai_platform', 'business_app', 'unknown',
] as const;
export type PlatformClass = (typeof PLATFORM_CLASSES)[number];

const CLASS_SIGNALS: Array<{ cls: PlatformClass; rx: RegExp }> = [
  { cls: 'gis_map', rx: /\bgis\b|parcel\s*viewer|interactive\s*map|map\s*(search|viewer|layers)|geospatial|arcgis|leaflet|mapbox/i },
  { cls: 'property_database', rx: /property\s*(search|database|records)|land\s*(investing|database)|parcel\s*(data|search)|comps?|skip\s*trace|saved\s*(list|search)/i },
  { cls: 'county_appraiser', rx: /property\s*appraiser|appraisal\s*district/i },
  { cls: 'county_assessor', rx: /assessor|board\s*of\s*assessors|property\s*record\s*card|real\s*property/i },
  { cls: 'recorder_deeds', rx: /recorder|register\s*of\s*deeds|land\s*records|recorded\s*documents|clerk\s*of\s*court/i },
  { cls: 'planning_zoning', rx: /planning|zoning|land\s*use|development\s*services/i },
  { cls: 'tax_office', rx: /tax\s*(collector|commissioner|office|bill)|treasurer|pay\s*taxes/i },
  { cls: 'crm', rx: /\bcrm\b|pipeline|contacts?|deals?|opportunit|gohighlevel|salesforce|hubspot/i },
  { cls: 'marketing', rx: /campaign|ad\s*account|ads?\s*manager|audience|google\s*ads|facebook\s*ads/i },
  { cls: 'document_portal', rx: /document\s*(portal|search)|public\s*records\s*search|image\s*viewer/i },
  { cls: 'ai_platform', rx: /\bai\b|model|prompt|completion|assistant/i },
];

export interface PlatformUnderstanding {
  platformClass: PlatformClass;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  /** Search methods the page appears to offer (apn/address/owner/latlng/general). */
  availableSearchMethods: SearchMethod[];
}

export type SearchMethod = 'apn' | 'address' | 'owner' | 'latlng' | 'general';

const METHOD_SIGNALS: Array<{ method: SearchMethod; rx: RegExp }> = [
  { method: 'apn', rx: /\bapn\b|parcel\s*(id|number|no|#)?|pin\b|tax\s*map|strap|account\s*(no|num)/i },
  { method: 'address', rx: /address|situs|location|street/i },
  { method: 'owner', rx: /owner|grantee|taxpayer/i },
  { method: 'latlng', rx: /lat(itude)?\s*\/?\s*long|coordinate|lat\s*lng|gps/i },
];

/** Understand the platform: classify it + detect the search methods it offers,
 *  from the observed title/headings/nav/controls. Pure. */
export function understandPlatform(obs: PageObservation): PlatformUnderstanding {
  const hay = [obs.title, ...obs.headings, ...obs.navItems, ...obs.buttons, ...obs.searchControls.flatMap((c) => [c.label, c.placeholder, c.name, ...(c.options ?? [])])].filter(Boolean).join(' ');
  const signals: string[] = [];
  let platformClass: PlatformClass = 'unknown';
  for (const { cls, rx } of CLASS_SIGNALS) {
    if (rx.test(hay)) { signals.push(cls); if (platformClass === 'unknown') platformClass = cls; }
  }
  if (obs.hasMap && (platformClass === 'unknown' || platformClass === 'property_database')) { platformClass = 'gis_map'; signals.push('map_detected'); }

  // Detect available search methods from a method-selector's options OR the
  // search controls' labels/placeholders.
  const methods = new Set<SearchMethod>();
  const methodHay = [...obs.searchControls.flatMap((c) => [c.label, c.placeholder, c.name, ...(c.options ?? [])]), ...obs.navItems, ...obs.buttons].filter(Boolean).join(' ');
  for (const { method, rx } of METHOD_SIGNALS) if (rx.test(methodHay)) methods.add(method);
  if (obs.searchControls.length && methods.size === 0) methods.add('general');

  return {
    platformClass,
    confidence: signals.length >= 2 ? 'high' : signals.length === 1 ? 'medium' : 'low',
    signals,
    availableSearchMethods: [...methods],
  };
}

// ── RESEARCH — find authoritative guidance (help/docs) ───────────────────────

const GUIDANCE_RX = /help\s*center|user\s*guide|knowledge\s*base|documentation|\bdocs?\b|tutorial|support|\bfaq\b|onboarding|getting\s*started|how\s*to/i;
export function findGuidanceLinks(obs: PageObservation): Array<{ text: string; href: string }> {
  return obs.links.filter((l) => GUIDANCE_RX.test(`${l.text} ${l.href}`)).slice(0, 8);
}

// ── PLAN — choose the navigation strategy by identifier + platform ───────────

export type NavActionKind = 'select_method' | 'fill' | 'submit' | 'open_panel' | 'click';
export interface NavStep { action: NavActionKind; selector?: string; value?: string; text?: string }

export interface NavigationStrategy {
  method: SearchMethod;
  steps: NavStep[];
  reason: string;
}

function controlForMethod(obs: PageObservation, method: SearchMethod): ObservedControl | undefined {
  const rx = METHOD_SIGNALS.find((m) => m.method === method)?.rx;
  return obs.searchControls.find((c) => rx?.test([c.label, c.placeholder, c.name, c.id].filter(Boolean).join(' ')));
}
function methodSelector(obs: PageObservation): ObservedControl | undefined {
  // A control whose options name multiple search methods (Address / APN / Owner).
  return obs.searchControls.find((c) => (c.options ?? []).filter((o) => METHOD_SIGNALS.some((m) => m.rx.test(o))).length >= 2);
}

/**
 * Plan how to search this platform for the given identifier. Intentionally pick
 * the method that MATCHES the identifier (don't assume the first input). If a
 * method selector exists, switch it to the matching method first. Generic. Pure.
 */
export function planNavigationStrategy(
  obs: PageObservation,
  identifier: { kind: SearchMethod; value: string },
): NavigationStrategy | null {
  const understanding = understandPlatform(obs);
  const want = identifier.kind;
  const steps: NavStep[] = [];

  // 1) If a method selector offers the wanted method, select it first.
  const sel = methodSelector(obs);
  if (sel && (sel.options ?? []).some((o) => (METHOD_SIGNALS.find((m) => m.method === want)?.rx)?.test(o))) {
    const optText = (sel.options ?? []).find((o) => (METHOD_SIGNALS.find((m) => m.method === want)?.rx)?.test(o));
    steps.push({ action: 'select_method', selector: sel.selector, text: optText });
  }

  // 1b) Otherwise, if a CUSTOM method toggle exists (e.g. "Address ▾"), open it
  //     and pick the wanted method by clicking — generic for modern SPA dropdowns.
  const wantRx = METHOD_SIGNALS.find((m) => m.method === want)?.rx;
  const directInput = controlForMethod(obs, want);
  if (!sel && !directInput && obs.methodToggle && wantRx && !wantRx.test(obs.methodToggle.current)) {
    const optionLabel = want === 'apn' ? 'APN' : want === 'address' ? 'Address' : want === 'owner' ? 'Owner' : 'Lat';
    steps.push({ action: 'click', text: obs.methodToggle.current }); // open the menu
    steps.push({ action: 'click', text: optionLabel });              // pick the method
  }

  // 2) Find the input to fill — prefer one matching the wanted method, else the
  //    method selector's own field, else a general search control.
  const input = directInput
    ?? (sel && sel.type !== 'select-one' ? sel : undefined)
    ?? obs.searchControls.find((c) => /search|find|lookup|query|address|situs/i.test([c.label, c.placeholder, c.name].filter(Boolean).join(' ')))
    ?? obs.searchControls.find((c) => (c.type ?? 'text') === 'text');
  if (!input) return null;
  steps.push({ action: 'fill', selector: input.selector, value: identifier.value });
  steps.push({ action: 'submit', selector: input.selector });

  return {
    method: want,
    steps,
    reason: `Platform "${understanding.platformClass}" offers [${understanding.availableSearchMethods.join(', ') || 'general'}]; identifier is ${want} → ${sel ? 'switch the method selector then ' : ''}search the ${want} field.`,
  };
}

// ── TASK SURFACE — "can this page accomplish my task?" + reach the right one ──
//
// Modern apps land you on an account/orders/dashboard page. Browser Intelligence
// must recognize the wrong surface and navigate (sidebar / nav / menu / launcher)
// to the real work surface — and NEVER touch forbidden surfaces (billing, orders,
// purchases, payments, settings). Generic; the boundary is learned per platform.

export type SurfaceClass = 'search' | 'record' | 'orders' | 'billing' | 'account' | 'settings' | 'dashboard' | 'other';

const SURFACE_RX: Array<{ cls: SurfaceClass; rx: RegExp }> = [
  { cls: 'billing', rx: /billing|payment|checkout|invoice|cart|purchase|pricing|upgrade|credit\s*purchase/i },
  { cls: 'orders', rx: /orders?\s*history|my\s*orders|order\s*id|purchased\s*reports/i },
  { cls: 'settings', rx: /settings|preferences/i },
  { cls: 'account', rx: /my\s*account|profile|account\s*overview|sign\s*out|log\s*out/i },
  { cls: 'record', rx: /parcel\s*(detail|record)|property\s*(record|detail|card)|owner\s*of\s*record/i },
  { cls: 'search', rx: /map\s*search|property\s*search|parcel\s*search|search\s*(results|properties|parcels)/i },
];

/** Classify the current page's surface from its title/url/headings. */
export function classifySurface(obs: PageObservation): SurfaceClass {
  const hay = `${obs.title} ${obs.url} ${obs.headings.join(' ')}`;
  for (const { cls, rx } of SURFACE_RX) if (rx.test(hay)) return cls;
  return 'other';
}

// Forbidden = never click (protects against paid/destructive actions).
const FORBIDDEN_NAV_RX = /billing|payment|checkout|\bpay\b|purchase|\bbuy\b|credit|subscri|upgrade|pricing|cart|invoice|skip\s*trace|mailing|order|account\s*settings|^settings$|delete|cancel\s*subscription/i;
// Restricted = needs explicit approval (e.g. account creation).
const RESTRICTED_NAV_RX = /create\s*account|sign\s*up|register|new\s*(list|filtered\s*list)|export/i;
// The work surface for a parcel-search task.
const SEARCH_NAV_RX = /map\s*search|property\s*search|parcel\s*search|^search$|search\s*(properties|parcels|map)|find\s*(a\s*)?(property|parcel)/i;

export function isForbiddenTarget(text: string): boolean { return FORBIDDEN_NAV_RX.test(text); }

/** Does this page actually serve the parcel-search task? (Has a usable search
 *  control AND is not an account/orders/billing/settings surface.) */
export function pageServesTask(obs: PageObservation, want: SearchMethod): boolean {
  const surface = classifySurface(obs);
  if (surface === 'record' || surface === 'search') return true;
  if (surface === 'orders' || surface === 'billing' || surface === 'account' || surface === 'settings') return false;
  // 'dashboard'/'other': serve only if a real, matching search control exists.
  return !!planNavigationStrategy(obs, { kind: want, value: 'probe' });
}

export interface WorkSurfaceNav { text: string; reason: string }

/** Find the nav/menu/card item that leads to the parcel-search work surface.
 *  Prefers explicit search destinations; NEVER returns a forbidden target. */
export function findWorkSurfaceNav(obs: PageObservation, _want: SearchMethod): WorkSurfaceNav | null {
  const targets = [...obs.navItems, ...obs.buttons, ...obs.links.map((l) => l.text)].map((s) => (s || '').trim()).filter(Boolean);
  const uniq = [...new Set(targets)];
  const allowed = uniq.filter((t) => !isForbiddenTarget(t));
  // 1) explicit search surface
  const search = allowed.find((t) => SEARCH_NAV_RX.test(t));
  if (search) return { text: search, reason: `Nav "${search}" leads to the parcel-search surface.` };
  // 2) generic "search"/"map" entry that isn't forbidden/restricted
  const generic = allowed.find((t) => /\b(search|map|find|lookup|properties|parcels)\b/i.test(t) && !RESTRICTED_NAV_RX.test(t));
  if (generic) return { text: generic, reason: `Nav "${generic}" looks like the search/map entry.` };
  return null;
}

export interface TaskBoundary { allowed: string[]; restricted: string[]; forbidden: string[] }

/** Derive a platform's allowed / restricted / forbidden work surfaces from its
 *  nav so the boundary becomes learned Platform Intelligence. Generic. */
export function deriveTaskBoundary(obs: PageObservation): TaskBoundary {
  const items = [...new Set([...obs.navItems, ...obs.buttons].map((s) => (s || '').trim()).filter(Boolean))];
  const forbidden = items.filter((t) => FORBIDDEN_NAV_RX.test(t));
  const restricted = items.filter((t) => !FORBIDDEN_NAV_RX.test(t) && RESTRICTED_NAV_RX.test(t));
  const allowed = items.filter((t) => !FORBIDDEN_NAV_RX.test(t) && !RESTRICTED_NAV_RX.test(t) && (SEARCH_NAV_RX.test(t) || /research|report|map|search|comp/i.test(t)));
  return { allowed, restricted, forbidden };
}

// ── INTERACT — select a non-anchor result (GIS rows, cards, popups, divs) ────
//
// Modern apps return results that are NOT <a href> links: GIS map popups,
// clickable result rows/cards, side panels, JS lists. A driver reads candidate
// clickable elements; this scores them against the target and selects the best
// ONLY at high confidence (no weak-match, no guessing). Generic across platforms.

export interface ResultCandidate {
  /** Stable index into the driver's deterministic candidate collection. */
  index: number;
  text: string;
  /** row | card | button | popup | cell | option | element. */
  kind: string;
}

export interface CandidateScore {
  index: number;
  score: number;
  matched: string[];
  confidence: 'high' | 'medium' | 'low';
}

function compact(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Score one candidate against the target. Strong identifiers (APN, full
 *  number+street address) carry the weight; owner/county/state are context only.
 *  Pure. */
export function scoreResultCandidate(c: ResultCandidate, key: { apn?: string; address?: string; owner?: string; city?: string; county?: string; state?: string }): CandidateScore {
  const hayRaw = c.text.toLowerCase();
  const hayC = compact(c.text);
  const matched: string[] = [];
  let score = 0;
  let strong = false;

  if (key.apn) { const a = compact(key.apn); if (a.length >= 5 && hayC.includes(a)) { score += 0.6; matched.push('apn'); strong = true; } }
  if (key.address) {
    const num = (key.address.match(/^\s*(\d+)/) || [])[1];
    const street = key.address.split(',')[0].replace(/^\s*\d+\s*/, '').trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const numHit = num ? new RegExp(`\\b${num}\\b`).test(hayRaw) : false;
    const streetHits = street.filter((w) => hayRaw.includes(w)).length;
    if (numHit && streetHits >= 1) { score += 0.6; matched.push('address'); strong = true; }
    else if (streetHits >= 1) { score += 0.15; matched.push('street'); }
  }
  if (key.owner) { const surname = key.owner.toLowerCase().replace(/[,.].*$/, '').split(/\s+/).pop() || ''; if (surname.length > 2 && hayRaw.includes(surname)) { score += 0.2; matched.push('owner'); } }
  // City/locality disambiguates same-APN parcels across counties (LandPortal
  // candidate rows show the CITY, e.g. "HELENWOOD" vs "LIMESTONE", not the county).
  if (key.city) { const cityTokens = key.city.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3); if (cityTokens.some((w) => hayRaw.includes(w))) { score += 0.25; matched.push('city'); } }
  if (key.county && hayRaw.includes(key.county.toLowerCase())) { score += 0.1; matched.push('county'); }
  if (key.state && new RegExp(`\\b${key.state.toLowerCase()}\\b`).test(hayRaw)) { score += 0.1; matched.push('state'); }

  // HIGH only when a strong identifier (APN or full address) matched AND total
  // clears the bar — never a weak match.
  const confidence: CandidateScore['confidence'] = strong && score >= 0.6 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  return { index: c.index, score: Math.min(score, 1), matched, confidence };
}

/** Pick the single best candidate — returns it ONLY at high confidence; otherwise
 *  null (caller must not click / must report a blocker). No weak-match. Pure. */
export function pickBestCandidate(candidates: ResultCandidate[], key: { apn?: string; address?: string; owner?: string; city?: string; county?: string; state?: string }): CandidateScore | null {
  const scored = candidates.map((c) => scoreResultCandidate(c, key)).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.confidence !== 'high') return null;
  // Reject ambiguity: a runner-up tying the best is not a confident pick.
  if (scored[1] && scored[1].confidence === 'high' && scored[1].score === best.score) return null;
  return best;
}

/** One ranked search method with why it was chosen (primary vs fallback/cross-check). */
export interface RankedSearchMethod {
  method: SearchMethod;
  role: 'primary' | 'fallback';
  reason: string;
}

/** The identifiers a site can search by (from the intake). */
export interface SearchIdentifiers {
  apn?: string;
  address?: string;
  owner?: string;
}

/** A full street address carries a house number; a bare road name does not (an
 *  address geocoder returns a road segment, not a parcel, for a house-number-less
 *  road). Pure. */
export function isFullStreetAddress(address?: string): boolean {
  return !!address && /^\s*\d/.test(address.trim());
}

/**
 * EVIDENCE-DRIVEN search strategy — generic across EVERY Browser Intelligence site.
 * There is NO universal chronological order. Given the identifiers present in the
 * intake, rank the lookup paths by strength for the task and return them ordered:
 * the strongest STARTING identifier is `primary`, the rest are `fallback` (also
 * usable as cross-check evidence). The site maps each method to its own workflow
 * (e.g. LandPortal APN/Parcel-ID search mode) and value formatting.
 *
 * Strength order: APN / Parcel ID (an exact parcel key) > full street address
 * (house-numbered) > owner name > a bare road name (weakest — no house number).
 * Only methods with a usable identifier are included, so the FIRST element is
 * always the best available start, never a fixed method.
 */
export function rankSearchMethods(key: SearchIdentifiers): RankedSearchMethod[] {
  const hasApn = !!(key.apn && key.apn.trim());
  const fullStreet = isFullStreetAddress(key.address);
  const bareAddress = !!(key.address && key.address.trim()) && !fullStreet;
  const hasOwner = !!(key.owner && key.owner.trim());

  const ordered: SearchMethod[] = [];
  if (hasApn) ordered.push('apn');            // exact parcel key — strongest
  if (fullStreet) ordered.push('address');    // house-numbered address
  if (hasOwner) ordered.push('owner');        // owner name
  if (bareAddress) ordered.push('address');   // bare road — weakest fallback

  const reasonFor = (m: SearchMethod): string =>
    m === 'apn' ? 'APN / Parcel ID is an exact parcel key.'
      : m === 'owner' ? 'Owner name (no stronger parcel identifier present).'
        : fullStreet ? 'Full street address (house-numbered).'
          : 'Road name only (weak — no house number).';

  return ordered.map((method, i) => ({ method, role: i === 0 ? 'primary' : 'fallback', reason: reasonFor(method) }));
}

// ── VERIFY — confirm the requested page was actually reached ──────────────────

export type PageType = 'record_detail' | 'results_list' | 'search_form' | 'dashboard' | 'login' | 'error' | 'unknown';

export interface TargetVerification {
  pageType: PageType;
  reached: boolean;
  reason: string;
}

const FORMY_LABELS = /(is\s+is\s+not|n\/a\s+yes\s+no|press\s+enter|exclude\/include|^[nsew ]+$|tokens?\s*[x×]|subtotal|add\s*to\s*saved)/i;

/**
 * Verify we are on a page that actually contains the requested information —
 * NEVER a search form / filter controls / dropdown options / menu / dashboard /
 * token display. Detects the formy/garbage signals that produced false facts.
 * Pure: caller extracts only when reached === true.
 */
export function verifyTargetReached(obs: PageObservation, opts: { expectIdentifier?: string } = {}): TargetVerification {
  if (obs.loginLike) return { pageType: 'login', reached: false, reason: 'Login page — not authenticated.' };
  if (/404|not\s*found|error/i.test(obs.title)) return { pageType: 'error', reached: false, reason: 'Error / not-found page.' };

  const fieldKeys = Object.keys(obs.fields);
  const fieldVals = Object.values(obs.fields);
  // Garbage signal: many "fields" whose VALUES are option lists / filter operators.
  const formyVals = fieldVals.filter((v) => FORMY_LABELS.test(v)).length;
  const looksLikeSearchForm = obs.searchControls.length >= 4 && formyVals >= 2 && fieldKeys.length > 0;
  if (looksLikeSearchForm) return { pageType: 'search_form', reached: false, reason: 'On a search/filter form (filter controls + option-list values) — extraction would be false facts.' };

  // A record detail page: several record-like labels (owner/parcel/acre/value)
  // whose VALUES are real data (not filter options). Global page chrome — a token
  // counter, cart subtotal — is ignored: only the RECORD-labeled fields must be
  // clean, so a real parcel panel is recognized even alongside that chrome.
  const RECORD_LABEL = /owner|parcel|apn|acre|address|situs|assess|deed|tax|zon|use|legal|sqft|frontage/i;
  const recordKeys = fieldKeys.filter((k) => RECORD_LABEL.test(k));
  const realRecordPairs = recordKeys.filter((k) => { const v = obs.fields[k]; return v && v.length > 0 && !FORMY_LABELS.test(v); }).length;
  const idHit = opts.expectIdentifier ? fieldVals.some((v) => v.replace(/[ .\-/]/g, '').includes(opts.expectIdentifier!.replace(/[ .\-/]/g, ''))) : false;
  if (realRecordPairs >= 3) return { pageType: 'record_detail', reached: true, reason: `Record detail page (${realRecordPairs} record fields with real values${idHit ? ', identifier confirmed' : ''}).` };
  if (realRecordPairs >= 1 && idHit) return { pageType: 'record_detail', reached: true, reason: 'Record detail page (identifier confirmed in fields).' };
  const recordLabels = realRecordPairs;

  // Results list: multiple links/rows that look like records.
  if (obs.hasTable && obs.links.some((l) => /detail|parcel|record|result|view/i.test(`${l.text} ${l.href}`))) return { pageType: 'results_list', reached: false, reason: 'Search results list — open the matching record first.' };
  if (obs.hasMap && recordLabels < 3) return { pageType: 'dashboard', reached: false, reason: 'Map/dashboard view — no parcel record reached yet.' };

  return { pageType: 'unknown', reached: false, reason: 'Could not confirm a record page; extracting would risk false facts (Unknown preferred over incorrect).' };
}
