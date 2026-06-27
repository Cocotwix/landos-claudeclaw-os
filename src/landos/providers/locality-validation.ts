// LandOS — parcel locality validation (identity-confidence guard).
//
// Realie's address endpoint matches on state + street-line only (it does not
// accept ZIP, and only honors city when county is also supplied). A statewide
// street-name match can therefore return a parcel in the WRONG locality. This
// guard compares the RETURNED parcel's locality against the SEARCHED locality
// and refuses to let a conflicting match be treated as Verified. Pure.

export interface LocalityFields {
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type LocalityConfidence = 'high' | 'medium' | 'low' | 'none';

export interface LocalityCheck {
  /** False when a hard conflict (state / zip / county) means the returned parcel
   *  is a different place than was searched — caller must NOT mark it Verified. */
  ok: boolean;
  confidence: LocalityConfidence;
  conflicts: string[];
  note: string;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toString().trim().toLowerCase().replace(/\s+county$/i, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function zip5(s: string | null | undefined): string {
  const m = (s ?? '').toString().match(/\d{5}/);
  return m ? m[0] : '';
}
/** 'match' | 'conflict' | 'unknown' — unknown when either side is absent. */
function cmp(a: string | null | undefined, b: string | null | undefined): 'match' | 'conflict' | 'unknown' {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 'unknown';
  if (x === y) return 'match';
  // Tolerate substring forms ("Macon" vs "Macon-Bibb", "St Marys" vs "Saint Marys").
  if (x.includes(y) || y.includes(x)) return 'match';
  return 'conflict';
}

/**
 * Validate a returned parcel's locality against the searched locality.
 * Hard signals (state, ZIP, county) that are present on BOTH sides and disagree
 * make ok=false (Needs Verification). City alone is a soft signal. Confidence is
 * scored from how many independent signals corroborate.
 */
export function validateLocality(searched: LocalityFields, returned: LocalityFields): LocalityCheck {
  const conflicts: string[] = [];
  const stateR = cmp(searched.state, returned.state);
  if (stateR === 'conflict') conflicts.push(`state (searched ${searched.state} != returned ${returned.state})`);

  const zs = zip5(searched.zip), zr = zip5(returned.zip);
  const zipR: 'match' | 'conflict' | 'unknown' = zs && zr ? (zs === zr ? 'match' : 'conflict') : 'unknown';
  if (zipR === 'conflict') conflicts.push(`zip (searched ${zs} != returned ${zr})`);

  const countyR = cmp(searched.county, returned.county);
  if (countyR === 'conflict') conflicts.push(`county (searched ${searched.county} != returned ${returned.county})`);

  const cityR = cmp(searched.city, returned.city);
  // City is a soft signal: a city-only disagreement (e.g. annexation/alias) is
  // noted but does not by itself fail validation if state+zip/county agree.
  const cityConflict = cityR === 'conflict';

  const hardConflict = stateR === 'conflict' || zipR === 'conflict' || countyR === 'conflict';

  let confidence: LocalityConfidence;
  if (hardConflict) confidence = 'none';
  else if (stateR === 'match' && (zipR === 'match' || countyR === 'match')) confidence = cityConflict ? 'medium' : 'high';
  else if (stateR === 'match' && cityR === 'match') confidence = 'medium';
  else if (stateR === 'match') confidence = 'low';
  else confidence = 'low'; // nothing to corroborate (sparse input) — best effort, not a conflict

  // A city-only conflict with otherwise-strong corroboration is surfaced but allowed.
  if (cityConflict && !hardConflict) conflicts.push(`city (searched ${searched.city} != returned ${returned.city}) [soft]`);

  const ok = !hardConflict;
  return {
    ok,
    confidence,
    conflicts,
    note: hardConflict
      ? `Returned parcel is a DIFFERENT locality than searched — ${conflicts.join('; ')}. Needs Verification.`
      : conflicts.length
        ? `Locality consistent on hard signals; soft note: ${conflicts.join('; ')}.`
        : 'Returned locality matches the searched locality.',
  };
}
