// LandOS — one-button Property Analysis orchestrator.
//
// The single normal dashboard path. Composes the EXISTING, tested components into
// one chain so Tyler enters an address and clicks Run Property Analysis once:
//
//   parse -> Local Market Pulse (started from city/state) -> LandPortal v2 exact
//   verification -> source-only DD facts/gaps/risks -> (verified only) Live Comps
//   readiness -> Redfin sold comps -> six strategy lanes / underwriting readiness
//   -> verified Deal Card update -> structured result + Markdown (+ lazy PDF).
//
// HARD RULES (delegated to the underlying components, echoed here):
//   - Exact parcel identity ONLY via identifier-based named sources. Never
//     coordinates/proximity for identity. A verified parcel's lat/lng MAY seed a
//     comp-area SEARCH (not identity).
//   - Unverified -> "Local Area Context, Not Parcel Verified": no score/value/
//     offer, no verified Deal Card.
//   - Never fabricate comps/market/DOM/strategy/offers. Historical sold price
//     always beats list/AVM (enforced in the comp extractor).
//   - Comps NEVER run before verified identity, and only when readiness passes.
//   - Every external lane runs preflight first; actual calls + spend are logged.

import { extractPropertyArgs } from './duke-preflight.js';
import { extractAreaSignals } from './source-adapters.js';
import { mapResolveToVerification, type DukeVerificationResult } from './duke-verification-bridge.js';
import { lpResolveForPreflight, lpApiVersion, type LpResolveArgs, type LpResolveResult } from './landportal-client.js';
import { buildMarketPulseV1, type MarketPulseV1 } from './market-pulse.js';
import { preflightLiveData, resolveLiveDataEnv, type CapabilityReadiness } from './live-data-preflight.js';
import {
  retrieveComps,
  type CompProvider,
  type CompQuery,
  type RetrievedComp,
  type NeedsVerificationComp,
} from './comp-retrieval.js';
import { evaluateStrategies, type StrategyScenario } from './offer-engine.js';
import { logCostRecord, type LandosEntity } from './db.js';

/** Live-call ceiling for a single authorized run (defense-in-depth; the comp
 *  provider also caps its own detail fan-out). */
export const PROPERTY_ANALYSIS_MAX_PROVIDER_CALLS = 30;
export const PROPERTY_ANALYSIS_TIMEOUT_MS = 30_000;

export type ProgressStage =
  | 'Checking parcel identity'
  | 'Collecting verified property facts'
  | 'Running Local Market Pulse'
  | 'Checking Live Comps readiness'
  | 'Collecting Redfin sold comps'
  | 'Analyzing strategy lanes'
  | 'Preparing report'
  | 'Complete';

export type VerifiedBadge = 'Verified' | 'Not Verified';
export type VerdictBadge = 'Pursue' | 'Pursue With Caution' | 'Pass' | 'Not Ready';
export type OfferBadge = 'Offer Ready' | 'Needs Confirmation' | 'Blocked';

export interface ProviderCall {
  source: string;
  kind: string;
  rows: number;
  spendUsd: number;
}

export interface SourceRow {
  category: string;
  source: string;
  status: string;
  timestamp: string;
  confidence: 'verified' | 'reported' | 'unavailable';
  note: string;
}

export interface PropertyAnalysisResult {
  input: string;
  reportTimestamp: string;
  /** Top-of-result badges. */
  verified: VerifiedBadge;
  verdict: VerdictBadge;
  offerReadiness: OfferBadge;
  /** Honest terminal/status lines reached in this run. */
  statuses: string[];

  parcelVerification: {
    status: DukeVerificationResult['status'];
    parcelVerified: boolean;
    verificationSource?: string;
    lpApiVersion: 'v1' | 'v2';
    identity?: DukeVerificationResult['identity'];
    summary: string;
    nextAction?: string;
  };
  ddFacts: Record<string, unknown> | null;
  dataGaps: string[];
  riskFlags: string[];
  marketPulse: MarketPulseV1;
  redfinComps: {
    ran: boolean;
    readiness: { ready: boolean; reason: string };
    comps: RetrievedComp[];
    needsVerification: NeedsVerificationComp[];
    note: string;
    terminalState?: string;
  };
  compInclusionExclusionNotes: string[];
  strategyMatrix: StrategyScenario[];
  underwriting: {
    expectedValueUsd: number | null;
    evBasis: string;
    offerReadiness: OfferBadge;
    blockerNote?: string;
  };
  mostViableStrategy: { strategy: string; label: string; reason: string } | null;
  discoveryQuestions: string[];
  sourceTable: SourceRow[];
  providerCalls: ProviderCall[];
  providerCallCount: number;
  actualSpendUsd: number;

  dealCard: { created: boolean; updated: boolean; dealCardId?: number; propertyCardId?: number; reason: string };
}

export interface PropertyAnalysisDeps {
  /** LandPortal exact resolver (injected in tests). Default = live bounded resolve. */
  resolve?: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
  /** Live comp provider registry factory (injected in tests). Default = live registration. */
  buildCompRegistry?: (onSpend: (c: ProviderCall) => void) => Promise<{ registry: CompProvider[]; compsLive: boolean; reason: string }>;
  /** Comps readiness check (injected). Default = preflightLiveData(resolveLiveDataEnv()). */
  compsReadiness?: () => Promise<CapabilityReadiness>;
  /** Market pulse builder (injected). Default = buildMarketPulseV1. */
  marketPulse?: (a: { city?: string; county?: string; state?: string; parcelVerified: boolean; nowIso?: string }) => MarketPulseV1;
  /** Verified-only Deal Card upsert (injected; default no-ops unless wired by route). */
  upsertDealCard?: (v: DukeVerificationResult, entity: LandosEntity, input: string) => { dealCardId: number; propertyCardId: number };
  /** Cost/audit logger (injected in tests). Default = logCostRecord. */
  logCost?: (opts: { category: string; description: string; amountUsd: number }) => void;
  timeoutMs?: number;
  nowIso?: string;
  /** Resolve the LP API version (injected in tests). */
  apiVersion?: () => 'v1' | 'v2';
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
}

/**
 * Run the full one-button property analysis. Pure over its injected deps so the
 * whole chain is unit-testable with NO live call; the route wires the real live
 * resolver/registry. Honors a hard provider-call ceiling and logs actual spend.
 */
export async function runPropertyAnalysis(
  rawInput: string,
  opts: { entity?: LandosEntity } = {},
  deps: PropertyAnalysisDeps = {},
): Promise<PropertyAnalysisResult> {
  const input = (rawInput ?? '').trim();
  const timeoutMs = deps.timeoutMs ?? PROPERTY_ANALYSIS_TIMEOUT_MS;
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const resolve = deps.resolve ?? lpResolveForPreflight;
  const apiVersion = (deps.apiVersion ?? lpApiVersion)();
  const mkMarketPulse = deps.marketPulse ?? buildMarketPulseV1;
  const logCost = deps.logCost ?? ((o) => logCostRecord({ category: o.category, description: o.description, amountUsd: o.amountUsd }));
  const statuses: string[] = [];
  const providerCalls: ProviderCall[] = [];
  const sourceTable: SourceRow[] = [];

  // ── Parse + Local Market Pulse (started from city/state, before verification) ──
  const area = extractAreaSignals(input);
  const marketPulse = mkMarketPulse({ city: area.city, county: area.county, state: area.state, parcelVerified: false, nowIso });
  statuses.push('Running Local Market Pulse');
  for (const s of marketPulse.signals) {
    sourceTable.push({
      category: `market:${s.signal}`,
      source: s.sourceName ?? '(none connected)',
      status: s.status,
      timestamp: marketPulse.generatedAt,
      confidence: s.status === 'source_available' ? 'reported' : 'unavailable',
      note: s.note,
    });
  }
  if (!marketPulse.eligible) statuses.push('Local Market Pulse unavailable');

  // ── Parcel identity: LandPortal exact verification (1 attempt + 1 retry) ──────
  statuses.push('Checking parcel identity');
  const args = extractPropertyArgs(input);
  let resolveResult: LpResolveResult | null = null;
  let verification: DukeVerificationResult;

  if (!args) {
    verification = mapResolveToVerification({ text: input, hasIdentifierInput: false, resolve: null, unavailable: false });
  } else {
    let lpErr = false;
    for (let attempt = 0; attempt < 2 && !resolveResult; attempt++) {
      try {
        resolveResult = await resolve(args, timeoutMs);
        logCost({ category: 'landportal_v2_verification', description: `LandPortal ${apiVersion} exact verification (non-credit) attempt ${attempt + 1}`, amountUsd: 0 });
        providerCalls.push({ source: `LandPortal ${apiVersion}`, kind: 'exact_verification', rows: resolveResult.verified ? 1 : 0, spendUsd: 0 });
      } catch {
        lpErr = true; // one retry, then give up honestly
      }
    }
    verification = mapResolveToVerification({ text: input, hasIdentifierInput: true, resolve: resolveResult, unavailable: lpErr || !resolveResult });
  }

  const parcelVerified = verification.parcelVerified;
  if (!parcelVerified) statuses.push('Parcel identity not verified');
  else statuses.push('Collecting verified property facts');

  // ── DD facts / gaps / risks — source-labeled, only when verified ─────────────
  const ddFacts = parcelVerified && verification.propertyData ? toDdFacts(verification.propertyData) : null;
  const dataGaps = verification.dataGaps ?? [];
  const riskFlags = buildRiskFlags(verification);
  if (parcelVerified && verification.identity) {
    sourceTable.push({
      category: 'parcel_identity',
      source: verification.verificationSource ?? 'LandPortal exact lookup',
      status: 'verified',
      timestamp: nowIso,
      confidence: 'verified',
      note: `Exact identity via named source (${apiVersion}). Coordinates never used for identity.`,
    });
  }

  // ── Live Comps — ONLY after verified identity AND readiness passes ────────────
  let redfinComps: PropertyAnalysisResult['redfinComps'] = {
    ran: false,
    readiness: { ready: false, reason: 'not attempted' },
    comps: [],
    needsVerification: [],
    note: 'Comps not attempted.',
  };
  const compNotes: string[] = [];

  if (parcelVerified) {
    statuses.push('Checking Live Comps readiness');
    const readiness = deps.compsReadiness
      ? await deps.compsReadiness()
      : (await preflightLiveData({ env: resolveLiveDataEnv() })).comps;
    redfinComps.readiness = { ready: readiness.ready, reason: readiness.reason };

    if (!readiness.ready) {
      redfinComps.note = `Live Comps not ready: ${readiness.reason}`;
      redfinComps.terminalState = 'Live Comps not ready';
      statuses.push('Live Comps not ready');
    } else {
      statuses.push('Collecting Redfin sold comps');
      const onSpend = (c: ProviderCall) => {
        providerCalls.push(c);
        logCost({ category: 'apify_comp_actor', description: `${c.source} ${c.kind} returned ${c.rows} row(s)`, amountUsd: c.spendUsd });
      };
      try {
        const reg = deps.buildCompRegistry
          ? await deps.buildCompRegistry(onSpend)
          : await liveRegistry(onSpend);
        if (providerCalls.length >= PROPERTY_ANALYSIS_MAX_PROVIDER_CALLS) {
          redfinComps.note = 'Provider-call ceiling reached before comps; aborted that lane.';
          redfinComps.terminalState = 'No usable comps returned';
        } else {
          // Comp SEARCH centroid from the verified parcel's coordinates (search
          // area only — identity already established by the named source).
          const centroid = resolveResult?.property_summary
            ? coordsFromSummary(resolveResult.property_summary)
            : null;
          const acres = verification.propertyData?.landFacts.acres;
          const query: CompQuery = {
            address: verification.identity?.situsAddress,
            apn: verification.identity?.apn,
            county: verification.identity?.county,
            state: verification.identity?.state,
            acres: typeof acres === 'number' ? acres : undefined,
            ...(centroid ? { centroid, centroidTier: 'A' as const } : {}),
            lookupDateIso: nowIso,
          };
          const res = await retrieveComps(query, { registry: reg.registry, sourceTimeoutMs: timeoutMs });
          redfinComps = {
            ran: true,
            readiness: { ready: true, reason: readiness.reason },
            comps: res.comps,
            needsVerification: res.needsVerification,
            note: res.note,
          };
          for (const p of res.providers) compNotes.push(`${p.providerId}: ${p.status} — ${p.note}`);
          for (const e of res.excluded) compNotes.push(`excluded: ${e.reason}`);
          for (const nv of res.needsVerification) compNotes.push(`verify in underwriting: ${(nv.verifyTags ?? []).join('; ')}`);
          if (res.comps.length === 0) {
            redfinComps.terminalState = 'No usable comps returned';
            statuses.push('No usable comps returned');
          }
          for (const c of res.comps) {
            sourceTable.push({ category: 'redfin_sold_comp', source: c.sourceLabel, status: 'sold', timestamp: c.saleDateIso, confidence: 'reported', note: c.sourceUrl });
          }
        }
      } catch {
        redfinComps.note = 'Redfin comp lane failed (provider error).';
        redfinComps.terminalState = 'Live Comps failed';
        statuses.push('Live Comps failed');
      }
    }
  }

  // ── Strategy lanes + underwriting readiness ──────────────────────────────────
  statuses.push('Analyzing strategy lanes');
  const soldPpas = redfinComps.comps
    .map((c) => (c.pricePerAcre ?? (c.acres && c.acres > 0 ? c.price / c.acres : null)))
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const acres = verification.propertyData?.landFacts.acres;
  const compMedianPpa = median(soldPpas);
  const tlp = verification.propertyData?.valuation.tlpEstimate ?? null;
  let evUsd: number | null = null;
  let evBasis = 'unavailable';
  if (parcelVerified && compMedianPpa && typeof acres === 'number' && acres > 0) {
    evUsd = Math.round(compMedianPpa * acres);
    evBasis = `median Redfin sold $/acre (${redfinComps.comps.length} comps) x ${acres} ac`;
  } else if (parcelVerified && typeof tlp === 'number' && tlp > 0) {
    evUsd = tlp;
    evBasis = 'LandPortal property-data TLP estimate (no usable comps)';
  }

  const strategyMatrix = parcelVerified && evUsd
    ? evaluateStrategies({ expectedValueUsd: evUsd, acres: typeof acres === 'number' ? acres : undefined })
    : [];

  let offerReadiness: OfferBadge;
  let blockerNote: string | undefined;
  if (!parcelVerified) {
    offerReadiness = 'Blocked';
    blockerNote = 'Parcel identity not verified — no scoring, valuation, or offer.';
  } else if (!evUsd) {
    offerReadiness = 'Blocked';
    blockerNote = 'Valuation not ready. Offer guidance blocked or needs confirmation.';
    statuses.push('Valuation not ready');
    statuses.push('Offer guidance blocked or needs confirmation');
  } else {
    const anyConfirmed = strategyMatrix.some((s) => s.outputLabel === 'CONFIRMED PARAMETERS' && s.feasible && s.offerHighUsd != null);
    offerReadiness = anyConfirmed ? 'Offer Ready' : 'Needs Confirmation';
    if (!anyConfirmed) blockerNote = 'Offer ranges derive from unconfirmed parameters — needs confirmation.';
  }

  // Most viable: highest feasible confirmed offer band, else first feasible.
  const mostViableStrategy = pickMostViable(strategyMatrix);

  // Verdict badge.
  const verdict: VerdictBadge = !parcelVerified
    ? 'Not Ready'
    : !evUsd
      ? 'Pursue With Caution'
      : mostViableStrategy && mostViableStrategy.strategy !== 'pass'
        ? 'Pursue'
        : 'Pass';

  // ── Verified-only Deal Card upsert ───────────────────────────────────────────
  let dealCard: PropertyAnalysisResult['dealCard'] = {
    created: false, updated: false,
    reason: parcelVerified ? 'No entity supplied; Deal Card upsert skipped.' : 'Unverified parcel: no verified Deal Card created.',
  };
  if (parcelVerified && opts.entity && deps.upsertDealCard) {
    const r = deps.upsertDealCard(verification, opts.entity, input);
    dealCard = { created: true, updated: true, dealCardId: r.dealCardId, propertyCardId: r.propertyCardId, reason: 'Verified parcel: Deal Card upserted from named-source identity.' };
  }

  statuses.push('Preparing report');
  statuses.push('Complete');

  const actualSpendUsd = Math.round(providerCalls.reduce((s, c) => s + (c.spendUsd || 0), 0) * 100) / 100;

  return {
    input,
    reportTimestamp: nowIso,
    verified: parcelVerified ? 'Verified' : 'Not Verified',
    verdict,
    offerReadiness,
    statuses,
    parcelVerification: {
      status: verification.status,
      parcelVerified,
      verificationSource: verification.verificationSource,
      lpApiVersion: apiVersion,
      identity: verification.identity,
      summary: verification.summary,
      nextAction: verification.nextAction,
    },
    ddFacts,
    dataGaps,
    riskFlags,
    marketPulse,
    redfinComps,
    compInclusionExclusionNotes: compNotes,
    strategyMatrix,
    underwriting: { expectedValueUsd: evUsd, evBasis, offerReadiness, blockerNote },
    mostViableStrategy,
    discoveryQuestions: buildDiscoveryQuestions(verification, redfinComps),
    sourceTable,
    providerCalls,
    providerCallCount: providerCalls.length,
    actualSpendUsd,
    dealCard,
  };
}

// ── Default live wiring (only used off the route; tests inject) ────────────────

async function liveRegistry(onSpend: (c: ProviderCall) => void): Promise<{ registry: CompProvider[]; compsLive: boolean; reason: string }> {
  const { registerLiveProviders } = await import('./providers/register-live-providers.js');
  return registerLiveProviders({
    onSpend: (ev) => onSpend({ source: `Apify ${ev.actorId}`, kind: ev.stage, rows: ev.rows, spendUsd: 0 }),
  });
}

function coordsFromSummary(s: { lat?: string; lng?: string }): { lat: number; lng: number } | null {
  const lat = num(s.lat);
  const lng = typeof s.lng === 'string' ? Number(s.lng) : NaN;
  if (lat !== null && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function toDdFacts(pd: NonNullable<DukeVerificationResult['propertyData']>): Record<string, unknown> {
  return {
    identity: pd.identity,
    landFacts: pd.landFacts,
    valuation: pd.valuation,
    similars: pd.similars,
    similarSales: pd.similarSales,
    sourceName: pd.sourceName,
    truthLabel: pd.truthLabel,
    note: pd.note,
  };
}

function buildRiskFlags(v: DukeVerificationResult): string[] {
  const flags: string[] = [];
  const lf = v.propertyData?.landFacts;
  if (lf) {
    if (typeof lf.femaPct === 'number' && lf.femaPct >= 30) flags.push(`FEMA flood ${lf.femaPct}% (>=30%)`);
    if (typeof lf.wetlandsPct === 'number' && lf.wetlandsPct >= 30) flags.push(`Wetlands ${lf.wetlandsPct}% (>=30%)`);
    if (lf.landLocked && /yes|true/i.test(String(lf.landLocked))) flags.push('Landlocked (no road access on record)');
    if (typeof lf.buildabilityPct === 'number' && lf.buildabilityPct < 50) flags.push(`Low buildability ${lf.buildabilityPct}%`);
  }
  if (!v.parcelVerified) flags.push('Parcel identity not verified — strategy/underwriting blocked.');
  return flags;
}

function pickMostViable(matrix: StrategyScenario[]): PropertyAnalysisResult['mostViableStrategy'] {
  const feasible = matrix.filter((s) => s.feasible && s.strategy !== 'pass');
  if (!feasible.length) return null;
  const confirmed = feasible.filter((s) => s.outputLabel === 'CONFIRMED PARAMETERS' && s.offerHighUsd != null);
  const pool = confirmed.length ? confirmed : feasible;
  const best = pool.reduce((a, b) => ((b.offerHighUsd ?? 0) > (a.offerHighUsd ?? 0) ? b : a));
  return { strategy: best.strategy, label: best.label, reason: best.reasons[0] ?? 'Most viable feasible lane by offer band.' };
}

function buildDiscoveryQuestions(v: DukeVerificationResult, comps: PropertyAnalysisResult['redfinComps']): string[] {
  const q: string[] = [];
  if (!v.parcelVerified) {
    q.push('Confirm the exact parcel: APN + county/state, or a LandPortal property id + FIPS.');
    return q;
  }
  if ((v.dataGaps ?? []).length) q.push(`Confirm missing facts with the seller/county: ${(v.dataGaps ?? []).join(', ')}.`);
  if (!comps.comps.length) q.push('No usable sold comps returned — ask the seller for recent nearby sales / list activity.');
  q.push('Confirm access/utilities/zoning intent with the seller.');
  return q;
}
