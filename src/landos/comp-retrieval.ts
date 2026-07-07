// LandOS comp retrieval — provider-agnostic drop-in interface + orchestration.
//
// This is the SLOT live sold-comp retrieval plugs into. It defines a clean
// provider interface (address/APN + acreage -> structured comps), the selection
// and recency rules, per-source timeouts, and a stub provider that returns
// "comp provider not yet connected" — it NEVER fabricates a comp. The live
// retrieval provider (planned: Apify Real Estate Comp Puller for anti-bot
// retrieval -> Gemma local parsing) is a documented drop-in registered here.
//
// HARD RULES:
//   - FAIL LOUD: no verifiable comps -> say so. Never invent price/date/$-per-acre.
//   - Every comp MUST carry a clickable source URL or it is dropped.
//   - Redfin/Zillow rolling 12 months from the lookup date. Trulia is excluded.
//   - 40+ acres ADDITIONALLY pulls LandWatch.
//   - LandPortal comps auto-pull until the ~5/day credit cap, then continue without.
//   - Rural / APN-only (no address) -> address-centric providers gracefully
//     return "no comps found from this source" (not an error, not invention).

import { addComp, type AddCompInput } from './comps.js';
import type { CompSourceLabel, LandosEntity } from './db.js';
import type { ConfirmedParcel } from './parcel-identity.js';

// ── Config (named values, not magic numbers) ───────────────────────────────

export const COMP_RECENCY_MONTHS = 12;
export const LANDWATCH_ACRE_THRESHOLD = 40;
export const LANDPORTAL_DAILY_COMP_CAP = 5;
/** Provider labels that are never used as comp sources. */
export const EXCLUDED_COMP_SOURCES = ['Trulia'] as const;

/** Web-retrieval budget (protects the under-2-minute target). Configurable. */
export const COMP_SOURCE_TIMEOUT_MS = 30_000;
export const COMP_MAX_RETRIES_PER_SOURCE = 1;
export const COMP_OVERALL_CAP_MS = 90_000;

export const COMP_PROVIDER_NOT_CONNECTED_NOTE = 'comp provider not yet connected';

/** Documented live drop-in: the planned retrieval path. Report-only until the
 *  provider + key are approved (no install/.env touched here). */
export const PLANNED_LIVE_COMP_PROVIDER =
  'Apify Real Estate Comp Puller (anti-bot retrieval) -> Gemma local parsing. ' +
  'Drop-in: implement CompProvider.retrieve() and register it; no engine change needed.';

export type CompProviderId = 'redfin' | 'zillow' | 'landwatch' | 'landportal';

export type CompProviderStatus =
  | 'connected'      // provider ran and returned (possibly zero) comps
  | 'not_connected'  // no live provider wired yet (stub)
  | 'no_comps'       // ran, found nothing applicable (e.g. APN-only rural)
  | 'timeout'
  | 'error';

export interface CompQuery {
  address?: string;
  apn?: string;
  city?: string;
  zip?: string;
  county?: string;
  state?: string;
  /** Subject acreage: drives LandWatch addition and off-target filtering. */
  acres?: number;
  /** ISO lookup date; the 12-month window is measured back from here. Defaults to now. */
  lookupDateIso?: string;
  /** Trusted centroid for the density-adaptive search (see comp-search-params).
   *  Coordinates are an OUTPUT of an authoritative match — never identity input.
   *  Absent -> the live provider returns a graceful no_comps (never invented). */
  centroid?: { lat: number; lng: number } | null;
  /** Tier of the supplied centroid: 'A' parcel-pinned (tight), 'B' area-level. */
  centroidTier?: 'A' | 'B';
}

export interface RetrievedComp {
  price: number;
  saleDateIso: string;
  acres: number | null;
  pricePerAcre: number | null;
  /** REQUIRED clickable URL. A comp without one is dropped, never shown. */
  sourceUrl: string;
  sourceLabel: CompProviderId;
  distanceMiles?: number | null;
  addressDesc?: string;
  // ── Optional classification signals (carried so the provider-agnostic comp
  //    classification engine can keep residential/manufactured/commercial sales
  //    out of a vacant-land valuation band). Absent -> classified 'unknown'. ──
  propertyTypeCode?: number | null;
  yearBuilt?: number | null;
  buildingAreaSqft?: number | null;
  useCode?: string | null;
  propertyTypeText?: string | null;
  descriptionText?: string | null;
}

export interface CompProviderResult {
  providerId: CompProviderId;
  status: CompProviderStatus;
  comps: RetrievedComp[];
  /** Kept-but-unverified comps (missing price/date/URL), loudly tagged. Never
   *  counted as verifiable comps; surfaced so nothing is silently dropped. */
  needsVerification?: NeedsVerificationComp[];
  note: string;
}

export interface CompProvider {
  id: CompProviderId;
  label: string;
  /** Address-centric providers need a street address to return anything. */
  supportsAddress: boolean;
  /** True if the provider can run from APN/owner without a street address. */
  supportsApnOnly: boolean;
  retrieve(query: CompQuery, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<CompProviderResult>;
}

export interface ExcludedComp {
  comp: RetrievedComp;
  reason: string;
}

/**
 * A comp we KEEP but cannot fully verify yet — state-agnostic. When a row is
 * missing a sold price, a sold date, or a clickable source URL, it is NOT
 * silently dropped and NOT guessed: it is kept here and loudly tagged
 * "verify in underwriting". Carries the richer detail fields so downstream
 * underwriting (in-park exclusion, dual-exit) can reason about it.
 */
export interface NeedsVerificationComp {
  sourceUrl: string;
  sourceLabel: CompProviderId;
  soldPriceUsd: number | null;
  soldDateIso: string | null;
  /** Captured for context only — NEVER used as the sold price. */
  listPriceUsd: number | null;
  acres: number | null;
  lotSizeSqft: number | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  daysOnMarket: number | null;
  propertyTypeCode: number | null;
  addressDesc?: string;
  distanceMiles?: number | null;
  /** Loud, surfaced reasons this comp needs underwriting verification. */
  verifyTags: string[];
}

export interface CompRetrievalResult {
  /** True only when at least one verifiable comp (with a URL) survived. */
  hasComps: boolean;
  comps: RetrievedComp[];
  /** Off-target / stale / URL-less comps, with the reason they were dropped. */
  excluded: ExcludedComp[];
  /** Kept-but-unverified comps (missing price/date/URL), loudly tagged
   *  "verify in underwriting". Aggregated across providers; never invented. */
  needsVerification: NeedsVerificationComp[];
  providers: Array<{ providerId: CompProviderId; status: CompProviderStatus; kept: number; note: string }>;
  lookupDateIso: string;
  /** Loud, honest summary. Says plainly when nothing verifiable was found. */
  note: string;
  /** Whether the overall budget cap was hit before all providers finished. */
  partial: boolean;
  landportalCompsUsedToday: number;
  landportalCapReached: boolean;
}

// ── Recency + validation ────────────────────────────────────────────────────

/** True when a sale date is within COMP_RECENCY_MONTHS back from the lookup date. */
export function isWithinRecencyWindow(saleDateIso: string, lookupDateIso: string, months = COMP_RECENCY_MONTHS): boolean {
  const sale = Date.parse(saleDateIso);
  const lookup = Date.parse(lookupDateIso);
  if (Number.isNaN(sale) || Number.isNaN(lookup)) return false;
  if (sale > lookup) return false; // a future sale date is not a valid sold comp
  const cutoff = new Date(lookup);
  cutoff.setMonth(cutoff.getMonth() - months);
  return sale >= cutoff.getTime();
}

function withPpa(c: RetrievedComp): RetrievedComp {
  if (c.pricePerAcre == null && typeof c.price === 'number' && typeof c.acres === 'number' && c.acres > 0) {
    return { ...c, pricePerAcre: Math.round((c.price / c.acres) * 100) / 100 };
  }
  return c;
}

/**
 * Filter raw comps: drop any without a clickable source URL or outside the
 * 12-month window, and exclude wildly off-target acreage (struck-through with a
 * reason). Returns kept + excluded. Pure.
 */
export function filterComps(
  comps: RetrievedComp[],
  query: CompQuery,
  lookupDateIso: string,
): { kept: RetrievedComp[]; excluded: ExcludedComp[] } {
  const kept: RetrievedComp[] = [];
  const excluded: ExcludedComp[] = [];
  const subjectAcres = query.acres;
  for (const raw of comps) {
    const c = withPpa(raw);
    if (!c.sourceUrl || !/^https?:\/\//i.test(c.sourceUrl)) {
      excluded.push({ comp: c, reason: 'no clickable source URL (dropped; never shown without a source)' });
      continue;
    }
    if (!isWithinRecencyWindow(c.saleDateIso, lookupDateIso)) {
      excluded.push({ comp: c, reason: `sale date ${c.saleDateIso} outside the rolling ${COMP_RECENCY_MONTHS}-month window` });
      continue;
    }
    if (typeof subjectAcres === 'number' && subjectAcres > 0 && typeof c.acres === 'number' && c.acres > 0) {
      const ratio = c.acres / subjectAcres;
      if (ratio > 4 || ratio < 0.25) {
        excluded.push({ comp: c, reason: `acreage ${c.acres} ac is wildly off-target vs subject ${subjectAcres} ac (>4x or <0.25x)` });
        continue;
      }
    }
    kept.push(c);
  }
  return { kept, excluded };
}

// ── Provider selection ──────────────────────────────────────────────────────

/**
 * Select which providers to query for a parcel. Redfin + Zillow always; add
 * LandWatch at 40+ acres; add LandPortal while under the daily comp cap. Trulia
 * is never selected. APN-only (no address) keeps address-centric providers (they
 * will gracefully return no_comps). Pure.
 */
export function selectCompProviders(
  query: CompQuery,
  registry: CompProvider[],
  opts: { landportalCompsUsedToday?: number } = {},
): CompProvider[] {
  const used = opts.landportalCompsUsedToday ?? 0;
  const want: CompProviderId[] = ['redfin', 'zillow'];
  if (typeof query.acres === 'number' && query.acres >= LANDWATCH_ACRE_THRESHOLD) want.push('landwatch');
  if (used < LANDPORTAL_DAILY_COMP_CAP) want.push('landportal');

  const excluded = new Set<string>(EXCLUDED_COMP_SOURCES.map((s) => s.toLowerCase()));
  return want
    .map((id) => registry.find((p) => p.id === id))
    .filter((p): p is CompProvider => !!p && !excluded.has(p.label.toLowerCase()));
}

// ── Stub + drop-in providers ────────────────────────────────────────────────

/** A provider that is not wired to a live source yet. Returns not_connected and
 *  ZERO comps — it never fabricates. This is the default until a real provider
 *  (e.g. the Apify->Gemma drop-in) is registered. */
export function makeStubCompProvider(id: CompProviderId, label: string, supportsApnOnly = false): CompProvider {
  return {
    id,
    label,
    supportsAddress: true,
    supportsApnOnly,
    async retrieve(): Promise<CompProviderResult> {
      return { providerId: id, status: 'not_connected', comps: [], note: COMP_PROVIDER_NOT_CONNECTED_NOTE };
    },
  };
}

/** The default registry: all four sources as stubs (no Trulia). Swap any entry
 *  for a live provider without changing the engine. */
export function defaultCompRegistry(): CompProvider[] {
  return [
    makeStubCompProvider('redfin', 'Redfin'),
    makeStubCompProvider('zillow', 'Zillow'),
    makeStubCompProvider('landwatch', 'LandWatch'),
    makeStubCompProvider('landportal', 'LandPortal', true),
  ];
}

// ── Orchestration ───────────────────────────────────────────────────────────

async function runWithTimeout(p: CompProvider, query: CompQuery, timeoutMs: number, retries: number): Promise<CompProviderResult> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<CompProviderResult>((resolve) => {
      timer = setTimeout(() => {
        ac.abort();
        resolve({ providerId: p.id, status: 'timeout', comps: [], note: `timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    });
    try {
      const res = await Promise.race<CompProviderResult>([p.retrieve(query, { timeoutMs, signal: ac.signal }), timeoutP]);
      if (timer) clearTimeout(timer);
      if (res.status !== 'timeout' || attempt === retries) return res;
    } catch {
      if (timer) clearTimeout(timer);
      if (attempt === retries) return { providerId: p.id, status: 'error', comps: [], note: 'provider threw; not retried' };
    }
  }
  return { providerId: p.id, status: 'error', comps: [], note: 'exhausted retries' };
}

/**
 * Retrieve sold comps across the selected providers, honoring per-source
 * timeouts, one retry, and an overall budget cap. Aggregates, applies recency +
 * URL + off-target filtering, and FAILS LOUD when nothing verifiable is found.
 * The provider registry is injected so tests need no live call.
 */
export async function retrieveComps(
  query: CompQuery,
  opts: {
    registry?: CompProvider[];
    landportalCompsUsedToday?: number;
    sourceTimeoutMs?: number;
    retriesPerSource?: number;
    overallCapMs?: number;
    now?: () => number;
  } = {},
): Promise<CompRetrievalResult> {
  const registry = opts.registry ?? defaultCompRegistry();
  const lookupDateIso = query.lookupDateIso ?? new Date().toISOString();
  const sourceTimeoutMs = opts.sourceTimeoutMs ?? COMP_SOURCE_TIMEOUT_MS;
  const retries = opts.retriesPerSource ?? COMP_MAX_RETRIES_PER_SOURCE;
  const overallCapMs = opts.overallCapMs ?? COMP_OVERALL_CAP_MS;
  const now = opts.now ?? (() => Date.now());
  const usedToday = opts.landportalCompsUsedToday ?? 0;

  const providers = selectCompProviders(query, registry, { landportalCompsUsedToday: usedToday });
  const hasAddress = !!(query.address && query.address.trim());

  const start = now();
  const providerSummaries: CompRetrievalResult['providers'] = [];
  const allKept: RetrievedComp[] = [];
  const allExcluded: ExcludedComp[] = [];
  const allNeedsVerification: NeedsVerificationComp[] = [];
  let partial = false;

  for (const p of providers) {
    if (now() - start >= overallCapMs) {
      partial = true;
      providerSummaries.push({ providerId: p.id, status: 'timeout', kept: 0, note: 'overall budget cap reached before this source ran' });
      continue;
    }
    // Address-centric provider with no address on a rural/APN-only parcel:
    // graceful no_comps, never an error or invented comp.
    if (!hasAddress && p.supportsAddress && !p.supportsApnOnly) {
      providerSummaries.push({ providerId: p.id, status: 'no_comps', kept: 0, note: 'no street address: address-centric source returns no comps from this source' });
      continue;
    }
    const res = await runWithTimeout(p, query, sourceTimeoutMs, retries);
    const { kept, excluded } = filterComps(res.comps, query, lookupDateIso);
    allKept.push(...kept);
    allExcluded.push(...excluded);
    if (res.needsVerification && res.needsVerification.length > 0) allNeedsVerification.push(...res.needsVerification);
    providerSummaries.push({ providerId: p.id, status: res.status, kept: kept.length, note: res.note });
  }

  const hasComps = allKept.length > 0;
  const landportalSelected = providers.some((p) => p.id === 'landportal');
  const note = hasComps
    ? `${allKept.length} verifiable comp(s) within the last ${COMP_RECENCY_MONTHS} months, each with a source URL.`
    : 'No verifiable comps found from connected sources. Not invented. Connect a live comp provider or add comps manually.';

  return {
    hasComps,
    comps: allKept,
    excluded: allExcluded,
    needsVerification: allNeedsVerification,
    providers: providerSummaries,
    lookupDateIso,
    note,
    partial,
    landportalCompsUsedToday: usedToday,
    landportalCapReached: usedToday >= LANDPORTAL_DAILY_COMP_CAP && !landportalSelected,
  };
}

// ── Department entry points (ConfirmedParcel capability gate) ────────────────
// Comp retrieval has two honest scopes. PARCEL-ATTRIBUTED comps (tied to the
// subject parcel, feeding valuation/strategy/offer) are a downstream department
// output, so they must be generated from a ConfirmedParcel — it is impossible to
// retrieve parcel-attributed comps without passing the gate. AREA comps
// (countywide / near-ZIP $/acre context) stay available to Candidate parcels,
// clearly weaker and never attributed to a specific parcel.

type RetrieveCompsOpts = Parameters<typeof retrieveComps>[1];

/**
 * The gated, parcel-attributed comp retrieval. Requires a ConfirmedParcel; the
 * confirmed identity is what authorizes attributing comps to the subject parcel.
 * No other path reaches this scope — the capability type is the gate.
 */
export async function retrieveConfirmedParcelComps(
  _parcel: ConfirmedParcel,
  query: CompQuery,
  opts: RetrieveCompsOpts = {},
): Promise<CompRetrievalResult> {
  return retrieveComps(query, opts);
}

/**
 * Candidate-safe AREA comps (countywide / near-ZIP context). Never attributed to
 * a specific parcel. Available before confirmation so an unresolved lead is still
 * usable for market context.
 */
export async function retrieveAreaComps(
  query: CompQuery,
  opts: RetrieveCompsOpts = {},
): Promise<CompRetrievalResult> {
  return retrieveComps(query, opts);
}

/** Persist retrieved comps onto a Deal Card (reuses comps.ts storage). Only
 *  comps that survived filtering (URL + recency) are stored. Returns the count. */
export function saveRetrievedComps(entity: LandosEntity, dealCardId: number, comps: RetrievedComp[], cardId?: number): number {
  const labelMap: Record<CompProviderId, CompSourceLabel> = {
    redfin: 'Redfin', zillow: 'Zillow', landwatch: 'LandWatch', landportal: 'LandPortal',
  };
  let n = 0;
  for (const c of comps) {
    if (!c.sourceUrl) continue; // never store an unsourced comp
    const input: AddCompInput = {
      entity, dealCardId, cardId,
      sourceLabel: labelMap[c.sourceLabel] ?? 'Other',
      sourceUrl: c.sourceUrl,
      addressDesc: c.addressDesc,
      price: c.price,
      priceKind: 'sale',
      saleOrListDate: c.saleDateIso,
      acres: c.acres ?? undefined,
      pricePerAcre: c.pricePerAcre ?? undefined,
      // Auto-retrieved comps are market_reference (never a verified sale) until
      // a human confirms; they never verify parcel identity.
      status: 'market_reference',
      addedBy: `comp-retrieval/${c.sourceLabel}`,
    };
    addComp(input);
    n++;
  }
  return n;
}
