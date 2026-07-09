// Deal Card — DD + Market + Strategy operational report engine.
//
// This is the operational workflow that turns the three Deal Card worksheets
// (Due Diligence + Research, Market Research, Strategy) into a single runnable
// report. From one Deal Card action it:
//   1. Builds parcel identity inputs from the Deal Card (DD worksheet + linked
//      property cards + people) — address, APN, county/state, owner, LP URL,
//      LandPortal property id + FIPS.
//   2. Runs the EXISTING safe, non-credit LandPortal exact resolve
//      (runDukeVerification -> injected lpResolveForPreflight). This is NOT a
//      comp credit, NOT a comp report tool, NOT GIS scraping, and never uses
//      coordinates/proximity/imagery to identify a parcel.
//   3. Builds the Due Diligence + Research leg (property-level): source-labeled
//      facts when verified; "Local Area Context, Not Parcel Verified" otherwise.
//   4. Builds the Market Research leg (market-level): structured non-paid source
//      targets + a market follow-up checklist for manual/source entry. It never
//      verifies parcel identity and never fabricates demand/comps/pricing.
//   5. Applies the EXISTING Strategy logic (duke-analysis + offer-engine) and
//      builds the Strategy leg (decision-level): candidates, most viable exit,
//      offer readiness, blockers, next confirmations, per-exit notes, target
//      profit baseline. It never invents a value, comp, EV, or final offer.
//   6. Updates the three worksheets (non-destructively: lists are unioned,
//      manual deep notes are preserved) and persists a practical local report
//      that survives reload.
//
// Hard rules (mirrors LandOS build operating rules):
//   - Departments stay separate: DD is property-level, Market is market-level,
//     Strategy is decision-level. Market never verifies a parcel; DD never
//     becomes a market conclusion; Strategy never fabricates comps/EVs/offers.
//   - No comp credit, no comp report tool, no paid API, no .env/secret read.
//   - No fabricated parcel facts, comps, solds, actives, demand, days-on-market,
//     pricing, EVs, or offers. Missing data is an honest gap, never invented.
//   - File-backed SQLite (store/landos.db, gitignored). No external system
//     mutation, no property-specific work product in the repo.
//
// The engine is pure orchestration with an INJECTED resolver so it is fully
// unit-testable without any live network call; the route wires the real
// non-credit lpResolveForPreflight.

import {
  getLandosDb,
  landosAudit,
  DEAL_CARD_REPORT_STATUSES,
  type DealCardReportStatus,
  type StrategyOfferReadiness,
  type LandosEntity,
} from './db.js';
import { getDealCard, type DealCardDetail } from './deal-card.js';
import { getDealCardDd, upsertDealCardDd, type DealCardDdView, type DealCardSourceLink, type DealCardDdPatch } from './deal-card-dd.js';
import { getDealCardMarket, upsertDealCardMarket, type DealCardMarketView, type DealCardMarketPatch } from './deal-card-market.js';
import { getDealCardStrategy, upsertDealCardStrategy, type DealCardStrategyView, type DealCardStrategyPatch } from './deal-card-strategy.js';
import { runDukeVerification, type DukeVerificationResult } from './duke-verification-bridge.js';
import { confirmParcelForDeal, confirmParcel, writeParcelIdentity, type ConfirmedParcel } from './parcel-identity.js';
import { analyzeConfirmedParcelStrategy, blockedStrategyAnalysis } from './duke-analysis.js';
import { GLOBAL_MIN_NET_PROFIT_USD, SUBDIVISION_MIN_NET_PROFIT_USD } from './offer-engine.js';
import { SOURCE_ADAPTERS, extractAreaSignals, marketPulseEligibility } from './source-adapters.js';
import { emptyLpPropertySummary, type LpResolveArgs, type LpResolveResult } from './landportal-client.js';
import type { DukePropertyData, DukeLandFacts, DukeValuation, DukeSimilars } from './duke-property-data.js';
import { buildVisualPropertyContext, type VisualPropertyContext, type VisualService } from './providers/google-visual.js';
import { loadCardVisualCapture, loadPropertyInspection, saveCardVisualCapture, upsertCardFromDukeRun, type CardVisualAsset } from './property-card.js';
import { buildParcelFactSheet, type ParcelFactSheet } from './landportal-facts.js';
import { addComp, listComps } from './comps.js';
import { attachCardActivity } from './property-card.js';
import type { ZillowFetchInput, ZillowCompsResult } from './zillow-land-comps.js';
import type { RedfinFetchInput, RedfinCompsResult } from './redfin-land-comps.js';
import { researchBrowserComps, type CompResearchResult } from './browser-comp-research.js';
import type { BrowserDriver } from './browser-intelligence.js';
import { capturePropertyVisuals, type CaptureInput, type CaptureResult } from './google-visual-capture.js';
import { googleVisualConfigured, resolveGoogleVisualEnv } from './providers/google-visual.js';
import { buildDdChecklist, mergeGovDdRows, summarizeDdCompleteness, type DdChecklistRow, type DdCompleteness } from './dd-checklist.js';
import { fetchFemaFlood, fetchNwiWetlands, fetchUsgsSlope, type GovFetch } from './providers/gov-dd-providers.js';
import { fetchCensusDemographics, emptyCensus, type CensusDemographics, type CensusFetch } from './census-demographics.js';
import { buildLandPpaBand } from './comp-valuation-band.js';
import type { CompClass } from './comp-classification.js';
import { computeLandScore, type LandScoreResult } from './land-score.js';

export interface MarketCompView {
  price: number; saleDateIso: string; acres: number | null; pricePerAcre: number | null; sourceUrl: string; sourceLabel: string; addressDesc?: string;
  // ── Classification signals (set at provider mapping time) + the resulting
  //    class. The comp-classification engine uses these to keep residential/
  //    manufactured/commercial sales out of the vacant-land valuation band. ──
  yearBuilt?: number | null;
  buildingAreaSqft?: number | null;
  propertyTypeCode?: number | null;
  useCode?: string | null;
  propertyTypeText?: string | null;
  descriptionText?: string | null;
  /** Resulting class (vacant_land/farm/residential/manufactured/commercial/unknown/exclude). */
  compClass?: CompClass;
  /** Plain reason for the class (shown in the UI; loud when excluded). */
  classReason?: string;
}
export interface MarketCompsView {
  status: 'collected' | 'no_comps' | 'not_configured' | 'no_area' | 'error' | 'not_run';
  /** Which provider produced the comps actually shown ('realie' | 'apify' | 'none'). */
  primaryProvider: 'realie' | 'apify' | 'browser_research' | 'none';
  /** Failover chain tried, e.g. ['realie:collected'] or ['realie:no_comps','apify:error']. */
  providerChain: string[];
  soldCount: number;
  activeCount: number;
  sold: MarketCompView[];
  active: MarketCompView[];
  /** Supplemental sold comps from a secondary provider (e.g. Zillow) — attributed,
   *  kept OUT of the primary (Realie) price-per-acre band to avoid polluting it. */
  supplementalSold: MarketCompView[];
  /** Realie valuation-only rows (market value, no usable sale) — kept separate. */
  valuation: MarketCompView[];
  metrics: { soldAvgPrice: number | null; soldAvgPpa: number | null; soldMedianPpa: number | null; ppaMin: number | null; ppaMax: number | null; activeAvgPrice: number | null; domMedian: number | null };
  /** Sparse-market explanation when sold comps are thin/absent. */
  sparseExplanation: string | null;
  providers: Array<{ providerId: string; status: string; kept: number }>;
  source: string;
  timestamp: string | null;
  note: string;
  /** Read-only Zillow/Redfin browser research fallback: the exact search path,
   *  per-source attempt outcomes, acreage/geography expansion, and honest
   *  strength. Present when the browser researcher ran (primary providers thin). */
  research?: CompResearchResult | null;
}
function emptyMarketComps(): MarketCompsView {
  return { status: 'not_run', primaryProvider: 'none', providerChain: [], soldCount: 0, activeCount: 0, sold: [], active: [], supplementalSold: [], valuation: [], metrics: { soldAvgPrice: null, soldAvgPpa: null, soldMedianPpa: null, ppaMin: null, ppaMax: null, activeAvgPrice: null, domMedian: null }, sparseExplanation: null, providers: [], source: 'multi-provider', timestamp: null, note: 'Not run.', research: null };
}
const median = (ns: number[]): number | null => { if (!ns.length) return null; const s = [...ns].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
// Provider gating rule: general read-only comp enrichment is ALLOWED. Realie
// (Really.ai API), Apify Redfin/Zillow browser extraction, and HomeHarvest are
// NOT gated here — each self-gates on its own configuration (API key / actor
// token) and reports not_configured honestly when unwired. The ONLY comp-related
// gated actions are the paid LandPortal comp report and paid LandPortal slope
// report, which are separate tools (see comps.ts / mcp-comp-guard) and are never
// invoked from this chain.

/**
 * Market comps with PROVIDER FAILOVER: 1) Realie premium comparables (primary —
 * row-level, by coordinates, authorized on our key), 2) Apify Redfin fallback,
 * else honest provider_error / no_comps. Every comp keeps its provider. Sparse
 * rural/infill markets get a price-per-acre band + explanation instead of silence.
 */
async function liveMarketComps(q: CompQueryLite, confirmed?: ConfirmedParcel | null, opts: { researchDriver?: BrowserDriver } = {}): Promise<MarketCompsView> {
  const chain: string[] = [];
  const RESEARCH_TARGET = 5;
  const finalize = async (v: MarketCompsView): Promise<MarketCompsView> => {
    // ── Supplemental Zillow lane (active listings + supplemental sold). Active is
    //    NEVER labeled sold; Zillow sold kept separate from Realie's PPA band.
    //    Read-only browser extraction — allowed; self-gates on APIFY_TOKEN /
    //    LANDOS_ZILLOW_ACTOR and reports not_authorized/not_configured honestly. ──
    if (typeof q.lat === 'number' && typeof q.lng === 'number') {
      const { fetchZillowComps } = await import('./zillow-comps.js');
      const { withEnvFileSecrets } = await import('../env.js');
      const zc = await fetchZillowComps({ lat: q.lat, lng: q.lng, zip: q.zip }, { env: withEnvFileSecrets(['APIFY_TOKEN', 'LANDOS_ZILLOW_ACTOR']) });
      chain.push(`zillow:${zc.status}`);
      if (zc.status === 'collected') {
        const zView = (c: { price: number | null; acres: number | null; pricePerAcre: number | null; sourceUrl: string | null; city: string | null; state: string | null; saleOrListDateIso: string | null }): MarketCompView => ({ price: c.price ?? 0, saleDateIso: c.saleOrListDateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: c.sourceUrl ?? '', sourceLabel: 'zillow', addressDesc: [c.city, c.state].filter(Boolean).join(', ') || undefined });
        v.active = zc.active.map(zView);
        v.supplementalSold = zc.sold.map(zView);
        v.providers.push({ providerId: 'zillow', status: 'connected', kept: zc.active.length + zc.sold.length });
        if (v.status !== 'collected' && (zc.active.length > 0 || zc.sold.length > 0)) v.status = 'collected';
      } else {
        // Honest readiness: record WHY Zillow produced nothing (not_authorized /
        // not_configured / no_results / error) instead of silently omitting it.
        v.providers.push({ providerId: 'zillow', status: zc.status, kept: 0 });
      }
    }
    // ── HomeHarvest open-source land lane (Realtor.com, MIT, no key). Pulls
    //    raw-land sold comps (merged into the band) + land actives. Reduces
    //    dependence on the paid Apify lane. Gated off via LANDOS_HOMEHARVEST=off. ──
    const hhDisabled = (process.env.LANDOS_HOMEHARVEST ?? 'on').toLowerCase() === 'off' || !!process.env.VITEST;
    if (!hhDisabled && (q.address || (q.state && (q.city || q.zip)) || (q.county && q.state))) {
      try {
        const { fetchHomeHarvestComps } = await import('./providers/homeharvest-comp-provider.js');
        const hh = await fetchHomeHarvestComps({ address: q.address, city: q.city, zip: q.zip, county: q.county, state: q.state, acres: q.acres }, {});
        chain.push(`homeharvest:${hh.status}`);
        if (hh.status === 'collected') {
          const toView = (c: { price: number; saleDateIso: string; acres: number | null; pricePerAcre: number | null; sourceUrl: string; addressDesc?: string; yearBuilt: number | null; buildingAreaSqft: number | null; propertyTypeText: string | null; descriptionText: string | null }): MarketCompView => ({ price: c.price, saleDateIso: c.saleDateIso, acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: c.sourceUrl, sourceLabel: 'homeharvest', addressDesc: c.addressDesc, yearBuilt: c.yearBuilt, buildingAreaSqft: c.buildingAreaSqft, propertyTypeText: c.propertyTypeText, descriptionText: c.descriptionText });
          // Sold land comps join the band set (classified raw-land already);
          // actives augment the active-listing context.
          v.sold = [...v.sold, ...hh.sold.map(toView)];
          v.active = [...v.active, ...hh.active.map(toView)];
          // Days-on-market from HomeHarvest sold land (liquidity signal) when no
          // other provider supplied it.
          if (v.metrics.domMedian == null) {
            const hhDoms = hh.sold.map((s) => s.daysOnMarket).filter((d): d is number => typeof d === 'number' && d > 0);
            if (hhDoms.length > 0) v.metrics.domMedian = median(hhDoms);
          }
          v.providers.push({ providerId: 'homeharvest', status: 'connected', kept: hh.sold.length + hh.active.length });
          if (v.status !== 'collected' && (hh.sold.length > 0 || hh.active.length > 0)) v.status = 'collected';
        } else {
          v.providers.push({ providerId: 'homeharvest', status: hh.status, kept: 0 });
        }
      } catch {
        chain.push('homeharvest:error');
        v.providers.push({ providerId: 'homeharvest', status: 'error', kept: 0 });
      }
    }

    // ── Zillow + Redfin read-only BROWSER research fallback ─────────────────
    //    When the configured API/actor providers came up thin (or errored), do
    //    what an acquisitions assistant does: research Zillow + Redfin for vacant
    //    land in the subject area — sold first, subject acreage band first, then
    //    honestly expand acreage + geography. Never fabricates; never logs in;
    //    never triggers the paid LandPortal comp report. Records the full search
    //    path + per-source outcome so an actor failure never looks like a total
    //    comp failure.
    const primaryCount = v.sold.length + v.active.length + v.supplementalSold.length;
    if (primaryCount < RESEARCH_TARGET && (q.address || q.city || q.zip || q.county)) {
      try {
        const research = await researchBrowserComps(
          { address: q.address, lat: q.lat, lng: q.lng, city: q.city, state: q.state, zip: q.zip, county: q.county, acres: q.acres ?? null },
          { driver: opts.researchDriver, targetCount: RESEARCH_TARGET },
        );
        v.research = research;
        chain.push(`browser_research:${research.strength}`);
        // Merge researched comps by status; keep provider label for provenance.
        const toView = (c: { price: number | null; dateIso: string | null; acres: number | null; pricePerAcre: number | null; url: string | null; source: string; location: string | null }): MarketCompView => ({ price: c.price ?? 0, saleDateIso: c.dateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: c.url ?? '', sourceLabel: c.source, addressDesc: c.location ?? undefined });
        const soldR = research.comps.filter((c) => c.status === 'sold');
        const activeR = research.comps.filter((c) => c.status !== 'sold');
        if (soldR.length) v.sold = [...v.sold, ...soldR.map(toView)];
        if (activeR.length) v.active = [...v.active, ...activeR.map(toView)];
        // Per-source provider rows (aggregate outcome), for the provider table.
        for (const src of ['zillow', 'redfin'] as const) {
          const a = research.attempts.filter((x) => x.source === src);
          if (a.length === 0) continue;
          const kept = a.reduce((n, x) => n + x.compCount, 0);
          const best = a.find((x) => x.outcome === 'collected' || x.outcome === 'partial')?.outcome ?? a[0].outcome;
          v.providers.push({ providerId: `${src}_browser`, status: kept > 0 ? 'connected' : best, kept });
        }
        if (v.status !== 'collected' && research.comps.length > 0) { v.status = 'collected'; if (v.primaryProvider === 'none') v.primaryProvider = 'browser_research'; }
      } catch (e) {
        chain.push('browser_research:error');
        v.providers.push({ providerId: 'browser_research', status: 'error', kept: 0 });
      }
    }

    v.providerChain = chain;
    v.activeCount = v.active.length;
    // ── Provider-agnostic comp classification at the valuation seam ──────────
    //    Build the per-acre band from RAW LAND only. Residential/manufactured/
    //    commercial/nominal sales can never inflate it (the engine-wide fix);
    //    each sold comp is tagged with its class + reason for the UI.
    const band = buildLandPpaBand(v.sold, undefined, { subjectAcres: q.acres ?? null });
    for (const { comp, classification } of [...band.rawLand, ...band.unknown, ...band.excluded]) {
      comp.compClass = classification.class;
      comp.classReason = classification.reason;
    }
    v.metrics.soldAvgPrice = band.metrics.soldAvgPrice;
    v.metrics.soldAvgPpa = band.metrics.soldAvgPpa;
    v.metrics.soldMedianPpa = band.metrics.soldMedianPpa;
    v.metrics.ppaMin = band.metrics.ppaMin;
    v.metrics.ppaMax = band.metrics.ppaMax;
    // soldCount reflects the comps that actually drive the band (raw land, plus
    // unknowns only when the fallback was needed) — not contaminating rows.
    v.soldCount = band.bandComps.length;
    const excludedNote = band.excluded.length > 0 ? ` ${band.note}` : '';
    if (band.bandComps.length > 0 && band.bandComps.length < 3) v.sparseExplanation = `Sparse market: only ${band.bandComps.length} land comp(s) in the band. Lean on the median price-per-acre ($${v.metrics.soldMedianPpa}/ac) + valuation/area context; widen radius/timeframe before pricing.${excludedNote}`;
    else if (band.bandComps.length === 0 && v.valuation.length > 0) v.sparseExplanation = `No raw-land sold comps; using Realie valuation-only rows + area context. Confirm with a wider comp search before pricing.${excludedNote}`;
    else if (band.bandComps.length === 0 && v.sold.length > 0) v.sparseExplanation = `Sold comps were found but none classify as raw land (all residential/improved/unknown).${excludedNote} Widen the comp search or verify type before pricing.`;
    else if (band.excluded.length > 0) v.sparseExplanation = excludedNote.trim();
    return v;
  };

  // ── 1) Realie (Really.ai) premium comparables (primary) ─────────────────────
  //    Allowed general enrichment: runs whenever the parcel has coordinates and a
  //    REALIE_API_KEY is configured; fetchRealieComps returns not_configured
  //    honestly when the key is absent. Not gated by any paid-report switch.
  if (typeof q.lat === 'number' && typeof q.lng === 'number') {
    const { fetchRealieComps } = await import('./realie-comps.js');
    const { withEnvFileSecrets } = await import('../env.js');
    const rc = await fetchRealieComps(q.lat, q.lng, { env: withEnvFileSecrets(['REALIE_API_KEY', 'REALIE_API_BASE']), radiusMiles: 10, maxResults: 30, subjectAcres: q.acres ?? null, subjectImproved: q.improved === true });
    chain.push(`realie:${rc.status}`);
    if (rc.status === 'collected' && rc.sold.length > 0) {
      const toView = (c: { soldPrice: number | null; soldDateIso: string | null; acres: number | null; pricePerAcre: number | null; address: string | null; parcelId: string | null; yearBuilt?: number | null; useCode?: string | null; buildingAreaSqft?: number | null }): MarketCompView => ({ price: c.soldPrice ?? 0, saleDateIso: c.soldDateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: '', sourceLabel: 'realie', addressDesc: c.address ?? c.parcelId ?? undefined, yearBuilt: c.yearBuilt ?? null, useCode: c.useCode ?? null, buildingAreaSqft: c.buildingAreaSqft ?? null });
      return await finalize({ ...emptyMarketComps(), status: 'collected', primaryProvider: 'realie', sold: rc.sold.map(toView), valuation: rc.valuation.map(toView), providers: [{ providerId: 'realie', status: 'connected', kept: rc.sold.length }], source: 'Realie premium comparables', timestamp: new Date().toISOString(), note: rc.note });
    }
    // Realie valuation-only (no sold) — keep for context but still try Apify for sold.
    if (rc.status === 'collected' && rc.valuation.length > 0) {
      const toView = (c: { soldPrice: number | null; soldDateIso: string | null; acres: number | null; pricePerAcre: number | null; address: string | null }): MarketCompView => ({ price: c.soldPrice ?? 0, saleDateIso: c.soldDateIso ?? '', acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: '', sourceLabel: 'realie', addressDesc: c.address ?? undefined });
      const valuationView = rc.valuation.map(toView);
      const apify = await apifyComps(q, chain, confirmed);
      if (apify.status === 'collected') { apify.valuation = valuationView; return await finalize(apify); }
      return await finalize({ ...emptyMarketComps(), status: 'collected', primaryProvider: 'realie', sold: [], valuation: valuationView, providers: [{ providerId: 'realie', status: 'connected', kept: 0 }], source: 'Realie premium comparables (valuation-only)', timestamp: new Date().toISOString(), note: rc.note });
    }
  } else {
    chain.push('realie:no_coords');
  }

  // ── 2) Apify Redfin fallback ───────────────────────────────────────────────
  return await finalize(await apifyComps(q, chain, confirmed));
}

async function apifyComps(q: CompQueryLite, chain: string[], confirmed?: ConfirmedParcel | null): Promise<MarketCompsView> {
  const { registerLiveProviders } = await import('./providers/register-live-providers.js');
  const { retrieveConfirmedParcelComps, retrieveAreaComps } = await import('./comp-retrieval.js');
  const reg = await registerLiveProviders({ onSpend: () => {} });
  if (!reg.compsLive) { chain.push('apify:not_configured'); return { ...emptyMarketComps(), status: 'not_configured', note: `Apify not wired: ${reg.reason}` }; }
  if (!q.state || !(q.address || q.city || q.zip)) { chain.push('apify:no_area'); return { ...emptyMarketComps(), status: 'no_area', note: 'No address/city/ZIP + state to search comps.' }; }
  // Parcel-attributed comps require the ConfirmedParcel capability; a Candidate
  // parcel gets AREA comps only (never parcel-attributed).
  const compQuery = { address: q.address, city: q.city, county: q.county, state: q.state, zip: q.zip, acres: q.acres, centroid: typeof q.lat === 'number' && typeof q.lng === 'number' ? { lat: q.lat, lng: q.lng } : null, centroidTier: 'A' as const };
  const res = confirmed
    ? await retrieveConfirmedParcelComps(confirmed, compQuery, { registry: reg.registry })
    : await retrieveAreaComps(compQuery, { registry: reg.registry });
  const sold: MarketCompView[] = res.comps.map((c) => ({ price: c.price, saleDateIso: c.saleDateIso, acres: c.acres, pricePerAcre: c.pricePerAcre, sourceUrl: c.sourceUrl, sourceLabel: c.sourceLabel, addressDesc: c.addressDesc, propertyTypeCode: c.propertyTypeCode ?? null, descriptionText: c.descriptionText ?? null, yearBuilt: c.yearBuilt ?? null, useCode: c.useCode ?? null, buildingAreaSqft: c.buildingAreaSqft ?? null, propertyTypeText: c.propertyTypeText ?? null }));
  const doms = res.needsVerification.map((nn) => nn.daysOnMarket).filter((d): d is number => typeof d === 'number');
  const anyConnected = res.providers.some((p) => p.status === 'connected' || p.status === 'no_comps');
  const anyError = res.providers.some((p) => p.status === 'error' || p.status === 'timeout');
  const status: MarketCompsView['status'] = res.hasComps ? 'collected' : (anyError && !anyConnected ? 'error' : 'no_comps');
  chain.push(`apify:${status}`);
  const providerNote = anyError && !res.hasComps ? ' Upstream Apify comp actor failed (error/timeout) — not a confirmed empty market.' : '';
  return {
    ...emptyMarketComps(),
    status, primaryProvider: res.hasComps ? 'apify' : 'none',
    sold: sold.slice(0, 25), active: [], valuation: [],
    metrics: { ...emptyMarketComps().metrics, domMedian: median(doms) },
    providers: res.providers.map((p) => ({ providerId: p.providerId, status: p.status, kept: p.kept })),
    source: 'Apify Redfin', timestamp: new Date().toISOString(), note: res.note + providerNote,
  };
}

type GovDdView = DealCardReportView['govDd'];
function emptyGovDd(): GovDdView {
  const nr = (kind: string) => ({ status: 'not_run', note: `Not run (no verified parcel coordinates) — ${kind} Needs Verification.`, source: null, timestamp: null });
  return {
    flood: { ...nr('flood'), zone: null },
    wetlands: { ...nr('wetlands'), type: null },
    slope: { ...nr('slope'), slopeDeg: null },
  };
}

function buildIdentityChecklistRows(verification: DukeVerificationResult): DdChecklistRow[] {
  const id = verification.identity;
  const source = verification.parcelVerified ? (verification.verificationSource ?? 'Verified parcel source') : null;
  const url = id?.lpUrl || (id?.propertyId && id?.fips ? `https://landportal.com/?propertyid=${encodeURIComponent(id.propertyId)}&fips=${encodeURIComponent(id.fips)}` : null);
  const row = (key: string, label: string, value?: string | number | null): DdChecklistRow => {
    const v = value == null ? '' : String(value).trim();
    return v && source
      ? { key, label, value: v, status: 'verified', source, url, confidence: 'high' }
      : { key, label, value: null, status: 'needs_verification', source: null };
  };
  return [
    row('owner', 'Owner of record', id?.owner),
    row('apn', 'APN / parcel ID', id?.apn),
    row('situsAddress', 'Situs / property address', id?.situsAddress),
    row('county', 'County', id?.county),
    row('state', 'State', id?.state),
    row('propertyId', 'Provider property ID', id?.propertyId),
  ];
}
/** Run free government environmental DD for a verified parcel with coordinates
 *  (FEMA flood + NWI wetlands + USGS slope — all contract-verified + free, run
 *  live; injectable fetches for tests). Coordinates are SUPPORTING context only,
 *  never identity. Unverified/area-only parcels have no coordinates -> not_run. */
async function buildGovDd(
  verification: DukeVerificationResult,
  deps: { femaFetch?: GovFetch; nwiFetch?: GovFetch; usgsFetch?: GovFetch },
  areaCoords?: { lat: number; lng: number } | null,
): Promise<GovDdView> {
  // Verified parcel -> use verified-parcel coordinates. Unverified but geocoded
  // area lead -> use the area (address-centroid) coordinates so FEMA/NWI/USGS
  // still return usable environmental signal. Coordinates are SUPPORTING context
  // only and never identity; the report stays labeled Not Parcel Verified.
  const co = verification.parcelVerified ? verification.coordinates : (areaCoords ?? null);
  if (!co) return emptyGovDd();
  const [flood, wet, slope] = await Promise.all([
    fetchFemaFlood(co.lat, co.lng, { fetchImpl: deps.femaFetch }),
    fetchNwiWetlands(co.lat, co.lng, { fetchImpl: deps.nwiFetch }),
    fetchUsgsSlope(co.lat, co.lng, { fetchImpl: deps.usgsFetch }),
  ]);
  return {
    flood: { status: flood.status, zone: flood.value == null ? null : String(flood.value), note: flood.note, source: flood.sourceUrl, timestamp: flood.timestamp },
    wetlands: { status: wet.status, type: wet.value == null ? null : String(wet.value), note: wet.note, source: wet.sourceUrl, timestamp: wet.timestamp },
    slope: { status: slope.status, slopeDeg: typeof slope.value === 'number' ? slope.value : null, note: slope.note, source: slope.sourceUrl, timestamp: slope.timestamp },
  };
}

// ── Land Score inputs from approved-provider data ────────────────────────────
// Parse a percentage-ish provider value ("28.10 %", "0") to a number.
function pctNum(v: string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
// Parse a $ provider value ("$12,602") to a positive number.
function usdNum(v: string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const m = String(v).replace(/[,$]/g, '').match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Buildability provenance for the Land Score slope factor — which approved
 *  provider(s) the buildability came from and whether they agree. */
export interface BuildabilityProvenance {
  pct: number;
  /** True when LandPortal buildability and USGS slope materially disagree. */
  conflict: boolean;
  /** Operator-facing source line shown under the factor (names the source). */
  basis: string;
}

/** Slope PERCENT (flatter is better) → estimated usable/buildable share of the
 *  parcel. Thresholds per Tyler: <5% strong (best), 5–10% still workable,
 *  10–15% harder/reduced, >=15% major concern. Under 10% generally buildable. */
function buildabilityFromSlopePct(slopePct: number): number {
  if (slopePct < 5) return 90;    // 0–5%: strong buildability (best)
  if (slopePct < 10) return 70;   // 5–10%: still generally workable
  if (slopePct < 15) return 40;   // 10–15%: harder, reduced score
  return 15;                      // >=15%: major buildability concern
}

/**
 * Reconcile buildability from two APPROVED PROVIDER sources: the provider
 * buildability % (LandPortal fact sheet / a fresh resolve — a direct usable-area
 * measure) and USGS 3DEP average slope (terrain). USGS slope arrives in DEGREES
 * and is converted to slope percent (tan). Both are used: aligned => stronger
 * confidence; materially different => scored on LandPortal (never ignored) with
 * the conflict surfaced; USGS-only => fills the buildability the provider did not
 * return (no artificial gap). Neutral null when neither source has a value.
 */
function reconcileBuildability(providerBuild: number | undefined, govDd?: GovDdView): BuildabilityProvenance | null {
  let usgsSlopePct: number | undefined;
  if (govDd?.slope && govDd.slope.status === 'verified' && typeof govDd.slope.slopeDeg === 'number') {
    usgsSlopePct = Math.round(Math.tan((govDd.slope.slopeDeg * Math.PI) / 180) * 100 * 10) / 10;
  }
  const usgsBuild = usgsSlopePct !== undefined ? buildabilityFromSlopePct(usgsSlopePct) : undefined;

  if (providerBuild !== undefined && usgsBuild !== undefined) {
    const conflict = Math.abs(providerBuild - usgsBuild) >= 25;
    return {
      pct: providerBuild, // LandPortal / provider is primary — never ignored.
      conflict,
      basis: conflict
        ? `LandPortal buildability ${providerBuild}% vs USGS avg slope ${usgsSlopePct}% (~${usgsBuild}% usable) — sources disagree; scored on LandPortal, verify terrain`
        : `LandPortal buildability ${providerBuild}% · USGS avg slope ${usgsSlopePct}% aligned (cross-checked)`,
    };
  }
  if (providerBuild !== undefined) {
    return { pct: providerBuild, conflict: false, basis: `LandPortal buildability ${providerBuild}%` };
  }
  if (usgsBuild !== undefined) {
    return { pct: usgsBuild, conflict: false, basis: `USGS avg slope ${usgsSlopePct}% → ~${usgsBuild}% usable (LandPortal buildability not returned)` };
  }
  return null;
}

/**
 * Build the land facts + valuation + similars the Land Score scores, consuming
 * APPROVED PROVIDER DATA the report already has (2026-07-04 product correction —
 * LandOS uses approved provider data for pre-contract work and never treats it as
 * missing just because it did not come from a county website):
 *   1. verified property data (a fresh Realie/LandPortal resolve — richest), then
 *   2. the LandPortal parcel fact sheet (road frontage, landlocked, wetlands %,
 *      FEMA %, buildability %, acreage, LP valuation) — the fix so a persisted
 *      verified parcel's LandPortal facts are SCORED, not ignored, and finally
 *   3. live gov-DD (FEMA/NWI) as a cross-check, but only the clearly-safe
 *      "verified, outside the hazard => 0%" direction. A present hazard needs a
 *      percentage from an approved provider and is NEVER inferred here.
 * Buildability specifically uses BOTH LandPortal buildability % and USGS slope
 * (see reconcileBuildability). Gap-fill only: an earlier, stronger source is
 * never overwritten. A value no approved provider gave stays a true gap.
 */
export function landFactsForScore(
  propertyData: DukePropertyData | undefined,
  factSheet: ParcelFactSheet | null | undefined,
  govDd?: GovDdView,
): { landFacts: DukeLandFacts; valuation: DukeValuation; similars: DukeSimilars; buildability: BuildabilityProvenance | null } {
  const lf: DukeLandFacts = { ...(propertyData?.landFacts ?? {}) };
  const val: DukeValuation = { ...(propertyData?.valuation ?? {}) };
  const sim: DukeSimilars = { ...(propertyData?.similars ?? {}) };

  if (factSheet) {
    if (lf.acres === undefined && typeof factSheet.acres === 'number') lf.acres = factSheet.acres;
    if (lf.roadFrontageFt === undefined && typeof factSheet.access.roadFrontageFt === 'number') lf.roadFrontageFt = factSheet.access.roadFrontageFt;
    if (lf.landLocked === undefined && factSheet.access.landLocked) lf.landLocked = factSheet.access.landLocked;
    if (lf.wetlandsPct === undefined) { const n = pctNum(factSheet.environment.wetlandsPct); if (n !== undefined) lf.wetlandsPct = n; }
    if (lf.femaPct === undefined) { const n = pctNum(factSheet.environment.femaCoveragePct); if (n !== undefined) lf.femaPct = n; }
    if (val.tlpEstimate === undefined) { const n = usdNum(factSheet.valuation.lpEstimatePrice) ?? usdNum(factSheet.valuation.totalMarketValue); if (n !== undefined) val.tlpEstimate = n; }
    if (val.tlpPpa === undefined) { const n = usdNum(factSheet.valuation.lpEstimatePpa); if (n !== undefined) val.tlpPpa = n; }
  }

  // Gov-DD cross-check: only the clearly-safe "verified, outside the hazard" case.
  if (govDd) {
    if (lf.femaPct === undefined && govDd.flood.status === 'verified' && govDd.flood.zone) {
      if (/not in|minimal|no special|zone x|^x$/i.test(govDd.flood.zone.trim())) lf.femaPct = 0;
    }
    if (lf.wetlandsPct === undefined && govDd.wetlands.status === 'verified' && govDd.wetlands.type) {
      if (/none|no wetland|not mapped/i.test(govDd.wetlands.type.trim())) lf.wetlandsPct = 0;
    }
  }

  // Buildability: LandPortal buildability % (direct measure) + USGS slope (terrain).
  const buildability = reconcileBuildability(lf.buildabilityPct ?? pctNum(factSheet?.buildability.pct), govDd);
  if (buildability) lf.buildabilityPct = buildability.pct;

  return { landFacts: lf, valuation: val, similars: sim, buildability };
}

// ── Persisted verified reuse (no provider call) ──────────────────────────────

/**
 * Build a resolver that REUSES a persisted, already-verified Property Card instead
 * of calling any data provider. Returns a verified LpResolveResult carrying the
 * card's identity + acreage; all other land facts stay blank (reported as data
 * gaps / Needs Verification — never fabricated). This is how the Discovery Call
 * Report runs from persisted verified data without consuming another Realie call.
 */
export function buildPersistedResolver(
  pc: Record<string, unknown>,
): (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult> {
  return async () => {
    const summary = emptyLpPropertySummary();
    summary.propertyid = s(pc.lp_property_id) || s(pc.property_id) || s(pc.parcel_id);
    summary.apn = s(pc.apn);
    summary.county = s(pc.county);
    summary.state = s(pc.state);
    summary.city = s(pc.city);
    summary.situs_address = s(pc.active_input_address);
    summary.owner = s(pc.owner);
    const acres = typeof pc.acres === 'number' ? pc.acres : undefined;
    if (acres !== undefined) { summary.lot_size_acres = String(acres); summary.calc_acres = String(acres); }
    // Restore persisted verified-parcel coordinates so the reopened parcel keeps
    // its full enrichment pipeline (Realie/Zillow comps, imagery, map context).
    // Coordinates are supporting OUTPUT, never identity — identity above comes
    // from the persisted exact-source fields (propertyid/apn/fips), not lat/lng.
    const lat = typeof pc.lat === 'number' ? pc.lat : null;
    const lng = typeof pc.lng === 'number' ? pc.lng : null;
    if (lat !== null && lng !== null && (lat !== 0 || lng !== 0)) { summary.lat = String(lat); summary.lng = String(lng); }
    // Unwrap any prior "Persisted verified Property Card (orig: X)" wrapping to the
    // INNERMOST original source, so repeated report re-runs don't nest the label
    // ("(orig: (orig: (orig: ...)))") in the report header.
    let origSource = s(pc.verification_source);
    while (/^Persisted verified Property Card/.test(origSource)) {
      const m = /\(orig:\s*(.*)\)\s*$/.exec(origSource);
      if (!m) break;
      origSource = m[1].trim();
    }
    return {
      verified: true,
      status: 'verified',
      propertyid: summary.propertyid || null,
      fips: s(pc.fips) || null,
      apn: summary.apn || null,
      situs_address: summary.situs_address || null,
      city: summary.city || null,
      state: summary.state || null,
      owner: summary.owner || null,
      match_notes: `Reused persisted verified Property Card${pc.id ? ` #${pc.id}` : ''} — no provider call, no Realie credit.`,
      source: `Persisted verified Property Card${origSource ? ` (orig: ${origSource})` : ''}`,
      zoning: s(pc.zoning) || null, // carried when the card persists zoning (else Unknown)
      property_summary: summary,
      candidates: [],
    };
  };
}

/** Local-area context derived from the subject Property Card when exact parcel
 *  identity is NOT verified. Everything here is SUPPORTING context (weaker than a
 *  verified parcel), never identity. Used to drive area comps, census, gov-DD, and
 *  Market Pulse so a messy/unverified lead still yields a usable pre-call report. */
export interface ReportAreaContext {
  address?: string; city?: string; county?: string; state?: string; zip?: string;
  lat?: number; lng?: number; acres?: number; fips?: string;
}

/**
 * Build the area-context locus for an UNVERIFIED lead from its subject Property
 * Card's persisted (geocoded) fields. Returns null when there is not enough
 * locality/coordinates to target a real area. When the card lacks a county FIPS,
 * derives it via the free US Census geocoder (for demographics only). No paid
 * call, no comp credit, no parcel identity — coordinates stay supporting output.
 */
export async function deriveAreaContext(
  deal: DealCardDetail,
  deps: { deriveCountyImpl?: typeof import('./providers/county-geocode.js').deriveCounty } = {},
): Promise<ReportAreaContext | null> {
  const pc = (deal.propertyCards as Array<Record<string, unknown>> | undefined)?.[0];
  if (!pc) return null;
  const address = s(pc.active_input_address) || undefined;
  const city = s(pc.city) || undefined;
  let county = s(pc.county) || undefined;
  const state = s(pc.state) || undefined;
  const acres = typeof pc.acres === 'number' && pc.acres > 0 ? pc.acres : undefined;
  let lat = typeof pc.lat === 'number' && pc.lat !== 0 ? pc.lat : undefined;
  let lng = typeof pc.lng === 'number' && pc.lng !== 0 ? pc.lng : undefined;
  const zip = address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || undefined;
  let fips = s(pc.fips) || undefined;

  const hasLocality = !!(state && (city || county || zip));
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  if (!hasLocality && !hasCoords) return null;

  // Backfill county FIPS (+ county/coords when the card lacks them) so demographics
  // and comps can target the locality. Geocoder output is context only.
  if ((!fips || !county || !hasCoords) && address) {
    try {
      const deriveCounty = deps.deriveCountyImpl ?? (await import('./providers/county-geocode.js')).deriveCounty;
      const g = await deriveCounty({ address, city, state, zip });
      if (g) {
        if (!fips && g.fips) fips = g.fips;
        if (!county && g.county) county = g.county;
        if (lat === undefined && typeof g.lat === 'number') lat = g.lat;
        if (lng === undefined && typeof g.lng === 'number') lng = g.lng;
      }
    } catch { /* demographics simply stays no_geography; never fail the report */ }
  }

  return { address, city, county, state, zip, lat, lng, acres, fips };
}

const REPORT_STATUS_SET = new Set<string>(DEAL_CARD_REPORT_STATUSES);

// ── Public report shape ─────────────────────────────────────────────────────

/** One row in the report's unified source table. Honest status per source; a
 *  comp credit is NEVER used, so creditUsed is always false here. */
export interface DealCardReportSourceRow {
  source: string;
  kind: 'parcel_exact' | 'market_pulse';
  status:
    | 'used_non_credit'
    | 'attempted_not_verified'
    | 'unavailable'
    | 'not_connected'
    | 'manual_entry_needed';
  detail: string;
  /** Always false: this workflow never spends a LandPortal comp credit. */
  compCreditUsed: false;
}

export interface DealCardReportView {
  exists: boolean;
  dealCardId: number;
  reportStatus: DealCardReportStatus;
  /** Human parcel-verification label (e.g. "Parcel verified (LandPortal exact,
   *  non-credit)" or "Local Area Context, Not Parcel Verified"). */
  parcelVerificationStatus: string;
  parcelVerified: boolean;
  ddSummary: string;
  marketSummary: string;
  strategySummary: string;
  mostViableStrategy: string;
  offerReadiness: StrategyOfferReadiness;
  sourceTable: DealCardReportSourceRow[];
  dataGaps: string[];
  riskFlags: string[];
  countyVerificationChecklist: string[];
  marketFollowUpChecklist: string[];
  strategyBlockers: string[];
  nextConfirmations: string[];
  preCallStrategyNotes: string;
  /** Full DD fact checklist — every standard field with a Verified value (+source)
   *  or an explicit Unknown / Needs Verification status. Never fabricated. Mirrors
   *  the Discovery Call Report checklist. */
  ddFactChecklist: DdChecklistRow[];
  /** Completeness summary derived from the checklist (X of N verified). */
  ddCompleteness: DdCompleteness;
  /** Visual Property Context (Google) — supporting context only, never parcel
   *  verification. Deep links + image placeholders/captured refs, all labeled
   *  "Visual Signal, Not Verified Fact". Built purely (no Google call here). */
  visualContext: VisualPropertyContext;
  landportalInspection?: {
    parcelUrl: string | null;
    comparablesUrl: string | null;
    parcelFacts: Record<string, string>;
    assets: Array<{ key: string; label: string; kind: string; url: string; timestamp: string; overlay?: string; note?: string }>;
    overlays: Array<{ overlay: string; status: string; note: string; confidence: string; screenshotUrl?: string | null }>;
    visualObservations: Array<{ label: string; detail: string; confidence: string; evidence: string }>;
    comparables: Array<{ rawText: string; sourceUrl: string; apn?: string | null; address?: string | null; saleDate?: string; acres?: number | null; price?: number | null; pricePerAcre?: number | null; distanceMiles?: number | null; status: string; saleListIndicator?: string; improvement: string; confidence: string }>;
    sources: Array<{ provider: string; stage: string; status: string; confidence: string; url?: string | null; note: string }>;
    evidence: Array<{ label: string; status: string; detail: string; confidence: string; source?: string | null; url?: string | null }>;
    discoveryQuestions: string[];
    missingInformation: string[];
    /** Structured, operator-facing fact sheet derived from parcelFacts (access
     *  interpretation, buildability, flood/wetlands, valuation, seller questions).
     *  One source of truth for the Property Card snapshot. Always set by the report
     *  builder; optional so lightweight test fixtures need not construct it. */
    factSheet?: ParcelFactSheet;
  } | null;
  /** Free government environmental DD (live where contract-verified + lat/lng
   *  available). FEMA flood is activated; others labeled honestly when absent. */
  govDd: {
    flood: { status: string; zone: string | null; note: string; source: string | null; timestamp: string | null };
    wetlands: { status: string; type: string | null; note: string; source: string | null; timestamp: string | null };
    slope: { status: string; slopeDeg: number | null; note: string; source: string | null; timestamp: string | null };
  };
  /** Apify Redfin sold comps + active listings + market metrics (live where
   *  configured). Persisted; honest status when sparse/unavailable. */
  marketComps: MarketCompsView;
  /** US Census ACS county demographics (supporting market context; never identity).
   *  Honest not_configured when no free CENSUS_API_KEY. */
  demographics: CensusDemographics;
  /** LandOS 100-point Land Score computed from the SAME verified property data the
   *  report used (never a separate re-resolve). Null when the parcel is not
   *  source-verified (never scored from unverified data). Missing source fields
   *  score 0 as loud data gaps, never inferred. Integrated so the score renders
   *  inline in the report instead of a separate on-demand action. */
  landScore: LandScoreResult | null;
  creditUsage: {
    landportalNonCreditUsed: boolean;
    compCreditUsed: false;
    note: string;
  };
  /** Unix seconds when the report was last generated, or null when never run. */
  generatedAt: number | null;
  updatedBy: string;
}

export interface DealCardReportDeps {
  /** The bounded LandPortal exact resolver (never a comp tool/credit). */
  resolve: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
  timeoutMs: number;
  /** Who ran the report (audit/display only). */
  actor?: string;
  /** Presence-only flag (resolved by the route from GOOGLE_MAPS_API_KEY). Kept as
   *  a dep so this engine never reads .env/secrets. Default false. */
  googleVisualConfigured?: boolean;
  /** Force a fresh provider re-verification even when a verified Property Card is
   *  already linked. Default false → reuse persisted verified data (no provider
   *  call / no Realie credit). Set true only on explicit operator re-verify. */
  reverify?: boolean;
  /** A verification result the caller already obtained for THIS parcel (e.g. the
   *  acquire flow's Property Resolution verified it moments ago). When present it
   *  is used as-is — the report does NOT re-verify — eliminating the duplicate
   *  provider lookup. Full land facts flow through, so nothing shows as a gap. */
  prefetchedVerification?: DukeVerificationResult;
  /** Injected gov-DD fetches for tests (keep the suite offline). Default = live. */
  femaFetch?: GovFetch;
  nwiFetch?: GovFetch;
  usgsFetch?: GovFetch;
  /** Injected Google visual capture for tests. Default = live capturePropertyVisuals. */
  captureVisuals?: (input: CaptureInput) => Promise<CaptureResult>;
  /** Injected comp retrieval for tests. Default = live Apify Redfin registry. */
  retrieveCompsImpl?: (q: CompQueryLite) => Promise<MarketCompsView>;
  /** Injected Census fetch for tests. Default = live (honest not_configured w/o key). */
  censusFetch?: CensusFetch;
  /** Injected Zillow public land-comp capture (disposable browser profile). Only
   *  supplied by the live report route → the test suite never launches a browser.
   *  Best-effort: failure/blocked/none never blocks the report. */
  captureZillowComps?: (input: ZillowFetchInput) => Promise<ZillowCompsResult>;
  /** Injected Redfin public land-comp capture (its OWN disposable browser profile,
   *  never the LandPortal or Zillow profile). Same best-effort contract. */
  captureRedfinComps?: (input: RedfinFetchInput) => Promise<RedfinCompsResult>;
  /** Live read-only browser driver for the Zillow/Redfin comp research fallback.
   *  When present + configured, the comp chain researches Zillow + Redfin as an
   *  acquisitions assistant would. Absent/unconfigured degrades honestly. */
  compResearchDriver?: BrowserDriver;
}

/** Minimal comp query the report builds from the verified parcel. */
export interface CompQueryLite {
  address?: string; city?: string; county?: string; state?: string; zip?: string;
  acres?: number; lat?: number; lng?: number;
  /** True when the subject has a structure (improved). Controls vacant-land comp
   *  validation — when false, improved/house sales are excluded from valuation. */
  improved?: boolean;
}

export interface DealCardReportResult {
  report: DealCardReportView;
  warnings: string[];
}

// ── Small helpers ───────────────────────────────────────────────────────────

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Union two string lists, trimmed, de-duplicated, order-stable (base first). */
function union(base: string[], extra: string[]): string[] {
  const out: string[] = [];
  for (const x of [...base, ...extra]) {
    const v = (x ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Union source-link lists by url (de-duplicated). */
function unionLinks(base: DealCardSourceLink[], extra: DealCardSourceLink[]): DealCardSourceLink[] {
  const out: DealCardSourceLink[] = [];
  const seen = new Set<string>();
  for (const l of [...base, ...extra]) {
    const url = (l?.url ?? '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: (l.label ?? '').trim(), url });
  }
  return out;
}

/** Human label for a strategy id used by duke-analysis candidates. */
const STRATEGY_LABELS: Record<string, string> = {
  quick_flip: 'Quick flip',
  subdivide: 'Subdivide',
  land_home_package: 'Land-home package',
  improved_property_value_add: 'Improved-property / mobile-home value-add',
  teardown_land_only: 'Teardown / land-only fallback',
  pass_no_offer: 'Pass / no offer',
};
function strategyLabel(id: string): string {
  return STRATEGY_LABELS[id] ?? id;
}

// ── Identity inputs ─────────────────────────────────────────────────────────

interface FirstPropertyCard {
  apn?: string;
  lp_property_id?: string;
  fips?: string;
  lp_url?: string;
  county?: string;
  state?: string;
  owner?: string;
  acres?: number | null;
}

/**
 * Build the parcel-identity text the safe resolver parses, from the Deal Card's
 * available inputs: a LandPortal URL, APN, owner, county/state, and a labeled
 * propertyid+FIPS. The DD worksheet wins for manually-entered values; the linked
 * property card backfills. Identity NEVER comes from coordinates/proximity.
 */
export function buildIdentityText(deal: DealCardDetail, dd: DealCardDdView): string {
  const prop = (deal.propertyCards?.[0] ?? {}) as FirstPropertyCard;
  const owner =
    (deal.people ?? []).find((p) => {
      const role = (p as { role?: string }).role;
      return role === 'owner' || role === 'record_owner';
    }) as { name?: string } | undefined;

  const apn = s(dd.apn) || s(prop.apn);
  const county = s(dd.county) || s(prop.county);
  const state = s(dd.state) || s(prop.state);
  const lpUrl = s(prop.lp_url);
  const propertyId = s(prop.lp_property_id);
  const fips = s(prop.fips);
  const ownerName = s(owner?.name) || s(prop.owner);
  // The street address of the subject parcel. WITHOUT this, an address-only lead
  // (no APN/owner/LP URL) produced an identity text of just the state, so the
  // report could never run an address-based verification. Include it so the
  // capability resolves address leads (APN still takes precedence when present).
  const address = s((prop as { active_input_address?: string }).active_input_address) || s((prop as { address?: string }).address);

  const lines: string[] = [];
  if (lpUrl) lines.push(lpUrl);
  if (apn) lines.push(`APN: ${apn}`);
  if (propertyId) lines.push(`propertyid: ${propertyId}`);
  if (fips) lines.push(`fips: ${fips}`);
  // A full "street, city, ST zip" line lets extractPropertyArgs build an address
  // lookup. Placed before county/state so the address parse wins for address leads.
  if (address) lines.push(address);
  if (county) lines.push(`${county} County`);
  if (state) lines.push(state);
  if (ownerName) lines.push(`Owner: ${ownerName}`);
  return lines.join('\n');
}

// ── Due Diligence + Research leg (property-level) ────────────────────────────

const TRUE_RE = /^(1|y|yes|true|t)$/i;

interface DdLeg {
  summary: string;
  patch: DealCardDdPatch;
  dataGaps: string[];
  riskFlags: string[];
  verificationWarnings: string[];
  countyChecklist: string[];
  /** Source link to attach for the verified LandPortal source (or null). */
  lpSourceLink: DealCardSourceLink | null;
}

/**
 * Build the DD/Research leg. When the parcel is source-verified by LandPortal
 * (non-credit), it writes source-labeled facts and a 'source_verified' identity
 * status WITH a named LandPortal source link (so the worksheet's "Verified needs
 * a source" guardrail is satisfied honestly). When not verified, it sets
 * 'local_area_context_not_verified', records the data gaps + verification
 * warnings, and never labels anything Verified. Manual content is preserved:
 * lists are unioned and free-text values are only set from the source.
 */
function buildDdLeg(verification: DukeVerificationResult, dd: DealCardDdView): DdLeg {
  const dataGaps: string[] = [];
  const riskFlags: string[] = [];
  const verificationWarnings: string[] = [];
  const countyChecklist: string[] = [];

  if (verification.parcelVerified && verification.propertyData) {
    const pd: DukePropertyData = verification.propertyData;
    const id = pd.identity;
    const f = pd.landFacts;

    // A named, provider-agnostic source citation for the verified record. For
    // LandPortal we cite the exact propertyid+FIPS record; for any other verified
    // source (Realie, or a reused persisted verified Property Card) we cite the
    // named source with a map reference to the verified parcel. This is source
    // attribution, never a fabricated fact — it lets verified DD facts stay
    // labeled "Verified" honestly.
    const srcLabel = verification.verificationSource || 'Verified source';
    const isLandPortal = /landportal/i.test(srcLabel);
    const mapsRef = id.situsAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(id.situsAddress)}`
      : null;
    const lpSourceLink: DealCardSourceLink | null =
      isLandPortal && id.propertyId && id.fips
        ? { label: 'LandPortal exact property data (non-credit)', url: `https://landportal.com/?propertyid=${id.propertyId}&fips=${id.fips}` }
        : mapsRef
          ? { label: `${srcLabel} — verified parcel (map reference)`, url: mapsRef }
          : null;

    const patch: DealCardDdPatch = {
      parcelIdentityStatus: lpSourceLink ? 'source_verified' : 'apn_provided',
    };
    if (id.apn) { patch.apn = id.apn; patch.apnLabel = lpSourceLink ? 'Verified' : 'Needs verification'; }
    if (id.county) patch.county = id.county;
    if (id.state) patch.state = id.state;
    if (id.county || id.state) patch.locationLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    if (typeof f.acres === 'number') { patch.acreage = f.acres; patch.acreageLabel = lpSourceLink ? 'Verified' : 'Needs verification'; }
    // Zoning: prefer the explicit provider zoning code (e.g. Realie zoningCode);
    // fall back to land use. Honest Unknown when neither is present.
    const zoningVal = f.zoning ?? f.landUse;
    if (zoningVal) { patch.zoning = zoningVal; patch.zoningLabel = lpSourceLink ? 'Verified' : 'Needs verification'; }

    // Access (from landlocked source flag — confirm legal/recorded access).
    if (f.landLocked !== undefined) {
      patch.accessStatus = TRUE_RE.test(f.landLocked.trim())
        ? 'Flagged landlocked per source — confirm legal/recorded access'
        : 'Not flagged landlocked per source — confirm access/easement';
      patch.accessLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    }
    // Flood (FEMA %) and wetlands (%) — source facts.
    if (typeof f.femaPct === 'number') {
      patch.floodStatus = `FEMA floodplain ~${f.femaPct}%`;
      patch.floodLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    }
    if (typeof f.wetlandsPct === 'number') {
      patch.wetlandsStatus = `Wetlands ~${f.wetlandsPct}%`;
      patch.wetlandsLabel = lpSourceLink ? 'Verified' : 'Needs verification';
    }
    if (typeof f.roadFrontageFt === 'number') {
      patch.roadFrontageNotes = `Road frontage ~${f.roadFrontageFt} ft (per LandPortal). Confirm legal access.`;
    }

    // Data gaps: surface the source's missing fields verbatim (never invented).
    for (const g of pd.dataGaps) dataGaps.push(`Source field not returned: ${g}`);

    // Risk flags from the source facts (deterministic; mirrors duke-analysis).
    if (f.landLocked !== undefined && TRUE_RE.test(f.landLocked.trim())) riskFlags.push('Landlocked per source — confirm legal/recorded access.');
    if (typeof f.wetlandsPct === 'number' && f.wetlandsPct >= 25) riskFlags.push(`Significant wetlands (~${f.wetlandsPct}%).`);
    if (typeof f.femaPct === 'number' && f.femaPct >= 25) riskFlags.push(`Significant FEMA floodplain (~${f.femaPct}%).`);
    if (typeof f.slopeAvgDeg === 'number' && f.slopeAvgDeg >= 15) riskFlags.push(`Steep average slope (~${f.slopeAvgDeg}°).`);
    if (typeof f.buildabilityPct === 'number' && f.buildabilityPct < 30) riskFlags.push(`Low buildability (~${f.buildabilityPct}%).`);

    // Manual county/official verification checklist (still required even when LP
    // verifies identity — county records confirm zoning/access/utilities/flood).
    countyChecklist.push(
      'Confirm zoning / land use with the county planning/zoning department.',
      'Confirm legal access (recorded easement or road frontage) with the county.',
      'Confirm utilities availability (power/water/sewer/septic) at the parcel.',
      'Confirm flood zone via the official FEMA flood map for the parcel.',
      'Confirm taxes / liens / delinquencies on the county tax record.',
    );

    if (!lpSourceLink) {
      verificationWarnings.push(`${srcLabel} verified the parcel but no citation URL/address was available; DD facts are labeled "Needs verification" rather than "Verified".`);
    }

    const summary = [
      `Parcel verified via ${srcLabel}.`,
      id.apn ? `APN ${id.apn}.` : '',
      [id.county, id.state].filter(Boolean).join(', '),
      typeof f.acres === 'number' ? `~${f.acres} ac.` : '',
      f.landUse ? `Land use: ${f.landUse}.` : '',
      pd.dataGaps.length ? `${pd.dataGaps.length} source field(s) not returned (see data gaps).` : 'All requested source fields returned.',
    ].filter(Boolean).join(' ');

    return { summary, patch, dataGaps, riskFlags, verificationWarnings, countyChecklist, lpSourceLink };
  }

  // ── Not verified — Local Area Context, Not Parcel Verified ───────────────
  const patch: DealCardDdPatch = { parcelIdentityStatus: 'local_area_context_not_verified' };
  dataGaps.push('Parcel identity not source-verified.');
  for (const g of verification.dataGaps) dataGaps.push(`Verification gap: ${g}`);
  riskFlags.push('Parcel identity not verified — no parcel fact may be treated as Verified, and no offer guidance is valid yet.');
  verificationWarnings.push('Due Diligence + Research is Local Area Context, Not Parcel Verified. Confirm exact parcel identity before treating any field as Verified.');
  if (verification.nextAction) verificationWarnings.push(verification.nextAction);

  countyChecklist.push(
    'Verify exact parcel identity via the county assessor/GIS by APN + county (or LandPortal property id + FIPS).',
    'Confirm owner of record on the county assessor/recorder.',
    'Confirm zoning / land use with the county planning/zoning department.',
    'Confirm legal access (recorded easement or road frontage).',
    'Confirm utilities availability and flood zone.',
  );

  const summary =
    verification.summary ||
    'Parcel not source-verified. Local Area Context, Not Parcel Verified. Confirm exact parcel identity before any parcel fact is treated as Verified.';

  return { summary, patch, dataGaps, riskFlags, verificationWarnings, countyChecklist, lpSourceLink: null };
}

// ── Market Research leg (market-level) ───────────────────────────────────────

interface MarketLeg {
  summary: string;
  patch: DealCardMarketPatch;
  sourceRows: DealCardReportSourceRow[];
  followUpChecklist: string[];
  dataGaps: string[];
}

/**
 * Build the Market Research leg. MARKET-LEVEL only: it structures the non-paid
 * source targets (the governed adapter registry + market-pulse signals) and an
 * operational market follow-up checklist for manual/source entry. It NEVER
 * verifies parcel identity and NEVER fabricates demand, comps, solds, actives,
 * days-on-market, or pricing. The target area is derived from the verified
 * county/state (preferred) or the local-area signals — using the source's place
 * name, never coordinates. Demand labels are left to manual entry; the report
 * only nudges market_review_status from 'not_reviewed' to the honest
 * 'needs_research' so the lane reads as structured-but-not-concluded.
 */
function buildMarketLeg(
  deal: DealCardDetail,
  verification: DukeVerificationResult,
  market: DealCardMarketView,
  areaOverride?: { city?: string; county?: string; state?: string },
): MarketLeg {
  const verifiedId = verification.parcelVerified ? verification.propertyData?.identity : undefined;
  const area = extractAreaSignals(`${deal.title ?? ''} ${deal.package_notes ?? ''} ${deal.seller_notes ?? ''}`);
  // When unverified, a persisted geocoded Property Card supplies the county/state
  // the deal title/notes lack (e.g. "Runnels County" for a bare highway address),
  // so Market Pulse + comps still target the real local area (labeled weaker).
  const county = s(verifiedId?.county) || s(areaOverride?.county) || s(area.county);
  const state = s(verifiedId?.state) || s(areaOverride?.state) || s(area.state);
  const areaLabel = [county ? `${county} County` : '', state].filter(Boolean).join(', ');

  const pulse = marketPulseEligibility({ county: county || undefined, state: state || undefined });

  // Unified market source table: each market-pulse adapter is a non-paid source
  // TARGET. None are connected this sprint, so each is "manual_entry_needed" —
  // the operational source-entry path. No demand is invented.
  const sourceRows: DealCardReportSourceRow[] = SOURCE_ADAPTERS.filter((a) => a.kind === 'market_pulse').map((a) => ({
    source: a.label,
    kind: 'market_pulse' as const,
    status: a.availability === 'available' ? ('used_non_credit' as const) : ('manual_entry_needed' as const),
    detail: a.availability === 'available'
      ? `${a.label} connected. Signals: ${a.capability.marketPulseSignals.join(', ') || 'n/a'}.`
      : `Not connected. Enter findings manually from this source. Signals to capture: ${a.capability.marketPulseSignals.join(', ') || 'n/a'}.`,
    compCreditUsed: false as const,
  }));

  const followUpChecklist = [
    `Enter active land listings for ${areaLabel || 'the target area'} (acreage bands, asking $ / acre).`,
    'Enter recent sold land context (sale prices, acreage, sale dates) — notes only, no comps computed.',
    'Enter days-on-market notes for comparable land in the area.',
    'Rate local buyer demand by exit type (manufactured-home, subdivision, infill-lot, rural acreage) with a supporting note.',
    'Enter county growth / planning / comprehensive-plan notes if known or safely sourced.',
    'Attach a source link for each market finding and set the source confidence honestly.',
  ];

  const dataGaps: string[] = [];
  if (!pulse.eligible) dataGaps.push('No city/county + state known for the deal — Market Research target area is not yet defined.');
  if (market.buyerDemandLabel === 'not_reviewed') dataGaps.push('Local buyer demand not reviewed yet.');

  // Non-destructive patch: only set the target area label when empty, and only
  // nudge the review status from 'not_reviewed' to 'needs_research'. Demand
  // labels and notes are left exactly as the operator entered them.
  const patch: DealCardMarketPatch = {};
  if (!s(market.targetAreaLabel) && areaLabel) patch.targetAreaLabel = areaLabel;
  if (market.marketReviewStatus === 'not_reviewed') patch.marketReviewStatus = 'needs_research';
  patch.dataGaps = union(market.dataGaps, dataGaps);

  const summary = [
    areaLabel ? `Target area: ${areaLabel}.` : 'Target area not yet defined (need city/county + state).',
    pulse.eligible
      ? 'Market Pulse eligible as local area context (separate from parcel verification).'
      : 'Market Pulse not eligible yet (no city/county + state).',
    'No approved non-paid market adapter is connected — market findings are entered manually via the follow-up checklist. No comps, solds, actives, days-on-market, demand, or pricing are computed or invented.',
  ].filter(Boolean).join(' ');

  return { summary, patch, sourceRows, followUpChecklist, dataGaps };
}

// ── Strategy leg (decision-level) ────────────────────────────────────────────

interface StrategyLeg {
  summary: string;
  patch: DealCardStrategyPatch;
  mostViable: string;
  offerReadiness: StrategyOfferReadiness;
  blockers: string[];
  nextConfirmations: string[];
  preCallNotes: string;
}

/**
 * Build the Strategy leg from the EXISTING strategy logic (duke-analysis applies
 * the offer-engine baselines). Reads DD (verified property data) + Market and
 * produces candidates, the most viable exit, an honest offer readiness, blockers,
 * next confirmations, distinct per-exit notes, and the target-profit baseline. It
 * NEVER fabricates a value, comp, EV, or final offer, and NEVER auto-advances to
 * 'ready_for_offer'. Manual deep notes are preserved (only empty fields are
 * filled); lists are unioned.
 */
function buildStrategyLeg(verification: DukeVerificationResult, strategy: DealCardStrategyView, confirmed?: ConfirmedParcel | null): StrategyLeg {
  // Strategy/underwriting is produced ONLY through the ConfirmedParcel capability.
  // A Candidate parcel (no token) gets the honest blocked analysis.
  const analysis = confirmed
    ? analyzeConfirmedParcelStrategy(confirmed, {
        propertyData: verification.parcelVerified ? verification.propertyData : undefined,
        dataGaps: verification.dataGaps,
      })
    : blockedStrategyAnalysis(verification.dataGaps);

  const candidateIds = analysis.strategyCandidates.map((c) => c.strategy);
  const candidateLabels = candidateIds.map(strategyLabel);

  // Honest offer readiness mapping. Never auto 'ready_for_offer'.
  let offerReadiness: StrategyOfferReadiness;
  if (!verification.parcelVerified) offerReadiness = 'blocked';
  else offerReadiness = 'needs_confirmation';

  const blockers: string[] = [];
  const nextConfirmations: string[] = [];

  if (!verification.parcelVerified) {
    blockers.push('Parcel identity not verified — Strategy and Underwriting are blocked until a named source confirms identity.');
    nextConfirmations.push('Verify exact parcel identity (county assessor/GIS by APN + county, or LandPortal property id + FIPS).');
  } else {
    if (analysis.strategyStatus === 'blocked_needs_more_data') {
      blockers.push('Core land facts incomplete — gather more data before a preliminary strategy review.');
    }
    nextConfirmations.push('Confirm legal access, title/authority, and utilities before any offer.');
    nextConfirmations.push('Establish a source-backed valuation before any offer math (valuation is not ready yet).');
    if (analysis.offerReadiness.status === 'needs_verified_valuation') {
      blockers.push('Valuation not ready: no verified valuation data yet — no offer/EV is computed.');
    }
  }
  for (const r of analysis.redFlags) blockers.push(r);

  // Most viable: first non-pass candidate when verified; blocked otherwise.
  const firstNonPass = candidateIds.find((id) => id !== 'pass_no_offer');
  const mostViable = verification.parcelVerified && firstNonPass
    ? `${strategyLabel(firstNonPass)} (preliminary — confirm access/title/valuation).`
    : '';

  // Distinct per-exit rationale notes (only fill when the operator left empty).
  const rationaleFor = (id: string): string => analysis.strategyCandidates.find((c) => c.strategy === id)?.rationale ?? '';

  const targetProfitNote =
    `Minimum net profit baseline $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString()}. ` +
    `Subdivision projects target $${SUBDIVISION_MIN_NET_PROFIT_USD.toLocaleString()}+ net per project. ` +
    'No property-specific offer/EV is computed; valuation is not ready until a source-backed value, costs, and risk are set.';

  const preCallNotes = verification.parcelVerified
    ? 'Parcel verified. Lead with confirming access/title/utilities and motivation; do not present any number — valuation is not ready. Keep exit options open (flip, subdivide, land-home, value-add, teardown, pass).'
    : 'Parcel not verified. Treat as local-area context only. Confirm parcel identity and ownership/authority before discussing price; present no number.';

  const patch: DealCardStrategyPatch = {
    offerReadiness,
    strategyCandidates: union(strategy.strategyCandidates, candidateLabels),
    blockers: union(strategy.blockers, blockers),
    nextConfirmations: union(strategy.nextConfirmations, nextConfirmations),
  };
  if (!s(strategy.currentRecommendation)) {
    patch.currentRecommendation = verification.parcelVerified
      ? 'Preliminary strategy review available. Confirm access/title/utilities and establish a source-backed valuation before any offer.'
      : 'Blocked: verify parcel identity before any strategy or offer guidance.';
  }
  if (!s(strategy.mostViableStrategy) && mostViable) patch.mostViableStrategy = mostViable;
  if (!s(strategy.quickFlipNotes) && rationaleFor('quick_flip')) patch.quickFlipNotes = rationaleFor('quick_flip');
  if (!s(strategy.subdivideNotes) && rationaleFor('subdivide')) patch.subdivideNotes = rationaleFor('subdivide');
  if (!s(strategy.landHomePackageNotes) && rationaleFor('land_home_package')) patch.landHomePackageNotes = rationaleFor('land_home_package');
  if (!s(strategy.improvedValueAddNotes) && rationaleFor('improved_property_value_add')) patch.improvedValueAddNotes = rationaleFor('improved_property_value_add');
  if (!s(strategy.teardownLandOnlyNotes) && rationaleFor('teardown_land_only')) patch.teardownLandOnlyNotes = rationaleFor('teardown_land_only');
  if (!s(strategy.passNoOfferReason) && !verification.parcelVerified) {
    patch.passNoOfferReason = 'No offer while parcel identity is unverified. Pass remains available if numbers/risk do not work after verification.';
  }
  if (!s(strategy.riskAdjustedNotes) && analysis.redFlags.length) patch.riskAdjustedNotes = analysis.redFlags.join(' ');
  if (!s(strategy.targetProfitNote)) patch.targetProfitNote = targetProfitNote;
  if (!s(strategy.preCallStrategyNotes)) patch.preCallStrategyNotes = preCallNotes;

  const summary = verification.parcelVerified
    ? `Strategy candidates: ${candidateLabels.join(', ')}. Most viable (preliminary): ${firstNonPass ? strategyLabel(firstNonPass) : 'pending'}. Offer readiness: needs confirmation (valuation not ready, no offer computed).`
    : 'Strategy blocked: parcel identity not verified. No candidates, valuation, or offer until identity is confirmed by a named source.';

  return { summary, patch, mostViable, offerReadiness, blockers, nextConfirmations, preCallNotes };
}

// ── Persistence ──────────────────────────────────────────────────────────────

interface DealCardReportRow {
  deal_card_id: number;
  report_status: DealCardReportStatus;
  parcel_verification_status: string;
  parcel_verified: number;
  dd_summary: string;
  market_summary: string;
  strategy_summary: string;
  most_viable_strategy: string;
  offer_readiness: StrategyOfferReadiness;
  landportal_noncredit_used: number;
  comp_credit_used: number;
  report_json: string;
  updated_by: string;
  updated_at: number;
}

function emptyReport(dealCardId: number): DealCardReportView {
  return {
    exists: false,
    dealCardId,
    reportStatus: 'not_run',
    parcelVerificationStatus: 'Not run',
    parcelVerified: false,
    ddSummary: '',
    marketSummary: '',
    strategySummary: '',
    mostViableStrategy: '',
    offerReadiness: 'not_reviewed',
    sourceTable: [],
    dataGaps: [],
    riskFlags: [],
    countyVerificationChecklist: [],
    marketFollowUpChecklist: [],
    strategyBlockers: [],
    nextConfirmations: [],
    preCallStrategyNotes: '',
    ddFactChecklist: buildDdChecklist({}, null),
    ddCompleteness: summarizeDdCompleteness(buildDdChecklist({}, null)),
    visualContext: buildVisualPropertyContext({}, { configured: false }),
    landportalInspection: null,
    govDd: emptyGovDd(),
    marketComps: emptyMarketComps(),
    demographics: emptyCensus(),
    landScore: null,
    creditUsage: {
      landportalNonCreditUsed: false,
      compCreditUsed: false,
      note: 'No report run yet. The DD + Market + Strategy report never spends a LandPortal comp credit.',
    },
    generatedAt: null,
    updatedBy: '',
  };
}

function rowToView(row: DealCardReportRow): DealCardReportView {
  let parsed: Partial<DealCardReportView> = {};
  try {
    const j = JSON.parse(row.report_json);
    if (j && typeof j === 'object') parsed = j as Partial<DealCardReportView>;
  } catch { /* fall back to structured columns below */ }
  const base = emptyReport(row.deal_card_id);
  return {
    ...base,
    ...parsed,
    exists: true,
    dealCardId: row.deal_card_id,
    reportStatus: REPORT_STATUS_SET.has(row.report_status) ? row.report_status : 'failed',
    parcelVerificationStatus: row.parcel_verification_status || base.parcelVerificationStatus,
    parcelVerified: row.parcel_verified === 1,
    ddSummary: row.dd_summary,
    marketSummary: row.market_summary,
    strategySummary: row.strategy_summary,
    mostViableStrategy: row.most_viable_strategy,
    offerReadiness: row.offer_readiness,
    creditUsage: {
      landportalNonCreditUsed: row.landportal_noncredit_used === 1,
      compCreditUsed: false,
      note: parsed.creditUsage?.note ?? base.creditUsage.note,
    },
    generatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function getReportRow(dealCardId: number): DealCardReportRow | undefined {
  return getLandosDb()
    .prepare('SELECT * FROM landos_deal_card_report WHERE deal_card_id = ?')
    .get(dealCardId) as DealCardReportRow | undefined;
}

/** Read the persisted report for a Deal Card (honest empty view when none). */
export function getDealCardReport(dealCardId: number): DealCardReportView {
  const row = getReportRow(dealCardId);
  return row ? rowToView(row) : emptyReport(dealCardId);
}

export interface DealCardReportSummary {
  exists: boolean;
  reportStatus: DealCardReportStatus | 'not_run';
  parcelVerified: boolean;
  ddPercentComplete: number;
  generatedAt: number | null;
}

/** Lightweight per-deal report summary for list/board rows (avoids loading the
 *  full report). Reads the persisted row and parses the completeness only. */
export function getDealCardReportSummary(dealCardId: number): DealCardReportSummary {
  const row = getReportRow(dealCardId);
  if (!row) return { exists: false, reportStatus: 'not_run', parcelVerified: false, ddPercentComplete: 0, generatedAt: null };
  let pct = 0;
  try {
    const j = JSON.parse(row.report_json) as Partial<DealCardReportView>;
    pct = j.ddCompleteness?.percentComplete ?? 0;
  } catch { pct = 0; }
  return {
    exists: true,
    reportStatus: REPORT_STATUS_SET.has(row.report_status) ? row.report_status : 'failed',
    parcelVerified: row.parcel_verified === 1,
    ddPercentComplete: pct,
    generatedAt: row.updated_at,
  };
}

function persistReport(dealCardId: number, view: DealCardReportView, updatedBy: string, entity: string): void {
  const db = getLandosDb();
  const existing = getReportRow(dealCardId);
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.stringify({ ...view, exists: undefined, generatedAt: undefined });
  const cols = [
    view.reportStatus,
    view.parcelVerificationStatus,
    view.parcelVerified ? 1 : 0,
    view.ddSummary,
    view.marketSummary,
    view.strategySummary,
    view.mostViableStrategy,
    view.offerReadiness,
    view.creditUsage.landportalNonCreditUsed ? 1 : 0,
    0, // comp_credit_used: never
    json,
    updatedBy,
  ];
  if (existing) {
    db.prepare(
      `UPDATE landos_deal_card_report SET
         report_status = ?, parcel_verification_status = ?, parcel_verified = ?,
         dd_summary = ?, market_summary = ?, strategy_summary = ?,
         most_viable_strategy = ?, offer_readiness = ?,
         landportal_noncredit_used = ?, comp_credit_used = ?,
         report_json = ?, updated_by = ?, updated_at = ?
       WHERE deal_card_id = ?`,
    ).run(...cols, now, dealCardId);
  } else {
    db.prepare(
      `INSERT INTO landos_deal_card_report
         (deal_card_id, report_status, parcel_verification_status, parcel_verified,
          dd_summary, market_summary, strategy_summary, most_viable_strategy, offer_readiness,
          landportal_noncredit_used, comp_credit_used, report_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(dealCardId, ...cols, now);
  }
  landosAudit(updatedBy, existing ? 'deal_card_report_updated' : 'deal_card_report_created', `deal ${dealCardId} DD+Market+Strategy report (${view.reportStatus})`, {
    entity: entity || null,
    refTable: 'landos_deal_card_report',
    refId: dealCardId,
  });
}

// ── The operational workflow ─────────────────────────────────────────────────

/**
 * Run the DD + Market + Strategy report for a Deal Card. Builds identity inputs
 * from the Deal Card, runs the SAFE non-credit LandPortal exact resolve
 * (injected), builds the three department legs, updates the three worksheets
 * (non-destructively), and persists a reload-safe report. Returns null when the
 * Deal Card does not exist. Never spends a comp credit, never fabricates parcel
 * facts/comps/demand/pricing/EVs/offers, and never mutates an external system.
 */
/** Persist external browser land comps (Zillow/Redfin) into the unified comp
 *  dataset (landos_comp), deduped against LandPortal comps (by price+acres) AND
 *  every existing comp on the deal card (by address, and by price+acres). Runs in
 *  source order so a later source dedupes against earlier ones. Returns # added. */
function persistExternalLandComps(opts: {
  dealCardId: number; cardId: number; entity: LandosEntity; sourceLabel: 'Zillow' | 'Redfin';
  comps: Array<{ address: string; price: number; acres: number | null; url: string | null }>;
  lpComparables: Array<{ price?: number | null; acres?: number | null }>;
}): number {
  const norm = (v: string | null | undefined): string => (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const existing = listComps({ dealCardId: opts.dealCardId });
  const seenAddr = new Set(existing.map((c) => norm(c.address_desc)));
  const priceAcre = new Set<string>([
    ...opts.lpComparables.filter((c) => c.price != null && c.acres != null).map((c) => `${c.price}:${c.acres}`),
    ...existing.filter((c) => c.price != null && c.acres != null).map((c) => `${c.price}:${c.acres}`),
  ]);
  let added = 0;
  for (const z of opts.comps) {
    const akey = norm(z.address);
    if (!akey || seenAddr.has(akey)) continue;                                  // dedup by address (LP has none; Zillow/Redfin do)
    if (z.acres != null && priceAcre.has(`${z.price}:${z.acres}`)) continue;    // dedup by price+acres (vs LP + prior sources)
    seenAddr.add(akey);
    if (z.acres != null) priceAcre.add(`${z.price}:${z.acres}`);
    addComp({ entity: opts.entity, dealCardId: opts.dealCardId, cardId: opts.cardId, sourceLabel: opts.sourceLabel, sourceUrl: z.url ?? '', addressDesc: z.address, price: z.price, priceKind: 'list', acres: z.acres ?? undefined, status: 'market_reference', addedBy: `${opts.sourceLabel.toLowerCase()}/browser` });
    added++;
  }
  return added;
}

export async function runDealCardReport(
  dealCardId: number,
  deps: DealCardReportDeps,
): Promise<DealCardReportResult | null> {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const actor = (deps.actor ?? 'tyler/report').trim() || 'tyler/report';
  const warnings: string[] = [];

  const dd = getDealCardDd(dealCardId);
  const market = getDealCardMarket(dealCardId);
  const strategy = getDealCardStrategy(dealCardId);
  // The AUTHORITATIVE confirmation gate for every department the report drives
  // (comps, strategy). Read the stored verdict now; it is upgraded/persisted after
  // verification when a named source confirms the parcel during this run.
  let confirmedParcel = confirmParcelForDeal(dealCardId);

  // 1. Safe parcel identification. REUSE persisted verified data when a linked
  //    Property Card is already verified (no provider call, no Realie credit),
  //    unless the operator forces re-verification. Only re-query the provider
  //    when there is no verified card or reverify is explicitly requested.
  const verifiedCard = (deal.propertyCards as Array<Record<string, unknown>>).find(
    (c) => c.verification_status === 'verified_property' &&
      (s(c.apn) || s(c.lp_property_id) || s(c.parcel_id) || s(c.active_input_address)),
  );
  const usedPersistedVerification = !!verifiedCard && !deps.reverify;
  const effectiveResolve = usedPersistedVerification ? buildPersistedResolver(verifiedCard!) : deps.resolve;

  const identityText = buildIdentityText(deal, dd);
  let verification: DukeVerificationResult;
  if (deps.prefetchedVerification) {
    // REUSE the verification the caller already fetched for this parcel — no
    // second provider lookup (this removes the acquire→report double-verify).
    verification = deps.prefetchedVerification;
  } else {
    try {
      verification = await runDukeVerification(identityText, { resolve: effectiveResolve, timeoutMs: deps.timeoutMs });
    } catch {
      // Unexpected engine error — honest failed report, no worksheet mutation.
      const failed: DealCardReportView = {
        ...emptyReport(dealCardId),
        exists: true,
        reportStatus: 'failed',
        parcelVerificationStatus: 'Failed — safe lookup error',
        ddSummary: 'The report could not run: the safe parcel lookup errored. No worksheet was changed and no comp credit was used.',
        generatedAt: Math.floor(Date.now() / 1000),
        updatedBy: actor,
      };
      persistReport(dealCardId, failed, actor, s(deal.entity));
      return { report: getDealCardReport(dealCardId), warnings: ['Safe parcel lookup errored; report saved as failed.'] };
    }
  }

  // A named source verifying the parcel during this run IS confirmation (rule 1).
  // Persist the authoritative verdict so downstream departments (strategy, comps)
  // receive a ConfirmedParcel — including verified cards created outside acquire
  // that have no stored verdict yet. Idempotent; confirmed_at is preserved.
  if (verification.parcelVerified && !confirmedParcel) {
    try {
      const subjId = (verifiedCard?.id ?? (deal.propertyCards as Array<Record<string, unknown>>)[0]?.id) as number | undefined;
      const rec = writeParcelIdentity(dealCardId, {
        subjectCardId: subjId ?? null,
        state: 'confirmed',
        basis: `Parcel verified by ${verification.verificationSource ?? 'a named source'} during the report run.`,
        confidence: 0.95,
        confirmedBy: 'report',
      }, 'report');
      confirmedParcel = confirmParcel(rec);
    } catch { /* verdict persistence never blocks the report */ }
  }

  // Propagate VERIFIED IDENTITY to the subject property card so its
  // verification_status / kanban agree with the report. Parcel-identity
  // verification is SEPARATE from DD completeness: a Realie-verified parcel must
  // read "identity verified" on the card even while DD is still incomplete.
  // Strong identity only (APN or property id); never downgrades (only runs on
  // parcelVerified), so a verified card stays verified across reruns.
  if (verification.parcelVerified && verification.propertyData) {
    const pid = verification.propertyData.identity as { apn?: string; propertyId?: string; fips?: string; county?: string; state?: string; situsAddress?: string; owner?: string };
    const subjectCard = (deal.propertyCards as Array<Record<string, unknown>> | undefined)?.[0];
    const subjectCardId = subjectCard ? Number(subjectCard.id) : undefined;
    if (subjectCardId && (s(pid.apn) || s(pid.propertyId))) {
      const lf = verification.propertyData.landFacts as { acres?: number } | undefined;
      upsertCardFromDukeRun({
        entity: s(deal.entity) as LandosEntity,
        agentId: 'duke-due-diligence',
        cardId: subjectCardId,
        activeInputAddress: s(pid.situsAddress) || s((subjectCard as { active_input_address?: string }).active_input_address) || s(deal.title) || `deal ${dealCardId}`,
        county: s(pid.county), state: s(pid.state), apn: s(pid.apn),
        lpPropertyId: s(pid.propertyId), fips: s(pid.fips), owner: s(pid.owner),
        acres: typeof lf?.acres === 'number' ? lf.acres : undefined,
        // Persist verified-parcel coordinates (enrichment output) so a reopened
        // card keeps Realie/Zillow comps, imagery, and map context. Never identity.
        lat: verification.coordinates?.lat ?? null,
        lng: verification.coordinates?.lng ?? null,
        verified: true,
        verificationSource: verification.verificationSource ?? 'Realie.ai (non-credit)',
        summary: verification.propertyData.note ?? verification.summary,
      });
    }
  }

  const landportalAttempted = verification.sourceAttempts.some((a) => a.status !== 'skipped');
  const landportalUnavailable = verification.dataGaps.includes('landportal_unavailable');

  // 1b. AREA-CONTEXT LOCUS. When exact parcel identity is NOT verified but the
  //     subject Property Card already carries a geocoded location (city/county/
  //     state + address-centroid lat/lng from intake), use it to drive comps,
  //     census, gov-DD, and Market Pulse as LOCAL AREA CONTEXT (weaker, clearly
  //     "Not Parcel Verified"). Coordinates here are supporting output only and
  //     NEVER identity — the report never flips to verified from this path.
  const areaContext = verification.parcelVerified ? null : await deriveAreaContext(deal);

  // 2. Department legs (kept separate).
  const ddLeg = buildDdLeg(verification, dd);
  const marketLeg = buildMarketLeg(deal, verification, market, areaContext ?? undefined);
  const strategyLeg = buildStrategyLeg(verification, strategy, confirmedParcel);

  // 3. Update the three worksheets (non-destructive: lists unioned, manual
  //    deep notes preserved). Attach the LandPortal source link to DD so the
  //    verified facts legitimately carry the "Verified" label.
  const ddPatch: DealCardDdPatch = {
    ...ddLeg.patch,
    dataGaps: union(dd.dataGaps, ddLeg.dataGaps),
    riskFlags: union(dd.riskFlags, ddLeg.riskFlags),
    sourceLinks: ddLeg.lpSourceLink ? unionLinks(dd.sourceLinks, [ddLeg.lpSourceLink]) : dd.sourceLinks,
    updatedBy: actor,
  };
  const ddRes = upsertDealCardDd(dealCardId, ddPatch);
  if (ddRes) warnings.push(...ddRes.warnings);

  const marketRes = upsertDealCardMarket(dealCardId, { ...marketLeg.patch, updatedBy: actor });
  if (marketRes) warnings.push(...marketRes.warnings);

  const strategyRes = upsertDealCardStrategy(dealCardId, { ...strategyLeg.patch, updatedBy: actor });
  if (strategyRes) warnings.push(...strategyRes.warnings);

  // 4. Build the unified source table (parcel-exact + market-pulse). The parcel
  //    source reflects the actual provider/provenance (LandPortal, Realie, or a
  //    reused persisted verified Property Card). No comp credit is ever used.
  const parcelSourceLabel = usedPersistedVerification
    ? (verification.verificationSource || 'Persisted verified Property Card') + ' (reused — no provider call)'
    : (verification.verificationSource || 'Parcel identity provider') + ' (non-credit)';
  const lpRow: DealCardReportSourceRow = {
    source: parcelSourceLabel,
    kind: 'parcel_exact',
    status: verification.parcelVerified
      ? 'used_non_credit'
      : landportalUnavailable
        ? 'unavailable'
        : landportalAttempted
          ? 'attempted_not_verified'
          : 'manual_entry_needed',
    detail: verification.parcelVerified
      ? (usedPersistedVerification
          ? 'Parcel identity reused from the persisted verified Property Card — no provider call, no Realie credit.'
          : 'Parcel verified via the non-credit exact property-data lookup. No comp credit used.')
      : landportalUnavailable
        ? 'LandPortal exact lookup unavailable (not configured or unreachable). No comp credit used.'
        : landportalAttempted
          ? `${verification.summary}`
          : 'No usable parcel identifier on the Deal Card yet — provide APN + county/state, owner + county/state, or LP property id + FIPS.',
    compCreditUsed: false,
  };
  const sourceTable = [lpRow, ...marketLeg.sourceRows];

  // 5. Aggregate gaps/risks for the report (de-duplicated; worksheet stays the
  //    source of truth, the report mirrors the current combined picture).
  const dataGaps = union(union(ddLeg.dataGaps, marketLeg.dataGaps), []);
  const riskFlags = union(ddLeg.riskFlags, []);

  // 6. Report status: verified+clean -> complete; verified-with-gaps or
  //    local-area-context -> complete_with_gaps; lookup unavailable -> blocked.
  let reportStatus: DealCardReportStatus;
  if (landportalUnavailable) reportStatus = 'blocked';
  else if (verification.parcelVerified && dataGaps.length === 0) reportStatus = 'complete';
  else reportStatus = 'complete_with_gaps';

  const parcelVerificationStatus = verification.parcelVerified
    ? `Parcel verified (${verification.verificationSource || 'exact source'}, non-credit)`
    : verification.localAreaContextLabel ?? 'Not parcel verified';

  // Visual Property Context (supporting only, never verification). Built PURELY
  // here — NO Google call. Captured images (from a prior explicit capture) are
  // loaded from the linked Property Card and surfaced as dashboard-safe URLs;
  // services without a capture render as placeholders + deep links.
  // Government environmental DD (FEMA/NWI/USGS) — computed first so its verified
  // facts merge into the DD checklist with their OWN per-field provenance.
  const areaCoords = areaContext && typeof areaContext.lat === 'number' && typeof areaContext.lng === 'number'
    ? { lat: areaContext.lat, lng: areaContext.lng }
    : null;
  const govDd = await buildGovDd(verification, { femaFetch: deps.femaFetch, nwiFetch: deps.nwiFetch, usgsFetch: deps.usgsFetch }, areaCoords);
  const ddChecklistRows = [
    ...buildIdentityChecklistRows(verification),
    ...mergeGovDdRows(
      buildDdChecklist(verification.propertyData?.landFacts, verification.verificationSource ?? null),
      govDd,
    ),
  ];
  const vid = verification.identity;
  const visualCardId = (verifiedCard?.id ?? (deal.propertyCards as Array<Record<string, unknown>>)[0]?.id) as number | undefined;
  // ITEM 1: Google visual auto-capture/REUSE. For a verified parcel, capture once
  // (satellite + Street View) and persist to the card; on later runs reuse the
  // persisted capture (no repeat Google call). Honest no-op when not configured.
  const googleConfigured = deps.googleVisualConfigured ?? googleVisualConfigured();
  if (visualCardId && googleConfigured && (verification.parcelVerified || areaContext)) {
    const already = loadCardVisualCapture(visualCardId);
    // Best available address for imagery: the verified situs, else the card's
    // original input address (a verified parcel may lack a normalized situs).
    const imageryAddress = s(vid?.situsAddress) || s(areaContext?.address) || s((deal.propertyCards?.[0] as { active_input_address?: string } | undefined)?.active_input_address) || '';
    const hasCoordsOrAddr = !!(verification.coordinates || imageryAddress);
    if (Object.keys(already).length === 0 && hasCoordsOrAddr) {
      // Imagery needs coordinates. When the parcel provider returns none, geocode
      // the VERIFIED address for IMAGERY ONLY (supporting context, never identity)
      // so satellite/Street-View reliably appear for a verified parcel.
      let imageryCoords = verification.parcelVerified ? (verification.coordinates ?? null) : (areaCoords ?? null);
      if (!imageryCoords && imageryAddress) {
        try {
          const { deriveCounty } = await import('./providers/county-geocode.js');
          const g = await deriveCounty({ address: imageryAddress, city: vid?.city ?? areaContext?.city, state: vid?.state ?? areaContext?.state });
          if (g && g.lat != null && g.lng != null) imageryCoords = { lat: g.lat, lng: g.lng };
        } catch { /* supporting-only; never fail the report */ }
      }
      try {
        // The capture reads its key from the env it's given; the app keeps secrets
        // in the .env FILE (not process.env), so pass the file-resolved Google key
        // (same fix class as Realie/Zillow). Test injection (deps.captureVisuals)
        // is used as-is.
        const doCapture = deps.captureVisuals ?? ((inp: CaptureInput) => capturePropertyVisuals(inp, { env: resolveGoogleVisualEnv() }));
        const cap = await doCapture({
          propertyLabel: imageryAddress || `deal ${dealCardId}`,
          address: imageryAddress || null,
          coords: imageryCoords,
        });
        if (cap.captured && Object.keys(cap.assets).length > 0) {
          saveCardVisualCapture(visualCardId, cap.assets as Record<string, CardVisualAsset>, { provider: 'google' });
        }
      } catch { /* visuals are supporting-only; never fail the report on a capture error */ }
    }
  }
  const rawCaptured = visualCardId ? loadCardVisualCapture(visualCardId) : {};
  const captured: Partial<Record<VisualService, { storedPath: string; timestamp?: string; url?: string }>> = {};
  for (const [svc, a] of Object.entries(rawCaptured)) {
    captured[svc as VisualService] = {
      storedPath: a.storedPath,
      timestamp: a.timestamp,
      url: `/api/landos/visual/image?cardId=${visualCardId}&service=${encodeURIComponent(svc)}`,
    };
  }
  const visualContext = buildVisualPropertyContext(
    {
      address: vid?.situsAddress ?? areaContext?.address ?? null,
      city: vid?.city ?? areaContext?.city ?? null,
      county: vid?.county ?? areaContext?.county ?? null,
      state: vid?.state ?? areaContext?.state ?? null,
    },
    { configured: deps.googleVisualConfigured ?? false, captured },
  );
  const rawInspection = visualCardId ? loadPropertyInspection(visualCardId) : null;
  const landportalInspection = rawInspection
    ? {
        parcelUrl: rawInspection.parcelUrl,
        comparablesUrl: rawInspection.comparablesUrl,
        parcelFacts: rawInspection.parcelFacts,
        assets: [
          ...rawInspection.assets.map((asset) => ({
            key: asset.key,
            label: asset.label,
            kind: asset.kind,
            url: `/api/landos/inspection/image?cardId=${visualCardId}&key=${encodeURIComponent(asset.key)}`,
            timestamp: asset.timestamp,
            overlay: asset.overlay,
            note: asset.note,
          })),
          // Google Static Map (aerial) + Street View, when captured — served from
          // the card-visual store. Supporting context: Visual Signal, Not Verified Fact.
          ...Object.entries(loadCardVisualCapture(visualCardId!)).map(([service, a]) => ({
            key: `google_${service}`,
            label: service === 'maps_static' ? 'Google Aerial' : service === 'street_view_static' ? 'Google Street View' : `Google ${service}`,
            kind: 'google',
            url: `/api/landos/visual/image?cardId=${visualCardId}&service=${encodeURIComponent(service)}`,
            timestamp: (a as { timestamp: string }).timestamp,
            overlay: undefined as string | undefined,
            note: 'Google imagery — Visual Signal, Not Verified Fact.',
          })),
        ],
        overlays: rawInspection.overlays.map((overlay) => ({
          overlay: overlay.overlay,
          status: overlay.status,
          note: overlay.note,
          confidence: overlay.confidence,
          screenshotUrl: overlay.screenshotKey
            ? `/api/landos/inspection/image?cardId=${visualCardId}&key=${encodeURIComponent(overlay.screenshotKey)}`
            : null,
        })),
        visualObservations: rawInspection.visualObservations,
        comparables: rawInspection.comparables,
        sources: rawInspection.sources,
        evidence: rawInspection.evidence,
        discoveryQuestions: rawInspection.discoveryQuestions,
        missingInformation: rawInspection.missingInformation,
        factSheet: buildParcelFactSheet(rawInspection.parcelFacts),
      }
    : null;

  // ITEM: Zillow + Redfin PUBLIC land comps via ISOLATED disposable browser
  // profiles — each its OWN throwaway profile + debug port, NEVER the LandPortal
  // authenticated session and never each other's profile. Fully best-effort: any
  // failure/blocked/none records a source status and NEVER blocks LandPortal, the
  // other source, or the report. Deduped across LandPortal + prior sources and
  // persisted into the unified comparable dataset (landos_comp) so the same
  // Comparable Intelligence table renders them. Redfin runs AFTER Zillow so it
  // dedupes against Zillow's just-added comps too.
  if (visualCardId && landportalInspection?.factSheet && (deps.captureZillowComps || deps.captureRedfinComps)) {
    const fsheet = landportalInspection.factSheet;
    const loc = { city: fsheet.city ?? undefined, state: fsheet.stateCode ?? undefined, county: fsheet.county ?? undefined, subjectAcres: fsheet.acres ?? null };
    const lpComparables = rawInspection?.comparables ?? [];
    const entity = s(deal.entity) as LandosEntity;
    if (deps.captureZillowComps) {
      try {
        const z = await deps.captureZillowComps(loc);
        attachCardActivity({ cardId: visualCardId, agentId: 'zillow/browser', kind: 'zillow_comp_status', summary: `Zillow land comps: ${z.status} — ${z.comps.length} comp(s). ${z.note}` });
        if (z.status === 'retrieved' && z.comps.length > 0) persistExternalLandComps({ dealCardId, cardId: visualCardId, entity, sourceLabel: 'Zillow', comps: z.comps, lpComparables });
      } catch { /* Zillow best-effort — never block the report */ }
    }
    if (deps.captureRedfinComps) {
      try {
        const rf = await deps.captureRedfinComps(loc);
        attachCardActivity({ cardId: visualCardId, agentId: 'redfin/browser', kind: 'redfin_comp_status', summary: `Redfin land comps: ${rf.status} — ${rf.comps.length} comp(s). ${rf.note}` });
        if (rf.status === 'retrieved' && rf.comps.length > 0) persistExternalLandComps({ dealCardId, cardId: visualCardId, entity, sourceLabel: 'Redfin', comps: rf.comps, lpComparables });
      } catch { /* Redfin best-effort — never block Zillow/LandPortal or the report */ }
    }
  }

  // ITEM 2: Apify Redfin sold comps + market metrics for the verified parcel's
  // area. Live where configured (injectable for tests); honest status otherwise.
  let marketComps = emptyMarketComps();
  let compQuery: CompQueryLite | null = null;
  if (verification.parcelVerified) {
    const lf = verification.propertyData?.landFacts as { acres?: number; buildingAreaSqft?: number | string; buildingArea?: number | string; yearBuilt?: number | string; landUse?: string } | undefined;
    // Improved subject = has a structure (building area / year built / use code).
    const bArea = Number(String(lf?.buildingAreaSqft ?? lf?.buildingArea ?? '').replace(/[^0-9.]/g, '')) || 0;
    const subjectImproved = bArea > 0 || (!!lf?.yearBuilt && Number(lf.yearBuilt) > 1900) || /home|house|dwelling|residence|mobile|improv|structure/i.test(lf?.landUse ?? '');
    compQuery = {
      improved: subjectImproved,
      address: vid?.situsAddress ?? undefined,
      city: vid?.city ?? undefined,
      county: vid?.county ?? undefined,
      state: vid?.state ?? undefined,
      // ZIP for the Zillow supplemental lane — from the situs address tail.
      zip: vid?.situsAddress?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1],
      acres: typeof lf?.acres === 'number' ? lf.acres : undefined,
      lat: verification.coordinates?.lat,
      lng: verification.coordinates?.lng,
    };
  } else if (areaContext && (areaCoords || (areaContext.state && (areaContext.city || areaContext.zip || areaContext.county)))) {
    // Local Area Context comps: countywide / nearby $/acre from the geocoded
    // address centroid. Clearly weaker than parcel-specific comps (the report is
    // labeled Not Parcel Verified), but real, non-fabricated, and operator-usable.
    compQuery = {
      improved: false,
      address: areaContext.address,
      city: areaContext.city,
      county: areaContext.county,
      state: areaContext.state,
      zip: areaContext.zip,
      acres: areaContext.acres,
      lat: areaCoords?.lat,
      lng: areaCoords?.lng,
    };
  }
  if (compQuery) {
    try {
      marketComps = deps.retrieveCompsImpl
        ? await deps.retrieveCompsImpl(compQuery)
        : await liveMarketComps(compQuery, confirmedParcel, { researchDriver: deps.compResearchDriver });
    } catch (e: unknown) {
      marketComps = { ...emptyMarketComps(), status: 'error', note: `Comp retrieval error: ${(e as Error)?.message ?? String(e)}.` };
    }
  }

  // Census demographics (supporting market context). Verified parcel uses its
  // county FIPS; an unverified area lead uses the FIPS derived for its locality.
  let demographics = emptyCensus();
  const demographicsFips = verification.parcelVerified ? verification.identity?.fips : areaContext?.fips;
  if (demographicsFips) {
    demographics = await fetchCensusDemographics(demographicsFips, { fetchImpl: deps.censusFetch });
  }

  // LandOS 100-point Land Score — computed from the SAME approved-provider data the
  // report already resolved (NOT a separate re-resolve, which fails for parcels
  // verified via a persisted browser read). Consumes verified property data AND the
  // LandPortal parcel fact sheet (road frontage, wetlands, FEMA, buildability,
  // acreage, valuation) so LandPortal data is scored, not ignored (2026-07-04
  // product correction), cross-checked by live gov-DD. Only scored when identity is
  // source-verified; a value no approved provider gave stays a loud data gap.
  const scoreInputs = verification.parcelVerified
    ? landFactsForScore(verification.propertyData, landportalInspection?.factSheet, govDd)
    : null;
  const landScore = scoreInputs ? computeLandScore(scoreInputs) : null;
  // Name the Buildability source (LandPortal buildability % and/or USGS slope) on
  // the factor, and surface a loud flag when the two approved sources materially
  // disagree (never a silent gap; LandPortal is never ignored).
  if (landScore && scoreInputs?.buildability) {
    const bf = landScore.factors.find((f) => f.id === 'slope_buildability');
    if (bf && !bf.dataGap) {
      bf.basis = scoreInputs.buildability.basis;
      if (scoreInputs.buildability.conflict) {
        landScore.flags.push(`Buildability sources disagree — ${scoreInputs.buildability.basis}.`);
      }
    }
  }

  const view: DealCardReportView = {
    exists: true,
    dealCardId,
    reportStatus,
    parcelVerificationStatus,
    parcelVerified: verification.parcelVerified,
    ddSummary: ddLeg.summary,
    marketSummary: marketLeg.summary,
    strategySummary: strategyLeg.summary,
    mostViableStrategy: strategyLeg.mostViable,
    offerReadiness: strategyLeg.offerReadiness,
    sourceTable,
    dataGaps,
    riskFlags,
    countyVerificationChecklist: ddLeg.countyChecklist,
    marketFollowUpChecklist: marketLeg.followUpChecklist,
    strategyBlockers: union(strategyLeg.blockers, []),
    nextConfirmations: union(strategyLeg.nextConfirmations, []),
    preCallStrategyNotes: strategyLeg.preCallNotes,
    ddFactChecklist: ddChecklistRows,
    ddCompleteness: summarizeDdCompleteness(ddChecklistRows),
    visualContext,
    landportalInspection,
    govDd,
    marketComps,
    demographics,
    landScore,
    creditUsage: {
      landportalNonCreditUsed: landportalAttempted && !landportalUnavailable,
      compCreditUsed: false,
      note: 'LandPortal non-credit exact property data only. No comp-credit tool (lp_comp_report_create / lp_comp_report_get) was called. No paid API, no secret read.',
    },
    generatedAt: Math.floor(Date.now() / 1000),
    updatedBy: actor,
  };

  persistReport(dealCardId, view, actor, s(deal.entity));
  // Read back so what we return is exactly what persisted (proves reload-safety).
  return { report: getDealCardReport(dealCardId), warnings };
}
