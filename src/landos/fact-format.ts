// Shared canonical fact formatting — geography names and numeric fact parsing.
//
// Geographic TYPE is presentation, not part of the stored name. Sources disagree
// about whether a county string already carries its suffix ("Pickens" vs
// "Pickens County"), so every renderer must go through formatCountyLabel /
// stripCountySuffix instead of appending " County" itself — that is how
// "Pickens County County" reached the operator. Acreage strings likewise arrive
// as "1.15 ac" / "1.15" / "~1.15 acres"; parseAcresValue is the ONE parser so a
// display surface can never fail to parse a value that a calculation surface is
// silently using.
//
// Pure + deterministic. No I/O.

const COUNTY_SUFFIX_RE = /\s+(county|parish|borough|census area|municipality)\s*$/i;

/** Remove a trailing county-type suffix from a geographic name ("Pickens County" → "Pickens"). */
export function stripCountySuffix(name: string | null | undefined): string | null {
  const v = (name ?? '').trim();
  if (!v) return null;
  return v.replace(COUNTY_SUFFIX_RE, '').trim() || null;
}

/**
 * Operator label for a county-type geography: exactly one suffix, regardless of
 * whether the stored name already carries one. Non-county suffixes already in
 * the name (Parish/Borough) are preserved rather than re-suffixed.
 */
export function formatCountyLabel(name: string | null | undefined): string | null {
  const v = (name ?? '').trim();
  if (!v) return null;
  if (COUNTY_SUFFIX_RE.test(v)) {
    // Already suffixed — collapse any accidental double suffix ("X County County").
    let out = v;
    while (COUNTY_SUFFIX_RE.test(out.replace(COUNTY_SUFFIX_RE, '').trim()) && COUNTY_SUFFIX_RE.test(out)) {
      out = out.replace(COUNTY_SUFFIX_RE, '').trim();
    }
    return COUNTY_SUFFIX_RE.test(out) ? out : `${out} County`;
  }
  return `${v} County`;
}

/** Collapse duplicated geographic suffix words in already-rendered text
 *  ("Pickens County County, SC" → "Pickens County, SC"). Read-time repair for
 *  persisted narrative strings; new strings should use formatCountyLabel. */
export function sanitizeGeographySuffixes(text: string | null | undefined): string {
  const v = text ?? '';
  return v.replace(/\b(County|Parish|Borough)(\s+\1)+\b/gi, '$1');
}

/** ONE acreage parser for every consumer. Accepts numbers or strings such as
 *  "1.15", "1.15 ac", "~1.15 acres", "1,234.5 ac". Returns null instead of NaN
 *  so a display surface can never show "?" while a calculation uses a number
 *  parsed elsewhere. */
export function parseAcresValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
