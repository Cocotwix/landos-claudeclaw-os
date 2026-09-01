// LandOS — MARKET RESEARCH AND PULSE: the source-backed Market Story.
//
// Two halves, deliberately kept apart because they answer with different kinds
// of evidence and must never be read as one number.
//
//   MARKET RESEARCH is the imported market database — the Market Matrix plus
//   the retained quarterly Market Research collection behind it. It answers
//   with sample counts, periods, a stated price-per-acre basis, days on market,
//   sell-through, absorption and months of supply for the SUBJECT's own band
//   and geography. When the subject's own band did not answer, the record that
//   did is named, along with the fact that it describes a different population.
//
//   MARKET PULSE is what the database cannot know: what is happening around
//   this parcel right now. That is a research PLAN here, not a fabricated
//   reading — each question with its geography, its primary source, its
//   fallbacks and whether it is authorized to run. A pulse claim only enters
//   once it carries a source, a date, a geography and a fact-versus-inference
//   status; anything short of that is refused rather than rounded up.
//
// THE STAGE 0 DEFECT THIS FILE EXISTS TO MAKE IMPOSSIBLE. The county's
// fastest-selling band once rendered under the heading "Subject band" because
// the panel labelled records by array index after filtering the unavailable one
// away. Here every record carries its own ROLE, set at construction. An
// unavailable subject band stays an unavailable subject band, with its reason,
// and `mostLiquidBand` can never occupy its slot.
//
// Nothing here recomputes a market metric. Every figure is provider-computed
// and carried verbatim with its period and confidence, exactly as the Market
// Matrix read returns it.

import { createHash } from 'node:crypto';

import { ACREAGE_BAND_LABEL, type AcreageBand } from './market-matrix.js';
import { MATCH_LEVEL_LABEL, type MarketMatrixResolution } from './market-matrix-read.js';
import {
  claim,
  synthesizeClaims,
  type ClaimSeed,
  type SourcedClaim,
  type SynthesisConflict,
} from './source-aware-synthesis.js';

export const MARKET_RESEARCH_PULSE_VERSION = '1.0.0';

// ── Market research records ─────────────────────────────────────────────────

/**
 * What this record is FOR. Set at construction and never reassigned, so a
 * surface can render named slots instead of positions in a filtered array.
 */
export type MarketRecordRole =
  | 'subject_band'
  | 'county_context'
  | 'zip_context'
  | 'most_liquid_band'
  | 'band_ladder';

export interface MarketContextRecord {
  role: MarketRecordRole;
  available: boolean;
  /** The geography key that actually carried the record, and its label. */
  resolvedKey: string | null;
  resolvedKeyLabel: string | null;
  /**
   * The same geography WITHOUT the acreage band.
   *
   * A population figure describes a county, not a county's 1–2 acre listings,
   * and printing "population growth for Bradford County (1–2 acres)" reads as a
   * statistic about the band. Non-band facts use this label.
   */
  geographyLabel: string | null;
  matchLevel: string;
  matchLabel: string;
  bandRequested: AcreageBand | null;
  bandRequestedLabel: string | null;
  bandUsed: AcreageBand | null;
  bandUsedLabel: string | null;
  /** Set whenever the answer did not come from the subject's own band. */
  bandFallback: { from: AcreageBand | null; to: AcreageBand; why: string } | null;
  side: string;
  period: string | null;
  staleness: string;
  isStale: boolean;
  confidence: string | null;
  source: string | null;
  provider: string | null;
  /** The sample the figures rest on. Null is "not stated", never zero. */
  sampleCount: number | null;
  listingCount: number | null;
  medianPricePerAcre: number | null;
  /** What the price-per-acre figure actually measures. */
  pricePerAcreBasis: string | null;
  medianPrice: number | null;
  daysOnMarket: number | null;
  sellThroughRate: number | null;
  absorptionRate: number | null;
  monthsOfSupply: number | null;
  populationGrowth: number | null;
  /** Everything an operator must know before using these numbers. */
  limitations: string[];
  note: string;
}

// ── Market pulse ────────────────────────────────────────────────────────────

export type MarketPulseTopicKey =
  | 'local_development'
  | 'infrastructure'
  | 'land_use_change'
  | 'announced_projects'
  | 'demand_direction'
  | 'active_competition'
  | 'local_conditions';

export const MARKET_PULSE_TOPIC_LABEL: Record<MarketPulseTopicKey, string> = {
  local_development: 'Local development activity',
  infrastructure: 'Infrastructure and utilities',
  land_use_change: 'Land-use and zoning change',
  announced_projects: 'Announced projects',
  demand_direction: 'Demand direction',
  active_competition: 'Active competition',
  local_conditions: 'Local conditions',
};

export interface PulseSourcePlan {
  name: string;
  url: string | null;
  /** `primary` is tried first; `fallback` runs when it cannot answer. */
  kind: 'primary' | 'fallback';
  tier: 'official_primary' | 'provider_record' | 'reputable_secondary' | 'search';
  /** True when this route needs no new account, credential or paid call. */
  authorized: boolean;
  /** Why it is not authorized, when it is not. */
  authorizationNeeded: string | null;
}

export interface MarketPulseQuestion {
  key: MarketPulseTopicKey;
  label: string;
  /** The question in plain English, as an operator would type it. */
  question: string;
  geography: string;
  sources: PulseSourcePlan[];
  /** Bounded: the maximum evidence actions this question may spend. */
  boundedActions: number;
  status: 'planned' | 'answered' | 'blocked';
  /** Claim ids that answered it, when any did. */
  answeredBy: string[];
}

/**
 * A pulse claim is a SourcedClaim with the three fields Stage 3 makes
 * mandatory actually enforced: a named source, a date, and the geography it
 * speaks about — plus its fact-versus-inference standing.
 */
export interface MarketPulseClaim extends SourcedClaim {
  topicKey: MarketPulseTopicKey;
}

export interface MarketStory {
  headline: string;
  liquidityRead: string;
  demandRead: string;
  competitionRead: string;
  limitations: string[];
}

export interface MarketResearchAndPulse {
  contractVersion: typeof MARKET_RESEARCH_PULSE_VERSION;
  dealCardId: number;
  /** Null on a reading read back from the store; see the property synthesis
   *  contract for why the persisted payload carries no wall-clock time. */
  generatedAt: string | null;
  inputFingerprint: string;
  subjectGeography: {
    county: string | null;
    fips: string | null;
    state: string | null;
    zip: string | null;
    acres: number | null;
    /** The correlation token the read answered about. */
    subjectVersion: string | null;
  };
  /** The subject's OWN band. Unavailable stays unavailable. */
  subjectBand: MarketContextRecord;
  countyContext: MarketContextRecord;
  zipContext: MarketContextRecord | null;
  /** Every retained band for the subject's county, so the ladder is visible. */
  bandLadder: MarketContextRecord[];
  /** Explicitly labelled. It is never the subject's band. */
  mostLiquidBand: MarketContextRecord | null;
  pulsePlan: MarketPulseQuestion[];
  pulseClaims: MarketPulseClaim[];
  /** Pulse claims refused for missing source, date or geography. */
  pulseClaimsRefused: Array<{ statement: string; reason: string }>;
  story: MarketStory;
  conflicts: SynthesisConflict[];
  limitations: string[];
}

// ── Building a record ───────────────────────────────────────────────────────

/**
 * The basis line for a price-per-acre figure.
 *
 * `mr_snapshot.filters_json` is fixed at vacant land, sold side, trailing
 * twelve months, and the whole collection is provider-computed by LandPortal
 * Market Research. Printing a $/acre without that sentence invites it to be
 * read as an appraisal of this parcel, which it is not.
 */
function pricePerAcreBasisFor(resolution: MarketMatrixResolution): string | null {
  if (resolution.metrics?.medianPricePerAcre == null) return null;
  const band = resolution.acreageBandUsed ? ACREAGE_BAND_LABEL[resolution.acreageBandUsed].toLowerCase() : 'all acreage';
  return `Median $/acre across ${resolution.metrics.salesCount ?? 'an unstated number of'} `
    + `${resolution.side === 'sold' ? 'closed sales' : 'active listings'} of vacant land in the ${band} band `
    + `for ${resolution.resolvedKeyLabel ?? 'the resolved geography'}, ${resolution.period ?? 'period not stated'}. `
    + 'Provider-computed; it is a market statistic, not a valuation of this parcel.';
}

function limitationsFor(resolution: MarketMatrixResolution, role: MarketRecordRole): string[] {
  const limitations: string[] = [];
  if (!resolution.available) {
    limitations.push(resolution.note);
    return limitations;
  }
  if (resolution.bandFallback) limitations.push(resolution.bandFallback.why);
  if (resolution.matchLevel !== 'zip' && resolution.matchLevel !== 'county') {
    limitations.push(
      `This record was carried by ${MATCH_LEVEL_LABEL[resolution.matchLevel]} `
      + `(${resolution.resolvedKeyLabel ?? 'a wider geography'}), which describes a wider population than the subject.`,
    );
  }
  if (resolution.staleness.isStale) limitations.push(`The snapshot is ${resolution.staleness.label.toLowerCase()}.`);
  const sales = resolution.metrics?.salesCount ?? null;
  if (sales != null && sales > 0 && sales < 10) {
    limitations.push(`The sample is thin: ${sales} recorded sale(s) in the period.`);
  }
  if ((resolution.metrics?.sellThroughRate ?? 0) > 100) {
    limitations.push(
      'Sell-through above 100% means more parcels closed than were listed in the period — normal on thin inventory, '
      + 'and not a sign of runaway demand.',
    );
  }
  if (role === 'most_liquid_band') {
    limitations.push('This is the county\'s fastest-selling band, not the subject\'s band. It describes different parcels.');
  }
  return limitations;
}

export function marketContextRecord(
  resolution: MarketMatrixResolution,
  role: MarketRecordRole,
): MarketContextRecord {
  const metrics = resolution.metrics;
  return {
    role,
    available: resolution.available,
    resolvedKey: resolution.resolvedKey,
    resolvedKeyLabel: resolution.resolvedKeyLabel,
    geographyLabel: resolution.resolvedKeyLabel
      ? resolution.resolvedKeyLabel.replace(/\s*\([^)]*acres?\)\s*$/i, '').trim() || resolution.resolvedKeyLabel
      : null,
    matchLevel: resolution.matchLevel,
    matchLabel: MATCH_LEVEL_LABEL[resolution.matchLevel],
    bandRequested: resolution.acreageBandRequested,
    bandRequestedLabel: resolution.acreageBandRequested ? ACREAGE_BAND_LABEL[resolution.acreageBandRequested] : null,
    bandUsed: resolution.acreageBandUsed,
    bandUsedLabel: resolution.acreageBandUsed ? ACREAGE_BAND_LABEL[resolution.acreageBandUsed] : null,
    bandFallback: resolution.bandFallback,
    side: resolution.side,
    period: resolution.period,
    staleness: resolution.staleness.label,
    isStale: resolution.staleness.isStale,
    confidence: resolution.confidence,
    source: resolution.source,
    provider: resolution.provider,
    sampleCount: metrics?.salesCount ?? null,
    listingCount: metrics?.listingCount ?? null,
    medianPricePerAcre: metrics?.medianPricePerAcre ?? null,
    pricePerAcreBasis: pricePerAcreBasisFor(resolution),
    medianPrice: metrics?.medianPrice ?? null,
    daysOnMarket: metrics?.daysOnMarket ?? null,
    sellThroughRate: metrics?.sellThroughRate ?? null,
    absorptionRate: metrics?.absorptionRate ?? null,
    monthsOfSupply: metrics?.monthsOfSupply ?? null,
    populationGrowth: metrics?.populationGrowth ?? null,
    limitations: limitationsFor(resolution, role),
    note: resolution.note,
  };
}

// ── The pulse plan ──────────────────────────────────────────────────────────

interface PulseTopicSpec {
  key: MarketPulseTopicKey;
  question: (area: string) => string;
  primary: (area: string, state: string | null) => PulseSourcePlan[];
  boundedActions: number;
}

/**
 * The plan. Every route below is either an official public portal or a plain
 * search through the dedicated LandOS browser — the section 9 fallback, which
 * is authorized research, not new tooling. Nothing here consumes credits, opens
 * an account or touches a paid API, so nothing here needs an approval gate.
 */
const PULSE_TOPICS: PulseTopicSpec[] = [
  {
    key: 'local_development',
    question: (area) => `What new residential or land development is happening in ${area} right now?`,
    primary: (area) => [
      { name: `${area} planning department`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: 'Search: plain-English question through the dedicated LandOS browser', url: null, kind: 'fallback', tier: 'search', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 3,
  },
  {
    key: 'infrastructure',
    question: (area) => `What road, water, sewer or power infrastructure work is planned or underway in ${area}?`,
    primary: (area, state) => [
      { name: `${state ?? 'State'} DOT project listing`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: `${area} public works / utility authority`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: 'Search: plain-English question through the dedicated LandOS browser', url: null, kind: 'fallback', tier: 'search', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 3,
  },
  {
    key: 'land_use_change',
    question: (area) => `Has ${area} changed its zoning, comprehensive plan or future land use recently?`,
    primary: (area) => [
      { name: `${area} comprehensive plan / future land use map`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: `${area} municipal code (Municode / American Legal)`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: 'Search: plain-English question through the dedicated LandOS browser', url: null, kind: 'fallback', tier: 'search', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 3,
  },
  {
    key: 'announced_projects',
    question: (area) => `What major projects or employers have been announced near ${area}?`,
    primary: (area) => [
      { name: 'Local news and county commission coverage', url: null, kind: 'primary', tier: 'reputable_secondary', authorized: true, authorizationNeeded: null },
      { name: `${area} economic development authority`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: 'Search: plain-English question through the dedicated LandOS browser', url: null, kind: 'fallback', tier: 'search', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 3,
  },
  {
    key: 'demand_direction',
    question: (area) => `Is population and land demand in ${area} growing, flat or declining?`,
    primary: (area) => [
      {
        name: 'U.S. Census Bureau (data.census.gov)',
        url: `https://data.census.gov/all?q=${encodeURIComponent(`${area} population`)}`,
        kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null,
      },
      { name: 'Retained Market Research collection (population and growth metrics)', url: null, kind: 'fallback', tier: 'official_primary', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 2,
  },
  {
    key: 'active_competition',
    question: (area) => `What comparable vacant land is actively listed in ${area} right now, and at what asking prices?`,
    primary: () => [
      { name: 'Retained Comps & Valuation active competition set', url: null, kind: 'primary', tier: 'provider_record', authorized: true, authorizationNeeded: null },
      { name: 'Search: plain-English question through the dedicated LandOS browser', url: null, kind: 'fallback', tier: 'search', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 2,
  },
  {
    key: 'local_conditions',
    question: (area) => `What local conditions in ${area} would affect a land buyer — schools, services, hazards, restrictions?`,
    primary: (area) => [
      { name: `${area} county government site`, url: null, kind: 'primary', tier: 'official_primary', authorized: true, authorizationNeeded: null },
      { name: 'Search: plain-English question through the dedicated LandOS browser', url: null, kind: 'fallback', tier: 'search', authorized: true, authorizationNeeded: null },
    ],
    boundedActions: 2,
  },
];

export function buildMarketPulsePlan(input: {
  county: string | null;
  state: string | null;
  zip: string | null;
  claims: readonly MarketPulseClaim[];
}): MarketPulseQuestion[] {
  const area = [
    input.county ? `${input.county.replace(/\s+county$/i, '')} County` : null,
    input.state,
  ].filter(Boolean).join(', ') || input.zip || 'the subject area';
  const geography = input.zip ? `${area} (ZIP ${input.zip})` : area;
  return PULSE_TOPICS.map((topic) => {
    const answers = input.claims.filter((entry) => entry.topicKey === topic.key);
    return {
      key: topic.key,
      label: MARKET_PULSE_TOPIC_LABEL[topic.key],
      question: topic.question(area),
      geography,
      sources: topic.primary(area, input.state),
      boundedActions: topic.boundedActions,
      status: answers.length ? ('answered' as const) : ('planned' as const),
      answeredBy: answers.map((entry) => entry.claimId),
    };
  });
}

/**
 * Admit a pulse claim, or refuse it with the reason.
 *
 * Stage 3 requires source, date, geography and fact-versus-inference on every
 * pulse claim. A claim missing one of them is not a weaker claim, it is an
 * unusable one, so it is refused here rather than published with a hole in it.
 */
/** The standings a pulse claim may carry. A pulse finding is a report about
 *  the world, an inference LandOS drew from one, or an outstanding question —
 *  never an official/legal fact, because no pulse source establishes one. */
const PULSE_STANDINGS: ReadonlyArray<SourcedClaim['standing']> = [
  'record_fact',
  'analytical_hypothesis',
  'verification_need',
];

export function admitPulseClaim(
  candidate: MarketPulseClaim,
): { admitted: MarketPulseClaim } | { refused: { statement: string; reason: string } } {
  const missing: string[] = [];
  if (!candidate.source.name.trim()) missing.push('a named source');
  if (!(candidate.asOf ?? candidate.source.retrievedAt)) missing.push('a date');
  if (!candidate.source.geography?.trim()) missing.push('the geography it speaks about');
  // Fact-versus-inference is the fourth mandatory field, and it is checked at
  // RUNTIME rather than trusted from the type: a claim whose standing arrived
  // absent or unrecognised would otherwise render under whatever label the
  // surface defaults to, which is exactly how an inference starts reading as a
  // fact.
  if (!PULSE_STANDINGS.includes(candidate.standing)) {
    missing.push('a usable fact-versus-inference status');
  }
  if (missing.length) {
    return { refused: { statement: candidate.statement, reason: `Refused: the claim carries no ${missing.join(', no ')}.` } };
  }
  return { admitted: candidate };
}

// ── The Market Story ────────────────────────────────────────────────────────

function liquidityWord(daysOnMarket: number | null, monthsOfSupply: number | null): string {
  if (daysOnMarket == null && monthsOfSupply == null) return 'not established';
  if (monthsOfSupply != null && monthsOfSupply <= 6) return 'tight';
  if (monthsOfSupply != null && monthsOfSupply >= 18) return 'slow';
  if (daysOnMarket != null && daysOnMarket <= 45) return 'moving';
  if (daysOnMarket != null && daysOnMarket >= 120) return 'slow';
  return 'moderate';
}

function buildStory(input: {
  subjectBand: MarketContextRecord;
  countyContext: MarketContextRecord;
  mostLiquidBand: MarketContextRecord | null;
  pulsePlan: MarketPulseQuestion[];
  pulseClaims: readonly MarketPulseClaim[];
  acres: number | null;
  area: string;
}): MarketStory {
  const { subjectBand, countyContext, mostLiquidBand, pulsePlan, pulseClaims, acres, area } = input;
  const primary = subjectBand.available ? subjectBand : countyContext;
  const limitations: string[] = [...subjectBand.limitations];

  const headline = subjectBand.available
    ? `${area}: the subject's ${subjectBand.bandUsedLabel ?? 'band'} carried `
      + `${subjectBand.sampleCount ?? 'an unstated number of'} recorded sale(s) `
      + `at ${subjectBand.medianPricePerAcre != null ? `$${Math.round(subjectBand.medianPricePerAcre).toLocaleString('en-US')}/acre` : 'no stated $/acre'} `
      + `over ${subjectBand.period ?? 'the retained period'}.`
    : `${area}: no market record answered for ${acres != null ? `a ${acres}-acre subject` : 'the subject'}. `
      + `${subjectBand.note}`;

  const liquidityRead = primary.available
    ? `The market reads ${liquidityWord(primary.daysOnMarket, primary.monthsOfSupply)}: `
      + `${primary.daysOnMarket != null ? `${Math.round(primary.daysOnMarket)} median days on market` : 'days on market not stated'}, `
      + `${primary.sellThroughRate != null ? `${primary.sellThroughRate}% sell-through` : 'sell-through not stated'}, `
      + `${primary.monthsOfSupply != null ? `${primary.monthsOfSupply} months of supply` : 'months of supply not stated'} `
      + `(${primary.resolvedKeyLabel ?? 'resolved geography'}, ${primary.period ?? 'period not stated'}).`
    : 'Liquidity is not established: no retained market record carried real activity for this subject.';

  const growth = primary.populationGrowth;
  const demandRead = growth != null
    ? `Recorded population growth for ${primary.geographyLabel ?? area} is ${growth}%. `
      + 'Current demand direction is a Market Pulse question and has not been researched yet.'
    : 'Demand direction is not established from the retained database. It is the first Market Pulse question.';

  // Either way this ends at the same place: the retained collection is sold-side
  // and trailing, so it can describe what CLOSED but never what is competing for
  // a buyer today. That is a Market Pulse question in both branches.
  const competitionRead = (primary.listingCount != null
    ? `${primary.listingCount} listing(s) were recorded against ${primary.sampleCount ?? 0} sale(s) in the period. `
    : 'Active competition is not established from the retained database, which is sold-side, trailing twelve months, vacant land only. ')
    + 'Live active competition is a Market Pulse question and has not been researched yet.';

  if (mostLiquidBand?.available && subjectBand.available
    && mostLiquidBand.bandUsed !== subjectBand.bandUsed) {
    limitations.push(
      `${mostLiquidBand.bandUsedLabel} is the county's fastest-selling band, not the subject's. `
      + 'It is shown for contrast and describes different parcels.',
    );
  }
  const unanswered = pulsePlan.filter((entry) => entry.status !== 'answered').length;
  if (unanswered) {
    limitations.push(
      `${unanswered} of ${pulsePlan.length} Market Pulse questions are planned but not yet researched, `
      + 'so nothing here reflects current local conditions.',
    );
  }
  if (!pulseClaims.length) {
    limitations.push('No Market Pulse claim has been admitted: every statement above comes from the retained market database.');
  }

  return { headline, liquidityRead, demandRead, competitionRead, limitations: [...new Set(limitations)] };
}

// ── The builder ─────────────────────────────────────────────────────────────

export interface MarketResearchAndPulseInput {
  dealCardId: number;
  geography: {
    county: string | null;
    fips: string | null;
    state: string | null;
    zip: string | null;
    acres: number | null;
    subjectVersion: string | null;
  };
  subjectBand: MarketMatrixResolution;
  countyContext: MarketMatrixResolution;
  zipContext?: MarketMatrixResolution | null;
  /** Every band retained for the subject's county, band -> resolution. */
  bandLadder?: ReadonlyArray<MarketMatrixResolution>;
  /** Pulse claims already retained for this market, if any. */
  pulseClaims?: ReadonlyArray<MarketPulseClaim>;
  now?: () => Date;
}

/**
 * PURE. Build the source-backed Market Intelligence report.
 *
 * Every resolution arrives already resolved: the caller owns the database
 * reads, so this stays testable without a database and cannot widen a lookup on
 * its own.
 */
export function buildMarketResearchAndPulse(
  input: MarketResearchAndPulseInput,
): MarketResearchAndPulse {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const { geography } = input;

  const subjectBand = marketContextRecord(input.subjectBand, 'subject_band');
  const countyContext = marketContextRecord(input.countyContext, 'county_context');
  const zipContext = input.zipContext ? marketContextRecord(input.zipContext, 'zip_context') : null;
  const bandLadder = (input.bandLadder ?? []).map((resolution) => marketContextRecord(resolution, 'band_ladder'));

  // The most liquid band is chosen for CONTRAST and labelled as such. It can
  // never be the subject's band and it can never occupy the subject's slot.
  const liquidCandidates = bandLadder.filter(
    (record) => record.available
      && record.sellThroughRate != null
      && record.bandUsed !== subjectBand.bandUsed,
  );
  const mostLiquidSource = liquidCandidates.length
    ? liquidCandidates.reduce((best, record) =>
      (record.sellThroughRate as number) > (best.sellThroughRate as number) ? record : best)
    : null;
  const mostLiquidBand = mostLiquidSource ? { ...mostLiquidSource, role: 'most_liquid_band' as const } : null;
  if (mostLiquidBand) {
    mostLiquidBand.limitations = [...new Set([
      ...mostLiquidBand.limitations,
      'This is the county\'s fastest-selling band, not the subject\'s band. It describes different parcels.',
    ])];
  }

  // Pulse claims: admitted or refused, never silently downgraded.
  const pulseClaims: MarketPulseClaim[] = [];
  const pulseClaimsRefused: Array<{ statement: string; reason: string }> = [];
  for (const candidate of input.pulseClaims ?? []) {
    const verdict = admitPulseClaim(candidate);
    if ('admitted' in verdict) pulseClaims.push(verdict.admitted);
    else pulseClaimsRefused.push(verdict.refused);
  }

  const pulsePlan = buildMarketPulsePlan({
    county: geography.county,
    state: geography.state,
    zip: geography.zip,
    claims: pulseClaims,
  });

  const area = [
    geography.county ? `${geography.county.replace(/\s+county$/i, '')} County` : null,
    geography.state,
  ].filter(Boolean).join(', ') || geography.zip || 'the subject area';

  // Conflicts across the retained market record: the same metric answered
  // differently by ZIP and county is a real disagreement about which population
  // describes the subject, and it is surfaced rather than averaged away.
  const conflictSeeds: ClaimSeed[] = [];
  const metricSeed = (
    record: MarketContextRecord,
    topic: string,
    label: string,
    value: number | null,
  ): void => {
    if (!record.available || value == null) return;
    conflictSeeds.push({
      topic,
      label,
      statement: `${label}: ${value} (${record.resolvedKeyLabel ?? record.matchLabel}, ${record.period ?? 'period not stated'}).`,
      value,
      standing: 'record_fact',
      weight: record.isStale ? 'likely' : 'well_supported',
      sourceName: record.source ?? record.provider ?? 'Retained market database',
      tier: 'provider_record',
      geography: record.resolvedKeyLabel ?? area,
      locator: record.resolvedKey,
      asOf: record.period,
    });
  };
  for (const record of [subjectBand, zipContext, countyContext].filter((entry): entry is MarketContextRecord => entry != null)) {
    metricSeed(record, 'market.price_per_acre', 'Median $/acre', record.medianPricePerAcre);
    metricSeed(record, 'market.days_on_market', 'Median days on market', record.daysOnMarket);
    metricSeed(record, 'market.sell_through', 'Sell-through rate', record.sellThroughRate);
  }
  const marketClaims = conflictSeeds
    .map((seed, index) => claim('mrp', index, seed))
    .filter((entry): entry is SourcedClaim => entry != null);
  const synthesis = synthesizeClaims({
    claims: [...marketClaims, ...pulseClaims],
    topicLabels: {
      'market.price_per_acre': 'Median $/acre',
      'market.days_on_market': 'Median days on market',
      'market.sell_through': 'Sell-through rate',
    },
  });

  const story = buildStory({
    subjectBand, countyContext, mostLiquidBand, pulsePlan, pulseClaims,
    acres: geography.acres, area,
  });

  const limitations = [...new Set([
    ...story.limitations,
    ...countyContext.limitations,
    'The retained collection is vacant land only, sold side, trailing twelve months, and is provider-computed.',
  ])];

  const fingerprintPayload = {
    geography,
    records: [subjectBand, countyContext, zipContext, mostLiquidBand, ...bandLadder]
      .filter(Boolean)
      .map((record) => {
        const entry = record as MarketContextRecord;
        return [entry.role, entry.resolvedKey, entry.bandUsed, entry.period, entry.sampleCount,
          entry.medianPricePerAcre, entry.daysOnMarket, entry.sellThroughRate, entry.monthsOfSupply];
      }),
    pulse: pulsePlan.map((entry) => [entry.key, entry.status, entry.answeredBy.join(',')]),
    claims: pulseClaims.map((entry) => [entry.claimId, entry.value, entry.asOf]),
  };

  return {
    contractVersion: MARKET_RESEARCH_PULSE_VERSION,
    dealCardId: input.dealCardId,
    generatedAt: now,
    inputFingerprint: createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
    subjectGeography: geography,
    subjectBand,
    countyContext,
    zipContext,
    bandLadder,
    mostLiquidBand,
    pulsePlan,
    pulseClaims,
    pulseClaimsRefused,
    story,
    conflicts: synthesis.conflicts,
    limitations,
  };
}
