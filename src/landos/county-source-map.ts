// LandOS — County Source Map (reusable public-record routing by state + county).
//
// Caches what NETR (or a search fallback) found for a county so the routing is
// reused across leads instead of re-walking NETR every time: NETR page URL, the
// official source links found (assessor/tax/GIS/recorder/planning/appraiser/
// building), whether a search fallback was needed, status, confidence, notes, and
// last-checked. Public routing metadata only — no credentials, no secrets.

import { getLandosDb, landosAudit } from './db.js';
import type { CountySourceLink } from './netr-routing.js';

export interface CountySourceMapEntry {
  state: string;
  county: string;
  netrUrl: string | null;
  sources: CountySourceLink[];
  usedSearchFallback: boolean;
  status: 'routed' | 'partial' | 'not_found' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  notes: string;
  lastCheckedAt: number | null;
}

interface Row {
  state: string; county: string; netr_url: string | null; sources_json: string;
  used_search_fallback: number; status: string; confidence: string; notes: string; last_checked_at: number;
}

function norm(s: string): string { return (s ?? '').trim(); }
/** Canonical key: UPPER state, Title-Case county (no "County" suffix) — so
 *  "ga"/"GA" and "white"/"White"/"White County" all map to one stable row. */
function key(state: string, county: string): { state: string; county: string } {
  const c = norm(county).replace(/\s+county$/i, '').toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { state: norm(state).toUpperCase(), county: c };
}

/** Read a county's cached routing (honest empty when none). */
export function getCountySources(state: string, county: string): CountySourceMapEntry | null {
  const k = key(state, county);
  const row = getLandosDb().prepare('SELECT * FROM landos_county_source_map WHERE state = ? AND county = ?').get(k.state, k.county) as Row | undefined;
  if (!row) return null;
  let sources: CountySourceLink[] = [];
  try { sources = JSON.parse(row.sources_json); } catch { sources = []; }
  return {
    state: row.state, county: row.county, netrUrl: row.netr_url, sources,
    usedSearchFallback: row.used_search_fallback === 1,
    status: (['routed', 'partial', 'not_found', 'unknown'] as const).includes(row.status as never) ? (row.status as CountySourceMapEntry['status']) : 'unknown',
    confidence: (['high', 'medium', 'low'] as const).includes(row.confidence as never) ? (row.confidence as CountySourceMapEntry['confidence']) : 'low',
    notes: row.notes, lastCheckedAt: row.last_checked_at,
  };
}

/** Upsert a county's routing result. Reusable across all future leads. */
export function saveCountySources(entry: Omit<CountySourceMapEntry, 'lastCheckedAt'>, actor = 'browser-intelligence'): CountySourceMapEntry {
  const k = key(entry.state, entry.county);
  const now = Math.floor(Date.now() / 1000);
  getLandosDb().prepare(
    `INSERT INTO landos_county_source_map (state, county, netr_url, sources_json, used_search_fallback, status, confidence, notes, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(state, county) DO UPDATE SET netr_url=excluded.netr_url, sources_json=excluded.sources_json,
       used_search_fallback=excluded.used_search_fallback, status=excluded.status, confidence=excluded.confidence,
       notes=excluded.notes, last_checked_at=excluded.last_checked_at`,
  ).run(k.state, k.county, entry.netrUrl, JSON.stringify(entry.sources), entry.usedSearchFallback ? 1 : 0, entry.status, entry.confidence, entry.notes, now);
  landosAudit(actor, 'county_source_map_updated', `${k.county}, ${k.state} (${entry.status}, ${entry.sources.length} sources)`, { refTable: 'landos_county_source_map' });
  return { ...entry, state: k.state, county: k.county, lastCheckedAt: now };
}

/** Cache is reusable when it's recent and has usable routing. */
export function isCountyCacheFresh(entry: CountySourceMapEntry | null, maxAgeDays = 30): boolean {
  if (!entry || !entry.lastCheckedAt) return false;
  if (entry.status === 'not_found' || entry.sources.length === 0) return false;
  const ageDays = (Date.now() / 1000 - entry.lastCheckedAt) / 86400;
  return ageDays <= maxAgeDays;
}
