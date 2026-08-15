// LandOS — WHOSE source is this, and may it answer THIS question?
//
// A leaf module on purpose: the authority resolver, the zoning determination,
// the standards research and the subdivision retrieval all need the same two
// judgements, and each one previously carried its own copy.
//
//   1. TIER — does this host speak as a government at all?
//   2. RELATION — does it speak for the government that controls THIS parcel?
//
// The second is the one that keeps getting missed, and it is the expensive one.
// A live run accepted `sudbury.ma.us` — a real government host publishing real
// subdivision regulations — as the rules controlling a Tennessee parcel. It was
// official. It was current. It was adopted. It was about someone else's land.
// "Government" is not "jurisdiction", and ranking has to say so.

export type EvidenceTier = 'official_government_source' | 'reputable_secondary' | 'search_result';

/** Aggregators and brokers. Never a government source, whatever they publish. */
const BROKER_HOSTS = /netronline|countyoffice|zillow|realtor|redfin|trulia|propertyshark|landglide|regrid|loopnet|homes\.com|land(?:watch|\.com)|americantowns|city-data|neighborwho|homefacts|rocketmortgage/i;

/**
 * Publishers a government CONTRACTS to host its adopted code.
 *
 * Municode, eCode360 and their peers are where most small American towns
 * actually publish the adopted zoning ordinance. Treating them as brokers —
 * which an earlier pass did — makes allowed-use and dimensional-standard
 * research impossible for exactly the jurisdictions LandOS buys land in. They
 * are `officially_linked`: official when the page names the jurisdiction, and
 * never official on the strength of the domain alone.
 */
const CODE_PUBLISHER_HOSTS = /(^|\.)(municode\.com|ecode360\.com|amlegal\.com|generalcode\.com|codepublishing\.com|sterlingcodifiers\.com|conwaygreene\.com|encodeplus\.com|municipalcodeonline\.com|library\.municode\.com|codelibrary\.amlegal\.com)$/i;

/** Vendor hosts that serve government records. Official only when corroborated. */
const GOVERNMENT_VENDOR_HOSTS = /(^|\.)(schneidercorp\.com|qpublic\.net|tylerhost\.net|vgsi\.com|sdgnys\.com|mapgeo\.io|devnetwedge\.com|arcgis\.com)$/i;

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
const slug = (value: string | null | undefined): string =>
  String(value ?? '').toLowerCase().replace(/\s+county$/i, '').replace(/[^a-z]/g, '');

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

const GOVERNMENT_SELF_ID = (jurisdiction: string): RegExp => new RegExp(
  `\\b(?:city|town|village|borough)\\s+of\\s+${escape(jurisdiction)}\\b`
  + `|\\b${escape(jurisdiction)}\\s+county\\s+(?:government|commission|tennessee|government\\s+services)\\b`
  + `|\\bofficial\\s+(?:web)?site\\s+(?:of|for)\\s+[^.\\n]{0,40}${escape(jurisdiction)}\\b`
  // A regulation document identifies its government by owning the code and by
  // naming the body that adopted it. The real Fairview subdivision regulations
  // say "Subdivision Regulations of Fairview, Tennessee" and "Fairview
  // Municipal Planning Commission" and never once say "City of Fairview".
  + `|\\b(?:subdivision|zoning|land\\s+development)\\s+(?:regulations?|ordinance|resolution|code)\\s+of\\s+(?:the\\s+)?(?:(?:city|town|village)\\s+of\\s+)?${escape(jurisdiction)}\\b`
  + `|\\b${escape(jurisdiction)}\\s+(?:municipal|regional)?\\s*planning\\s+commission\\b`
  + `|\\bboard\\s+of\\s+(?:mayor\\s+and\\s+)?(?:aldermen|commissioners)\\s+of\\s+(?:the\\s+)?(?:(?:city|town)\\s+of\\s+)?${escape(jurisdiction)}\\b`
  // Code publishers title the page with the jurisdiction and the code name.
  + `|\\b${escape(jurisdiction)}\\b[^.\\n]{0,40}\\b(?:municipal\\s+code|code\\s+of\\s+ordinances|zoning\\s+ordinance|land\\s+development\\s+code)\\b`,
  'i',
);

export interface JurisdictionSubject {
  municipality?: string | null;
  county?: string | null;
  /** Two-letter USPS code. */
  state?: string | null;
}

/**
 * How strongly a source speaks as a government.
 *
 * `.gov` and state-scoped `.us` are official outright. A non-government domain
 * is promoted only when BOTH the host names the jurisdiction and the page
 * identifies as that government — which is how an ordinary town website on a
 * `.org` domain, or its contracted code publisher, is recognised without
 * promoting every domain that happens to contain the town's name.
 */
export function governmentSourceTier(input: {
  url: string;
  pageText?: string | null;
  municipality?: string | null;
  county?: string | null;
  state?: string | null;
}): EvidenceTier {
  const host = hostOf(input.url);
  if (!host) return 'search_result';
  if (BROKER_HOSTS.test(host)) return 'search_result';
  if (/\.gov$/i.test(host)) return 'official_government_source';
  if (/\.[a-z]{2}\.us$/i.test(host) || /(^|\.)co\.[a-z-]+\.[a-z]{2}\.us$/i.test(host)) return 'official_government_source';

  const text = input.pageText ?? '';
  const names = [input.municipality, (input.county ?? '').replace(/\s+county$/i, '')];
  const publisher = CODE_PUBLISHER_HOSTS.test(host);
  const vendor = GOVERNMENT_VENDOR_HOSTS.test(host);

  for (const jurisdiction of names) {
    const name = clean(jurisdiction ?? '');
    if (name.length < 3) continue;
    const named = GOVERNMENT_SELF_ID(name).test(text)
      || GOVERNMENT_SELF_ID(name).test(input.url.replace(/[-_/]/g, ' '));
    // A contracted code publisher or a records vendor is official when the
    // JURISDICTION is named. Its own domain never carries it.
    if ((publisher || vendor) && named) return 'official_government_source';
    if (publisher || vendor) continue;
    const hostNamesIt = host.replace(/[^a-z]/g, '').includes(slug(name));
    if (hostNamesIt && GOVERNMENT_SELF_ID(name).test(text)) return 'official_government_source';
  }
  if (publisher || vendor) return 'reputable_secondary';
  return 'reputable_secondary';
}

export type SourceRelation =
  /** The government that actually controls this question for this parcel. */
  | 'controlling_government'
  /** Its contracted GIS or code publisher, naming it. */
  | 'linked_publisher'
  /** The county this parcel sits in, when the municipality controls. */
  | 'same_county'
  /** The state. Enabling statutes and state frameworks live here. */
  | 'same_state'
  /** A government — of somewhere else. Never usable for this parcel. */
  | 'unrelated_government'
  | 'non_government';

export interface SourceRanking {
  relation: SourceRelation;
  /** Lower is stronger. Sort candidate sources on this. */
  rank: number;
  /** False means this source may never answer the question for this parcel. */
  usable: boolean;
  reason: string;
}

const RELATION_RANK: Record<SourceRelation, number> = {
  controlling_government: 0,
  linked_publisher: 1,
  same_county: 2,
  same_state: 3,
  unrelated_government: 90,
  non_government: 99,
};

/**
 * Rank a source against the government that CONTROLS this question.
 *
 * `controllingAuthorityName` is the answer from
 * `controlling-land-use-authority.ts` when it has one. Without it the subject's
 * own municipality and county are the reference, which is the right fallback:
 * both are candidates for control, and both are in-jurisdiction.
 *
 * The refusals matter more than the ordering. `unrelated_government` covers
 * another town, another county and another state, and it is NOT usable — a
 * `.gov` domain is not a licence to speak about someone else's parcel.
 */
export function rankSourceForAuthority(
  url: string,
  input: JurisdictionSubject & { controllingAuthorityName?: string | null; pageText?: string | null },
): SourceRanking {
  const host = hostOf(url);
  if (!host) return { relation: 'non_government', rank: RELATION_RANK.non_government, usable: false, reason: 'Not a resolvable URL.' };

  const tier = governmentSourceTier({ url, pageText: input.pageText, municipality: input.municipality, county: input.county, state: input.state });
  const letters = host.replace(/[^a-z]/g, '');
  const controlling = slug(input.controllingAuthorityName);
  const municipality = slug(input.municipality);
  const county = slug(input.county);
  const state = String(input.state ?? '').trim().toLowerCase();
  const publisherOrVendor = CODE_PUBLISHER_HOSTS.test(host) || GOVERNMENT_VENDOR_HOSTS.test(host);

  const namesIn = (needle: string): boolean => {
    if (needle.length < 4) return false;
    if (letters.includes(needle)) return true;
    // A code publisher puts the jurisdiction in the path, not the host.
    return new RegExp(needle, 'i').test(url.toLowerCase().replace(/[^a-z]/g, ''));
  };

  if (controlling && namesIn(controlling)) {
    return publisherOrVendor
      ? { relation: 'linked_publisher', rank: RELATION_RANK.linked_publisher, usable: tier === 'official_government_source', reason: `${host} is the controlling authority's contracted publisher and names it.` }
      : { relation: 'controlling_government', rank: RELATION_RANK.controlling_government, usable: true, reason: `${host} belongs to the controlling authority.` };
  }
  if (!controlling && municipality && namesIn(municipality)) {
    return publisherOrVendor
      ? { relation: 'linked_publisher', rank: RELATION_RANK.linked_publisher, usable: tier === 'official_government_source', reason: `${host} publishes the municipality's code and names it.` }
      : { relation: 'controlling_government', rank: RELATION_RANK.controlling_government, usable: true, reason: `${host} belongs to this parcel's municipality.` };
  }
  if (county && namesIn(county)) {
    return { relation: 'same_county', rank: RELATION_RANK.same_county, usable: true, reason: `${host} belongs to this parcel's county.` };
  }
  if (state.length === 2 && (
    new RegExp(`(^|\\.)${state}\\.(gov|us)$`).test(host)
    || new RegExp(`(^|\\.)state\\.${state}\\.us$`).test(host)
  )) {
    return { relation: 'same_state', rank: RELATION_RANK.same_state, usable: true, reason: `${host} is a ${state.toUpperCase()} state government host.` };
  }
  if (tier === 'official_government_source') {
    return {
      relation: 'unrelated_government',
      rank: RELATION_RANK.unrelated_government,
      usable: false,
      reason: `${host} is a government host, but not this parcel's municipality, county or state. A government domain is not jurisdiction over this parcel.`,
    };
  }
  return { relation: 'non_government', rank: RELATION_RANK.non_government, usable: false, reason: `${host} is not a government source for this parcel.` };
}

/**
 * Could this host plausibly regulate THIS parcel? A pre-fetch gate.
 *
 * Cheaper than `rankSourceForAuthority` and applied before anything is
 * downloaded, so an out-of-jurisdiction document costs nothing.
 */
export function hostServesSubjectJurisdiction(url: string, subject: JurisdictionSubject & { controllingAuthorityName?: string | null }): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const letters = host.replace(/[^a-z]/g, '');
  const path = url.toLowerCase().replace(/[^a-z]/g, '');

  for (const name of [subject.controllingAuthorityName, subject.municipality, subject.county]) {
    const needle = slug(name);
    if (needle.length >= 4 && (letters.includes(needle) || ((CODE_PUBLISHER_HOSTS.test(host) || GOVERNMENT_VENDOR_HOSTS.test(host)) && path.includes(needle)))) return true;
  }
  const state = String(subject.state ?? '').trim().toLowerCase();
  if (state.length === 2) {
    if (new RegExp(`(^|\\.)${state}\\.(gov|us)$`).test(host)) return true;
    if (new RegExp(`(^|\\.)state\\.${state}\\.us$`).test(host)) return true;
    if (new RegExp(`(^|\\.)${state}\\.gov$`).test(host)) return true;
  }
  return false;
}
