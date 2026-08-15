// Live Property Intelligence collectors — the parent mission's real work.
//
// Each collector adapts ONE existing LandOS subsystem into the specialist
// contribution shape. Nothing here invents a fact: every value is read from a
// persisted official outcome, a retained artifact, or a provider result, and it
// carries the evidence grade that reflects how it was obtained.
//
// The heavy, closure-bound entry points (public property intelligence, the
// browser comp captures) are injected by the route layer so this module stays
// independently testable and free of route wiring.

import fs from 'node:fs';

import { logger } from '../logger.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import { currentComparables, getPropertyCard, loadPropertyInspection } from './property-card.js';
import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { PublicIntelligenceStore } from './public-intelligence-store.js';
import { buildOperatorPropertyRecord, type OperatorPropertyRecord } from './operator-property-record.js';
import { readGovernmentRecordsForDeal, synchronizeGovernmentRecordsForDeal } from './government-records-legacy-adapter.js';
import { acceptedGoverningAuthorityForDeal } from './land-use-jurisdiction-bridge.js';
import { readZoningLandUseForDeal, synchronizeZoningLandUseForDeal } from './zoning-legacy-adapter.js';
import { parseLandPortalCompRows } from './comp-extraction.js';
import { documentRegistryForCard } from './deal-card-canonical.js';
import { listComps } from './comps.js';
import { getLandosDb } from './db.js';
import { listPublicRecordOutcomes } from './lead-card-intake.js';
import { distinctApnIdentities, type SnapshotDueDiligenceItem, type SnapshotEvidenceItem, type SnapshotFact, type SnapshotIdentity } from './property-intelligence-snapshot.js';
import { governmentFactsFromPublicRecordOutcomes, officialParcelSourceCoverage } from './public-property-intelligence-live.js';
import type { GovernmentRecordArtifactView } from './government-records-types.js';
import { reconcileDiscoveryIdentity } from './discovery-identity.js';
import {
  resolveSubjectProperty,
  type IdentityLaneResult,
  type IndexedWebLaneOptions,
  type JurisdictionLaneOptions,
} from './universal-property-resolution.js';
import type { LandPortalSearchPackage } from './landportal-subject-upgrade.js';
import {
  ACCESS_UTILITY_TASKS,
  ENVIRONMENTAL_TASKS,
  GOVERNMENT_RECORD_TASKS,
  VISUAL_EVIDENCE_TASKS,
  ZONING_TASKS,
  countyRecordFactsFromPublicRun,
  publicLaneExecution,
  snapshotEvidenceFromPublicTasks,
} from './property-intelligence-specialist-execution.js';
import type {
  AccessUtilitiesContribution,
  ComparablesContribution,
  EnvironmentalContribution,
  EvidenceContribution,
  GovernmentRecordsContribution,
  IdentityContribution,
  MarketContribution,
  MissionContext,
  PropertyIntelligenceCollectors,
  SpecialistOutcome,
  ZoningContribution,
} from './property-intelligence-collector-types.js';
import { buildCompRegistry, type CompRegistryCandidate } from './comp-registry.js';
import { landosArtifactPath } from './storage-profile.js';
import {
  executePropertyProvider,
  type CanonicalPropertyInput,
  type NormalizedPropertyEvidence,
  type PropertyProviderAdapter,
  type PropertyProviderResult,
} from './property-intelligence-contract.js';
import { isAcceptedLandPortalVisualForProperty } from './landportal-evidence-validation.js';
import type { HermesLandPortalLaneOutcome } from './hermes-landportal-auto.js';
import {
  EXACT_ADDRESS_LANE_ID,
  listingAccessEvidenceItems,
  type ExtractedListingEvidence,
} from './exact-address-web-discovery.js';
import type { CompLaneInput } from './comp-lane-accountability.js';
import { saveSubjectListingDetail, type SubjectListingWriteResult } from './subject-listing-store.js';

// ── Injected dependencies ───────────────────────────────────────────────────

export interface LandMarketplaceComp {
  providerId?: string | null;
  address: string | null;
  price: number | null;
  acres: number | null;
  pricePerAcre?: number | null;
  url?: string | null;
  status?: string | null;
  saleDate?: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  views?: number | null;
  saves?: number | null;
  priceChanges?: Array<{ at: string | null; price: number | null; note: string }>;
  collectedAt?: string | null;
  distanceMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
  thumbnailUrl?: string | null;
  photoUrls?: string[];
}

export interface LandMarketplaceResult {
  status: string;
  sold: LandMarketplaceComp[];
  active: LandMarketplaceComp[];
  note?: string | null;
  searchProof?: {
    radiusMiles: number;
    timePeriodMonths: number;
    sourcesSearched: string[];
    routesAttempted: string[];
    candidatesReviewed: number;
    qualifyingResults: number;
    exclusionReasons: Array<{ reason: string; count: number }>;
  };
}

export interface ExactAddressWebResult {
  status: 'retrieved' | 'none' | 'blocked' | 'error';
  queries: string[];
  pages: ExtractedListingEvidence[];
  note: string;
  /** Owned-page cleanup record, written by the shared browser-scope wrapper. */
  browserCleanup?: { closed: number; failed: number; preserved: number };
  /** Truthful durable-write outcome for the canonical subject record. */
  persistence?: SubjectListingWriteResult;
}

export interface LiveCollectorDeps {
  /**
   * Runs the canonical public property intelligence lane (official parcel
   * lookup + the free public screening adapters) and persists its run.
   */
  runPublicIntelligence: (dealCardId: number) => Promise<{ ok: boolean; error?: string }>;
  /** Zillow public land comps, already scoped to the subject market. */
  captureZillowComps?: (input: {
    address: string | null; city: string | null; county: string | null; state: string | null; zip: string | null;
    apn: string | null; owner: string | null; lat: number | null; lng: number | null; subjectAcres: number | null;
  }) => Promise<LandMarketplaceResult>;
  /** Redfin public land comps, already scoped to the subject market. */
  captureRedfinComps?: (input: {
    address: string | null; city: string | null; county: string | null; state: string | null; zip: string | null;
    apn: string | null; owner: string | null; lat: number | null; lng: number | null; subjectAcres: number | null;
  }) => Promise<LandMarketplaceResult>;
  /** Direct Realtor.com public land comps (not the excluded HomeHarvest feed). */
  captureRealtorComps?: (input: {
    address: string | null; city: string | null; county: string | null; state: string | null; zip: string | null;
    apn: string | null; owner: string | null; lat: number | null; lng: number | null; subjectAcres: number | null;
  }) => Promise<LandMarketplaceResult>;
  /** General exact-address discovery, independent of marketplace comp lanes. */
  captureExactAddressWeb?: (input: CanonicalPropertyInput) => Promise<ExactAddressWebResult>;
  /** Dedicated sold manufactured-home lane. It runs only with subject coordinates;
   *  the provider must enforce >$200k and <=5 miles before returning rows. */
  captureManufacturedHomeComps?: (input: {
    address: string | null; city: string | null; county: string | null; state: string | null; zip: string | null;
    apn: string | null; owner: string | null; lat: number; lng: number; subjectAcres: number | null;
  }) => Promise<LandMarketplaceResult>;
  /** Market Matrix / Market Pulse context for the subject market. */
  captureMarketContext?: (dealCardId: number) => Promise<{ facts: SnapshotFact[]; summary: string }>;
  /**
   * Read the authenticated LandPortal parcel page for a property card and
   * persist the inspection (cumulative merge — never destructive). This is the
   * PRIMARY comparable lane: the free visible "similar sales" rows on the
   * parcel page. It must never trigger the paid comp report.
   *
   * Injected because the browser factories, the LandPortal auth path and the
   * single-tab mission gate all live in the route layer.
   */
  captureLandPortalInspection?: (input: {
    cardId: number;
    searchKey: { address: string | null; apn: string | null; county: string | null; state: string | null; city: string | null; owner: string | null };
    /** Called once the verified subject parcel's own facts are read and
     *  persisted, ahead of the imagery and deep-record half of the capture. The
     *  returned promise still settles only when the whole capture is done. */
    onSubjectReady?: (capture: { ok: boolean; note: string; comparableCount: number }) => void;
  }) => Promise<{ ok: boolean; note: string; comparableCount: number }>;
  /** Automatic Hermes LandPortal lane. It imports its exact-match file through
   *  the canonical importer before settling and never blocks another provider. */
  captureHermesLandPortal?: (input: {
    runId: string;
    dealCardId: number;
    propertyCardId: number;
    address: string;
    apn: string | null;
    owner: string | null;
    county: string | null;
    state: string | null;
    landPortalPropertyId: string | null;
  }) => Promise<HermesLandPortalLaneOutcome>;
  /** Maximum time parcel identity waits for the authenticated LandPortal
   * capture. The browser work may finish later and persist its cumulative
   * evidence, but it must not consume the whole required-child deadline. */
  landPortalCaptureWaitMs?: number;
  /** Maximum time the required identity child waits for the independent public
   * refresh. The refresh remains safely handled in the background after this
   * handoff; it must not cancel an otherwise established LandPortal identity. */
  publicRefreshWaitMs?: number;
  /** Persist a provider handback immediately when that independent lane settles. */
  persistProviderResult?: (result: PropertyProviderResult) => PropertyProviderResult | Promise<PropertyProviderResult>;
  /**
   * Wire the Universal Resolver's indexed-web identity lane.
   *
   * Left unset the lane does not run, so unit tests never reach the network and
   * an unwired deployment behaves exactly as before. The route layer supplies
   * the shared government-page text transport; there is no browser involved.
   */
  indexedWebIdentity?: IndexedWebLaneOptions;
  /**
   * Wire the Universal Resolver's jurisdiction lane, which establishes the
   * county every official parcel source is selected by. Off unless supplied,
   * so a unit test never reaches the federal geography service by accident.
   */
  jurisdictionEnrichment?: JurisdictionLaneOptions;
  /**
   * Promote the resolved subject through the canonical identity path.
   *
   * Unset, this is `reconcileSubjectIdentity`, which consults the federal
   * address file over the network. Injected so tests exercise the real
   * reconciliation without a live geocoder call.
   */
  promoteSubjectIdentity?: (dealCardId: number, actor: string) => Promise<unknown>;
  now?: () => string;
}

/**
 * How long parcel identity waits for the authenticated LandPortal capture.
 *
 * This was 90 seconds, which is below what a COLD parcel lookup actually costs.
 * Measured on live runs, a capture that succeeds takes 63-86s and one that has
 * to search from a bare street address takes materially longer: 5170 Hwy 60
 * (card 77) resolved its parcel at 220s, 130s after the run had already given
 * up and recorded the subject as unresolved. The evidence was retrieved, fully
 * correct, and thrown away — every screening lane had already been gated off
 * for want of an APN and jurisdiction.
 *
 * The window is therefore sized to the work rather than to a round number, and
 * still nests inside the two bounds above it: the public refresh handoff
 * (330s) and parcel identity's outer required-child deadline (420s). A capture
 * that overruns even this is not lost — `capturePromise` continues
 * independently and promotes its identity when it lands (see below).
 */
const LANDPORTAL_CAPTURE_WAIT_MS = 300_000;

const str = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return text.length ? text : null;
};

function hasVerifiedLandPortalSubject(inspection: ReturnType<typeof loadPropertyInspection>): boolean {
  return inspection?.parcelUrlRecord?.verifiedSubject === true;
}

function hasVerifiedPropertyCard(card: Record<string, unknown> | null | undefined): boolean {
  return String(card?.verification_status ?? '') === 'verified_property'
    || card?.verified === 1 || card?.verified === true;
}

function usableInspectionAsset(asset: { storedPath?: string | null }): boolean {
  if (!asset.storedPath) return false;
  try { return fs.statSync(asset.storedPath).isFile() && fs.statSync(asset.storedPath).size >= 8 * 1024; }
  catch { return false; }
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function subjectCardId(deal: unknown): number | null {
  return resolveSubjectPropertyCard(deal).cardId;
}

/** Canonical address-first provider input for every independent research lane. */
export function canonicalPropertyInputForDeal(dealCardId: number): CanonicalPropertyInput | null {
  const deal = getDealCard(dealCardId);
  const resolved = resolveSubjectPropertyCard(deal);
  const property = resolved.card;
  if (!property || resolved.cardId == null) return null;
  const address = str(property.active_input_address) ?? str(property.address) ?? '';
  const normalizedAddress = str(property.normalized_address) ?? address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalizedAddress) return null;
  return {
    propertyCardId: resolved.cardId,
    dealCardId,
    normalizedAddress,
    address,
    city: str(property.city),
    county: str(property.county),
    state: str(property.state),
    zip: str(property.zip),
    apn: str(property.apn),
    fips: str(property.fips),
    landPortalPropertyId: str(property.lp_property_id),
  };
}

async function persistProviderResult<TExecution>(
  deps: LiveCollectorDeps,
  result: PropertyProviderResult<TExecution>,
): Promise<PropertyProviderResult<TExecution>> {
  if (!deps.persistProviderResult) return result;
  const persisted = await deps.persistProviderResult(result);
  // Persistence is allowed to annotate its own outcome only. The provider's
  // typed execution/validation handback remains the immutable lane result.
  return { ...result, persistence: persisted.persistence };
}

// ── Parcel identity ─────────────────────────────────────────────────────────

export async function collectParcelIdentity(
  ctx: MissionContext,
  deps: LiveCollectorDeps,
): Promise<SpecialistOutcome<IdentityContribution>> {
  const now = deps.now ?? (() => new Date().toISOString());
  const initialDeal = getDealCard(ctx.dealCardId);
  if (!initialDeal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const initialResolution = resolveSubjectPropertyCard(initialDeal);
  const initialProperty = initialResolution.card ?? {};
  const initialCardId = initialResolution.cardId;
  let inspectionNote = '';
  let liveNote = '';

  // LandPortal and the independent public-source refresh are separate provider
  // paths. Start them together: running the full public task graph only after
  // the visual inspection made this required identity child take the sum of
  // both latencies and repeatedly cancelled every downstream workspace.
  const canonicalInitial = canonicalPropertyInputForDeal(ctx.dealCardId);
  let hermesStarted = false;
  const startHermesWhenUsable = (
    canonical: CanonicalPropertyInput | null,
    property: Record<string, unknown>,
  ): boolean => {
    if (hermesStarted || !deps.captureHermesLandPortal || !canonical) return false;
    const address = str(property.active_input_address) ?? str(property.address) ?? canonical.address;
    const apn = str(property.apn) ?? canonical.apn;
    const landPortalPropertyId = str(property.lp_property_id) ?? canonical.landPortalPropertyId;
    // Address-first identity becomes usable once it also has a parcel/APN or
    // canonical LandPortal identifier. Address-only intake keeps resolving in
    // the existing identity lanes and launches Hermes as soon as either lands.
    if (!address || (!apn && !landPortalPropertyId)) return false;
    hermesStarted = true;
    void executePropertyProvider({
      runId: ctx.runId,
      property: canonical,
      adapter: hermesLandPortalProviderAdapter({ execute: () => deps.captureHermesLandPortal!({
        runId: ctx.runId,
        dealCardId: ctx.dealCardId,
        propertyCardId: canonical.propertyCardId,
        address,
        apn,
        owner: str(property.owner),
        county: str(property.county) ?? canonical.county,
        state: str(property.state) ?? canonical.state,
        landPortalPropertyId,
      }) }),
    }).then((result) => persistProviderResult(deps, result)).catch(() => {
      // executePropertyProvider already converts the Hermes error to a failed
      // handback. A persistence exception is contained so no sibling lane is
      // cancelled by this independent provider.
    });
    return true;
  };
  // ── DETERMINISTIC CAPTURE FIRST, HERMES AS THE EXCEPTION HANDLER ─────────
  // Hermes used to be started HERE, before the deterministic capture, and
  // `capturePromise` below was then skipped whenever it had started. Because
  // `startHermesWhenUsable` fires as soon as the card carries an APN or a
  // LandPortal id, the effect was backwards: the moment a lead's identity was
  // known — precisely when the direct capture is fastest, since it can open the
  // parcel URL instead of searching for it — LandOS abandoned the direct
  // capture and handed the whole job to an LLM agent loop.
  //
  // Measured on 5170 Hwy 60: the direct capture returned 77 structured parcel
  // fields, slope/terrain metrics and a verified parcel screenshot. Its two
  // later runs produced no new visuals and no comps at all, because this
  // condition meant it never ran again; Hermes spent 18.5 minutes instead and
  // returned a payload the importer could not read a single artifact from.
  //
  // So the direct capture now ALWAYS runs, and Hermes starts after it settles
  // (the existing call below), supplementing what the direct pass could not
  // obtain rather than replacing it.
  const hermesStartedInitially = false;
  // The UNDERLYING browser capture, held separately from the provider wrapper.
  //
  // These settle at different times and the difference is the whole defect: the
  // provider wrapper rejects the moment its own timeout fires, while the browser
  // work carries on and lands its parcel evidence later. Hooking the wrapper to
  // catch a late result therefore fires immediately and sees nothing. Only this
  // promise settles when the capture has actually finished.
  let rawCapturePromise: Promise<{ ok: boolean; note: string; comparableCount: number }> | null = null;
  // Set when the capture handed the subject over early. The lane then settled on
  // the parcel facts while the imagery and deep-record half was still running,
  // so the late-promotion below is still required.
  let subjectHandedOffEarly = false;
  const capturePromise = initialCardId && deps.captureLandPortalInspection && canonicalInitial && !hermesStartedInitially
    ? executePropertyProvider({
      runId: ctx.runId,
      property: canonicalInitial,
      timeoutMs: Math.max(1, deps.landPortalCaptureWaitMs ?? LANDPORTAL_CAPTURE_WAIT_MS),
      adapter: landPortalSubjectProviderAdapter({ cardId: initialCardId, execute: () => {
        // ── THE HANDOFF IS THE SUBJECT, NOT THE WHOLE CAPTURE ────────────────
        // This lane establishes parcel identity. Its input is the parcel's own
        // facts, which the direct API path returns in seconds; the imagery,
        // overlays, 3D and county deep-record work that follows belongs to other
        // lanes entirely. Waiting for all of it is what made the lane report a
        // 300-second timeout for data it had at 36 seconds. Settle on whichever
        // comes first — the early subject handoff or the full capture — and
        // leave the capture itself running and untouched.
        let settleEarly: ((capture: { ok: boolean; note: string; comparableCount: number }) => void) | null = null;
        const subjectReady = new Promise<{ ok: boolean; note: string; comparableCount: number }>((resolve) => { settleEarly = resolve; });
        const started = deps.captureLandPortalInspection!({
          cardId: initialCardId,
          searchKey: {
            address: str(initialProperty.active_input_address) ?? str(initialProperty.address),
            apn: str(initialProperty.apn),
            county: str(initialProperty.county),
            state: str(initialProperty.state),
            city: str(initialProperty.city),
            owner: str(initialProperty.owner),
          },
          onSubjectReady: (capture) => {
            subjectHandedOffEarly = true;
            settleEarly?.(capture);
          },
        });
        rawCapturePromise = started;
        // The loser of the race must not surface as an unhandled rejection: the
        // capture keeps running after this lane has already answered.
        started.catch(() => { /* reported through rawCapturePromise consumers */ });
        return Promise.race([subjectReady, started]);
      } }),
    }).then((result) => persistProviderResult(deps, result)).then(
        (providerResult) => ({ result: providerResult.execution.result?.capture ?? null, error: providerResult.status === 'failed' ? new Error(providerResult.failureReason ?? 'LandPortal subject lane failed.') : null as unknown }),
        (error: unknown) => ({ result: null, error }),
      )
    : null;
  // Attach the rejection handler immediately; LandPortal may still be running
  // when a public provider fails, and an early rejection must not surface as an
  // unhandled promise while the independent capture finishes.
  const publicPromise = canonicalInitial
    ? executePropertyProvider({
      runId: ctx.runId,
      property: canonicalInitial,
      timeoutMs: Math.max(1, deps.publicRefreshWaitMs ?? 330_000),
      adapter: publicPropertyProviderAdapter({ execute: () => deps.runPublicIntelligence(ctx.dealCardId) }),
    }).then((result) => persistProviderResult(deps, result)).then(
    (providerResult) => ({ result: providerResult.execution.result?.capture ?? null, error: providerResult.status === 'failed' ? new Error(providerResult.failureReason ?? 'Public property lane failed.') : null as unknown }),
    (error: unknown) => ({ result: null, error }),
  ) : deps.runPublicIntelligence(ctx.dealCardId).then(
    (result) => ({ result, error: null as unknown }),
    (error: unknown) => ({ result: null, error }),
  );

  // Bound both independent provider paths from the moment they start, then
  // await them together. Starting the public timer only after a stuck browser
  // capture used to make the two nominal bounds additive and let parcel
  // identity hit its outer seven-minute deadline before either handback was
  // assembled.
  const landPortalCaptureWaitMs = Math.max(1, deps.landPortalCaptureWaitMs ?? LANDPORTAL_CAPTURE_WAIT_MS);
  const publicRefreshWaitMs = Math.max(1, deps.publicRefreshWaitMs ?? 330_000);
  let captureWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let publicWaitTimer: ReturnType<typeof setTimeout> | null = null;
  const captureWait = capturePromise ? Promise.race([
    capturePromise.then((outcome) => ({ ...outcome, timedOut: false as const })),
    new Promise<{ result: null; error: null; timedOut: true }>((resolve) => {
      captureWaitTimer = setTimeout(() => resolve({ result: null, error: null, timedOut: true }), landPortalCaptureWaitMs);
    }),
  ]) : Promise.resolve({ result: null, error: null, timedOut: false as const });
  const publicWait = Promise.race([
    publicPromise.then((outcome) => ({ ...outcome, timedOut: false as const })),
    new Promise<{ result: null; error: null; timedOut: true }>((resolve) => {
      publicWaitTimer = setTimeout(() => resolve({ result: null, error: null, timedOut: true }), publicRefreshWaitMs);
    }),
  ]);
  // ── UNIVERSAL PROPERTY RESOLUTION: FIRST SUFFICIENT EVIDENCE WINS ────────
  //
  // This was `await Promise.all([captureWait, publicWait])`, and that join was
  // the defect: a county parcel layer that answered in seconds still waited for
  // the LandPortal browser window to close, and every downstream research lane
  // waited behind it. The waits above are unchanged — each provider keeps its
  // own bound — but they are now RACED. The resolver re-reads the ONE shared
  // property after each lane settles, judges it with the same discovery gate
  // this lane has always used, and returns the moment the subject is
  // established. Slower lanes keep running and reconcile into the same
  // property afterwards; they can never overwrite it with weaker evidence.
  const waits: {
    capture: Awaited<typeof captureWait> | null;
    live: Awaited<typeof publicWait> | null;
  } = { capture: null, live: null };
  const captureLane = captureWait.then((outcome): IdentityLaneResult => {
    if (captureWaitTimer) clearTimeout(captureWaitTimer);
    waits.capture = outcome;
    return {
      lane: 'landportal',
      status: outcome.result?.ok ? 'evidence' : outcome.timedOut ? 'unavailable' : outcome.error ? 'error' : 'no_evidence',
      // The capture persists its own parcel record; there is nothing for the
      // resolver to write on its behalf.
      note: outcome.result?.note ?? (outcome.timedOut ? 'LandPortal subject capture exceeded its identity handoff window.' : 'LandPortal subject capture returned no parcel evidence.'),
      source: { label: 'LandPortal authenticated parcel panel', url: null, officiality: 'officially_linked' },
    };
  });
  const publicLane = publicWait.then((outcome): IdentityLaneResult => {
    if (publicWaitTimer) clearTimeout(publicWaitTimer);
    waits.live = outcome;
    return {
      lane: 'official_parcel',
      status: outcome.result?.ok ? 'evidence' : outcome.timedOut ? 'unavailable' : outcome.error ? 'error' : 'no_evidence',
      // The public run persists its own official parcel match.
      note: outcome.result?.ok
        ? 'The official/statewide public parcel run completed and persisted its match.'
        : outcome.timedOut ? 'The public parcel refresh exceeded its identity handoff window.' : 'The public parcel run matched no official record.',
      source: { label: 'Official public parcel sources', url: null, officiality: 'official' },
    };
  });
  const promoteSubjectIdentity = deps.promoteSubjectIdentity
    ?? ((id: number, who: string) => reconcileSubjectIdentity(id, { actor: who }));
  // The official lane must be RE-RUNNABLE. The first call hands back the
  // already-started public refresh; a re-aim — after the jurisdiction lane
  // establishes the county every official parcel source is selected by — runs
  // it again against the enriched subject. Bounded by `maxLaneReAims`.
  let officialAttempts = 0;
  const officialLane = async (): Promise<IdentityLaneResult> => {
    officialAttempts += 1;
    if (officialAttempts === 1) return publicLane;
    const outcome = await deps.runPublicIntelligence(ctx.dealCardId).then(
      (result) => ({ result, error: null as unknown }),
      (error: unknown) => ({ result: null, error }),
    );
    return {
      lane: 'official_parcel',
      status: outcome.result?.ok ? 'evidence' : outcome.error ? 'error' : 'no_evidence',
      note: outcome.result?.ok
        ? 'The official/statewide public parcel run completed against the enriched jurisdiction and persisted its match.'
        : `The re-aimed official parcel run matched no official record${outcome.result?.error ? ` (${outcome.result.error})` : ''}.`,
      source: { label: 'Official public parcel sources', url: null, officiality: 'official' },
    };
  };

  // The resolver OFFERS a stronger LandPortal package; this layer decides when
  // to act on it, because this layer is the only one that knows whether a
  // capture is still in flight. Two concurrent LandPortal agents for one
  // subject is the failure that separation prevents.
  const landPortalUpgrade: { offered: LandPortalSearchPackage | null } = { offered: null };
  const resolution = await resolveSubjectProperty(ctx.dealCardId, {
    actor: `universal-resolver:${ctx.runId}`,
    promote: promoteSubjectIdentity,
    onLandPortalUpgrade: ({ package: offered }) => { landPortalUpgrade.offered = offered; },
    deadlineMs: Math.max(landPortalCaptureWaitMs, publicRefreshWaitMs) + 1_000,
    lanes: {
      official_parcel: officialLane,
      ...(capturePromise ? { landportal: () => captureLane } : {}),
    },
    ...(deps.indexedWebIdentity ? { indexedWeb: deps.indexedWebIdentity } : {}),
    ...(deps.jurisdictionEnrichment ? { jurisdiction: deps.jurisdictionEnrichment } : {}),
  });
  const capture = waits.capture ?? { result: null, error: null, timedOut: false as const };
  const live = waits.live ?? { result: null, error: null, timedOut: false as const };
  // The resolver released while a lane was still working. That is the point of
  // this sprint, and it is reported as what it is rather than as an overrun.
  const capturePending = !!capturePromise && waits.capture === null;
  const publicPending = waits.live === null;
  // An overrun arrives by either of two routes that mean the same thing: the
  // race timer above fired, or the provider wrapper hit its own timeout first
  // and rejected. Card 77 came back through the SECOND one, so anything that
  // handles only the first misses the case it was written for.
  const captureOverran = capture.timedOut
    || (!!capture.error && /provider lane timed out/i.test((capture.error as Error)?.message ?? String(capture.error)));
  if (capturePending) {
    inspectionNote = ` The subject was established from ${resolution.winner === 'retained_identity' ? 'the retained canonical record' : 'a faster identity source'} without waiting for the LandPortal subject capture; that capture continues independently and lands its parcel evidence when it finishes.`;
  } else if (captureOverran) {
    inspectionNote = ` LandPortal subject capture exceeded the ${Math.round(landPortalCaptureWaitMs / 1000)}-second identity handoff window; it continues independently and any previously retained parcel evidence is used.`;
  } else if (capture.error) {
    inspectionNote = ` LandPortal subject capture errored (${(capture.error as Error)?.message ?? String(capture.error)}).`;
  } else if (capture.result && !capture.result.ok) {
    inspectionNote = ` LandPortal subject capture was limited (${capture.result.note}).`;
  }

  // ── THE LATE-CAPTURE PROMOTION ────────────────────────────────────────────
  // "It continues independently" was already true; nothing consumed what it
  // eventually produced. The run's own identity promotion has long gone by the
  // time an overrunning capture lands, so its APN, FIPS, county and acreage sat
  // in retained evidence while the property card every research lane reads from
  // stayed empty. Card 77 is the measured case: a complete and correct parcel
  // record, retrieved 130 seconds too late to be used by anything.
  //
  // This waits on the RAW capture, not the provider wrapper, so it runs when the
  // browser work actually finished. Reconciliation is the same step the run
  // performs itself: idempotent, and it never blanks a retained value.
  // An early subject handoff leaves the capture running for exactly the same
  // reason an overrun does, so it needs the same promotion when it lands.
  // A capture still running when the resolver released is the SAME situation as
  // an overrun — the lane answered without it — so it gets the same promotion.
  if ((captureOverran || subjectHandedOffEarly || capturePending) && rawCapturePromise) {
    void (rawCapturePromise as Promise<unknown>)
      .then(() => promoteSubjectIdentity(ctx.dealCardId, 'landportal-late-capture') as Promise<Awaited<ReturnType<typeof reconcileSubjectIdentity>>>)
      .then((reconciled) => {
        if (!reconciled?.changes?.length && !reconciled?.conflicts?.length) return;
        logger.info({
          dealCardId: ctx.dealCardId,
          runId: ctx.runId,
          status: reconciled.status,
          changed: reconciled.changes.map((change) => change.field),
          conflicts: reconciled.conflicts.length,
        }, 'landportal_late_capture_identity_promoted');
      })
      .catch((err) => logger.warn({ err, dealCardId: ctx.dealCardId, runId: ctx.runId }, 'landportal_late_capture_identity_promotion_failed'));
  }
  // ── ONE BOUNDED LANDPORTAL SUBJECT UPGRADE ────────────────────────────────
  //
  // LandPortal starts optimistically on the raw lead. When Universal Property
  // Resolution establishes a materially stronger subject while that workflow is
  // still searching, it gets ONE more attempt with the better keys — but only
  // after its first attempt has finished, so there is never a second agent on
  // the browser at the same time, and only when it did not already land on the
  // right parcel. It stays non-blocking throughout: the subject was released
  // long before this runs, and whatever it finds is reconciled through the
  // canonical path, which refuses a conflicting parcel.
  const upgradePackage = landPortalUpgrade.offered;
  if (upgradePackage?.strongerThanIntake && rawCapturePromise && deps.captureLandPortalInspection && initialCardId) {
    const capture = deps.captureLandPortalInspection;
    const cardId = initialCardId;
    void (rawCapturePromise as Promise<unknown>)
      .catch(() => undefined)
      .then(async () => {
        // Already on the right parcel: do nothing at all.
        if (loadPropertyInspection(cardId)?.parcelUrlRecord?.verifiedSubject === true) {
          logger.info({ dealCardId: ctx.dealCardId, runId: ctx.runId }, 'landportal_subject_upgrade_not_needed');
          return;
        }
        logger.info({
          dealCardId: ctx.dealCardId,
          runId: ctx.runId,
          gained: upgradePackage.gainedOverIntake,
          strategies: upgradePackage.attempts.map((attempt) => attempt.strategy),
        }, 'landportal_subject_upgrade_started');
        // A PARCEL NOTATION IS NOT A STREET ADDRESS.
        //
        // `buildLandPortalSearchPackage` already draws that line — it offers an
        // `exact_address` attempt only for a house-numbered street address, and
        // deliberately not for "Map 042 Parcel 123". Forwarding the raw address
        // here threw that judgement away: measured live on Fairview, LandPortal
        // reached the correct parcel by APN and by owner, and the parcel-detail
        // check then blocked it because the situs on screen ("KINGWOOD BLVD")
        // did not contain the operator's notation. It also spent a third search
        // attempt on an address that cannot match.
        //
        // The notation still reaches LandPortal, as the identifier it actually
        // is, through the APN and owner keys below.
        const searchableAddress = upgradePackage.attempts.some((attempt) => attempt.strategy === 'exact_address')
          ? upgradePackage.address
          : null;
        await capture({
          cardId,
          searchKey: {
            address: searchableAddress,
            apn: upgradePackage.apn,
            county: upgradePackage.county,
            state: upgradePackage.state,
            city: upgradePackage.city,
            owner: upgradePackage.owner,
          },
        });
        await promoteSubjectIdentity(ctx.dealCardId, 'landportal-subject-upgrade');
        logger.info({ dealCardId: ctx.dealCardId, runId: ctx.runId }, 'landportal_subject_upgrade_reconciled');
      })
      .catch((err) => logger.warn({ err, dealCardId: ctx.dealCardId, runId: ctx.runId }, 'landportal_subject_upgrade_failed'));
  }

  if (publicPending) {
    liveNote = ` The subject was established before the independent public-source refresh finished; that refresh continues and reconciles into the same property when it lands.`;
  } else if (live.timedOut) {
    liveNote = ` Live public-source refresh exceeded the ${Math.round(publicRefreshWaitMs / 1000)}-second identity handoff window; it continues independently and retained public evidence is used for this handback.`;
  } else if (live.error) {
    liveNote = ` Live parcel lookup errored (${(live.error as Error)?.message ?? String(live.error)}); the persisted identity is used.`;
  } else if (live.result && !live.result.ok) {
    liveNote = ` Live parcel lookup did not confirm a new match (${live.result.error ?? 'no match'}).`;
  }

  // Address-only intake may have gained APN/property-id identity from either
  // existing lane above. Start Hermes now without awaiting it; downstream
  // Zillow, Redfin, market, public-record, and screening specialists continue.
  startHermesWhenUsable(
    canonicalPropertyInputForDeal(ctx.dealCardId),
    (resolveSubjectPropertyCard(getDealCard(ctx.dealCardId)).card ?? {}) as Record<string, unknown>,
  );
  // Hermes still waits for the DETERMINISTIC CAPTURE ITSELF, not for this lane's
  // handback. With the early handoff those are no longer the same moment, and
  // starting an agent loop on the one dedicated browser while the capture is
  // still using it would only queue behind it.
  const captureSettled = rawCapturePromise ?? capturePromise;
  if (!hermesStarted && captureSettled) {
    void captureSettled.then(() => {
      startHermesWhenUsable(
        canonicalPropertyInputForDeal(ctx.dealCardId),
        (resolveSubjectPropertyCard(getDealCard(ctx.dealCardId)).card ?? {}) as Record<string, unknown>,
      );
    });
  }

  const deal = getDealCard(ctx.dealCardId);
  if (!deal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const cardId = subjectCardId(deal);
  const card = cardId ? getPropertyCard(cardId) : null;
  const property = resolveSubjectPropertyCard(deal).card ?? {};
  const inspection = cardId ? loadPropertyInspection(cardId) : null;
  const landPortalSubjectVerified = hasVerifiedLandPortalSubject(inspection);

  const stored = new PublicIntelligenceStore().load(ctx.dealCardId);
  const run = stored?.run ?? null;

  const verified = String(card?.verification_status ?? property.verification_status ?? '') === 'verified_property'
    || property.verified === 1 || property.verified === true;

  const coverage = officialParcelSourceCoverage({
    address: str(property.active_input_address) ?? str(property.address) ?? undefined,
    county: str(property.county) ?? undefined,
    state: str(property.state) ?? undefined,
    apn: str(property.apn) ?? undefined,
  });
  const discovery = reconcileDiscoveryIdentity({
    subject: {
      address: str(property.active_input_address) ?? str(property.address),
      city: str(property.city),
      county: str(property.county),
      state: str(property.state),
      zip: str(property.zip),
      apn: str(property.apn),
      owner: str(property.owner),
      acres: num(property.acres),
      // The retained county FIPS lets the parcel URL's own canonical key be
      // matched against this subject without depending on a county NAME that
      // the LandPortal panel never publishes.
      fips: str(property.fips),
    },
    landPortal: inspection ? {
      parcelUrl: inspection.parcelUrl,
      parcelFacts: inspection.parcelFacts,
      assetCount: inspection.assets.length,
      sourceLabel: 'LandPortal authenticated parcel panel',
      sourceNote: inspection.sources.find((item) => item.provider === 'LandPortal')?.note ?? null,
      verifiedSubject: landPortalSubjectVerified,
    } : null,
    official: {
      status: verified ? 'matched' : 'unavailable',
      source: str(property.verification_source) ?? (coverage.sources.join(', ') || 'Official public parcel lookup'),
      sourceUrl: null,
      note: verified
        ? 'The persisted property card retains the accepted official parcel match.'
        : `${coverage.reason}${inspectionNote}`,
      parcel: verified ? {
        address: str(property.active_input_address) ?? str(property.address),
        city: str(property.city),
        county: str(property.county),
        state: str(property.state),
        zip: str(property.zip),
        apn: str(property.apn),
        owner: str(property.owner),
        acres: num(property.acres),
      } : null,
    },
  });

  // A retained public run may have been produced from the same unverified
  // neighbor/context geometry. Keep it in history, but do not let it feed the
  // current subject record until either the canonical LandPortal URL or an
  // official parcel record proves the association.
  const record = buildOperatorPropertyRecord(
    landPortalSubjectVerified || verified ? run : null,
    {
    situsAddress: str(discovery.patch.address) ?? str(property.active_input_address) ?? str(property.address) ?? '',
    city: str(discovery.patch.city) ?? str(property.city),
    county: str(discovery.patch.county) ?? str(property.county),
    state: str(discovery.patch.state) ?? str(property.state),
    apn: str(discovery.patch.apn) ?? str(property.apn),
    owner: str(discovery.patch.owner) ?? str(property.owner),
    assessedAcres: num(discovery.patch.acres) ?? num(property.acres),
    coordinates: discovery.patch.coordinates ?? (num(property.lat) != null && property.lng != null
      ? { lat: Number(property.lat), lng: Number(property.lng) }
      : null),
    parcelVerified: !!verified,
    verificationSource: str(property.verification_source),
    compCount: 0,
    valuationReady: false,
    marketPulseAvailable: false,
    visualsCaptured: 0,
    landPortalCaptured: false,
    deedRetrieved: false,
  });

  // APN equivalence: formatting differences (spaces, dashes, leading zeros) are
  // never a conflict. Only genuinely distinct identifiers are.
  const apnSpellings = [
    str(property.apn),
    str(discovery.patch.apn),
    record.identity.apn,
    str((run?.gate as { requestedApn?: string } | undefined)?.requestedApn),
  ].filter((value): value is string => value != null);
  const distinct = distinctApnIdentities(apnSpellings);
  const apnConflicts = distinct.length > 1
    ? [`Two distinct parcel identifiers are attached to this Deal Card: ${distinct.join(' and ')}. They are not formatting variants of one another, so the subject parcel is unresolved until the correct identifier is accepted.`]
    : [];

  const apn = record.identity.apn ?? str(property.apn);
  const state = apnConflicts.length > 0 ? 'conflicted' : discovery.state;

  const identity: SnapshotIdentity = {
    state,
    discoveryUsable: discovery.discoveryUsable && apnConflicts.length === 0,
    discoveryBasis: discovery.discoveryBasis,
    discoverySources: discovery.discoverySources,
    normalizedAddress: record.identity.situsAddress || str(property.address),
    county: record.identity.county,
    state_: record.identity.state,
    apn,
    apnVariants: distinctApnIdentities(apnSpellings),
    owner: record.identity.owner,
    ownerMailing: record.identity.ownerMailing,
    situs: record.identity.situsAddress || null,
    acres: record.identity.mappedAcres ?? record.identity.assessedAcres,
    acreageBasis: record.identity.acreageBasis?.valuationBasis ?? record.identity.acreageBasis?.displayBasis ?? null,
    coordinates: record.identity.coordinates,
    hasParcelGeometry: !!record.identity.coordinates,
    sourceConfidence: discovery.confidence,
    conflicts: [
      ...apnConflicts,
      ...discovery.conflicts,
      ...(record.identity.acreageConflict
        ? [`Acreage bases disagree: assessed ${record.identity.assessedAcres ?? '—'} ac vs mapped ${record.identity.mappedAcres ?? '—'} ac. The governing acreage is unresolved.`]
        : []),
      ...record.identity.ownerWarnings,
    ],
    explanation: state === 'confirmed'
      ? `Confirmed against the official parcel record (${str(property.verification_source) ?? 'official parcel source'}).${liveNote}${inspectionNote}`
      : state === 'conflicted'
        ? `Conflicting parcel evidence is attached to this Deal Card.${liveNote}`
        : state === 'provisional'
          ? `${discovery.discoveryBasis}${liveNote}${inspectionNote}`
          // An unresolved identity must say WHY it is unresolved. "No record
          // matched" reads as an answer about the parcel; a missing county or a
          // jurisdiction with no configured source is a LandOS coverage gap and
          // establishes nothing about whether the parcel exists.
          : `No official parcel record has matched this intake. ${officialParcelSourceCoverage({
            address: str(property.active_input_address) ?? undefined,
            county: str(property.county) ?? undefined,
            state: str(property.state) ?? undefined,
            apn: str(property.apn) ?? undefined,
          }).reason}${liveNote}`,
  };

  const facts: SnapshotFact[] = [];
  const grade = state === 'confirmed' ? 'confirmed_fact' as const : 'likely_indication' as const;
  const source = str(property.verification_source) ?? 'Official parcel source';
  const push = (key: string, label: string, value: string | null, note: string | null = null): void => {
    if (!value) return;
    facts.push({ key, label, value, grade: state === 'confirmed' ? grade : 'unresolved_question', source, sourceUrl: null, retrievedAt: now(), note });
  };
  push('apn', 'Parcel number (APN)', identity.apn);
  push('owner', 'Recorded owner', identity.owner);
  push('acres', 'Acreage', identity.acres == null ? null : `${identity.acres.toFixed(2)} ac`, identity.acreageBasis ? `Governing basis: ${identity.acreageBasis}.` : null);
  push('situs', 'Situs address', identity.situs);
  push('jurisdiction', 'County and state', [identity.county, identity.state_].filter(Boolean).join(', ') || null);
  push('legal_description', 'Legal description', record.identity.legalDescription);
  push('land_use', 'Land use class', record.identity.landUseClass);
  for (const item of discovery.evidence) {
    const key = `discovery_${item.classification}_${item.field}`;
    if (facts.some((fact) => fact.key === key || (fact.label.toLowerCase().includes(item.field) && fact.value === item.value))) continue;
    facts.push({
      key,
      label: item.field.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value: item.value,
      grade: item.classification === 'official_record' ? 'confirmed_fact' : 'likely_indication',
      source: item.source,
      sourceUrl: item.sourceUrl,
      retrievedAt: now(),
      note: item.classification === 'marketplace_parcel_panel'
        ? 'LandPortal parcel-panel indication retained for discovery; retry the county source during normal diligence.'
        : null,
    });
  }
  // Retain the authenticated LandPortal sidebar estimate as a separate
  // source indication. It is intentionally not folded into the LandOS
  // working value or valuation range.
  const landPortalFactsCapturedAt = inspection?.sources
    .filter((item) => item.provider === 'LandPortal')
    .map((item) => item.attemptedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1) ?? now();
  for (const [label, value] of Object.entries(discovery.retainedLandPortalFacts)) {
    if (!/^estimate\s*(price|ppa|price\s*per\s*acre|value|total)$/i.test(label.trim())
      && !/^lp\s*estimate\s*(price|ppa|value|total)?$/i.test(label.trim())) continue;
    const isPpa = /ppa|price\s*per\s*acre/i.test(label);
    const key = isPpa ? 'lpEstimatePerAcre' : 'lpEstimateTotal';
    if (facts.some((fact) => fact.key === key)) continue;
    facts.push({
      key,
      label: isPpa ? 'LandPortal LP Estimate · Price per acre' : 'LandPortal LP Estimate · Total',
      value,
      grade: 'likely_indication',
      source: 'LandPortal authenticated parcel sidebar',
      sourceUrl: inspection?.parcelUrl ?? null,
      retrievedAt: landPortalFactsCapturedAt,
      note: 'Retained LandPortal subject estimate; additional source indication only. LandOS working value remains separate.',
    });
  }

  const status: SpecialistOutcome<IdentityContribution>['status'] = state === 'confirmed'
    ? 'completed'
    : state === 'unresolved' || state === 'conflicted'
      ? 'blocked'
      : 'partial';

  return {
    status,
    summary: identity.explanation,
    data: {
      identity,
      discoveryUsable: identity.discoveryUsable ?? false,
      discoveryBasis: identity.discoveryBasis ?? null,
      facts,
      subjectMarket: {
        state: identity.state_,
        county: identity.county,
        zip: record.identity.zip,
        locality: record.identity.locality,
        acres: identity.acres,
      },
      subjectAcres: identity.acres,
      acreageConflict: record.identity.acreageConflict,
    },
  };
}

// ── Government records ──────────────────────────────────────────────────────

export function governmentArtifactEvidence(
  dealCardId: number,
  artifacts: GovernmentRecordArtifactView[],
  retrievedAtFallback = new Date().toISOString(),
): SnapshotEvidenceItem[] {
  return artifacts.slice(0, 40).map((artifact) => {
    const capturedPageCount = Math.max(
      0,
      Math.min(artifact.captureCount, artifact.pageCount || artifact.captureCount),
    );
    const pageViewUrls = Array.from({ length: capturedPageCount }, (_, index) =>
      `/api/landos/deal-cards/${dealCardId}/government-records/artifacts/${artifact.id}/page/${index + 1}`);
    return {
      id: `gov-artifact-${artifact.id}`,
      kind: 'document' as const,
      label: artifact.displayName || artifact.documentType || 'Recorded document',
      sourceType: 'official_county_state',
      sourceUrl: artifact.sourceUrl,
      viewUrl: pageViewUrls[0] ?? null,
      retrievedAt: artifact.retrievedAt || retrievedAtFallback,
      confidence: 'high' as const,
      supports: 'government_records',
      sha256: artifact.artifactHash,
      bytes: null,
      pageCount: artifact.pageCount,
      capturedPageCount,
      pageViewUrls,
    };
    },
  );
}

export async function collectGovernmentRecords(ctx: MissionContext): Promise<SpecialistOutcome<GovernmentRecordsContribution>> {
  const now = new Date().toISOString();
  const publicRun = new PublicIntelligenceStore().load(ctx.dealCardId)?.run ?? null;
  const execution = publicLaneExecution(publicRun, GOVERNMENT_RECORD_TASKS);
  let model = null as ReturnType<typeof readGovernmentRecordsForDeal>;
  try {
    synchronizeGovernmentRecordsForDeal({
      dealCardId: ctx.dealCardId,
      actor: 'property-intelligence',
      changeReason: 'Property Intelligence rebuilt the recorded-government screening snapshot from persisted official evidence and retained artifacts.',
    });
  } catch {
    // A rebuild failure is not fatal: the last persisted read model still answers.
  }
  model = readGovernmentRecordsForDeal(ctx.dealCardId);

  if (!model?.snapshot) {
    return {
      status: 'blocked',
      summary: execution.summary,
      data: {
        records: countyRecordFactsFromPublicRun(publicRun),
        collectorAttemptCount: execution.attemptedCount,
        sourceLimitations: execution.limitations,
      },
      evidence: snapshotEvidenceFromPublicTasks(publicRun, GOVERNMENT_RECORD_TASKS),
    };
  }

  const analysis = model.snapshot.analysis;
  const records: SnapshotFact[] = [];
  const evidence: SnapshotEvidenceItem[] = [];

  const artifactCount = model.artifacts.length;
  const officiallyRetained = artifactCount > 0;

  const add = (key: string, label: string, value: string | null, grade: SnapshotFact['grade'], note: string | null = null): void => {
    if (!value) return;
    records.push({ key, label, value, grade, source: 'County recorded government records', sourceUrl: null, retrievedAt: now, note });
  };

  add('vesting', 'Recorded vesting language', analysis.recordedOwnershipState.exactVestingLanguage.join('; ') || null,
    officiallyRetained ? 'confirmed_fact' : 'likely_indication');
  add('owners', 'Named ownership parties', analysis.recordedOwnershipState.namedOwnershipParties.join('; ') || null,
    officiallyRetained ? 'confirmed_fact' : 'likely_indication',
    analysis.recordedOwnershipState.estateTrustOrEntity ? 'An estate, trust or entity is named; selling authority must be verified.' : null);
  add('document_completeness', 'Recorded document completeness', analysis.documentCompleteness.status.replace(/_/g, ' '),
    analysis.documentCompleteness.status === 'complete_for_screening' ? 'confirmed_fact' : 'unresolved_question',
    `${analysis.documentCompleteness.retainedArtifactCount} artifact(s) retained.`);
  add('survey_plat', 'Survey or plat', analysis.surveyPlatAvailability.status.replace(/_/g, ' '),
    analysis.surveyPlatAvailability.status === 'retrieved' ? 'confirmed_fact'
      : analysis.surveyPlatAvailability.status === 'not_located_in_sources_searched' ? 'unavailable_public_record'
        : 'unresolved_question',
    analysis.surveyPlatAvailability.findings.join(' ') || null);
  add('easements', 'Recorded easements and restrictions', analysis.recordedEasementRestrictionFindings.join('; ') || null, 'likely_indication');
  add('title_risk', 'Title risk indicators', analysis.titleRiskIndicators.join('; ') || null, 'post_contract_verification',
    'A title commitment from a licensed examiner is the only authority on marketable title.');
  add('tax_delinquency', 'Tax delinquency indicators', analysis.taxDelinquencyIndicators.join('; ') || null, 'likely_indication');
  add('liens', 'Lien and judgment screening', analysis.lienJudgmentScreeningIndicators.join('; ') || null, 'post_contract_verification',
    'Publicly discoverable indicators only; a full lien search is a post-contract legal step.');

  for (const conflict of analysis.materialConflicts) {
    records.push({ key: `conflict_${records.length}`, label: 'Material record conflict', value: conflict, grade: 'unresolved_question', source: 'County recorded government records', sourceUrl: null, retrievedAt: now, note: null });
  }
  for (const missing of analysis.missingInstruments) {
    records.push({ key: `missing_${records.length}`, label: 'Missing instrument', value: missing, grade: 'unavailable_public_record', source: 'County recorded government records', sourceUrl: null, retrievedAt: now, note: null });
  }
  for (const fact of countyRecordFactsFromPublicRun(publicRun)) {
    if (!records.some((record) => record.key === fact.key || (record.label === fact.label && record.value === fact.value))) {
      records.push(fact);
    }
  }
  for (const fact of governmentFactsFromPublicRecordOutcomes(listPublicRecordOutcomes(ctx.dealCardId))) {
    if (!records.some((record) => record.key === fact.key || (record.label === fact.label && record.value === fact.value))) {
      records.push(fact);
    }
  }

  evidence.push(...governmentArtifactEvidence(ctx.dealCardId, model.artifacts, now));

  const percent = model.snapshot.completeness.percent;
  evidence.push(...snapshotEvidenceFromPublicTasks(publicRun, GOVERNMENT_RECORD_TASKS)
    .filter((item) => !evidence.some((existing) => existing.id === item.id)));
  const materialRecordCount = records.filter((record) =>
    record.grade !== 'unresolved_question' && record.grade !== 'unavailable_public_record').length;
  return {
    status: materialRecordCount > 0 && percent >= 80 ? 'completed' : materialRecordCount > 0 ? 'partial' : 'blocked',
    summary: materialRecordCount > 0
      ? `${materialRecordCount} subject-property government fact(s) retained; ${artifactCount} official artifact(s). ${execution.summary}`
      : execution.summary,
    data: {
      records,
      collectorAttemptCount: execution.attemptedCount,
      sourceLimitations: execution.limitations,
    },
    evidence,
  };
}

// ── Zoning and land use ─────────────────────────────────────────────────────

export async function collectZoningLandUse(ctx: MissionContext): Promise<SpecialistOutcome<ZoningContribution>> {
  const now = new Date().toISOString();
  const publicRun = new PublicIntelligenceStore().load(ctx.dealCardId)?.run ?? null;
  const execution = publicLaneExecution(publicRun, ZONING_TASKS);
  try {
    await synchronizeZoningLandUseForDeal({
      dealCardId: ctx.dealCardId,
      actor: 'property-intelligence',
      changeReason: 'Property Intelligence rebuilt the jurisdiction/zoning/land-use snapshot from official sources.',
    });
  } catch {
    // Retain the persisted snapshot when a live zoning rebuild is unavailable.
  }
  const model = readZoningLandUseForDeal(ctx.dealCardId);

  if (!model?.snapshot) {
    return {
      status: 'blocked',
      summary: 'No zoning snapshot exists for this parcel yet, so the governing district and development rules are unknown.',
      data: {
        zoning: null,
        zoningKnown: false,
        items: [{
          key: 'zoning', label: 'Zoning', verdict: 'unknown',
          headline: 'Zoning district has not been established.',
          grade: 'unresolved_question', detail: null, sourceUrl: null,
          missing: ['The governing zoning district and its minimum lot size are unknown.'],
        }],
        facts: [],
        collectorAttemptCount: execution.attemptedCount,
        sourceLimitations: execution.limitations,
      },
      evidence: snapshotEvidenceFromPublicTasks(publicRun, ZONING_TASKS),
    };
  }

  const analysis = model.snapshot.analysis;
  const officiallyConfirmed = analysis.baseZoning.status === 'officially_confirmed';
  const district = [analysis.baseZoning.districtCode, analysis.baseZoning.districtName].filter(Boolean).join(' — ') || null;

  // WHO GOVERNS IS ONE ANSWER, NOT TWO. The zoning slice only collects a
  // jurisdiction determination once the versioned parcel identity reaches
  // `confirmed`, which identity reconciliation deliberately withholds until an
  // official county parcel record exists. On a parcel whose county publishes no
  // such record the slice never collects one — while the Land Use engine, which
  // resolves the authority from the address point rather than the parcel
  // polygon, has already accepted it. That left the operator reading
  // "Whitewater township administers zoning" in one section and "no
  // jurisdiction determination has been collected" in another.
  //
  // The accepted determination is restated here, with its original citation. It
  // is read-only: nothing is re-researched, no second engine exists, and the
  // zoning DISTRICT remains unresolved because that genuinely requires the
  // authority's own map.
  const acceptedAuthority = analysis.jurisdiction.controllingAuthorityName
    ? null
    : acceptedGoverningAuthorityForDeal({
      dealCardId: ctx.dealCardId,
      mailingCity: ctx.identity?.identity.city ?? null,
    });
  const authorityName = analysis.jurisdiction.controllingAuthorityName ?? acceptedAuthority?.authorityName ?? null;
  const authorityLevel = analysis.jurisdiction.controllingAuthorityName
    ? analysis.jurisdiction.controllingAuthorityLevel
    : acceptedAuthority?.authorityLevel ?? 'unknown';
  const jurisdictionBasis = analysis.jurisdiction.basis && analysis.jurisdiction.controllingAuthorityName
    ? analysis.jurisdiction.basis
    : acceptedAuthority?.basis ?? analysis.jurisdiction.basis ?? null;
  const jurisdictionConfirmed = analysis.jurisdiction.controllingAuthorityName
    ? analysis.jurisdiction.determination === 'confirmed'
    : acceptedAuthority?.determination === 'confirmed';

  const items: SnapshotDueDiligenceItem[] = [{
    key: 'zoning',
    label: 'Zoning',
    verdict: officiallyConfirmed ? 'good' : analysis.baseZoning.conflicts.length ? 'risk' : district ? 'caution' : 'unknown',
    headline: district
      ? `${district} (${analysis.baseZoning.status.replace(/_/g, ' ')})`
      : authorityName
        ? `District unresolved — ${authorityName} administers zoning`
        : 'Zoning district has not been established.',
    grade: officiallyConfirmed ? 'confirmed_fact' : district ? 'likely_indication' : 'unresolved_question',
    detail: jurisdictionBasis,
    sourceUrl: acceptedAuthority?.sourceUrl ?? null,
    missing: [
      ...(officiallyConfirmed ? [] : ['The zoning district has not been confirmed on the official zoning map.']),
      ...analysis.baseZoning.conflicts,
      ...(model.snapshot.completeness.missing ?? [])
        // The governing authority IS retrieved from an official source; only
        // the district is missing. Keeping this line would contradict the
        // authority now shown beside it.
        .filter((key) => !(acceptedAuthority && key === 'jurisdiction_authority'))
        .map((key) => `${key.replace(/_/g, ' ')} has not been retrieved from an official source.`),
    ],
  }];

  const facts: SnapshotFact[] = [];
  if (authorityName) {
    const mailingCityDiffers = analysis.jurisdiction.controllingAuthorityName
      ? analysis.jurisdiction.mailingCityDiffersFromAuthority
      : acceptedAuthority?.mailingCityDiffersFromAuthority === true;
    facts.push({
      key: 'jurisdiction', label: 'Controlling jurisdiction',
      value: `${authorityName} (${authorityLevel})`,
      grade: jurisdictionConfirmed ? 'confirmed_fact' : 'likely_indication',
      source: acceptedAuthority?.sourceName ?? 'Official jurisdiction boundary evidence',
      sourceUrl: acceptedAuthority?.sourceUrl ?? null,
      retrievedAt: acceptedAuthority?.retrievedAt ?? now,
      note: mailingCityDiffers ? 'The mailing city differs from the controlling authority.' : null,
    });
  }
  if (district) {
    facts.push({
      key: 'zoning_district', label: 'Zoning district', value: district,
      grade: officiallyConfirmed ? 'confirmed_fact' : 'likely_indication',
      source: 'Official zoning map', sourceUrl: null, retrievedAt: now,
      note: analysis.baseZoning.officialMapConfirmed ? 'Confirmed on the official zoning map.' : 'Not confirmed on an official zoning map.',
    });
  }
  for (const overlay of analysis.overlays) {
    facts.push({
      key: `overlay_${overlay.name}`, label: `Overlay: ${overlay.name}`, value: overlay.kind,
      grade: overlay.officiallyConfirmed ? 'confirmed_fact' : 'likely_indication',
      source: overlay.sourceName, sourceUrl: null, retrievedAt: now, note: null,
    });
  }

  return {
    status: officiallyConfirmed ? 'completed' : 'partial',
    summary: district
      ? `Zoning ${district} (${analysis.baseZoning.status.replace(/_/g, ' ')}) under ${analysis.jurisdiction.controllingAuthorityName ?? 'an undetermined authority'}. ${execution.summary}`
      : execution.summary,
    data: {
      zoning: district,
      zoningKnown: !!district,
      items,
      facts,
      collectorAttemptCount: execution.attemptedCount,
      sourceLimitations: execution.limitations,
    },
    evidence: snapshotEvidenceFromPublicTasks(publicRun, ZONING_TASKS),
  };
}

// ── Environmental, terrain and access from the reconciled operator record ────

function operatorRecordFor(dealCardId: number): OperatorPropertyRecord | null {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const property = resolveSubjectPropertyCard(deal).card ?? {};
  const cardId = Number(property.id);
  const inspection = Number.isInteger(cardId) ? loadPropertyInspection(cardId) : null;
  // Public screening findings are spatially keyed. A no-match LandPortal
  // capture may still have a coordinate, overlay, or soil result, but those
  // belong to context until the subject URL is canonically verified (or an
  // official parcel card is already accepted).
  if (!hasVerifiedPropertyCard(property) && !hasVerifiedLandPortalSubject(inspection)) return null;
  const run = new PublicIntelligenceStore().load(dealCardId)?.run ?? null;
  if (!run) return null;
  return buildOperatorPropertyRecord(run, {
    situsAddress: str(property.active_input_address) ?? str(property.address) ?? '',
    city: str(property.city),
    county: str(property.county),
    state: str(property.state),
    apn: str(property.apn),
    owner: str(property.owner),
    assessedAcres: num(property.acres),
    coordinates: num(property.lat) != null && property.lng != null ? { lat: Number(property.lat), lng: Number(property.lng) } : null,
    parcelVerified: String(property.verification_status ?? '') === 'verified_property',
    compCount: 0,
    valuationReady: false,
    marketPulseAvailable: false,
    visualsCaptured: 0,
    landPortalCaptured: false,
    deedRetrieved: false,
  });
}

const ENVIRONMENTAL_KEYS = ['flood', 'wetlands', 'septic', 'soils', 'slope', 'terrain', 'water'];
const ACCESS_KEYS = ['access', 'frontage', 'road', 'utilities', 'easement'];

function decisionCardToItem(card: { key: string; label: string; verdict: string; headline: string; detail?: string | null }): SnapshotDueDiligenceItem {
  const verdict = (['good', 'caution', 'risk', 'unknown'].includes(card.verdict) ? card.verdict : 'unknown') as SnapshotDueDiligenceItem['verdict'];
  return {
    key: card.key,
    label: card.label,
    verdict,
    headline: card.headline,
    // A mapped public screening layer is a real indication, not an official
    // parcel-specific determination. Only a retained official record earns
    // "confirmed fact"; screening layers stay one grade below.
    grade: verdict === 'unknown' ? 'unresolved_question' : 'likely_indication',
    detail: card.detail ?? null,
    sourceUrl: null,
    missing: verdict === 'unknown' ? [`${card.label} has not been screened against a public source.`] : [],
  };
}

export async function collectEnvironmentalTerrain(ctx: MissionContext): Promise<SpecialistOutcome<EnvironmentalContribution>> {
  const publicRun = new PublicIntelligenceStore().load(ctx.dealCardId)?.run ?? null;
  const execution = publicLaneExecution(publicRun, ENVIRONMENTAL_TASKS);
  const record = operatorRecordFor(ctx.dealCardId);
  if (!record) {
    return {
      status: 'blocked',
      summary: execution.summary,
      data: {
        items: [],
        constraints: [],
        screenedLaneCount: execution.attemptedCount,
        sourceLimitations: execution.limitations,
      },
      evidence: snapshotEvidenceFromPublicTasks(publicRun, ENVIRONMENTAL_TASKS),
    };
  }
  const cards = record.decisionCards.filter((card) => ENVIRONMENTAL_KEYS.includes(card.key));
  const items = cards.map(decisionCardToItem);
  const environmentalTaskFor = (key: string) =>
    key === 'septic' || key === 'soils'
      ? 'soils_septic'
      : key === 'terrain' || key === 'slope'
        ? 'slope_topography'
        : key === 'flood'
          ? 'fema_flood'
          : key === 'wetlands'
            ? 'wetlands'
            : null;
  for (const item of items) {
    const task = environmentalTaskFor(item.key);
    const source = task
      ? publicRun?.tasks.find((candidate) => candidate.task === task)?.evidence.find((evidence) => !!evidence.sourceUrl)
      : null;
    if (source?.sourceUrl) item.sourceUrl = source.sourceUrl;
  }
  const deal = getDealCard(ctx.dealCardId);
  const cardId = deal ? subjectCardId(deal) : null;
  const inspection = cardId ? loadPropertyInspection(cardId) : null;
  const lpFacts = hasVerifiedLandPortalSubject(inspection) ? (inspection?.parcelFacts ?? {}) : {};
  const lpFact = (...labels: string[]): string | null => {
    for (const label of labels) {
      const value = str(lpFacts[label]);
      if (value && value !== '-') return value;
    }
    return null;
  };
  const replaceUnknown = (item: SnapshotDueDiligenceItem): void => {
    const index = items.findIndex((candidate) => candidate.key === item.key);
    if (index < 0) items.push(item);
    else if (items[index].verdict === 'unknown') items[index] = item;
  };
  const flood = lpFact('FEMA Flood Zone', 'FEMA Coverage (%)');
  if (flood) replaceUnknown({
    key: 'flood', label: 'Flood screening',
    verdict: /not in|^0(?:\.0+)?%?$/.test(flood.toLowerCase()) ? 'good' : 'caution',
    headline: `LandPortal parcel panel reports ${flood}.`,
    grade: 'likely_indication', detail: 'Retained parcel-level marketplace overlay; confirm against FEMA/public GIS before a binding decision.',
    sourceUrl: inspection?.parcelUrl ?? null, missing: [],
  });
  const wetlands = lpFact('Wetlands Coverage (%)');
  if (wetlands) replaceUnknown({
    key: 'wetlands', label: 'Wetlands screening',
    verdict: /^0(?:\.0+)?%?$/.test(wetlands) ? 'good' : 'caution',
    headline: `LandPortal parcel panel reports ${wetlands}% wetlands coverage.`,
    grade: 'likely_indication', detail: 'Retained parcel-level marketplace overlay; not an official wetlands determination.',
    sourceUrl: inspection?.parcelUrl ?? null, missing: [],
  });
  const slope = lpFact('Slope Avg');
  const buildable = lpFact('Buildability total (%)');
  if (slope || buildable) replaceUnknown({
    key: 'terrain', label: 'Terrain and buildability',
    verdict: 'caution',
    headline: [slope ? `${slope} average slope` : null, buildable ? `${buildable} buildability shown` : null].filter(Boolean).join('; '),
    grade: 'likely_indication', detail: 'LandPortal terrain model retained for discovery sizing; field verification is still required.',
    sourceUrl: inspection?.parcelUrl ?? null, missing: [],
  });
  const soilOverlay = inspection?.assets?.find((asset) => /soil/i.test(`${asset.overlay ?? ''} ${asset.label ?? ''} ${asset.purpose ?? ''}`));
  if (soilOverlay) replaceUnknown({
    key: 'septic',
    label: 'Preliminary septic outlook',
    verdict: 'unknown',
    headline: 'Insufficient evidence after attempt',
    grade: 'unresolved_question',
    detail: 'A parcel-centered LandPortal soil overlay was captured, but the image alone does not publish an absorption-field rating. The SSURGO interpretation or a site-specific perc/soil evaluation is required before classifying the outlook.',
    sourceUrl: inspection?.parcelUrl ?? null,
    missing: ['No interpretable septic absorption-field rating was returned from the soil overlay.'],
  });
  const constraints = items
    .filter((item) => item.verdict === 'risk' || item.verdict === 'caution')
    .map((item) => `${item.label}: ${item.headline}`);
  const unknownCount = items.filter((item) => item.verdict === 'unknown').length;

  return {
    status: items.length === 0 ? 'blocked' : unknownCount > 0 ? 'partial' : 'completed',
    summary: items.length === 0
      ? execution.summary
      : `${inspection?.parcelUrl ? 'The live LandPortal parcel collector supplied parcel-level environmental and terrain indications. ' : ''}${execution.attemptedCount} public source collector(s) ran; ${constraints.length} constraint(s) found${unknownCount ? `, ${unknownCount} conclusion(s) remain unknown` : ''}. ${execution.summary}`,
    data: {
      items,
      constraints,
      screenedLaneCount: execution.attemptedCount,
      sourceLimitations: execution.limitations,
    },
    evidence: snapshotEvidenceFromPublicTasks(publicRun, ENVIRONMENTAL_TASKS),
  };
}

export async function collectAccessUtilities(ctx: MissionContext): Promise<SpecialistOutcome<AccessUtilitiesContribution>> {
  const publicRun = new PublicIntelligenceStore().load(ctx.dealCardId)?.run ?? null;
  const execution = publicLaneExecution(publicRun, ACCESS_UTILITY_TASKS);
  const record = operatorRecordFor(ctx.dealCardId);
  if (!record) {
    return {
      status: 'blocked',
      summary: execution.summary,
      data: {
        items: [],
        accessStatus: 'unknown',
        utilitiesKnown: false,
        utilitiesSummary: null,
        collectorAttemptCount: execution.attemptedCount,
        sourceLimitations: execution.limitations,
      },
      evidence: snapshotEvidenceFromPublicTasks(publicRun, ACCESS_UTILITY_TASKS),
    };
  }
  const cards = record.decisionCards.filter((card) => ACCESS_KEYS.includes(card.key));
  const items = cards.map(decisionCardToItem);
  const deal = getDealCard(ctx.dealCardId);
  const cardId = deal ? subjectCardId(deal) : null;
  const inspection = cardId ? loadPropertyInspection(cardId) : null;
  const frontage = hasVerifiedLandPortalSubject(inspection) ? str(inspection?.parcelFacts?.['Road Frontage']) : null;
  const landLocked = hasVerifiedLandPortalSubject(inspection) ? str(inspection?.parcelFacts?.['Land Locked']) : null;
  // Discovery-stage operator rule: mapped frontage plus no landlocked flag
  // means the parcel abuts a road, and legal access is displayed as PRESENT.
  // Only survey-grade frontage and recorded easements stay open. Driveway or
  // permit language is never part of this operator workflow.
  const abutsRoad = !!frontage && /^no$/i.test(landLocked ?? '');
  if (frontage || landLocked) {
    const indication: SnapshotDueDiligenceItem = {
      key: 'access',
      label: abutsRoad ? 'Legal access and road frontage' : 'Road frontage and apparent access',
      verdict: abutsRoad ? 'good' : 'caution',
      headline: [
        frontage ? `${frontage} frontage shown` : null,
        landLocked ? `landlocked flag: ${landLocked}` : null,
      ].filter(Boolean).join('; '),
      grade: 'likely_indication',
      detail: abutsRoad
        ? 'LandPortal parcel evidence shows the parcel abuts the road with mapped frontage and no landlocked flag; discovery-stage legal access is displayed as present. Survey-grade frontage and recorded easements remain ordinary follow-ups.'
        : 'LandPortal parcel-panel indication only. Road abutment has not been established by the retained parcel evidence yet.',
      sourceUrl: inspection?.parcelUrl ?? null,
      missing: abutsRoad
        ? ['Exact surveyed frontage (survey-grade confirmation).', 'Any recorded easements affecting other portions of the parcel.']
        : ['Road abutment evidence (mapped frontage or a landlocked determination).'],
    };
    const accessIndex = items.findIndex((item) => item.key === 'access');
    if (accessIndex < 0) items.push(indication);
    else if (items[accessIndex].verdict === 'unknown') items[accessIndex] = indication;
  }
  const utilitiesCard = record.decisionCards.find((card) => card.key === 'utilities');

  // When road abutment is NOT yet established, the unresolved access-family
  // items stay visible; once it is, they would misstate the operator rule.
  const accessItem = items.find((item) => item.key === 'access');
  if (accessItem && !abutsRoad) {
    accessItem.missing = [
      ...accessItem.missing,
      ...record.accessStatus.unresolved,
    ];
  }

  return {
    status: items.length === 0 ? 'blocked' : items.some((item) => item.verdict === 'unknown') ? 'partial' : 'completed',
    summary: `${abutsRoad ? 'The live LandPortal parcel collector shows the parcel abutting the road; discovery-stage legal access is present. ' : frontage || landLocked ? 'The live LandPortal parcel collector supplied frontage/access indications. ' : ''}${abutsRoad ? '' : record.accessStatus.summary}${utilitiesCard ? ` Utilities: ${utilitiesCard.headline}` : ' Utility availability was not established.'} ${execution.summary}`,
    data: {
      items,
      accessStatus: frontage || /no/i.test(landLocked ?? '') ? 'public_road_proximity' : record.accessStatus.status,
      utilitiesKnown: !!utilitiesCard && utilitiesCard.verdict !== 'unknown',
      utilitiesSummary: utilitiesCard?.headline ?? null,
      collectorAttemptCount: execution.attemptedCount,
      sourceLimitations: execution.limitations,
    },
    evidence: snapshotEvidenceFromPublicTasks(publicRun, ACCESS_UTILITY_TASKS),
  };
}

// ── Comparable sales ────────────────────────────────────────────────────────

function marketplaceCandidates(
  result: LandMarketplaceResult | null,
  provider: string,
  state: string | null,
): CompRegistryCandidate[] {
  if (!result) return [];
  const map = (rows: LandMarketplaceComp[], lane: 'sold' | 'active'): CompRegistryCandidate[] => rows.map((row) => ({
    id: row.providerId ?? null,
    provider,
    lane,
    addressDesc: row.address ?? null,
    state,
    price: row.price ?? null,
    priceKind: lane === 'sold' ? 'sold' : 'list',
    saleOrListDate: row.saleDate ?? null,
    listingDate: row.listingDate ?? null,
    daysOnMarket: row.daysOnMarket ?? null,
    views: row.views ?? null,
    saves: row.saves ?? null,
    priceChanges: row.priceChanges ?? [],
    collectedAt: row.collectedAt ?? null,
    acres: row.acres ?? null,
    pricePerAcre: row.pricePerAcre ?? null,
    sourceUrl: row.url ?? null,
    distanceMiles: row.distanceMiles ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    photoUrls: row.photoUrls ?? [],
    compClass: row.homeType || row.homeSizeSqft ? 'residential' : 'vacant_land',
    homeType: row.homeType ?? null,
    yearBuilt: row.yearBuilt ?? null,
    homeSizeSqft: row.homeSizeSqft ?? null,
  } as CompRegistryCandidate));
  return [...map(result.sold ?? [], 'sold'), ...map(result.active ?? [], 'active')];
}

function landPortalSubjectProviderAdapter(input: {
  cardId: number;
  execute: () => Promise<{ ok: boolean; note: string; comparableCount: number }>;
}): PropertyProviderAdapter<{
  capture: { ok: boolean; note: string; comparableCount: number };
  inspection: ReturnType<typeof loadPropertyInspection>;
}> {
  return {
    laneId: 'landportal_subject',
    providerId: 'landportal',
    execute: async () => {
      const capture = await input.execute();
      return { capture, inspection: loadPropertyInspection(input.cardId) };
    },
    validate: (_property, execution) => {
      const verified = hasVerifiedLandPortalSubject(execution.inspection);
      return {
        valid: true,
        subjectClassification: verified ? 'verified_subject' : 'no_match',
        checks: [
          { check: 'provider_attempt_recorded', passed: true, reason: execution.capture.note },
          { check: 'exact_subject_parcel', passed: verified, reason: verified ? 'Exact retained LandPortal parcel is bound to this Property Card.' : 'LandPortal did not establish an exact subject match.' },
        ],
        rejectedEvidenceIds: [],
      };
    },
    normalize: (property, execution, validation) => validation.subjectClassification !== 'verified_subject'
      ? []
      : Object.entries(execution.inspection?.parcelFacts ?? {}).filter(([, value]) => !!str(value)).map(([field, value]) => ({
        id: `landportal-subject:${field.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        propertyCardId: property.propertyCardId,
        dealCardId: property.dealCardId,
        providerId: 'landportal',
        field,
        value,
        subjectClassification: 'verified_subject' as const,
        strength: 'provider_verified' as const,
        sourceUrl: execution.inspection?.parcelUrl ?? null,
        retrievedAt: execution.inspection?.sources.find((source) => source.provider === 'LandPortal')?.attemptedAt ?? new Date().toISOString(),
        confidence: 'high' as const,
        kind: /estimate/i.test(field) ? 'estimate' as const : 'fact' as const,
        validation: { valid: true, reasons: [] },
      })),
    status: (_property, execution, validation) => validation.subjectClassification === 'verified_subject'
      ? 'verified'
      : execution.capture.ok ? 'context_only' : 'unavailable',
  };
}

function publicPropertyProviderAdapter(input: {
  execute: () => Promise<{ ok: boolean; error?: string }>;
}): PropertyProviderAdapter<{
  capture: { ok: boolean; error?: string };
  card: ReturnType<typeof getPropertyCard>;
}> {
  return {
    laneId: 'public_property',
    providerId: 'official_public_property',
    execute: async (property) => {
      const capture = await input.execute();
      return { capture, card: getPropertyCard(property.propertyCardId) };
    },
    validate: (_property, execution) => {
      const verified = hasVerifiedPropertyCard(execution.card as unknown as Record<string, unknown> | null);
      return {
        valid: true,
        subjectClassification: verified ? 'verified_subject' : 'no_match',
        checks: [
          { check: 'public_lookup_attempted', passed: true, reason: execution.capture.error ?? (execution.capture.ok ? 'Public lookup completed.' : 'Public lookup returned no match.') },
          { check: 'official_subject_match', passed: verified, reason: verified ? 'Official public identity is accepted on the Property Card.' : 'No accepted official subject match was retained.' },
        ],
        rejectedEvidenceIds: [],
      };
    },
    normalize: (property, execution, validation) => {
      if (validation.subjectClassification !== 'verified_subject' || !execution.card) return [];
      const card = execution.card as unknown as Record<string, unknown>;
      return ['apn', 'owner', 'acres', 'county', 'state', 'active_input_address'].flatMap((field): NormalizedPropertyEvidence[] => {
        const value = card[field];
        if (!str(value)) return [];
        return [{
          id: `public-property:${field}`,
          propertyCardId: property.propertyCardId,
          dealCardId: property.dealCardId,
          providerId: 'official_public_property',
          field,
          value,
          subjectClassification: 'verified_subject',
          strength: 'official_record',
          sourceUrl: null,
          retrievedAt: new Date().toISOString(),
          confidence: 'high',
          kind: 'fact',
          validation: { valid: true, reasons: [] },
        }];
      });
    },
    status: (_property, execution, validation) => validation.subjectClassification === 'verified_subject'
      ? 'verified'
      : execution.capture.ok ? 'context_only' : 'unavailable',
  };
}

function hermesLandPortalProviderAdapter(input: {
  execute: () => Promise<HermesLandPortalLaneOutcome>;
}): PropertyProviderAdapter<HermesLandPortalLaneOutcome> {
  return {
    laneId: 'hermes_landportal_auto',
    providerId: 'hermes_landportal',
    execute: input.execute,
    validate: (_property, execution) => ({
      valid: execution.status !== 'failed',
      subjectClassification: execution.status === 'exact_match'
        ? 'verified_subject'
        : execution.status === 'context_only'
          ? 'context_only'
          : 'no_match',
      checks: [{
        check: 'hermes_landportal_outcome',
        passed: execution.status !== 'failed',
        reason: `${execution.propertyLabel}: ${execution.note}`,
      }],
      rejectedEvidenceIds: [],
    }),
    // The proven importer owns fact/estimate/comp normalization. This provider
    // result is the independently persisted lane outcome only.
    normalize: () => [],
    status: (_property, execution) => execution.status === 'exact_match'
      ? 'verified'
      : execution.status === 'context_only'
        ? 'context_only'
        : execution.status === 'no_match'
          ? 'unavailable'
          : 'failed',
  };
}

function marketplaceProviderAdapter(input: {
  laneId: 'zillow' | 'redfin' | 'realtor' | 'manufactured_home';
  providerId: string;
  execute: () => Promise<LandMarketplaceResult>;
}): PropertyProviderAdapter<LandMarketplaceResult> {
  return {
    laneId: input.laneId,
    providerId: input.providerId,
    execute: input.execute,
    validate: (_property, execution) => {
      const valid = !!execution && typeof execution.status === 'string';
      return {
        valid,
        subjectClassification: 'context_only',
        checks: [{
          check: 'provider_returned_explicit_status',
          passed: valid,
          reason: valid ? `Provider returned status "${execution.status}".` : 'Provider returned no explicit execution status.',
        }],
        rejectedEvidenceIds: [],
      };
    },
    normalize: (property, execution) => {
      const rows = [...(execution.sold ?? []), ...(execution.active ?? [])];
      const retrievedAt = rows.map((row) => row.collectedAt).filter((value): value is string => !!value).sort().at(-1)
        ?? new Date().toISOString();
      const statusEvidence: NormalizedPropertyEvidence = {
        id: `${input.laneId}:attempt-status`,
        propertyCardId: property.propertyCardId,
        dealCardId: property.dealCardId,
        providerId: input.providerId,
        field: `comparables.${input.laneId}.attempt_status`,
        value: { status: execution.status, note: execution.note ?? null, candidates: rows.length, searchProof: execution.searchProof ?? null },
        subjectClassification: 'context_only',
        strength: 'provider_observed',
        sourceUrl: null,
        retrievedAt,
        confidence: 'medium',
        kind: 'status',
        validation: { valid: true, reasons: [] },
      };
      return [statusEvidence, ...rows.map((row, index): NormalizedPropertyEvidence => ({
        id: `${input.laneId}:${row.providerId ?? row.url ?? index}`,
        propertyCardId: property.propertyCardId,
        dealCardId: property.dealCardId,
        providerId: input.providerId,
        field: `comparables.${input.laneId}.${row.providerId ?? index}`,
        value: row,
        subjectClassification: 'context_only',
        strength: 'provider_observed',
        sourceUrl: row.url ?? null,
        retrievedAt: row.collectedAt ?? new Date().toISOString(),
        confidence: 'medium',
        kind: 'comp',
        validation: { valid: true, reasons: [] },
        artifactHash: null,
        viewUrl: row.thumbnailUrl ?? null,
      }))];
    },
    status: (_property, execution) => {
      if (/not[_ ]applicable/i.test(execution.status)) return 'not_applicable';
      if (/error|failed/i.test(execution.status)) return 'failed';
      if (/blocked|disabled|unavailable/i.test(execution.status)) return 'unavailable';
      // Marketplace comps describe context properties, not subject parcel facts.
      return 'context_only';
    },
  };
}

function exactAddressProviderAdapter(execute: () => Promise<ExactAddressWebResult>): PropertyProviderAdapter<ExactAddressWebResult> {
  return {
    laneId: EXACT_ADDRESS_LANE_ID,
    providerId: 'exact_address_web',
    execute,
    validate: (_property, result) => ({
      valid: !!result && Array.isArray(result.queries) && Array.isArray(result.pages),
      subjectClassification: 'context_only',
      checks: [{
        check: 'exact_address_queries_attempted',
        passed: result.queries.length >= 4,
        reason: `${result.queries.length} distinct plain-English exact-address queries were recorded.`,
      }],
      rejectedEvidenceIds: [],
    }),
    normalize: (property, result) => result.pages.flatMap((page, pageIndex): NormalizedPropertyEvidence[] => {
      const base: NormalizedPropertyEvidence = {
        id: `exact-address:${pageIndex}:${page.sourceUrl}`,
        propertyCardId: property.propertyCardId,
        dealCardId: property.dealCardId,
        providerId: 'exact_address_web',
        field: `discovery.exact_address.listing.${pageIndex + 1}`,
        value: page,
        subjectClassification: 'context_only',
        strength: 'provider_observed',
        sourceUrl: page.sourceUrl,
        retrievedAt: page.retrievedAt ?? new Date().toISOString(),
        confidence: 'medium',
        kind: 'fact',
        validation: { valid: true, reasons: [] },
      };
      // A listing now yields reported-legal wording AND tier-2 apparent-physical
      // support (driveway/directions wording, listing photography), so the field
      // must name the tier the item actually occupies rather than assume one.
      return [base, ...listingAccessEvidenceItems(page).map((access, index): NormalizedPropertyEvidence => ({
        ...base,
        id: `exact-address:${pageIndex}:access:${index + 1}`,
        field: `access_evidence.${access.tier}.exact_address.${pageIndex + 1}.${index + 1}`,
        value: access,
        sourceUrl: access.sourceUrl ?? page.sourceUrl,
      }))];
    }),
    status: (_property, result) => result.status === 'retrieved' || result.status === 'none'
      ? 'context_only'
      : result.status === 'blocked' ? 'unavailable' : 'failed',
  };
}

function landPortalComparableAdapter(input: {
  cardId: number;
  execute: () => Promise<{ ok: boolean; note: string; comparableCount: number }>;
}): PropertyProviderAdapter<{
  capture: { ok: boolean; note: string; comparableCount: number };
  inspection: ReturnType<typeof loadPropertyInspection>;
}> {
  return {
    laneId: 'landportal_comps',
    providerId: 'landportal',
    execute: async () => {
      const capture = await input.execute();
      return { capture, inspection: loadPropertyInspection(input.cardId) };
    },
    validate: (_property, execution) => {
      const verifiedSubject = hasVerifiedLandPortalSubject(execution.inspection);
      const valid = !!execution.inspection || execution.capture.ok;
      return {
        valid,
        subjectClassification: verifiedSubject ? 'verified_subject' : valid ? 'context_only' : 'no_match',
        checks: [
          { check: 'landportal_attempt_completed', passed: valid, reason: execution.capture.note },
          {
            check: 'subject_parcel_verified',
            passed: verifiedSubject,
            reason: verifiedSubject ? 'The retained exact parcel URL is verified for this Property Card.' : 'LandPortal did not prove an exact subject parcel; any rows remain context only.',
          },
        ],
        rejectedEvidenceIds: [],
      };
    },
    normalize: (property, execution, validation) => {
      const evidence: NormalizedPropertyEvidence[] = [];
      const retrievedAt = execution.inspection?.sources.find((source) => source.provider === 'LandPortal')?.attemptedAt
        ?? new Date().toISOString();
      if (validation.subjectClassification === 'verified_subject') {
        for (const [field, value] of Object.entries(execution.inspection?.parcelFacts ?? {})) {
          if (!str(value)) continue;
          evidence.push({
            id: `landportal:fact:${field.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            propertyCardId: property.propertyCardId,
            dealCardId: property.dealCardId,
            providerId: 'landportal',
            field,
            value,
            subjectClassification: 'verified_subject',
            strength: 'provider_verified',
            sourceUrl: execution.inspection?.parcelUrl ?? null,
            retrievedAt,
            confidence: 'high',
            kind: /estimate/i.test(field) ? 'estimate' : 'fact',
            validation: { valid: true, reasons: [] },
          });
        }
      }
      for (const [index, comp] of currentComparables(execution.inspection).entries()) {
        evidence.push({
          id: `landportal:comp:${comp.apn ?? comp.sourceUrl ?? index}`,
          propertyCardId: property.propertyCardId,
          dealCardId: property.dealCardId,
          providerId: 'landportal',
          field: `comparables.landportal.${comp.apn ?? index}`,
          value: comp,
          subjectClassification: 'context_only',
          strength: 'provider_observed',
          sourceUrl: comp.detailUrl ?? comp.sourceUrl ?? execution.inspection?.parcelUrl ?? null,
          retrievedAt: comp.capturedAtIso ?? retrievedAt,
          confidence: comp.confidence,
          kind: 'comp',
          validation: { valid: true, reasons: [] },
          viewUrl: null,
        });
      }
      return evidence;
    },
    status: (_property, execution, validation) => {
      if (validation.subjectClassification === 'verified_subject') return 'verified';
      if (validation.subjectClassification === 'context_only') return 'context_only';
      return execution.capture.ok ? 'context_only' : 'unavailable';
    },
  };
}

type ExactAddressOutcome = { result: ExactAddressWebResult | null; error: unknown };

async function runStandingExactAddressDiscovery(
  ctx: MissionContext,
  deps: LiveCollectorDeps,
): Promise<ExactAddressOutcome> {
  const canonicalInput = canonicalPropertyInputForDeal(ctx.dealCardId);
  if (!deps.captureExactAddressWeb || !canonicalInput?.address.trim()) {
    return { result: null, error: null };
  }
  try {
    const providerResult = await executePropertyProvider({
      runId: ctx.runId,
      property: canonicalInput,
      adapter: exactAddressProviderAdapter(() => deps.captureExactAddressWeb!(canonicalInput)),
    });
    const result = providerResult.execution.result;
    if (!result) {
      await persistProviderResult(deps, providerResult);
      return { result: null, error: null };
    }
    const propertyCardId = subjectCardId(getDealCard(ctx.dealCardId));
    if (propertyCardId != null) {
      try {
        result.persistence = saveSubjectListingDetail({
          propertyCardId,
          dealCardId: ctx.dealCardId,
          canonicalAddress: canonicalInput.address,
          completedAtIso: new Date().toISOString(),
          result,
        });
      } catch (error) {
        result.persistence = {
          attempted: true,
          persisted: false,
          propertyCardId,
          retainedSourceCount: 0,
          newlyStoredSourceCount: 0,
          reason: `subject-listing persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    // Persist only after the subject-listing write so the per-lane attempt and
    // provider evidence carry the same truthful persistence outcome.
    await persistProviderResult(deps, providerResult);
    return { result, error: null };
  } catch (error) {
    return { result: null, error };
  }
}

export async function collectComparables(
  ctx: MissionContext,
  deps: LiveCollectorDeps,
  standingExactAddress?: Promise<ExactAddressOutcome>,
): Promise<SpecialistOutcome<ComparablesContribution>> {
  const deal = getDealCard(ctx.dealCardId);
  if (!deal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const cardId = subjectCardId(deal);
  const property = resolveSubjectPropertyCard(deal).card ?? {};
  const state = ctx.identity?.identity.state_ ?? str(property.state);
  const subjectAcres = ctx.identity?.subjectAcres ?? num(property.acres);
  const canonicalInput = canonicalPropertyInputForDeal(ctx.dealCardId);

  const notes: string[] = [];
  const candidates: CompRegistryCandidate[] = [];

  // Every approved marketplace is independent once the subject handback is
  // usable. Start all of them before waiting on LandPortal's browser work:
  // previously the public Zillow/Redfin boards sat idle behind the LandPortal
  // parcel capture, turning one slow provider into serial wall-clock time for
  // the entire comparable lane. The promises are deliberately contained here;
  // their results are reconciled and persisted only by the mission
  // orchestrator after this lane settles.
  const marketInput = {
    address: str(property.active_input_address) ?? str(property.address),
    city: str(property.city),
    county: ctx.identity?.identity.county ?? str(property.county),
    state,
    zip: str(property.zip),
    apn: ctx.identity?.identity.apn ?? str(property.apn),
    owner: ctx.identity?.identity.owner ?? str(property.owner),
    lat: ctx.identity?.identity.coordinates?.lat ?? num(property.lat),
    lng: ctx.identity?.identity.coordinates?.lng ?? num(property.lng),
    subjectAcres,
  };

  // ── Primary: LandPortal visible vacant-land rows ─────────────────────────
  // LandPortal is the PRIMARY accepted source, so the lane reads the
  // authenticated parcel page itself rather than hoping some earlier run left
  // comparables behind. Free visible "similar sales" rows only; the paid comp
  // report is never requested.
  let inspection = cardId ? loadPropertyInspection(cardId) : null;
  let landPortalCapture: { ok: boolean; note: string; comparableCount: number } | null = null;
  // Re-read when the retained rows cannot answer the question. Rows that state
  // no sale-or-listing status are not usable evidence, and skipping the read
  // merely because SOME rows exist would pin the card to a stale capture
  // forever — including one taken before an extractor fix.
  //
  // An UNSTAMPED row is exactly such a capture: it predates the two-surface
  // read, so it carries no capture generation, no comp-page enrichment and no
  // stated status source. Treating it as usable is what kept superseded rows in
  // front of the operator indefinitely, because the very gate that would refresh
  // them was satisfied by them. One re-read per card retires them for good.
  const usableRows = currentComparables(inspection).filter((row) => {
    const record = row as unknown as Record<string, unknown>;
    if (!str(record.capturedAtIso)) return false;
    const st = str(record.status) ?? 'unknown';
    const ind = str(record.saleListIndicator) ?? 'unknown';
    return ind === 'sale' || st === 'sold' || ind === 'list' || st === 'active' || st === 'listed';
  }).length;
  const landPortalCapturePromise = cardId && usableRows === 0 && deps.captureLandPortalInspection && !deps.captureHermesLandPortal && canonicalInput
    ? executePropertyProvider({
      runId: ctx.runId,
      property: canonicalInput,
      adapter: landPortalComparableAdapter({
        cardId,
        execute: () => deps.captureLandPortalInspection!({
       cardId,
       searchKey: {
         address: str(property.active_input_address) ?? str(property.address),
          apn: ctx.identity?.identity.apn ?? str(property.apn),
          county: ctx.identity?.identity.county ?? str(property.county),
          state,
          city: str(property.city),
         owner: str(property.owner),
       },
        }),
      }),
    }).then((result) => persistProviderResult(deps, result)).then(
      (providerResult) => ({ result: providerResult.execution.result?.capture ?? null, error: null as unknown }),
      (error: unknown) => ({ result: null, error }),
    )
    : null;
  const zillowPromise = deps.captureZillowComps && canonicalInput
    ? executePropertyProvider({
        runId: ctx.runId,
        property: canonicalInput,
        adapter: marketplaceProviderAdapter({ laneId: 'zillow', providerId: 'zillow', execute: () => deps.captureZillowComps!(marketInput) }),
      }).then((result) => persistProviderResult(deps, result)).then(
        (providerResult) => ({ result: providerResult.execution.result, error: null as unknown }),
        (error: unknown) => ({ result: null, error }),
      )
    : null;
  const redfinPromise = deps.captureRedfinComps && canonicalInput
    ? executePropertyProvider({
        runId: ctx.runId,
        property: canonicalInput,
        adapter: marketplaceProviderAdapter({ laneId: 'redfin', providerId: 'redfin', execute: () => deps.captureRedfinComps!(marketInput) }),
      }).then((result) => persistProviderResult(deps, result)).then(
        (providerResult) => ({ result: providerResult.execution.result, error: null as unknown }),
        (error: unknown) => ({ result: null, error }),
      )
    : null;
  const realtorPromise = deps.captureRealtorComps && canonicalInput
    ? executePropertyProvider({
        runId: ctx.runId,
        property: canonicalInput,
        adapter: marketplaceProviderAdapter({ laneId: 'realtor', providerId: 'realtor', execute: () => deps.captureRealtorComps!(marketInput) }),
      }).then((result) => persistProviderResult(deps, result)).then(
        (providerResult) => ({ result: providerResult.execution.result, error: null as unknown }),
        (error: unknown) => ({ result: null, error }),
      )
    : null;
  // The factory starts this promise with parcel identity. Direct unit callers
  // still get the standing behavior through this fallback.
  const exactAddressPromise = standingExactAddress ?? runStandingExactAddressDiscovery(ctx, deps);
  const manufacturedHomesPromise = deps.captureManufacturedHomeComps && canonicalInput
    ? executePropertyProvider({
        runId: ctx.runId,
        property: canonicalInput,
        adapter: marketplaceProviderAdapter({
          laneId: 'manufactured_home',
          providerId: 'zillow_manufactured_home',
          execute: () => marketInput.lat != null && marketInput.lng != null
            ? deps.captureManufacturedHomeComps!({ ...marketInput, lat: marketInput.lat, lng: marketInput.lng })
            : Promise.resolve({ status: 'not_applicable', sold: [], active: [], note: 'Confirmed subject coordinates are required for the 5-mile manufactured-home boundary.' }),
        }),
      }).then((result) => persistProviderResult(deps, result)).then(
        (providerResult) => ({ result: providerResult.execution.result, error: null as unknown }),
        (error: unknown) => ({ result: null, error }),
      )
    : null;

  if (landPortalCapturePromise) {
    const outcome = await landPortalCapturePromise;
    if (outcome.error) {
      landPortalCapture = { ok: false, note: `LandPortal parcel read errored: ${(outcome.error as Error)?.message ?? String(outcome.error)}.`, comparableCount: 0 };
    } else {
      landPortalCapture = outcome.result;
      inspection = loadPropertyInspection(cardId!);
    }
  }

  // Only the CURRENT capture generation prices the subject. Earlier captures
  // stay stored as evidence but no longer describe what LandPortal returns for
  // this parcel, and resurfacing them put stale status-unknown rows in front of
  // the operator beside the freshly enriched ones.
  const landPortalRecords = currentComparables(inspection) as unknown as Array<Record<string, unknown>>;
  let landPortalAccepted = 0;
  for (const record of landPortalRecords) {
    const status = str(record.status) ?? 'unknown';
    const indicator = str(record.saleListIndicator) ?? 'unknown';
    // Defensive normalization also repairs retained captures made before the
    // detail parser learned that a material building can never be vacant land.
    const improvement = (num(record.buildingSqft) ?? 0) >= 1_500
      ? 'improved'
      : str(record.improvement) ?? 'unknown';
    const isActive = indicator === 'list' || status === 'active' || status === 'listed';
    const isSold = indicator === 'sale' || status === 'sold';
    // The parcel panel often shows a price + acreage with no sale/list word. That
    // row's transaction type is genuinely unknown, and the policy must be told so
    // rather than being handed a default that decides the valuation for it.
    const kindStated = isActive || isSold;
    // Structured fields are preferred; a row that lost them still contributes
    // through the shared rawText parser rather than being dropped.
    let price = num(record.price);
    let acres = num(record.acres);
    let pricePerAcre = num(record.pricePerAcre);
    let date = str(record.saleDate);
    let address = str(record.address);
    if (price == null || acres == null) {
      const parsed = parseLandPortalCompRows([str(record.rawText) ?? ''], subjectAcres)[0];
      if (parsed) {
        price ??= parsed.price ?? null;
        acres ??= parsed.acres ?? null;
        pricePerAcre ??= parsed.pricePerAcre ?? null;
        date ??= parsed.date ?? null;
        address ??= parsed.address ?? null;
      }
    }
    // The comp's own parcel page (the second surface) is where the acreage the
    // row was priced on can be checked against the assessor parcel acreage. When
    // the two cannot be reconciled the row carries no defensible price-per-acre,
    // so it is passed through WITHOUT acreage rather than with a false one.
    const acreageConflict = record.acreageConflict === true;
    candidates.push({
      id: str(record.propertyId) ?? str(record.mlsPropertyId) ?? str(record.providerId),
      provider: 'LandPortal visible',
      lane: kindStated ? (isActive ? 'active' : 'landportal') : 'unknown',
      addressDesc: address,
      apn: str(record.apn),
      state: str(record.state) ?? state,
      price,
      priceKind: kindStated ? (isActive ? 'list' : 'sold') : null,
      saleOrListDate: date,
      acres: acreageConflict ? null : acres,
      pricePerAcre: acreageConflict ? null : pricePerAcre,
      distanceMiles: num(record.distanceMiles),
      lat: num(record.lat),
      lng: num(record.lng),
      sourceUrl: str(record.detailUrl) ?? str(record.sourceUrl) ?? inspection?.parcelUrl ?? null,
      thumbnailUrl: (() => {
        const apn = str(record.apn);
        if (!apn) return null;
        const safeApn = apn.replace(/[^A-Za-z0-9_-]/g, '');
        if (!safeApn) return null;
        const file = `deal${deal.id}_comp_${safeApn}.png`;
        return fs.existsSync(landosArtifactPath('browser-shots', file))
          ? `/api/landos/deal-cards/${deal.id}/comp-image/${safeApn}`
          : null;
      })(),
      // LandPortal states whether the comparable carries an improvement. An
      // improved row is routed to the Land-Home lane by the source policy, never
      // into vacant-land FMV; an unknown row is left for the classifier.
      compClass: improvement === 'vacant' ? 'vacant_land' : improvement === 'improved' ? 'residential' : null,
      acreageConflict,
      statusSource: str(record.statusSource),
    } as CompRegistryCandidate);
    if (isSold && improvement !== 'improved' && !acreageConflict) landPortalAccepted += 1;
  }

  if (landPortalRecords.length > 0) {
    const unstated = landPortalRecords.filter((row) => {
      const st = str(row.status) ?? 'unknown';
      const ind = str(row.saleListIndicator) ?? 'unknown';
      return !(ind === 'sale' || st === 'sold' || ind === 'list' || st === 'active' || st === 'listed');
    }).length;
    // Both LandPortal surfaces are reported separately so the operator can see
    // the sidebar block AND the expanded Show-on-Map results were reached, and
    // how many rows the two corroborated rather than double-counted.
    const bySurface = { sidebar: 0, map: 0, both: 0 };
    for (const row of landPortalRecords) {
      const surface = str(row.surface) ?? 'sidebar';
      if (surface === 'map') bySurface.map += 1;
      else if (surface === 'both') bySurface.both += 1;
      else bySurface.sidebar += 1;
    }
    const withAddress = landPortalRecords.filter((row) => !!str(row.address)).length;
    // Raw per-surface counts are recoverable from provenance: a row marked
    // 'both' was seen on each surface, so it counts toward both raw totals while
    // remaining ONE combined candidate.
    const sidebarRaw = bySurface.sidebar + bySurface.both;
    const mapRaw = bySurface.map + bySurface.both;
    notes.push(
      `LandPortal: BOTH surfaces reached. Parcel sidebar returned ${sidebarRaw} row(s); the "Show on Map" expanded view returned ${mapRaw} row(s); `
      + `${bySurface.both} corroborated by both surfaces and merged, giving ${landPortalRecords.length} combined unique candidate(s). `
      + `${withAddress} carry a street address. ${landPortalAccepted} vacant-land closed sale candidate(s)`
      + `${unstated ? `; ${unstated} row(s) carry a price and acreage but no sale-or-listing status anywhere on either surface, so they stay market context and cannot price the subject` : ''}. `
      + 'The paid comp report was never requested.',
    );
  } else if (landPortalCapture && !landPortalCapture.ok) {
    notes.push(`LandPortal primary lane unavailable: ${landPortalCapture.note}`);
  } else if (landPortalCapture) {
    notes.push(`The LandPortal parcel page was read but carries no visible comparable rows. ${landPortalCapture.note}`);
  } else if (inspection?.parcelUrl) {
    notes.push('The LandPortal parcel page carries no visible comparable rows.');
  } else {
    notes.push('No LandPortal parcel page has been read for this card and no LandPortal reader is wired into this run.');
  }

  // ── Supplements: Zillow and Redfin public land comps ─────────────────────
  const [zillowOutcome, redfinOutcome, realtorOutcome, manufacturedHomesOutcome, exactAddressOutcome] = await Promise.all([
    zillowPromise ?? Promise.resolve({ result: null, error: null as unknown }),
    redfinPromise ?? Promise.resolve({ result: null, error: null as unknown }),
    realtorPromise ?? Promise.resolve({ result: null, error: null as unknown }),
    manufacturedHomesPromise ?? Promise.resolve({ result: null, error: null as unknown }),
    exactAddressPromise ?? Promise.resolve({ result: null, error: null as unknown }),
  ]);
  if (zillowOutcome.error) notes.push(`Zillow supplement unavailable: ${(zillowOutcome.error as Error)?.message ?? String(zillowOutcome.error)}.`);
  if (redfinOutcome.error) notes.push(`Redfin supplement unavailable: ${(redfinOutcome.error as Error)?.message ?? String(redfinOutcome.error)}.`);
  if (realtorOutcome.error) notes.push(`Realtor.com supplement unavailable: ${(realtorOutcome.error as Error)?.message ?? String(realtorOutcome.error)}.`);
  if (manufacturedHomesOutcome.error) notes.push(`Manufactured-home supplement unavailable: ${(manufacturedHomesOutcome.error as Error)?.message ?? String(manufacturedHomesOutcome.error)}.`);
  if (exactAddressOutcome.error) notes.push(`Exact-address web discovery failed: ${(exactAddressOutcome.error as Error)?.message ?? String(exactAddressOutcome.error)}.`);
  const zillow = zillowOutcome.result;
  const redfin = redfinOutcome.result;
  const realtor = realtorOutcome.result;
  const manufacturedHomes = manufacturedHomesOutcome.result;
  const exactAddress = exactAddressOutcome.result;
  candidates.push(...marketplaceCandidates(zillow, 'Zillow', state));
  candidates.push(...marketplaceCandidates(redfin, 'Redfin', state));
  candidates.push(...marketplaceCandidates(realtor, 'Realtor.com', state));
  if (manufacturedHomes) {
    for (const row of manufacturedHomes.sold ?? []) {
      if ((row.price ?? 0) <= 200_000 || (row.distanceMiles ?? Number.POSITIVE_INFINITY) > 5) continue;
      candidates.push({
        id: row.providerId ?? null,
        provider: 'Zillow manufactured-home sold',
        lane: 'sold',
        addressDesc: row.address,
        state,
        price: row.price,
        priceKind: 'sold',
        saleOrListDate: row.saleDate ?? null,
        acres: row.acres,
        pricePerAcre: row.pricePerAcre ?? null,
        sourceUrl: row.url ?? null,
        distanceMiles: row.distanceMiles ?? null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        compClass: 'manufactured',
        homeType: row.homeType ?? null,
        yearBuilt: row.yearBuilt ?? null,
        homeSizeSqft: row.homeSizeSqft ?? null,
      } as CompRegistryCandidate);
    }
    notes.push(`Manufactured-home sold lane: ${manufacturedHomes.status} (${manufacturedHomes.sold?.length ?? 0} returned; only >$200,000 sales proven within 5 miles retained).`);
  } else if (marketInput.lat == null || marketInput.lng == null) {
    notes.push('Manufactured-home sold lane not run: confirmed subject coordinates are required for the 5-mile boundary.');
  }
  if (zillow) notes.push(`Zillow: ${zillow.status} (${(zillow.sold?.length ?? 0)} sold, ${(zillow.active?.length ?? 0)} active).`);
  if (redfin) notes.push(`Redfin: ${redfin.status} (${(redfin.sold?.length ?? 0)} sold, ${(redfin.active?.length ?? 0)} active).`);
  if (realtor) notes.push(`Realtor.com: ${realtor.status} (${(realtor.sold?.length ?? 0)} sold, ${(realtor.active?.length ?? 0)} active).`);
  if (exactAddress) notes.push(`Exact-address web discovery: ${exactAddress.status}; ${exactAddress.pages.length} property-specific page(s) retained. Persistence: ${exactAddress.persistence?.persisted ? 'stored on the canonical subject' : exactAddress.persistence?.reason ?? 'not attempted'}. ${exactAddress.note}`);

  // ── Persisted rows already accepted onto this card ───────────────────────
  // Historical rows remain intact in SQLite, but only the three currently
  // approved marketplaces enter this mission handback. Disabled aggregators
  // and county-sale rows therefore cannot execute, count, map, render, or value
  // the subject while their stored history remains available for audit.
  const persisted = listComps({ dealCardId: ctx.dealCardId }).filter((row) => {
    const source = `${row.canonical_source ?? ''} ${row.source_label ?? ''}`;
    if (/home\s*harvest|homeharvest|realie|really\.?ai/i.test(source)) return false;
    return /landportal|zillow|redfin|realtor(?:\.com)?/i.test(source);
  });
  for (const row of persisted) {
    candidates.push({
      id: row.id,
      provider: row.canonical_source || row.source_label || 'Unknown',
      lane: row.price_kind === 'list' ? 'active' : 'sold',
      addressDesc: row.address_desc || null,
      apn: row.apn || null,
      state: row.state || state,
      price: typeof row.price === 'number' ? row.price : null,
      priceKind: row.price_kind || null,
      saleOrListDate: row.sale_or_list_date || null,
      acres: typeof row.acres === 'number' ? row.acres : null,
      pricePerAcre: typeof row.price_per_acre === 'number' ? row.price_per_acre : null,
      sourceUrl: row.source_url || null,
      distanceMiles: typeof row.distance_miles === 'number' ? row.distance_miles : null,
      thumbnailUrl: row.thumbnail_url || null,
      compClass: row.property_class || null,
      persistedStatus: row.status || null,
    } as CompRegistryCandidate);
  }
  if (persisted.length) notes.push(`${persisted.length} previously persisted comp row(s) re-screened against the current policy.`);

  const laneAttempts: CompLaneInput[] = [
    {
      lane: 'landportal', attempted: !!landPortalCapture || !!inspection?.parcelUrl,
      attemptStatus: landPortalCapture?.ok === false ? 'failed' : landPortalRecords.length ? 'retrieved' : 'none',
      failureReason: landPortalCapture?.ok === false ? landPortalCapture.note : null,
      candidates: landPortalCapture || inspection?.parcelUrl ? landPortalRecords.length : null,
      retained: landPortalCapture || inspection?.parcelUrl ? landPortalRecords.length : null,
      retainedAs: 'LandPortal primary/context evidence',
    },
    {
      lane: 'zillow', attempted: !!zillowPromise,
      attemptStatus: zillow?.status ?? (zillowOutcome.error ? 'failed' : null),
      failureReason: zillowOutcome.error ? (zillowOutcome.error as Error)?.message ?? String(zillowOutcome.error) : null,
      blockedReason: /blocked|disabled|unavailable/i.test(zillow?.status ?? '') ? zillow?.note ?? 'Provider was blocked, disabled, or unavailable.' : null,
      candidates: zillow ? (zillow.sold?.length ?? 0) + (zillow.active?.length ?? 0) : null,
      retained: zillow ? (zillow.sold?.length ?? 0) + (zillow.active?.length ?? 0) : null,
    },
    {
      lane: 'redfin', attempted: !!redfinPromise,
      attemptStatus: redfin?.status ?? (redfinOutcome.error ? 'failed' : null),
      failureReason: redfinOutcome.error ? (redfinOutcome.error as Error)?.message ?? String(redfinOutcome.error) : null,
      blockedReason: /blocked|disabled|unavailable/i.test(redfin?.status ?? '') ? redfin?.note ?? 'Provider was blocked, disabled, or unavailable.' : null,
      candidates: redfin ? (redfin.sold?.length ?? 0) + (redfin.active?.length ?? 0) : null,
      retained: redfin ? (redfin.sold?.length ?? 0) + (redfin.active?.length ?? 0) : null,
    },
    {
      lane: 'realtor', attempted: !!realtorPromise,
      attemptStatus: realtor?.status ?? (realtorOutcome.error ? 'failed' : null),
      failureReason: realtorOutcome.error ? (realtorOutcome.error as Error)?.message ?? String(realtorOutcome.error) : null,
      blockedReason: /blocked|disabled|unavailable/i.test(realtor?.status ?? '') ? realtor?.note ?? 'Provider was blocked, disabled, or unavailable.' : null,
      candidates: realtor ? (realtor.sold?.length ?? 0) + (realtor.active?.length ?? 0) : null,
      retained: realtor ? (realtor.sold?.length ?? 0) + (realtor.active?.length ?? 0) : null,
    },
  ];
  const anySource = landPortalRecords.length > 0 || !!zillow || !!redfin || !!realtor || !!manufacturedHomes || !!exactAddress || persisted.length > 0;
  const collectorRegistry = buildCompRegistry({
    state,
    county: marketInput.county,
    zip: marketInput.zip,
    acres: subjectAcres,
  }, candidates);
  return {
    status: candidates.length === 0 ? 'partial' : anySource ? 'completed' : 'partial',
    summary: notes.join(' '),
    data: {
      candidates,
      duplicatesMerged: collectorRegistry.counts.duplicatesMerged,
      landHomeSearchProof: manufacturedHomes?.searchProof ? {
        status: manufacturedHomes.status === 'retrieved' || manufacturedHomes.status === 'none'
          ? 'completed'
          : manufacturedHomes.status === 'blocked' ? 'blocked'
            : manufacturedHomes.status === 'disabled' ? 'not_run' : 'unavailable',
        ...manufacturedHomes.searchProof,
      } : null,
      laneAttempts,
    },
  } as SpecialistOutcome<ComparablesContribution>;
}

// ── Market intelligence ─────────────────────────────────────────────────────

export async function collectMarketIntelligence(
  ctx: MissionContext,
  deps: LiveCollectorDeps,
): Promise<SpecialistOutcome<MarketContribution>> {
  if (!deps.captureMarketContext) {
    return {
      status: 'blocked',
      summary: 'No market-context provider is wired for this run.',
      data: { facts: [], summary: '' },
    };
  }
  const canonicalInput = canonicalPropertyInputForDeal(ctx.dealCardId);
  const context = canonicalInput
    ? (await persistProviderResult(deps, await executePropertyProvider({
      runId: ctx.runId,
      property: canonicalInput,
      timeoutMs: 60_000,
      adapter: {
        laneId: 'market_matrix',
        providerId: 'landos_market_matrix',
        execute: () => deps.captureMarketContext!(ctx.dealCardId),
        validate: (_property, execution) => ({
          valid: Array.isArray(execution.facts),
          subjectClassification: 'context_only',
          checks: [{ check: 'market_context_returned', passed: Array.isArray(execution.facts), reason: execution.summary }],
          rejectedEvidenceIds: [],
        }),
        normalize: (property, execution) => execution.facts.map((fact, index): NormalizedPropertyEvidence => ({
          id: `market-matrix:${fact.key || index}`,
          propertyCardId: property.propertyCardId,
          dealCardId: property.dealCardId,
          providerId: 'landos_market_matrix',
          field: fact.key,
          value: fact.value,
          subjectClassification: 'context_only',
          strength: 'context_only',
          sourceUrl: fact.sourceUrl,
          retrievedAt: fact.retrievedAt ?? new Date().toISOString(),
          confidence: 'medium',
          kind: 'fact',
          validation: { valid: !!fact.value, reasons: fact.value ? [] : ['Market context fact was blank.'] },
        })),
        status: (_property, _execution, _validation, evidence) => evidence.length ? 'context_only' : 'unavailable',
      },
    }))).execution.result ?? { facts: [], summary: 'Market Matrix provider did not return a usable handback.' }
    : await deps.captureMarketContext(ctx.dealCardId);
  return {
    status: context.facts.length ? 'completed' : 'partial',
    summary: context.summary || `${context.facts.length} market fact(s) assembled.`,
    data: context,
  };
}

// ── Evidence and visuals ────────────────────────────────────────────────────

export async function collectEvidenceVisuals(ctx: MissionContext): Promise<SpecialistOutcome<EvidenceContribution>> {
  const now = new Date().toISOString();
  const deal = getDealCard(ctx.dealCardId);
  if (!deal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const cardId = subjectCardId(deal);
  const evidence: SnapshotEvidenceItem[] = [];

  // Retained LandPortal / browser inspection assets.
  const inspection = cardId ? loadPropertyInspection(cardId) : null;
  for (const asset of inspection?.assets ?? []) {
    if (!usableInspectionAsset(asset)) continue;
    if (!cardId || !isAcceptedLandPortalVisualForProperty(asset.validation, cardId)) continue;
    const view = asset as unknown as Record<string, unknown>;
    const validation = asset.validation;
    const subjectVerified = validation.subjectClassification === 'verified_subject'
      && hasVerifiedLandPortalSubject(inspection);
    const key = str(view.key);
    const label = str(view.label) ?? key ?? 'Retained parcel screenshot';
    evidence.push({
      id: `visual-${key ?? evidence.length}`,
      kind: 'screenshot',
      label: subjectVerified ? label : `LandPortal context — ${label}`,
      sourceType: subjectVerified ? (str(view.source) ?? 'landportal') : 'landportal_context',
      sourceUrl: str(view.sourceUrl) ?? inspection?.parcelUrl ?? null,
      // Served through the existing token-gated inspection image route; the
      // stored disk path never leaves the server.
      viewUrl: key && cardId ? `/api/landos/inspection/image?cardId=${cardId}&key=${encodeURIComponent(key)}` : null,
      retrievedAt: str(view.capturedAt) ?? now,
      confidence: subjectVerified ? 'high' : 'low',
      supports: subjectVerified ? 'visual_evidence' : 'context_visual_evidence',
      sha256: str(view.sha256),
      bytes: typeof view.bytes === 'number' ? view.bytes : null,
    });
  }

  // Immutable Smart Intake artifacts (the operator's original uploads and
  // screenshots). They are append-only by DB trigger, so this read can never
  // disturb accepted original evidence.
  try {
    const artifacts = getLandosDb().prepare(`
      SELECT id, original_file_name, file_url, mime_type, byte_size, sha256, captured_at
      FROM landos_intake_artifact WHERE deal_card_id = ? ORDER BY captured_at DESC, id DESC LIMIT 40
    `).all(ctx.dealCardId) as Array<Record<string, unknown>>;
    for (const artifact of artifacts) {
      const mime = str(artifact.mime_type) ?? '';
      evidence.push({
        id: `intake-${String(artifact.id)}`,
        kind: mime.startsWith('image/') ? 'screenshot' : 'document',
        label: str(artifact.original_file_name) ?? `Intake artifact ${String(artifact.id)}`,
        sourceType: 'operator_intake',
        sourceUrl: null,
        viewUrl: str(artifact.file_url),
        retrievedAt: str(artifact.captured_at) ?? now,
        confidence: 'high',
        supports: 'intake_evidence',
        sha256: str(artifact.sha256),
        bytes: typeof artifact.byte_size === 'number' ? artifact.byte_size : null,
      });
    }
  } catch { /* the artifact table is optional on a fresh store */ }

  // Source links captured on the property card's evidence trail.
  const registry = documentRegistryForCard(cardId, { dealCardId: ctx.dealCardId });
  for (const document of registry.documents.slice(0, 60)) {
    const view = document as unknown as Record<string, unknown>;
    evidence.push({
      id: `doc-${String(view.id ?? view.key ?? evidence.length)}`,
      kind: 'document',
      label: str(view.label) ?? str(view.name) ?? 'Retained document',
      sourceType: str(view.sourceType) ?? 'document',
      sourceUrl: str(view.sourceUrl),
      viewUrl: str(view.viewUrl),
      retrievedAt: str(view.dateAccessed) ?? now,
      confidence: 'medium',
      supports: 'documents',
      sha256: null,
      bytes: null,
    });
  }

  // Public screening evidence with retrievable source URLs.
  const run = new PublicIntelligenceStore().load(ctx.dealCardId)?.run ?? null;
  for (const item of snapshotEvidenceFromPublicTasks(run, VISUAL_EVIDENCE_TASKS)) {
    if (!evidence.some((existing) => existing.id === item.id)) evidence.push(item);
  }
  for (const task of run?.tasks ?? []) {
    for (const item of task.evidence ?? []) {
      if (!item.sourceUrl) continue;
      evidence.push({
        id: `src-${task.task}-${evidence.length}`,
        kind: 'source_link',
        label: `${item.sourceName ?? task.task}`,
        sourceType: item.sourceTier ?? 'public_source',
        sourceUrl: item.sourceUrl,
        viewUrl: null,
        retrievedAt: item.retrievedAt ?? now,
        confidence: item.sourceTier === 'official_county_state' ? 'high' : 'medium',
        supports: task.task,
        sha256: null,
        bytes: null,
      });
    }
  }

  return {
    status: evidence.length === 0 ? 'blocked' : 'completed',
    summary: evidence.length === 0
      ? 'No screenshots, documents or source links have been retained for this parcel yet.'
      : `${evidence.length} evidence item(s) retained: ${evidence.filter((e) => e.kind === 'screenshot').length} screenshot(s), ${evidence.filter((e) => e.kind === 'document').length} document(s), ${evidence.filter((e) => e.kind === 'source_link').length} source link(s). Retained operator intake evidence is read append-only and is never modified by this run.`,
    data: { evidence: [] },
    evidence,
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function makeLivePropertyIntelligenceCollectors(deps: LiveCollectorDeps): PropertyIntelligenceCollectors {
  const exactAddressRuns = new Map<string, Promise<ExactAddressOutcome>>();
  const exactAddressFor = (ctx: MissionContext): Promise<ExactAddressOutcome> => {
    const existing = exactAddressRuns.get(ctx.runId);
    if (existing) return existing;
    const started = runStandingExactAddressDiscovery(ctx, deps);
    exactAddressRuns.set(ctx.runId, started);
    return started;
  };
  return {
    parcel_identity: (ctx) => {
      // Standing independent lane: launch before the identity collector waits
      // on LandPortal/public GIS. Its contained failure cannot abort either.
      void exactAddressFor(ctx);
      return collectParcelIdentity(ctx, deps);
    },
    government_records: (ctx) => collectGovernmentRecords(ctx),
    zoning_land_use: (ctx) => collectZoningLandUse(ctx),
    environmental_terrain: (ctx) => collectEnvironmentalTerrain(ctx),
    access_utilities: (ctx) => collectAccessUtilities(ctx),
    comparables: (ctx) => collectComparables(ctx, deps, exactAddressFor(ctx)),
    market_intelligence: (ctx) => collectMarketIntelligence(ctx, deps),
    evidence_visuals: (ctx) => collectEvidenceVisuals(ctx),
  };
}
