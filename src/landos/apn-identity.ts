// Shared parcel-identifier identity.
//
// One parcel is filed in several spellings. Iredell County, NC files
// `4870-90-2087`; LandPortal prints the same parcel as `4870-90-2087.000`.
// Tennessee files `015 027 04512 000 2026` for the parcel its GISLINK form
// calls `027 045.12`. Every LandOS gate that asks "is this the same parcel?"
// has to answer identically, or one gate reaches the correct parcel and the
// next throws it away as a wrong one.
//
// This module is that single answer. It replaced three near-copies of the same
// reduction that had already drifted apart.

/** PURE: the ordered digit groups of a parcel identifier. */
function apnGroups(raw: string): string[] {
  return (String(raw ?? '').match(/\d+/g) ?? []).filter(Boolean);
}

/**
 * PURE: every identity-bearing digit core one parcel identifier can reduce to.
 *
 * Three reductions are legitimate and jurisdiction-dependent, so the answer is
 * a SET rather than a single string:
 *   - the full ordered digits, stripping nothing;
 *   - trailing all-zero card/interest groups removed, repeatedly
 *     (`042-123.00-000` and `042 123.00` reduce alike);
 *   - a trailing 4-digit tax YEAR removed (Tennessee's `... 000 2026`).
 *
 * The year reduction used to be applied unconditionally, and that is what broke
 * Iredell County: `4870-90-2087` ends in a parcel group whose VALUE, 2087, sits
 * inside the year window, so the core was cut to `487090` while LandPortal's
 * `4870-90-2087.000` reduced to `4870902087`. One parcel, two cores, and the
 * live capture that had already landed on the right record rejected it. A
 * 4-digit group cannot be told apart from a year by looking at it alone, so the
 * reduction is now offered as a candidate instead of forced, and the comparison
 * below accepts a parcel when ANY pair of candidate cores agrees.
 *
 * Every reduction only ever removes NON-identifying trailing components and
 * always leaves >= 2 groups, so the map/parcel digits that separate
 * `042-123.00-000` from `042-124.00-000` are never lost.
 */
export interface ApnCore {
  core: string;
  /** True when a trailing 4-digit group was dropped as a possible tax YEAR. */
  yearStripped: boolean;
}

export function apnCores(raw: string): ApnCore[] {
  const base = apnGroups(raw);
  if (!base.length) return [];
  const seeds: Array<{ groups: string[]; yearStripped: boolean }> = [{ groups: base, yearStripped: false }];
  if (base.length >= 3) {
    const last = base[base.length - 1];
    const year = Number(last);
    if (last.length === 4 && year >= 1900 && year <= 2099) seeds.push({ groups: base.slice(0, -1), yearStripped: true });
  }
  const seen = new Map<string, boolean>();
  for (const seed of seeds) {
    // ONE terminal core per seed — the fully reduced form, exactly as the
    // original single-core reduction produced it. Emitting the intermediate
    // (partly stripped) forms as candidates too looked harmless and was not:
    // Roane's `073090 04200`, which has no separate trailing zero group to
    // strip, then matched Davidson's un-stripped `073-09-0-042-00` and
    // reconciled two different parcels. The ONLY added candidate is the year
    // ambiguity below, which is a genuine either/or about one 4-digit group.
    let groups = seed.groups;
    while (groups.length >= 3 && /^0+$/.test(groups[groups.length - 1])) groups = groups.slice(0, -1);
    const core = groups.join('');
    if (core.length < 4) continue;
    const prior = seen.get(core);
    // The least-assumed derivation wins: a core reachable without dropping a
    // possible year is not a year-stripped core.
    if (prior === undefined || (prior && !seed.yearStripped)) seen.set(core, seed.yearStripped);
  }
  return [...seen].map(([core, yearStripped]) => ({ core, yearStripped }));
}

/** PURE: the candidate identity cores of a parcel identifier. */
export function apnCoreVariants(raw: string): string[] {
  return apnCores(raw).map((c) => c.core);
}

/** PURE: the primary (most reduced) core, for display and legacy callers. */
export function apnCoreDigits(raw: string): string {
  const variants = apnCoreVariants(raw);
  if (!variants.length) return '';
  return variants.reduce((shortest, core) => (core.length < shortest.length ? core : shortest), variants[0]);
}

/**
 * PURE: do two parcel identifiers name the SAME parcel, allowing jurisdiction
 * format variants?
 *
 * Ordered structural equivalence between candidate cores: equal cores, or the
 * shorter core is the SUFFIX of the longer (a county/district prefix present in
 * one spelling and absent from a shorter map-and-parcel spelling), requiring
 * >= 7 shared digits so a weak partial can never corroborate.
 *
 * The year reduction is a GUESS about a 4-digit group, so it is allowed on at
 * most one side of a comparison. Applying it to both sides made neighbouring
 * Iredell parcels `4870-90-2087` and `4870-90-2088` corroborate on the shared
 * `487090` left after each lost its own parcel number. One side must always be
 * carrying its full digits.
 *
 * Reordered digit groups, neighbouring parcel numbers, differing suffixes
 * (Beaufort ...0085 vs ...0084) and unrelated identifiers all return false.
 * This is NOT substring matching, and jurisdiction is judged separately:
 * same-number parcels in different counties are still separated by the
 * county/state guard.
 */
export function apnIdentifiersCorroborate(a: string, b: string): boolean {
  const va = apnCores(a);
  const vb = apnCores(b);
  if (!va.length || !vb.length) return false;
  for (const ca of va) {
    for (const cb of vb) {
      if (ca.yearStripped && cb.yearStripped) continue;
      if (ca.core === cb.core) return true;
      const [shorter, longer] = ca.core.length <= cb.core.length ? [ca.core, cb.core] : [cb.core, ca.core];
      if (shorter.length >= 7 && longer.endsWith(shorter)) return true;
    }
  }
  return false;
}
