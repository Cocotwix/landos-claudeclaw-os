// LandOS — bounded official-acreage / parcel-extent reconciliation run.
//
// The one governed action that gathers the acreage evidence set for a deal's
// canonical subject and persists the deterministic reconciliation:
//
//   1. REUSE the latest retained assessor-tax capability result (the current
//      official record). This run never launches a new assessor capability.
//   2. ONE county GIS parcel-layer query (acreage attribute + polygon-
//      calculated area + owner attribute — the GIS depiction, with its vintage
//      judged against the official record).
//   3. ONE current assessment-database parcel-family search with at most three
//      sibling detail reads — the single permitted escalation, used to explain
//      a split/assemblage. No recorder search, no title chain.
//   4. Retained provider and historical figures from evidence LandOS already
//      holds (the LandPortal characteristics capability result and superseded
//      property-identity versions).
//
// The pure engine in acreage-extent-reconciliation.ts decides. Persistence:
// evidence rows + ONE derived snapshot (acreage_extent_v1); when the decision
// adopts a changed canonical acreage the property card and identity version
// are updated with an audit trail, prior values retained, and the
// acreage-dependent derived products are marked stale in the record — never
// rerun from here.
//
// Triggered ONLY by an explicit operator POST. Page loads read the snapshot.

import {
  ACREAGE_DEPENDENT_PRODUCTS,
  reconcileAcreageExtent,
  type AcreageExtentDecision,
  type AcreageExtentInput,
  type GisDepictionRecord,
  type SiblingParcelRecord,
} from './acreage-extent-reconciliation.js';
import {
  searchWilliamsonParcelFamily,
  williamsonParcelIdMatchesApn,
  WILLIAMSON_ASSESSOR_SOURCE,
} from './county-assessor-search.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { appendDerivedEvidence, readDerivedSnapshot, readDerivedSnapshotHistory, writeDerivedSnapshot, type DerivedEvidenceInput } from './derived-intelligence-store.js';
import { getLandosDb, landosAudit } from './db.js';
import { createPropertyIdentityVersion, readCurrentPropertyIdentity } from './property-summary-slice.js';
import { readResolverSubject, type ResolverSubject } from './universal-property-resolution.js';

export const ACREAGE_EXTENT_SNAPSHOT_TYPE = 'acreage_extent_v1';
export const ACREAGE_EXTENT_VERSION = '1.0.0';

// Williamson County, TN publishes its parcel fabric on the county's own
// ArcGIS server (the county is absent from the TN statewide public layer).
// Same per-county-constant pattern as WILLIAMSON_BASE in
// county-assessor-search.ts. Field semantics: `AC` is the acreage ATTRIBUTE
// the county carries on the layer; `CALC_ACRE` is the polygon-calculated area.
// Plain HTTP: the county's ArcGIS host presents an invalid TLS certificate,
// and this is a public read-only layer queried with no credentials attached.
export const WILLIAMSON_GIS_PARCEL_LAYER =
  'http://arcgis2.williamsoncounty-tn.gov/arcgis/rest/services/IDT/DataPull/MapServer/4';
export const WILLIAMSON_GIS_SOURCE = 'Williamson County GIS parcel layer (arcgis2.williamsoncounty-tn.gov IDT/DataPull layer 4)';

export interface AcreageExtentRunRecord {
  contractVersion: string;
  dealCardId: number;
  propertyCardId: number | null;
  subjectApn: string;
  trigger: 'operator_reconcile';
  startedAt: string;
  completedAt: string;
  /** Every explicit external read this run performed, for the rerun audit. */
  actions: Array<{ action: string; source: string; sourceUrl: string | null; outcome: string }>;
  decision: AcreageExtentDecision;
  adoption: {
    adopted: boolean;
    previousAcres: number | null;
    newAcres: number | null;
    identityVersionId: number | null;
    note: string;
  };
  /** When the stale markers were raised (the adoption moment). They persist
   *  across later reconciliation runs — a re-run that changes nothing must not
   *  silently clear them while dependent products still rest on the old
   *  acreage; only recomputing those products retires the marker. */
  staleSince: string | null;
  refusalReason: string | null;
}

interface WilliamsonGisFeature {
  attributes: Record<string, unknown>;
}

/**
 * ONE query against the county parcel layer for the subject APN. Verifies the
 * returned GIS parcel identifier names the canonical APN (map + parcel digit
 * tokens) before returning anything.
 */
export async function queryWilliamsonGisParcel(
  apn: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GisDepictionRecord | null> {
  const digits = apn.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const controlMap = digits.slice(0, 3);
  const parcelFive = digits.slice(3, 8);
  const where = `GISLINK LIKE '${controlMap}%${parcelFive}'`;
  const url = `${WILLIAMSON_GIS_PARCEL_LAYER}/query?where=${encodeURIComponent(where)}`
    + `&outFields=${encodeURIComponent('GISLINK,parcel_id,ADDRESS,owner1,owner2,AC,ACc,CALC_ACRE,deed_book,deed_page')}`
    + '&returnGeometry=false&f=json';
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from the county GIS parcel layer`);
  const parsed = await response.json() as { features?: WilliamsonGisFeature[]; error?: { message?: string } };
  if (parsed.error) throw new Error(parsed.error.message || 'county GIS query error');
  const features = (parsed.features ?? []).filter((f) => {
    const link = String(f.attributes?.GISLINK ?? '');
    const tokens = link.trim().toUpperCase().split(/\s+/).filter(Boolean);
    return tokens[0] === controlMap && (tokens[1] ?? '').padStart(5, '0') === parcelFive;
  });
  if (!features.length) return null;
  const attrs = features[0].attributes;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null;
  };
  return {
    reportedAcres: num(attrs.AC),
    calculatedAcres: num(attrs.CALC_ACRE),
    owner: String(attrs.owner1 ?? '').trim() || null,
    gisParcelId: String(attrs.GISLINK ?? '').trim() || null,
    source: WILLIAMSON_GIS_SOURCE,
    sourceUrl: WILLIAMSON_GIS_PARCEL_LAYER,
    retrievedAt: new Date().toISOString(),
    featureCount: features.length,
  };
}

interface AssessorFactsShape {
  recordStatus?: string;
  assessor?: {
    ownerOfRecord?: string | null;
    apn?: string | null;
    assessedAcres?: number | null;
    situsAddress?: string | null;
  };
  transfer?: { lastSaleDate?: string | null; deedBookPage?: string | null };
  records?: Array<{ field?: string; source?: string; sourceUrl?: string | null; retrievedAt?: string | null }>;
}

export interface OfficialAcreageRunDeps {
  subject: (dealCardId: number) => ResolverSubject | null;
  latestCapabilityResult: (propertyCardId: number, dealCardId: number, capabilityId: string) => { facts?: unknown } | null;
  queryGis: (subject: ResolverSubject) => Promise<GisDepictionRecord | null>;
  searchFamily: (subject: ResolverSubject, situsStreet: string | null) => Promise<{ status: string; note: string; siblings: SiblingParcelRecord[]; detailReads: number; sourceUrl: string }>;
  historicalAcreage: (dealCardId: number, currentCanonical: number | null) => Array<{ acres: number; source: string; note: string }>;
  providerAcreage: (propertyCardId: number, dealCardId: number, cardAcres: number | null) => {
    provider: AcreageExtentInput['provider'];
    providerCalc: { acres: number; note: string } | null;
  };
  persist: (record: AcreageExtentRunRecord, subject: ResolverSubject) => AcreageExtentRunRecord;
}

const liveHistoricalAcreage = (dealCardId: number, currentCanonical: number | null): Array<{ acres: number; source: string; note: string }> => {
  const rows = getLandosDb().prepare(`
    SELECT version, acreage, basis, change_reason, created_at
    FROM landos_property_identity_version
    WHERE deal_card_id=? AND is_current=0 AND acreage IS NOT NULL
    ORDER BY version
  `).all(dealCardId) as Array<{ version: number; acreage: number; basis: string; change_reason: string; created_at: number }>;
  const seen = new Set<number>();
  const out: Array<{ acres: number; source: string; note: string }> = [];
  for (const row of rows) {
    if (currentCanonical != null && Math.abs(row.acreage - currentCanonical) <= 0.005) continue;
    if (seen.has(row.acreage)) continue;
    seen.add(row.acreage);
    out.push({
      acres: row.acreage,
      source: `Retained subject-identity history (version ${row.version})`,
      note: `Acreage carried by earlier retained research evidence. ${String(row.basis ?? '').slice(0, 160)}`,
    });
  }
  return out;
};

const liveProviderAcreage = (
  store: CapabilityInvocationStore,
  propertyCardId: number,
  dealCardId: number,
  cardAcres: number | null,
  lpUrl: string | null,
): { provider: AcreageExtentInput['provider']; providerCalc: { acres: number; note: string } | null } => {
  const lp = store.latestForProperty(propertyCardId, dealCardId, 'landportal-property-characteristics') as
    | { facts?: { parcelUrl?: string; facts?: Record<string, unknown> } }
    | null;
  const sheet = lp?.facts?.facts ?? null;
  const parse = (v: unknown): number | null => {
    const n = Number.parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const reported = sheet ? parse(sheet.Acres) : null;
  const calc = sheet ? parse(sheet['Calc Acres']) : null;
  const url = lp?.facts?.parcelUrl ?? lpUrl;
  if (reported != null) {
    return {
      provider: { acres: reported, source: 'LandPortal parcel record', sourceUrl: url ?? null, retrievedAt: null },
      providerCalc: calc != null ? { acres: calc, note: 'LandPortal\'s own geometry-calculated area for the parcel it currently maps.' } : null,
    };
  }
  if (cardAcres != null && cardAcres > 0) {
    return { provider: { acres: cardAcres, source: 'LandPortal parcel record (retained on the property card)', sourceUrl: lpUrl, retrievedAt: null }, providerCalc: null };
  }
  return { provider: null, providerCalc: null };
};

export function liveOfficialAcreageDeps(): OfficialAcreageRunDeps {
  const store = new CapabilityInvocationStore();
  return {
    subject: (dealCardId) => readResolverSubject(dealCardId),
    latestCapabilityResult: (propertyCardId, dealCardId, capabilityId) =>
      store.latestForProperty(propertyCardId, dealCardId, capabilityId) as { facts?: unknown } | null,
    queryGis: (subject) => queryWilliamsonGisParcel(subject.apn ?? ''),
    searchFamily: async (subject, situsStreet) =>
      searchWilliamsonParcelFamily({ apn: subject.apn ?? '', subjectSitusStreet: situsStreet, maxDetailReads: 3 }, 30_000),
    historicalAcreage: liveHistoricalAcreage,
    providerAcreage: (propertyCardId, dealCardId, cardAcres) =>
      liveProviderAcreage(store, propertyCardId, dealCardId, cardAcres, null),
    persist: persistAcreageExtentRun,
  };
}

/** Persist evidence + snapshot; adopt a changed canonical acreage with audit. */
export function persistAcreageExtentRun(record: AcreageExtentRunRecord, subject: ResolverSubject): AcreageExtentRunRecord {
  const dealCardId = record.dealCardId;
  const decision = record.decision;

  const evidenceRows: DerivedEvidenceInput[] = decision.retained.map((item) => ({
    domain: 'acreage_extent',
    evidenceKind: item.sourceClass,
    factKey: `acreage_${item.valueType}`,
    raw: item,
    normalized: { acres: item.valueAcres, valueType: item.valueType, vintage: item.vintage },
    sourceName: item.source,
    sourceUrl: item.sourceUrl,
    sourceTier: item.sourceClass === 'official_record' || item.sourceClass === 'gis_observation'
      ? 'official_government_source'
      : item.sourceClass === 'historical_record' ? 'retained_historical_record' : 'provider_record',
    confidence: item.vintage === 'current' ? 'confirmed' : 'retained',
    retrievedAt: item.retrievedAt ?? record.completedAt,
    dedupeOn: `${item.valueType}:${item.source}:${item.valueAcres}`,
  }));
  for (const sibling of decision.extentSiblings) {
    evidenceRows.push({
      domain: 'acreage_extent',
      evidenceKind: 'official_record',
      factKey: 'split_sibling_parcel',
      raw: sibling,
      normalized: { officialParcelId: sibling.officialParcelId, legalAcres: sibling.legalAcres },
      sourceName: WILLIAMSON_ASSESSOR_SOURCE,
      sourceUrl: null,
      sourceTier: 'official_government_source',
      confidence: 'confirmed',
      retrievedAt: record.completedAt,
      dedupeOn: `sibling:${sibling.officialParcelId}:${sibling.legalAcres}`,
    });
  }
  const evidence = appendDerivedEvidence({ dealCardId, collectorKey: 'official-acreage-run', rows: evidenceRows, actor: 'acreage-extent-reconciliation' });

  // Adoption: only a resolved, identity-verified, materially different figure.
  let adoption = record.adoption;
  const resolved = decision.status === 'resolved_current_canonical' || decision.status === 'resolved_current_vs_historical_extent';
  if (resolved && decision.canonicalChanged && decision.canonicalAcres != null && subject.propertyCardId != null) {
    const db = getLandosDb();
    const previous = adoption.previousAcres;
    db.prepare('UPDATE landos_property_card SET acres=?, updated_at=unixepoch() WHERE id=?')
      .run(decision.canonicalAcres, subject.propertyCardId);
    const identity = readCurrentPropertyIdentity(dealCardId);
    const version = createPropertyIdentityVersion({
      dealCardId,
      propertyCardId: subject.propertyCardId,
      status: identity?.status ?? 'candidate',
      address: identity?.address ?? subject.address ?? null,
      city: identity?.city ?? subject.city ?? null,
      county: identity?.county ?? subject.county ?? null,
      state: identity?.state ?? subject.state ?? null,
      zip: identity?.zip ?? subject.zip ?? null,
      apn: identity?.apn ?? subject.apn ?? null,
      owner: identity?.owner ?? subject.owner ?? null,
      acreage: decision.canonicalAcres,
      basis: `Canonical current acreage adopted from the identity-verified official record: ${decision.canonicalSource}.`,
      confidence: identity?.confidence ?? 0.9,
      sourceRefs: decision.canonicalSourceUrl ? [decision.canonicalSourceUrl] : [],
      changeReason: `Acreage reconciliation: official ${decision.canonicalAcres} ac replaces ${previous ?? 'unset'} ac; prior figures retained as evidence. ${decision.extentExplanation ?? ''}`.trim().slice(0, 600),
      createdBy: 'acreage-extent-reconciliation',
    });
    landosAudit('acreage-extent-reconciliation', 'canonical_acreage_adopted',
      `deal ${dealCardId}: canonical acreage ${previous ?? 'unset'} → ${decision.canonicalAcres} ac from ${decision.canonicalSource}`, {
        refTable: 'landos_property_card',
        refId: subject.propertyCardId,
      });
    adoption = {
      adopted: true,
      previousAcres: previous,
      newAcres: decision.canonicalAcres,
      identityVersionId: version.id,
      note: `Canonical acreage updated to ${decision.canonicalAcres} ac; acreage-dependent products marked stale (${decision.staleProducts.join(', ')}); nothing rerun.`,
    };
  }

  // Stale markers survive re-runs: when THIS run raised no new markers, any
  // markers a prior adoption raised are carried forward with their original
  // timestamp — a no-change re-run never silently clears them.
  let staleSince: string | null = adoption.adopted ? record.completedAt : null;
  let staleProducts = decision.staleProducts;
  if (!adoption.adopted && staleProducts.length === 0) {
    const current = readAcreageExtentRecord(dealCardId);
    const history = readDerivedSnapshotHistory<AcreageExtentRunRecord>(dealCardId, ACREAGE_EXTENT_SNAPSHOT_TYPE);
    // Latest-first over current + retained history: the most recent record
    // that still carries markers (or the adoption itself) wins.
    const prior = [current, ...history.reverse()]
      .find((r) => r != null && (r.decision.staleProducts?.length || r.adoption?.adopted));
    if (prior?.decision.staleProducts?.length || prior?.adoption?.adopted) {
      staleProducts = prior.decision.staleProducts?.length
        ? prior.decision.staleProducts
        : [...ACREAGE_DEPENDENT_PRODUCTS];
      staleSince = prior.staleSince ?? prior.completedAt ?? null;
    }
  }

  const finalRecord: AcreageExtentRunRecord = {
    ...record,
    adoption,
    staleSince,
    decision: { ...decision, staleProducts },
  };
  writeDerivedSnapshot({
    dealCardId,
    snapshotType: ACREAGE_EXTENT_SNAPSHOT_TYPE,
    payload: finalRecord,
    completeness: { status: decision.status, confidence: decision.confidence, unresolved: decision.unresolvedQuestions.length },
    evidenceIds: evidence.evidenceIds,
    changeReason: `Official acreage / parcel-extent reconciliation (${decision.status}).`,
    actor: 'acreage-extent-reconciliation',
    auditEvent: 'acreage_extent_reconciliation',
  });
  return finalRecord;
}

/** The persisted current reconciliation, or null. A pure SELECT. */
export function readAcreageExtentRecord(dealCardId: number): AcreageExtentRunRecord | null {
  return readDerivedSnapshot<AcreageExtentRunRecord>(dealCardId, ACREAGE_EXTENT_SNAPSHOT_TYPE);
}

/**
 * Run the bounded reconciliation for one deal. Explicit-trigger only. At most
 * one GIS query and one family search per run; the assessor record is reused,
 * never re-invoked from here.
 */
export async function runOfficialAcreageExtentReconciliation(
  dealCardId: number,
  deps: OfficialAcreageRunDeps = liveOfficialAcreageDeps(),
): Promise<AcreageExtentRunRecord> {
  const startedAt = new Date().toISOString();
  const actions: AcreageExtentRunRecord['actions'] = [];
  const refuse = (reason: string): AcreageExtentRunRecord => ({
    contractVersion: ACREAGE_EXTENT_VERSION,
    dealCardId,
    propertyCardId: null,
    subjectApn: '',
    trigger: 'operator_reconcile',
    startedAt,
    completedAt: new Date().toISOString(),
    actions,
    decision: reconcileAcreageExtent({ subjectApn: '', official: null, gis: null, siblings: [], provider: null, historical: [], priorCanonicalAcres: null }),
    adoption: { adopted: false, previousAcres: null, newAcres: null, identityVersionId: null, note: 'Not adopted.' },
    staleSince: null,
    refusalReason: reason,
  });

  const subject = deps.subject(dealCardId);
  if (!subject || !subject.apn || subject.propertyCardId == null) {
    return refuse('The deal does not carry a canonical subject with an APN; acreage reconciliation is identity-gated.');
  }

  // 1. Current official record — REUSED from the retained assessor-tax result.
  const assessorResult = deps.latestCapabilityResult(subject.propertyCardId, dealCardId, 'assessor-tax');
  const facts = (assessorResult?.facts ?? null) as AssessorFactsShape | null;
  if (!facts || facts.recordStatus !== 'official_record_retrieved' || facts.assessor?.assessedAcres == null) {
    return refuse('No retained official assessor record with an acreage is in evidence. Run the governed assessor verification first; this run never launches one.');
  }
  const apnRecord = facts.records?.find((r) => r.field === 'APN');
  const officialParcelId = facts.assessor?.apn ?? null;
  const identityMatches = officialParcelId != null && williamsonParcelIdMatchesApn(officialParcelId, subject.apn);
  actions.push({
    action: 'reuse_assessor_record',
    source: apnRecord?.source ?? 'county assessor record',
    sourceUrl: apnRecord?.sourceUrl ?? null,
    outcome: `Reused retained official record (${facts.assessor?.assessedAcres} ac, retrieved ${apnRecord?.retrievedAt ?? 'unknown'}).`,
  });

  // 2. ONE county GIS parcel-layer query.
  let gis: GisDepictionRecord | null = null;
  try {
    gis = await deps.queryGis(subject);
    actions.push({
      action: 'county_gis_parcel_query',
      source: gis?.source ?? WILLIAMSON_GIS_SOURCE,
      sourceUrl: gis?.sourceUrl ?? WILLIAMSON_GIS_PARCEL_LAYER,
      outcome: gis
        ? `GIS depicts ${gis.reportedAcres ?? '?'} ac attribute / ${gis.calculatedAcres ?? '?'} ac calculated, owner attribute "${gis.owner ?? ''}".`
        : 'No GIS parcel matched the canonical APN.',
    });
  } catch (error) {
    actions.push({ action: 'county_gis_parcel_query', source: WILLIAMSON_GIS_SOURCE, sourceUrl: WILLIAMSON_GIS_PARCEL_LAYER, outcome: `Unavailable: ${error instanceof Error ? error.message : String(error)}` });
  }

  // 3. ONE parcel-family search (the bounded escalation).
  const situsStreet = (facts.assessor?.situsAddress ?? '').replace(/^\d+\s*/, '').trim() || null;
  let siblings: SiblingParcelRecord[] = [];
  try {
    const family = await deps.searchFamily(subject, situsStreet);
    siblings = family.siblings;
    actions.push({ action: 'assessor_parcel_family_search', source: WILLIAMSON_ASSESSOR_SOURCE, sourceUrl: family.sourceUrl, outcome: family.note });
  } catch (error) {
    actions.push({ action: 'assessor_parcel_family_search', source: WILLIAMSON_ASSESSOR_SOURCE, sourceUrl: null, outcome: `Unavailable: ${error instanceof Error ? error.message : String(error)}` });
  }

  // 4. Retained provider + historical figures — reads of existing evidence.
  const { provider, providerCalc } = deps.providerAcreage(subject.propertyCardId, dealCardId, subject.acres ?? null);
  const historical = deps.historicalAcreage(dealCardId, facts.assessor.assessedAcres);

  const decision = reconcileAcreageExtent({
    subjectApn: subject.apn,
    official: {
      acres: facts.assessor.assessedAcres,
      owner: facts.assessor.ownerOfRecord ?? null,
      officialParcelId,
      identityMatchesSubject: identityMatches,
      source: apnRecord?.source ?? 'County assessor record',
      sourceUrl: apnRecord?.sourceUrl ?? null,
      retrievedAt: apnRecord?.retrievedAt ?? null,
      lastTransferDate: facts.transfer?.lastSaleDate ?? null,
      deedBookPage: facts.transfer?.deedBookPage ?? null,
    },
    gis,
    siblings,
    provider,
    providerCalculated: providerCalc
      ? { acres: providerCalc.acres, source: 'LandPortal geometry calculation', note: providerCalc.note }
      : null,
    historical,
    priorCanonicalAcres: subject.acres ?? null,
  });

  const record: AcreageExtentRunRecord = {
    contractVersion: ACREAGE_EXTENT_VERSION,
    dealCardId,
    propertyCardId: subject.propertyCardId,
    subjectApn: subject.apn,
    trigger: 'operator_reconcile',
    startedAt,
    completedAt: new Date().toISOString(),
    actions,
    decision,
    adoption: {
      adopted: false,
      previousAcres: subject.acres ?? null,
      newAcres: null,
      identityVersionId: null,
      note: 'Not adopted.',
    },
    staleSince: null,
    refusalReason: null,
  };
  return deps.persist(record, subject);
}
