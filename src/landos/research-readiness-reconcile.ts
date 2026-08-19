// LandOS — Research Readiness reconciliation from retained state.
//
// Turns what a Deal Card ALREADY holds into the deterministic probes the
// manifest reads. It never runs research, never calls a model, and never
// touches the browser: every value comes from evidence some earlier run already
// persisted.
//
// This is what makes an OLD lead work immediately. A card whose research
// predates the capability registry still carries its canonical property-research
// record, its land-use determination, its comp rows, its visuals and its market
// facts, so the checklist can be rebuilt from those without repeating a single
// completed lane.
//
// Where a registered capability owns an item, that capability's own result is
// the stronger source and is read first. The retained stores are the fallback
// for everything that ran before the capability existed.

import { getLandosDb } from './db.js';
import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { PropertyResearchStore, type CanonicalPropertyResearchRecord } from './property-research-store.js';
import { loadEligibleCardVisualCapture } from './property-card.js';
import { listComps } from './comps.js';
import { loadSellerStatedFacts, summarizeSellerFacts } from './seller-stated-facts.js';
import {
  frontageFeet,
  readAccess,
  readFrontage,
  readPublicSewer,
  readPublicWater,
  readSepticOutlook,
  readWellOutlook,
  type AccessFrontageInput,
  type RetainedFrontageReading,
} from './access-utilities-screening.js';
import {
  loadWellContextScreening,
  retainedSoilUnits,
  retainedUtilityScreen,
} from './utility-service-screen-capability.js';
import type { CapabilityResult, JsonObject, JsonValue } from './capability-contract.js';
import {
  buildResearchReadinessManifest,
  type ResearchReadinessManifest,
  type ResearchReadinessProbe,
} from './research-readiness.js';

/** Visual sources that actually show the parcel. A fallback map is not one. */
const PARCEL_GRADE_VISUAL_SERVICES = [
  'landportal', 'county_gis', 'google_earth_3d', 'google_earth_overhead',
  'satellite', 'street_view', 'aerial',
];

function asObject(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A retained canonical fact's plain value, whatever shape it was stored in. */
function factValue(record: CanonicalPropertyResearchRecord | null, key: string): unknown {
  const fact = record?.facts?.[key] as { value?: unknown } | undefined;
  return fact?.value;
}

function factRetrievedAt(record: CanonicalPropertyResearchRecord | null, key: string): string | null {
  const fact = record?.facts?.[key] as { retrievedAt?: string } | undefined;
  return fact?.retrievedAt ?? null;
}

/** The provider that carried a retained fact, for source-named conflicts. */
function factProvider(record: CanonicalPropertyResearchRecord | null, key: string): string | null {
  const fact = record?.facts?.[key] as { providerId?: string } | undefined;
  return fact?.providerId?.trim() || null;
}

/** A retained string fact, ignoring LandPortal's "-" placeholder for "blank". */
function factText(record: CanonicalPropertyResearchRecord | null, key: string): string | null {
  const value = factValue(record, key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== '-' ? trimmed : null;
}

interface CapabilityReading {
  result: CapabilityResult | null;
  facts: JsonObject;
  outcome: string | null;
  succeeded: boolean;
  completedAt: string | null;
}

/**
 * Why a capability run produced nothing, in the capability's own words.
 *
 * A red item that only says "no record was retrieved" tells the operator
 * nothing about whether retrying is worth anything. The capability already
 * recorded the reason — a provider timeout, an adapter that could not match the
 * parcel — so the manifest carries it rather than flattening every failure into
 * one sentence.
 */
function failureNote(reading: CapabilityReading): string {
  const warning = reading.result?.warnings?.find((item) => item.trim());
  return warning ? ` ${warning.trim().replace(/\.?$/, '.')}` : '';
}

function readCapability(
  store: CapabilityInvocationStore,
  propertyCardId: number,
  dealCardId: number,
  capabilityId: string,
): CapabilityReading {
  // Prefer this Deal Card's own run; fall back to any run against the same
  // canonical Property Card, because a capability invoked from Tools or from
  // New Lead answered the same question about the same parcel.
  const result = store.latestForProperty(propertyCardId, dealCardId, capabilityId)
    ?? store.latestForProperty(propertyCardId, undefined, capabilityId);
  const facts = (result?.facts ?? {}) as JsonObject;
  return {
    result,
    facts,
    outcome: asString(facts.outcome),
    succeeded: result?.status === 'SUCCEEDED',
    completedAt: result?.timestamps?.completedAt ?? null,
  };
}

// ── Per-item probes ──────────────────────────────────────────────────────────

interface ReconcileContext {
  dealCardId: number;
  propertyCardId: number;
  card: Record<string, unknown>;
  research: CanonicalPropertyResearchRecord | null;
  capability: (capabilityId: string) => CapabilityReading;
}

function propertyResolutionProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const reading = ctx.capability('property-resolution');
  const verification = String(ctx.card.verification_status ?? '');
  const verified = verification.startsWith('verified');
  const apn = String(ctx.card.apn ?? '').trim();
  const attempted = !!reading.result || !!verification;
  return {
    itemId: 'property_resolution',
    attempted,
    technicalSuccess: reading.result ? reading.succeeded : attempted,
    usableEvidence: verified && !!apn,
    unresolved: true,
    lastAttemptAt: reading.completedAt,
    lastSuccessAt: verified ? reading.completedAt ?? isoFromEpoch(ctx.card.last_refreshed_at) : null,
    reason: verified && apn
      ? `Parcel identity confirmed: APN ${apn}${ctx.card.county ? `, ${String(ctx.card.county)} County` : ''}${ctx.card.state ? `, ${String(ctx.card.state)}` : ''}.`
      : attempted
        ? `Resolution ran and the parcel identity is still ${verification || 'unconfirmed'}.`
        : 'No property resolution has run for this Deal Card.',
  };
}

function landPortalProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const reading = ctx.capability('landportal-research');
  const lpId = factText(ctx.research, 'landportal_property_id')
    ?? (String(ctx.card.lp_property_id ?? '').trim() || null);
  const lane = ctx.research?.lanes?.landportal_subject ?? ctx.research?.lanes?.hermes_landportal_subject ?? null;
  const laneRan = !!lane;
  const laneRetained = lane?.retainedStatus === 'verified';
  const attempted = !!reading.result || laneRan;
  // "record_returned" is the capability's own usable outcome; a retained
  // LandPortal id plus a verified subject lane is the same fact for a card
  // whose research predates the capability.
  const usable = reading.outcome === 'record_returned' || (!!lpId && laneRetained);
  return {
    itemId: 'landportal_research',
    attempted,
    technicalSuccess: reading.result ? reading.succeeded : laneRan,
    usableEvidence: usable,
    unresolved: true,
    lastAttemptAt: reading.completedAt ?? lane?.latestAttemptAt ?? null,
    lastSuccessAt: usable ? reading.completedAt ?? lane?.retainedAt ?? null : null,
    reason: usable
      ? `LandPortal parcel record retained${lpId ? ` (property ${lpId})` : ''}.`
      : attempted
        ? `The LandPortal lane ran and no parcel record was retained.${failureNote(reading)}`
        : 'LandPortal Research has not run for this parcel.',
  };
}

function assessorTaxProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const reading = ctx.capability('assessor-tax');
  const recordStatus = asString(reading.facts.recordStatus);
  const usable = recordStatus === 'official_record_retrieved' || recordStatus === 'retained_record_only';
  // Retained LandPortal figures are NOT an assessor record. They are named here
  // so the operator can see the gap is about provenance, not about numbers.
  const retainedAssessed = factText(ctx.research, 'assessed_value');
  const retainedTax = factText(ctx.research, 'Tax Amount');
  return {
    itemId: 'assessor_tax',
    attempted: !!reading.result,
    technicalSuccess: reading.succeeded,
    usableEvidence: usable,
    unresolved: recordStatus === 'not_retrieved',
    lastAttemptAt: reading.completedAt,
    lastSuccessAt: usable ? reading.completedAt : null,
    reason: usable
      ? `Assessor & Tax returned a ${recordStatus === 'official_record_retrieved' ? 'live official' : 'retained'} record.`
      : reading.result
        ? `Assessor & Tax ran and no assessor or tax record was retrieved.${failureNote(reading)}`
        : `No Assessor & Tax run is on record.${retainedAssessed || retainedTax
          ? ` The retained LandPortal record carries${retainedAssessed ? ` an assessed value of ${retainedAssessed}` : ''}${retainedAssessed && retainedTax ? ' and' : ''}${retainedTax ? ` an annual tax of ${retainedTax}` : ''}, which is not an assessor record.`
          : ''}`,
  };
}

function officialParcelRecordProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const row = getLandosDb().prepare(`
    SELECT parcel_match_status, platform_family, retrieved_at
    FROM landos_official_parcel_gis
    WHERE deal_card_id = ?
    ORDER BY retrieved_at DESC, id DESC
    LIMIT 1
  `).get(ctx.dealCardId) as { parcel_match_status?: string; platform_family?: string; retrieved_at?: string } | undefined;
  const gisMatched = !!row && /match|found|resolved/i.test(String(row.parcel_match_status ?? ''));
  // A parcel whose identity was confirmed FROM an official government record
  // already holds this item's evidence, whatever surface retrieved it.
  const source = String(ctx.card.verification_source ?? '');
  const officialSource = /official|assessor|county|government|gis/i.test(source);
  const usable = gisMatched || officialSource;
  return {
    itemId: 'official_parcel_record',
    attempted: !!row || officialSource,
    technicalSuccess: !!row || officialSource,
    usableEvidence: usable,
    unresolved: true,
    lastAttemptAt: row?.retrieved_at ?? null,
    lastSuccessAt: usable ? row?.retrieved_at ?? isoFromEpoch(ctx.card.last_refreshed_at) : null,
    reason: usable
      ? `Official government parcel record on file${officialSource ? `: ${source}` : `: ${String(row?.platform_family ?? 'county GIS')}`}.`
      : row
        ? `The Official Parcel & GIS lane ran and returned ${String(row.parcel_match_status ?? 'no match')}.`
        : 'No official parcel or GIS record has been retrieved for this parcel.',
  };
}

function zoningProbes(ctx: ReconcileContext): ResearchReadinessProbe[] {
  const reading = ctx.capability('zoning-subdivision');
  const zoning = asObject(reading.facts.zoning);
  const rules = asObject(reading.facts.rules);
  const byRight = asObject(reading.facts.subdivisionByRight);

  // Fallback for cards researched before the capability: the persisted land-use
  // determination carries the same two answers.
  const determination = getLandosDb().prepare(`
    SELECT zoning_presence, zoning_code, legal_yield_status, determined_at
    FROM landos_land_use_determination
    WHERE deal_card_id = ?
    ORDER BY determined_at DESC, id DESC
    LIMIT 1
  `).get(ctx.dealCardId) as {
    zoning_presence?: string; zoning_code?: string; legal_yield_status?: string; determined_at?: string;
  } | undefined;

  const zoningRan = !!reading.result || !!determination;
  const zoningAt = reading.completedAt ?? determination?.determined_at ?? null;
  const zoningEstablished = zoning?.established === true
    || (!reading.result && !!determination?.zoning_code);
  const districtCode = asString(zoning?.districtCode) ?? (determination?.zoning_code || null);
  const zoningStatement = asString(zoning?.statement);

  const ruleCount = asNumber(rules?.count) ?? 0;
  const documentCount = asNumber(rules?.documentCount) ?? 0;
  const byRightStatus = asString(byRight?.statusLabel);
  const rulesUsable = ruleCount > 0;

  return [
    {
      itemId: 'current_zoning',
      attempted: zoningRan,
      technicalSuccess: reading.result ? reading.succeeded : zoningRan,
      usableEvidence: zoningEstablished,
      // A zoning lane that searched properly and could not establish the
      // district is UNRESOLVED, not failed. It must not be retried on a loop:
      // the remaining route is a call to the planning office.
      unresolved: reading.outcome !== 'not_available',
      lastAttemptAt: zoningAt,
      lastSuccessAt: zoningEstablished ? zoningAt : null,
      reason: zoningEstablished
        ? `Zoning district established: ${districtCode ?? 'district on file'}.`
        : zoningRan
          ? `Zoning research ran and did not establish a district. ${zoningStatement ?? `Presence recorded as ${determination?.zoning_presence ?? 'unverified'}.`}`
          : 'Zoning & Subdivision has not run for this parcel.',
      nextAction: zoningEstablished
        ? null
        : zoningRan
          ? 'Confirm the district with the Planning/Zoning office. Repeating the automated search is not expected to establish it.'
          : null,
    },
    {
      itemId: 'subdivision_rules',
      attempted: zoningRan,
      technicalSuccess: reading.result ? reading.succeeded : zoningRan,
      usableEvidence: rulesUsable,
      unresolved: reading.outcome !== 'not_available',
      lastAttemptAt: zoningAt,
      lastSuccessAt: rulesUsable ? zoningAt : null,
      reason: rulesUsable
        ? `${ruleCount} jurisdiction rule(s) retained from ${documentCount} official document(s).${byRightStatus ? ` By-right result: ${byRightStatus}.` : ''}`
        : zoningRan
          ? 'The subdivision lane ran and retained no jurisdiction rules.'
          : 'Zoning & Subdivision has not run for this parcel.',
    },
  ];
}

function developmentHistoryProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const reading = ctx.capability('property-development-history');
  const history = asObject(reading.facts.history);
  const eventCount = asNumber(history?.eventCount) ?? 0;
  // "No material history" is an ANSWER, not a gap: the search ran and the
  // record says nothing has been sought here.
  const usable = reading.outcome === 'history_returned' || reading.outcome === 'no_material_history';
  return {
    itemId: 'property_development_history',
    attempted: !!reading.result,
    technicalSuccess: reading.succeeded,
    usableEvidence: usable,
    unresolved: reading.outcome !== 'not_available',
    lastAttemptAt: reading.completedAt,
    lastSuccessAt: usable ? reading.completedAt : null,
    reason: reading.outcome === 'history_returned'
      ? `${eventCount} material development or entitlement record(s) established for this parcel.`
      : reading.outcome === 'no_material_history'
        ? 'The history search ran and the official record shows no material development history.'
        : reading.result
          ? `The Property Development History lane ran and produced no usable history result.${failureNote(reading)}`
          : 'Property Development History has not run for this parcel.',
  };
}

function visualEvidenceProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const assets = loadEligibleCardVisualCapture(ctx.propertyCardId);
  const services = Object.keys(assets);
  const parcelGrade = services.filter((service) => PARCEL_GRADE_VISUAL_SERVICES.some((kind) => service.includes(kind)));
  const latest = services
    .map((service) => assets[service]?.timestamp)
    .filter((stamp): stamp is string => !!stamp)
    .sort()
    .pop() ?? null;
  return {
    itemId: 'visual_evidence',
    attempted: services.length > 0,
    technicalSuccess: services.length > 0,
    usableEvidence: parcelGrade.length > 0,
    // Captures exist but the parcel-grade sources are missing: the package ran
    // and came back short, which is a partial result, not a failed one.
    unresolved: services.length > 0,
    lastAttemptAt: latest,
    lastSuccessAt: parcelGrade.length > 0 ? latest : null,
    reason: parcelGrade.length > 0
      ? `${services.length} parcel-associated visual(s) retained (${parcelGrade.join(', ')}).`
      : services.length > 0
        ? `Only fallback imagery is retained (${services.join(', ')}); no parcel-grade capture is on file.`
        : 'No parcel-associated visuals have been captured.',
    nextAction: parcelGrade.length > 0
      ? null
      : 'Capture parcel-grade imagery from the visual capture control on Property & Market.',
  };
}

/** The retained keys each provider writes the same access fact under. */
const LANDLOCKED_FACT_KEYS = ['landlocked_status', 'Land Locked'];
const FRONTAGE_FACT_KEYS = ['road_frontage_ft', 'Road Frontage'];

/** Every retained frontage reading, with the provider that carried each one. */
function retainedFrontageReadings(record: CanonicalPropertyResearchRecord | null): RetainedFrontageReading[] {
  const readings: RetainedFrontageReading[] = [];
  for (const key of FRONTAGE_FACT_KEYS) {
    const raw = factText(record, key);
    if (!raw) continue;
    readings.push({ raw, feet: frontageFeet(raw), source: factProvider(record, key) ?? key });
  }
  return readings;
}

function accessFrontageInput(ctx: ReconcileContext): AccessFrontageInput {
  const lane = ctx.research?.lanes?.landportal_subject ?? ctx.research?.lanes?.hermes_landportal_subject ?? null;
  return {
    landlockedStatus: LANDLOCKED_FACT_KEYS.map((key) => factText(ctx.research, key)).find(Boolean) ?? null,
    frontageReadings: retainedFrontageReadings(ctx.research),
    parcelRecordRead: !!lane,
  };
}

function accessFrontageAt(ctx: ReconcileContext): string | null {
  return [...LANDLOCKED_FACT_KEYS, ...FRONTAGE_FACT_KEYS]
    .map((key) => factRetrievedAt(ctx.research, key))
    .find((stamp): stamp is string => !!stamp)
    ?? ctx.research?.lanes?.landportal_subject?.latestAttemptAt
    ?? null;
}

/**
 * ACCESS - "is there an established way in at the screening stage?"
 *
 * Discovery-stage doctrine, unchanged: an ordinary parcel that fronts a
 * recognized road and carries no land-locked flag HAS access here. Deed and
 * easement research is later diligence, not a precondition, so an established
 * access read is green even while the exact frontage figure is disputed.
 */
function accessProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const input = accessFrontageInput(ctx);
  const read = readAccess(input);
  const at = accessFrontageAt(ctx);
  const attempted = !!input.parcelRecordRead || (input.frontageReadings?.length ?? 0) > 0 || input.landlockedStatus != null;
  return {
    itemId: 'access',
    attempted,
    technicalSuccess: attempted,
    usableEvidence: read.established,
    // A parcel record that was read and shows doubtful access is unresolved:
    // the remaining route is a recorded instrument, not another parcel read.
    unresolved: attempted,
    lastAttemptAt: at,
    lastSuccessAt: read.established ? at : null,
    reason: read.statement,
    nextAction: read.established
      ? null
      : attempted
        ? 'Establish access from a recorded easement or an official access record. Repeating the parcel read does not change it.'
        : null,
  };
}

/**
 * ROAD FRONTAGE - "how much frontage does the subject have?"
 *
 * Independent of access, and honest about disagreement: retained readings that
 * conflict are reported at their real values and never re-run on a loop, since
 * the same providers will return the same two numbers.
 */
function roadFrontageProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const input = accessFrontageInput(ctx);
  const read = readFrontage(input);
  const at = accessFrontageAt(ctx);
  const attempted = !!input.parcelRecordRead || (input.frontageReadings?.length ?? 0) > 0;
  return {
    itemId: 'road_frontage',
    attempted,
    technicalSuccess: attempted,
    usableEvidence: read.state === 'established',
    unresolved: attempted,
    lastAttemptAt: at,
    lastSuccessAt: read.state === 'established' ? at : null,
    reason: read.statement,
    nextAction: read.state === 'established'
      ? null
      : read.state === 'conflicting'
        ? 'Confirm the governing frontage from the plat, survey or county GIS measurement. Re-running the same providers returns the same two figures.'
        : attempted
          ? 'Obtain a frontage figure from the plat, survey or county GIS measurement.'
          : null,
  };
}

/** The four site-service probes, derived together because they gate each other. */
function siteServiceProbes(ctx: ReconcileContext): ResearchReadinessProbe[] {
  const reading = ctx.capability('utility-service-screen');
  const facts = reading.facts;
  const capabilityWater = asObject(facts.publicWater);
  const capabilitySewer = asObject(facts.publicSewer);
  const capabilityWell = asObject(facts.wellOutlook);
  const capabilitySeptic = asObject(facts.septicOutlook);

  // The capability result is the stronger source. The retained
  // public-intelligence utilities lane is the fallback for every card whose
  // research predates this capability.
  const retainedScreen = retainedUtilityScreen(ctx.dealCardId);
  const water = capabilityWater
    ? { state: asString(capabilityWater.state) ?? 'not_screened', statement: asString(capabilityWater.statement) ?? '' }
    : readPublicWater(retainedScreen);
  const sewer = capabilitySewer
    ? { state: asString(capabilitySewer.state) ?? 'not_screened', statement: asString(capabilitySewer.statement) ?? '' }
    : readPublicSewer(retainedScreen);

  const soilUnits = retainedSoilUnits(ctx.dealCardId, ctx.propertyCardId);
  const wellContext = loadWellContextScreening(ctx.propertyCardId);
  const well = capabilityWell
    ? { category: asString(capabilityWell.category) ?? 'unknown', statement: asString(capabilityWell.statement) ?? '' }
    : readWellOutlook(readPublicWater(retainedScreen), wellContext);
  const septic = capabilitySeptic
    ? { category: asString(capabilitySeptic.category) ?? 'unknown', statement: asString(capabilitySeptic.statement) ?? '' }
    : readSepticOutlook(readPublicSewer(retainedScreen), soilUnits);

  const at = reading.completedAt ?? retainedScreen?.screenedAt ?? null;
  const screened = water.state !== 'not_screened';

  const service = (itemId: string, read: { state: string; statement: string }, label: string): ResearchReadinessProbe => ({
    itemId,
    attempted: screened,
    technicalSuccess: screened,
    usableEvidence: read.state === 'available',
    // A bounded official check that ran and established nothing is unresolved:
    // it never loops, and the remaining route is the utility authority.
    unresolved: screened,
    lastAttemptAt: at,
    lastSuccessAt: read.state === 'available' ? at : null,
    reason: read.statement,
    nextAction: read.state === 'available'
      ? null
      : screened
        ? `Request written ${label} availability from the serving utility authority. The bounded official screen has already run.`
        : null,
  });

  // An outlook is USABLE when it says something a buyer can act on, including
  // "not needed". It is unresolved when the screen ran and the readily
  // available evidence did not support an outlook - never a retry loop, and
  // never a claim the ground is bad.
  const outlook = (
    itemId: string,
    read: { category: string; statement: string },
    gate: { state: string },
    followUp: string,
  ): ResearchReadinessProbe => {
    const attempted = read.category !== 'unknown' || gate.state !== 'not_screened';
    return {
      itemId,
      attempted,
      technicalSuccess: attempted,
      usableEvidence: read.category === 'not_needed' || read.category === 'favorable'
        || read.category === 'difficult' || read.category === 'poor',
      unresolved: attempted,
      lastAttemptAt: at,
      lastSuccessAt: read.category === 'unknown' ? null : at,
      reason: read.statement,
      nextAction: read.category === 'unknown' || read.category === 'mixed' || read.category === 'moderate'
        ? followUp
        : null,
    };
  };

  return [
    service('public_water', water, 'water'),
    service('public_sewer', sewer, 'sewer'),
    outlook(
      'well_outlook',
      well,
      water,
      'Obtain nearby domestic well records or a local depth range only if a well becomes decision-relevant. LandOS does not search further at the screening stage.',
    ),
    outlook(
      'septic_outlook',
      septic,
      sewer,
      'A perc test or professional soil evaluation remains the confirming evidence. This screen never predicts one passing.',
    ),
  ];
}

function compsAndValuationProbes(ctx: ReconcileContext): ResearchReadinessProbe[] {
  const reading = ctx.capability('comps-valuation');
  const valuation = asObject(reading.facts.valuation);
  const comps = asObject(reading.facts.comps);

  const rows = listComps({ dealCardId: ctx.dealCardId });
  const acceptedSales = rows.filter((row) => row.status === 'verified_sale');
  const collectedSales = rows.filter((row) => row.price_kind === 'sale' || row.price_kind === 'sold');

  // The comp providers a New Lead run drives. Any of them on the canonical
  // record is proof collection was attempted, even with no capability run.
  const compLanes = ['zillow', 'redfin', 'realtor', 'hermes_landportal_comps', 'landportal_comps'];
  const laneRan = compLanes.some((lane) => !!ctx.research?.lanes?.[lane]);
  const latestLaneAt = compLanes
    .map((lane) => ctx.research?.lanes?.[lane]?.latestAttemptAt)
    .filter((stamp): stamp is string => !!stamp)
    .sort()
    .pop() ?? null;

  const acceptedCount = asNumber(comps?.acceptedCount) ?? acceptedSales.length;
  const compsAttempted = !!reading.result || laneRan || rows.length > 0;
  const compsUsable = acceptedCount > 0;

  const priceable = valuation?.priceable === true;
  const valuationUsable = reading.outcome === 'valuation_returned' || priceable;

  return [
    {
      itemId: 'comps_collection',
      attempted: compsAttempted,
      technicalSuccess: reading.result ? reading.succeeded : compsAttempted,
      usableEvidence: compsUsable,
      // Collection that ran correctly and found no acceptable closed sale is
      // unresolved. Running the same search again does not change the market.
      unresolved: reading.outcome !== 'not_available',
      lastAttemptAt: reading.completedAt ?? latestLaneAt,
      lastSuccessAt: compsUsable ? reading.completedAt ?? latestLaneAt : null,
      reason: compsUsable
        ? `${acceptedCount} accepted closed sale(s) retained for this subject.`
        : compsAttempted
          ? `Comparable collection ran and returned no acceptable closed sale${collectedSales.length ? ` (${collectedSales.length} unverified sale row(s) retained)` : ''}.`
          : 'No comparable collection has run for this Deal Card.',
      nextAction: compsUsable
        ? null
        : compsAttempted
          ? 'Widen the search window or accept a comparable manually. Repeating the same search does not change the closed-sale record.'
          : null,
    },
    {
      itemId: 'valuation',
      attempted: compsAttempted,
      technicalSuccess: reading.result ? reading.succeeded : compsAttempted,
      usableEvidence: valuationUsable,
      unresolved: reading.outcome !== 'not_available',
      lastAttemptAt: reading.completedAt ?? latestLaneAt,
      lastSuccessAt: valuationUsable ? reading.completedAt ?? latestLaneAt : null,
      reason: valuationUsable
        ? 'A defensible value basis exists on the retained comparable evidence.'
        : compsAttempted
          ? `Valuation ran and no defensible value basis was established — no closed sale supports a band.${reading.succeeded ? '' : failureNote(reading)}`
          : 'No valuation has run for this Deal Card.',
    },
  ];
}

function marketProbes(ctx: ReconcileContext): ResearchReadinessProbe[] {
  const matrix = asObject(factValue(ctx.research, 'market_matrix') as JsonValue | undefined);
  const pulse = asObject(factValue(ctx.research, 'market_pulse') as JsonValue | undefined);
  const matrixAt = factRetrievedAt(ctx.research, 'market_matrix');
  const pulseAt = factRetrievedAt(ctx.research, 'market_pulse');

  const matrixAvailable = matrix?.available === true;
  const matrixStale = matrix?.isStale === true;
  const growth = asObject(pulse?.growth);
  const pulseUsable = pulse?.eligible === true && asString(growth?.status) === 'measured';

  return [
    {
      itemId: 'market_statistics',
      attempted: !!matrix,
      technicalSuccess: !!matrix,
      usableEvidence: matrixAvailable && !matrixStale,
      unresolved: !!matrix,
      lastAttemptAt: matrixAt,
      lastSuccessAt: matrixAvailable && !matrixStale ? matrixAt : null,
      reason: matrixAvailable && !matrixStale
        ? `Measured market statistics on file: ${asString(matrix?.resolvedKeyLabel) ?? 'area band'} (${asString(matrix?.staleness) ?? 'current'}).`
        : matrix
          ? `Market statistics were read and are ${matrixStale ? 'out of date' : 'unavailable'} for this area and acreage band.`
          : 'No market statistics have been read for this area.',
    },
    {
      itemId: 'area_market_context',
      attempted: !!pulse,
      technicalSuccess: !!pulse,
      usableEvidence: pulseUsable,
      unresolved: !!pulse,
      lastAttemptAt: pulseAt,
      lastSuccessAt: pulseUsable ? pulseAt : null,
      reason: pulseUsable
        ? `Area context measured for ${asString(asObject(pulse?.area)?.descriptor) ?? 'this area'}.`
        : pulse
          ? 'Area market context was read and no measured growth signal was established.'
          : 'No area market context has been read for this property.',
    },
  ];
}

function sellerProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const deal = getDealCard(ctx.dealCardId);
  const people = (deal as { people?: Array<{ role?: string; name?: string }> } | undefined)?.people ?? [];
  const sellers = people.filter((person) => /seller|owner|contact/i.test(String(person.role ?? '')));
  const facts = summarizeSellerFacts(loadSellerStatedFacts(ctx.propertyCardId));
  const usable = sellers.length > 0 || facts.count > 0;
  return {
    itemId: 'seller_information',
    attempted: usable,
    technicalSuccess: usable,
    usableEvidence: usable,
    lastAttemptAt: null,
    lastSuccessAt: null,
    reason: usable
      ? `${sellers.length} seller-side contact(s) linked${facts.count ? ` and ${facts.count} seller-stated fact(s) captured` : ''}.`
      : 'No seller contact or seller-stated fact has been captured yet. This is expected before seller contact.',
  };
}

function isoFromEpoch(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

// ── Entry point ──────────────────────────────────────────────────────────────

export type ResearchReadinessReconcileError =
  | { error: 'deal card not found'; status: 404 }
  | { error: 'this Deal Card has no canonical subject Property Card yet'; status: 409 };

/**
 * Rebuild the manifest for one Deal Card from state that already exists.
 *
 * Read-only by construction: opening or refreshing a Deal Card runs this and
 * nothing else. No capability is invoked, no model is called, no browser opens.
 */
export function reconcileResearchReadiness(
  dealCardId: number,
  now: string = new Date().toISOString(),
): ResearchReadinessManifest | ResearchReadinessReconcileError {
  const deal = getDealCard(dealCardId);
  if (!deal) return { error: 'deal card not found', status: 404 };
  const subject = resolveSubjectPropertyCard(deal);
  if (!subject.cardId || !subject.card) {
    return { error: 'this Deal Card has no canonical subject Property Card yet', status: 409 };
  }

  const store = new CapabilityInvocationStore();
  const readings = new Map<string, CapabilityReading>();
  const ctx: ReconcileContext = {
    dealCardId,
    propertyCardId: subject.cardId,
    card: subject.card,
    research: new PropertyResearchStore().loadForProperty(subject.cardId),
    capability: (capabilityId) => {
      const cached = readings.get(capabilityId);
      if (cached) return cached;
      const reading = readCapability(store, subject.cardId as number, dealCardId, capabilityId);
      readings.set(capabilityId, reading);
      return reading;
    },
  };

  const probes: ResearchReadinessProbe[] = [
    propertyResolutionProbe(ctx),
    landPortalProbe(ctx),
    assessorTaxProbe(ctx),
    officialParcelRecordProbe(ctx),
    ...zoningProbes(ctx),
    developmentHistoryProbe(ctx),
    visualEvidenceProbe(ctx),
    accessProbe(ctx),
    roadFrontageProbe(ctx),
    ...siteServiceProbes(ctx),
    ...compsAndValuationProbes(ctx),
    ...marketProbes(ctx),
    sellerProbe(ctx),
  ];

  return buildResearchReadinessManifest({
    dealCardId,
    propertyCardId: subject.cardId,
    probes,
    now,
  });
}

export function isReconcileError(
  value: ResearchReadinessManifest | ResearchReadinessReconcileError,
): value is ResearchReadinessReconcileError {
  return 'error' in value;
}
