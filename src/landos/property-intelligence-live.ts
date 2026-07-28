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

import { currentComparables, getPropertyCard, loadPropertyInspection } from './property-card.js';
import { getDealCard } from './deal-card.js';
import { PublicIntelligenceStore } from './public-intelligence-store.js';
import { buildOperatorPropertyRecord, type OperatorPropertyRecord } from './operator-property-record.js';
import { readGovernmentRecordsForDeal, synchronizeGovernmentRecordsForDeal } from './government-records-legacy-adapter.js';
import { readZoningLandUseForDeal, synchronizeZoningLandUseForDeal } from './zoning-legacy-adapter.js';
import { parseLandPortalCompRows } from './comp-extraction.js';
import { documentRegistryForCard } from './deal-card-canonical.js';
import { listComps } from './comps.js';
import { getLandosDb } from './db.js';
import { distinctApnIdentities, type SnapshotDueDiligenceItem, type SnapshotEvidenceItem, type SnapshotFact, type SnapshotIdentity } from './property-intelligence-snapshot.js';
import { officialParcelSourceCoverage } from './public-property-intelligence-live.js';
import { reconcileDiscoveryIdentity } from './discovery-identity.js';
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
import type { CompRegistryCandidate } from './comp-registry.js';

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
  distanceMiles?: number | null;
  lat?: number | null;
  lng?: number | null;
}

export interface LandMarketplaceResult {
  status: string;
  sold: LandMarketplaceComp[];
  active: LandMarketplaceComp[];
  note?: string | null;
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
  }) => Promise<{ ok: boolean; note: string; comparableCount: number }>;
  now?: () => string;
}

const str = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return text.length ? text : null;
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function subjectCardId(deal: unknown): number | null {
  const cards = (deal as { propertyCards?: Array<{ id?: unknown }> } | null)?.propertyCards ?? [];
  const id = Number(cards[0]?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── Parcel identity ─────────────────────────────────────────────────────────

export async function collectParcelIdentity(
  ctx: MissionContext,
  deps: LiveCollectorDeps,
): Promise<SpecialistOutcome<IdentityContribution>> {
  const now = deps.now ?? (() => new Date().toISOString());
  const initialDeal = getDealCard(ctx.dealCardId);
  if (!initialDeal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const initialProperty = (initialDeal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
  const initialCardId = subjectCardId(initialDeal);
  let inspectionNote = '';

  // Capture the parcel-level LandPortal subject before reconciliation. This
  // makes its APN, jurisdiction, owner, acreage and visuals first-class
  // discovery evidence instead of leaving them stranded in the comp lane.
  if (initialCardId && deps.captureLandPortalInspection) {
    try {
      const capture = await deps.captureLandPortalInspection({
        cardId: initialCardId,
        searchKey: {
          address: str(initialProperty.active_input_address) ?? str(initialProperty.address),
          apn: str(initialProperty.apn),
          county: str(initialProperty.county),
          state: str(initialProperty.state),
          city: str(initialProperty.city),
          owner: str(initialProperty.owner),
        },
      });
      if (!capture.ok) inspectionNote = ` LandPortal subject capture was limited (${capture.note}).`;
    } catch (error) {
      inspectionNote = ` LandPortal subject capture errored (${(error as Error)?.message ?? String(error)}).`;
    }
  }

  // Run the canonical public lane first so the persisted evidence this
  // specialist reads is current. A provider failure here is not fatal: the
  // already-persisted identity still answers.
  let liveNote = '';
  try {
    const result = await deps.runPublicIntelligence(ctx.dealCardId);
    if (!result.ok) liveNote = ` Live parcel lookup did not confirm a new match (${result.error ?? 'no match'}).`;
  } catch (error) {
    liveNote = ` Live parcel lookup errored (${(error as Error)?.message ?? String(error)}); the persisted identity is used.`;
  }

  const deal = getDealCard(ctx.dealCardId);
  if (!deal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const cardId = subjectCardId(deal);
  const card = cardId ? getPropertyCard(cardId) : null;
  const property = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
  const inspection = cardId ? loadPropertyInspection(cardId) : null;

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
    },
    landPortal: inspection ? {
      parcelUrl: inspection.parcelUrl,
      parcelFacts: inspection.parcelFacts,
      assetCount: inspection.assets.length,
      sourceLabel: 'LandPortal authenticated parcel panel',
      sourceNote: inspection.sources.find((item) => item.provider === 'LandPortal')?.note ?? null,
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

  const record = buildOperatorPropertyRecord(run, {
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
      ? `Confirmed against the official parcel record (${str(property.verification_source) ?? 'official parcel source'}).${liveNote}`
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
        ? 'Parcel-level LandPortal subject evidence retained for discovery; not a deed, survey, title commitment, or official assessor confirmation.'
        : null,
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

  for (const artifact of model.artifacts.slice(0, 40)) {
    const view = artifact as unknown as Record<string, unknown>;
    evidence.push({
      id: `gov-artifact-${String(view.id)}`,
      kind: 'document',
      label: str(view.displayName) ?? str(view.kind) ?? 'Recorded document',
      sourceType: 'official_county_state',
      sourceUrl: str(view.sourceUrl),
      viewUrl: `/api/landos/deal-cards/${ctx.dealCardId}/government-records/artifacts/${String(view.id)}/page/1`,
      retrievedAt: str(view.retrievedAt) ?? now,
      confidence: 'high',
      supports: 'government_records',
      sha256: str(view.sha256),
      bytes: typeof view.bytes === 'number' ? view.bytes : null,
    });
  }

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

  const items: SnapshotDueDiligenceItem[] = [{
    key: 'zoning',
    label: 'Zoning',
    verdict: officiallyConfirmed ? 'good' : analysis.baseZoning.conflicts.length ? 'risk' : district ? 'caution' : 'unknown',
    headline: district
      ? `${district} (${analysis.baseZoning.status.replace(/_/g, ' ')})`
      : 'Zoning district has not been established.',
    grade: officiallyConfirmed ? 'confirmed_fact' : district ? 'likely_indication' : 'unresolved_question',
    detail: analysis.jurisdiction.basis || null,
    sourceUrl: null,
    missing: [
      ...(officiallyConfirmed ? [] : ['The zoning district has not been confirmed on the official zoning map.']),
      ...analysis.baseZoning.conflicts,
      ...(model.snapshot.completeness.missing ?? []).map((key) => `${key.replace(/_/g, ' ')} has not been retrieved from an official source.`),
    ],
  }];

  const facts: SnapshotFact[] = [];
  if (analysis.jurisdiction.controllingAuthorityName) {
    facts.push({
      key: 'jurisdiction', label: 'Controlling jurisdiction',
      value: `${analysis.jurisdiction.controllingAuthorityName} (${analysis.jurisdiction.controllingAuthorityLevel})`,
      grade: analysis.jurisdiction.determination === 'confirmed' ? 'confirmed_fact' : 'likely_indication',
      source: 'Official jurisdiction boundary evidence', sourceUrl: null, retrievedAt: now,
      note: analysis.jurisdiction.mailingCityDiffersFromAuthority ? 'The mailing city differs from the controlling authority.' : null,
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
  const property = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
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
  const deal = getDealCard(ctx.dealCardId);
  const cardId = deal ? subjectCardId(deal) : null;
  const inspection = cardId ? loadPropertyInspection(cardId) : null;
  const lpFacts = inspection?.parcelFacts ?? {};
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
  const frontage = str(inspection?.parcelFacts?.['Road Frontage']);
  const landLocked = str(inspection?.parcelFacts?.['Land Locked']);
  if (frontage || landLocked) {
    const indication: SnapshotDueDiligenceItem = {
      key: 'access',
      label: 'Road frontage and apparent access',
      verdict: 'caution',
      headline: [
        frontage ? `${frontage} frontage shown` : null,
        landLocked ? `landlocked flag: ${landLocked}` : null,
      ].filter(Boolean).join('; '),
      grade: 'likely_indication',
      detail: 'LandPortal parcel-panel indication only. Legal access still requires recorded-instrument review.',
      sourceUrl: inspection?.parcelUrl ?? null,
      missing: ['Recorded legal access has not been established.'],
    };
    const accessIndex = items.findIndex((item) => item.key === 'access');
    if (accessIndex < 0) items.push(indication);
    else if (items[accessIndex].verdict === 'unknown') items[accessIndex] = indication;
  }
  const utilitiesCard = record.decisionCards.find((card) => card.key === 'utilities');

  // Legal access is a recorded-instrument question. Mapped road contact is
  // proximity evidence only and is labelled as such, never as legal access.
  const accessItem = items.find((item) => item.key === 'access');
  if (accessItem) {
    accessItem.missing = [
      ...accessItem.missing,
      ...record.accessStatus.unresolved,
      'Legal access is established by a recorded instrument, not by mapped road proximity.',
    ];
  }

  return {
    status: items.length === 0 ? 'blocked' : items.some((item) => item.verdict === 'unknown') ? 'partial' : 'completed',
    summary: `${frontage || landLocked ? 'The live LandPortal parcel collector supplied frontage/access indications; legal access remains unverified. ' : ''}${record.accessStatus.summary}${utilitiesCard ? ` Utilities: ${utilitiesCard.headline}` : ' Utility availability was not established.'} ${execution.summary}`,
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
    acres: row.acres ?? null,
    pricePerAcre: row.pricePerAcre ?? null,
    sourceUrl: row.url ?? null,
    distanceMiles: row.distanceMiles ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    compClass: 'vacant_land',
  } as CompRegistryCandidate));
  return [...map(result.sold ?? [], 'sold'), ...map(result.active ?? [], 'active')];
}

export async function collectComparables(
  ctx: MissionContext,
  deps: LiveCollectorDeps,
): Promise<SpecialistOutcome<ComparablesContribution>> {
  const deal = getDealCard(ctx.dealCardId);
  if (!deal) throw new Error(`Deal Card ${ctx.dealCardId} no longer exists.`);
  const cardId = subjectCardId(deal);
  const property = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
  const state = ctx.identity?.identity.state_ ?? str(property.state);
  const subjectAcres = ctx.identity?.subjectAcres ?? num(property.acres);

  const notes: string[] = [];
  const candidates: CompRegistryCandidate[] = [];

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
  if (cardId && usableRows === 0 && deps.captureLandPortalInspection) {
    try {
      landPortalCapture = await deps.captureLandPortalInspection({
        cardId,
        searchKey: {
          address: str(property.active_input_address) ?? str(property.address),
          apn: ctx.identity?.identity.apn ?? str(property.apn),
          county: ctx.identity?.identity.county ?? str(property.county),
          state,
          city: str(property.city),
          owner: str(property.owner),
        },
      });
      inspection = loadPropertyInspection(cardId);
    } catch (error) {
      landPortalCapture = { ok: false, note: `LandPortal parcel read errored: ${(error as Error)?.message ?? String(error)}.`, comparableCount: 0 };
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
    const improvement = str(record.improvement) ?? 'unknown';
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

  const [zillow, redfin] = await Promise.all([
    deps.captureZillowComps ? deps.captureZillowComps(marketInput).catch((error) => {
      notes.push(`Zillow supplement unavailable: ${(error as Error)?.message ?? String(error)}.`);
      return null;
    }) : Promise.resolve(null),
    deps.captureRedfinComps ? deps.captureRedfinComps(marketInput).catch((error) => {
      notes.push(`Redfin supplement unavailable: ${(error as Error)?.message ?? String(error)}.`);
      return null;
    }) : Promise.resolve(null),
  ]);
  candidates.push(...marketplaceCandidates(zillow, 'Zillow', state));
  candidates.push(...marketplaceCandidates(redfin, 'Redfin', state));
  if (zillow) notes.push(`Zillow: ${zillow.status} (${(zillow.sold?.length ?? 0)} sold, ${(zillow.active?.length ?? 0)} active).`);
  if (redfin) notes.push(`Redfin: ${redfin.status} (${(redfin.sold?.length ?? 0)} sold, ${(redfin.active?.length ?? 0)} active).`);

  // ── Persisted rows already accepted onto this card ───────────────────────
  // Historical rows remain intact in SQLite, but only the three currently
  // approved marketplaces enter this mission handback. Disabled aggregators
  // and county-sale rows therefore cannot execute, count, map, render, or value
  // the subject while their stored history remains available for audit.
  const persisted = listComps({ dealCardId: ctx.dealCardId }).filter((row) => {
    const source = `${row.canonical_source ?? ''} ${row.source_label ?? ''}`;
    if (/home\s*harvest|homeharvest|realtor|realie|really\.?ai/i.test(source)) return false;
    return /landportal|zillow|redfin/i.test(source);
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
      compClass: row.property_class || null,
      persistedStatus: row.status || null,
    } as CompRegistryCandidate);
  }
  if (persisted.length) notes.push(`${persisted.length} previously persisted comp row(s) re-screened against the current policy.`);

  const anySource = landPortalRecords.length > 0 || !!zillow || !!redfin || persisted.length > 0;
  return {
    status: candidates.length === 0 ? 'partial' : anySource ? 'completed' : 'partial',
    summary: notes.join(' '),
    data: { candidates, duplicatesMerged: 0 },
  };
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
  const context = await deps.captureMarketContext(ctx.dealCardId);
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
    const view = asset as unknown as Record<string, unknown>;
    const key = str(view.key);
    evidence.push({
      id: `visual-${key ?? evidence.length}`,
      kind: 'screenshot',
      label: str(view.label) ?? key ?? 'Retained parcel screenshot',
      sourceType: str(view.source) ?? 'landportal',
      sourceUrl: str(view.sourceUrl) ?? inspection?.parcelUrl ?? null,
      // Served through the existing token-gated inspection image route; the
      // stored disk path never leaves the server.
      viewUrl: key && cardId ? `/api/landos/inspection/image?cardId=${cardId}&key=${encodeURIComponent(key)}` : null,
      retrievedAt: str(view.capturedAt) ?? now,
      confidence: 'high',
      supports: 'visual_evidence',
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
  return {
    parcel_identity: (ctx) => collectParcelIdentity(ctx, deps),
    government_records: (ctx) => collectGovernmentRecords(ctx),
    zoning_land_use: (ctx) => collectZoningLandUse(ctx),
    environmental_terrain: (ctx) => collectEnvironmentalTerrain(ctx),
    access_utilities: (ctx) => collectAccessUtilities(ctx),
    comparables: (ctx) => collectComparables(ctx, deps),
    market_intelligence: (ctx) => collectMarketIntelligence(ctx, deps),
    evidence_visuals: (ctx) => collectEvidenceVisuals(ctx),
  };
}
