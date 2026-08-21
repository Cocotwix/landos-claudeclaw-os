// Comparable geography — where a retained comp actually is, how far that is from
// the subject, and what that distance is allowed to mean for value.
//
// Discovery stays permissive. This module is the discipline AFTER discovery: it
// answers "is this local subject-market evidence, or is it broader county /
// premium-submarket context?" and refuses to let the second quietly price the
// subject as if it were the first.
//
// Two facts decide the tier, and neither alone is enough:
//
//   Distance — straight-line miles from the subject. Real, measurable, and the
//     reason a 26-mile sale is not local no matter whose county line it sits on.
//
//   Submarket — the city/ZIP the record belongs to. County membership is NOT
//     comparability: Williamson County holds both Fairview and Franklin, and a
//     Franklin acre is a different product at a different price. A record in a
//     different submarket has to be genuinely close to still count as local.
//
// Nothing here deletes a candidate. A comp that resolves to broader market
// context, or resolves nowhere at all, stays retained and visible; it simply
// cannot carry the same valuation weight as geographically verified local
// evidence, and the surface says which it is.

/** How precisely this record's point is known. */
export type CompGeoPrecision =
  /** A published parcel/listing coordinate or a matched street-address geocode. */
  | 'exact'
  /** A ZIP/place centroid: the right area, not the right parcel. */
  | 'approximate'
  /** No defensible point at all. No distance is invented. */
  | 'unresolved';

export type CompGeoTierId = 'local' | 'expanded' | 'broader' | 'unresolved';

export interface CompGeoTier {
  id: CompGeoTierId;
  /** Full operator label for panels and explanations. */
  label: string;
  /** Compact card badge, e.g. "Expanded market". */
  shortLabel: string;
  /** Outward ordering: local first. Higher means farther/weaker. */
  rank: number;
  /** Geographic weight multiplier applied inside the cleaned valuation. */
  weightMultiplier: number;
  rationale: string;
}

/** Local ring: a same-submarket record inside this stays local evidence. */
export const LOCAL_MARKET_MILES = 10;
/** A DIFFERENT submarket has to be this close to still be local evidence. */
export const LOCAL_CROSS_SUBMARKET_MILES = 6;
/** Outer bound of the expanded market. Beyond it is broader-market context. */
export const EXPANDED_MARKET_MILES = 25;
/** Closed sales a tier must supply before the search stops expanding outward. */
export const MIN_TIER_EVIDENCE = 3;
/** Absolute floor: below this the set expands even into weaker geography. */
export const MIN_ANY_EVIDENCE = 2;

export const COMP_GEO_TIERS: readonly CompGeoTier[] = [
  {
    id: 'local',
    label: 'Local / primary market',
    shortLabel: 'Local market',
    rank: 0,
    weightMultiplier: 1,
    rationale: 'Verified location in the subject\'s own immediate market; full geographic weight.',
  },
  {
    id: 'expanded',
    label: 'Nearby / expanded market',
    shortLabel: 'Expanded market',
    rank: 1,
    weightMultiplier: 0.8,
    rationale: 'Reasonably proximate to the subject and usable when local evidence is thin, ranked below local evidence.',
  },
  {
    id: 'broader',
    label: 'Broader market context',
    shortLabel: 'Broader market',
    rank: 2,
    weightMultiplier: 0.55,
    rationale: 'Same county or region but materially farther away, or a distinguishable different submarket; context first, valuation evidence only when closer evidence is genuinely insufficient.',
  },
  {
    id: 'unresolved',
    label: 'Location unresolved',
    shortLabel: 'Location unresolved',
    rank: 3,
    weightMultiplier: 0.35,
    rationale: 'No defensible location, so no distance is invented. Retained as market context; it can never be treated as local evidence.',
  },
] as const;

export function compGeoTier(id: CompGeoTierId): CompGeoTier {
  return COMP_GEO_TIERS.find((tier) => tier.id === id) as CompGeoTier;
}

// ── Locality parsing ─────────────────────────────────────────────────────────

export interface CompLocality {
  city: string | null;
  state: string | null;
  zip: string | null;
}

const US_STATE = /^[A-Z]{2}$/;

/**
 * Read the city / state / ZIP a retained address ALREADY states. Provider rows
 * arrive as one text run ("5929 North Lick Creek Road, Franklin, TN, 37064"),
 * so the locality is retained evidence sitting in a column nobody split. This
 * never invents a locality: a run that does not state one returns nulls.
 */
export function parseCompLocality(address: string | null | undefined): CompLocality {
  // Trailing empties are noise; a LEADING empty is evidence — a run captured as
  // ", Franklin, TN, 37064" states a city whose street the source never
  // published, and dropping the empty segment would silently lose it.
  const parts = String(address ?? '')
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim());
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  if (!parts.length) return { city: null, state: null, zip: null };
  let zip: string | null = null;
  let state: string | null = null;
  let city: string | null = null;

  const rest = [...parts];
  // ZIP, when the run ends with one (either its own segment or glued to the state).
  const tailZip = rest.length ? rest[rest.length - 1].match(/\b(\d{5})(?:-\d{4})?$/) : null;
  if (tailZip) {
    zip = tailZip[1];
    const remainder = rest[rest.length - 1].slice(0, tailZip.index).trim();
    if (remainder) rest[rest.length - 1] = remainder; else rest.pop();
  }
  // State, as the two-letter segment now at the tail.
  if (rest.length && US_STATE.test(rest[rest.length - 1].toUpperCase())) {
    state = rest.pop()!.toUpperCase();
  }
  // City is the segment preceding the state/ZIP, and only when a street segment
  // came before it. "BRUSH CREEK RD, TN, 37062" names a road and no city, and
  // reading the road as the municipality would invent a submarket.
  if ((state || zip) && rest.length >= 2) city = rest[rest.length - 1];

  return {
    city: city && /[a-z]/i.test(city) ? city : null,
    state,
    zip,
  };
}

/** Normalized submarket identity: the ZIP when known, else the city name. */
export function compSubmarketKey(
  city: string | null | undefined,
  zip: string | null | undefined,
): string | null {
  const z = String(zip ?? '').trim().match(/^\d{5}/)?.[0] ?? null;
  if (z) return `zip:${z}`;
  const c = String(city ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return c ? `city:${c}` : null;
}

const sameText = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const left = String(a ?? '').trim().toLowerCase();
  const right = String(b ?? '').trim().toLowerCase();
  return !!left && !!right && left === right;
};

// ── Tier resolution ──────────────────────────────────────────────────────────

export interface CompGeoPlace {
  city?: string | null;
  zip?: string | null;
  county?: string | null;
  state?: string | null;
}

export interface CompGeoAssessment {
  tier: CompGeoTier;
  tierId: CompGeoTierId;
  /** Operator-readable statement of why this tier, naming the facts used. */
  reason: string;
  distanceMiles: number | null;
  precision: CompGeoPrecision;
  sameSubmarket: boolean;
  sameCounty: boolean;
  /** Compact card line, e.g. "8.8 miles from subject · Expanded market". */
  cardLine: string;
}

/**
 * Decide one retained comp's geographic tier from its distance and its
 * submarket. Deterministic and subject-agnostic: no city, ZIP, county, or price
 * is hardcoded, so the same rules run for every deal.
 */
export function assessCompGeography(input: {
  distanceMiles: number | null | undefined;
  precision: CompGeoPrecision;
  comp: CompGeoPlace;
  subject: CompGeoPlace;
}): CompGeoAssessment {
  const distance = typeof input.distanceMiles === 'number' && Number.isFinite(input.distanceMiles)
    && input.distanceMiles >= 0 ? Math.round(input.distanceMiles * 10) / 10 : null;
  const precision: CompGeoPrecision = distance == null ? 'unresolved' : input.precision;

  const compKey = compSubmarketKey(input.comp.city, input.comp.zip);
  const subjectKey = compSubmarketKey(input.subject.city, input.subject.zip);
  const sameSubmarket = !!compKey && !!subjectKey && compKey === subjectKey;
  const sameCounty = sameText(input.comp.county, input.subject.county)
    && (!input.comp.state || !input.subject.state || sameText(input.comp.state, input.subject.state));

  const submarketWord = input.comp.city || input.comp.zip
    ? `${input.comp.city ?? ''}${input.comp.city && input.comp.zip ? ' ' : ''}${input.comp.zip ?? ''}`.trim()
    : null;

  if (distance == null || precision === 'unresolved') {
    const tier = compGeoTier('unresolved');
    return {
      tier,
      tierId: 'unresolved',
      reason: sameCounty
        ? `No defensible location resolved for this record, so no distance from the subject exists. It sits in the same ${input.comp.county} County market, but county membership is not comparability — it stays retained market context and is never treated as local evidence.`
        : 'No defensible location resolved for this record, so no distance from the subject is invented. It stays retained market context and is never treated as local evidence.',
      distanceMiles: null,
      precision: 'unresolved',
      sameSubmarket,
      sameCounty,
      cardLine: 'Distance unresolved · Location unresolved',
    };
  }

  let tierId: CompGeoTierId;
  let reason: string;

  const localByRing = distance <= LOCAL_CROSS_SUBMARKET_MILES;
  const localBySubmarket = sameSubmarket && distance <= LOCAL_MARKET_MILES;

  if (precision === 'exact' && (localByRing || localBySubmarket)) {
    tierId = 'local';
    reason = localBySubmarket && !localByRing
      ? `${distance} miles from the subject and inside the subject's own ${submarketWord ?? 'submarket'}, so it is local subject-market evidence.`
      : `${distance} miles from the subject, inside the ${LOCAL_CROSS_SUBMARKET_MILES}-mile local ring, so it is local subject-market evidence.`;
  } else if (distance <= EXPANDED_MARKET_MILES && (sameSubmarket || distance <= LOCAL_MARKET_MILES)) {
    tierId = 'expanded';
    reason = precision === 'approximate'
      ? `${distance} miles from the subject, but the point is a ${submarketWord ?? 'ZIP'} area centroid rather than a parcel location, so it is nearby/expanded-market evidence and never local evidence.`
      : sameSubmarket
        ? `${distance} miles from the subject inside the same ${submarketWord ?? 'submarket'} — past the ${LOCAL_MARKET_MILES}-mile local ring, so it supports the value as expanded-market evidence.`
        : `${distance} miles from the subject in ${submarketWord ?? 'a different submarket'}, close enough to support the value as expanded-market evidence but not to be called local.`;
  } else {
    tierId = 'broader';
    reason = distance > EXPANDED_MARKET_MILES
      ? `${distance} miles from the subject${submarketWord ? ` in ${submarketWord}` : ''}, beyond the ${EXPANDED_MARKET_MILES}-mile expanded market${sameCounty ? ` — same ${input.comp.county} County, which is regional context, not local comparability` : ''}.`
      : `${distance} miles from the subject in ${submarketWord ?? 'a different submarket'}, a distinguishable submarket past the ${LOCAL_MARKET_MILES}-mile local ring${sameCounty ? ` — same ${input.comp.county} County, which is regional context, not local comparability` : ''}.`;
  }

  const tier = compGeoTier(tierId);
  return {
    tier,
    tierId,
    reason,
    distanceMiles: distance,
    precision,
    sameSubmarket,
    sameCounty,
    cardLine: `${distance} ${distance === 1 ? 'mile' : 'miles'} from subject · ${tier.shortLabel}${precision === 'approximate' ? ' (approximate)' : ''}`,
  };
}

// ── Tiered valuation-set selection ───────────────────────────────────────────

export interface GeoTierCounts {
  local: number;
  expanded: number;
  broader: number;
  unresolved: number;
}

export interface CompGeoSelection {
  /** Tiers actually admitted into the strict valuation set, closest first. */
  tiersIncluded: CompGeoTierId[];
  /** Outermost tier the set had to reach. */
  outermostTier: CompGeoTierId | null;
  /** True when the set had to reach past the local market. */
  expandedBeyondLocal: boolean;
  /** True when broader-market (or unresolved) geography materially prices the subject. */
  reliesOnBroaderGeography: boolean;
  /** Counts of the qualifying candidates offered, by tier. */
  offered: GeoTierCounts;
  /** Counts of the candidates actually admitted, by tier. */
  admitted: GeoTierCounts;
  admittedCount: number;
  /** Keys admitted into the strict valuation set. */
  admittedKeys: string[];
  /** Keys held out of the strict set on geography, with a reason per key. */
  heldOut: Array<{ key: string; tierId: CompGeoTierId; reason: string }>;
  /** e.g. "5 closed sales qualify: 2 local · 2 expanded · 1 broader-market support". */
  compositionLabel: string;
  /** Full operator sentence explaining why the search stopped where it did. */
  disclosure: string;
}

const TIER_ORDER: CompGeoTierId[] = ['local', 'expanded', 'broader', 'unresolved'];

const emptyCounts = (): GeoTierCounts => ({ local: 0, expanded: 0, broader: 0, unresolved: 0 });

/**
 * Start local. Expand outward ONLY when the closer tier does not hold enough
 * credible closed-sale evidence, and say so out loud when it happens.
 *
 * Nothing is discarded here: a candidate outside the admitted tiers stays a
 * retained comparable with its own stated reason for carrying no strict weight.
 */
export function selectGeographicValuationSet(
  candidates: Array<{ key: string; tierId: CompGeoTierId }>,
  opts: { minimum?: number; floor?: number } = {},
): CompGeoSelection {
  const minimum = opts.minimum ?? MIN_TIER_EVIDENCE;
  const floor = opts.floor ?? MIN_ANY_EVIDENCE;

  const offered = emptyCounts();
  for (const candidate of candidates) offered[candidate.tierId] += 1;

  const tiersIncluded: CompGeoTierId[] = [];
  let running = 0;
  for (const tierId of TIER_ORDER) {
    // The unresolved tier is a last resort: it is only reached when every
    // resolved tier together still cannot support a valuation at all.
    if (tierId === 'unresolved' && running >= floor) break;
    if (running >= minimum) break;
    tiersIncluded.push(tierId);
    running += offered[tierId];
  }
  // A trailing empty tier adds nothing and must not be reported as an expansion.
  while (tiersIncluded.length > 1 && offered[tiersIncluded[tiersIncluded.length - 1]] === 0) {
    tiersIncluded.pop();
  }
  if (!tiersIncluded.length) tiersIncluded.push('local');

  const included = new Set(tiersIncluded);
  const admitted = emptyCounts();
  const admittedKeys: string[] = [];
  const heldOut: CompGeoSelection['heldOut'] = [];
  for (const candidate of candidates) {
    if (included.has(candidate.tierId)) {
      admitted[candidate.tierId] += 1;
      admittedKeys.push(candidate.key);
    } else {
      const tier = compGeoTier(candidate.tierId);
      heldOut.push({
        key: candidate.key,
        tierId: candidate.tierId,
        reason: candidate.tierId === 'unresolved'
          ? 'Location unresolved, so this sale cannot be given the valuation weight of a geographically verified comparable. It stays retained as market context.'
          : `${tier.label}: closer evidence already supports the value, so this sale stays retained market context rather than pricing the subject.`,
      });
    }
  }

  const outermostTier = tiersIncluded.length
    ? [...tiersIncluded].reverse().find((tierId) => admitted[tierId] > 0) ?? tiersIncluded[0]
    : null;
  const expandedBeyondLocal = admitted.expanded + admitted.broader + admitted.unresolved > 0;
  const reliesOnBroaderGeography = admitted.broader + admitted.unresolved > 0;

  const admittedCount = admittedKeys.length;
  const bits: string[] = [];
  if (admitted.local) bits.push(`${admitted.local} local`);
  if (admitted.expanded) bits.push(`${admitted.expanded} expanded`);
  if (admitted.broader) bits.push(`${admitted.broader} broader-market support`);
  if (admitted.unresolved) bits.push(`${admitted.unresolved} location-unresolved`);
  const compositionLabel = admittedCount
    ? `${admittedCount} closed sale${admittedCount === 1 ? '' : 's'} qualify: ${bits.join(' · ')}`
    : 'No closed sale qualifies on geography';

  const disclosure = (() => {
    if (!admittedCount) {
      return 'No retained closed vacant-land sale resolved to a usable location inside the local, expanded, or broader market, so no geographically supported set exists.';
    }
    if (!expandedBeyondLocal) {
      return `${admitted.local} local closed sale${admitted.local === 1 ? '' : 's'} inside the subject's own market support the value, so no geographic expansion was needed.`;
    }
    const why = `Local evidence held ${offered.local} qualifying closed sale${offered.local === 1 ? '' : 's'}, below the ${minimum} needed to price the subject on local evidence alone, so the set expanded outward.`;
    if (!reliesOnBroaderGeography) {
      return `${why} It stopped at the nearby/expanded market; no broader-market sale was needed.`;
    }
    return `${why} Local and expanded evidence together were still insufficient, so ${admitted.broader ? `${admitted.broader} broader-market sale${admitted.broader === 1 ? '' : 's'}` : 'location-unresolved evidence'} had to be admitted. The adopted value therefore relies materially on geography outside the subject's immediate market, and confidence is reduced accordingly.`;
  })();

  return {
    tiersIncluded,
    outermostTier,
    expandedBeyondLocal,
    reliesOnBroaderGeography,
    offered,
    admitted,
    admittedCount,
    admittedKeys,
    heldOut,
    compositionLabel,
    disclosure,
  };
}
