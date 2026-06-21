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
import { planResolver, smallestNextIdentifier, type IntakeFields, type ResolverPathId } from './resolver-planner.js';
import { correctionCandidates, normalizeAddress, type AddressCorrectionCandidate } from './address-normalize.js';
import { makeCompSearchArea, compSearchAreaLocality, type CompSearchArea } from './comp-search-area.js';
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
  /** Original submitted input (preserved verbatim alongside any correction). */
  originalInput: string;
  /** The deterministic resolver path selected from supplied identifiers. */
  resolverPath: ResolverPathId;
  resolverReason: string;
  /** Bounded, ranked typo-correction candidates considered (with validation flags). */
  correctionCandidates: AddressCorrectionCandidate[];
  /** Smallest useful extra identifier to request when unverified/ambiguous. */
  smallestNextIdentifier?: string;
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
    /** Whether the lane started from supplied locality (concurrent) or a verified
     *  source locality (dependent release), or is waiting. */
    startedFrom: 'supplied_address' | 'verified_address' | 'waiting';
    readiness: { ready: boolean; reason: string };
    /** Actual Apify actor calls made by this lane (the zero-comp diagnostic). */
    apifyCallCount: number;
    /** Subject-property comps — populated ONLY after parcel verification. */
    comps: RetrievedComp[];
    /** Area-level provisional comps (held; never subject/valuation input unverified). */
    provisionalComps: RetrievedComp[];
    /** True when results are held as area-level only (parcel unverified). */
    provisional: boolean;
    needsVerification: NeedsVerificationComp[];
    /** True only when the LIVE Redfin provider was wired (not the stub). */
    compsLive: boolean;
    /** Actual Redfin provider status (not_connected/connected/no_comps/error/timeout). */
    providerStatus?: string;
    /** Zero-comp diagnosis by actual provider status, never assumed. */
    zeroCompClassification: 'has_comps' | 'lane_never_ran' | 'genuine_empty' | 'provider_error' | 'not_ready' | 'waiting';
    note: string;
    /** Set when the lane could not start from the current actor contract. */
    waitingReason?: string;
    terminalState?: string;
  };
  /** Async lane execution summary (proves concurrency vs dependent release). */
  lanes: {
    resolver: { ran: boolean };
    marketPulse: { ran: boolean };
    redfin: { started: boolean; startedFrom: 'supplied_address' | 'verified_address' | 'waiting'; concurrentWithResolver: boolean; apifyCallCount: number };
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
  opts: { entity?: LandosEntity; fields?: Partial<IntakeFields>; maxCorrectionCandidates?: number } = {},
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
  // ── Flexible intake -> resolver plan (strongest exact path; no field mandatory)
  const area = extractAreaSignals(input);
  const parsed = extractPropertyArgs(input) ?? {};
  const fields: IntakeFields = {
    address: opts.fields?.address ?? parsed.address ?? undefined,
    city: opts.fields?.city ?? parsed.city ?? area.city,
    state: opts.fields?.state ?? parsed.state ?? area.state,
    zip: opts.fields?.zip ?? parsed.zip,
    county: opts.fields?.county ?? parsed.county ?? area.county,
    fips: opts.fields?.fips ?? parsed.fips,
    apn: opts.fields?.apn ?? parsed.apn,
    owner: opts.fields?.owner ?? parsed.owner,
    propertyId: opts.fields?.propertyId ?? parsed.propertyid,
  };
  const plan = planResolver(fields);

  // Bounded, ranked typo-correction candidates (address paths only). Each tried
  // candidate counts against the provider-call ceiling.
  const maxCorr = Math.max(0, opts.maxCorrectionCandidates ?? 3);
  const corrections: AddressCorrectionCandidate[] = fields.address ? correctionCandidates(fields.address, { cap: maxCorr }) : [];
  const maxCalls = PROPERTY_ANALYSIS_MAX_PROVIDER_CALLS;

  // ── Concurrent lanes: Market Pulse (city/state, available now) || Resolver ───
  statuses.push('Running Local Market Pulse');
  statuses.push('Checking parcel identity');
  const marketPulsePromise = Promise.resolve().then(() =>
    mkMarketPulse({ city: fields.city, county: fields.county, state: fields.state, parcelVerified: false, nowIso }),
  );

  const resolverPromise = (async (): Promise<{ resolveResult: LpResolveResult | null; verification: DukeVerificationResult; validated: AddressCorrectionCandidate | null }> => {
    if (plan.path === 'none') {
      return { resolveResult: null, verification: mapResolveToVerification({ text: input, hasIdentifierInput: false, resolve: null, unavailable: false }), validated: null };
    }
    // Attempt the planned args first; only if not verified, try corrected address
    // variants (deterministic, capped). The first uniquely-verified wins.
    const attempts: Array<{ args: LpResolveArgs; correction?: AddressCorrectionCandidate }> = [{ args: plan.args }];
    if (plan.addressAvailableNow && fields.address) {
      const baseNorm = normalizeAddress(fields.address);
      for (const cand of corrections) {
        if (normalizeAddress(cand.corrected) === baseNorm) continue; // skip the no-op normalized form
        attempts.push({ args: { ...plan.args, address: cand.corrected }, correction: cand });
      }
    }
    let firstResult: LpResolveResult | null = null;
    let verifiedResult: LpResolveResult | null = null;
    let validated: AddressCorrectionCandidate | null = null;
    let lpErr = false;
    for (const att of attempts) {
      if (providerCalls.length >= maxCalls) break; // hard ceiling (incl. correction fan-out)
      let res: LpResolveResult | null = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        if (providerCalls.length >= maxCalls) break;
        try {
          res = await resolve(att.args, timeoutMs);
          providerCalls.push({ source: `LandPortal ${apiVersion}`, kind: att.correction ? 'exact_verification(corrected)' : 'exact_verification', rows: res.verified ? 1 : 0, spendUsd: 0 });
          logCost({ category: 'landportal_v2_verification', description: `LandPortal ${apiVersion} exact verification (non-credit)${att.correction ? ' [corrected]' : ''}`, amountUsd: 0 });
        } catch { lpErr = true; }
      }
      if (res) {
        if (!firstResult) firstResult = res;
        if (res.verified) { verifiedResult = res; if (att.correction) validated = { ...att.correction, validatedBySource: true }; break; }
      }
    }
    const finalResult = verifiedResult ?? firstResult;
    const verification = mapResolveToVerification({ text: input, hasIdentifierInput: true, resolve: finalResult, unavailable: lpErr && !finalResult });
    return { resolveResult: finalResult, verification, validated };
  })();

  // ── Provisional Redfin lane — STARTS CONCURRENTLY for usable address input ───
  // For a usable street address/city/state/ZIP it starts immediately (it does NOT
  // wait for verification). It uses a COMP-SEARCH-AREA (structurally walled from
  // parcel identity), so a coordinate-free locality (ZIP/city) search-area lets the
  // existing actor run now. For non-address input it auto-releases once the resolver
  // returns a source locality. Subject-comp inclusion stays gated on verification.
  const onSpend = (cc: ProviderCall) => {
    providerCalls.push(cc);
    logCost({ category: 'apify_comp_actor', description: `${cc.source} ${cc.kind} returned ${cc.rows} row(s)`, amountUsd: cc.spendUsd });
  };
  const apifyCount = () => providerCalls.filter((c) => /apify/i.test(c.source)).length;
  const suppliedArea = makeCompSearchArea({ address: fields.address, city: fields.city, state: fields.state, zip: fields.zip }, 'supplied');

  interface RedfinLaneOut {
    started: boolean;
    startedFrom: 'supplied_address' | 'verified_address' | 'waiting';
    readiness: { ready: boolean; reason: string };
    apifyCallCount: number;
    /** True only when registerLiveProviders actually wired the LIVE Redfin provider
     *  (not the stub). False = wiring gap. */
    compsLive: boolean;
    /** Actual Redfin provider status from retrieveComps: not_connected = stub/never
     *  ran; connected/no_comps = actor attempted; error/timeout = attempted+failed. */
    providerStatus?: string;
    provisionalComps: RetrievedComp[];
    needsVerification: NeedsVerificationComp[];
    note: string;
    providerNotes: string[];
    waitingReason?: string;
  }

  const runRedfinLane = async (area: CompSearchArea, startedFrom: 'supplied_address' | 'verified_address'): Promise<RedfinLaneOut> => {
    const readiness = deps.compsReadiness ? await deps.compsReadiness() : (await preflightLiveData({ env: resolveLiveDataEnv() })).comps;
    const rd = { ready: readiness.ready, reason: readiness.reason };
    if (!readiness.ready) {
      return { started: false, startedFrom, readiness: rd, apifyCallCount: 0, compsLive: false, provisionalComps: [], needsVerification: [], note: `Live Comps not ready: ${readiness.reason}`, providerNotes: [] };
    }
    if (providerCalls.length >= maxCalls) {
      return { started: false, startedFrom, readiness: rd, apifyCallCount: 0, compsLive: false, provisionalComps: [], needsVerification: [], note: 'Provider-call ceiling reached before comps.', providerNotes: [] };
    }
    const before = apifyCount();
    const loc = compSearchAreaLocality(area); // locality ONLY — never identity
    const query: CompQuery = { address: loc.address, city: loc.city, state: loc.state, zip: loc.zip, lookupDateIso: nowIso };
    try {
      const reg = deps.buildCompRegistry ? await deps.buildCompRegistry(onSpend) : await liveRegistry(onSpend);
      if (providerCalls.length > maxCalls) {
        return { started: true, startedFrom, readiness: rd, apifyCallCount: apifyCount() - before, compsLive: reg.compsLive, provisionalComps: [], needsVerification: [], note: 'Provider-call ceiling exceeded during comp lane; aborted (no fabricated comps).', providerNotes: [] };
      }
      const res = await retrieveComps(query, { registry: reg.registry, sourceTimeoutMs: timeoutMs });
      const providerNotes: string[] = [];
      for (const p of res.providers) providerNotes.push(`${p.providerId}: ${p.status} — ${p.note}`);
      for (const e of res.excluded) providerNotes.push(`excluded: ${e.reason}`);
      const providerStatus = res.providers.find((p) => p.providerId === 'redfin')?.status;
      return { started: true, startedFrom, readiness: rd, apifyCallCount: apifyCount() - before, compsLive: reg.compsLive, providerStatus, provisionalComps: res.comps, needsVerification: res.needsVerification, note: reg.compsLive ? res.note : `Live Redfin not wired (stub): ${reg.reason}`, providerNotes };
    } catch {
      return { started: true, startedFrom, readiness: rd, apifyCallCount: apifyCount() - before, compsLive: false, provisionalComps: [], needsVerification: [], note: 'Redfin comp lane failed (provider error).', providerNotes: [] };
    }
  };

  const redfinConcurrent = !!(suppliedArea && plan.addressAvailableNow);
  const redfinPromise: Promise<RedfinLaneOut> = (async () => {
    if (redfinConcurrent) return runRedfinLane(suppliedArea!, 'supplied_address'); // CONCURRENT start
    // Non-address identifier: release only after the resolver returns a locality.
    const rOut = await resolverPromise;
    const id = rOut.verification.identity;
    const verifiedArea = makeCompSearchArea({ address: id?.situsAddress, city: id?.city, state: id?.state }, 'verified_source');
    if (verifiedArea) return runRedfinLane(verifiedArea, 'verified_address');
    return { started: false, startedFrom: 'waiting', readiness: { ready: false, reason: 'no source-returned locality' }, apifyCallCount: 0, compsLive: false, provisionalComps: [], needsVerification: [], note: 'Redfin lane waiting: no source-returned address/locality to build a comp-search area.', providerNotes: [], waitingReason: 'current actor needs a ZIP/city or street to build a search area; none supplied or source-returned yet' };
  })();

  const [marketPulse, resolverOut, redfinLane] = await Promise.all([marketPulsePromise, resolverPromise, redfinPromise]);
  const resolveResult = resolverOut.resolveResult;
  const verification = resolverOut.verification;
  if (resolverOut.validated) {
    const i = corrections.findIndex((c) => c.corrected === resolverOut.validated!.corrected);
    if (i >= 0) corrections[i] = resolverOut.validated;
  }

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

  // ── Comps: subject-inclusion is gated on verification; provisional held otherwise
  statuses.push('Checking Live Comps readiness');
  if (redfinLane.started) statuses.push('Collecting Redfin sold comps');

  // Zero-comp diagnosis by ACTUAL provider status (not just success-count): a stub
  // registry or not_connected provider = the lane never ran (wiring gap); an
  // attempted actor that returned nothing = genuine empty; a thrown actor =
  // provider_error. Never assumed empty.
  let zeroCompClassification: PropertyAnalysisResult['redfinComps']['zeroCompClassification'];
  if (!redfinLane.readiness.ready) zeroCompClassification = 'not_ready';
  else if (redfinLane.startedFrom === 'waiting') zeroCompClassification = 'waiting';
  else if (redfinLane.provisionalComps.length > 0) zeroCompClassification = 'has_comps';
  else if (!redfinLane.compsLive || redfinLane.providerStatus === 'not_connected') zeroCompClassification = 'lane_never_ran';
  else if (redfinLane.providerStatus === 'error' || redfinLane.providerStatus === 'timeout') zeroCompClassification = 'provider_error';
  else zeroCompClassification = 'genuine_empty';

  // Provisional area comps become SUBJECT comps only after exact verification.
  const subjectComps: RetrievedComp[] = parcelVerified ? redfinLane.provisionalComps : [];
  const compNotes: string[] = [...redfinLane.providerNotes];
  for (const nv of redfinLane.needsVerification) compNotes.push(`verify in underwriting: ${(nv.verifyTags ?? []).join('; ')}`);
  if (!parcelVerified && redfinLane.provisionalComps.length > 0) {
    compNotes.push(`${redfinLane.provisionalComps.length} provisional area-level comp(s) held — NOT subject-property comps (parcel unverified).`);
  }
  const classNote =
    zeroCompClassification === 'lane_never_ran' ? ' [lane never ran — live Redfin not wired (stub/wiring gap), NOT an empty market]'
      : zeroCompClassification === 'provider_error' ? ' [Redfin actor attempted but errored/timed out — NOT an empty market]'
        : zeroCompClassification === 'genuine_empty' ? ' [Redfin actor ran and returned 0 rows — genuine empty; suspicious for a rural market]'
          : '';
  let terminalState: string | undefined;
  if (!redfinLane.readiness.ready) { terminalState = 'Live Comps not ready'; statuses.push('Live Comps not ready'); }
  else if (parcelVerified && subjectComps.length === 0) { terminalState = 'No usable comps returned'; statuses.push('No usable comps returned'); }

  for (const c of subjectComps) {
    sourceTable.push({ category: 'redfin_sold_comp', source: c.sourceLabel, status: 'sold', timestamp: c.saleDateIso, confidence: 'reported', note: c.sourceUrl });
  }

  const redfinComps: PropertyAnalysisResult['redfinComps'] = {
    ran: redfinLane.started,
    startedFrom: redfinLane.startedFrom,
    readiness: redfinLane.readiness,
    apifyCallCount: redfinLane.apifyCallCount,
    comps: subjectComps,
    provisionalComps: redfinLane.provisionalComps,
    provisional: !parcelVerified && redfinLane.provisionalComps.length > 0,
    needsVerification: redfinLane.needsVerification,
    compsLive: redfinLane.compsLive,
    providerStatus: redfinLane.providerStatus,
    zeroCompClassification,
    note: redfinLane.note + classNote,
    waitingReason: redfinLane.waitingReason,
    terminalState,
  };

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
    originalInput: input,
    resolverPath: plan.path,
    resolverReason: plan.reason,
    correctionCandidates: corrections,
    smallestNextIdentifier: parcelVerified ? undefined : smallestNextIdentifier(fields),
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
    lanes: {
      resolver: { ran: true },
      marketPulse: { ran: true },
      redfin: {
        started: redfinLane.started,
        startedFrom: redfinLane.startedFrom,
        concurrentWithResolver: redfinConcurrent,
        apifyCallCount: redfinLane.apifyCallCount,
      },
    },
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
