// LandOS visual browser agents — ARCHITECTURE PLACEHOLDERS ONLY.
//
// Two distinct agents, intentionally separate. NOTHING here browses, installs a
// dependency, opens a browser, makes a network call, or stores a secret this
// sprint. These are interfaces + an unavailable placeholder provider so the rest
// of LandOS can route to them later without a refactor.
//
// Recommended open-source-compatible visual stack (NOT installed here): a
// Hermes-style visual browser model such as UI-TARS / Agent TARS, or a
// Qwen2.5-VL / Qwen-VL grounding model driving a headless browser. Selection
// happens behind the provider/capability abstraction, like every other vendor.
export const OSS_VISUAL_BROWSER_STACK_NOTE =
  'Intended OSS stack: UI-TARS / Agent TARS or Qwen2.5-VL-style visual grounding model ' +
  'driving a headless browser. Not installed this sprint. Selected behind the capability/provider ' +
  'abstraction; never hardcoded into business workflow.';

// ─────────────────────────────────────────────────────────────────────────
// 1) County Records Browser Agent — an OFFICIAL-RECORD PARCEL/DD PROVIDER.
//    It is a provider under parcel-identity / county-records capabilities, NOT a
//    chat assistant. Strict exact-identity + official-source + no-proximity rules.
// ─────────────────────────────────────────────────────────────────────────

/** Exact identifiers ONLY. There is deliberately no coordinate/lat-long/point
 *  field on this type — parcel identity is never derived from geography. */
export interface ExactParcelIdentifiers {
  fullAddress?: string;
  partialAddress?: string;
  apn?: string;            // parcel id
  ownerName?: string;      // requires city/state OR county/state alongside
  city?: string;
  county?: string;
  state?: string;
  legalDescription?: string;
  knownPropertyId?: string;
}

/** Methods this agent must NEVER use to identify a parcel (enforced by contract
 *  + tests; the input type above simply has no field for any of them). */
export const COUNTY_BROWSER_FORBIDDEN_METHODS = [
  'coordinates_to_identify_parcel',
  'nearest_parcel_lookup',
  'map_pins',
  'road_midpoint',
  'geocoder_result',
  'town_centroid',
  'zip_centroid',
  'proximity_inference',
] as const;

/** Official record source kinds the county agent may eventually navigate. */
export const COUNTY_OFFICIAL_SOURCE_KINDS = [
  'county_assessor',
  'county_tax_records',
  'county_gis',
  'county_recorder_public',
  'county_property_appraiser',
  'parcel_maps',
  'zoning_maps',
  'gis_layers',
  'county_planning',
  'official_municipal_records',
] as const;

export type ParcelMatchStatus = 'Verified' | 'Ambiguous' | 'Not Found' | 'Needs Verification';

/** Canonical, normalized county-record finding with full provenance. */
export interface CountyRecordFinding {
  provider: string;                 // e.g. 'county_records_browser'
  officialSourceUrl: string | null; // the official page used, when safe
  sourceTimestamp: string;          // ISO time the record was read
  searchedIdentifier: string;       // what we searched by
  matchedIdentifier: string | null; // what the record matched
  matchConfidence: 'high' | 'medium' | 'low' | 'none';
  status: ParcelMatchStatus;
  /** If exact parcel identity cannot be verified, this is set and status is
   *  'Needs Verification' — never a scored/valued result. */
  localAreaContextOnly?: 'Local Area Context, Not Parcel Verified';
  /** Page-evidence refs (paths/urls) when useful. Never secrets. */
  evidenceRefs?: string[];
  /** Raw reference kept only when safe to retain. */
  rawReference?: unknown;
  note: string;
}

export interface CountyRecordsBrowserProvider {
  readonly id: 'county_records_browser';
  readonly label: string;
  /** Presence/readiness — false until the visual stack is wired + approved. */
  configured(): boolean;
  /** Health probe — placeholder reports unavailable (no browser launched). */
  health(): Promise<{ healthy: boolean; reason: string }>;
  /** Resolve parcel identity from EXACT identifiers via official records only. */
  resolveParcel(ids: ExactParcelIdentifiers, opts: { timeoutMs: number }): Promise<CountyRecordFinding>;
}

/** Unavailable placeholder. Launches no browser, makes no call, fabricates no
 *  parcel. Registered by the parcel-identity capability as a not-yet-ready
 *  official-record fallback so the wiring exists ahead of the implementation. */
export function makeCountyRecordsBrowserPlaceholder(): CountyRecordsBrowserProvider {
  return {
    id: 'county_records_browser',
    label: 'County Records Browser Agent (official records, exact-identity only) — not yet wired',
    configured() { return false; },
    async health() {
      return { healthy: false, reason: 'County Records Browser Agent is a placeholder; visual browser stack not installed/approved.' };
    },
    async resolveParcel(): Promise<CountyRecordFinding> {
      throw new Error('county_records_browser not implemented (placeholder provider; no browser automation this sprint).');
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2) General Visual Browser Assistant — a SEPARATE general-purpose agent.
//    Deliberately distinct from the county agent: no parcel-identity guardrails,
//    used for ad-hoc web tasks. Not a parcel/DD provider.
// ─────────────────────────────────────────────────────────────────────────

export interface GeneralVisualBrowserTaskResult {
  ok: boolean;
  summary: string;
  screenshots?: string[];
  findings?: unknown;
  note: string;
}

export interface GeneralVisualBrowserAssistant {
  readonly id: 'general_visual_browser';
  readonly label: string;
  configured(): boolean;
  health(): Promise<{ healthy: boolean; reason: string }>;
  /** Run a general web task. Form fills / writes require explicit approval at the
   *  call site; the placeholder performs nothing. */
  run(task: { goal: string; allowFormFill?: boolean }, opts: { timeoutMs: number }): Promise<GeneralVisualBrowserTaskResult>;
}

/** Unavailable placeholder for the general assistant. Does nothing this sprint. */
export function makeGeneralVisualBrowserPlaceholder(): GeneralVisualBrowserAssistant {
  return {
    id: 'general_visual_browser',
    label: 'General Visual Browser Assistant — not yet wired',
    configured() { return false; },
    async health() {
      return { healthy: false, reason: 'General Visual Browser Assistant is a placeholder; visual browser stack not installed/approved.' };
    },
    async run(): Promise<GeneralVisualBrowserTaskResult> {
      throw new Error('general_visual_browser not implemented (placeholder; no browser automation this sprint).');
    },
  };
}
