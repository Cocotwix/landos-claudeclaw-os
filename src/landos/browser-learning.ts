// LandOS — Browser Intelligence: inspect-and-learn fallback.
//
// The layer ABOVE the evidence-driven search strategy (rankSearchMethods). It does
// NOT replace it — it wraps a site retrieval attempt with automatic learning:
//
//   1. Try retrieval with the evidence-driven strategy (reusing a stored playbook
//      when one exists — no re-inspection).
//   2. If it SUCCEEDS, do nothing else (no inspection).
//   3. If it FAILS or hits an unexpected navigation path, INSPECT the site to learn
//      how it actually works (search modes, dropdowns, required fields, filters,
//      tabs, expandable sections, pagination, modals, result tables, parcel-detail
//      navigation, multi-step dependencies), SYNTHESIZE a reusable navigation
//      playbook, RETRY using it, and SAVE the playbook.
//   4. Future visits automatically reuse the saved playbook without re-inspecting.
//   5. If a stored playbook later fails (the site changed), automatically relearn
//      and bump the playbook version.
//
// Playbooks are site-specific, versioned, and updateable. They capture the
// navigation WORKFLOW (ordered steps) + learned STRUCTURE — never hardcoded parcel
// values. Generic across every Browser Intelligence site. Pure inspection/synthesis
// + a thin SQLite adapter. No secrets, no per-property data.

import { getLandosDb, landosAudit } from './db.js';
import { understandPlatform, type PageObservation, type SearchMethod, type NavStep } from './website-intelligence.js';
// browser-navigation-model imports inspectSite from THIS module; the cycle is safe
// because both sides use each other only inside function bodies (ESM live bindings).
import { learnNavigation, getNavigationModel as getNavigationModelDefault, type SiteNavigationModel } from './browser-navigation-model.js';

// ─────────────────────────────────────────────────────────────────────────
// Learned site structure (what inspection understands)
// ─────────────────────────────────────────────────────────────────────────

export interface SiteStructure {
  /** Search modes the site offers (apn/address/owner/latlng/general). */
  searchModes: SearchMethod[];
  /** A method selector/toggle exists (choose APN vs Address vs Owner). */
  hasMethodDropdown: boolean;
  /** Non-method <select> dropdowns (e.g. State, County, filters) by label. */
  dropdowns: string[];
  /** Fields that must be set before the search runs (e.g. State, County). */
  requiredFields: string[];
  /** Filter controls detected. */
  filters: string[];
  /** Tab-like navigation. */
  tabs: string[];
  /** Expandable/collapsible sections + panels (overlays, "show more", map). */
  expandableSections: string[];
  hasPagination: boolean;
  hasModals: boolean;
  hasResultTable: boolean;
  /** How the parcel detail page is opened, when learnable. */
  parcelDetailNav: string | null;
  /** The workflow needs ordered steps (scope-then-search etc.), not one box. */
  multiStep: boolean;
  notes: string[];
}

const STATE_RX = /^\s*state\s*$|select\s*state|choose\s*state/i;
const COUNTY_RX = /^\s*county\s*$|select\s*county|choose\s*county/i;
const FILTER_RX = /filter|acre|price|sort|type|status|range|beds?|baths?|year/i;
const TAB_RX = /overview|details?|owner|tax|sales|history|deeds?|map|comparables?|photos?|documents?/i;
const EXPAND_RX = /basemap|overlay|show\s*(on\s*map|more|all)|expand|3d|layers?|advanced/i;
const PAGINATION_RX = /next|previous|prev\b|page\s*\d|›|»|load\s*more/i;
const MODAL_RX = /close|dismiss|dialog|modal|got\s*it|continue|accept/i;

function controlLabels(obs: PageObservation): string[] {
  return obs.searchControls.map((c) => [c.label, c.placeholder, c.name, c.id].filter(Boolean).join(' ').trim()).filter(Boolean);
}

/** A method selector: one control whose OPTIONS name multiple search methods. */
function hasMethodSelector(obs: PageObservation): boolean {
  const methodish = /apn|parcel|address|owner|situs|lat/i;
  if (obs.methodToggle && methodish.test(obs.methodToggle.current)) return true;
  return obs.searchControls.some((c) => (c.options ?? []).filter((o) => methodish.test(o)).length >= 2);
}

/**
 * INSPECT: learn how the site actually works from an observed page. Pure — no
 * network. Extracts the interactive structure a human researcher would learn on a
 * first visit. Unknown-but-visible controls are still noted; nothing is fabricated.
 */
export function inspectSite(obs: PageObservation): SiteStructure {
  const understanding = understandPlatform(obs);
  const selects = obs.searchControls.filter((c) => (c.options?.length ?? 0) > 0);
  const dropdownLabels = selects.map((c) => (c.label || c.placeholder || c.name || 'dropdown').trim());

  const requiredFields: string[] = [];
  const scopeHay = selects.flatMap((c) => [c.label, c.placeholder, c.name, ...(c.options ?? [])]).filter(Boolean).join(' ');
  if (STATE_RX.test(scopeHay) || /state/i.test(dropdownLabels.join(' '))) requiredFields.push('State');
  if (COUNTY_RX.test(scopeHay) || /county/i.test(dropdownLabels.join(' '))) requiredFields.push('County');

  const btnHay = [...obs.buttons, ...obs.navItems, ...obs.links.map((l) => l.text)].filter(Boolean);
  const filters = [...new Set(controlLabels(obs).filter((l) => FILTER_RX.test(l)))];
  const tabs = [...new Set(obs.navItems.filter((n) => TAB_RX.test(n)))];
  const expandableSections = [...new Set(btnHay.filter((b) => EXPAND_RX.test(b)))];
  const hasPagination = btnHay.some((b) => PAGINATION_RX.test(b));
  const hasModals = btnHay.some((b) => MODAL_RX.test(b));
  const hasResultTable = !!obs.hasTable;

  const parcelDetailNav = obs.hasMap
    ? 'Search → select the matching map result → parcel detail panel opens.'
    : hasResultTable
      ? 'Search → click the matching result row → parcel detail page.'
      : 'Search → open the matching result link → parcel detail page.';

  const multiStep = requiredFields.length > 0 || hasMethodSelector(obs);

  const notes: string[] = [];
  if (obs.loginLike) notes.push('Requires an authenticated session.');
  if (understanding.platformClass !== 'unknown') notes.push(`Classified as ${understanding.platformClass}.`);
  if (requiredFields.length) notes.push(`Scope must be set first: ${requiredFields.join(' → ')}.`);
  if (hasMethodSelector(obs)) notes.push('A search-mode selector chooses the lookup type before entering the identifier.');

  return {
    searchModes: understanding.availableSearchMethods,
    hasMethodDropdown: hasMethodSelector(obs),
    dropdowns: [...new Set(dropdownLabels)],
    requiredFields,
    filters,
    tabs,
    expandableSections,
    hasPagination,
    hasModals,
    hasResultTable,
    parcelDetailNav,
    multiStep,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Site playbook (the reusable, versioned navigation workflow)
// ─────────────────────────────────────────────────────────────────────────

export interface SitePlaybook {
  platform: string;
  taskType: string;
  version: number;
  structure: SiteStructure;
  /** Ordered navigation steps — the learned workflow (no hardcoded values). */
  workflow: NavStep[];
  notes: string[];
  timesReused: number;
  learnedAt: number;
  updatedAt: number;
}

/**
 * SYNTHESIZE a reusable navigation playbook from a learned structure for a given
 * task (the identifier kind that leads the search). Ordered, value-free steps:
 * pick the search mode → set every required scope field → fill the identifier →
 * submit → open the matching result → the parcel detail page. Pure.
 */
export function synthesizePlaybook(
  platform: string,
  taskType: string,
  structure: SiteStructure,
  identifierKind: SearchMethod,
  now = Math.floor(Date.now() / 1000),
): SitePlaybook {
  const workflow: NavStep[] = [];
  if (structure.hasMethodDropdown) {
    workflow.push({ action: 'select_method', text: identifierKind, value: identifierKind });
  }
  for (const field of structure.requiredFields) {
    workflow.push({ action: 'open_panel', text: field }); // set scope (State, then County, …)
  }
  workflow.push({ action: 'fill', value: `<${identifierKind}>` }); // value supplied at run time
  workflow.push({ action: 'submit' });
  workflow.push({ action: 'click', text: structure.hasResultTable ? 'matching result row' : 'matching result' });

  const notes = [
    `Learned workflow for ${identifierKind} lookup on ${platform}.`,
    ...structure.notes,
    structure.parcelDetailNav ? `Parcel detail: ${structure.parcelDetailNav}` : '',
  ].filter(Boolean);

  return { platform, taskType, version: 1, structure, workflow, notes, timesReused: 0, learnedAt: now, updatedAt: now };
}

// ─────────────────────────────────────────────────────────────────────────
// Storage (versioned, updateable)
// ─────────────────────────────────────────────────────────────────────────

interface PlaybookRow {
  platform: string; task_type: string; version: number;
  structure_json: string; workflow_json: string; notes_json: string;
  times_reused: number; learned_at: number; updated_at: number;
}

function parse<T>(s: string | null | undefined, fb: T): T { if (!s) return fb; try { return JSON.parse(s) as T; } catch { return fb; } }

function rowToPlaybook(r: PlaybookRow): SitePlaybook {
  return {
    platform: r.platform, taskType: r.task_type, version: r.version,
    structure: parse<SiteStructure>(r.structure_json, {} as SiteStructure),
    workflow: parse<NavStep[]>(r.workflow_json, []),
    notes: parse<string[]>(r.notes_json, []),
    timesReused: r.times_reused, learnedAt: r.learned_at, updatedAt: r.updated_at,
  };
}

/** Read the stored playbook for a (platform, task). Null when never learned. */
export function getSitePlaybook(platform: string, taskType = 'parcel_lookup'): SitePlaybook | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_site_playbook WHERE platform = ? AND task_type = ?')
    .get(platform, taskType) as PlaybookRow | undefined;
  return row ? rowToPlaybook(row) : null;
}

/**
 * Persist a playbook. If one already exists for (platform, task), this is a RELEARN
 * after the site changed: keep the same row and bump the version (never lose the
 * history of having learned it). New playbooks start at version 1. Idempotent.
 */
export function saveSitePlaybook(pb: SitePlaybook, actor = 'browser-intelligence'): SitePlaybook {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const prev = getSitePlaybook(pb.platform, pb.taskType);
  const version = prev ? prev.version + 1 : (pb.version || 1);
  const learnedAt = prev ? prev.learnedAt : (pb.learnedAt || now);
  db.prepare(
    `INSERT INTO landos_site_playbook (platform, task_type, version, structure_json, workflow_json, notes_json, times_reused, learned_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform, task_type) DO UPDATE SET version=excluded.version, structure_json=excluded.structure_json,
       workflow_json=excluded.workflow_json, notes_json=excluded.notes_json, updated_at=excluded.updated_at`,
  ).run(pb.platform, pb.taskType, version, JSON.stringify(pb.structure), JSON.stringify(pb.workflow), JSON.stringify(pb.notes), prev?.timesReused ?? 0, learnedAt, now);
  landosAudit(actor, prev ? 'site_playbook_relearned' : 'site_playbook_learned', `${pb.platform}/${pb.taskType} v${version}`, { refTable: 'landos_site_playbook' });
  return getSitePlaybook(pb.platform, pb.taskType) as SitePlaybook;
}

/** Record that a stored playbook was reused successfully (no relearn). */
export function markPlaybookReused(platform: string, taskType = 'parcel_lookup'): void {
  getLandosDb().prepare('UPDATE landos_site_playbook SET times_reused = times_reused + 1, updated_at = ? WHERE platform = ? AND task_type = ?')
    .run(Math.floor(Date.now() / 1000), platform, taskType);
}

export function listSitePlaybooks(): SitePlaybook[] {
  return (getLandosDb().prepare('SELECT * FROM landos_site_playbook ORDER BY updated_at DESC').all() as PlaybookRow[]).map(rowToPlaybook);
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestration — retrieve, and learn ONLY when needed
// ─────────────────────────────────────────────────────────────────────────

/** One retrieval attempt's outcome (from the injected browser run). */
export interface LearningAttempt<E> {
  retrieved: boolean;
  evidence: E;
  /** The page observed at the end (for inspection when retrieval failed). */
  observation?: PageObservation | null;
}

export interface RetrieveWithLearningDeps<E> {
  platform: string;
  taskType: string;
  /** The identifier kind that leads the search (from rankSearchMethods). */
  identifierKind: SearchMethod;
  /** Run one retrieval attempt. `playbook` is the stored/learned task workflow to
   *  follow (null = evidence-driven default). `navigation` is the shared, learned
   *  site navigation model (null = never navigated before). MUST NOT deep-inspect. */
  attempt: (opts: { playbook: SitePlaybook | null; navigation: SiteNavigationModel | null }) => Promise<LearningAttempt<E>>;
  /** Injected for tests; default = the real getSitePlaybook. */
  getPlaybook?: (platform: string, taskType: string) => SitePlaybook | null;
  savePlaybook?: (pb: SitePlaybook) => SitePlaybook;
  markReused?: (platform: string, taskType: string) => void;
  inspect?: (obs: PageObservation) => SiteStructure;
  synthesize?: (platform: string, taskType: string, structure: SiteStructure, kind: SearchMethod) => SitePlaybook;
  /** Learn/relearn the shared, task-agnostic site navigation model from an
   *  observation. Default = the real learnNavigation. Set to null to disable. */
  learnNav?: ((platform: string, obs: PageObservation) => { model: SiteNavigationModel; created: boolean; changedSections: string[]; versionBumped: boolean; trace: string }) | null;
  /** Read the stored navigation model (for the first attempt). Default = the real one. */
  getNavigation?: (platform: string) => SiteNavigationModel | null;
}

export interface LearningResult<E> {
  evidence: E;
  retrieved: boolean;
  /** Did a deep site inspection occur this run? (false on a clean success.) */
  inspected: boolean;
  /** Was a stored playbook reused for the first attempt? */
  reusedPlaybook: boolean;
  /** Did a stored playbook fail and get relearned (site changed)? */
  relearned: boolean;
  playbook: SitePlaybook | null;
  /** The shared site navigation model in effect after this run (learned/updated
   *  whenever the site was inspected). Null when the site was never observed. */
  navigation: SiteNavigationModel | null;
  /** Was the site navigation model learned or relearned on this run? */
  navigationLearned: boolean;
  /** Navigation-model sections relearned because the site changed. */
  navigationChangedSections: string[];
  trace: string[];
}

/**
 * Retrieve with automatic inspect-and-learn. Builds on the evidence-driven
 * strategy: the first attempt uses the stored playbook (or the default) with NO
 * inspection. Only when that fails does it inspect the site, synthesize a playbook,
 * retry, and save it — bumping the version when a stored playbook had gone stale.
 */
export async function retrieveWithLearning<E>(deps: RetrieveWithLearningDeps<E>): Promise<LearningResult<E>> {
  const getPb = deps.getPlaybook ?? getSitePlaybook;
  const savePb = deps.savePlaybook ?? saveSitePlaybook;
  const markReused = deps.markReused ?? markPlaybookReused;
  const inspect = deps.inspect ?? inspectSite;
  const synthesize = deps.synthesize ?? synthesizePlaybook;
  const learnNav = deps.learnNav === undefined ? learnNavigation : deps.learnNav;
  const getNav = deps.getNavigation ?? getNavigationModelDefault;
  const trace: string[] = [];

  // The shared, task-agnostic site navigation model (accumulated by every prior
  // department/task on this site). Available to the first attempt so a previously
  // navigated site needs LESS exploration this time.
  let navigation: SiteNavigationModel | null = null;
  try { navigation = getNav(deps.platform); } catch { navigation = null; }
  let navigationLearned = false;
  let navigationChangedSections: string[] = [];
  if (navigation) trace.push(`navigation model available: ${deps.platform} v${navigation.version}`);

  const stored = getPb(deps.platform, deps.taskType);
  trace.push(stored ? `reusing stored playbook v${stored.version}` : 'no stored playbook — evidence-driven default');

  // Learn/relearn the navigation model from ANY observation — navigation
  // knowledge is not page data, so it accrues even when a lookup misses its target.
  const learnFromObs = (obs: PageObservation | null | undefined) => {
    if (!obs || !learnNav) return;
    try {
      const r = learnNav(deps.platform, obs);
      navigation = r.model;
      if (r.versionBumped) { navigationLearned = true; navigationChangedSections = r.changedSections; }
      trace.push(r.trace);
    } catch { /* navigation learning is best-effort; never fails a retrieval */ }
  };

  const done = (partial: Omit<LearningResult<E>, 'navigation' | 'navigationLearned' | 'navigationChangedSections'>): LearningResult<E> =>
    ({ ...partial, navigation, navigationLearned, navigationChangedSections });

  // 1) First attempt — reuse the stored playbook (or default). NO inspection.
  const first = await deps.attempt({ playbook: stored, navigation });
  if (first.retrieved) {
    trace.push('retrieved on first attempt — no inspection');
    if (stored) { try { markReused(deps.platform, deps.taskType); } catch { /* non-fatal */ } }
    // A clean success can still confirm/extend navigation knowledge if the attempt
    // handed back an observation (e.g. the reached detail page) — never inspects.
    learnFromObs(first.observation);
    return done({ evidence: first.evidence, retrieved: true, inspected: false, reusedPlaybook: !!stored, relearned: false, playbook: stored, trace });
  }

  // 2) Failure / unexpected path → INSPECT, LEARN (navigation + task), RETRY, SAVE.
  trace.push(stored ? 'stored playbook failed — the site may have changed; inspecting' : 'retrieval failed — inspecting the site');
  const obs = first.observation ?? null;
  if (!obs) {
    trace.push('nothing observable to inspect — no false facts, no playbook');
    return done({ evidence: first.evidence, retrieved: false, inspected: false, reusedPlaybook: !!stored, relearned: false, playbook: stored, trace });
  }
  const structure = inspect(obs);
  trace.push(`inspected: modes=[${structure.searchModes.join('/')}] required=[${structure.requiredFields.join('/')}] methodDropdown=${structure.hasMethodDropdown} multiStep=${structure.multiStep}`);
  learnFromObs(obs); // the inspection also grows the shared navigation model
  const learned = synthesize(deps.platform, deps.taskType, structure, deps.identifierKind);

  const second = await deps.attempt({ playbook: learned, navigation });
  if (second.retrieved) {
    const saved = savePb(learned); // bumps version when a stored playbook existed
    trace.push(`retried with the learned workflow — retrieved; saved playbook v${saved.version}${stored ? ' (relearned)' : ''}`);
    return done({ evidence: second.evidence, retrieved: true, inspected: true, reusedPlaybook: false, relearned: !!stored, playbook: saved, trace });
  }

  trace.push('learned workflow still did not retrieve — recorded, no false facts, playbook not saved');
  return done({ evidence: second.evidence, retrieved: false, inspected: true, reusedPlaybook: false, relearned: false, playbook: stored, trace });
}
