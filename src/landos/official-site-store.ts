// LandOS — the learned official website of a government.
//
// Discovery is bounded and it costs real requests. Once a jurisdiction's own
// site has been REACHED AND VERIFIED there is nothing left to discover, and the
// next property in that township or county should go straight to it. That is
// the whole purpose of this table: source miss → discover → verify → use →
// cache, and never discover the same government twice.
//
// Only verified sites are written. A candidate that failed verification is not
// a negative cache entry: a government that was unreachable today is not a
// government without a website, and recording it as one would suppress the next
// attempt.

import { getLandosDb, landosAudit } from './db.js';
import type { GovernmentUnitType } from './land-use-types.js';

export interface OfficialSiteRecord {
  state: string;
  jurisdiction: string;
  unitType: GovernmentUnitType;
  url: string;
  label: string;
  /** How the site was established as this government's own. */
  verifiedVia: 'hostname_formula' | 'dotgov_registry';
  basis: string;
  lastVerifiedAt: number;
}

interface Row {
  state: string; jurisdiction: string; unit_type: string; url: string;
  label: string; verified_via: string; basis: string; last_verified_at: number;
}

/** One stable key per government: "grandtraverse" for a county however spelled. */
function jurisdictionKey(jurisdiction: string): string {
  return jurisdiction
    .toLowerCase()
    .replace(/\bcharter\b/g, ' ')
    .replace(/\b(county|parish|borough|city|town|township|village|municipality|of|the)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Counties and sub-county governments share a name constantly; keep them apart. */
function unitBucket(unitType: GovernmentUnitType): string {
  return unitType === 'county' || unitType === 'unincorporated_county' || unitType === 'parish'
    ? 'county'
    : 'local';
}

export function getOfficialSite(
  state: string,
  jurisdiction: string,
  unitType: GovernmentUnitType,
): OfficialSiteRecord | null {
  const key = jurisdictionKey(jurisdiction);
  if (!key) return null;
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_official_site WHERE state = ? AND jurisdiction_key = ? AND unit_type = ?')
    .get(state.trim().toUpperCase(), key, unitBucket(unitType)) as Row | undefined;
  if (!row || !row.url) return null;
  return {
    state: row.state,
    jurisdiction: row.jurisdiction,
    unitType,
    url: row.url,
    label: row.label,
    verifiedVia: row.verified_via === 'dotgov_registry' ? 'dotgov_registry' : 'hostname_formula',
    basis: row.basis,
    lastVerifiedAt: row.last_verified_at,
  };
}

export function saveOfficialSite(
  record: Omit<OfficialSiteRecord, 'lastVerifiedAt'>,
  actor = 'land-use',
): void {
  const key = jurisdictionKey(record.jurisdiction);
  if (!key || !record.url) return;
  const state = record.state.trim().toUpperCase();
  const bucket = unitBucket(record.unitType);
  getLandosDb().prepare(`
    INSERT INTO landos_official_site (
      state, jurisdiction_key, unit_type, jurisdiction, url, label, verified_via, basis, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(state, jurisdiction_key, unit_type) DO UPDATE SET
      jurisdiction=excluded.jurisdiction, url=excluded.url, label=excluded.label,
      verified_via=excluded.verified_via, basis=excluded.basis,
      last_verified_at=excluded.last_verified_at
  `).run(
    state, key, bucket, record.jurisdiction, record.url, record.label,
    record.verifiedVia, record.basis, Math.floor(Date.now() / 1000),
  );
  landosAudit(
    actor,
    'official_site_learned',
    `${record.jurisdiction}, ${state} (${record.verifiedVia})`,
    { refTable: 'landos_official_site' },
  );
}

/**
 * The store as the local lane's injected cache.
 *
 * Kept here so `land-use-local.ts` stays a pure research lane with no database
 * import of its own, and so a test can hand it nothing at all.
 */
export function landosOfficialSiteCache(): {
  get(state: string, jurisdiction: string, unitType: GovernmentUnitType): { url: string; label: string } | null;
  save(entry: Omit<OfficialSiteRecord, 'lastVerifiedAt'>): void;
} {
  return {
    get(state, jurisdiction, unitType) {
      try {
        const record = getOfficialSite(state, jurisdiction, unitType);
        return isOfficialSiteFresh(record) ? { url: record!.url, label: record!.label } : null;
      } catch {
        return null;
      }
    },
    save(entry) {
      try { saveOfficialSite(entry); } catch { /* a cache write never fails research */ }
    },
  };
}

/** A learned site is reused for this long before it is re-verified. */
export function isOfficialSiteFresh(record: OfficialSiteRecord | null, maxAgeDays = 90): boolean {
  if (!record?.lastVerifiedAt) return false;
  return (Date.now() / 1000 - record.lastVerifiedAt) / 86400 <= maxAgeDays;
}
