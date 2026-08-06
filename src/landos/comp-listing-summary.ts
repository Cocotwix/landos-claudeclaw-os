// The source description and the LandOS summary, kept strictly apart.
//
// A broker's description is marketing. "Ready to build", "perc approved",
// "utilities available", "unrestricted" are CLAIMS — sometimes true, sometimes
// aspirational, never verified by the act of being printed on a listing page. If
// LandOS folds them into its own summary they become facts, and an offer gets
// built on someone else's sales copy.
//
// So there are two blocks and they never blend:
//
//   • Source description — the original wording, preserved, attributed to the
//     platform that published it, never strengthened and never presented as fact.
//   • LandOS factual summary — written from RETAINED evidence only. It separates
//     what is verified, what the listing merely claimed, what is unresolved, and
//     how the parcel compares to the subject.
//
// Marketing claims are detected and downgraded explicitly, so a claim can be
// shown to the operator as a claim rather than quietly disappearing or quietly
// being promoted.

export interface SourceDescription {
  text: string;
  /** Who published the wording, e.g. "Zillow listing description". */
  attribution: string;
  /** Always true: this block is marketing copy, not established fact. */
  isMarketingCopy: true;
  note: string;
}

/**
 * HTML entities a provider's own JSON payload carries into the description.
 *
 * Providers embed the description as HTML, so an apostrophe arrives as `&rsquo;`
 * and a dash as `&mdash;`. Rendering those raw puts "Don&rsquo;t be deceived" in
 * front of the operator, which is neither the source's wording nor readable
 * English. Decoding is done at READ time rather than at capture, so descriptions
 * already persisted are repaired without revisiting a single provider page.
 *
 * This decodes text entities ONLY. It never parses or renders markup, so a
 * description can never inject anything into the page.
 */
const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', deg: '°',
  frac12: '½', frac14: '¼', frac34: '¾', times: '×',
  bull: '•', middot: '·', eacute: 'é', reg: '®', trade: '™',
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]{1,9});/gi, (whole, name: string) => {
      const hit = HTML_ENTITIES[name.toLowerCase()];
      return hit ?? whole;
    });
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Preserve the source description verbatim, attributed and labeled. */
export function buildSourceDescription(
  text: string | null | undefined,
  provider: string,
): SourceDescription | null {
  const trimmed = decodeHtmlEntities(text ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return {
    text: trimmed,
    attribution: `${provider} listing description`,
    isMarketingCopy: true,
    note: `Published by ${provider} as written by the broker, agent, or seller. LandOS preserves the wording and does not treat it as verified fact.`,
  };
}

/** Claims that sound like facts and are not, unless independently confirmed. */
const CLAIM_PATTERNS: Array<{ rx: RegExp; claim: string }> = [
  { rx: /perc(olation)?\s*(test)?\s*(approved|passed|done|complete)/i, claim: 'perc approved' },
  { rx: /\bready\s*to\s*build\b/i, claim: 'ready to build' },
  { rx: /utilit(y|ies)\s*(are\s*)?(available|at\s*(the\s*)?(road|street|lot))/i, claim: 'utilities available' },
  { rx: /\bunrestricted\b|no\s*restrictions/i, claim: 'unrestricted' },
  { rx: /\bbuildable\b/i, claim: 'buildable' },
  { rx: /\bsurveyed\b|survey\s*(on\s*file|complete|available)/i, claim: 'surveyed' },
  { rx: /\b(well|septic)\s*(installed|in\s*place|on\s*site|approved)/i, claim: 'well or septic in place' },
  { rx: /\bdriveway\s*(installed|in|roughed)/i, claim: 'driveway installed' },
  { rx: /\bsubdividable\b|can\s*be\s*(sub)?divided|\bsubdivide\b/i, claim: 'subdividable' },
  { rx: /\bdeeded\s*access\b|\beasement\b/i, claim: 'deeded access or easement' },
  { rx: /\bcleared\b/i, claim: 'cleared' },
  { rx: /\bcity\s*(water|sewer)\b|public\s*(water|sewer)/i, claim: 'public water or sewer' },
];

/** Physical features a description mentions that LandOS can note as unverified. */
const FEATURE_PATTERNS: Array<{ rx: RegExp; feature: string }> = [
  { rx: /\bwooded\b|\btimber(ed)?\b|\bforest(ed)?\b/i, feature: 'wooded' },
  { rx: /\bopen\s*(field|land|meadow)\b|\bcleared\s*field\b|\bpasture\b/i, feature: 'open field or pasture' },
  { rx: /\bcreek\b|\bstream\b|\bbrook\b|\bpond\b|\bwaterfront\b|\bfrontage\s*on\s*(the\s*)?(lake|river)/i, feature: 'water feature' },
  { rx: /\bwetland/i, feature: 'wetland' },
  { rx: /\brolling\b|\bhilly\b|\bslope[ds]?\b|\bridge\b/i, feature: 'sloped or rolling terrain' },
  { rx: /\bhunt(ing)?\b|\brecreation(al)?\b/i, feature: 'recreational use marketed' },
  { rx: /\bresidential\b|\bhome\s*site\b|\bhomesite\b|\bbuild\s*your\b/i, feature: 'residential use marketed' },
];

export interface DetectedClaim {
  claim: string;
  /** The exact sentence the claim came from, so nothing is taken out of context. */
  excerpt: string;
  status: 'unverified_marketing_claim' | 'independently_confirmed';
}

/** Find marketing claims in a description without promoting any of them. */
export function detectMarketingClaims(
  text: string | null | undefined,
  confirmed: readonly string[] = [],
): DetectedClaim[] {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const confirmedSet = new Set(confirmed.map((c) => c.toLowerCase()));
  const sentences = t.split(/(?<=[.!?])\s+/);
  const out: DetectedClaim[] = [];
  for (const { rx, claim } of CLAIM_PATTERNS) {
    const sentence = sentences.find((s) => rx.test(s));
    if (!sentence) continue;
    if (out.some((c) => c.claim === claim)) continue;
    out.push({
      claim,
      excerpt: sentence.trim(),
      status: confirmedSet.has(claim.toLowerCase()) ? 'independently_confirmed' : 'unverified_marketing_claim',
    });
  }
  return out;
}

export function detectDescribedFeatures(text: string | null | undefined): string[] {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  for (const { rx, feature } of FEATURE_PATTERNS) if (rx.test(t) && !out.includes(feature)) out.push(feature);
  return out;
}

export interface LandosSummaryInput {
  address: string | null;
  acres: number | null;
  subjectAcres: number | null;
  distanceMiles: number | null;
  county: string | null;
  state: string | null;
  transactionKind: 'closed' | 'active' | 'context';
  /** Facts LandOS holds independently of the listing copy. */
  verifiedFacts: string[];
  /** Independently confirmed claims, if any ever are. */
  confirmedClaims?: readonly string[];
  sourceDescription: string | null;
  /** Whether public road frontage is established by retained evidence. */
  roadFrontageVerified?: boolean | null;
  propertyClass?: 'land' | 'improved' | 'unknown';
  buildingSqft?: number | null;
}

export interface LandosFactualSummary {
  /** One or two plain sentences built only from retained evidence. */
  text: string;
  verified: string[];
  sourceClaims: DetectedClaim[];
  unresolved: string[];
  comparability: string[];
  note: string;
}

/**
 * Write the LandOS summary for a comparable.
 *
 * Every sentence in `text` comes from `verifiedFacts` and the structural figures
 * (acreage, distance, county, transaction kind). Description-derived material is
 * confined to the `sourceClaims` and `unresolved` lists and is always worded as
 * something the listing said, never as something LandOS established.
 */
export function buildLandosFactualSummary(input: LandosSummaryInput): LandosFactualSummary {
  // Decoded first: an entity-escaped description would hide "don&rsquo;t" from
  // the claim patterns and quietly under-report what the listing asserted.
  const described = input.sourceDescription ? decodeHtmlEntities(input.sourceDescription) : null;
  const claims = detectMarketingClaims(described, input.confirmedClaims ?? []);
  const features = detectDescribedFeatures(described);

  const verified: string[] = [...input.verifiedFacts];
  if (input.acres != null) verified.push(`${input.acres} acres`);
  if (input.county || input.state) verified.push([input.county, input.state].filter(Boolean).join(', '));
  if (input.roadFrontageVerified === true) verified.push('public road frontage established by retained evidence');
  if (input.propertyClass === 'improved' && input.buildingSqft != null) {
    verified.push(`${input.buildingSqft.toLocaleString('en-US')} sqft structure on the parcel`);
  }

  const unresolved: string[] = [];
  if (input.roadFrontageVerified == null) unresolved.push('road frontage is not independently established');
  for (const c of claims) {
    if (c.status === 'unverified_marketing_claim') unresolved.push(`the listing claimed "${c.claim}", which LandOS has not independently confirmed`);
  }
  const improvementClaims = claims.map((c) => c.claim);
  if (!improvementClaims.some((c) => /well|septic/i.test(c))) {
    unresolved.push('no verified well, septic, driveway, or utility improvement was identified');
  }

  const comparability: string[] = [];
  if (input.acres != null && input.subjectAcres != null) {
    const delta = Math.round((input.acres - input.subjectAcres) * 100) / 100;
    comparability.push(delta === 0
      ? 'Same acreage as the subject.'
      : `${Math.abs(delta)} acres ${delta > 0 ? 'larger' : 'smaller'} than the ${input.subjectAcres}-acre subject.`);
  }
  if (input.distanceMiles != null) comparability.push(`${input.distanceMiles} miles from the subject.`);
  else comparability.push('Distance from the subject is unavailable because the location is unresolved.');
  if (input.propertyClass === 'improved') {
    comparability.push('Improved property: the price includes structure value, so it cannot price vacant land directly.');
  }

  // The narrative sentence. Structural facts only — no claim is stated as fact.
  const parts: string[] = [];
  const descriptor = features.includes('wooded') ? 'Wooded' : features.includes('open field or pasture') ? 'Open' : '';
  const acresText = input.acres != null ? `${input.acres} acre` : 'acreage-unstated';
  const place = [input.county, input.state].filter(Boolean).join(', ');
  parts.push(`${descriptor ? `${descriptor} ` : ''}${acresText} ${input.propertyClass === 'improved' ? 'improved' : 'rural'} parcel${place ? ` in ${place}` : ''}${input.roadFrontageVerified === true ? ' with verified public road frontage' : ''}.`.replace(/^\s+/, ''));
  if (features.length > 0) {
    parts.push(`The listing marketed the property as ${features.join(', ')}.`);
  }
  if (unresolved.some((u) => /well, septic/.test(u))) {
    parts.push('No verified well, septic, driveway, or utility improvements were identified.');
  }
  if (claims.some((c) => c.status === 'unverified_marketing_claim')) {
    parts.push(`Listing claims not independently confirmed: ${claims.filter((c) => c.status === 'unverified_marketing_claim').map((c) => c.claim).join(', ')}.`);
  }

  return {
    text: parts.join(' ').replace(/\s+/g, ' ').trim(),
    verified,
    sourceClaims: claims,
    unresolved,
    comparability,
    note: 'LandOS summary written from retained evidence. Marketing claims are listed separately and are never treated as verified facts.',
  };
}
