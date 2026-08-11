import { describe, expect, it } from 'vitest';
import {
  chapterRank,
  extractEffectiveNote,
  extractStatuteCitation,
  rankDivisions,
  runAgencyPublication,
  runArticleTocCode,
  runObjectAddressedCode,
  retrieveStateLaw,
  scoreLabel,
  stripPageFurniture,
  type LawConcept,
} from './state-law-retrieval.js';
import { extractECodeIds, matchECodeEntry, lookupECode360 } from './ecode360-lookup.js';
import { stateLawPlatformFor, SEEDED_STATE_LAW_KNOWLEDGE } from './state-law-learning.js';
import { findProvisions, sectionForOffset, buildCitation } from './land-use-evidence.js';
import type { GovFetchText } from './gis-transport.js';

const CONCEPTS: readonly LawConcept[] = ['land_division', 'subdivision_platting', 'zoning_enabling', 'manufactured_housing'];

/** A transport that serves fixed pages and records what was requested. */
function stubTransport(pages: Record<string, string>): { fetchText: GovFetchText; requested: string[] } {
  const requested: string[] = [];
  const fetchText: GovFetchText = async (url) => {
    requested.push(url);
    const body = pages[url];
    if (body === undefined) {
      return { status: 404, body: '', url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
    }
    return { status: 200, body, url, contentType: 'text/html', blocked: false, via: 'server_fetch' };
  };
  return { fetchText, requested };
}

/* ══════════════════ 1. CONCEPT TARGETING ══════════════════ */

describe('concept terms are tight enough not to displace the real provision', () => {
  it('does not treat a surveyor act or a survey programme as a division statute', () => {
    expect(scoreLabel('SURVEYORS', CONCEPTS).score).toBe(0);
    expect(scoreLabel('Historic Resources Survey Program Coordinator', CONCEPTS).score).toBe(0);
    expect(scoreLabel('GEOLOGICAL AND OTHER SURVEYS', CONCEPTS).score).toBe(0);
  });

  it('does not treat a bare town or county label as a land-use subject', () => {
    expect(scoreLabel('Classification of Towns', CONCEPTS).score).toBe(0);
    expect(scoreLabel('Towns County Health Department', CONCEPTS).score).toBe(0);
    expect(scoreLabel('Town Officers, Powers, Duties and Compensation', CONCEPTS).score).toBe(0);
  });

  it('still matches the subjects it exists for', () => {
    expect(scoreLabel('SUBDIVISION CONTROL ACT OF 1967', CONCEPTS).matched).toContain('land_division');
    expect(scoreLabel('PLANNING, HOUSING, AND ZONING', CONCEPTS).matched).toContain('zoning_enabling');
    expect(scoreLabel('Zoning and Planning', CONCEPTS).matched).toContain('zoning_enabling');
    expect(scoreLabel('Approval of plats', CONCEPTS).matched).toContain('subdivision_platting');
  });
});

describe('the body of law is chosen for the local unit that contains the parcel', () => {
  it('puts the matching unit first', () => {
    expect(chapterRank('TWN Town', 'town')).toBe(100);
    expect(chapterRank('ACG Alternative County Government', 'town')).toBeLessThan(100);
    expect(chapterRank('VIL Village', 'village')).toBe(100);
  });

  it('ranks a same-named-but-wrong body below the right one', () => {
    const ranked = ['ACG Alternative County Government', 'CNT County', 'GCT General City', 'TWN Town']
      .map((label) => ({ label, rank: chapterRank(label, 'town') }))
      .sort((a, b) => b.rank - a.rank);
    expect(ranked[0].label).toBe('TWN Town');
  });

  it('falls back sensibly with no hint rather than flattening every body to one rank', () => {
    const ranks = ['GMU General Municipal', 'TWN Town', 'CNT County'].map((label) => chapterRank(label, null));
    expect(new Set(ranks).size).toBe(3);
    expect(chapterRank('GMU General Municipal', null)).toBeGreaterThan(chapterRank('CNT County', null));
  });
});

/* ══════════════════ 2. OBJECT-ADDRESSED CODE ══════════════════ */

const CHAPTER_INDEX = `
<table><tbody>
<tr><td><a href="/Home/GetObject?objectName=mcl-chap54">Chapter 54</a></td><td>SURVEYORS</td></tr>
<tr><td><a href="/Home/GetObject?objectName=mcl-chap560">Chapter 560</a></td><td>SUBDIVISION CONTROL ACT OF 1967</td></tr>
<tr><td><a href="/Home/GetObject?objectName=mcl-chap6">Chapter 6</a></td><td>ALCOHOLIC BEVERAGES</td></tr>
</tbody></table>
<p>MCL Complete Through PA 20 of 2026</p>`;

const CHAPTER_560 = `<a href="/Laws/MCL?objectName=mcl-Act-288-of-1967">Act 288 of 1967</a>`;

const ACT_288 = `
<p>Chapter 560 LAND DIVISION ACT Act 288 of 1967 AN ACT to regulate the division of land;
to promote the public health, safety and general welfare; to further the orderly layout and use of
land; to require that land be surveyed and monuments placed; to regulate the subdividing of land;
to establish the procedure for the approval of plats; to provide for the recording of plats; and to
prescribe the powers and duties of local units of government and state agencies with respect to the
division of land and the approval of plats.</p>
<p>Division GENERAL PROVISIONS (560.101...560.109b) Division PRELIMINARY PLATS (560.111...560.120)</p>`;

const SECTION_560_111 = `<p>560.111 Preliminary plat; submission to municipality.
Sec. 111. A proprietor shall submit a preliminary plat to the municipality for approval before any
division of land is made. The division of land shall comply with this act and with the ordinances of
the municipality in which the land lies. The municipality shall approve or reject the preliminary
plat within the period prescribed by this act, and shall state its reasons in writing where a plat
is rejected so that the proprietor may correct the plat and resubmit it for approval.</p>`;

describe('an object-addressed state code is walked from its own index to real text', () => {
  const pages: Record<string, string> = {
    'https://x.gov/Laws/ChapterIndex': CHAPTER_INDEX,
    'https://x.gov/Laws/MCL?objectName=mcl-chap560': CHAPTER_560,
    'https://x.gov/Laws/MCL?objectName=mcl-Act-288-of-1967': ACT_288,
    'https://x.gov/Laws/MCL?objectName=mcl-560-111': SECTION_560_111,
  };
  const config = stateLawPlatformFor('MI')!;

  it('selects the chapter by the state\'s own description, not a known statute number', async () => {
    const { fetchText, requested } = stubTransport(pages);
    const documents = await runObjectAddressedCode('https://x.gov', config, CONCEPTS, fetchText, { left: 12 }, []);
    expect(requested).toContain('https://x.gov/Laws/MCL?objectName=mcl-chap560');
    // The surveyor chapter must never be opened: it scores zero.
    expect(requested.some((url) => url.includes('chap54'))).toBe(false);
    expect(documents.length).toBeGreaterThan(0);
  });

  it('follows the act into a real section rather than stopping at the act index', async () => {
    const { fetchText } = stubTransport(pages);
    const documents = await runObjectAddressedCode('https://x.gov', config, CONCEPTS, fetchText, { left: 12 }, []);
    const section = documents.find((document) => document.citation === 'MCL 560.111');
    expect(section).toBeDefined();
    expect(section!.text).toMatch(/shall submit a preliminary plat/i);
    expect(section!.route).toBe('object_address');
  });

  it('carries the publication currency the source states', async () => {
    const { fetchText } = stubTransport(pages);
    const documents = await runObjectAddressedCode('https://x.gov', config, CONCEPTS, fetchText, { left: 12 }, []);
    expect(documents[0].effectiveNote).toMatch(/Complete Through PA 20 of 2026/);
  });

  it('reads division ranges into their first section', () => {
    const divisions = rankDivisions(ACT_288, CONCEPTS);
    expect(divisions.map((division) => division.name)).toContain('PRELIMINARY PLATS');
    expect(divisions.find((division) => division.name === 'PRELIMINARY PLATS')?.firstSection).toBe('560.111');
  });

  it('respects the request budget rather than walking a whole code', async () => {
    const { fetchText, requested } = stubTransport(pages);
    await runObjectAddressedCode('https://x.gov', config, CONCEPTS, fetchText, { left: 2 }, []);
    expect(requested.length).toBeLessThanOrEqual(2);
  });
});

/* ══════════════════ 3. ARTICLE TOC CODE ══════════════════ */

const CONSOLIDATED = `
<a href="/legislation/laws/ACG">ACG Alternative County Government</a>
<a href="/legislation/laws/TWN">TWN Town</a>`;
const TWN_CHAPTER = `
<p>ARTICLE 2 Classification of Towns ARTICLE 16 Zoning and Planning</p>
<a href="/legislation/laws/TWN/A2">A2</a>
<a href="/legislation/laws/TWN/A16">A16</a>`;
const TWN_A16 = `<p>ARTICLE 16 Zoning and Planning SECTION 261 Grant of power SECTION 276 Approval of plats</p>
<a href="/legislation/laws/TWN/276">276</a>`;
const TWN_276 = `<p>Town Law § 276. Approval of plats. 4. Definitions. "Subdivision" means the division of any
parcel of land into a number of lots, blocks or sites, with or without streets or highways, and
includes resubdivision. The town board may by resolution authorize and empower the planning board
to approve plats showing lots, blocks or sites, with or without streets or highways, and to approve
the development of entirely or partially undeveloped plats already filed in the office of the clerk
of the county in which such plat is situated.</p>`;

describe('an article TOC code is walked to the article the subject needs', () => {
  const pages: Record<string, string> = {
    'https://ny.gov/legislation/laws/CONSOLIDATED': CONSOLIDATED,
    'https://ny.gov/legislation/laws/TWN': TWN_CHAPTER,
    'https://ny.gov/legislation/laws/TWN/A16': TWN_A16,
    'https://ny.gov/legislation/laws/TWN/276': TWN_276,
  };
  const config = stateLawPlatformFor('NY')!;

  it('opens the body of law that governs the subject\'s own local unit', async () => {
    const { fetchText, requested } = stubTransport(pages);
    await runArticleTocCode('https://ny.gov', config, CONCEPTS, fetchText, { left: 12 }, [], 'town');
    expect(requested).toContain('https://ny.gov/legislation/laws/TWN');
    // A body of law that cannot govern a town parcel is not opened at all.
    expect(requested.some((url) => url.endsWith('/ACG'))).toBe(false);
  });

  it('selects the article by its own title and reaches the section text', async () => {
    const { fetchText, requested } = stubTransport(pages);
    const documents = await runArticleTocCode('https://ny.gov', config, CONCEPTS, fetchText, { left: 12 }, [], 'town');
    expect(requested).toContain('https://ny.gov/legislation/laws/TWN/A16');
    // Article 2 has no land-use concept in its title and must not be opened.
    expect(requested.some((url) => url.endsWith('/A2'))).toBe(false);
    const section = documents.find((document) => /276/.test(document.citation ?? ''));
    expect(section?.text).toMatch(/"Subdivision" means the division of any/);
  });
});

/* ══════════════════ 4. AGENCY PUBLICATION ══════════════════ */

const SITEMAP = `<urlset>
<loc>https://dca.example.gov/planning/governing-statutes-regulations-and-guidance</loc>
<loc>https://dca.example.gov/historic-preservation/resources-survey-program</loc>
<loc>https://dca.example.gov/contacts/planning</loc>
</urlset>`;
const GOVERNING_PAGE = `<html><title>Governing Statutes, Regulations, and Guidance</title>
<p>See information below to understand the governing statutes, regulations, and guidance for
community and regional planners. Fair Annexation Act. DCA facilitates a set of conflict resolution
processes for annexation disputes. Zoning (O.C.G.A. 36-66-1, et seq.) The bulk of Georgia statutes
relating to zoning procedures are found here, and they set the procedures a local government must
follow when it adopts or amends a zoning ordinance.</p></html>`;
const CONTACTS_PAGE = `<html><title>Planning contacts</title><p>Call the planning office for help with
zoning questions. The staff directory follows. Our planners assist local governments with zoning and
land use questions, comprehensive plan updates, and general technical assistance across the state.
Contact details for each regional planner are listed by service area below.</p></html>`;

describe('a state agency publication is accepted on its content, not its URL', () => {
  const pages: Record<string, string> = {
    'https://dca.example.gov/sitemap.xml': SITEMAP,
    'https://dca.example.gov/planning/governing-statutes-regulations-and-guidance': GOVERNING_PAGE,
    'https://dca.example.gov/contacts/planning': CONTACTS_PAGE,
    'https://dca.example.gov/historic-preservation/resources-survey-program': '<html><p>Survey grants.</p></html>',
  };

  it('keeps a page that states a governing statute and cites it', async () => {
    const { fetchText } = stubTransport(pages);
    const documents = await runAgencyPublication(
      { platform: 'agency_publication', agencyHosts: ['dca.example.gov'] },
      CONCEPTS, fetchText, { left: 10 }, [],
    );
    expect(documents).toHaveLength(1);
    expect(documents[0].citation).toBe('O.C.G.A. 36-66-1');
    expect(documents[0].route).toBe('sitemap');
  });

  it('rejects a programme or contact page that merely mentions the subject', async () => {
    const { fetchText } = stubTransport(pages);
    const documents = await runAgencyPublication(
      { platform: 'agency_publication', agencyHosts: ['dca.example.gov'] },
      CONCEPTS, fetchText, { left: 10 }, [],
    );
    expect(documents.some((document) => /contacts/.test(document.url))).toBe(false);
    expect(documents.some((document) => /survey/.test(document.url))).toBe(false);
  });
});

/* ══════════════════ 5. CITATION AND TEXT HYGIENE ══════════════════ */

describe('a citation points at the words beside it', () => {
  it('reads the jurisdiction-specific citation shapes', () => {
    expect(extractStatuteCitation('Zoning (O.C.G.A. 36-66-1, et seq.)', '')).toBe('O.C.G.A. 36-66-1');
    expect(extractStatuteCitation('Chapter 560 LAND DIVISION ACT Act 288 of 1967', '')).toBe('Act 288 of 1967');
    expect(extractStatuteCitation('Town Law § 276. Approval of plats.', '')).toMatch(/Town Law § 276/);
  });

  it('finds a citation below the fold rather than a stray one near the top', () => {
    const page = `${'Section 106 review of federal undertakings. '.repeat(120)}Zoning (O.C.G.A. 36-66-1, et seq.)`;
    expect(extractStatuteCitation(page, '')).toBe('O.C.G.A. 36-66-1');
  });

  it('never reads a revision date as a section number', () => {
    // A live New York run recorded "2014-09-22" as the section of Town Law 276.
    const text = 'View historical revision as of: 2014-09-22 Share Facebook Email ARTICLE 16 Zoning and Planning';
    expect(sectionForOffset(text, text.indexOf('ARTICLE'))).not.toBe('2014-09-22');
  });

  it('reads the publication currency the source states', () => {
    expect(extractEffectiveNote('MCL Complete Through PA 20 of 2026')).toMatch(/Complete Through PA 20 of 2026/);
    expect(extractEffectiveNote('nothing here')).toBeNull();
  });
});

describe('site chrome is stripped before the law is quoted', () => {
  it('removes navigation that would otherwise become the excerpt', () => {
    const raw = 'Skip to main content Sign Up Log In Related Sites Archives Legislative Directory Publications Help MCL - Act 288 of 1967 Chapter 560 LAND DIVISION ACT';
    const stripped = stripPageFurniture(raw);
    expect(stripped).not.toMatch(/Sign Up|Log In|Related Sites|Legislative Directory/);
    expect(stripped).toMatch(/LAND DIVISION ACT/);
  });

  it('leaves the statutory text itself untouched', () => {
    const law = 'AN ACT to regulate the division of land; to promote the public health, safety and general welfare.';
    expect(stripPageFurniture(law)).toBe(law);
  });
});

describe('an excerpt starts at the provision, not in the one before it', () => {
  it('does not open with the previous act\'s sentence', () => {
    const page = 'Fair Annexation Act. DCA facilitates conflict resolution processes for annexation disputes. '
      + 'Zoning (O.C.G.A. 36-66-1, et seq.) The bulk of Georgia statutes relating to zoning procedures.';
    const [hit] = findProvisions(page, /zoning[^.;]{0,30}\([^)]{0,60}et\s+seq/i);
    expect(hit.excerpt.startsWith('Zoning (O.C.G.A. 36-66-1')).toBe(true);
    expect(hit.excerpt).not.toMatch(/annexation/);
  });
});

/* ══════════════════ 6. eCODE360 FALLBACK ══════════════════ */

describe('the second codifier is tried through the shared transport', () => {
  it('reads code ids the publisher publishes', () => {
    expect(extractECodeIds('<a href="https://ecode360.com/ST1234">Sterling</a>')).toContain('ST1234');
    expect(extractECodeIds('<a href="/AB9876">Albany</a>')).toContain('AB9876');
  });

  it('anchors an id to the jurisdiction it belongs to', () => {
    const html = '<a href="/ST1234">Sterling, NY</a><a href="/XX1111">Sterling Heights, MI</a>';
    expect(matchECodeEntry(html, 'Sterling town', 'NY')?.id).toBe('ST1234');
    expect(matchECodeEntry(html, 'Nowhere town', 'NY')).toBeNull();
  });

  it('distinguishes a publisher that does not carry the jurisdiction from one that refused', async () => {
    const { fetchText } = stubTransport({
      'https://www.generalcode.com/library/?state=NY': '<html><a href="/AB9876">Albany, NY</a></html>',
      'https://ecode360.com/NY': '<html>eCode360 Error</html>',
    });
    const absent = await lookupECode360('Sterling town', 'NY', { fetchText });
    expect(absent.source).toBeNull();
    expect(absent.transportRefused).toBe(false);
    expect(absent.blocker).toMatch(/does not appear to carry that jurisdiction/i);

    const refusing: GovFetchText = async (url) => ({
      status: 403, body: 'Just a moment...', url, contentType: 'text/html', blocked: true, via: 'server_fetch',
    });
    const refused = await lookupECode360('Sterling town', 'NY', { fetchText: refusing });
    expect(refused.transportRefused).toBe(true);
    expect(refused.blocker).toMatch(/refused automated retrieval/i);
  });

  it('reads the code when the publisher does carry it', async () => {
    const { fetchText } = stubTransport({
      'https://www.generalcode.com/library/?state=NY': '<html><a href="/ST1234">Sterling, NY</a></html>',
      'https://ecode360.com/ST1234': `<html><p>${'Chapter 175 Zoning. The town is divided into districts. '.repeat(12)}</p></html>`,
    });
    const found = await lookupECode360('Sterling town', 'NY', { fetchText });
    expect(found.source?.publisher).toBe('ecode360');
    expect(found.documents[0].text).toMatch(/divided into districts/);
  });
});

/* ══════════════════ 7. TIERING AND HONEST BLOCKERS ══════════════════ */

describe('an agency page is never tiered as the statute itself', () => {
  it('lets the retrieving lane override the URL-shape classifier', () => {
    const url = 'https://dca.example.gov/planning/governing-statutes-regulations-and-guidance';
    // The URL contains "statutes", so shape-classification alone calls it one.
    expect(buildCitation({ url, label: 'Governing Statutes', retrievedAt: 'now' }).tier).toBe('state_statute');
    // The lane knows it came off a sitemap and its knowledge wins.
    expect(buildCitation({ url, label: 'Governing Statutes', tier: 'state_agency', retrievedAt: 'now' }).tier).toBe('state_agency');
  });
});

describe('an unreadable state publication is named, never reported as no such law', () => {
  it('returns a blocker rather than an empty success', async () => {
    const { fetchText } = stubTransport({});
    const retrieval = await retrieveStateLaw('MI', { fetchText, maxRequests: 4 });
    expect(retrieval.documents).toHaveLength(0);
    expect(retrieval.blocker).toMatch(/exposed no machine-readable route/i);
    expect(retrieval.read.length).toBeGreaterThan(0);
  });

  it('says so plainly when no official publication is registered for a state', async () => {
    const { fetchText } = stubTransport({});
    const retrieval = await retrieveStateLaw('ZZ', { fetchText });
    expect(retrieval.platform).toBe('unknown');
    expect(retrieval.blocker).toMatch(/no verified official legal publication/i);
  });
});

describe('the seeded knowledge only claims shapes verified live', () => {
  it('keeps the three proven states with distinct shapes', () => {
    expect(SEEDED_STATE_LAW_KNOWLEDGE.MI.platform).toBe('object_addressed_code');
    expect(SEEDED_STATE_LAW_KNOWLEDGE.NY.platform).toBe('article_toc_code');
    expect(SEEDED_STATE_LAW_KNOWLEDGE.GA.platform).toBe('agency_publication');
    for (const seed of Object.values(SEEDED_STATE_LAW_KNOWLEDGE)) {
      expect(seed.config.verifiedNote, seed.platform).toBeTruthy();
    }
  });
});
