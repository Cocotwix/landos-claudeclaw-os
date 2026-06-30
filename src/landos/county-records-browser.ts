// LandOS — County Records Browser service (Phase 4).
//
// Fills gaps left by LandPortal and verifies critical PUBLIC records. It browses
// county sites like an experienced land researcher — assessor, tax office, GIS,
// recorder, clerk, planning, zoning, deeds, plat maps, tax history, ownership,
// parcel maps, road frontage, recorded documents, and other public resources. It
// is NOT a restricted robot: it follows links, opens PDFs, reads tables, and
// extracts data. If NETR links fail, it searches intelligently for the current
// county site and continues — it never stops because a link changed.
//
// Workflow mode retrieves ONLY what is still missing after LandPortal (gap-fill,
// no duplicate retrieval). Ask mode answers natural public-record questions and
// determines the correct workflow automatically. Public records require no login;
// it only stops for payments, credentialed logins, destructive actions, or
// unsolvable CAPTCHAs. Driver is injectable; the default parked stub never fakes.

import {
  type BrowserService, type BrowserDriver, type BrowserEvidence, type BrowserWorkflowInput,
  type BrowserSearchKey,
  makeParkedDriver, emptyEvidence, routeBrowserQuestion, recordBlocked,
} from './browser-intelligence.js';
import { planNetrWorkflow, countySearchFallbackQuery, type NetrStep } from './browser-retrieval.js';
import { COUNTY_WORKFLOW_FOR, type DdField } from './missing-field-analysis.js';

/** County workflow targets (the public resources the researcher navigates). */
export const COUNTY_WORKFLOWS = [
  'assessor', 'tax_office', 'gis', 'recorder', 'clerk', 'planning_zoning',
] as const;
export type CountyWorkflow = (typeof COUNTY_WORKFLOWS)[number];

/** Map a county workflow to the NETR navigation step it begins from. */
const WORKFLOW_NETR_STEP: Record<string, NetrStep> = {
  assessor: 'locate_assessor',
  tax_office: 'locate_tax_records',
  gis: 'locate_gis',
  recorder: 'locate_recorder',
  clerk: 'locate_recorder',
  planning_zoning: 'locate_county',
};

export interface CountyRecordsBrowserDeps {
  driver?: BrowserDriver;
  now?: () => string;
}

/** Reasons the county researcher legitimately stops (and records as blocked). */
export const COUNTY_STOP_CONDITIONS = ['payment', 'credentialed_login', 'destructive_action', 'unsolvable_captcha'] as const;

function workflowsForNeeded(neededFields?: string[]): CountyWorkflow[] {
  if (!neededFields || neededFields.length === 0) return [...COUNTY_WORKFLOWS];
  const set = new Set<string>();
  for (const f of neededFields) {
    const wf = COUNTY_WORKFLOW_FOR[f as DdField];
    if (wf) set.add(wf);
  }
  // Always include planning_zoning if zoning-ish gaps exist; assessor as baseline.
  return [...set].filter((w): w is CountyWorkflow => (COUNTY_WORKFLOWS as readonly string[]).includes(w));
}

/**
 * County Records workflow. For each needed workflow, plan the NETR navigation
 * (with per-step intelligent-search fallback when a link fails) and, with a live
 * driver, navigate → read → extract. Gap-fill only (no duplicate retrieval). A
 * parked driver returns honest `parked` evidence listing the planned navigation.
 */
async function runCountyWorkflow(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('county_records', 'workflow');
  const key = input.searchKey;
  const targets = workflowsForNeeded(input.neededFields);
  const netr = planNetrWorkflow({ county: key.county, state: key.state }, { configured: driver.configured() });

  if (!driver.configured()) {
    ev.status = 'parked';
    ev.sourceUrls.push(netr.directoryUrl);
    ev.note = `County Records browser parked: visual stack not enabled. Planned gap-fill workflows: ${targets.join(', ')}. NETR navigation + intelligent-search fallback are defined; nothing is collected twice (LandPortal-first). No login/credential required for public records.`;
    return ev;
  }

  try {
    const collected: Record<string, string> = {};
    for (const wf of targets) {
      const step = WORKFLOW_NETR_STEP[wf] ?? 'locate_county';
      const fallbackQuery = countySearchFallbackQuery({ county: key.county, state: key.state, step });
      // Try the NETR directory first; on a failed/changed link, search intelligently.
      let read;
      try {
        const entry = await driver.open(netr.directoryUrl, { timeoutMs });
        ev.sourceUrls.push(entry.url || netr.directoryUrl);
        read = await driver.search(searchTerm(key), { timeoutMs });
      } catch {
        // NETR link failed — find the current county site via intelligent search.
        read = await driver.search(fallbackQuery, { timeoutMs });
      }
      if (read?.url) ev.sourceUrls.push(read.url);
      for (const [k, v] of Object.entries(read?.fields ?? {})) {
        if (v && !collected[k]) collected[k] = String(v).trim();
      }
    }
    ev.fields = collected;
    ev.patch = countyPatch(collected);
    ev.status = Object.keys(collected).length ? 'retrieved' : 'partial';
    ev.note = `County Records filled gaps via ${targets.join(', ')} (public records; LandPortal-first, no duplicate retrieval).`;
    return ev;
  } catch (err) {
    ev.status = 'error';
    ev.note = `County Records run stopped before any payment/login: ${(err as Error)?.message ?? 'unknown error'}.`;
    return ev;
  }
}

function searchTerm(key: BrowserSearchKey): string {
  return [key.apn, key.address, key.owner, key.county, key.state].filter(Boolean).join(' ');
}

function countyPatch(fields: Record<string, string>): BrowserEvidence['patch'] {
  const patch: BrowserEvidence['patch'] = {};
  const get = (...names: string[]) => {
    const k = Object.keys(fields).find((x) => names.some((n) => x.toLowerCase().includes(n)));
    return k ? fields[k] : undefined;
  };
  const owner = get('owner');
  if (owner) patch.owner = owner;
  const apn = get('apn', 'parcel id', 'parcel number');
  if (apn) patch.apn = apn;
  const county = get('county');
  if (county) patch.county = county;
  return patch;
}

export function makeCountyRecordsBrowser(deps: CountyRecordsBrowserDeps = {}): BrowserService {
  const driver = deps.driver ?? makeParkedDriver('county_records');
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    id: 'county_records',
    label: 'County Records Browser (public-record research)',
    modes: ['workflow', 'ask'],
    configured() { return driver.configured(); },
    runWorkflow(input, opts) { return runCountyWorkflow(input, driver, now, opts.timeoutMs); },
    async ask(question, ctx, opts) {
      const route = routeBrowserQuestion(question, ctx);
      // Map the asked intent to its county workflow target.
      const wf = COUNTY_WORKFLOW_FOR[route.intent as DdField] ?? 'assessor';
      const ev = await runCountyWorkflow({ searchKey: route.searchKey, neededFields: [route.intent] }, driver, now, opts.timeoutMs);
      ev.mode = 'ask';
      if (ev.status !== 'parked' && ev.status !== 'error') ev.note = `Asked: "${route.intent}" → ${wf}. ${ev.note}`;
      return ev;
    },
  };
}

/** The county researcher legitimately stops only for payment/login/destructive/
 *  CAPTCHA — recorded as blocked, never a refusal to do normal public research. */
export function countyStopExample(condition: (typeof COUNTY_STOP_CONDITIONS)[number]): BrowserEvidence {
  const ev = emptyEvidence('county_records', 'workflow');
  if (condition === 'payment') recordBlocked(ev, 'purchase', 'A paid record purchase was required — stopped (no payment).');
  else if (condition === 'credentialed_login') recordBlocked(ev, 'store_credentials', 'A credentialed login was required — stopped (no credential stored).');
  else if (condition === 'destructive_action') recordBlocked(ev, 'any_write', 'A write/destructive action was required — stopped.');
  else recordBlocked(ev, 'navigate', 'An unsolvable CAPTCHA blocked navigation — stopped.');
  ev.status = 'blocked';
  ev.note = `County research stopped only for: ${condition}. It otherwise browses public records freely.`;
  return ev;
}
