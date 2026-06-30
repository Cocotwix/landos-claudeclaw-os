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

  // 2) Find the input to fill — prefer one matching the wanted method, else the
  //    method selector's own field, else a general search control.
  const input = controlForMethod(obs, want)
    ?? (sel && sel.type !== 'select-one' ? sel : undefined)
    ?? obs.searchControls.find((c) => /search|find|lookup|query/i.test([c.label, c.placeholder, c.name].filter(Boolean).join(' ')))
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

  // A record detail page: identifier present in the visible fields + several
  // record-like labels (owner/parcel/acre/value), and NOT dominated by filters.
  const recordLabels = fieldKeys.filter((k) => /owner|parcel|apn|acre|address|assess|deed|tax|zon|use|legal/i.test(k)).length;
  const idHit = opts.expectIdentifier ? fieldVals.some((v) => v.replace(/[ .\-/]/g, '').includes(opts.expectIdentifier!.replace(/[ .\-/]/g, ''))) : false;
  if (recordLabels >= 3 && formyVals === 0) return { pageType: 'record_detail', reached: true, reason: `Record detail page (${recordLabels} record fields${idHit ? ', identifier confirmed' : ''}).` };
  if (recordLabels >= 1 && idHit) return { pageType: 'record_detail', reached: true, reason: 'Record detail page (identifier confirmed in fields).' };

  // Results list: multiple links/rows that look like records.
  if (obs.hasTable && obs.links.some((l) => /detail|parcel|record|result|view/i.test(`${l.text} ${l.href}`))) return { pageType: 'results_list', reached: false, reason: 'Search results list — open the matching record first.' };
  if (obs.hasMap && recordLabels < 3) return { pageType: 'dashboard', reached: false, reason: 'Map/dashboard view — no parcel record reached yet.' };

  return { pageType: 'unknown', reached: false, reason: 'Could not confirm a record page; extracting would risk false facts (Unknown preferred over incorrect).' };
}
