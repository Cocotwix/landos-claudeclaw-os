// LandOS — WHERE a state publishes its own law.
//
// This registry is a directory, not an answer key. Every entry says where to
// look; not one entry says what the law is. That distinction is the reason a
// nationwide table is allowed to exist in a system that forbids hardcoded
// jurisdiction logic: adding a state here tells LandOS which official host to
// read, and the reading still has to happen live, against the real text, with
// a citation attached.
//
// Coverage is honest in the same way `statewide-parcel-services.ts` is. A state
// is listed only when LandOS actually REACHED the host and the page identified
// itself as that state's legislative body. An unlisted state is not a dead end:
// it falls through to `deriveStateLegalHostCandidates` plus the same officiality
// verification, and a verified discovery is remembered.

/** How a state's official code has to be retrieved. */
export const LEGAL_SOURCE_TRANSPORTS = ['server_fetch', 'requires_browser'] as const;
export type LegalSourceTransport = (typeof LEGAL_SOURCE_TRANSPORTS)[number];

export interface StateLegalSource {
  /** Two-letter state code. */
  state: string;
  /** The legislative body's own name, as its site states it. */
  body: string;
  /** Verified origin for the state's legislative / statutory publication. */
  origin: string;
  /**
   * Path template for a full-text statute search, when the site exposes one.
   * `{q}` is replaced with a URL-encoded query. Null when LandOS has not
   * verified a search route — the lane then reads the code index instead.
   */
  searchPath: string | null;
  /**
   * Some state code sites sit behind edge protection that refuses a non-browser
   * client outright. That is a transport fact, and the lane must know it in
   * advance rather than reading a challenge page as "no such statute".
   */
  transport: LegalSourceTransport;
  /** True only when a live probe reached the host and it named this state. */
  reachedLive: boolean;
}

/**
 * States whose official legislative host LandOS reached and verified. The
 * verification standard was deliberately strict: a government host that
 * redirected cleanly AND whose page named the state AND looked like a
 * legislative publication. Several conventional-looking hosts failed it —
 * one resolved to a video-conferencing page and another to a state capitol
 * commission rather than the legislature — and were rejected rather than
 * listed, because a confidently wrong source is worse than a missing one.
 */
export const STATE_LEGAL_SOURCES: StateLegalSource[] = [
  { state: 'AK', body: 'Alaska State Legislature', origin: 'https://w3.akleg.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'AL', body: 'Alabama Legislature', origin: 'https://alison.legislature.state.al.us', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'AZ', body: 'Arizona Legislature', origin: 'https://www.azleg.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'CO', body: 'Colorado General Assembly', origin: 'https://www.leg.colorado.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'DE', body: 'Delaware General Assembly', origin: 'https://www.legis.delaware.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'GA', body: 'Georgia General Assembly', origin: 'https://www.legis.ga.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'IA', body: 'Iowa Legislature', origin: 'https://www.legis.iowa.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'IL', body: 'Illinois General Assembly', origin: 'https://www.ilga.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'IN', body: 'Indiana General Assembly', origin: 'https://iga.in.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'KS', body: 'Kansas Legislature', origin: 'https://www.kslegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'KY', body: 'Kentucky Legislative Research Commission', origin: 'https://legislature.ky.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'LA', body: 'Louisiana State Legislature', origin: 'https://www.legis.la.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'MA', body: 'Massachusetts General Court', origin: 'https://malegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'ME', body: 'Maine State Legislature', origin: 'https://www.legislature.maine.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  {
    state: 'MI',
    body: 'Michigan Legislature',
    origin: 'https://www.legislature.mi.gov',
    // The MCL route answers a plain request and returns the act text — verified
    // live on `/Laws/MCL?objectName=mcl-Act-288-of-1967`. The site's search
    // route was probed and returns 404, so it is NOT listed: a search path that
    // does not work would make the lane report "no provision" on every query.
    searchPath: null,
    transport: 'server_fetch',
    reachedLive: true,
  },
  { state: 'MN', body: 'Minnesota Legislature', origin: 'https://www.leg.mn.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'NC', body: 'North Carolina General Assembly', origin: 'https://www.ncleg.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'ND', body: 'North Dakota Legislative Branch', origin: 'https://ndlegis.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'NE', body: 'Nebraska Unicameral Legislature', origin: 'https://leg.ne.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'NH', body: 'General Court of New Hampshire', origin: 'https://gc.nh.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'NJ', body: 'New Jersey Legislature', origin: 'https://www.njleg.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  {
    state: 'NY',
    body: 'New York State Senate (Open Legislation)',
    origin: 'https://www.nysenate.gov',
    searchPath: null,
    // Verified live: a plain request is answered with an edge challenge page,
    // so this lane must go through the background browser or it will read the
    // challenge as an absent statute.
    transport: 'requires_browser',
    reachedLive: true,
  },
  { state: 'OK', body: 'Oklahoma Legislature', origin: 'https://www.oklegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'OR', body: 'Oregon State Legislature', origin: 'https://www.oregonlegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'PA', body: 'Pennsylvania General Assembly', origin: 'https://www.palegis.us', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'RI', body: 'Rhode Island General Assembly', origin: 'https://www.rilegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'SC', body: 'South Carolina Legislature Online', origin: 'https://www.scstatehouse.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'SD', body: 'South Dakota Legislature', origin: 'https://www.sdlegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'TN', body: 'Tennessee General Assembly', origin: 'https://capitol.tn.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'TX', body: 'Texas Legislature Online', origin: 'https://capitol.texas.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'WA', body: 'Washington State Legislature', origin: 'https://leg.wa.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'WI', body: 'Wisconsin State Legislature', origin: 'https://legis.wisconsin.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
  { state: 'WV', body: 'West Virginia Legislature', origin: 'https://www.wvlegislature.gov', searchPath: null, transport: 'server_fetch', reachedLive: true },
];

export function stateLegalSourceFor(state: string | null | undefined): StateLegalSource | null {
  const code = (state ?? '').trim().toUpperCase();
  if (code.length !== 2) return null;
  return STATE_LEGAL_SOURCES.find((entry) => entry.state === code) ?? null;
}

/** Full state names, needed to VERIFY that a discovered host serves this state. */
export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function stateName(state: string | null | undefined): string | null {
  const code = (state ?? '').trim().toUpperCase();
  return STATE_NAMES[code] ?? null;
}

/**
 * Two-letter code from a full state name.
 *
 * Needed because the federal geography service answers with the full name
 * ("Michigan"), while every registry and host formula in this engine is keyed
 * by the code. Without it, a property whose record carries no state at all can
 * be located federally and still reach none of the state-level lanes.
 */
export function stateCodeFromName(name: string | null | undefined): string | null {
  const wanted = (name ?? '').trim().toLowerCase();
  if (!wanted) return null;
  if (wanted.length === 2 && STATE_NAMES[wanted.toUpperCase()]) return wanted.toUpperCase();
  const found = Object.entries(STATE_NAMES).find(([, full]) => full.toLowerCase() === wanted);
  return found?.[0] ?? null;
}

/**
 * Conventional hostnames a state legislature is published under.
 *
 * This is a FORMULA, not a list: it names no state and adding one requires no
 * code. It found roughly two thirds of the states on a live sweep, which is
 * exactly what it is for — turning "we have never seen this state" into "we
 * have a candidate to verify". Candidates are verified like any other source,
 * because a host that merely resolves is not evidence that it serves this state.
 * The sweep proved that concretely: several formula hosts answered with another
 * state's legislature or with an unrelated government page.
 */
export function deriveStateLegalHostCandidates(state: string | null | undefined): string[] {
  const code = (state ?? '').trim().toLowerCase();
  if (code.length !== 2) return [];
  const slug = (STATE_NAMES[code.toUpperCase()] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const hosts = [
    `www.${code}legislature.gov`,
    `${code}legislature.gov`,
    `www.legis.${code}.gov`,
    `legis.${code}.gov`,
    `www.leg.${code}.gov`,
    `leg.${code}.gov`,
    `le.${code}.gov`,
    `capitol.${code}.gov`,
    `legislature.${code}.gov`,
    `www.${code}leg.gov`,
    `${code}leg.gov`,
    `www.legis.state.${code}.us`,
    `www.legislature.state.${code}.us`,
  ];
  if (slug) {
    hosts.push(`www.legislature.${slug}.gov`, `legislature.${slug}.gov`, `www.legis.${slug}.gov`, `www.${slug}legislature.gov`);
  }
  return [...new Set(hosts)];
}

/**
 * Whether a retrieved page really is this state's legal publication.
 *
 * Both halves are required, and the sweep is why. Requiring only a government
 * host accepted a state capitol commission and a video-conferencing portal;
 * requiring only the state's name accepted a neighbouring state's page that
 * happened to mention it. A page must name the state AND read as a legislative
 * or statutory publication.
 */
export function verifiesAsStateLegalSource(state: string | null | undefined, pageText: string): boolean {
  const name = stateName(state);
  if (!name) return false;
  const haystack = pageText.slice(0, 20_000).toLowerCase();
  if (!haystack.includes(name.toLowerCase())) return false;
  return /legislat|general assembly|general court|statute|revised code|official code|senate|house of representatives/i.test(haystack);
}

/* ──────────────────── other statewide official authorities ───────────── */

/**
 * The other statewide bodies this engine has to reach: the highway authority
 * that controls a new access point, the regulator that administers
 * manufactured-home installation, and the agency that sets onsite-wastewater
 * rules.
 *
 * These are derived rather than listed, for the same reason the county GIS
 * hosts are: a formula covers every state at once and names none of them. Each
 * candidate is verified before anything it says becomes a conclusion.
 */
export function deriveStateAgencyHostCandidates(
  state: string | null | undefined,
  agency: 'dot' | 'manufactured_housing' | 'onsite_wastewater',
): string[] {
  const code = (state ?? '').trim().toLowerCase();
  if (code.length !== 2) return [];
  const slug = (STATE_NAMES[code.toUpperCase()] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  switch (agency) {
    case 'dot':
      return [`www.dot.${code}.gov`, `dot.${code}.gov`, `www.${code}dot.gov`, `${code}dot.gov`,
        `www.${code}dot.org`, `www.dot.state.${code}.us`, `www.transportation.${slug}.gov`];
    case 'manufactured_housing':
      return [`www.${code}.gov`, `dca.${code}.gov`, `www.dca.${code}.gov`,
        `www.${slug}.gov`, `insurance.${code}.gov`, `www.mhd.${code}.gov`];
    case 'onsite_wastewater':
      return [`dph.${code}.gov`, `www.dph.${code}.gov`, `health.${code}.gov`, `www.health.${code}.gov`,
        `dhec.${code}.gov`, `deq.${code}.gov`, `epd.${code}.gov`, `www.${slug}.gov`];
  }
}

/* ─────────────────────── official code platform shapes ───────────────── */

/**
 * Recurring TECHNICAL shapes behind official state code publication.
 *
 * Platform-first for the same reason the parcel engine is: learning one shape
 * reaches every state that uses it, and learning one state reaches one. A state
 * earns a slot only when its shape recurs or when LandOS has verified the shape
 * live; everything else falls through to the generic probes.
 */
export const STATE_LAW_PLATFORMS = [
  /** An official index maps objects to descriptions; objects are addressed by id. */
  'object_addressed_code',
  /** Law group -> chapter -> article -> section, each level a real TOC page. */
  'article_toc_code',
  /** Statutes are not machine-readable, but state agencies publish the governing
   *  statutes and their citations. Authoritative state material, not the code text. */
  'agency_publication',
  /** Statutes discoverable from the site's own sitemap. */
  'sitemap_indexed_code',
  /** The site exposes its own full-text search endpoint. */
  'page_search',
  'unknown',
] as const;
export type StateLawPlatform = (typeof STATE_LAW_PLATFORMS)[number];

/**
 * How to READ one publication shape.
 *
 * Everything on this interface describes the SOURCE, never a state. The reason
 * that matters: the adapters used to carry the parsing details of the three
 * states LandOS happened to learn first — a `mcl-` object prefix, an
 * `Act-N-of-YYYY` child shape, a `/legislation/laws/GROUP` chapter path — and a
 * state whose code was shaped the same way but named differently could not be
 * read at all. The details now travel with the source that was detected, so an
 * unfamiliar state configures itself out of what its own site exposes.
 */
export interface StateLawPlatformConfig {
  platform: StateLawPlatform;
  /** Where the code's own structure begins. */
  indexPath?: string;
  /** Template addressing one object by id. `{id}` is substituted. */
  objectPath?: string;
  /** Template for the official downloadable document of an object. */
  documentPath?: string;
  /** Official state agency hosts that publish governing-statute guidance. */
  agencyHosts?: string[];

  /* ── object-addressed shape ── */
  /** Leading segment the source puts on every object id, e.g. `mcl-`. */
  objectIdPrefix?: string;
  /**
   * Regex SOURCE matching the child objects a container object lists (an act
   * inside a chapter). Absent means "any object id this page links that is not
   * the container itself".
   */
  childObjectPattern?: string;
  /**
   * Template turning a printed section number into an object id.
   * `{section}` is the number as printed; `{sectionDashed}` replaces `.` with
   * `-`; `{prefix}` is `objectIdPrefix`.
   */
  sectionIdTemplate?: string;
  /** What the source calls its own sections, e.g. `MCL`. Used in citations. */
  citationLabel?: string;

  /* ── article-TOC shape ── */
  /** Regex SOURCE selecting chapter links off the index. Derived when absent. */
  chapterLinkPattern?: string;
  /** Regex SOURCE selecting article links off a chapter page. */
  articleLinkPattern?: string;
  /** Citation template. `{chapter}` and `{section}` are substituted. */
  citationTemplate?: string;

  /**
   * Citation SHAPES this source prints, as regex sources. Tried ahead of the
   * generic ladder so a source with a house style is read exactly, and absent
   * for a source LandOS has not studied — which still cites generically.
   */
  citationShapes?: string[];

  /** Human note on what was verified live, so a later reader can re-check it. */
  verifiedNote?: string;
}
