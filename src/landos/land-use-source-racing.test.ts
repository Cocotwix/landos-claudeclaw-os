// Source racing for land-use intelligence.
//
// The engine first — first-sufficient release, losing lanes corroborating,
// bounded re-aim, escalation — then the four subsystems that race on top of it,
// then the source-authority ranking that decides which government may answer.

import { describe, expect, it, vi } from 'vitest';

// Pre-existing, unrelated: `comps.ts` at HEAD imports an uncommitted module.
vi.mock('./comps.js', () => ({
  listComps: () => [], addComp: () => ({}), getComp: () => undefined, deleteComp: () => false,
  upsertNormalizedComp: () => ({}), retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [], geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null, recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }), isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined, PAID_COMP_TOOLS: [],
}));

import {
  officialCurrentParcelGate,
  raceLandUseSources,
  type LandUseEvidence,
  type LandUseLane,
} from './land-use-source-race.js';
import {
  buildLandUseQueries,
  indexedWebSearchLane,
  retainedEvidenceLane,
  type SourceDocument,
} from './land-use-lanes.js';
import {
  governmentSourceTier,
  hostServesSubjectJurisdiction,
  rankSourceForAuthority,
} from './land-use-source-authority.js';
import { resolveControllingLandUseAuthority } from './controlling-land-use-authority.js';
import { attachHistoricalZoning, classifyZoningDocument, determineCurrentZoning, zoningDeterminationsFromPublicRecords } from './current-zoning-determination.js';
import { districtCodeVariants, researchZoningStandards, scopeToDistrictBlock } from './zoning-standards-research.js';
import {
  looksLikeRegulationDocument,
  readMinorMajorThresholds,
  retrieveSubdivisionRegulations,
} from './subdivision-regulations.js';
import type { GovFetchText, GovTextResponse } from './gis-transport.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

interface District { code: string }

function evidence(input: Partial<LandUseEvidence<District>> & { laneId: string; code: string }): LandUseEvidence<District> {
  return {
    method: 'indexed_web_search',
    laneId: input.laneId,
    value: { code: input.code },
    authorityName: 'Fairview',
    sourceLabel: input.sourceLabel ?? `${input.laneId} source`,
    sourceUrl: input.sourceUrl ?? `https://www.fairview-tn.org/${input.laneId}`,
    sourceTier: input.sourceTier ?? 'official_government_source',
    parcelMatchBasis: input.parcelMatchBasis === undefined ? 'an APN query on the authority layer' : input.parcelMatchBasis,
    currentness: input.currentness ?? 'current',
    effectiveOrAsOf: input.effectiveOrAsOf ?? null,
    quote: input.quote ?? 'quote',
    retrievedAt: '2026-08-15T00:00:00.000Z',
    ...('method' in input ? { method: input.method! } : {}),
  };
}

function lane(input: {
  id: string;
  method?: LandUseEvidence<District>['method'];
  delayMs: number;
  produce: () => Array<LandUseEvidence<District>>;
  escalation?: boolean;
  reAimable?: boolean;
  onRun?: (aim: unknown) => void;
}): LandUseLane<District, Record<string, unknown>> {
  return {
    id: input.id,
    method: input.method ?? 'indexed_web_search',
    label: input.id,
    escalation: input.escalation,
    reAimable: input.reAimable,
    run: async (aim) => {
      input.onRun?.(aim);
      await sleep(input.delayMs);
      return input.produce();
    },
  };
}

const gate = officialCurrentParcelGate<District>();

// ── The engine ──────────────────────────────────────────────────────────────

describe('land-use source race engine', () => {
  it('7 + 8. a fast sufficient answer releases without waiting for a slow lane', async () => {
    let slowFinished = false;
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'retained', method: 'retained_evidence', delayMs: 0, produce: () => [evidence({ laneId: 'retained', code: 'RS-15', method: 'retained_evidence' })] }),
        lane({ id: 'slow_web', delayMs: 400, produce: () => { slowFinished = true; return []; } }),
      ],
    });

    expect(result.released).toBe(true);
    expect(result.winningMethod).toBe('retained_evidence');
    expect(result.winner?.value.code).toBe('RS-15');
    // The point of the whole architecture: the slow lane had not finished.
    expect(slowFinished).toBe(false);
    expect(result.pendingAtRelease).toContain('slow_web');
    expect(result.elapsedMs).toBeLessThan(300);
  });

  it('9. the arbitrary fastest result does not win without authority and evidence', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        // Instant, but only a search snippet: never sufficient.
        lane({
          id: 'snippet',
          delayMs: 0,
          produce: () => [evidence({ laneId: 'snippet', code: 'R-20', sourceTier: 'search_result', sourceUrl: 'https://example.com/x' })],
        }),
        lane({
          id: 'official_map',
          delayMs: 60,
          method: 'official_document',
          produce: () => [evidence({ laneId: 'official_map', code: 'RS-15', method: 'official_document' })],
        }),
      ],
    });

    expect(result.winner?.value.code).toBe('RS-15');
    expect(result.winningLaneId).toBe('official_map');
    const snippetLane = result.lanes.find((row) => row.laneId === 'snippet')!;
    expect(snippetLane.sufficientCount).toBe(0);
    expect(snippetLane.note).toMatch(/official government source/i);
  });

  it('5. a known direct GIS route can win before web search', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 10, produce: () => [evidence({ laneId: 'gis', code: 'RS-15', method: 'direct_gis_api' })] }),
        lane({ id: 'web', delayMs: 300, produce: () => [evidence({ laneId: 'web', code: 'RS-15' })] }),
      ],
    });
    expect(result.winningMethod).toBe('direct_gis_api');
    expect(result.pendingAtRelease).toContain('web');
  });

  it('6 + 22. a web-discovered official source wins when GIS has nothing', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        // No ArcGIS layer for this jurisdiction. This must not end discovery.
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 5, produce: () => [] }),
        lane({ id: 'web', delayMs: 40, produce: () => [evidence({ laneId: 'web', code: 'RS-15' })] }),
      ],
    });
    expect(result.released).toBe(true);
    expect(result.winningMethod).toBe('indexed_web_search');
    expect(result.lanes.find((row) => row.laneId === 'gis')?.status).toBe('no_evidence');
  });

  it('7b. retained authoritative evidence wins immediately', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'subdivision_rules',
      aim: {},
      gate: officialCurrentParcelGate<District>({ requireParcelMatch: false }),
      lanes: [
        lane({ id: 'retained', method: 'retained_evidence', delayMs: 0, produce: () => [evidence({ laneId: 'retained', code: 'adopted', method: 'retained_evidence', parcelMatchBasis: null })] }),
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 200, produce: () => [] }),
        lane({ id: 'web', delayMs: 250, produce: () => [] }),
      ],
    });
    expect(result.winningMethod).toBe('retained_evidence');
    expect(result.releasedAtMs).toBeLessThan(100);
  });

  it('10. a losing lane corroborates after release', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 5, produce: () => [evidence({ laneId: 'gis', code: 'RS-15', method: 'direct_gis_api' })] }),
        lane({ id: 'map', method: 'official_document', delayMs: 80, produce: () => [evidence({ laneId: 'map', code: 'RS-15', method: 'official_document' })] }),
      ],
    });
    expect(result.pendingAtRelease).toContain('map');
    const enrichment = await result.enrichment;
    expect(enrichment.corroborating).toHaveLength(1);
    expect(enrichment.corroborating[0].laneId).toBe('map');
    expect(enrichment.contradicting).toEqual([]);
    expect(enrichment.conflicts).toEqual([]);
  });

  it('28. a slower lane that disagrees becomes an explicit conflict, not a silent loss', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 5, produce: () => [evidence({ laneId: 'gis', code: 'RS-15', method: 'direct_gis_api' })] }),
        lane({ id: 'map', method: 'official_document', delayMs: 60, produce: () => [evidence({ laneId: 'map', code: 'R-20', method: 'official_document' })] }),
      ],
    });
    const enrichment = await result.enrichment;
    expect(enrichment.contradicting).toHaveLength(1);
    expect(enrichment.conflicts[0]).toMatch(/disagrees with the released answer/);
  });

  it('11 + 12. re-aim happens once per lane and is bounded overall', async () => {
    const aims: unknown[] = [];
    let webRuns = 0;
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'allowed_uses',
      aim: { district: null },
      gate,
      maxReAims: 1,
      reAim: (aim, settled) => {
        const learned = settled[0]?.value.code;
        if (!learned || (aim as { district?: string }).district === learned) return null;
        return { district: learned };
      },
      lanes: [
        // Answers with something that is NOT sufficient but IS aim-improving.
        lane({
          id: 'discovery',
          delayMs: 5,
          produce: () => [evidence({ laneId: 'discovery', code: 'RS-15', sourceTier: 'reputable_secondary' })],
        }),
        lane({
          id: 'ordinance',
          method: 'official_document',
          delayMs: 10,
          reAimable: true,
          onRun: (aim) => { aims.push(aim); webRuns += 1; },
          produce: () => (webRuns > 1
            ? [evidence({ laneId: 'ordinance', code: 'RS-15', method: 'official_document' })]
            : []),
        }),
      ],
    });

    expect(webRuns).toBe(2);
    expect(aims[0]).toEqual({ district: null });
    expect(aims[1]).toEqual({ district: 'RS-15' });
    expect(result.released).toBe(true);
    expect(result.lanes.filter((row) => row.reAimed)).toHaveLength(1);
    expect(result.notes.join(' ')).toMatch(/re-aimed once/i);
  });

  it('23. browser escalation is available but never mandatory', async () => {
    let browserRuns = 0;
    const winning = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 5, produce: () => [evidence({ laneId: 'gis', code: 'RS-15', method: 'direct_gis_api' })] }),
        lane({ id: 'browser', method: 'browser_escalation', delayMs: 5, escalation: true, produce: () => { browserRuns += 1; return []; } }),
      ],
    });
    expect(winning.released).toBe(true);
    expect(browserRuns).toBe(0);

    const escalated = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 5, produce: () => [] }),
        lane({
          id: 'browser',
          method: 'browser_escalation',
          delayMs: 5,
          escalation: true,
          produce: () => { browserRuns += 1; return [evidence({ laneId: 'browser', code: 'RS-15', method: 'browser_escalation' })]; },
        }),
      ],
    });
    expect(browserRuns).toBe(1);
    expect(escalated.winningMethod).toBe('browser_escalation');
    expect(escalated.notes.join(' ')).toMatch(/escalation started because/i);
  });

  it('31. UNKNOWN stays UNKNOWN, with every refusal recorded', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        lane({ id: 'gis', method: 'direct_gis_api', delayMs: 1, produce: () => [] }),
        lane({ id: 'web', delayMs: 2, produce: () => [evidence({ laneId: 'web', code: 'R-20', currentness: 'historical' })] }),
        lane({ id: 'docs', method: 'official_document', delayMs: 3, produce: () => [evidence({ laneId: 'docs', code: 'R-20', parcelMatchBasis: null })] }),
      ],
    });
    expect(result.released).toBe(false);
    expect(result.winner).toBeNull();
    expect(result.lanes.find((row) => row.laneId === 'web')?.note).toMatch(/historical/);
    expect(result.lanes.find((row) => row.laneId === 'docs')?.note).toMatch(/no basis for applying to this parcel/);
  });

  it('a lane that throws is a recorded outcome, not a failed question', async () => {
    const result = await raceLandUseSources<District, Record<string, unknown>>({
      question: 'current_zoning',
      aim: {},
      gate,
      lanes: [
        { id: 'boom', method: 'direct_gis_api', label: 'boom', run: async () => { throw new Error('endpoint down'); } },
        lane({ id: 'web', delayMs: 5, produce: () => [evidence({ laneId: 'web', code: 'RS-15' })] }),
      ],
    });
    expect(result.released).toBe(true);
    expect(result.lanes.find((row) => row.laneId === 'boom')?.status).toBe('error');
    expect(result.lanes.find((row) => row.laneId === 'boom')?.note).toMatch(/endpoint down/);
  });
});

// ── Source authority and jurisdiction ranking ───────────────────────────────

const FAIRVIEW = { municipality: 'Fairview', county: 'Williamson', state: 'TN' };

describe('source authority ranking', () => {
  it("14. the controlling government outranks an unrelated government domain", () => {
    const controlling = rankSourceForAuthority('https://www.fairview-tn.org/zoning', { ...FAIRVIEW, controllingAuthorityName: 'Fairview' });
    const county = rankSourceForAuthority('https://www.williamsoncounty-tn.gov/planning', { ...FAIRVIEW, controllingAuthorityName: 'Fairview' });
    const state = rankSourceForAuthority('https://www.tn.gov/planning', { ...FAIRVIEW, controllingAuthorityName: 'Fairview' });

    expect(controlling.relation).toBe('controlling_government');
    expect(controlling.rank).toBeLessThan(county.rank);
    expect(county.rank).toBeLessThan(state.rank);
    expect([controlling, county, state].every((row) => row.usable)).toBe(true);
  });

  it('15. another city inside the same state is refused', () => {
    const other = rankSourceForAuthority('https://www.franklintn.gov/zoning', { ...FAIRVIEW, controllingAuthorityName: 'Fairview' });
    expect(other.relation).toBe('unrelated_government');
    expect(other.usable).toBe(false);
    expect(other.reason).toMatch(/not jurisdiction over this parcel/i);
    expect(hostServesSubjectJurisdiction('https://www.franklintn.gov/zoning', FAIRVIEW)).toBe(false);
  });

  it('16. another state government is refused however official it looks', () => {
    const other = rankSourceForAuthority('https://sudbury.ma.us/planning/rules', { ...FAIRVIEW, controllingAuthorityName: 'Fairview' });
    expect(other.usable).toBe(false);
    expect(governmentSourceTier({ url: 'https://sudbury.ma.us/planning/rules' })).toBe('official_government_source');
    // Official, and still refused: officiality is not jurisdiction.
    expect(hostServesSubjectJurisdiction('https://sudbury.ma.us/planning/rules', FAIRVIEW)).toBe(false);
  });

  it("recognises a government's contracted code publisher when it names the jurisdiction", () => {
    const url = 'https://library.municode.com/tn/fairview/codes/code_of_ordinances';
    expect(governmentSourceTier({ url, pageText: 'Fairview, Tennessee Code of Ordinances', ...FAIRVIEW }))
      .toBe('official_government_source');
    // But never on the domain alone.
    expect(governmentSourceTier({ url: 'https://library.municode.com/tn/somewhere_else/codes', pageText: 'nothing relevant', ...FAIRVIEW }))
      .toBe('reputable_secondary');
    expect(hostServesSubjectJurisdiction(url, FAIRVIEW)).toBe(true);
  });

  it("recognises a municipal .org site from the page's own words", () => {
    expect(governmentSourceTier({
      url: 'https://www.fairview-tn.org/depts/planning',
      pageText: 'The City of Fairview Planning and Codes Department',
      ...FAIRVIEW,
    })).toBe('official_government_source');
    // A commercial site that merely contains the town's name is not the town.
    expect(governmentSourceTier({
      url: 'https://fairview-realty.com/listings',
      pageText: 'Homes for sale in Fairview',
      ...FAIRVIEW,
    })).toBe('reputable_secondary');
  });
});

// ── Query construction ──────────────────────────────────────────────────────

describe('land-use query construction', () => {
  it('13. queries are built from the confirmed parcel identity', () => {
    const queries = buildLandUseQueries({
      subject: {
        apn: '042 123.00',
        canonicalApn: '042-123.00-000',
        parcelNotation: 'Map 042 Parcel 123',
        notationParts: { map: '42', parcel: '123' },
        owner: 'Landsouth, LLC',
        projectName: 'Kingwood Subdivision',
        address: null,
        road: 'Kingwood Blvd',
        municipality: 'Fairview',
        county: 'Williamson',
        state: 'TN',
        officialHosts: ['www.fairview-tn.org'],
      },
      topic: 'zoning',
      variants: ['zoning map', 'zoning map PDF', 'GIS zoning'],
    });

    const joined = queries.join('\n');
    expect(joined).toMatch(/"042 123\.00" Fairview TN zoning/);
    expect(joined).toMatch(/"042-123\.00-000" Fairview TN zoning/);
    expect(joined).toMatch(/"Map 42" "Parcel 123" Fairview TN zoning/);
    expect(joined).toMatch(/"Kingwood Blvd" Fairview TN zoning/);
    expect(joined).toMatch(/"Landsouth, LLC" Fairview TN zoning/);
    expect(joined).toMatch(/"Kingwood Subdivision" zoning/);
    expect(joined).toMatch(/site:www\.fairview-tn\.org/);
    expect(joined).toMatch(/Fairview TN zoning map PDF/);
    // Parcel-anchored forms come first: they can return a parcel-specific record.
    expect(queries[0]).toMatch(/042 123\.00/);
  });

  it('degrades to what the subject actually carries, with nothing invented', () => {
    const queries = buildLandUseQueries({
      subject: {
        apn: null, parcelNotation: null, owner: null, projectName: null, address: null,
        municipality: null, county: 'Perry', state: 'TN',
      },
      topic: 'subdivision regulations',
    });
    expect(queries.every((query) => !query.includes('null'))).toBe(true);
    expect(queries.join('\n')).toMatch(/Perry County TN subdivision regulations/);
  });
});

// ── The web lane, end to end against fakes ──────────────────────────────────

function htmlFetch(pages: Record<string, string>): { fetchText: GovFetchText; calls: string[] } {
  const calls: string[] = [];
  const fetchText: GovFetchText = async (url) => {
    calls.push(url);
    const body = pages[url];
    return {
      url, status: body ? 200 : 404, body: body ?? '',
      contentType: 'text/html', blocked: !body, blockedReason: body ? null : 'not found',
    } as unknown as GovTextResponse;
  };
  return { fetchText, calls };
}

describe('indexed web search lane', () => {
  const read = (document: SourceDocument): Array<LandUseEvidence<District>> => {
    const match = /\bzoned\s+([A-Z]{1,3}-?\d{0,3})\b/i.exec(document.text);
    if (!match) return [];
    return [{
      method: 'indexed_web_search',
      laneId: 'web',
      value: { code: match[1] },
      authorityName: 'Fairview',
      sourceLabel: document.title ?? document.url,
      sourceUrl: document.url,
      sourceTier: document.tier,
      parcelMatchBasis: 'the page names this parcel',
      currentness: 'current',
      effectiveOrAsOf: null,
      quote: match[0],
      retrievedAt: document.retrievedAt,
    }];
  };

  it('17. a search snippet alone can never establish an answer; the source must', async () => {
    const search: IdentitySearchProvider = async () => [
      { title: 'Parcel 042 123.00 is zoned RS-15', url: 'https://www.fairview-tn.org/parcel', snippet: 'zoned RS-15' },
    ];
    // The page itself carries nothing: the snippet said it, the source did not.
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/parcel': '<html><title>Fairview</title><body>City of Fairview planning</body></html>' });
    const laneUnderTest = indexedWebSearchLane<District>({
      queries: ['x'], jurisdiction: FAIRVIEW, search, read, transports: { fetchText },
    });
    const found = await laneUnderTest.run(FAIRVIEW, { elapsedMs: () => 0, released: () => false });
    expect(found).toEqual([]);
  });

  it('20. an official source discovered by web search establishes the answer', async () => {
    const search: IdentitySearchProvider = async () => [
      { title: 'Zoning', url: 'https://www.fairview-tn.org/zoning-record', snippet: '' },
    ];
    const { fetchText } = htmlFetch({
      'https://www.fairview-tn.org/zoning-record': '<html><title>City of Fairview zoning record</title><body>The City of Fairview Planning Commission record: parcel 042 123.00 is zoned RS-15.</body></html>',
    });
    const laneUnderTest = indexedWebSearchLane<District>({
      queries: ['x'], jurisdiction: FAIRVIEW, search, read, transports: { fetchText },
    });
    const found = await laneUnderTest.run(FAIRVIEW, { elapsedMs: () => 0, released: () => false });
    expect(found).toHaveLength(1);
    expect(found[0].value.code).toBe('RS-15');
    expect(found[0].sourceTier).toBe('official_government_source');
    expect(gate(found[0]).sufficient).toBe(true);
  });

  it('never opens an out-of-jurisdiction result, however official', async () => {
    const opened: string[] = [];
    const search: IdentitySearchProvider = async () => [
      { title: 'Sudbury zoning', url: 'https://sudbury.ma.us/zoning', snippet: '' },
      { title: 'Franklin zoning', url: 'https://www.franklintn.gov/zoning', snippet: '' },
    ];
    const fetchText: GovFetchText = async (url) => {
      opened.push(url);
      throw new Error('should not be reached');
    };
    const notes: string[] = [];
    const laneUnderTest = indexedWebSearchLane<District>({
      queries: ['x'], jurisdiction: FAIRVIEW, search, read, transports: { fetchText }, onNote: (note) => notes.push(note),
    });
    const found = await laneUnderTest.run(FAIRVIEW, { elapsedMs: () => 0, released: () => false });
    expect(opened).toEqual([]);
    expect(found).toEqual([]);
    expect(notes.join(' ')).toMatch(/does not serve this parcel's jurisdiction/);
  });

  it('runs its queries concurrently rather than one round trip at a time', async () => {
    const started: number[] = [];
    const search: IdentitySearchProvider = async () => {
      started.push(Date.now());
      await sleep(60);
      return [];
    };
    const laneUnderTest = indexedWebSearchLane<District>({
      queries: ['a', 'b', 'c', 'd'], jurisdiction: FAIRVIEW, search, read,
    });
    const began = Date.now();
    await laneUnderTest.run(FAIRVIEW, { elapsedMs: () => 0, released: () => false });
    // Four 60ms queries, serially, would be 240ms.
    expect(Date.now() - began).toBeLessThan(180);
    expect(started).toHaveLength(4);
  });
});

describe('retained evidence lane', () => {
  it('settles without any transport at all', async () => {
    const laneUnderTest = retainedEvidenceLane<District>({
      sources: [{ url: 'https://www.fairview-tn.org/packet.pdf', title: 'City of Fairview', text: 'Current Zoning: R-20 POD.' }],
      jurisdiction: FAIRVIEW,
      read: (document) => [{
        method: 'retained_evidence', laneId: 'retained', value: { code: 'R-20 POD' },
        authorityName: 'Fairview', sourceLabel: document.title ?? '', sourceUrl: document.url,
        sourceTier: document.tier, parcelMatchBasis: 'retained subject-anchored finding',
        currentness: 'historical', effectiveOrAsOf: 'December 10, 2024',
        quote: document.text, retrievedAt: document.retrievedAt,
      }],
    });
    const found = await laneUnderTest.run(FAIRVIEW, { elapsedMs: () => 0, released: () => false });
    expect(found).toHaveLength(1);
    // Historical: retained, and correctly not sufficient for a current answer.
    expect(gate(found[0]).sufficient).toBe(false);
  });
});


// ── Web search is a FIRST-CLASS method in every subsystem ───────────────────

const PLANNING_PAGE = `<html><title>City of Fairview Planning and Codes</title><body>
  <p>The City of Fairview administers zoning within its corporate limits under the Fairview Zoning Ordinance.</p>
  <p>Subdivision Regulations of Fairview, Tennessee are administered by the Fairview Municipal Planning Commission.</p>
</body></html>`;

const ZONING_RECORD_PAGE = `<html><title>City of Fairview parcel zoning record</title><body>
  <p>City of Fairview Zoning Ordinance property record.</p>
  <p>Parcel 042 123.00 &mdash; Zoning: RS-15</p>
</body></html>`;

const ORDINANCE_PAGE = `<html><title>Fairview Zoning Ordinance</title><body>
  <p>Zoning Ordinance of the City of Fairview, Tennessee. Adopted June 2, 2018.</p>
  <p>Section 4-101 RS-15 Residential Suburban District.</p>
  <p>Permitted uses in the RS-15 district shall be single-family dwelling units, public parks and agriculture.</p>
  <p>Minimum lot size shall be fifteen thousand (15,000) square feet.</p>
  <p>Minimum lot frontage shall be one hundred (100) feet.</p>
  <p>Section 4-201 R-20 Residential District. Minimum lot size shall be twenty thousand (20,000) square feet.</p>
</body></html>`;

const SUBDIVISION_PAGE = `<html><title>Subdivision Regulations of Fairview</title><body>
  <p>Subdivision Regulations of Fairview, Tennessee. Adopted March 4, 2019.</p>
  <p>Section 2-110 Minor Subdivision A division of land into not more than three lots fronting on an existing public road.</p>
  <p>Section 2-111 Major Subdivision A division of land into four or more lots.</p>
  <p>Section 4-101 Minimum lot size shall be one (1) acre where public sewer is not available.</p>
  <p>Section 4-102 Minimum lot frontage shall be two hundred (200) feet on a public road.</p>
  <p>Section 5-101 New streets shall be constructed to conform to the city road standard.</p>
  <p>Section 6-101 The Planning Commission shall review and approve all preliminary plats.</p>
</body></html>`;

const FAIRVIEW_AUTHORITY = {
  name: 'Fairview', level: 'municipal' as const, determination: 'confirmed' as const,
  basis: 'official source', sources: [], competingClaims: [],
};

describe('web search is a first-class method throughout', () => {
  it('1. controlling authority: a web-discovered official page establishes it', async () => {
    const queries: string[] = [];
    const search: IdentitySearchProvider = async (query) => {
      queries.push(query);
      return [{ title: 'Planning', url: 'https://www.fairview-tn.org/planning', snippet: '' }];
    };
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/planning': PLANNING_PAGE });

    const authority = await resolveControllingLandUseAuthority(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN', apn: '042 123.00', address: null },
      { search, fetchText, now: () => '2026-08-15T00:00:00.000Z' },
    );

    expect(queries.length).toBeGreaterThan(0);
    expect(authority.zoningAuthority.name).toBe('Fairview');
    expect(authority.zoningAuthority.determination).toBe('confirmed');
    expect(authority.subdivisionAuthority.name).toBe('Fairview');
    // The web lane is a declared method of the race, not a fallback branch.
    expect(authority.race?.lanes.map((lane) => lane.method)).toContain('indexed_web_search');
    expect(authority.race?.winningMethod).toBe('indexed_web_search');
  });

  it('2. current zoning: web discovery wins when no GIS layer exists', async () => {
    const queries: string[] = [];
    const search: IdentitySearchProvider = async (query) => {
      queries.push(query);
      return [{ title: 'Zoning record', url: 'https://www.fairview-tn.org/zoning-record', snippet: '' }];
    };
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/zoning-record': ZONING_RECORD_PAGE });

    const zoning = await determineCurrentZoning(
      { dealCardId: 1, apn: '042 123.00', address: null, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      // No gisQueries at all: ArcGIS absence must not end discovery.
      { search, fetchText, now: () => '2026-08-15T00:00:00.000Z' },
    );

    expect(zoning.established).toBe(true);
    expect(zoning.districtCode).toBe('RS-15');
    expect(zoning.race?.winningMethod).toBe('indexed_web_search');
    expect(queries.join('\n')).toMatch(/042 123\.00/);
    // 22. The missing GIS lane is reported, not treated as a terminal failure.
    expect(zoning.limitations.join(' ')).toMatch(/Discovery continued on every other method/);
  });

  it('3. allowed uses and dimensional standards: web discovery establishes them', async () => {
    const search: IdentitySearchProvider = async () => [
      { title: 'Zoning ordinance', url: 'https://www.fairview-tn.org/zoning-ordinance', snippet: '' },
    ];
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/zoning-ordinance': ORDINANCE_PAGE });

    const standards = await researchZoningStandards(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN', officialHosts: ['www.fairview-tn.org'] },
      { established: true, districtCode: 'RS-15' } as never,
      FAIRVIEW_AUTHORITY,
      { search, fetchText, now: () => '2026-08-15T00:00:00.000Z' },
    );

    expect(standards.established).toBe(true);
    expect(standards.standards.minimumLotSize).toMatch(/15,000/);
    expect(standards.standards.frontage).toMatch(/100/);
    // The wrong district's number must never leak in.
    expect(JSON.stringify(standards.standards)).not.toMatch(/20,000/);
    expect(standards.allowedUses.some((use) => use.status === 'permitted' && /single-family/i.test(use.use))).toBe(true);
    expect(standards.allowedUses[0].section).toMatch(/4-101|Section/);
    expect(standards.race?.winningMethod).toBe('indexed_web_search');
  });

  it('4. subdivision regulations: web discovery establishes the rule set', async () => {
    const search: IdentitySearchProvider = async () => [
      { title: 'Subdivision regulations', url: 'https://www.fairview-tn.org/subdivision', snippet: '' },
    ];
    const { fetchText } = htmlFetch({ 'https://www.fairview-tn.org/subdivision': SUBDIVISION_PAGE });

    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      { search, fetchText, now: () => '2026-08-15T00:00:00.000Z' },
    );

    expect(regulations.rules.length).toBeGreaterThan(4);
    expect(regulations.thresholds.statedMaxMinorLots).toBe(3);
    expect(regulations.race?.winningMethod).toBe('indexed_web_search');
    expect(regulations.documents[0].adoptedOrAsOf).toBe('March 4, 2019');
  });

  it('21. a direct ArcGIS layer establishes zoning and beats the web lane', async () => {
    let webOpened = 0;
    const search: IdentitySearchProvider = async () => {
      await sleep(120);
      webOpened += 1;
      return [];
    };
    const zoning = await determineCurrentZoning(
      { dealCardId: 1, apn: '042 123.00', address: null, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      {
        gisQueries: [{ layerUrl: 'https://gis.fairview-tn.gov/arcgis/rest/services/Zoning/MapServer/0', apn: '042 123.00', apnField: 'PARCELID', layerLabel: 'Zoning Districts' }],
        arcgis: {
          fetch: async (url: string) => ({
            status: 200, contentType: 'application/json', url,
            body: JSON.stringify({ features: [{ attributes: { PARCELID: '042 123.00', ZONING: 'RS-15' } }] }),
          }),
        },
        search,
        fetchText: htmlFetch({}).fetchText,
        // Do not wait for the slow web lane before returning.
        awaitEnrichment: false,
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(zoning.established).toBe(true);
    expect(zoning.race?.winningMethod).toBe('direct_gis_api');
    expect(zoning.race?.pendingAtRelease).toContain('zoning_web');
    expect(webOpened).toBe(0);
  });

  it('18. a search snippet alone can never establish a subdivision rule', async () => {
    const search: IdentitySearchProvider = async () => [
      { title: 'Fairview minor subdivision is three lots', url: 'https://example.com/blog', snippet: 'minor subdivision means not more than three lots' },
    ];
    const opened: string[] = [];
    const fetchText: GovFetchText = async (url) => { opened.push(url); throw new Error('should not be reached'); };
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      { search, fetchText, now: () => '2026-08-15T00:00:00.000Z' },
    );
    expect(opened).toEqual([]);
    expect(regulations.rules).toEqual([]);
    expect(regulations.thresholds.statedMaxMinorLots).toBeNull();
  });

  it('19. an official PDF discovered by web search establishes a standard', async () => {
    const ordinance = 'Zoning Ordinance of the City of Fairview, Tennessee. Adopted June 2, 2018. '
      + 'Section 4-101 RS-15 Residential Suburban District. '
      + 'Permitted uses shall be single-family dwelling units. '
      + 'Minimum lot size shall be fifteen thousand (15,000) square feet.';
    const opened: string[] = [];
    const search: IdentitySearchProvider = async () => [
      { title: 'Zoning ordinance', url: 'https://www.fairview-tn.org/zoning.pdf', snippet: '' },
    ];
    const standards = await researchZoningStandards(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      { established: true, districtCode: 'RS-15' } as never,
      FAIRVIEW_AUTHORITY,
      {
        search,
        loadPdf: async (url: string) => {
          opened.push(url);
          return { url, fetchedAt: '2026-08-15T00:00:00.000Z', byteLength: 100, pages: [ordinance], text: ordinance, textLayer: true, fromCache: false };
        },
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(opened).toEqual(['https://www.fairview-tn.org/zoning.pdf']);
    expect(standards.established).toBe(true);
    expect(standards.standards.minimumLotSize).toMatch(/15,000/);
    expect(standards.documents[0].adoptedOrAsOf).toBe('June 2, 2018');
  });

  it('27. the newer adopted value governs and the older is retained as history', async () => {
    const older = 'Zoning Ordinance of the City of Fairview. Adopted June 2, 2018. Section 4-101 RS-15 Residential District. Minimum lot size shall be two (2) acres. Permitted uses shall be single-family dwellings.';
    const newer = 'Zoning Ordinance of the City of Fairview. Amended March 9, 2021. Section 4-101 RS-15 Residential District. Minimum lot size shall be one (1) acre. Permitted uses shall be single-family dwellings.';
    const standards = await researchZoningStandards(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      { established: true, districtCode: 'RS-15' } as never,
      FAIRVIEW_AUTHORITY,
      {
        // Deliberately OLDER first, so ordering cannot be what saves it.
        retainedSources: [
          { url: 'https://www.fairview-tn.org/zoning-2018.pdf', title: 'Fairview Zoning Ordinance 2018', text: older },
          { url: 'https://www.fairview-tn.org/zoning-2021.pdf', title: 'Fairview Zoning Ordinance 2021', text: newer },
        ],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(standards.standards.minimumLotSize).toMatch(/one \(1\) acre/);
    expect(standards.supersededHistory).toHaveLength(1);
    expect(standards.supersededHistory[0].value).toMatch(/two \(2\) acres/);
    expect(standards.supersededHistory[0].supersededBy).toMatch(/one \(1\) acre/);
    // Superseded, not contradictory: nothing here is a conflict.
    expect(standards.conflicts).toEqual([]);
  });

  it('two undated adopted sources that disagree remain an explicit conflict', async () => {
    const standards = await researchZoningStandards(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      { established: true, districtCode: 'RS-15' } as never,
      FAIRVIEW_AUTHORITY,
      {
        retainedSources: [
          { url: 'https://www.fairview-tn.org/a.pdf', title: 'Fairview Zoning Ordinance', text: 'Zoning Ordinance of the City of Fairview. Section 4-101 RS-15 Residential District. Minimum lot size shall be two (2) acres.' },
          { url: 'https://www.fairview-tn.org/b.pdf', title: 'Fairview Zoning Ordinance', text: 'Zoning Ordinance of the City of Fairview. Section 4-101 RS-15 Residential District. Minimum lot size shall be one (1) acre.' },
        ],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(standards.conflicts.join(' ')).toMatch(/neither is clearly newer/);
    expect(standards.supersededHistory).toEqual([]);
  });

  it('29. allowed-use research refuses to run without an established district', async () => {
    let searched = 0;
    const standards = await researchZoningStandards(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      // Current zoning unresolved: there is no district to look up.
      { established: false, districtCode: null } as never,
      FAIRVIEW_AUTHORITY,
      { search: async () => { searched += 1; return []; }, now: () => '2026-08-15T00:00:00.000Z' },
    );
    expect(standards.established).toBe(false);
    expect(standards.allowedUses).toEqual([]);
    expect(searched).toBe(0);
    expect(standards.limitations.join(' ')).toMatch(/would produce the wrong numbers/);
    expect(standards.limitations.join(' ')).toMatch(/no historical district was offered for context/);
  });

  it('a historical district may be researched for CONTEXT and never reads as current', async () => {
    const ordinance = 'Zoning Ordinance of the City of Fairview, Tennessee. Adopted June 2, 2018. '
      + 'Section 4-201 R-20 POD Residential District. '
      + 'Permitted uses shall be single-family dwelling units. '
      + 'Minimum lot size shall be twenty thousand (20,000) square feet.';
    const standards = await researchZoningStandards(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      // Current zoning UNRESOLVED.
      { established: false, districtCode: null } as never,
      FAIRVIEW_AUTHORITY,
      {
        contextDistrict: 'R-20 POD',
        retainedSources: [{ url: 'https://www.fairview-tn.org/zoning.pdf', title: 'Fairview Zoning Ordinance', text: ordinance }],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    // Real rules for a real district — and still not established for this parcel.
    expect(standards.standards.minimumLotSize).toMatch(/20,000/);
    expect(standards.contextOnly).toBe(true);
    expect(standards.established).toBe(false);
    expect(standards.limitations.join(' ')).toMatch(/CONTEXT ONLY/);
    expect(standards.limitations.join(' ')).toMatch(/NOT an input to lot yield/);
  });

  it("finds the ordinance block when the packet spells the district differently", () => {
    // The packet's PDF text layer prints "R - 20 POD"; the ordinance heading
    // says "R-20". Without the variants the block is never found and the
    // district's real standards read as missing.
    expect(districtCodeVariants('R - 20 POD')).toEqual(['R - 20 POD', 'R - 20', 'R-20']);
    const ordinance = 'Zoning Ordinance of the City of Fairview. Section 4-201 R-20 Residential District. Minimum lot size shall be twenty thousand (20,000) square feet.';
    expect(scopeToDistrictBlock(ordinance, 'R - 20 POD')?.text).toMatch(/20,000/);
  });

  it('24 + 25. historical and requested zoning survive the race unchanged', async () => {
    const zoning = attachHistoricalZoning(
      await determineCurrentZoning(
        { dealCardId: 1, apn: '042 123.00', address: null, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
        FAIRVIEW_AUTHORITY,
        {
          retainedSources: [{
            url: 'https://www.fairview-tn.org/packet.pdf',
            title: 'City of Fairview Planning Commission',
            text: 'Parcel 042 123.00. Current Zoning: R-20 POD. Requested Zoning: RS-15 POD.',
          }],
          now: () => '2026-08-15T00:00:00.000Z',
        },
      ),
      [
        { kind: 'stated_as_current_at_the_time', value: 'R-20 POD', asOf: 'December 10, 2024', sourceUrl: 'https://www.fairview-tn.org/packet.pdf', page: 1, quote: 'Current Zoning: R-20 POD.', neverEstablishesCurrentZoning: true },
        { kind: 'requested', value: 'RS-15 POD', asOf: 'December 10, 2024', sourceUrl: 'https://www.fairview-tn.org/packet.pdf', page: 1, quote: 'Requested Zoning: RS-15 POD.', neverEstablishesCurrentZoning: true },
      ],
    );
    expect(zoning.historicalReferences).toHaveLength(1);
    expect(zoning.requestedZoning).toHaveLength(1);
    expect(zoning.requestedZoning[0].value).toBe('RS-15 POD');
    // A retained packet is subject-anchored, so the race sees a candidate — and
    // the district it names must still not become the current one on age alone.
    for (const reference of zoning.historicalReferences) {
      expect(reference.neverEstablishesCurrentZoning).toBe(true);
    }
  });

  it('24b. a planning packet cannot establish current zoning, however precisely it names the parcel', async () => {
    // The live regression, held permanently. This packet is official, current
    // enough to be retained, and states the district beside the APN — and it is
    // still a 2024 agenda item, not the 2026 district.
    const packet = 'City of Fairview Planning Commission packet. PC Resolution PC-44-24. '
      + 'Parcel 042 123.00. Zoning: R-20 POD. Requested Zoning: RS-15 POD.';
    expect(classifyZoningDocument({
      url: 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf',
      title: 'City of Fairview',
      text: packet,
    })).toBe('historical_planning_document');
    expect(classifyZoningDocument({
      url: 'https://www.fairview-tn.org/zoning-map.pdf', title: 'Fairview Zoning Map', text: 'zoning map',
    })).toBe('official_zoning_map');

    const zoning = await determineCurrentZoning(
      { dealCardId: 1, apn: '042 123.00', address: null, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      {
        retainedSources: [{
          url: 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf',
          title: 'City of Fairview',
          text: packet,
        }],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(zoning.established).toBe(false);
    expect(zoning.districtCode).toBeNull();
    expect(zoning.consideredEvidence.some((row) => /historical planning document/i.test(row.note))).toBe(true);
  });

  it('a planning packet is not the subdivision regulations', async () => {
    // The second half of the same live regression: the packet was fed to the
    // subdivision retrieval and yielded three sentences that read like rules.
    expect(looksLikeRegulationDocument({
      url: 'https://www.fairview-tn.org/content/uploads/boc-packets/packet-planningcommission-01-14-2025.pdf',
      title: 'City of Fairview',
      text: 'PC Resolution PC-44-24. Regular Meeting. Subdivision plat discussed. The plat shall be recorded.',
    })).toBe(false);
    expect(looksLikeRegulationDocument({
      url: 'https://www.fairview-tn.org/docs/FAIRVIEW-SUBDIVISION-REGULATIONS.pdf',
      title: 'Fairview Subdivision Regulations',
      text: 'Subdivision Regulations of Fairview, Tennessee.',
    })).toBe(true);

    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      {
        knownDocumentUrls: ['https://www.fairview-tn.org/content/uploads/boc-packets/packet.pdf'],
        loadPdf: async (url: string) => ({
          url, fetchedAt: '2026-08-15T00:00:00.000Z', byteLength: 100,
          pages: ['PC Resolution PC-44-24 Regular Meeting. The plat shall be recorded with the register of deeds. Minimum lot size shall be one (1) acre.'],
          text: 'PC Resolution PC-44-24 Regular Meeting. The plat shall be recorded with the register of deeds. Minimum lot size shall be one (1) acre.',
          textLayer: true, fromCache: false,
        }),
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(regulations.rules).toEqual([]);
    expect(regulations.documents).toEqual([]);
  });

  it('26. a proposed regulation never outranks the adopted one in a race', async () => {
    const proposed = 'PROPOSED SUBDIVISION REGULATIONS ARTICLE I. Section 1-101 Minor Subdivision A division of land into not more than eight lots. Minimum lot size shall be five (5) acres.';
    const adopted = 'Subdivision Regulations of Fairview, Tennessee. Adopted March 4, 2019. Section 2-110 Minor Subdivision A division of land into not more than three lots. Section 4-101 Minimum lot size shall be one (1) acre. Section 5-101 New streets shall be constructed to conform to the standard. Section 6-101 The Planning Commission shall review and approve all preliminary plats. Section 7-101 The plat shall be recorded with the register of deeds.';
    const regulations = await retrieveSubdivisionRegulations(
      { dealCardId: 1, municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      FAIRVIEW_AUTHORITY,
      {
        suppliedDocuments: [
          { label: 'Proposed regs', url: 'https://www.fairview-tn.org/proposed.pdf', text: proposed, tier: 'official_government_source' },
          { label: 'Adopted regs', url: 'https://www.fairview-tn.org/adopted.pdf', text: adopted, tier: 'official_government_source' },
        ],
        now: () => '2026-08-15T00:00:00.000Z',
      },
    );
    expect(readMinorMajorThresholds(regulations.rules).statedMaxMinorLots).toBe(3);
    expect(regulations.rules.find((rule) => rule.key === 'minimum_lot_size')?.value).toMatch(/one \(1\) acre/);
  });
});

describe('retained official public-record determinations reach the current zoning', () => {
  const now = '2026-09-05T00:00:00.000Z';
  const atlasOutcome = {
    category: 'current zoning',
    title: 'Zoning district read from the Bradford County Official Zoning Atlas (updated April 2026): AGRICULTURAL-2',
    authority: 'Bradford County Board of County Commissioners, Official Zoning Atlas',
    retrieval_status: 'retrieved_yes',
    summary: 'The subject (19554 NW 137th Ln, Lot 34 River Oak Plantation, APN 00083A03400) lies in unincorporated Bradford County; the block carries the AGRICULTURAL-2 fill on the county atlas.',
    facts: { zoningDistrict: 'AGRICULTURAL-2', mapTitle: 'Bradford County Official Zoning Atlas, Updated April 2026', evidenceWeight: 'well_supported' },
    source_url: 'https://bradfordcounty.app.box.com/s/fyulxlt5rkcijfq5kfcrko0058lpuhq6',
    document_url: null,
    searched_at: '2026-09-05T00:02:00.000Z',
  };

  it('turns a retrieved district outcome that names the parcel into an official-map candidate', () => {
    const rows = zoningDeterminationsFromPublicRecords([atlasOutcome], { apn: '00083A03400', address: '19554 NW 137th Ln' }, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'official_zoning_map', districtCode: 'AGRICULTURAL-2', sourceTier: 'official_government_source', retrievedAt: '2026-09-05T00:02:00.000Z' });
    expect(rows[0].parcelMatchBasis).toMatch(/APN 00083A03400/);
    expect(rows[0].quote).toMatch(/well supported/);
    // A municipal zoning LAYER read is parcel-level GIS evidence.
    const layer = zoningDeterminationsFromPublicRecords([{
      ...atlasOutcome, category: 'current zoning', summary: 'Parcel 046 05000 (7348 OVERBEY RD) returns Zoning RS40 on the city layer.',
      facts: { zoningLayerDesignation: 'RS40', layer: 'https://services6.arcgis.com/x/arcgis/rest/services/Fairview_Zoning_Public/FeatureServer/0', parcelReference: 'MP 046 05000 (APN 046-050.00-000)' },
    }], { apn: '046-050.00-000', address: '7348 Overby Rd, Fairview, TN 37062' }, now);
    expect(layer[0]).toMatchObject({ kind: 'parcel_zoning_gis', districtCode: 'RS40' });
  });

  it('refuses an index-only outcome, a district-less outcome, and one that never names the parcel', () => {
    expect(zoningDeterminationsFromPublicRecords([{ ...atlasOutcome, retrieval_status: 'retrieved_no' }], { apn: '00083A03400', address: null }, now)).toEqual([]);
    expect(zoningDeterminationsFromPublicRecords([{ ...atlasOutcome, facts: {} }], { apn: '00083A03400', address: null }, now)).toEqual([]);
    expect(zoningDeterminationsFromPublicRecords([atlasOutcome], { apn: '99999X99999', address: '1 Other Rd' }, now)).toEqual([]);
  });

  it('establishes the district from the retained determination with its official lineage', async () => {
    const [candidate] = zoningDeterminationsFromPublicRecords([atlasOutcome], { apn: '00083A03400', address: '19554 NW 137th Ln' }, now);
    const search: IdentitySearchProvider = async () => [];
    const fetchText: GovFetchText = async (url) => ({
      url, status: 404, body: '', contentType: 'text/html', blocked: true, blockedReason: 'not found',
    } as unknown as GovTextResponse);
    const zoning = await determineCurrentZoning(
      { dealCardId: 90, apn: '00083A03400', address: '19554 NW 137th Ln', municipality: null, county: 'Bradford', state: 'FL' },
      { name: 'Bradford County', level: 'county' as const, determination: 'confirmed' as const, basis: 'official boundary', sources: [], competingClaims: [] },
      { search, fetchText, retainedDeterminations: [candidate], now: () => now },
    );
    expect(zoning.established).toBe(true);
    expect(zoning.districtCode).toBe('AGRICULTURAL-2');
    expect(zoning.race?.winningMethod).toBe('retained_evidence');
    expect(JSON.stringify(zoning)).toMatch(/Official Zoning Atlas/);
  });
});
