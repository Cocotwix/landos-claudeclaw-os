// LandOS — Geography-scoped market capabilities.
//
// PLACEMENTS, not new market engines. County Market Research, ZIP Market
// Research and Market Pulse already exist as engines (the Market Matrix read,
// the retained Market Research collection, and the Market Pulse read); these
// capabilities put them behind the shared capability contract so any caller —
// the Tools department, a Deal Card mission, a future orchestrator — invokes
// the same implementation with the same result semantics.
//
// Their declared prerequisites are geography, never a parcel: a county or ZIP
// question must not wait on (or manufacture) a property subject. Data gaps are
// reported honestly through the contract's facts/missingInformation; a number
// is never fabricated to make a standalone run look successful.

import type {
  CapabilityEvidenceReference,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  JsonObject,
  LandosCapability,
} from './capability-contract.js';
import {
  buildMarketMatrixReportSection,
  resolveMarketMatrix,
  type MarketMatrixResolution,
} from './market-matrix-read.js';
import {
  fetchAreaMarketContext,
  type MarketPulseRead,
  type RetainedCountyMarketRecord,
} from './market-pulse-read.js';

export const COUNTY_MARKET_RESEARCH_CAPABILITY_ID = 'county-market-research';
export const ZIP_MARKET_RESEARCH_CAPABILITY_ID = 'zip-market-research';
export const MARKET_PULSE_CAPABILITY_ID = 'market-pulse';

/** Injectable engine seams; live callers omit them and get the real engines. */
export interface MarketGeographyRuntime {
  resolveMatrix?: typeof resolveMarketMatrix;
  fetchAreaPulse?: typeof fetchAreaMarketContext;
}

interface GeographySubject {
  county?: string;
  state?: string;
  zip?: string;
  fips?: string;
}

/**
 * Operator input for a geography tool arrives as plain text ("Iredell County,
 * NC", "28115") or explicit fields. This parses the plain-text shapes without
 * ever pretending to resolve a parcel — locality scoping only.
 */
export function parseGeographyInput(raw: string): GeographySubject {
  const text = raw.trim();
  if (!text) return {};
  // A bare 5-digit number is an operator-typed ZIP, not a FIPS.
  const zipMatch = text.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
  if (zipMatch) return { zip: zipMatch[1] };
  // Engines render their own "County" suffix; a doubled one reads wrong.
  const bareCounty = (name: string) => name.replace(/\s+county$/i, '').trim();
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const stateRaw = parts[parts.length - 1];
    const state = stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw;
    const county = bareCounty(parts.slice(0, -1).join(', '));
    return { county, state };
  }
  return { county: bareCounty(text) };
}

function geographyOf(request: CapabilityInvocationRequest): GeographySubject {
  if (request.subject.kind !== 'geography') return {};
  const { county, state, zip, fips } = request.subject;
  return {
    county: county?.trim() || undefined,
    state: state?.trim() || undefined,
    zip: zip?.trim() || undefined,
    fips: fips?.trim() || undefined,
  };
}

function requireGeographySubject(request: CapabilityInvocationRequest, need: 'county' | 'zip'): void {
  if (request.subject.kind !== 'geography') {
    throw new Error('This market capability runs on geography (county/ZIP), not a property subject.');
  }
  const geo = geographyOf(request);
  if (need === 'county' && !geo.county && !geo.fips) {
    throw new Error('A county (with state) or county FIPS is required.');
  }
  if (need === 'zip' && !geo.zip) {
    throw new Error('A 5-digit ZIP is required.');
  }
}

function geographyLabel(geo: GeographySubject): string {
  if (geo.zip) return `ZIP ${geo.zip}`;
  const county = geo.county ?? geo.fips ?? 'unknown geography';
  return geo.state ? `${county}, ${geo.state}` : county;
}

function geographySessionRef(capabilityId: string, geo: GeographySubject) {
  const key = [geo.fips, geo.county, geo.state, geo.zip].filter(Boolean).join(':').toLowerCase();
  return {
    kind: 'research_session' as const,
    id: `geography:${capabilityId}:${key || 'unspecified'}`,
    temporary: true,
  };
}

function matrixEvidence(res: MarketMatrixResolution, nowIso: string): CapabilityEvidenceReference[] {
  if (!res.available) return [];
  return [{
    source: res.source ?? res.provider ?? 'LandOS Market Matrix',
    sourceType: 'market_matrix_snapshot',
    retrievedAt: nowIso,
    details: {
      resolvedKey: res.resolvedKey,
      resolvedKeyLabel: res.resolvedKeyLabel,
      period: res.period,
      side: res.side,
      provider: res.provider,
      confidence: res.confidence,
    },
  }];
}

function matrixFacts(res: MarketMatrixResolution): JsonObject {
  return {
    section: buildMarketMatrixReportSection(res) as unknown as JsonObject,
    resolution: {
      matchLevel: res.matchLevel,
      available: res.available,
      resolvedKey: res.resolvedKey,
      resolvedKeyLabel: res.resolvedKeyLabel,
      period: res.period,
      side: res.side,
      confidence: res.confidence,
      source: res.source,
      provider: res.provider,
      staleness: res.staleness as unknown as JsonObject,
      note: res.note,
    },
  };
}

/** Is the resolution's basis actually scoped to the geography the operator
 *  asked about? A record found under a WIDER key (e.g. statewide answering a
 *  county question) is still a found record, but it is never a county/ZIP fact
 *  and must never be attributed as one. */
function basisMatchesRequest(res: MarketMatrixResolution, requested: 'county' | 'zip'): boolean {
  if (!res.available) return false;
  return requested === 'county'
    ? res.matchLevel === 'county' || res.matchLevel === 'county_all_acreage'
      || res.matchLevel === 'zip' || res.matchLevel === 'zip_all_acreage'
    : res.matchLevel === 'zip' || res.matchLevel === 'zip_all_acreage';
}

function marketMatrixOutcome(input: {
  capabilityId: string;
  geo: GeographySubject;
  scopeLabel: string;
  requested: 'county' | 'zip';
  resolve: typeof resolveMarketMatrix;
  nowIso: string;
}): CapabilityExecutionOutcome<JsonObject> {
  const { geo, requested } = input;
  const sold = input.resolve({ state: geo.state, county: geo.county ?? geo.fips, zip: geo.zip, acreageBand: 'all', side: 'sold' });
  const forSale = input.resolve({ state: geo.state, county: geo.county ?? geo.fips, zip: geo.zip, acreageBand: 'all', side: 'for_sale' });
  const available = sold.available || forSale.available;
  const carrying = sold.available ? sold : forSale;
  const scoped = available && basisMatchesRequest(carrying, requested);
  const label = geographyLabel(geo);
  const requestedWord = requested === 'county' ? 'county' : 'ZIP';
  const summary = !available
    ? `${input.scopeLabel}: no retained Market Matrix data yet — honest data gap, nothing fabricated.`
    : scoped
      ? `${input.scopeLabel}: retained market data returned (${carrying.resolvedKeyLabel ?? 'matrix record'}).`
      : `${input.scopeLabel}: LandOS retains NO ${requestedWord}-level market data for ${label}. The figures shown are ${carrying.resolvedKeyLabel ?? 'a wider-geography record'} — a clearly wider basis, never a ${requestedWord} fact.`;
  const gaps = !available
    ? [`No retained Market Matrix snapshot covers ${label} yet.`]
    : scoped
      ? []
      : [`No ${requestedWord}-level snapshot is retained for ${label}; only the wider basis ${carrying.resolvedKeyLabel ?? carrying.resolvedKey ?? 'record'} exists.`];
  return {
    status: 'SUCCEEDED',
    subjectResolution: 'RESOLVED',
    canonicalSubject: geographySessionRef(input.capabilityId, geo),
    facts: {
      geography: { ...geo } as JsonObject,
      geographyLabel: label,
      outcome: !available ? 'no_retained_market_data' : scoped ? 'market_data_returned' : 'wider_basis_returned',
      sold: matrixFacts(sold),
      forSale: matrixFacts(forSale),
      summary,
    },
    evidence: [...matrixEvidence(sold, input.nowIso), ...matrixEvidence(forSale, input.nowIso)],
    warnings: [],
    missingInformation: gaps,
  };
}

export const COUNTY_MARKET_RESEARCH_CAPABILITY: LandosCapability<JsonObject, MarketGeographyRuntime> = {
  metadata: {
    id: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
    name: 'County Market Research',
    contractVersion: '1.1.0',
    description: 'Retained quantitative county market data (price per acre, days on market, sell-through, supply, population) from the Market Matrix. Needs only a county — never a parcel.',
  },
  validate(request) { requireGeographySubject(request, 'county'); },
  async execute(request, runtime) {
    const geo = geographyOf(request);
    return marketMatrixOutcome({
      capabilityId: COUNTY_MARKET_RESEARCH_CAPABILITY_ID,
      geo: { ...geo, zip: undefined },
      requested: 'county',
      scopeLabel: 'County Market Research',
      resolve: runtime.resolveMatrix ?? resolveMarketMatrix,
      nowIso: new Date().toISOString(),
    });
  },
};

export const ZIP_MARKET_RESEARCH_CAPABILITY: LandosCapability<JsonObject, MarketGeographyRuntime> = {
  metadata: {
    id: ZIP_MARKET_RESEARCH_CAPABILITY_ID,
    name: 'ZIP Market Research',
    contractVersion: '1.1.0',
    description: 'Retained local market-pocket data for a ZIP from the Market Matrix, widening honestly to county/state coverage when the ZIP itself has no snapshot. Needs only a ZIP.',
  },
  validate(request) { requireGeographySubject(request, 'zip'); },
  async execute(request, runtime) {
    const geo = geographyOf(request);
    return marketMatrixOutcome({
      capabilityId: ZIP_MARKET_RESEARCH_CAPABILITY_ID,
      geo,
      requested: 'zip',
      scopeLabel: 'ZIP Market Research',
      resolve: runtime.resolveMatrix ?? resolveMarketMatrix,
      nowIso: new Date().toISOString(),
    });
  },
};

export const MARKET_PULSE_CAPABILITY: LandosCapability<JsonObject, MarketGeographyRuntime> = {
  metadata: {
    id: MARKET_PULSE_CAPABILITY_ID,
    name: 'Market Pulse',
    contractVersion: '1.1.0',
    description: 'The county-current-signals read: growth direction, what land is generally going for, and development signals — always labeled as area context, never parcel-attributed. Needs only a county.',
  },
  validate(request) { requireGeographySubject(request, 'county'); },
  async execute(request, runtime) {
    const geo = geographyOf(request);
    const resolve = runtime.resolveMatrix ?? resolveMarketMatrix;
    const fetchPulse = runtime.fetchAreaPulse ?? fetchAreaMarketContext;
    const nowIso = new Date().toISOString();
    // The retained Market Research record answers the pulse's two headline
    // questions when the Census key or comps are absent — same rule the Deal
    // Card pulse follows, so both callers quote the same retained figures.
    const matrix = resolve({ state: geo.state, county: geo.county ?? geo.fips, zip: geo.zip, acreageBand: 'all', side: 'sold' });
    // A snapshot that answered from a WIDER geography (e.g. statewide carrying
    // a county question) is never handed to the pulse as "the retained county
    // record" — that wording would present statewide numbers as county facts.
    const retainedCounty: RetainedCountyMarketRecord | null = basisMatchesRequest(matrix, 'county')
      ? {
        population: matrix.metrics?.population ?? null,
        populationGrowth: matrix.metrics?.populationGrowth ?? null,
        medianPricePerAcre: matrix.metrics?.medianPricePerAcre ?? null,
        soldCount: matrix.metrics?.salesCount ?? null,
        period: matrix.period,
        resolvedVia: matrix.resolvedKeyLabel,
        provider: matrix.provider,
      }
      : null;
    const pulse: MarketPulseRead = await fetchPulse({
      county: geo.county,
      state: geo.state,
      zip: geo.zip,
      fips: geo.fips,
      retainedCounty,
    });
    const evidence: CapabilityEvidenceReference[] = [];
    if (pulse.growth.status === 'measured' && pulse.growth.source) {
      evidence.push({ source: pulse.growth.source, sourceType: 'census_acs', retrievedAt: nowIso });
    }
    evidence.push(...matrixEvidence(matrix, nowIso));
    const gaps: string[] = [];
    if (pulse.growth.status !== 'measured') gaps.push(`Growth: ${pulse.growth.note}`);
    if (pulse.countyPricePerAcre.status !== 'measured') gaps.push(`County price per acre: ${pulse.countyPricePerAcre.note}`);
    return {
      status: 'SUCCEEDED',
      subjectResolution: 'RESOLVED',
      canonicalSubject: geographySessionRef(MARKET_PULSE_CAPABILITY_ID, geo),
      facts: {
        geography: { ...geo } as JsonObject,
        geographyLabel: geographyLabel(geo),
        outcome: 'area_context_returned',
        pulse: pulse as unknown as JsonObject,
        summary: pulse.plainEnglish,
      },
      evidence,
      warnings: [],
      missingInformation: gaps,
    };
  },
};
