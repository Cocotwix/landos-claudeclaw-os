// LandOS — legal SOURCE classification and conflict handling.
//
// The engine's whole guarantee rests here: a URL is sorted into a tier before
// anything it says is allowed to become a conclusion, and two primary sources
// that disagree produce a named conflict rather than a silent winner.
//
// Nothing in this module names a jurisdiction. It classifies by the SHAPE of a
// source — who operates the host, what kind of body publishes it, what the
// document is — so a county LandOS has never seen is classified the same way
// as one it has.

import {
  isPrimaryTier,
  type DocumentFormat,
  type EvidencedValue,
  type LegalSourceCitation,
  type RuleConflict,
  type SourceAuthorityTier,
} from './land-use-types.js';

/* ─────────────────────────── host classification ─────────────────────── */

/**
 * Government-operated hosts.
 *
 * `.gov` and `.mil` are unambiguous. `.us` is not: it is open registration, so
 * a bare `.us` host proves nothing. Two `.us` shapes DO indicate government and
 * both occur constantly in real official sources:
 *
 *   * the state delegation, `<something>.<st>.us`
 *   * a host carrying a government unit or function token
 *
 * Both were verified live for this sprint. `cayugacounty.us` serves a county's
 * official site (it now redirects to `cayugacounty.gov`) and `palegis.us` is
 * the Pennsylvania General Assembly's own site. Requiring a bare `.gov` would
 * have classified a state legislature and a county government as aggregators
 * and thrown away their evidence.
 */
const GOVERNMENT_TLD = /(^|\.)(gov|mil)$/i;
const STATE_DELEGATED_US = /\.[a-z]{2}\.us$/i;
/**
 * Government tokens matched as SUBSTRINGS, not on label boundaries.
 *
 * Real official hosts routinely fuse the token to the jurisdiction name —
 * `cayugacounty.us` and `palegis.us` are both live examples verified for this
 * sprint, and a boundary-anchored match rejects both. The list is kept to
 * tokens that name a unit or a branch of government, so a commercial `.us`
 * does not accidentally qualify.
 */
const GOVERNMENT_TOKEN_US =
  /(county|counties|parish|township|village|borough|municipal|legis|legislature|assembly|statehouse|capitol|\bgov\b|gis|courts?|dot|dph)/i;

/**
 * Code publishers that host municipal and county codes on behalf of the
 * adopting body. These are NOT government hosts, but the document they serve
 * is the adopted code itself, published under contract with the jurisdiction.
 *
 * They are treated as primary ONLY for the code text, and only when the page
 * identifies the adopting jurisdiction. That is the same standard the parcel
 * engine already applies to vendor-hosted assessor portals.
 */
const OFFICIAL_CODE_PUBLISHERS: Array<{ pattern: RegExp; publisher: string }> = [
  { pattern: /(^|\.)municode\.com$/i, publisher: 'Municode (code publisher of record)' },
  { pattern: /(^|\.)ecode360\.com$/i, publisher: 'General Code eCode360 (code publisher of record)' },
  { pattern: /(^|\.)amlegal\.com$/i, publisher: 'American Legal Publishing (code publisher of record)' },
  { pattern: /(^|\.)generalcode\.com$/i, publisher: 'General Code (code publisher of record)' },
  { pattern: /(^|\.)codepublishing\.com$/i, publisher: 'Code Publishing Company (code publisher of record)' },
  { pattern: /(^|\.)sterlingcodifiers\.com$/i, publisher: 'Sterling Codifiers (code publisher of record)' },
  { pattern: /(^|\.)municipalcodeonline\.com$/i, publisher: 'Municipal Code Online (code publisher of record)' },
  { pattern: /(^|\.)conwaygreene\.com$/i, publisher: 'Conway Greene (code publisher of record)' },
  { pattern: /(^|\.)encodeplus\.com$/i, publisher: 'EnCodePlus (code publisher of record)' },
];

/**
 * Statute publishers a state has designated to publish its own code. A state
 * whose official code is published under contract is still publishing its
 * official code; the contract does not make the text secondary.
 */
const DESIGNATED_STATUTE_PUBLISHERS: Array<{ pattern: RegExp; publisher: string }> = [
  { pattern: /(^|\.)lexisnexis\.com$/i, publisher: 'LexisNexis (state-designated code publisher)' },
  { pattern: /(^|\.)westlaw\.com$/i, publisher: 'Westlaw (state-designated code publisher)' },
  { pattern: /(^|\.)casetext\.com$/i, publisher: 'Casetext' },
];

/**
 * Aggregators, brokers, explainers and unofficial mirrors. Useful for finding
 * the real source; never permitted to establish what the law says.
 */
const SECONDARY_ONLY_HOST =
  /justia|findlaw|law\.cornell\.edu|lawserver|zillow|realtor|redfin|trulia|landwatch|land\.com|loopnet|reddit|quora|medium|wikipedia|blogspot|wordpress|substack|zoneomics|zoning\.report|neighborwho|countyoffice\.org|propertyshark|regrid|landglide|homes\.com|har\.com|movoto|point2homes|rocketmortgage|bankrate|nolo\.com|avvo|legalzoom|chatgpt|openai|perplexity|bing\.com|google\.com|duckduckgo/i;

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function isGovernmentHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (GOVERNMENT_TLD.test(host)) return true;
  if (!/\.us$/i.test(host)) return false;
  // An open-registration `.us` needs a positive government signal. A bare one
  // is not treated as official.
  return STATE_DELEGATED_US.test(host) || GOVERNMENT_TOKEN_US.test(host);
}

export function officialCodePublisher(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return OFFICIAL_CODE_PUBLISHERS.find((entry) => entry.pattern.test(host))?.publisher ?? null;
}

export function designatedStatutePublisher(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return DESIGNATED_STATUTE_PUBLISHERS.find((entry) => entry.pattern.test(host))?.publisher ?? null;
}

export function isSecondaryOnlyHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  return SECONDARY_ONLY_HOST.test(host);
}

/* ─────────────────────────── tier classification ─────────────────────── */

export interface SourceClassification {
  tier: SourceAuthorityTier;
  publisher: string | null;
  /** Why the tier is what it is. Operator-readable. */
  reason: string;
}

/**
 * What KIND of authority a source is, from the URL, the page title, and an
 * optional hint about what LandOS went looking for.
 *
 * The hint never upgrades a secondary host. It only sharpens the tier of a
 * source that already qualifies — a `.gov` page LandOS reached while resolving
 * septic authority is a health authority source, not a generic one.
 */
export function classifySource(
  url: string,
  label: string,
  hint?: SourceAuthorityTier,
): SourceClassification {
  const host = hostOf(url);
  const haystack = `${url} ${label}`.toLowerCase();

  if (!host) {
    return { tier: 'secondary_discovery_only', publisher: null, reason: 'The source has no resolvable host.' };
  }

  if (isSecondaryOnlyHost(url)) {
    return {
      tier: 'secondary_discovery_only',
      publisher: null,
      reason: 'Aggregator, mirror or commentary host. It may point at the law; it may not state it.',
    };
  }

  const codePublisher = officialCodePublisher(url);
  if (codePublisher) {
    // The code publishers serve both zoning and subdivision chapters; the
    // distinction comes from the document, not the host.
    const tier: SourceAuthorityTier =
      /subdivision|land[-_ ]?division|plat/i.test(haystack) ? 'subdivision_ordinance'
        : /zoning|land[-_ ]?use|development[-_ ]?code/i.test(haystack) ? 'zoning_ordinance'
          : hint && isPrimaryTier(hint) ? hint
            : 'municipal_code';
    return { tier, publisher: codePublisher, reason: 'Adopted code served by the jurisdiction’s code publisher of record.' };
  }

  const statutePublisher = designatedStatutePublisher(url);
  if (statutePublisher && !/casetext/i.test(statutePublisher)) {
    return { tier: 'state_statute', publisher: statutePublisher, reason: 'State code served by the state’s designated publisher.' };
  }
  if (statutePublisher) {
    return { tier: 'secondary_discovery_only', publisher: statutePublisher, reason: 'Commercial case-law mirror; discovery only.' };
  }

  if (!isGovernmentHost(url)) {
    return {
      tier: 'secondary_discovery_only',
      publisher: null,
      reason: 'Not a government host and not a code publisher of record.',
    };
  }

  // Government host. Sharpen by what the URL and title say the page is.
  if (/legislature|legis\.|statutes?|revised[-_ ]?code|general[-_ ]?assembly|senate|house|lawfilesext|codes?\b/i.test(haystack)) {
    return { tier: 'state_statute', publisher: null, reason: 'State legislative or statutory publication.' };
  }
  if (/administrative[-_ ]?code|admin[-_ ]?rules?|rules?\.|regulations?/i.test(haystack)) {
    return { tier: 'state_administrative_code', publisher: null, reason: 'State administrative code or rule publication.' };
  }
  if (/\bdot\b|transportation|highway/i.test(haystack)) {
    return { tier: 'state_dot', publisher: null, reason: 'Transportation / highway authority.' };
  }
  if (/health|environmental[-_ ]?health|septic|onsite|wastewater|sewage/i.test(haystack)) {
    return { tier: 'health_or_septic_authority', publisher: null, reason: 'Health or onsite wastewater authority.' };
  }
  if (/manufactured[-_ ]?hous|mobile[-_ ]?home|modular/i.test(haystack)) {
    return { tier: 'manufactured_housing_regulator', publisher: null, reason: 'Manufactured housing regulator.' };
  }
  if (/environmental|dnr|deq|epd|ecology/i.test(haystack)) {
    return { tier: 'environmental_authority', publisher: null, reason: 'Environmental authority.' };
  }
  if (/zoning[-_ ]?map|gis|parcel|arcgis|mapserver|featureserver/i.test(haystack)) {
    return { tier: /zoning[-_ ]?map/i.test(haystack) ? 'zoning_map' : 'official_gis', publisher: null, reason: 'Official government mapping service.' };
  }
  if (/subdivision|land[-_ ]?division|plat/i.test(haystack)) {
    return { tier: 'subdivision_ordinance', publisher: null, reason: 'Subdivision or land-division regulation published by the jurisdiction.' };
  }
  if (/zoning|development[-_ ]?code|land[-_ ]?use[-_ ]?(code|ordinance)/i.test(haystack)) {
    return { tier: 'zoning_ordinance', publisher: null, reason: 'Zoning or development code published by the jurisdiction.' };
  }
  if (/planning|community[-_ ]?development|permit/i.test(haystack)) {
    return { tier: 'planning_department', publisher: null, reason: 'Planning or community development department.' };
  }
  if (/\bform\b|application|checklist|handbook|guide/i.test(haystack)) {
    return { tier: 'official_form_or_guidance', publisher: null, reason: 'Official form or administrative guidance.' };
  }
  if (/attorney[-_ ]?general|\bag\b.*opinion/i.test(haystack)) {
    return { tier: 'state_attorney_general', publisher: null, reason: 'State attorney general publication.' };
  }
  if (/township|town of|city of|village of|borough of/i.test(haystack)) {
    return { tier: /township/i.test(haystack) ? 'township_code' : 'municipal_code', publisher: null, reason: 'Local government publication.' };
  }
  if (/county|parish/i.test(haystack)) {
    return { tier: 'county_code', publisher: null, reason: 'County government publication.' };
  }
  if (hint && isPrimaryTier(hint)) {
    return { tier: hint, publisher: null, reason: 'Government host; classified by the question it was retrieved to answer.' };
  }
  return { tier: 'state_agency', publisher: null, reason: 'Government host with no sharper classification.' };
}

/* ──────────────────────────── citation building ──────────────────────── */

/** Excerpts are bounded so evidence stays inspectable without becoming a dump. */
export const MAX_EXCERPT_CHARS = 900;

export function boundExcerpt(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length <= MAX_EXCERPT_CHARS ? clean : `${clean.slice(0, MAX_EXCERPT_CHARS)}…`;
}

export interface CitationInput {
  url: string;
  label: string;
  citation?: string | null;
  excerpt?: string | null;
  format?: DocumentFormat;
  effectiveDate?: string | null;
  publisher?: string | null;
  tierHint?: SourceAuthorityTier;
  /**
   * An authoritative tier the CALLER knows from the retrieval route, which
   * wins outright.
   *
   * The URL-shape classifier cannot tell a statute from a state agency page
   * that talks about statutes: a live Georgia agency page whose path contains
   * "governing-statutes" was classified as the statute text itself. The lane
   * that retrieved it knows better, and its knowledge has to be able to win.
   */
  tier?: SourceAuthorityTier;
  retrievedAt: string;
}

export function buildCitation(input: CitationInput): LegalSourceCitation {
  const classified = classifySource(input.url, input.label, input.tierHint);
  return {
    tier: input.tier ?? classified.tier,
    label: input.label,
    url: input.url,
    publisher: input.publisher ?? classified.publisher,
    citation: input.citation ?? null,
    excerpt: boundExcerpt(input.excerpt),
    format: input.format ?? 'unknown',
    effectiveDate: input.effectiveDate ?? null,
    retrievedAt: input.retrievedAt,
  };
}

/** Deduplicate by URL + section, keeping the richest entry for each. */
export function dedupeCitations(citations: readonly LegalSourceCitation[]): LegalSourceCitation[] {
  const byKey = new Map<string, LegalSourceCitation>();
  for (const citation of citations) {
    const key = `${citation.url}::${citation.citation ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, citation); continue; }
    const richer = (citation.excerpt?.length ?? 0) > (existing.excerpt?.length ?? 0) ? citation : existing;
    byKey.set(key, richer);
  }
  return [...byKey.values()];
}

/* ───────────────────────────── rule conflict ─────────────────────────── */

export interface ConflictCandidate {
  citation: LegalSourceCitation;
  /** The value this source states, already normalized for comparison. */
  normalizedValue: string;
  /** The source's own words. */
  says: string;
}

/**
 * Detect disagreement between PRIMARY sources.
 *
 * A secondary source disagreeing with a primary one is not a conflict — it is
 * a secondary source being wrong, and it never reaches a conclusion anyway. A
 * conflict between two primary sources is never silently resolved: LandOS
 * returns both sides and stops.
 */
export function detectRuleConflict(
  subject: string,
  candidates: readonly ConflictCandidate[],
): RuleConflict | null {
  const primaries = candidates.filter((candidate) => isPrimaryTier(candidate.citation.tier));
  if (primaries.length < 2) return null;
  const distinct = new Set(primaries.map((candidate) => candidate.normalizedValue.trim().toLowerCase()));
  if (distinct.size < 2) return null;
  return {
    statement: `${subject}: two official sources state different requirements. LandOS did not select between them.`,
    sides: primaries.map((candidate) => ({ citation: candidate.citation, says: candidate.says })),
  };
}

/**
 * Choose the value that governs when several primary sources agree, or report
 * the conflict when they do not.
 *
 * This never picks a winner between disagreeing primaries. Where a genuine
 * precedence rule applies (state baseline versus local supplement) it is
 * recorded in `RulePrecedenceRecord`, which is an explicit and inspectable
 * statement, not a hidden tiebreak.
 */
export function reconcilePrimarySources<T>(
  subject: string,
  candidates: ReadonlyArray<ConflictCandidate & { value: T }>,
  fallbackReason: string,
): EvidencedValue<T> {
  const primaries = candidates.filter((candidate) => isPrimaryTier(candidate.citation.tier));
  if (!primaries.length) {
    return {
      value: null,
      quality: 'unverified',
      citations: candidates.map((candidate) => candidate.citation),
      unresolvedReason: fallbackReason,
      conflict: null,
    };
  }
  const conflict = detectRuleConflict(subject, primaries);
  if (conflict) {
    return {
      value: null,
      quality: 'conflicting_official',
      citations: primaries.map((candidate) => candidate.citation),
      unresolvedReason: conflict.statement,
      conflict,
    };
  }
  const citations = dedupeCitations(primaries.map((candidate) => candidate.citation));
  return {
    value: primaries[0].value,
    quality: new Set(citations.map((citation) => citation.url)).size > 1 ? 'verified_multiple_official' : 'verified_official',
    citations,
    unresolvedReason: null,
    conflict: null,
  };
}

/* ───────────────────────────── excerpt search ────────────────────────── */

export interface ProvisionMatch {
  /** The matched sentence or clause, verbatim and bounded. */
  excerpt: string;
  /** Section identifier found immediately before the match, when present. */
  section: string | null;
  /** Character offset, so a later pass can widen the window. */
  offset: number;
}

/** Section headings across the code publishers LandOS reads. */
// A heading, and deliberately NOT a date. `2014-09-22` satisfies a naive
// number-dot-number shape, and a live New York run recorded that revision
// date as the section number of Town Law 276.
const ISO_DATE = /^(?:19|20)[0-9]{2}[-.]/;
const SECTION_PATTERN =
  /(?:§+\s*)?(?:Sec(?:tion)?\.?\s*)?((?:[0-9]+[A-Za-z]?)(?:[-.–][0-9]+[A-Za-z]?){1,5})(?=[\s.:)-])/g;

/**
 * Find the section identifier that governs a position in a document, by taking
 * the nearest preceding heading. Returns null rather than the document's first
 * heading when nothing precedes the match, because a wrong citation is worse
 * than an absent one.
 */
export function sectionForOffset(text: string, offset: number): string | null {
  SECTION_PATTERN.lastIndex = 0;
  let best: string | null = null;
  for (let match = SECTION_PATTERN.exec(text); match; match = SECTION_PATTERN.exec(text)) {
    if (match.index > offset) break;
    // Only accept a heading within a reasonable distance; a section number
    // 40kB earlier does not govern this sentence.
    if (ISO_DATE.test(match[1])) continue;
    if (offset - match.index <= 6000) best = match[1];
  }
  return best;
}

/**
 * Pull the sentences in `text` that match `pattern`, with their section.
 *
 * Matches are returned verbatim. Nothing is rewritten, summarized or
 * normalized here: this is the evidence an operator checks the conclusion
 * against, and a paraphrase would defeat the point.
 */
export function findProvisions(
  text: string,
  pattern: RegExp,
  options: { maxMatches?: number; window?: number; lead?: number } = {},
): ProvisionMatch[] {
  const maxMatches = options.maxMatches ?? 6;
  const window = options.window ?? 400;
  // No lead by default. A third of the window ahead of the match reached back
  // into the PREVIOUS provision on live pages, so a Georgia excerpt for the
  // zoning statute opened with a sentence about annexation disputes.
  const lead = options.lead ?? 0;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const rx = new RegExp(pattern.source, flags);
  const matches: ProvisionMatch[] = [];
  const seen = new Set<string>();

  for (let match = rx.exec(text); match && matches.length < maxMatches; match = rx.exec(text)) {
    const start = Math.max(0, match.index - lead);
    const end = Math.min(text.length, match.index + match[0].length + window);
    const raw = text.slice(start, end);
    const excerpt = boundExcerpt(raw);
    if (!excerpt) continue;
    const key = excerpt.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ excerpt, section: sectionForOffset(text, match.index), offset: match.index });
    if (rx.lastIndex === match.index) rx.lastIndex += 1;
  }
  return matches;
}
