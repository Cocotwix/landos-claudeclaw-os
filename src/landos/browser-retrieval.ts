// LandOS — Browser Retrieval Layer.
//
// Its job is FINDING THE PROPERTY, never writing reports. When structured
// retrieval (Realie/LandPortal/HomeHarvest) is incomplete, the resolution engine
// launches browser lanes that navigate public sources and feed normalized
// findings back. This module defines the lane CONTRACTS, the NETR navigation
// workflow, and the STRICT read-only guards for LandPortal / Land ID. It launches
// NO browser, installs NO dependency, stores NO credential this sprint: the
// concrete drivers are install-gated behind the visual stack (see browser-agents).
//
// Every lane returns the SAME normalized finding shape so the engine merges them
// like any structured lane. Pure + deterministic contracts + URL/workflow
// builders; placeholders report `parked` honestly.

import type { PropertyPatch, RetrievalLane } from './normalized-property.js';

// ─────────────────────────────────────────────────────────────────────────
// Lane contract
// ─────────────────────────────────────────────────────────────────────────

export type BrowserLaneStatus = 'matched' | 'partial' | 'no_match' | 'parked' | 'error';

export interface BrowserFinding {
  lane: RetrievalLane;
  source: string;
  /** Public URL read, when safe. Never a credentialed/session URL. */
  sourceUrl?: string;
  status: BrowserLaneStatus;
  /** Normalized fields the lane could read (fed into the engine). */
  patch: PropertyPatch;
  /** 0..1 confidence in the contributed identity. */
  confidence: number;
  /** Evidence snippets (visible text), never secrets. */
  evidence: string[];
  note: string;
}

export interface BrowserLaneInput {
  address?: string;
  city?: string;
  state?: string;
  county?: string;
  zip?: string;
  apn?: string;
  owner?: string;
}

export interface BrowserRetrievalLane {
  readonly id: RetrievalLane;
  readonly label: string;
  /** Read-only by contract — a lane that could write/purchase is rejected. */
  readonly readOnly: true;
  /** Presence/readiness. False until the visual stack is installed + approved. */
  configured(): boolean;
  /** Find the property. Placeholders return `parked`; never browse this sprint. */
  find(input: BrowserLaneInput, opts: { timeoutMs: number }): Promise<BrowserFinding>;
}

// ─────────────────────────────────────────────────────────────────────────
// STRICT read-only guards (LandPortal / Land ID)
// ─────────────────────────────────────────────────────────────────────────

/** Actions a strict read-only lane may take. */
export const READONLY_ALLOWED_ACTIONS = ['search', 'navigate', 'zoom', 'view', 'copy_visible', 'extract_visible'] as const;
export type ReadOnlyAction = (typeof READONLY_ALLOWED_ACTIONS)[number];

/** Actions a strict read-only lane must NEVER take. Enforced by assertReadOnly. */
export const READONLY_FORBIDDEN_ACTIONS = [
  'generate_paid_report',
  'click_report_generation',
  'purchase',
  'consume_credits',
  'download_paid_product',
  'modify_account_settings',
  'modify_billing',
  'any_write',
  'store_credentials',
  'hardcode_credentials',
] as const;
export type ForbiddenAction = (typeof READONLY_FORBIDDEN_ACTIONS)[number];

export class ReadOnlyViolation extends Error {
  constructor(public action: string) {
    super(`STRICT read-only lane attempted a forbidden action: ${action}. Blocked.`);
    this.name = 'ReadOnlyViolation';
  }
}

/** Throws if an action is not in the read-only allow-list. The single gate every
 *  LandPortal / Land ID interaction must pass before it runs. */
export function assertReadOnly(action: string): asserts action is ReadOnlyAction {
  if (!(READONLY_ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    throw new ReadOnlyViolation(action);
  }
}

export function isForbiddenAction(action: string): action is ForbiddenAction {
  return (READONLY_FORBIDDEN_ACTIONS as readonly string[]).includes(action);
}

// ─────────────────────────────────────────────────────────────────────────
// NETR Online navigation directory + workflow
// ─────────────────────────────────────────────────────────────────────────

export const NETR_BASE = 'https://publicrecords.netronline.com/';

/** The NETR navigation workflow: NETR is a DIRECTORY, not a data source. Walk it
 *  to locate the county's official sources, then read those. Ordered. */
export const NETR_WORKFLOW_STEPS = [
  'locate_county',
  'locate_assessor',
  'locate_gis',
  'locate_parcel_map',
  'locate_recorder',
  'locate_tax_records',
] as const;
export type NetrStep = (typeof NETR_WORKFLOW_STEPS)[number];

const STATE_SLUG: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado',
  CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho',
  IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi',
  MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new-hampshire', NJ: 'new-jersey',
  NM: 'new-mexico', NY: 'new-york', NC: 'north-carolina', ND: 'north-dakota', OH: 'ohio', OK: 'oklahoma',
  OR: 'oregon', PA: 'pennsylvania', RI: 'rhode-island', SC: 'south-carolina', SD: 'south-dakota',
  TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington',
  WV: 'west-virginia', WI: 'wisconsin', WY: 'wyoming',
};

/** Build the NETR state directory URL (the entry point to county navigation). */
export function buildNetrStateUrl(state?: string): string {
  const slug = state ? STATE_SLUG[state.trim().toUpperCase()] : undefined;
  return slug ? `${NETR_BASE}${slug}` : NETR_BASE;
}

/** A browser-search fallback query when a NETR link fails — used to locate the
 *  county's official site directly. Deterministic; no call made here. */
export function countySearchFallbackQuery(input: { county?: string; state?: string; step: NetrStep }): string {
  const place = [input.county && `${input.county} County`, input.state].filter(Boolean).join(' ');
  const target = {
    locate_county: 'official county website',
    locate_assessor: 'county assessor property search',
    locate_gis: 'county GIS parcel viewer',
    locate_parcel_map: 'county parcel map',
    locate_recorder: 'county recorder deeds public records',
    locate_tax_records: 'county tax collector property tax records',
  }[input.step];
  return `${place} ${target}`.trim();
}

export interface NetrWorkflowPlan {
  directoryUrl: string;
  steps: Array<{ step: NetrStep; intent: string; fallbackQuery: string }>;
  /** Whether NETR navigation can actually run now (visual stack configured). */
  executable: boolean;
  note: string;
}

/** Plan the NETR navigation for a county/state. If a NETR link fails at run time,
 *  the lane uses the per-step fallbackQuery via browser search. Pure. */
export function planNetrWorkflow(input: { county?: string; state?: string }, opts: { configured?: boolean } = {}): NetrWorkflowPlan {
  const executable = opts.configured === true;
  return {
    directoryUrl: buildNetrStateUrl(input.state),
    steps: NETR_WORKFLOW_STEPS.map((step) => ({
      step,
      intent: step.replace(/_/g, ' '),
      fallbackQuery: countySearchFallbackQuery({ county: input.county, state: input.state, step }),
    })),
    executable,
    note: executable
      ? 'NETR navigation ready.'
      : 'NETR navigation is a parked lane: the visual browser stack is not installed/approved. Workflow + fallbacks are defined so the lane runs without a redesign once enabled.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Parked placeholder lanes (no browser launched this sprint)
// ─────────────────────────────────────────────────────────────────────────

function parkedFinding(lane: RetrievalLane, source: string, note: string): BrowserFinding {
  return { lane, source, status: 'parked', patch: {}, confidence: 0, evidence: [], note };
}

/** General public-web search lane to find the property (Google/Zillow/Realtor/
 *  county pages). Parked until the visual stack is wired. */
export function makeBrowserSearchLane(opts: { configured?: boolean } = {}): BrowserRetrievalLane {
  return {
    id: 'browser_search', label: 'Public web search (find the property)', readOnly: true,
    configured() { return opts.configured === true; },
    async find() { return parkedFinding('browser_search', 'Public web search', 'Browser search lane parked: visual stack not installed/approved.'); },
  };
}

/** NETR-driven county-records lane. Parked until the visual stack is wired. */
export function makeNetrLane(opts: { configured?: boolean } = {}): BrowserRetrievalLane {
  return {
    id: 'netr', label: 'NETR Online → county assessor/GIS/recorder', readOnly: true,
    configured() { return opts.configured === true; },
    async find(input) {
      const plan = planNetrWorkflow({ county: input.county, state: input.state }, { configured: opts.configured });
      return { ...parkedFinding('netr', 'NETR Online', plan.note), sourceUrl: plan.directoryUrl };
    },
  };
}

/** County GIS / assessor lane (a normalized official-record provider). Parked. */
export function makeCountyGisLane(opts: { configured?: boolean } = {}): BrowserRetrievalLane {
  return {
    id: 'county_gis', label: 'County GIS / assessor / parcel map', readOnly: true,
    configured() { return opts.configured === true; },
    async find() { return parkedFinding('county_gis', 'County GIS / assessor', 'County GIS lane parked: visual stack not installed/approved.'); },
  };
}

/** LandPortal browser lane — STRICT read-only. Search/navigate/zoom/view/copy
 *  visible facts ONLY. Never generates a paid report, consumes credits, or writes.
 *  Requires an existing authenticated browser session (never stores credentials);
 *  parked when no session/visual stack is available. */
export function makeLandPortalReadOnlyLane(opts: { configured?: boolean; authenticatedSession?: boolean } = {}): BrowserRetrievalLane {
  return {
    id: 'landportal_readonly', label: 'LandPortal (STRICT read-only — visible facts only)', readOnly: true,
    configured() { return opts.configured === true && opts.authenticatedSession === true; },
    async find() {
      const reason = opts.authenticatedSession
        ? 'LandPortal read-only lane parked: visual stack not installed/approved.'
        : 'LandPortal read-only lane parked: no existing authenticated session (credentials are never stored/hardcoded).';
      return parkedFinding('landportal_readonly', 'LandPortal (read-only)', reason);
    },
  };
}

/** Land ID browser lane — STRICT read-only, identical protections as LandPortal. */
export function makeLandIdReadOnlyLane(opts: { configured?: boolean; authenticatedSession?: boolean } = {}): BrowserRetrievalLane {
  return {
    id: 'land_id_readonly', label: 'Land ID (STRICT read-only — visible facts only)', readOnly: true,
    configured() { return opts.configured === true && opts.authenticatedSession === true; },
    async find() {
      const reason = opts.authenticatedSession
        ? 'Land ID read-only lane parked: visual stack not installed/approved.'
        : 'Land ID read-only lane parked: no existing authenticated session (credentials are never stored/hardcoded).';
      return parkedFinding('land_id_readonly', 'Land ID (read-only)', reason);
    },
  };
}

/** The full default browser lane set, in resolution order. All parked until the
 *  visual stack is installed + approved (a gated install, not a code change). */
export function defaultBrowserLanes(opts: { configured?: boolean; landPortalSession?: boolean; landIdSession?: boolean } = {}): BrowserRetrievalLane[] {
  return [
    makeBrowserSearchLane({ configured: opts.configured }),
    makeNetrLane({ configured: opts.configured }),
    makeCountyGisLane({ configured: opts.configured }),
    makeLandPortalReadOnlyLane({ configured: opts.configured, authenticatedSession: opts.landPortalSession }),
    makeLandIdReadOnlyLane({ configured: opts.configured, authenticatedSession: opts.landIdSession }),
  ];
}

/** Status summary for the dashboard / final report. */
export function browserLaneStatus(opts: { configured?: boolean; landPortalSession?: boolean; landIdSession?: boolean } = {}): Array<{ id: RetrievalLane; label: string; configured: boolean; status: 'ready' | 'parked'; note: string }> {
  return defaultBrowserLanes(opts).map((l) => ({
    id: l.id, label: l.label, configured: l.configured(),
    status: l.configured() ? 'ready' : 'parked',
    note: l.configured() ? 'Ready.' : 'Parked: visual browser stack not installed/approved (or no authenticated session). Read-only contracts defined.',
  }));
}
