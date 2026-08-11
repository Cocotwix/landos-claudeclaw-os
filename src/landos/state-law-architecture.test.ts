// LandOS — the state-law lane's ARCHITECTURE, not any state's law.
//
// One question decides whether this correction worked: can a property from a
// state nobody has programmed run
//
//   state → statewide framework check → local authority → local rules →
//   reconciliation → cache
//
// without a line of state-specific production code being added first? Every
// test below is about that pipeline. The fixtures are deliberately synthetic:
// a real state's HTML would let a shape be recognised for the wrong reason.
//
// Acceptance states, per the correction's own brief:
//   1. MISSOURI  — in no registry, no seed, no adapter. Must work anyway.
//   2. TEXAS     — in the source directory, no adapter of its own.
//   3. MICHIGAN  — the regression. Learned knowledge must be untouched.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectStateLawPlatform,
  deriveChapterLinkShape,
  deriveObjectIdPrefix,
  extractStatuteCitation,
  locateStateLegalSource,
  objectIdShape,
  retrieveStateLaw,
  sectionObjectId,
} from './state-law-retrieval.js';
import {
  learnedStateLawSource,
  listLearnedStateLawSources,
  rememberStateLawSource,
  resetLearnedStateLawCache,
  SEEDED_STATE_LAW_KNOWLEDGE,
  stateLawPlatformFor,
} from './state-law-learning.js';
import { STATE_LEGAL_SOURCES, stateLegalSourceFor } from './state-legal-sources.js';
import { deriveOfficialSiteHosts } from './land-use-local.js';
import { _closeTestLandosDb, _initTestLandosDb } from './db.js';
import type { GovFetchText } from './gis-transport.js';

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

beforeEach(() => {
  // Each test starts from seeded knowledge only, so a cache hit proved in one
  // test can never be what makes the next one pass.
  resetLearnedStateLawCache();
});

/* ════════ 1. AN UNSEEN STATE: MISSOURI, IN NO REGISTRY AT ALL ════════ */

/**
 * Missouri appears in no source directory entry, no seed and no adapter, which
 * is exactly the condition the old lane could not survive. Its fixture is
 * shaped UNLIKE any of the three learned states on purpose: the objects are
 * addressed by `docName`, not `objectName`; the ids are prefixed `mo-`, not
 * `mcl-`; the sections are children named `sec…`, not `Act-N-of-YYYY`. If any
 * of Michigan's parsing had survived in the generic adapter, none of this is
 * readable.
 */
const MO_ORIGIN = 'https://www.legis.mo.gov';
const MO_HOME = `<html><body>
<h1>Missouri General Assembly</h1>
<p>The Missouri Legislature publishes the Revised Statutes of Missouri.</p>
<a href="/statutes/index">Revised Statutes of Missouri</a>
<a href="/statute?docName=mo-chap054">Chapter 54</a>
<a href="/statute?docName=mo-chap064">Chapter 64</a>
<a href="/statute?docName=mo-chap089">Chapter 89</a>
</body></html>`;
const MO_INDEX = `<table><tbody>
<tr><td><a href="/statute?docName=mo-chap054">Chapter 54</a></td><td>COUNTY TREASURER</td></tr>
<tr><td><a href="/statute?docName=mo-chap064">Chapter 64</a></td><td>COUNTY PLANNING, ZONING AND SUBDIVISION OF LAND</td></tr>
<tr><td><a href="/statute?docName=mo-chap089">Chapter 89</a></td><td>ALCOHOLIC BEVERAGES</td></tr>
</tbody></table>`;
const MO_CHAPTER_64 = `<html><a href="/statute?docName=mo-sec064.510">Section 64.510</a></html>`;
const MO_SECTION = `<html><p>Section 64.510. Subdivision regulations authorized.
The county planning commission may adopt regulations governing the subdivision of land within the
unincorporated territory of the county. The regulations may provide for the harmonious development
of the county, for the coordination of streets within a subdivision with other existing or planned
streets, and for the size of lots and blocks. No plat of a subdivision of land within the
unincorporated territory shall be recorded until it has been submitted to and approved by the
county planning commission and the approval entered in writing on the plat.</p></html>`;

const MO_PAGES: Record<string, string> = {
  [MO_ORIGIN]: MO_HOME,
  [`${MO_ORIGIN}/statutes/index`]: MO_INDEX,
  [`${MO_ORIGIN}/statute?docName=mo-chap064`]: MO_CHAPTER_64,
  [`${MO_ORIGIN}/statute?docName=mo-sec064.510`]: MO_SECTION,
};

describe('a state that appears in no registry is discovered, detected and read', () => {
  it('is genuinely unprogrammed — no directory entry, no seed, no adapter', () => {
    expect(stateLegalSourceFor('MO')).toBeNull();
    expect(SEEDED_STATE_LAW_KNOWLEDGE.MO).toBeUndefined();
    expect(STATE_LEGAL_SOURCES.some((entry) => entry.state === 'MO')).toBe(false);
  });

  it('discovers the official publication from the hostname formula and verifies it', async () => {
    const { fetchText } = stubTransport(MO_PAGES);
    const located = await locateStateLegalSource('MO', { fetchText, learn: false });
    expect(located?.origin).toBe(MO_ORIGIN);
    expect(located?.route).toBe('discovered');
    expect(located?.verified).toBe(true);
  });

  it('refuses a host that does not name the state as a legal publication', async () => {
    const { fetchText } = stubTransport({
      [MO_ORIGIN]: '<html><body><h1>Kansas Legislature</h1><p>Kansas statutes.</p></body></html>',
    });
    expect(await locateStateLegalSource('MO', { fetchText, learn: false })).toBeNull();
  });

  it('detects the shape from the source itself, not from the state code', async () => {
    const { fetchText } = stubTransport(MO_PAGES);
    const detection = await detectStateLawPlatform(MO_ORIGIN, fetchText, { left: 8 }, []);
    expect(detection?.config.platform).toBe('object_addressed_code');
    // Read off the page: this source's own parameter name and its own prefix.
    expect(detection?.config.objectPath).toBe('/statute?docName={id}');
    expect(detection?.config.objectIdPrefix).toBe('mo-');
    expect(detection?.evidence).toMatch(/docName=<id>/);
  });

  it('runs the whole pipeline end to end with no state-specific code', async () => {
    const { fetchText } = stubTransport(MO_PAGES);
    const retrieval = await retrieveStateLaw('MO', { fetchText, maxRequests: 12, learn: false });
    expect(retrieval.platform).toBe('object_addressed_code');
    expect(retrieval.origin).toBe(MO_ORIGIN);
    expect(retrieval.blocker).toBeNull();
    const section = retrieval.documents.find((document) => /64\.510/.test(document.url));
    expect(section?.text).toMatch(/governing the subdivision of land/);
    // Cited without one line of Missouri citation code.
    expect(section?.citation).toMatch(/64\.510/);
  });

  it('never opens the chapter that scores no land-use concept', async () => {
    const { fetchText, requested } = stubTransport(MO_PAGES);
    await retrieveStateLaw('MO', { fetchText, maxRequests: 12, learn: false });
    expect(requested.some((url) => url.includes('mo-chap054'))).toBe(false);
  });
});

/* ════════════════════ 2. THE LEARNED-SOURCE CACHE ════════════════════ */

describe('what was learned about a state is reused by the next property in it', () => {
  it('skips discovery and detection on the second property', async () => {
    const first = stubTransport(MO_PAGES);
    const one = await retrieveStateLaw('MO', { fetchText: first.fetchText, maxRequests: 12 });
    expect(one.documents.length).toBeGreaterThan(0);
    // First time through, the source itself had to be read to detect its shape.
    expect(first.requested).toContain(MO_ORIGIN);

    const second = stubTransport(MO_PAGES);
    const two = await retrieveStateLaw('MO', { fetchText: second.fetchText, maxRequests: 12 });
    expect(two.documents.length).toBe(one.documents.length);
    expect(two.platform).toBe('object_addressed_code');
    // Second time through, nothing is spent on discovery or detection: the run
    // goes straight to the index it already knows about.
    expect(second.requested).not.toContain(MO_ORIGIN);
    expect(second.requested[0]).toBe(`${MO_ORIGIN}/statutes/index`);
    expect(second.requested.length).toBeLessThan(first.requested.length);
  });

  it('remembers the source and the shape, and counts the runs honestly', async () => {
    const { fetchText } = stubTransport(MO_PAGES);
    await retrieveStateLaw('MO', { fetchText, maxRequests: 12 });
    const learned = learnedStateLawSource('MO');
    expect(learned?.origin).toBe(MO_ORIGIN);
    expect(learned?.platform).toBe('object_addressed_code');
    expect(learned?.learnedFrom).toBe('discovery');
    expect(learned?.successes).toBe(1);
    expect(listLearnedStateLawSources().map((entry) => entry.state)).toContain('MO');
  });

  it('does not cache a shape that retrieved nothing', async () => {
    const { fetchText } = stubTransport({ [MO_ORIGIN]: MO_HOME });
    const retrieval = await retrieveStateLaw('MO', { fetchText, maxRequests: 12 });
    expect(retrieval.documents).toHaveLength(0);
    const learned = learnedStateLawSource('MO');
    // The origin is remembered — it was reached. The shape is not, because
    // caching a route already known to be empty would make every future
    // property in the state repeat it.
    expect(learned?.origin).toBe(MO_ORIGIN);
    expect(learned?.platform).toBe('unknown');
    expect(learned?.successes).toBe(0);
    expect(learned?.runs).toBeGreaterThan(0);
  });

  it('survives a restart by storing the row, not just the process cache', async () => {
    // A cache that only lives in memory would make every managed restart cost
    // the discovery again, so the row has to round-trip through storage.
    _initTestLandosDb();
    try {
      const { fetchText } = stubTransport(MO_PAGES);
      await retrieveStateLaw('MO', { fetchText, maxRequests: 12 });
      // Exactly what a restart looks like to this module.
      resetLearnedStateLawCache();
      const afterRestart = learnedStateLawSource('MO');
      expect(afterRestart?.origin).toBe(MO_ORIGIN);
      expect(afterRestart?.platform).toBe('object_addressed_code');
      expect(afterRestart?.config.objectPath).toBe('/statute?docName={id}');
      expect(afterRestart?.config.objectIdPrefix).toBe('mo-');
    } finally {
      _closeTestLandosDb();
      resetLearnedStateLawCache();
    }
  });

  it('refuses to write a legal conclusion into shared state knowledge', () => {
    expect(() => rememberStateLawSource('MO', {
      body: 'No plat of a subdivision shall be recorded until approved by the commission',
      origin: MO_ORIGIN,
    })).toThrow(/legal conclusion/i);
  });
});

/* ═══════ 3. A DIRECTORY STATE WITH NO ADAPTER OF ITS OWN: TEXAS ══════ */

const TX_ORIGIN = 'https://capitol.texas.gov';
const TX_INDEX = `<html>
<a href="/statutes/LG">LG Local Government Code</a>
<a href="/statutes/AG">AG Agriculture Code</a>
<a href="/statutes/WA">WA Water Code</a>
</html>`;
const TX_LG = `<html><p>ARTICLE 232 County Regulation of Subdivisions</p>
<a href="/statutes/LG/A232">A232</a></html>`;
const TX_A232 = `<html><p>ARTICLE 232 County Regulation of Subdivisions
SECTION 232001 Plat required for subdivision of land</p>
<a href="/statutes/LG/232001">232001</a></html>`;
const TX_SECTION = `<html><p>Local Government Code § 232.001. Plat required.
The owner of a tract of land located outside the limits of a municipality must have a plat of the
subdivision prepared if the owner divides the tract into two or more parts to lay out a subdivision
of the tract. A division of a tract under this section includes a division regardless of whether it
is made by using a metes and bounds description in a deed of conveyance or by other method.</p></html>`;

describe('a state in the source directory with no adapter of its own', () => {
  const pages: Record<string, string> = {
    [TX_ORIGIN]: `<html><a href="/statutes/">Texas Statutes</a></html>`,
    [`${TX_ORIGIN}/statutes/`]: TX_INDEX,
    [`${TX_ORIGIN}/statutes/LG`]: TX_LG,
    [`${TX_ORIGIN}/statutes/LG/A232`]: TX_A232,
    [`${TX_ORIGIN}/statutes/LG/232001`]: TX_SECTION,
  };

  it('is in the directory and has no platform of its own', () => {
    expect(stateLegalSourceFor('TX')?.origin).toBe(TX_ORIGIN);
    expect(SEEDED_STATE_LAW_KNOWLEDGE.TX).toBeUndefined();
    expect(stateLawPlatformFor('TX')).toBeNull();
  });

  it('takes its origin from the directory and detects the shape by reading it', async () => {
    const { fetchText } = stubTransport(pages);
    const retrieval = await retrieveStateLaw('TX', {
      fetchText, maxRequests: 14, localUnitHint: 'county', learn: false,
    });
    expect(retrieval.origin).toBe(TX_ORIGIN);
    expect(retrieval.platform).toBe('article_toc_code');
    expect(retrieval.notes.some((note) => /Shape detected from the source itself/.test(note))).toBe(true);
    const section = retrieval.documents.find((document) => /232001/.test(document.url));
    expect(section?.text).toMatch(/must have a plat of the/);
    expect(section?.citation).toMatch(/232\.001|Local Government Code/);
  });
});

/* ═════════════ 4. REGRESSION: MICHIGAN'S LEARNED KNOWLEDGE ═══════════ */

const MI_ORIGIN = 'https://www.legislature.mi.gov';
const MI_PAGES: Record<string, string> = {
  [`${MI_ORIGIN}/Laws/ChapterIndex`]: `<table><tbody>
<tr><td><a href="/Laws/MCL?objectName=mcl-chap54">Chapter 54</a></td><td>SURVEYORS</td></tr>
<tr><td><a href="/Laws/MCL?objectName=mcl-chap560">Chapter 560</a></td><td>SUBDIVISION CONTROL ACT OF 1967</td></tr>
</tbody></table><p>MCL Complete Through PA 20 of 2026</p>`,
  [`${MI_ORIGIN}/Laws/MCL?objectName=mcl-chap560`]:
    `<a href="/Laws/MCL?objectName=mcl-Act-288-of-1967">Act 288 of 1967</a>`,
  [`${MI_ORIGIN}/Laws/MCL?objectName=mcl-Act-288-of-1967`]: `<p>Chapter 560 LAND DIVISION ACT Act 288 of 1967
AN ACT to regulate the division of land; to promote the public health, safety and general welfare;
to further the orderly layout and use of land; to require that land be surveyed and monuments
placed; to regulate the subdividing of land; to establish the procedure for the approval of plats;
to provide for the recording of plats; and to prescribe the powers and duties of local units of
government and state agencies with respect to the division of land and the approval of plats.</p>
<p>Division GENERAL PROVISIONS (560.101...560.109b) Division PRELIMINARY PLATS (560.111...560.120)</p>`,
  [`${MI_ORIGIN}/Laws/MCL?objectName=mcl-560-111`]: `<p>560.111 Preliminary plat; submission to municipality.
Sec. 111. A proprietor shall submit a preliminary plat to the municipality for approval before any
division of land is made. The division of land shall comply with this act and with the ordinances of
the municipality in which the land lies. The municipality shall approve or reject the preliminary
plat within the period prescribed by this act, and shall state its reasons in writing where a plat
is rejected so that the proprietor may correct the plat and resubmit it for approval.</p>`,
};

describe('Michigan is still read exactly as it was proven live', () => {
  it('keeps its seeded source, shape and parsing configuration', () => {
    const learned = learnedStateLawSource('MI');
    expect(learned?.learnedFrom).toBe('seed');
    expect(learned?.origin).toBe(MI_ORIGIN);
    expect(learned?.platform).toBe('object_addressed_code');
    // The parsing details that used to be hardcoded in the generic adapter now
    // travel with the source. They must all still be here.
    expect(learned?.config.objectIdPrefix).toBe('mcl-');
    expect(learned?.config.childObjectPattern).toBe('Act-\\d+-of-\\d+');
    expect(learned?.config.citationLabel).toBe('MCL');
  });

  it('reaches the section text without spending a request on detection', async () => {
    const { fetchText, requested } = stubTransport(MI_PAGES);
    const retrieval = await retrieveStateLaw('MI', { fetchText, maxRequests: 14, learn: false });
    // A learned state never re-reads its own homepage to work out its shape.
    expect(requested).not.toContain(MI_ORIGIN);
    expect(requested[0]).toBe(`${MI_ORIGIN}/Laws/ChapterIndex`);
    const section = retrieval.documents.find((document) => document.citation === 'MCL 560.111');
    expect(section?.text).toMatch(/shall submit a preliminary plat/);
    expect(retrieval.documents[0].effectiveNote).toMatch(/Complete Through PA 20 of 2026/);
  });

  it('keeps Georgia on its agency-publication route and New York on the browser', () => {
    expect(learnedStateLawSource('GA')?.platform).toBe('agency_publication');
    expect(learnedStateLawSource('GA')?.config.agencyHosts).toContain('dca.georgia.gov');
    expect(learnedStateLawSource('NY')?.transport).toBe('requires_browser');
    expect(learnedStateLawSource('NY')?.config.citationTemplate).toBe('{chapter} Law § {section}');
  });
});

/* ══════════ 5. NO STATE LEAKS INTO THE GENERIC MACHINERY ═════════════ */

describe('the generic machinery names no state', () => {
  it('derives a county hostname from the state it is given, with no shortcut for one', () => {
    const georgia = deriveOfficialSiteHosts('Washington County', 'GA', 'unincorporated_county');
    const missouri = deriveOfficialSiteHosts('Washington County', 'MO', 'unincorporated_county');
    // The general form still produces the Georgia host the live run used.
    expect(georgia).toContain('www.washingtoncountyga.gov');
    // And the same formula does the same thing for a state nobody wrote a line
    // for. The hardcoded `...countyga.gov` entry is gone.
    expect(missouri).toContain('www.washingtoncountymo.gov');
    expect(missouri.some((host) => /countyga\.gov$/.test(host))).toBe(false);
  });

  it('derives object addressing from the source template rather than assuming one', () => {
    expect(objectIdShape({ platform: 'object_addressed_code', objectPath: '/Laws/MCL?objectName={id}' }))
      .toBe('objectName=([^"&\']+)');
    expect(objectIdShape({ platform: 'object_addressed_code', objectPath: '/statute?docName={id}' }))
      .toBe('docName=([^"&\']+)');
    // A source that addresses objects by path, which the old adapter could not
    // read at all because it only ever looked for a query parameter.
    expect(objectIdShape({ platform: 'object_addressed_code', objectPath: '/code/{id}' }))
      .toBe('/code/([^"\'&?#/]+)');
  });

  it('derives the id prefix and the section id from the source, not from Michigan', () => {
    expect(deriveObjectIdPrefix(['mcl-chap560', 'mcl-chap54'])).toBe('mcl-');
    expect(deriveObjectIdPrefix(['mo-chap064', 'mo-chap089'])).toBe('mo-');
    expect(deriveObjectIdPrefix(['chap064', 'chap089'])).toBeNull();
    expect(sectionObjectId({ platform: 'object_addressed_code', sectionIdTemplate: '{prefix}{sectionDashed}' }, '560.111', 'mcl-'))
      .toBe('mcl-560-111');
    expect(sectionObjectId({ platform: 'object_addressed_code', sectionIdTemplate: '{prefix}sec{section}' }, '64.510', 'mo-'))
      .toBe('mo-sec64.510');
  });

  it('derives chapter links from the index path it was given', () => {
    expect(deriveChapterLinkShape('/legislation/laws/CONSOLIDATED').test('https://x.gov/legislation/laws/TWN')).toBe(true);
    expect(deriveChapterLinkShape('/statutes/').test('https://x.gov/statutes/LG')).toBe(true);
  });
});

/* ══════════════ 6. AN UNFAMILIAR STATE CAN STILL BE CITED ════════════ */

describe('a citation is read by its form, so an unstudied state is still citable', () => {
  it('reads citation styles no LandOS code names', () => {
    // New Hampshire, Washington, Oregon, Maryland — none of them appear in any
    // citation pattern anywhere in this engine.
    expect(extractStatuteCitation('under R.S.A. 674:21 the board may', '')).toBe('R.S.A. 674:21');
    expect(extractStatuteCitation('as provided in RCW 58.17.060, the city', '')).toBe('RCW 58.17.060');
    expect(extractStatuteCitation('see ORS 92.010 for definitions', '')).toBe('ORS 92.010');
    expect(extractStatuteCitation('Title 30, Section 4-101 of the code', '')).toBe('Title 30, Section 4-101');
    expect(extractStatuteCitation('Revised Code § 711.001 applies', '')).toBe('Revised Code § 711.001');
  });

  it('still reads the three studied styles through the same generic ladder', () => {
    expect(extractStatuteCitation('Zoning (O.C.G.A. 36-66-1, et seq.)', '')).toBe('O.C.G.A. 36-66-1');
    expect(extractStatuteCitation('MCL 560.111 Preliminary plat', '')).toBe('MCL 560.111');
    expect(extractStatuteCitation('Town Law § 276. Approval of plats.', '')).toMatch(/Town Law § 276/);
  });

  it('prefers a source\'s own learned house style when it has one', () => {
    const shapes = SEEDED_STATE_LAW_KNOWLEDGE.GA.config.citationShapes;
    // Both a section symbol and an O.C.G.A. reference are present; the learned
    // shape is what decides which one is the citation.
    const text = 'See § 12 below. Zoning (O.C.G.A. 36-66-1, et seq.) governs the procedure.';
    expect(extractStatuteCitation(text, '', shapes)).toBe('O.C.G.A. 36-66-1');
  });

  it('returns null rather than inventing a citation', () => {
    expect(extractStatuteCitation('The commission meets on the first Tuesday.', '')).toBeNull();
  });
});
