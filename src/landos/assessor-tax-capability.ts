// LandOS — Assessor & Tax Capability.
//
// This is a PLACEMENT, not a new research engine. The assessor/public-record
// read LandOS already performs lives in two proven pieces:
//
//   1. `lookupOfficialParcel()` — the structured county/state parcel adapters.
//   2. the `county_records` public-intelligence adapter built over that parcel,
//      which is what actually turns a matched parcel into owner of record,
//      mailing address, assessed acreage, land use, appraised/taxable value,
//      the annual tax amount and year, delinquency, improvement facts and the
//      last recorded transfer.
//
// Both are reused verbatim here. What this module adds is the Slice 7 runtime
// Capability envelope around them, so Tools, New Lead and the Deal Card all
// reach ONE assessor implementation through the same contract instead of each
// wiring its own path to the parcel adapters.
//
// Hard rules kept from the underlying implementation:
//   - The canonical subject comes from Property Resolution. This capability
//     never decides that a different parcel is the subject; on raw input it
//     delegates to the Property Resolution Capability and consumes what that
//     returns.
//   - Missing stays missing. A field the record did not publish is null, never
//     inferred, and never filled from another property.
//   - Provenance travels with the fact. Every retained record keeps the source
//     that carried it.

import type {
  CanonicalSubjectReference,
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  CapabilityResult,
  JsonObject,
  LandosCapability,
  SubjectResolutionState,
} from './capability-contract.js';
import { lookupCountyAssessorRecord } from './county-assessor-search.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { listPublicRecordOutcomes } from './lead-card-intake.js';
import type { SnapshotFact } from './property-intelligence-snapshot.js';
import { countyRecordFactsFromPublicRun } from './property-intelligence-specialist-execution.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { PublicIntelligenceStore } from './public-intelligence-store.js';
import type { PublicIntelligenceSubject } from './public-property-intelligence.js';
import {
  governmentFactsFromPublicRecordOutcomes,
  lookupOfficialParcel,
  makeLivePublicIntelligenceAdapters,
  type OfficialParcelAttempt,
  type OfficialParcelLookupResult,
} from './public-property-intelligence-live.js';
import {
  TAX_STATUS_FIELDS,
  buildTaxStatusRead,
  taxAuthorityFor,
  type TaxStandingCode,
} from './tax-status-research.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';

export const ASSESSOR_TAX_CAPABILITY_ID = 'assessor-tax';

/** How long the official parcel adapters get before the capability gives up. */
const DEFAULT_LOOKUP_TIMEOUT_MS = 25_000;

export type AssessorTaxRecordStatus =
  | 'official_record_retrieved'
  | 'retained_record_only'
  | 'not_retrieved';

/** One retained assessor/tax fact with the source that carried it. */
export type AssessorTaxRecord = {
  field: string;
  value: string;
  classification: 'official_record' | 'recorded_instrument';
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
};

export type AssessorTaxSubjectFacts = {
  propertyCardId: number | null;
  dealCardId: number | null;
  apn: string | null;
  situsAddress: string | null;
  county: string | null;
  state: string | null;
  owner: string | null;
  acres: number | null;
};

export type AssessorFacts = {
  ownerOfRecord: string | null;
  ownerMailingAddress: string | null;
  situsAddress: string | null;
  apn: string | null;
  assessedAcres: number | null;
  gisAcres: number | null;
  landUseClass: string | null;
  taxDistrict: string | null;
  legalDescription: string | null;
  landAppraisedValue: number | null;
  totalAppraisedValue: number | null;
  taxableValue: number | null;
};

export type AssessorTaxTaxFacts = {
  annualTaxAmount: number | null;
  taxYear: string | null;
  standing: TaxStandingCode;
  standingLabel: string;
  paymentStatus: string | null;
  amountOwed: string | null;
  unpaidYears: string | null;
  penaltiesInterest: string | null;
  taxSaleStatus: string | null;
  collectingOffice: string | null;
  collectingOfficeSearchUrl: string | null;
  statement: string;
};

export type AssessorImprovementFacts = {
  structureType: string | null;
  yearBuilt: number | null;
  buildingSqft: number | null;
  manufacturedHomeAssessmentStatus: string | null;
  manufacturedHomeAccount: string | null;
  manufacturedHomeOwner: string | null;
};

export type AssessorTransferFacts = {
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  saleQualification: string | null;
  deedBookPage: string | null;
};

export type AssessorTaxSourceAttempt = {
  source: string;
  status: string;
  note: string;
};

export type AssessorTaxFacts = JsonObject & {
  recordStatus: AssessorTaxRecordStatus;
  jurisdiction: string | null;
  subject: AssessorTaxSubjectFacts;
  assessor: AssessorFacts;
  tax: AssessorTaxTaxFacts;
  improvements: AssessorImprovementFacts;
  transfer: AssessorTransferFacts;
  records: AssessorTaxRecord[];
  sourceAttempts: AssessorTaxSourceAttempt[];
  summary: string;
};

/**
 * The capability result, projected into the Deal Card's fact shape.
 *
 * Government records used to build these facts from the persisted public run
 * and the public-record outcome rows directly. That is now the capability's
 * job, and every surface reads the same projection of the same result.
 */
export function assessorTaxSnapshotFacts(result: CapabilityResult): SnapshotFact[] {
  const facts = result.facts as Partial<AssessorTaxFacts>;
  const records = Array.isArray(facts?.records) ? facts.records : [];
  return records.map((record, index): SnapshotFact => ({
    key: `assessor_tax_${index}_${record.field.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    label: record.field,
    value: String(record.value),
    grade: record.classification === 'recorded_instrument' ? 'confirmed_fact' : 'likely_indication',
    source: record.source ?? facts?.jurisdiction ?? null,
    sourceUrl: record.sourceUrl ?? null,
    retrievedAt: record.retrievedAt ?? result.timestamps.completedAt,
    note: null,
  }));
}

/** The canonical subject this capability was handed, never one it chose. */
interface AssessorSubject {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  county: string | null;
  state: string | null;
  apn: string | null;
  owner: string | null;
  acres: number | null;
}

export interface AssessorTaxRuntime {
  /**
   * Raw operator input is resolved by the Property Resolution Capability, never
   * here. The registry injects the real invoker; tests inject a stub.
   */
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /** The existing official parcel adapters. Overridden only by tests. */
  lookupParcel?: typeof lookupOfficialParcel;
  /** The structured county assessor-search adapters (counties absent from
   *  every statewide parcel layer). Overridden only by tests. */
  lookupCountyAssessor?: typeof lookupCountyAssessorRecord;
  lookupTimeoutMs?: number;
}

const str = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return raw && !/^(?:-|--|n\/?a|none|unknown)$/i.test(raw) ? raw : null;
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
};

function emptyFacts(subject: AssessorSubject, jurisdiction: string | null, taxStatement: string): AssessorTaxFacts {
  const authority = taxAuthorityFor({ county: subject.county, state: subject.state });
  return {
    recordStatus: 'not_retrieved',
    jurisdiction,
    subject: {
      propertyCardId: subject.propertyCardId,
      dealCardId: subject.dealCardId,
      apn: subject.apn,
      situsAddress: subject.address,
      county: subject.county,
      state: subject.state,
      owner: subject.owner,
      acres: subject.acres,
    },
    assessor: {
      ownerOfRecord: null, ownerMailingAddress: null, situsAddress: null, apn: null,
      assessedAcres: null, gisAcres: null, landUseClass: null, taxDistrict: null,
      legalDescription: null, landAppraisedValue: null, totalAppraisedValue: null, taxableValue: null,
    },
    tax: {
      annualTaxAmount: null, taxYear: null, standing: 'unresolved',
      standingLabel: 'Not established by a public source',
      paymentStatus: null, amountOwed: null, unpaidYears: null,
      penaltiesInterest: null, taxSaleStatus: null,
      collectingOffice: authority?.officeName ?? null,
      collectingOfficeSearchUrl: authority?.searchUrl ?? null,
      statement: taxStatement,
    },
    improvements: {
      structureType: null, yearBuilt: null, buildingSqft: null,
      manufacturedHomeAssessmentStatus: null, manufacturedHomeAccount: null, manufacturedHomeOwner: null,
    },
    transfer: { lastSaleDate: null, lastSalePrice: null, saleQualification: null, deedBookPage: null },
    records: [],
    sourceAttempts: [],
    summary: 'No assessor or tax record has been retrieved for this subject.',
  };
}

function jurisdictionOf(subject: AssessorSubject): string | null {
  const county = subject.county?.replace(/\s+county$/i, '').trim();
  if (county && subject.state) return `${county} County, ${subject.state}`;
  return county ? `${county} County` : subject.state ?? null;
}

/** Retained facts this Deal Card already carries, kept with their provenance. */
function retainedRecords(dealCardId: number): AssessorTaxRecord[] {
  const run = new PublicIntelligenceStore().load(dealCardId)?.run ?? null;
  const facts: SnapshotFact[] = [
    ...countyRecordFactsFromPublicRun(run),
    ...governmentFactsFromPublicRecordOutcomes(listPublicRecordOutcomes(dealCardId)),
  ];
  return facts
    .filter((fact) => str(fact.value))
    .map((fact) => ({
      field: fact.label,
      value: String(fact.value),
      classification: fact.grade === 'confirmed_fact' ? 'recorded_instrument' as const : 'official_record' as const,
      source: fact.source ?? null,
      sourceUrl: fact.sourceUrl ?? null,
      retrievedAt: fact.retrievedAt ?? null,
    }));
}

/**
 * The live official read: the existing parcel adapters, then the existing
 * `county_records` adapter over the matched parcel. Neither is reimplemented.
 */
async function liveRecords(
  subject: AssessorSubject,
  runtime: AssessorTaxRuntime,
): Promise<{
  records: AssessorTaxRecord[];
  evidence: CapabilityEvidenceReference[];
  attempts: OfficialParcelAttempt[];
  summary: string | null;
  jurisdiction: string | null;
}> {
  const lookup: OfficialParcelLookupResult = await (runtime.lookupParcel ?? lookupOfficialParcel)({
    address: subject.address ?? undefined,
    county: subject.county ?? undefined,
    state: subject.state ?? undefined,
    apn: subject.apn ?? undefined,
    owner: subject.owner ?? undefined,
  }, runtime.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS);

  if (!lookup.parcel) {
    // Some counties are absent from every statewide parcel layer while the
    // county assessor itself publishes a keyless structured search. That
    // official source is the stronger current record for those jurisdictions,
    // so a parcel-layer miss falls through to it rather than reporting the
    // question unanswerable.
    const countyOutcome = await (runtime.lookupCountyAssessor ?? lookupCountyAssessorRecord)(
      { county: subject.county, state: subject.state, apn: subject.apn },
      runtime.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS,
    );
    if (countyOutcome) {
      const attempts: OfficialParcelAttempt[] = [
        ...lookup.attempted,
        { source: countyOutcome.source, status: countyOutcome.status, note: countyOutcome.note },
      ];
      if (countyOutcome.status === 'matched' && countyOutcome.records.length) {
        return {
          records: countyOutcome.records.map((record) => ({ ...record })),
          evidence: [{
            source: countyOutcome.source,
            sourceUrl: countyOutcome.sourceUrl,
            sourceType: 'official_county_state',
            retrievedAt: countyOutcome.records[0]?.retrievedAt ?? new Date().toISOString(),
            details: { adapter: 'county_assessor_search', officialParcelId: countyOutcome.officialParcelId },
          }],
          attempts,
          summary: countyOutcome.summary,
          jurisdiction: countyOutcome.jurisdiction,
        };
      }
      return { records: [], evidence: [], attempts, summary: null, jurisdiction: null };
    }
    return { records: [], evidence: [], attempts: lookup.attempted, summary: null, jurisdiction: null };
  }

  const parcel = lookup.parcel;
  const adapter = makeLivePublicIntelligenceAdapters(parcel).find((candidate) => candidate.task === 'county_records');
  if (!adapter) {
    return { records: [], evidence: [], attempts: lookup.attempted, summary: null, jurisdiction: null };
  }

  const adapterSubject: PublicIntelligenceSubject = {
    rawInput: subject.address ?? parcel.address,
    normalizedAddress: parcel.address,
    county: parcel.county,
    state: parcel.state,
    requestedApn: subject.apn ?? undefined,
    resolvedApn: parcel.apn,
    resolutionStatus: 'confirmed',
    resolutionExplanation: 'The canonical subject was established by Property Resolution before this capability ran.',
    coordinates: parcel.coordinates,
    assessedAcres: parcel.acres ?? undefined,
  };
  const controller = new AbortController();
  const timeoutMs = adapter.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  const startedAt = new Date().toISOString();
  let outcome;
  try {
    outcome = await adapter.run(adapterSubject, {
      signal: controller.signal,
      timeoutMs,
      startedAt,
      captureMode: 'live',
    });
  } finally {
    clearTimeout(timer);
  }

  const finding = outcome.finding?.kind === 'county_records' ? outcome.finding : null;
  const evidenceById = new Map(outcome.evidence.map((item) => [item.evidenceId, item]));
  const records: AssessorTaxRecord[] = (finding?.facts ?? []).map((fact) => {
    const source = evidenceById.get(fact.sourceEvidenceId);
    return {
      field: fact.field,
      value: String(fact.value),
      classification: fact.classification,
      source: source?.sourceName ?? parcel.provider,
      sourceUrl: source?.sourceUrl ?? parcel.sourceUrl,
      retrievedAt: source?.retrievedAt ?? startedAt,
    };
  });
  const evidence: CapabilityEvidenceReference[] = outcome.evidence.map((item) => ({
    source: item.sourceName,
    sourceUrl: item.sourceUrl ?? null,
    sourceType: item.sourceTier,
    retrievedAt: item.retrievedAt,
    details: { adapter: adapter.adapterId, provider: parcel.provider, apn: parcel.apn },
  }));
  return {
    records,
    evidence,
    attempts: lookup.attempted,
    summary: finding?.summary ?? null,
    jurisdiction: finding?.jurisdiction ?? null,
  };
}

/** One record list, live official first, retained kept when it adds a field. */
function mergeRecords(live: AssessorTaxRecord[], retained: AssessorTaxRecord[]): AssessorTaxRecord[] {
  const merged = [...live];
  const seen = new Set(live.map((record) => `${record.field.toLowerCase()} ${record.value.toLowerCase()}`));
  const fields = new Set(live.map((record) => record.field.toLowerCase()));
  for (const record of retained) {
    const key = `${record.field.toLowerCase()} ${record.value.toLowerCase()}`;
    if (seen.has(key) || fields.has(record.field.toLowerCase())) continue;
    seen.add(key);
    merged.push(record);
  }
  return merged;
}

function projectFacts(input: {
  subject: AssessorSubject;
  records: AssessorTaxRecord[];
  attempts: OfficialParcelAttempt[];
  jurisdiction: string | null;
  liveRetrieved: boolean;
  summary: string | null;
}): AssessorTaxFacts {
  const { subject, records } = input;
  const byField = new Map(records.map((record) => [record.field.toLowerCase(), record.value]));
  const read = (...fields: string[]): string | null => {
    for (const field of fields) {
      const value = str(byField.get(field.toLowerCase()));
      if (value) return value;
    }
    return null;
  };

  const authority = taxAuthorityFor({ county: subject.county, state: subject.state });
  const taxFields: Record<string, string | number | null | undefined> = {};
  for (const label of TAX_STATUS_FIELDS) taxFields[label] = read(label);
  const answering = records.find((record) =>
    (TAX_STATUS_FIELDS as readonly string[]).some((label) => label.toLowerCase() === record.field.toLowerCase()));
  const taxRead = buildTaxStatusRead({
    fields: taxFields,
    attempts: [],
    sourceLabel: answering?.source ?? null,
    sourceUrl: answering?.sourceUrl ?? null,
    authority,
  });

  const recordStatus: AssessorTaxRecordStatus = input.liveRetrieved
    ? 'official_record_retrieved'
    : records.length ? 'retained_record_only' : 'not_retrieved';

  const base = emptyFacts(subject, input.jurisdiction ?? jurisdictionOf(subject), taxRead.statement);
  return {
    ...base,
    recordStatus,
    assessor: {
      ownerOfRecord: read('Owner of record'),
      ownerMailingAddress: read('Owner mailing address'),
      situsAddress: read('Situs address'),
      apn: read('APN'),
      assessedAcres: num(read('Assessed acreage')),
      gisAcres: num(read('GIS mapped acreage')),
      landUseClass: read('Land use class'),
      taxDistrict: read('Tax district / area'),
      legalDescription: read('Legal description (assessor)'),
      landAppraisedValue: num(read('Appraised value (land)')),
      totalAppraisedValue: num(read('Total appraised value')),
      taxableValue: num(read('Taxable value')),
    },
    tax: {
      annualTaxAmount: num(read('Current property-tax amount')),
      taxYear: read('Property-tax year'),
      standing: taxRead.standing,
      standingLabel: taxRead.standingLabel,
      paymentStatus: taxRead.paymentStatus,
      amountOwed: taxRead.amountOwed,
      unpaidYears: taxRead.unpaidYears,
      penaltiesInterest: taxRead.penaltiesInterest,
      taxSaleStatus: taxRead.taxSaleStatus,
      collectingOffice: taxRead.authorityOffice,
      collectingOfficeSearchUrl: taxRead.authoritySearchUrl,
      statement: taxRead.statement,
    },
    improvements: {
      structureType: read('Improvement / structure type'),
      yearBuilt: num(read('Year built')),
      buildingSqft: num(read('Building square footage')),
      manufacturedHomeAssessmentStatus: read('Manufactured-home assessment status'),
      manufacturedHomeAccount: read('Manufactured-home tax/account number'),
      manufacturedHomeOwner: read('Manufactured-home assessed owner'),
    },
    transfer: {
      lastSaleDate: read('Last recorded sale date'),
      lastSalePrice: num(read('Last recorded sale price')),
      saleQualification: read('Sale qualification'),
      deedBookPage: read('Deed book/page'),
    },
    records,
    sourceAttempts: input.attempts.map((attempt) => ({
      source: attempt.source,
      status: attempt.status,
      note: attempt.note,
    })),
    summary: input.summary
      ?? (records.length
        ? `${records.length} retained assessor/tax fact(s) for this subject; no new official record was retrieved in this run.`
        : 'No assessor or tax record has been retrieved for this subject.'),
  };
}

function missingAssessorInformation(facts: AssessorTaxFacts): string[] {
  const missing: string[] = [];
  if (!facts.assessor.ownerOfRecord) missing.push('Owner of record from the assessor or appraisal record');
  if (facts.assessor.totalAppraisedValue == null && facts.assessor.taxableValue == null) {
    missing.push('Assessed or taxable value from the assessor record');
  }
  if (facts.tax.annualTaxAmount == null) missing.push('Annual property-tax amount from the taxing jurisdiction');
  if (facts.tax.standing === 'unresolved') {
    missing.push(facts.tax.collectingOffice
      ? `Property-tax payment status from the ${facts.tax.collectingOffice}`
      : 'Property-tax payment status from the collecting office');
  }
  return missing;
}

function subjectFromCanonicalIdentity(
  identity: Record<string, unknown>,
  canonical: CanonicalSubjectReference | null,
): AssessorSubject {
  return {
    propertyCardId: canonical?.propertyCardId ?? null,
    dealCardId: canonical?.dealCardId ?? null,
    address: str(identity.address),
    county: str(identity.county),
    state: str(identity.state),
    apn: str(identity.apn),
    owner: str(identity.owner),
    acres: num(identity.acres),
  };
}

/** Property Resolution owns raw input. This capability only consumes it. */
async function resolveRawSubject(
  request: CapabilityInvocationRequest,
  runtime: AssessorTaxRuntime,
): Promise<CapabilityResult> {
  if (runtime.resolveSubject) return runtime.resolveSubject(request);
  const { invokeRuntimeCapability } = await import('./capability-registry.js');
  return invokeRuntimeCapability({
    capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
    caller: request.caller,
    subject: request.subject,
    mode: request.mode ?? 'reuse',
    // The envelope is forwarded verbatim so a resolution the same caller has
    // already run for this input is reused rather than resolved twice.
    context: request.context ?? {},
  });
}

export const ASSESSOR_TAX_CAPABILITY: LandosCapability<AssessorTaxFacts, AssessorTaxRuntime> = {
  metadata: {
    id: ASSESSOR_TAX_CAPABILITY_ID,
    name: 'Assessor & Tax',
    contractVersion: '1.0',
    description: 'Reads the assessor and taxing-jurisdiction record for the canonical LandOS property subject: owner of record, mailing address, assessed acreage and value, annual tax, payment standing, improvements and the last recorded transfer.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const parameterKeys = Object.keys(request.parameters ?? {});
    const unsupported = parameterKeys.filter((key) => key !== 'lookupTimeoutMs');
    if (unsupported.length) {
      throw new Error(`Assessor & Tax does not accept caller-supplied ${unsupported.join(', ')}; assessor facts come from the record, not the caller`);
    }
    const reserved = /^(?:owner|apn|assessedValue|taxableValue|taxAmount|taxStatus|evidence|facts)$/i;
    const asserts = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(asserts);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => reserved.test(key) || asserts(child));
    };
    if (asserts(request.context ?? {})) {
      throw new Error('Assessor & Tax context cannot contain caller-supplied assessor, tax, or evidence assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: AssessorTaxRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<AssessorTaxFacts>> {
    const warnings: string[] = [];
    let subject: AssessorSubject;
    let canonicalSubject: CanonicalSubjectReference | null;
    let subjectResolution: SubjectResolutionState;

    if (request.subject.kind === 'canonical_property') {
      // The Deal Card and New Lead path. The subject already exists; reading it
      // is the whole identity step, and nothing here may change it.
      const propertyCardId = request.subject.propertyCardId;
      const dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId);
      if (!dealCardId) throw new Error(`canonical property ${propertyCardId} is not linked to a Deal Card`);
      const retained = readResolverSubject(dealCardId);
      if (!retained || retained.propertyCardId !== propertyCardId || retained.entity !== request.subject.entity) {
        throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
      }
      subject = {
        propertyCardId,
        dealCardId,
        address: retained.address,
        county: retained.county,
        state: retained.state,
        apn: retained.apn,
        owner: retained.owner,
        acres: retained.acres,
      };
      canonicalSubject = { kind: 'property', id: String(propertyCardId), propertyCardId, dealCardId, temporary: false };
      const evaluation = evaluateResolverIdentity(retained);
      subjectResolution = evaluation.sufficient ? 'RESOLVED' : 'UNRESOLVED';
      if (!evaluation.sufficient) {
        warnings.push('Property Resolution has not released one exact parcel for this Deal Card, so no new official assessor record was requested.');
        warnings.push(...evaluation.conflicts);
      }
    } else {
      // Tools. Raw operator input is resolved by the Property Resolution
      // Capability; this capability consumes whatever subject that returns.
      const resolution = await resolveRawSubject(request, runtime);
      subjectResolution = resolution.subjectResolution;
      canonicalSubject = resolution.canonicalSubject;
      const identity = (resolution.facts.canonicalIdentity ?? {}) as Record<string, unknown>;
      subject = subjectFromCanonicalIdentity(identity, canonicalSubject);
      warnings.push(...resolution.warnings);
      if (subjectResolution !== 'RESOLVED') {
        const jurisdiction = jurisdictionOf(subject);
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(subject, jurisdiction,
            'Assessor and tax research did not run: Property Resolution has not established one canonical parcel for this input.'),
          evidence: resolution.evidence,
          warnings,
          missingInformation: resolution.missingInformation.length
            ? resolution.missingInformation
            : ['One canonical parcel from Property Resolution'],
        };
      }
    }

    const retained = subject.dealCardId ? retainedRecords(subject.dealCardId) : [];
    // `reuse` answers from what this subject already retains when it has an
    // assessor record; `refresh` always goes back to the official source.
    const useRetainedOnly = (request.mode ?? 'reuse') === 'reuse' && retained.length > 0;
    const live = subjectResolution === 'RESOLVED' && !useRetainedOnly
      ? await liveRecords(subject, runtime)
      : { records: [], evidence: [] as CapabilityEvidenceReference[], attempts: [] as OfficialParcelAttempt[], summary: null, jurisdiction: null };

    if (subjectResolution === 'RESOLVED' && !useRetainedOnly && !live.records.length) {
      warnings.push(live.attempts.length
        ? `No official parcel source returned an assessor record: ${live.attempts.map((attempt) => `${attempt.source} — ${attempt.note}`).join('; ')}`
        : 'No official parcel source applied to this jurisdiction, so no assessor record could be requested.');
    }

    const records = mergeRecords(live.records, retained);
    const facts = projectFacts({
      subject,
      records,
      attempts: live.attempts,
      jurisdiction: live.jurisdiction,
      liveRetrieved: live.records.length > 0,
      summary: live.summary,
    });
    const evidence: CapabilityEvidenceReference[] = [...live.evidence];
    for (const record of retained) {
      if (!record.source) continue;
      if (evidence.some((item) => item.source === record.source && (item.sourceUrl ?? null) === record.sourceUrl)) continue;
      evidence.push({
        source: record.source,
        sourceUrl: record.sourceUrl,
        sourceType: 'retained_official_record',
        retrievedAt: record.retrievedAt ?? new Date().toISOString(),
        details: { retained: true },
      });
    }

    return {
      status: records.length ? 'SUCCEEDED' : 'NEEDS_INPUT',
      subjectResolution,
      canonicalSubject,
      facts,
      evidence,
      warnings,
      missingInformation: missingAssessorInformation(facts),
    };
  },
};
