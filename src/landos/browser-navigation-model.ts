// LandOS — Browser Intelligence: reusable Site Navigation Model.
//
// The layer ABOVE task-specific site playbooks (browser-learning.ts). A site
// playbook answers "how do I do THIS task on this site" for one identifier kind.
// A Navigation Model answers a more durable question: "how is THIS WEBSITE
// navigated" — independent of any single task or department.
//
// It is keyed by PLATFORM ONLY (not platform+task), so every current and future
// department that touches the same site reuses one shared navigation model. No
// site-specific navigation logic is ever duplicated per department.
//
// A navigation model answers, for any interactive site (county GIS, assessor,
// recorder, tax portal, government site, real-estate platform, business/utility
// site, mapping platform, future LandOS/Jarvis departments):
//   • Where are the search functions?          • How are documents opened?
//   • What search modes exist?                 • How are exports/downloads done?
//   • Which identifiers are supported?          • What navigation dependencies exist?
//   • Which dropdowns/selectors are required?   • What indicates success?
//   • Which fields are mandatory + in what order?• What indicates failure?
//   • How are results opened / detail reached?  • How are tabs/filters/layers/
//                                                 overlays/map tools accessed?
//
// It learns HOW TO MOVE through a site — never the site's DATA. It NEVER stores
// parcel information, documents, listings, records, or page content (no
// obs.fields, no option values, no scraped rows). Only navigation affordances:
// control labels, nav/tab/button texts, and the workflow relationships between
// them. Lightweight, versioned, and relearned section-by-section when a site
// changes. Pure inspection/synthesis + a thin SQLite adapter.

import { getLandosDb, landosAudit } from './db.js';
import { inspectSite, type SiteStructure } from './browser-learning.js';
import {
  understandPlatform, findGuidanceLinks, isForbiddenTarget,
  type PageObservation, type SearchMethod, type PlatformClass,
} from './website-intelligence.js';

// ─────────────────────────────────────────────────────────────────────────
// The model
// ─────────────────────────────────────────────────────────────────────────

/** How a navigation capability is performed on this site (a movement, never data). */
export interface NavCapability {
  /** Human-readable description of how to reach/perform it (null = not observed). */
  how: string | null;
  /** Concrete access points learned (labels / nav / tab / button texts). */
  via: string[];
}

export interface SiteNavigationModel {
  platform: string;
  version: number;
  classification: PlatformClass | string;

  // WHERE things are / WHAT the site offers.
  /** Nav/menu entries (or the landing surface) that lead to a search. */
  searchFunctions: string[];
  /** Search modes the site offers. */
  searchModes: SearchMethod[];
  /** Identifier kinds the site can actually be searched by. */
  supportedIdentifiers: SearchMethod[];
  /** Selectors that gate a search (must be set first), e.g. State, County. */
  requiredSelectors: string[];
  /** All non-method dropdowns/selectors by label. */
  dropdowns: string[];
  /** Fields that must be completed before a search runs. */
  mandatoryFields: string[];
  /** The order fields must be completed in (a sequence, not a set). */
  fieldOrder: string[];

  // HOW to move.
  /** How search results are opened. */
  resultAccess: NavCapability;
  /** How a detail/record page is reached. */
  detailAccess: NavCapability;
  /** Tab-like sub-navigation on a record/detail. */
  tabs: string[];
  /** Filter/sort/refine controls. */
  filters: string[];
  /** Map layers / overlays / basemaps. */
  layers: string[];
  /** Map tools (measure, draw, identify, zoom, street view, 3D). */
  mapTools: string[];
  /** How documents (deeds, images, PDFs, attachments) are opened. */
  documentAccess: NavCapability;
  /** How exports / downloads / prints are performed (often gated/restricted). */
  exportAccess: NavCapability;

  // DEPENDENCIES + SIGNALS.
  /** Ordering / prerequisite relationships between navigation steps. */
  navigationDependencies: string[];
  /** What indicates the task succeeded (reached the target). */
  successSignals: string[];
  /** What indicates the task failed / went off-path. */
  failureSignals: string[];
  /** Help/guidance destinations (docs, user guide) — navigation aids, not data. */
  guidance: string[];

  authRequired: boolean;
  notes: string[];

  // Provenance — per-section revision so a site change relearns ONLY the affected
  // section(s) and bumps the model version.
  sectionRevisions: Record<string, number>;
  timesReused: number;
  learnedAt: number;
  updatedAt: number;
}

/** The list-valued sections (order-insensitive; merged by union). */
const LIST_SECTIONS = [
  'searchFunctions', 'searchModes', 'supportedIdentifiers', 'requiredSelectors',
  'dropdowns', 'mandatoryFields', 'tabs', 'filters', 'layers', 'mapTools',
  'navigationDependencies', 'successSignals', 'failureSignals', 'guidance', 'notes',
] as const;
/** Order-SENSITIVE list sections (relearned as a whole sequence when they change). */
const SEQUENCE_SECTIONS = ['fieldOrder'] as const;
/** NavCapability sections. */
const CAPABILITY_SECTIONS = ['resultAccess', 'detailAccess', 'documentAccess', 'exportAccess'] as const;
/** Scalar sections. */
const SCALAR_SECTIONS = ['classification', 'authRequired'] as const;

export const NAV_MODEL_SECTIONS = [
  ...LIST_SECTIONS, ...SEQUENCE_SECTIONS, ...CAPABILITY_SECTIONS, ...SCALAR_SECTIONS,
] as const;
export type NavModelSection = (typeof NAV_MODEL_SECTIONS)[number];

// ── detection vocab (generic; NO site/vendor-specific strings) ────────────────
const SEARCH_ENTRY_RX = /search|find|lookup|map|parcel|property|records?/i;
const DOC_RX = /document|deed|image|scan|attachment|pdf|recorded|instrument|plat|survey/i;
const EXPORT_RX = /export|download|csv|xlsx|spreadsheet|print|save\s*as|report\s*pdf/i;
const MAPTOOL_RX = /measure|draw|identify|zoom|pan|street\s*view|3d|sketch|buffer|coordinate\s*tool|locate/i;
const LAYER_RX = /basemap|overlay|layers?|aerial|imagery|topo|flood\s*layer|zoning\s*layer|parcels?\s*layer/i;

function texts(obs: PageObservation): string[] {
  return [...obs.navItems, ...obs.buttons, ...obs.links.map((l) => l.text)]
    .map((s) => (s || '').trim()).filter(Boolean);
}
function uniq(xs: string[]): string[] { return [...new Set(xs.map((s) => s.trim()).filter(Boolean))]; }

// ─────────────────────────────────────────────────────────────────────────
// BUILD — synthesize a navigation model from one observed page. Pure.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a fresh navigation model from an observed page. Reuses inspectSite (the
 * learned SiteStructure) so navigation logic lives in exactly one place, then
 * projects it into the durable, task-agnostic navigation questions. Pure — no
 * network, no persistence, no page DATA (never reads obs.fields).
 */
export function buildNavigationModel(
  platform: string,
  obs: PageObservation,
  now = Math.floor(Date.now() / 1000),
): SiteNavigationModel {
  const structure = inspectSite(obs);
  const understanding = understandPlatform(obs);
  const all = texts(obs);
  const allowed = all.filter((t) => !isForbiddenTarget(t));

  // WHERE the search is: nav/entry items that look like a search destination,
  // plus the landing surface itself if it exposes search controls.
  const searchFunctions = uniq(allowed.filter((t) => SEARCH_ENTRY_RX.test(t)));
  if (obs.searchControls.length) searchFunctions.unshift('search controls on the current surface');

  // Movement capabilities.
  const resultAccess: NavCapability = {
    how: structure.hasResultTable
      ? 'Results appear as rows in a results table; open the matching row.'
      : obs.hasMap
        ? 'Results appear on the map / in a results panel; select the matching result.'
        : 'Results appear as links; open the matching result link.',
    via: uniq(all.filter((t) => /result|row|view|open|select|details?/i.test(t))).slice(0, 6),
  };
  const detailAccess: NavCapability = {
    how: structure.parcelDetailNav,
    via: uniq(structure.tabs),
  };
  const documents = uniq(all.filter((t) => DOC_RX.test(t)));
  const documentAccess: NavCapability = {
    how: documents.length
      ? 'From a reached record/detail page, open a document via the listed access points.'
      : null,
    via: documents.slice(0, 8),
  };
  const exports = uniq(all.filter((t) => EXPORT_RX.test(t)));
  const exportAccess: NavCapability = {
    how: exports.length
      ? 'Export/download from a reached record or results page (often gated — treat as restricted; never auto-run a paid/credit export).'
      : null,
    via: exports.slice(0, 8),
  };

  const layers = uniq([...structure.expandableSections, ...all].filter((t) => LAYER_RX.test(t)));
  const mapTools = uniq(all.filter((t) => MAPTOOL_RX.test(t)));

  // Mandatory fields + ordering. Required selectors are set first, then the
  // identifier is entered, then the search is submitted.
  const mandatoryFields = [...structure.requiredFields, 'search identifier'];
  const fieldOrder: string[] = [];
  if (structure.hasMethodDropdown) fieldOrder.push('search mode');
  fieldOrder.push(...structure.requiredFields, 'search identifier', 'submit');

  return {
    platform,
    version: 1,
    classification: understanding.platformClass,
    searchFunctions: uniq(searchFunctions),
    searchModes: structure.searchModes,
    supportedIdentifiers: understanding.availableSearchMethods,
    requiredSelectors: structure.requiredFields,
    dropdowns: structure.dropdowns,
    mandatoryFields,
    fieldOrder,
    resultAccess,
    detailAccess,
    tabs: structure.tabs,
    filters: structure.filters,
    layers,
    mapTools,
    documentAccess,
    exportAccess,
    navigationDependencies: deriveDependencies(structure, { documents: documents.length > 0, exports: exports.length > 0 }),
    successSignals: deriveSuccessSignals(structure),
    failureSignals: deriveFailureSignals(structure),
    guidance: uniq(findGuidanceLinks(obs).map((g) => g.text || g.href)),
    authRequired: obs.loginLike,
    notes: uniq(structure.notes),
    sectionRevisions: Object.fromEntries(NAV_MODEL_SECTIONS.map((s) => [s, 1])),
    timesReused: 0,
    learnedAt: now,
    updatedAt: now,
  };
}

/** Generic navigation dependencies derived from the learned structure. */
function deriveDependencies(structure: SiteStructure, has: { documents: boolean; exports: boolean }): string[] {
  const deps: string[] = [];
  if (structure.hasMethodDropdown) deps.push('Select the search mode before entering the identifier.');
  const req = structure.requiredFields;
  for (let i = 1; i < req.length; i++) deps.push(`Set ${req[i - 1]} before ${req[i]}.`);
  if (req.length) deps.push(`Set scope (${req.join(' → ')}) before running the search.`);
  deps.push('Open a matching result before the detail/record page is reachable.');
  if (has.documents || has.exports) deps.push('Reach a record/detail page before documents or exports become available.');
  return deps;
}

/** Generic success signals (what "reached the target" looks like). */
function deriveSuccessSignals(structure: SiteStructure): string[] {
  const s = ['A record/detail page shows several real record fields (owner / parcel / acreage / value).'];
  if (structure.hasResultTable) s.push('The searched identifier appears in a matching results row that opens a detail page.');
  if (structure.parcelDetailNav) s.push(structure.parcelDetailNav);
  return uniq(s);
}

/** Generic failure signals (what "went off-path" looks like). */
function deriveFailureSignals(structure: SiteStructure): string[] {
  const s = [
    'Still on the search/filter form (filter controls + option-list values).',
    'No matching result rows / an empty result set.',
    'A login page (session not authenticated).',
    'A 404 / not-found / error page.',
  ];
  if (structure.hasModals) s.push('A modal/dialog is intercepting clicks (dismiss it first).');
  return uniq(s);
}

// ─────────────────────────────────────────────────────────────────────────
// MERGE — expand naturally; relearn ONLY the sections a site actually changed.
// ─────────────────────────────────────────────────────────────────────────

export interface MergeResult {
  model: SiteNavigationModel;
  changedSections: NavModelSection[];
  versionBumped: boolean;
}

function unionList(stored: string[], fresh: string[]): { value: string[]; changed: boolean } {
  const merged = uniq([...(stored ?? []), ...(fresh ?? [])]);
  return { value: merged, changed: merged.length !== (stored ?? []).length };
}
function eqSeq(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function mergeCapability(stored: NavCapability, fresh: NavCapability): { value: NavCapability; changed: boolean } {
  const via = unionList(stored?.via ?? [], fresh?.via ?? []);
  // A non-empty fresh description that differs from the stored one means the site
  // changed how this capability is reached → relearn it.
  const how = fresh?.how && fresh.how !== stored?.how ? fresh.how : (stored?.how ?? fresh?.how ?? null);
  const changed = via.changed || how !== (stored?.how ?? null);
  return { value: { how, via: via.value }, changed };
}

/**
 * Merge a freshly observed model into the stored one. New knowledge EXPANDS the
 * model; a changed capability description RELEARNS that section. Empty fresh
 * sections never erase learned knowledge (a page that doesn't expose a section is
 * not evidence the section is gone). Only sections that actually changed bump
 * their revision, and the model version bumps once if any section changed. Pure.
 */
export function mergeNavigationModel(
  stored: SiteNavigationModel,
  fresh: SiteNavigationModel,
  now = Math.floor(Date.now() / 1000),
): MergeResult {
  const next: SiteNavigationModel = { ...stored, sectionRevisions: { ...stored.sectionRevisions } };
  const changed: NavModelSection[] = [];
  const bumpIf = (section: NavModelSection, didChange: boolean) => {
    if (!didChange) return;
    changed.push(section);
    next.sectionRevisions[section] = (next.sectionRevisions[section] ?? 1) + 1;
  };

  for (const section of LIST_SECTIONS) {
    const freshVal = fresh[section] as string[];
    if (!freshVal || freshVal.length === 0) continue; // don't erase on an empty observation
    const { value, changed: c } = unionList(stored[section] as string[], freshVal);
    (next[section] as string[]) = value;
    bumpIf(section, c);
  }

  for (const section of SEQUENCE_SECTIONS) {
    const freshVal = fresh[section] as string[];
    if (!freshVal || freshVal.length === 0) continue;
    const storedVal = stored[section] as string[];
    if (!eqSeq(storedVal, freshVal)) { (next[section] as string[]) = freshVal; bumpIf(section, true); }
  }

  for (const section of CAPABILITY_SECTIONS) {
    const { value, changed: c } = mergeCapability(stored[section] as NavCapability, fresh[section] as NavCapability);
    (next[section] as NavCapability) = value;
    bumpIf(section, c);
  }

  // classification: adopt a confident fresh class over an unknown/differing one.
  if (fresh.classification && fresh.classification !== 'unknown' && fresh.classification !== stored.classification) {
    next.classification = fresh.classification; bumpIf('classification', true);
  }
  // authRequired: a login page raises the flag (latch true; navigation-relevant).
  if (fresh.authRequired && !stored.authRequired) { next.authRequired = true; bumpIf('authRequired', true); }

  const versionBumped = changed.length > 0;
  next.version = stored.version + (versionBumped ? 1 : 0);
  next.updatedAt = now;
  return { model: next, changedSections: changed, versionBumped };
}

// ─────────────────────────────────────────────────────────────────────────
// Storage (platform-keyed, versioned)
// ─────────────────────────────────────────────────────────────────────────

interface NavRow {
  platform: string; version: number; model_json: string;
  times_reused: number; learned_at: number; updated_at: number;
}

function parse<T>(s: string | null | undefined, fb: T): T { if (!s) return fb; try { return JSON.parse(s) as T; } catch { return fb; } }

export function getNavigationModel(platform: string): SiteNavigationModel | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_site_navigation WHERE platform = ?')
    .get(platform) as NavRow | undefined;
  if (!row) return null;
  const model = parse<SiteNavigationModel | null>(row.model_json, null);
  if (!model) return null;
  // Row is the source of truth for version/reuse counters.
  return { ...model, platform: row.platform, version: row.version, timesReused: row.times_reused, learnedAt: row.learned_at, updatedAt: row.updated_at };
}

/** Persist a navigation model (upsert by platform). Idempotent. */
export function saveNavigationModel(model: SiteNavigationModel, actor = 'browser-intelligence'): SiteNavigationModel {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const prev = getNavigationModel(model.platform);
  const learnedAt = prev ? prev.learnedAt : (model.learnedAt || now);
  db.prepare(
    `INSERT INTO landos_site_navigation (platform, version, model_json, times_reused, learned_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET version=excluded.version, model_json=excluded.model_json, updated_at=excluded.updated_at`,
  ).run(model.platform, model.version, JSON.stringify({ ...model, learnedAt }), prev?.timesReused ?? model.timesReused ?? 0, learnedAt, now);
  landosAudit(actor, prev ? 'site_navigation_relearned' : 'site_navigation_learned', `${model.platform} v${model.version}`, { refTable: 'landos_site_navigation' });
  return getNavigationModel(model.platform) as SiteNavigationModel;
}

/** Record that a stored navigation model was reused (no relearn needed). */
export function markNavigationModelReused(platform: string): void {
  getLandosDb().prepare('UPDATE landos_site_navigation SET times_reused = times_reused + 1, updated_at = ? WHERE platform = ?')
    .run(Math.floor(Date.now() / 1000), platform);
}

export function listNavigationModels(): SiteNavigationModel[] {
  const rows = getLandosDb().prepare('SELECT platform FROM landos_site_navigation ORDER BY updated_at DESC').all() as Array<{ platform: string }>;
  return rows.map((r) => getNavigationModel(r.platform)).filter((m): m is SiteNavigationModel => !!m);
}

// ─────────────────────────────────────────────────────────────────────────
// LEARN — the orchestration Browser Intelligence runs on every inspection.
// ─────────────────────────────────────────────────────────────────────────

export interface LearnNavigationResult {
  model: SiteNavigationModel;
  /** First time this site's navigation was learned. */
  created: boolean;
  /** Sections that changed on this pass (empty on a pure reuse or first learn). */
  changedSections: NavModelSection[];
  /** Did the model version bump (new site or a changed section)? */
  versionBumped: boolean;
  trace: string;
}

export interface LearnNavigationDeps {
  get?: (platform: string) => SiteNavigationModel | null;
  save?: (m: SiteNavigationModel) => SiteNavigationModel;
  markReused?: (platform: string) => void;
  build?: (platform: string, obs: PageObservation) => SiteNavigationModel;
  merge?: (stored: SiteNavigationModel, fresh: SiteNavigationModel) => MergeResult;
}

/**
 * Learn (or relearn) the navigation model for a platform from an observed page.
 * First visit → build + save at v1. A later visit → merge: new knowledge expands
 * the model and a changed section relearns just that section (version bumps). If
 * nothing changed, the model is reused (counter incremented), no version churn.
 *
 * Navigation knowledge is NOT page content, so it is learned whenever the site is
 * observed — even when the specific record lookup did not find its target. This is
 * why Browser Intelligence gets better at NAVIGATING a site over time regardless
 * of any one task's data outcome.
 */
export function learnNavigation(platform: string, obs: PageObservation, deps: LearnNavigationDeps = {}): LearnNavigationResult {
  const get = deps.get ?? getNavigationModel;
  const save = deps.save ?? saveNavigationModel;
  const markReused = deps.markReused ?? markNavigationModelReused;
  const build = deps.build ?? buildNavigationModel;
  const merge = deps.merge ?? mergeNavigationModel;

  const fresh = build(platform, obs);
  const stored = get(platform);
  if (!stored) {
    const saved = save(fresh);
    return { model: saved, created: true, changedSections: [], versionBumped: true, trace: `learned ${platform} navigation model v${saved.version}` };
  }

  const { model, changedSections, versionBumped } = merge(stored, fresh);
  if (!versionBumped) {
    try { markReused(platform); } catch { /* non-fatal */ }
    return { model: stored, created: false, changedSections: [], versionBumped: false, trace: `reused ${platform} navigation model v${stored.version} (no change)` };
  }
  const saved = save(model);
  return { model: saved, created: false, changedSections, versionBumped: true, trace: `relearned ${platform} navigation model v${saved.version} — sections: ${changedSections.join(', ')}` };
}
