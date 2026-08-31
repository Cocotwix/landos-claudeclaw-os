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
import { isOfficialPropertyVerificationSource, resolveCanonicalSubjectState, unmetPrerequisites } from './canonical-subject-state.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { PropertyResearchStore, type CanonicalPropertyResearchRecord } from './property-research-store.js';
import { loadEligibleCardVisualCapture, loadPropertyInspection } from './property-card.js';
import { sameApn } from './parcel-scope-context.js';
import { listComps } from './comps.js';
import { buildCompsValuationView } from './comps-valuation.js';
import { buildRetainedLandUseIntelligenceView } from './land-use-view.js';
import { getAcquisition } from './acquisitions.js';
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
  loadUtilityAvailabilityRecord,
  loadWellContextScreening,
  retainedSoilUnits,
  retainedUtilityScreen,
} from './utility-service-screen-capability.js';
import {
  projectUtilityAvailability,
  publicServiceReadFromResolution,
} from './utility-availability-record.js';
import type { CapabilityResult, JsonObject, JsonValue } from './capability-contract.js';
import {
  buildResearchReadinessManifest,
  type ResearchReadinessManifest,
  type ResearchReadinessProbe,
} from './research-readiness.js';
import { planJurisdictionKnowledgeForDeal } from './jurisdiction-knowledge.js';
import { resolveCanonicalIdentity } from './canonical-identity.js';
import { formatCountyLabel } from './fact-format.js';

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
  // A measurement retained as a number is the same reading as one retained as
  // a string. Refusing the number made a frontage figure that was on file read
  // as absent purely because of how the lane stored it.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
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

/**
 * Fold the latest property-intelligence snapshot's facts into the canonical
 * research record.
 *
 * A mission lane writes what it established onto the run snapshot, while the
 * canonical research store is populated by the resolution lanes and carries
 * little else. The checklist read only the second, so evidence that genuinely
 * landed — Market Matrix and Market Pulse among it — was reported as never
 * having been read, and the requirement stayed open forever with a capability
 * that had in fact already answered it.
 *
 * The canonical record still wins wherever it holds a key: this only supplies
 * what it never received, so a resolved fact is never overwritten by a run.
 */
function withSnapshotFacts(
  dealCardId: number,
  record: CanonicalPropertyResearchRecord | null,
): CanonicalPropertyResearchRecord | null {
  let snapshotFacts: { key?: unknown; value?: unknown; retrievedAt?: unknown }[] = [];
  try {
    const row = getLandosDb().prepare(
      `SELECT snapshot_json FROM landos_property_intelligence_run
         WHERE deal_card_id = ? AND snapshot_json IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
    ).get(dealCardId) as { snapshot_json?: string } | undefined;
    const parsed = JSON.parse(row?.snapshot_json ?? 'null') as { facts?: unknown } | null;
    snapshotFacts = Array.isArray(parsed?.facts) ? parsed.facts as typeof snapshotFacts : [];
  } catch { snapshotFacts = []; }
  const facts: Record<string, unknown> = { ...(record?.facts ?? {}) };
  for (const fact of snapshotFacts) {
    const key = typeof fact?.key === 'string' ? fact.key : null;
    if (key == null || key === '' || facts[key] !== undefined) continue;
    if (fact.value === undefined || fact.value === null) continue;
    facts[key] = {
      value: fact.value,
      retrievedAt: typeof fact.retrievedAt === 'string' ? fact.retrievedAt : null,
      providerId: 'property_intelligence_run',
    };
  }
  // Retained property evidence is the third place a lane can leave an answer.
  // The provider lanes write normalized facts here rather than onto the run
  // snapshot, so frontage and the land-locked flag were retained, displayed to
  // the operator, and still reported to the checklist as never read.
  try {
    const rows = getLandosDb().prepare(
      `SELECT fact_key, normalized_value_json, retrieved_at FROM landos_property_evidence_item
         WHERE deal_card_id = ? AND fact_key IS NOT NULL
         ORDER BY id DESC`,
    ).all(dealCardId) as { fact_key: string; normalized_value_json: string; retrieved_at: string }[];
    for (const row of rows) {
      const key = row.fact_key?.trim();
      if (!key || facts[key] !== undefined) continue;
      let value: unknown;
      try { value = JSON.parse(row.normalized_value_json ?? 'null'); } catch { continue; }
      if (value === null || value === undefined) continue;
      // A land-locked flag is stored as a boolean and read as a word.
      if (typeof value === 'boolean' && /land\s*lock/i.test(key)) value = value ? 'Yes' : 'No';
      facts[key] = { value, retrievedAt: row.retrieved_at ?? null, providerId: 'property_evidence' };
    }
  } catch { /* the record stands on what it already had */ }

  if (record) return { ...record, facts } as CanonicalPropertyResearchRecord;
  return { facts } as unknown as CanonicalPropertyResearchRecord;
}

function propertyResolutionProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const reading = ctx.capability('property-resolution');
  const verification = String(ctx.card.verification_status ?? '');
  const apn = String(ctx.card.apn ?? '').trim();
  // The checklist asks the same question the rest of the workspace asks, and
  // takes the same answer. It used to read only the subject card's
  // `verified_property` flag, so a Deal Card whose resolution had reached
  // RESOLVED was still listed as "the parcel identity is still
  // unverified_lead" on the very screen that displayed the resolved parcel.
  // The canonical verdict is what establishes the subject; the card flag is
  // the fallback for a Deal Card that predates one.
  const canonicalConfirmed = resolveCanonicalIdentity(ctx.dealCardId).confirmed;
  const verified = canonicalConfirmed || verification.startsWith('verified');
  const attempted = !!reading.result || !!verification;
  const jurisdiction = `${ctx.card.county ? `, ${formatCountyLabel(String(ctx.card.county))}` : ''}${ctx.card.state ? `, ${String(ctx.card.state)}` : ''}`;
  return {
    itemId: 'property_resolution',
    attempted,
    technicalSuccess: reading.result ? reading.succeeded : attempted,
    usableEvidence: verified && !!apn,
    unresolved: true,
    lastAttemptAt: reading.completedAt,
    lastSuccessAt: verified ? reading.completedAt ?? isoFromEpoch(ctx.card.last_refreshed_at) : null,
    reason: verified && apn
      // Naming what is still open keeps the honest gap visible without
      // reporting the established subject as no subject.
      ? `Parcel identity established: APN ${apn}${jurisdiction}.${verification.startsWith('verified') ? '' : ' Official assessor confirmation is still outstanding.'}`
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
  const inspection = loadPropertyInspection(ctx.propertyCardId);
  const checkpoint = inspection?.parcelUrlRecord ?? null;
  const checkpointRetained = checkpoint?.verifiedSubject === true
    && sameApn(checkpoint.apn, ctx.card.apn)
    && String(checkpoint.verifiedCounty ?? '').trim().toLowerCase() === String(ctx.card.county ?? '').trim().toLowerCase()
    && String(checkpoint.verifiedState ?? '').trim().toUpperCase() === String(ctx.card.state ?? '').trim().toUpperCase();
  const attempted = !!reading.result || laneRan;
  // "record_returned" is the capability's own usable outcome; a retained
  // LandPortal id plus a verified subject lane is the same fact for a card
  // whose research predates the capability.
  const usable = reading.outcome === 'record_returned' || (!!lpId && laneRetained) || checkpointRetained;
  return {
    itemId: 'landportal_research',
    attempted,
    technicalSuccess: reading.result ? reading.succeeded : laneRan,
    usableEvidence: usable,
    unresolved: true,
    lastAttemptAt: reading.completedAt ?? lane?.latestAttemptAt ?? null,
    lastSuccessAt: usable ? reading.completedAt ?? lane?.retainedAt ?? checkpoint?.capturedAt ?? null : null,
    reason: usable
      ? `LandPortal parcel record retained${lpId ? ` (property ${lpId})` : checkpointRetained ? ' (authenticated exact-subject checkpoint)' : ''}.`
      : attempted
        ? `The LandPortal lane ran and no parcel record was retained.${failureNote(reading)}`
        : 'LandPortal Research has not run for this parcel.',
  };
}

function assessorTaxProbe(ctx: ReconcileContext): ResearchReadinessProbe {
  const reading = ctx.capability('assessor-tax');
  const recordStatus = asString(reading.facts.recordStatus);
  // The bounded recovery specialist admits only exact-subject facts through
  // the shared evidence boundary. Read that durable output directly so a
  // deterministic miss followed by a successful recovery actually replans the
  // checklist instead of leaving Assessor & Tax red forever.
  let recovery: { count: number; latest: string | null; official: boolean; source: string | null } = {
    count: 0, latest: null, official: false, source: null,
  };
  try {
    const row = getLandosDb().prepare(`
      SELECT count(*) AS count, max(retrieved_at) AS latest,
             max(CASE WHEN source_tier='official_government_source' THEN 1 ELSE 0 END) AS official,
             max(source_name) AS source
        FROM landos_property_evidence_item
       WHERE deal_card_id=? AND domain='public_records'
         AND originating_capability='landos-public-records-recovery'
    `).get(ctx.dealCardId) as { count?: number; latest?: string | null; official?: number; source?: string | null } | undefined;
    recovery = {
      count: Number(row?.count ?? 0), latest: row?.latest ?? null,
      official: Number(row?.official ?? 0) > 0, source: row?.source ?? null,
    };
  } catch { /* capability result remains the source when no evidence table is available */ }
  const recovered = recovery.count > 0;
  const usable = recordStatus === 'official_record_retrieved' || recordStatus === 'retained_record_only' || recovered;
  // Retained LandPortal figures are NOT an assessor record. They are named here
  // so the operator can see the gap is about provenance, not about numbers.
  const retainedAssessed = factText(ctx.research, 'assessed_value');
  const retainedTax = factText(ctx.research, 'Tax Amount');
  return {
    itemId: 'assessor_tax',
    attempted: !!reading.result || recovered,
    technicalSuccess: reading.succeeded || recovered,
    usableEvidence: usable,
    unresolved: recordStatus === 'not_retrieved',
    lastAttemptAt: reading.completedAt,
    lastSuccessAt: usable ? reading.completedAt ?? recovery.latest : null,
    reason: usable
      ? recovered
        ? `Public-record recovery returned ${recovery.count} exact-subject fact${recovery.count === 1 ? '' : 's'}${recovery.source ? ` from ${recovery.source}` : ''}${recovery.official ? ' on an official government source' : ''}.`
        : `Assessor & Tax returned a ${recordStatus === 'official_record_retrieved' ? 'live official' : 'retained'} record.`
      : reading.result
        ? `Assessor & Tax ran and no assessor or tax record was retrieved.${failureNote(reading)}`
        : `No Assessor & Tax run is on record.${retainedAssessed || retainedTax
          ? ` The retained LandPortal record carries${retainedAssessed ? ` an assessed value of ${retainedAssessed}` : ''}${retainedAssessed && retainedTax ? ' and' : ''}${retainedTax ? ` an annual tax of ${retainedTax}` : ''}, which is not an assessor record.`
          : ''}`,
  };
}

/** Acreage below which a parcel has no realistic land-division thesis. Two
 *  rural homesites need roughly this much before a split is worth researching;
 *  below it the ordinance answers a question the deal is not asking. */
const SUBDIVISION_MIN_ACRES = 4;

/**
 * Whether this subject is large enough for land division to be worth
 * researching. Unknown acreage keeps the lane live: silence is not a reason to
 * skip work.
 */
function subdivisionAcresPlausible(ctx: ReconcileContext): boolean {
  const row = getLandosDb().prepare(`
    SELECT acreage FROM landos_property_identity_version
    WHERE deal_card_id = ? AND is_current = 1
    ORDER BY id DESC LIMIT 1
  `).get(ctx.dealCardId) as { acreage?: number | null } | undefined;
  const acres = typeof row?.acreage === 'number' ? row.acreage : null;
  if (acres == null || !Number.isFinite(acres) || acres <= 0) return true;
  return acres >= SUBDIVISION_MIN_ACRES;
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
  //
  // What that record calls itself varies by state, so matching on a list of
  // words was always going to miss one: Florida's statewide cadastral layer
  // says "property-appraiser" and "Cadastral" and names no county, so a parcel
  // confirmed against an official state GIS layer reported that no official
  // record had ever been retrieved. The identity version already states how the
  // subject was established, and that basis is the authority here.
  const source = String(ctx.card.verification_source ?? '');
  const identityBasis = (() => {
    try {
      const row = getLandosDb().prepare(
        `SELECT basis FROM landos_property_identity_version
           WHERE deal_card_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1`,
      ).get(ctx.dealCardId) as { basis?: string } | undefined;
      return String(row?.basis ?? '');
    } catch { return ''; }
  })();
  // A provider result may mention a county, GIS attempts, or public records in
  // its narrative without itself being an official record.  Keep the test
  // intentionally authority-specific so operational subject resolution does
  // not silently become assessor verification in the readiness checklist.
  const officialSource = isOfficialPropertyVerificationSource(source)
    || isOfficialPropertyVerificationSource(identityBasis);
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
      ? `Official government parcel record on file: ${source || identityBasis || String(row?.platform_family ?? 'county GIS')}.`
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
  const currentLandUse = buildRetainedLandUseIntelligenceView(ctx.dealCardId);
  const currentZoning = currentLandUse?.currentZoning ?? null;

  const zoningRan = !!reading.result || !!determination || currentZoning?.established === true;
  const zoningAt = reading.completedAt ?? determination?.determined_at ?? null;
  const zoningEstablished = currentZoning?.established === true || zoning?.established === true
    || (!reading.result && !!determination?.zoning_code);
  const districtCode = currentZoning?.districtCode ?? asString(zoning?.districtCode) ?? (determination?.zoning_code || null);
  const zoningStatement = currentZoning?.statement ?? asString(zoning?.statement);

  const ruleCount = asNumber(rules?.count) ?? 0;
  const documentCount = asNumber(rules?.documentCount) ?? 0;
  const byRightStatus = asString(byRight?.statusLabel);
  const rulesUsable = ruleCount > 0;
  const knowledgePlan = planJurisdictionKnowledgeForDeal(ctx.dealCardId);

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
      // A research capability existing is not a reason to run it on every
      // parcel. Land division needs a parcel with something to divide: on a
      // small rural homesite there is no split to test, so the ordinance is not
      // missing evidence, it is evidence nobody needs. Marking it inapplicable
      // closes it honestly instead of parking it at BLOCKED where it holds up
      // valuation and strategy for a question this deal never asks.
      //
      // Acreage alone decides: rules already retained turn the item green
      // through usableEvidence before applicability is consulted, so naming
      // them here would only keep a lane alive that has nothing left to ask.
      // The capability itself is untouched and still runs wherever a
      // subdivision thesis is credible.
      applicable: subdivisionAcresPlausible(ctx),
      attempted: knowledgePlan ? knowledgePlan.counts.expected > 0 : zoningRan,
      technicalSuccess: knowledgePlan ? true : reading.result ? reading.succeeded : zoningRan,
      usableEvidence: knowledgePlan
        ? knowledgePlan.counts.reuse === knowledgePlan.counts.expected
        : rulesUsable,
      unresolved: knowledgePlan
        ? knowledgePlan.counts.blockedConflict > 0
        : reading.outcome !== 'not_available',
      lastAttemptAt: zoningAt,
      lastSuccessAt: knowledgePlan?.counts.reuse === knowledgePlan?.counts.expected
        ? zoningAt
        : rulesUsable ? zoningAt : null,
      reason: knowledgePlan
        ? `${knowledgePlan.counts.reuse} jurisdiction subject(s) reusable; ${knowledgePlan.counts.refresh} stale; ${knowledgePlan.counts.researchNew} missing; ${knowledgePlan.counts.blockedConflict} blocked by conflict/unresolved knowledge.`
        : rulesUsable
        ? `${ruleCount} jurisdiction rule(s) retained from ${documentCount} official document(s).${byRightStatus ? ` By-right result: ${byRightStatus}.` : ''}`
        : zoningRan
          ? 'The subdivision lane ran and retained no jurisdiction rules.'
          : 'Zoning & Subdivision has not run for this parcel.',
      knowledgePlan: knowledgePlan?.counts ?? null,
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
  const inspectionAssets = (loadPropertyInspection(ctx.propertyCardId)?.assets ?? [])
    .filter((asset) => asset.validation?.status === 'accepted' && !!asset.storedPath);
  const services = [...new Set([...Object.keys(assets), ...inspectionAssets.map((asset) => asset.kind || asset.key)])];
  const parcelGrade = services.filter((service) => PARCEL_GRADE_VISUAL_SERVICES.some((kind) => service.includes(kind)))
    .concat(inspectionAssets.map((asset) => asset.key));
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
      ? `${services.length} parcel-associated visual source(s) retained (${parcelGrade.slice(0, 6).join(', ')}${parcelGrade.length > 6 ? ', …' : ''}).`
      : services.length > 0
        ? `Only fallback imagery is retained (${services.join(', ')}); no parcel-grade capture is on file.`
        : 'No parcel-associated visuals have been captured.',
    nextAction: parcelGrade.length > 0
      ? null
      : 'Capture parcel-grade imagery from the visual capture control on Property & Market.',
  };
}

/** The retained keys each provider writes the same access fact under. */
const LANDLOCKED_FACT_KEYS = ['landlocked_status', 'Land Locked', 'LandPortal land locked flag'];
const FRONTAGE_FACT_KEYS = ['road_frontage_ft', 'Road Frontage', 'LandPortal road frontage'];

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
    partial: read.state === 'conflicting' || read.state === 'approximate',
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

  // Three sources can answer "does this parcel have public water", and they are
  // ranked here rather than left to whichever ran last. The utility availability
  // research is the most precise, so where it exists it decides — reconciled at
  // READ time, with every stored row untouched. The capability result is next,
  // and the retained public-intelligence utilities lane is the fallback for
  // every card whose research predates both.
  const retainedScreen = retainedUtilityScreen(ctx.dealCardId);
  const availabilityRecord = ctx.propertyCardId ? loadUtilityAvailabilityRecord(ctx.propertyCardId) : null;
  const availability = availabilityRecord
    ? projectUtilityAvailability(availabilityRecord, {
      address: null, apn: null, county: null, state: null, acres: null,
    })
    : null;
  const water = availability
    ? publicServiceReadFromResolution(availability.water)
    : capabilityWater
      ? { state: asString(capabilityWater.state) ?? 'not_screened', statement: asString(capabilityWater.statement) ?? '' }
      : readPublicWater(retainedScreen);
  const sewer = availability
    ? publicServiceReadFromResolution(availability.sewer)
    : capabilitySewer
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

  const at = availability?.researchedAt ?? reading.completedAt ?? retainedScreen?.screenedAt ?? null;
  const screened = water.state !== 'not_screened';

  const service = (itemId: string, read: { state: string; statement: string }, label: string): ResearchReadinessProbe => ({
    itemId,
    attempted: screened,
    technicalSuccess: screened,
    usableEvidence: read.state === 'available',
    // A bounded official check that ran and established nothing is unresolved:
    // it never loops, and the remaining route is the utility authority.
    unresolved: screened,
    partial: screened && read.state !== 'available' && read.state !== 'not_screened',
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
      partial: attempted && (read.category === 'mixed' || read.category === 'moderate'),
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
  const acceptedSales = rows.filter((row) => row.valuation_selected === 1 || row.status === 'verified_sale');
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

  const currentView = buildCompsValuationView(ctx.dealCardId);
  const acceptedCount = currentView?.summary.acceptedCount ?? acceptedSales.length ?? asNumber(comps?.acceptedCount) ?? 0;
  const compsAttempted = !!reading.result || laneRan || rows.length > 0;
  const compsUsable = acceptedCount > 0;

  const priceable = currentView?.summary.status === 'supported' || currentView?.summary.fmv?.central != null || valuation?.priceable === true;
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


/**
 * The structured result a mission child handed back, for the latest mission on
 * this Deal.
 *
 * A child lane's handback is the authoritative record of what that lane
 * established. The run snapshot carries the operator-facing summary of the same
 * work — a sentence, not a measurement — so a probe that needs the measurement
 * has to read the handback. Reading the summary instead made a lane that had
 * genuinely returned look like it had never run.
 */
function latestMissionChildResult(dealCardId: number, childKey: string): Record<string, unknown> | null {
  try {
    const row = getLandosDb().prepare(
      `SELECT c.result_json FROM landos_mission_child c
         JOIN landos_mission m ON m.mission_id = c.mission_id
        WHERE m.scope_id = ? AND c.child_key = ? AND c.result_json IS NOT NULL
        ORDER BY m.id DESC, c.id DESC LIMIT 1`,
    ).get(dealCardId, childKey) as { result_json?: string } | undefined;
    const parsed = JSON.parse(row?.result_json ?? 'null') as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function marketProbes(ctx: ReconcileContext): ResearchReadinessProbe[] {
  // The market lane hands back the measured Matrix and Pulse; the run snapshot
  // keeps only their summary sentence. Prefer the handback so a lane that
  // returned is not reported as unread.
  const handback = latestMissionChildResult(ctx.dealCardId, 'market_intelligence');
  const matrix = asObject(handback?.marketMatrix as JsonValue | undefined)
    ?? asObject(factValue(ctx.research, 'market_matrix') as JsonValue | undefined);
  const pulse = asObject(handback?.marketPulse as JsonValue | undefined)
    ?? asObject(factValue(ctx.research, 'market_pulse') as JsonValue | undefined);
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
  const acquisition = getAcquisition(ctx.dealCardId);
  const facts = summarizeSellerFacts(loadSellerStatedFacts(ctx.propertyCardId));
  const communicationCount = acquisition.commLog.length + acquisition.discovery.length;
  const usable = communicationCount > 0 || facts.count > 0;
  return {
    itemId: 'seller_information',
    attempted: usable,
    technicalSuccess: usable,
    usableEvidence: usable,
    applicable: usable,
    lastAttemptAt: null,
    lastSuccessAt: null,
    reason: usable
      ? `${communicationCount} seller communication/discovery record(s)${facts.count ? ` and ${facts.count} seller-stated fact(s)` : ''} captured.`
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
    research: withSnapshotFacts(dealCardId, new PropertyResearchStore().loadForProperty(subject.cardId)),
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

  // Per-item prerequisite planning: each item is evaluated against the shared
  // canonical subject state, so a missing exact parcel never invalidates
  // county/ZIP market items or seller items that do not need one.
  const subjectState = resolveCanonicalSubjectState(dealCardId);
  return buildResearchReadinessManifest({
    dealCardId,
    propertyCardId: subject.cardId,
    probes,
    now,
    unmetPrerequisitesFor: (clauses) => unmetPrerequisites(subjectState, clauses),
  });
}

export function isReconcileError(
  value: ResearchReadinessManifest | ResearchReadinessReconcileError,
): value is ResearchReadinessReconcileError {
  return 'error' in value;
}
