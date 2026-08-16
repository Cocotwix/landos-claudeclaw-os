// LandOS — the subdivision regulation SET is retrieved the same way every run.
//
// The defect this covers, from four live runs on one Fairview parcel: run one
// returned Articles 1 and 4, run two returned Article 2 with the minor/major
// thresholds, run three returned Article 1 alone, run four returned nothing.
// Same parcel, same government, same adopted regulations, four different
// answers — because a keyless web search decided which parts of a nine-part
// document set LandOS ever opened.
//
// Three behaviours make that deterministic, and each is proven here:
//   • the series is COMPLETED from the government's own URL pattern;
//   • the set is RETAINED against the government and fetched directly next run;
//   • rules are MERGED in a defined order, and a rule already established is
//     not lost because today's retrieval reached less than yesterday's.
//
// No network. Every document is served from a fixture keyed by URL.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pre-existing and unrelated: `comps.ts` at HEAD imports an uncommitted module,
// which the store's transitive imports would otherwise pull in.
vi.mock('./comps.js', () => ({
  listComps: () => [], addComp: () => ({}), getComp: () => undefined, deleteComp: () => false,
  upsertNormalizedComp: () => ({}), retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [], geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null, recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }), isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined, PAID_COMP_TOOLS: [],
}));

import { _initTestLandosDb } from './db.js';
import {
  regulationSeriesPart,
  regulationSeriesUrl,
  retrieveSubdivisionRegulations,
  type SubdivisionRegulations,
} from './subdivision-regulations.js';
import {
  readRegulationDocuments,
  saveRegulationDocuments,
} from './regulation-document-store.js';
import type { AuthorityAssignment } from './controlling-land-use-authority.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';
import { documentUrlIdentity } from './document-url-identity.js';
import type { OfficialPdfDocument } from './official-pdf-identity.js';

// ── The document set, as Fairview actually publishes it ─────────────────────

const HOST = 'https://www.fairview-tn.org/content/uploads/docs';
const partUrl = (part: number): string => `${HOST}/Fairview_Subdivision_Regulations_Article${part}.pdf`;

// The SAME files, at the other address the same server answers on. Fairview
// publishes its regulations under the WordPress asset root and under the alias,
// so a search returns both spellings of one document.
const ALIAS_HOST = 'https://www.fairview-tn.org/wp-content/uploads/docs';
const aliasPartUrl = (part: number): string => `${ALIAS_HOST}/Fairview_Subdivision_Regulations_Article${part}.pdf`;

/** Article I. Fairview's own copy still carries the PROPOSED header. */
const ARTICLE_1 = `PROPOSED SUBDIVISION REGULATIONS ARTICLE I - GENERAL PROVISIONS.
These subdivision regulations are adopted under Section 13-4-308.
SECTION 1 - 112 An easement shall be at least fifty (50) feet in width for utilities, and for other required public services.
A plat shall be attached, declaring the plat or part of the plat to be vacated.
Minimum lot size shall be five (5) acres under the proposed schedule.`;

/** Article II. The minor/major definitions the review path turns on. */
const ARTICLE_2 = `ARTICLE II PROCEDURE FOR SUBDIVISION APPROVAL of the subdivision regulations of the City of Fairview.
SECTION 2 - 101 Minor Subdivision A division of land into not more than two (2) lots and not requiring public facilities or utility extensions.
Major Subdivision A division of land into two (2) or more lots that include any of the following: a new or extended street.
The Planning Commission shall review the Conceptual Plan in accordance with the criteria contained in these regulations.`;

/** Article IV. The dimensional standards, and a lot count that is not a rule. */
const ARTICLE_4 = `ARTICLE IV GENERAL REQUIREMENTS AND DESIGN STANDARDS of the subdivision regulations of the City of Fairview.
SECTION 4-102.2 Up to three lots are proposed on the illustrative exhibit.
Each lot shall have frontage on a public street or, where permitted, on a private street.
Minimum lot size shall be one (1) acre where public sewer is not available.
A minimum road frontage of at least two hundred (200) feet along routes designated in the Major Thoroughfare Plan is required.
The Planning Commission shall review every plat submitted under this article.`;

/** Article V. Carries nothing the earlier articles do not already state. */
const ARTICLE_5 = `ARTICLE V PLAN CONTENT REQUIREMENTS of the subdivision regulations of the City of Fairview.
SECTION 5 - 102 Where public sewer service is proposed the soil information shall be in the form of a high intensity soil survey.
A septic system and water wells, existing and proposed, shall be shown.`;

const DOCUMENTS: Record<string, string> = {
  [partUrl(1)]: ARTICLE_1,
  [partUrl(2)]: ARTICLE_2,
  [partUrl(4)]: ARTICLE_4,
  [partUrl(5)]: ARTICLE_5,
};

const FAIRVIEW: AuthorityAssignment = {
  name: 'Fairview',
  level: 'municipal',
  determination: 'confirmed',
  basis: 'The city administers subdivision review through its planning commission.',
  sources: [],
  competingClaims: [],
};

const SUBJECT = { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' };

/** A PDF reader over the fixture set, recording every URL it was asked for. */
function pdfTransport(): { loadPdf: (url: string) => Promise<OfficialPdfDocument | null>; opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    loadPdf: async (url: string) => {
      opened.push(url);
      const text = DOCUMENTS[url] ?? DOCUMENTS[url.replace('/wp-content/', '/content/')];
      if (!text) return null;
      return {
        url,
        fetchedAt: '2026-08-16T00:00:00.000Z',
        byteLength: text.length,
        pages: [text],
        text,
        textLayer: true,
        fromCache: false,
      };
    },
  };
}

/** A search that returns exactly the parts a given run happened to surface. */
function searchReturning(...urls: string[]): IdentitySearchProvider {
  return (async () => urls.map((url) => ({
    title: url.split('/').pop() ?? url,
    url,
    snippet: 'Subdivision regulations',
  }))) as unknown as IdentitySearchProvider;
}

function run(deps: Parameters<typeof retrieveSubdivisionRegulations>[2]): Promise<SubdivisionRegulations> {
  return retrieveSubdivisionRegulations(SUBJECT, FAIRVIEW, {
    preferredHosts: ['www.fairview-tn.org'],
    now: () => '2026-08-16T00:00:00.000Z',
    ...deps,
  });
}

const keysOf = (regulations: SubdivisionRegulations): string[] => regulations.rules.map((rule) => rule.key).sort();
const partsOf = (regulations: SubdivisionRegulations): number[] => regulations.documents
  .map((document) => (document.url ? regulationSeriesPart(document.url) : null))
  .filter((part): part is number => part != null)
  .sort((a, b) => a - b);

beforeEach(() => {
  _initTestLandosDb();
});

// ── The URL pattern ─────────────────────────────────────────────────────────

describe('a regulation document series', () => {
  it('reads the part number a document URL states', () => {
    expect(regulationSeriesPart(partUrl(4))).toBe(4);
    expect(regulationSeriesPart(`${HOST}/Subdivision_Regs_Chapter-12.pdf`)).toBe(12);
    expect(regulationSeriesPart(`${HOST}/subdivision_regulations_part_03.pdf`)).toBe(3);
    expect(regulationSeriesPart(`${HOST}/Fairview_Subdivision_Regulations.pdf`)).toBeNull();
    expect(regulationSeriesPart('https://www.fairview-tn.org/planning')).toBeNull();
  });

  it('moves only the part number, never the host or the naming', () => {
    expect(regulationSeriesUrl(partUrl(4), 2)).toBe(partUrl(2));
    expect(regulationSeriesUrl(`${HOST}/subdivision_regulations_part_03.pdf`, 11))
      .toBe(`${HOST}/subdivision_regulations_part_11.pdf`);
    expect(regulationSeriesUrl(`${HOST}/Fairview_Subdivision_Regulations.pdf`, 2)).toBeNull();
  });
});

// ── The behaviour the operator sees ─────────────────────────────────────────

describe('subdivision regulation retrieval is reproducible', () => {
  it('completes the series from one discovered part, whichever part it was', async () => {
    const fromArticleFour = await run({ ...pdfTransport(), search: searchReturning(partUrl(4)) });
    const fromArticleOne = await run({ ...pdfTransport(), search: searchReturning(partUrl(1)) });
    const fromArticleFive = await run({ ...pdfTransport(), search: searchReturning(partUrl(5)) });

    for (const regulations of [fromArticleFour, fromArticleOne, fromArticleFive]) {
      expect(partsOf(regulations)).toEqual([1, 2, 4, 5]);
    }
    expect(keysOf(fromArticleOne)).toEqual(keysOf(fromArticleFour));
    expect(keysOf(fromArticleFive)).toEqual(keysOf(fromArticleFour));
    expect(fromArticleFour.limitations.join(' ')).toMatch(/published as a numbered series/);
  });

  it('carries the minor/major threshold the regulations state, not a lot count from an exhibit', async () => {
    // Article 4 says "Up to three lots are proposed" on an illustrative
    // exhibit; Article 2 states the actual definition. A run that reads only
    // Article 4 would tell the operator the wrong review path.
    const regulations = await run({ ...pdfTransport(), search: searchReturning(partUrl(4)) });
    expect(regulations.thresholds.minorDefinition?.value).toMatch(/not more than two \(2\) lots/i);
    expect(regulations.thresholds.statedMaxMinorLots).toBe(2);
    expect(regulations.thresholds.basis).toMatch(/minor-subdivision definition states/i);
  });

  it('cites a rule stated in two articles to the same article every run', async () => {
    const first = await run({ ...pdfTransport(), search: searchReturning(partUrl(4), partUrl(2)) });
    const second = await run({ ...pdfTransport(), search: searchReturning(partUrl(2), partUrl(4)) });
    const cite = (regulations: SubdivisionRegulations, key: string): string | null =>
      regulations.rules.find((rule) => rule.key === key)?.sourceUrl ?? null;
    // Article II prints the planning-commission review before Article IV does.
    expect(cite(first, 'planning_commission_review')).toBe(partUrl(2));
    expect(cite(second, 'planning_commission_review')).toBe(partUrl(2));
  });

  it('never lets the PROPOSED article supply a rule an adopted one states', async () => {
    const regulations = await run({ ...pdfTransport(), search: searchReturning(partUrl(1)) });
    const minimumLot = regulations.rules.find((rule) => rule.key === 'minimum_lot_size');
    expect(minimumLot?.value).toMatch(/one \(1\) acre/);
    expect(minimumLot?.sourceUrl).toBe(partUrl(4));
  });

  it('reads the retained set directly, with no search wired at all', async () => {
    const transport = pdfTransport();
    const regulations = await run({
      ...transport,
      retainedDocuments: [1, 2, 4, 5].map((part) => ({
        label: `Article ${part}`,
        url: partUrl(part),
        tier: 'official_government_source' as const,
        adoptedOrAsOf: null,
        draftOrProposed: false,
        retrievedAt: '2026-08-15T00:00:00.000Z',
      })),
    });
    expect(partsOf(regulations)).toEqual([1, 2, 4, 5]);
    expect(regulations.thresholds.statedMaxMinorLots).toBe(2);
    expect(transport.opened).toEqual(expect.arrayContaining([partUrl(2)]));
  });
});

describe('a run that reaches less than the last one', () => {
  it('keeps the rules a previous run established, and says they were carried', async () => {
    const established = await run({ ...pdfTransport(), search: searchReturning(partUrl(2)) });
    expect(established.rules.length).toBeGreaterThan(4);

    // Every route fails: the search returns nothing and no document opens.
    const blackout = await run({
      search: searchReturning(),
      loadPdf: async () => null,
      retainedRules: established.rules,
      retainedDocuments: established.documents,
    });
    expect(blackout.documents.length).toBeGreaterThan(0);
    expect(keysOf(blackout)).toEqual(keysOf(established));
    expect(blackout.thresholds.statedMaxMinorLots).toBe(2);
    expect(blackout.limitations.join(' ')).toMatch(/carried forward/i);
    for (const rule of blackout.rules) {
      expect(rule.limitations.join(' ')).toMatch(/not re-read in this run/i);
    }
  });

  it('never carries a remembered rule over a document it read again', async () => {
    const stale = {
      key: 'minimum_lot_size' as const,
      label: 'Minimum lot size',
      value: 'Minimum lot size shall be forty (40) acres.',
      quote: 'Minimum lot size shall be forty (40) acres.',
      section: 'SECTION 4-102.2',
      sourceLabel: 'Article 4',
      sourceUrl: partUrl(4),
      authorityName: 'Fairview',
      effectiveOrAsOf: null,
      confidence: 'confirmed' as const,
      limitations: [],
    };
    const regulations = await run({
      ...pdfTransport(),
      search: searchReturning(partUrl(4)),
      retainedRules: [stale],
    });
    const minimumLot = regulations.rules.find((rule) => rule.key === 'minimum_lot_size');
    expect(minimumLot?.value).toMatch(/one \(1\) acre/);
    expect(minimumLot?.value).not.toMatch(/forty \(40\) acres/);
  });
});

// ── The store ───────────────────────────────────────────────────────────────

describe('the retained regulation set', () => {
  const fairview = { authorityName: 'Fairview', level: 'municipal' as const, state: 'TN' };
  const williamson = { authorityName: 'Williamson County', level: 'county' as const, state: 'TN' };

  it('is keyed to the government that adopted it, and read back in a stable order', () => {
    saveRegulationDocuments(fairview, [
      { url: partUrl(4), label: 'Article 4', ruleCount: 6 },
      { url: partUrl(2), label: 'Article 2', ruleCount: 4 },
    ]);
    expect(readRegulationDocuments(fairview).map((row) => row.url)).toEqual([partUrl(2), partUrl(4)]);
    expect(readRegulationDocuments(williamson)).toEqual([]);
  });

  it('refreshes a document rather than duplicating it, and never drops a part', () => {
    saveRegulationDocuments(fairview, [{ url: partUrl(2), label: 'Article 2', ruleCount: 4 }]);
    saveRegulationDocuments(fairview, [
      { url: partUrl(2), label: 'Article II', adoptedOrAsOf: 'June 2, 2018', ruleCount: 7 },
    ]);
    // A later run that reached only part 2 must not erase part 4.
    saveRegulationDocuments(fairview, [{ url: partUrl(4), label: 'Article 4', ruleCount: 6 }]);
    const retained = readRegulationDocuments(fairview);
    expect(retained.map((row) => row.url)).toEqual([partUrl(2), partUrl(4)]);
    expect(retained[0].label).toBe('Article II');
    expect(retained[0].adoptedOrAsOf).toBe('June 2, 2018');
    expect(retained[0].ruleCount).toBe(7);
  });

  it('keeps a county set apart from the city set inside it', () => {
    saveRegulationDocuments(fairview, [{ url: partUrl(2), label: 'Article 2' }]);
    saveRegulationDocuments(williamson, [{ url: 'https://www.williamsoncounty-tn.gov/regs.pdf', label: 'County regs' }]);
    expect(readRegulationDocuments(fairview).map((row) => row.url)).toEqual([partUrl(2)]);
    expect(readRegulationDocuments(williamson).map((row) => row.url)).toEqual(['https://www.williamsoncounty-tn.gov/regs.pdf']);
  });
});

// ── One document, however the site spells its address ───────────────────────

describe('a document a site serves at two addresses', () => {
  it('is listed once, whichever spellings the search returned', async () => {
    const transport = pdfTransport();
    const regulations = await run({
      ...transport,
      // The search surfaces both spellings of the same articles.
      search: searchReturning(aliasPartUrl(2), partUrl(2), partUrl(4), aliasPartUrl(4)),
    });
    const identities = regulations.documents.map((document) => documentUrlIdentity(document.url));
    // The defect: thirteen documents where the government publishes ten.
    expect(new Set(identities).size).toBe(identities.length);
    expect(new Set(partsOf(regulations)).size).toBe(partsOf(regulations).length);
    // Every rule still cites a document that is in the list the operator sees.
    for (const rule of regulations.rules) {
      if (!rule.sourceUrl) continue;
      expect(identities).toContain(documentUrlIdentity(rule.sourceUrl));
    }
  });

  it('keeps the same address on every run when both spellings are returned', async () => {
    const first = await run({
      ...pdfTransport(),
      search: searchReturning(aliasPartUrl(2), partUrl(2)),
    });
    const second = await run({
      ...pdfTransport(),
      search: searchReturning(partUrl(2), aliasPartUrl(2)),
    });
    // The search's ordering must not decide the link under the rule.
    expect(first.documents.map((document) => document.url))
      .toEqual(second.documents.map((document) => document.url));
    expect(first.documents.some((document) => document.url === partUrl(2))).toBe(true);
  });

  it('does not put a second copy of a held document into the retained set', () => {
    const fairview = { authorityName: 'Fairview', level: 'municipal' as const, state: 'TN' };
    saveRegulationDocuments(fairview, [
      { url: partUrl(2), label: 'Article 2', ruleCount: 4 },
      { url: aliasPartUrl(2), label: 'Article 2', ruleCount: 0 },
    ]);
    const retained = readRegulationDocuments(fairview);
    expect(retained.map((row) => row.url)).toEqual([partUrl(2)]);
    expect(retained[0].ruleCount).toBe(4);
  });

  it('collapses duplicates a previous run already wrote, keeping the address that carried the rules', () => {
    const fairview = { authorityName: 'Fairview', level: 'municipal' as const, state: 'TN' };
    // Written before the two addresses were known to be one document.
    saveRegulationDocuments(fairview, [{ url: aliasPartUrl(2), label: 'Article 2', ruleCount: 0 }]);
    saveRegulationDocuments(fairview, [{ url: partUrl(2), label: 'Article II', ruleCount: 7 }]);
    const retained = readRegulationDocuments(fairview);
    expect(retained.map((row) => row.url)).toEqual([partUrl(2)]);
    expect(retained[0].ruleCount).toBe(7);
  });
});
