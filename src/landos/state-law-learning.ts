// LandOS — what LandOS has LEARNED about reading a state's own law.
//
// This is the state-law analogue of `gis-platform-knowledge.ts`, and it exists
// for the same reason and under the same rule: SHARE THE METHOD, NEVER THE
// EVIDENCE. A row here says where a state publishes its law and how that
// publication is shaped. It never says what the law is.
//
// It replaces a hardcoded per-state table. The difference is not cosmetic:
//
//   before — a state was readable only if someone had added a `STATE: {...}`
//            entry first, so an unfamiliar state failed before it was tried.
//   now    — the same three states are SEED rows in a cache that any state can
//            write to. Georgia, Michigan and New York keep every fact that was
//            proven live, as fast paths that skip detection; an unseen state
//            detects its own shape once and is remembered exactly like them.
//
// Seed rows and discovered rows are the same shape and are used the same way.
// `learnedFrom` records which is which, so the boundary between "we proved this
// live in a sprint" and "the engine worked this out on a lead" stays visible.

import { getLandosDb, isLandosDbOpen, landosAudit } from './db.js';
import type { LegalSourceTransport, StateLawPlatform, StateLawPlatformConfig } from './state-legal-sources.js';

export interface LearnedStateLawSource {
  /** Two-letter state code. */
  state: string;
  /** The publisher's own name for itself, when it stated one. */
  body: string | null;
  /** Official origin that answered. */
  origin: string | null;
  transport: LegalSourceTransport;
  platform: StateLawPlatform;
  /** How to read this source. Carries the parsing details, not the state. */
  config: StateLawPlatformConfig;
  learnedFrom: 'seed' | 'discovery';
  runs: number;
  successes: number;
  lastVerifiedAt: string | null;
}

/* ─────────────────────────── seeded fast paths ───────────────────────── */

/**
 * The three publications this engine proved live, kept verbatim.
 *
 * Every one of these facts cost a live investigation and none of it is
 * rediscoverable for free, so it is preserved rather than dropped in the name
 * of genericity. What changed is its STATUS: this is remembered knowledge that
 * the cache is pre-loaded with, not a precondition for the lane to run.
 */
export const SEEDED_STATE_LAW_KNOWLEDGE: Record<string, Omit<LearnedStateLawSource, 'runs' | 'successes' | 'lastVerifiedAt'>> = {
  MI: {
    state: 'MI',
    body: 'Michigan Legislature',
    origin: 'https://www.legislature.mi.gov',
    transport: 'server_fetch',
    platform: 'object_addressed_code',
    learnedFrom: 'seed',
    config: {
      platform: 'object_addressed_code',
      indexPath: '/Laws/ChapterIndex',
      objectPath: '/Laws/MCL?objectName={id}',
      documentPath: '/documents/mcl/pdf/{id}.pdf',
      // Parsing details that used to live inside the generic adapter. They are
      // facts about THIS publication: its object ids carry an `mcl-` prefix,
      // its chapters list public acts as `Act-N-of-YYYY`, and a printed section
      // number becomes an object id by replacing the dot with a dash.
      objectIdPrefix: 'mcl-',
      childObjectPattern: 'Act-\\d+-of-\\d+',
      sectionIdTemplate: '{prefix}{sectionDashed}',
      citationLabel: 'MCL',
      citationShapes: ['\\bMCL\\s*§*\\s*\\d+\\.\\d+[a-z]?', '\\bAct\\s+\\d+\\s+of\\s+\\d{4}\\b'],
      verifiedNote: 'Chapter index returns a table of objectName -> chapter description; chapter pages link their acts; acts render full text and also publish a PDF.',
    },
  },
  NY: {
    state: 'NY',
    body: 'New York State Senate (Open Legislation)',
    origin: 'https://www.nysenate.gov',
    // Verified live: a plain request is answered with an edge challenge page.
    transport: 'requires_browser',
    platform: 'article_toc_code',
    learnedFrom: 'seed',
    config: {
      platform: 'article_toc_code',
      indexPath: '/legislation/laws/CONSOLIDATED',
      objectPath: '/legislation/laws/{id}',
      chapterLinkPattern: '/legislation/laws/([A-Z_]{3,})(?:$|["/?])',
      articleLinkPattern: '/(A\\d+[A-Z-]*)(?:$|["/?])',
      // This publisher prints "Town Law § 276", not "TWN § 276".
      citationTemplate: '{chapter} Law § {section}',
      citationShapes: ['\\b(?:Town|Village|General\\s+Municipal|General\\s+City)\\s+Law\\s*§*\\s*\\d+[-a-z]*'],
      verifiedNote: 'Consolidated index lists law chapters; a chapter lists articles; an article lists sections with catchlines. Edge-protected, so it must be read through the background browser.',
    },
  },
  GA: {
    state: 'GA',
    body: 'Georgia General Assembly',
    origin: 'https://www.legis.ga.gov',
    transport: 'server_fetch',
    platform: 'agency_publication',
    learnedFrom: 'seed',
    config: {
      platform: 'agency_publication',
      agencyHosts: ['dca.georgia.gov', 'dph.georgia.gov'],
      citationShapes: ['O\\.C\\.G\\.A\\.?\\s*§*\\s*\\d+-\\d+-\\d+(?:\\.\\d+)?'],
      verifiedNote: 'The General Assembly site is a client-rendered shell and the official code is behind a vendor SPA. State agency sites publish the governing statutes with their O.C.G.A. citations and expose full sitemaps.',
    },
  },
};

function seedFor(code: string): LearnedStateLawSource | null {
  const seed = SEEDED_STATE_LAW_KNOWLEDGE[code];
  return seed ? { ...seed, runs: 0, successes: 0, lastVerifiedAt: null } : null;
}

/* ──────────────────────────────── the cache ──────────────────────────── */

interface Row {
  state: string; body: string | null; origin: string | null; transport: string;
  platform: string; config_json: string; citation_shapes_json: string;
  learned_from: string; verified_note: string | null;
  runs: number; successes: number; last_verified_at: string | null;
}

/**
 * Process-local mirror of the cache.
 *
 * It is also the whole cache when no LandOS database is open — a unit test, a
 * script, a lane running before storage is initialised. Losing persistence must
 * degrade the engine to "detect once per process", never to "cannot run".
 */
const memory = new Map<string, LearnedStateLawSource>();

function normalise(state: string | null | undefined): string {
  return (state ?? '').trim().toUpperCase();
}

function toLearned(row: Row): LearnedStateLawSource {
  let config: StateLawPlatformConfig;
  try {
    config = JSON.parse(row.config_json) as StateLawPlatformConfig;
  } catch {
    config = { platform: row.platform as StateLawPlatform };
  }
  let citationShapes: string[] = [];
  try { citationShapes = JSON.parse(row.citation_shapes_json) as string[]; } catch { /* none */ }
  return {
    state: row.state,
    body: row.body,
    origin: row.origin,
    transport: (row.transport as LegalSourceTransport) ?? 'server_fetch',
    platform: (row.platform as StateLawPlatform) ?? 'unknown',
    config: {
      ...config,
      platform: (row.platform as StateLawPlatform) ?? config.platform ?? 'unknown',
      citationShapes: citationShapes.length ? citationShapes : config.citationShapes,
      verifiedNote: row.verified_note ?? config.verifiedNote,
    },
    learnedFrom: row.learned_from === 'seed' ? 'seed' : 'discovery',
    runs: row.runs,
    successes: row.successes,
    lastVerifiedAt: row.last_verified_at,
  };
}

/** Read the row, tolerating an absent or unopened database. */
function readRow(code: string): LearnedStateLawSource | null {
  if (!isLandosDbOpen()) return null;
  try {
    const row = getLandosDb()
      .prepare('SELECT * FROM landos_state_law_source WHERE state = ?')
      .get(code) as Row | undefined;
    return row ? toLearned(row) : null;
  } catch {
    return null;
  }
}

/**
 * What LandOS knows about reading this state, best knowledge first.
 *
 * A row learned on a live lead outranks the seed, because the seed is what was
 * true when it was written and the row is what answered most recently.
 */
export function learnedStateLawSource(state: string | null | undefined): LearnedStateLawSource | null {
  const code = normalise(state);
  if (code.length !== 2) return null;
  const cached = memory.get(code);
  if (cached) return cached;
  const stored = readRow(code);
  if (stored) {
    memory.set(code, stored);
    return stored;
  }
  const seed = seedFor(code);
  if (seed) memory.set(code, seed);
  return seed;
}

/** The platform configuration for a state, learned or seeded. */
export function stateLawPlatformFor(state: string | null | undefined): StateLawPlatformConfig | null {
  const learned = learnedStateLawSource(state);
  if (!learned || learned.platform === 'unknown') return learned?.config.platform ? learned.config : null;
  return learned.config;
}

export interface StateLawSourcePatch {
  body?: string | null;
  origin?: string | null;
  transport?: LegalSourceTransport;
  platform?: StateLawPlatform;
  config?: StateLawPlatformConfig;
  /** True when this run actually retrieved authoritative text. */
  succeeded?: boolean;
}

/**
 * Remember how this state was read, so the next property in it skips discovery.
 *
 * Merge semantics, like the GIS deployment store: only supplied fields change,
 * and a run is counted either way so a source that keeps failing is visible as
 * runs-without-successes rather than quietly disappearing.
 *
 * A detected `unknown` platform never overwrites a shape that has already been
 * established — a single blocked probe must not erase working knowledge.
 */
export function rememberStateLawSource(
  state: string,
  patch: StateLawSourcePatch,
  now: () => string = () => new Date().toISOString(),
): LearnedStateLawSource | null {
  const code = normalise(state);
  if (code.length !== 2) return null;
  const previous = learnedStateLawSource(code);

  const platform = patch.platform && patch.platform !== 'unknown'
    ? patch.platform
    : previous?.platform ?? 'unknown';
  const config: StateLawPlatformConfig = {
    ...(previous?.config ?? {}),
    ...(patch.config ?? {}),
    platform,
  };

  const next: LearnedStateLawSource = {
    state: code,
    body: patch.body !== undefined ? patch.body : previous?.body ?? null,
    origin: patch.origin !== undefined ? patch.origin : previous?.origin ?? null,
    transport: patch.transport ?? previous?.transport ?? 'server_fetch',
    platform,
    config,
    // A seed that has now been re-proven on a live lead is still seeded
    // knowledge; a state LandOS worked out itself is marked as discovered.
    learnedFrom: previous?.learnedFrom ?? 'discovery',
    runs: (previous?.runs ?? 0) + 1,
    successes: (previous?.successes ?? 0) + (patch.succeeded ? 1 : 0),
    lastVerifiedAt: patch.succeeded ? now() : previous?.lastVerifiedAt ?? null,
  };

  assertNoLegalConclusion(next);
  memory.set(code, next);

  // Learning must never be the thing that opens the operating database.
  if (!isLandosDbOpen()) return next;

  try {
    getLandosDb().prepare(`
      INSERT INTO landos_state_law_source (
        state, body, origin, transport, platform, config_json, citation_shapes_json,
        learned_from, verified_note, runs, successes, last_verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
      ON CONFLICT(state) DO UPDATE SET
        body=excluded.body, origin=excluded.origin, transport=excluded.transport,
        platform=excluded.platform, config_json=excluded.config_json,
        citation_shapes_json=excluded.citation_shapes_json, learned_from=excluded.learned_from,
        verified_note=excluded.verified_note, runs=excluded.runs, successes=excluded.successes,
        last_verified_at=excluded.last_verified_at, updated_at=excluded.updated_at
    `).run(
      next.state, next.body, next.origin, next.transport, next.platform,
      JSON.stringify({ ...next.config, citationShapes: undefined, verifiedNote: undefined }),
      JSON.stringify(next.config.citationShapes ?? []),
      next.learnedFrom, next.config.verifiedNote ?? null,
      next.runs, next.successes, next.lastVerifiedAt,
    );
    landosAudit('land-use', 'state_law_source_learned',
      `${code} → ${next.platform}${next.origin ? ` @ ${next.origin}` : ''}`,
      { refTable: 'landos_state_law_source' });
  } catch {
    // No database in this process. The in-memory cache still serves the run.
  }

  return next;
}

/**
 * Refuse to write a legal conclusion into shared state knowledge.
 *
 * The same boundary the GIS deployment store enforces, for the same reason: a
 * row here is read by every future property in the state, so a statute excerpt
 * or a determination that leaked into it would surface on an unrelated deal
 * looking authoritative. Only locators and shapes are allowed.
 */
export function assertNoLegalConclusion(record: LearnedStateLawSource): void {
  const suspects: string[] = [];
  const scan = (label: string, value: unknown): void => {
    if (typeof value !== 'string' || value.length < 40) return;
    if (/\bshall\b|\bmay\s+not\b|\bis\s+prohibited\b|\bpermitted\s+use\b|\bminimum\s+lot\b/i.test(value)) {
      suspects.push(`${label} reads as statutory text rather than a locator`);
    }
  };
  scan('body', record.body);
  scan('origin', record.origin);
  for (const [key, value] of Object.entries(record.config)) {
    if (key === 'verifiedNote') continue;
    scan(`config.${key}`, value);
  }
  if (suspects.length) {
    throw new Error(`Refusing to write a legal conclusion into shared state-law knowledge: ${suspects.join('; ')}.`);
  }
}

/** Everything currently learned, for inspection and for the audit surface. */
export function listLearnedStateLawSources(): LearnedStateLawSource[] {
  const out = new Map<string, LearnedStateLawSource>();
  for (const code of Object.keys(SEEDED_STATE_LAW_KNOWLEDGE)) {
    const seed = seedFor(code);
    if (seed) out.set(code, seed);
  }
  if (isLandosDbOpen()) {
    try {
      const rows = getLandosDb().prepare('SELECT * FROM landos_state_law_source').all() as Row[];
      for (const row of rows) out.set(row.state, toLearned(row));
    } catch { /* memory only */ }
  }
  for (const [code, value] of memory) out.set(code, value);
  return [...out.values()].sort((a, b) => a.state.localeCompare(b.state));
}

/** Drop the process-local mirror. Tests only. */
export function resetLearnedStateLawCache(): void {
  memory.clear();
}
