import { getDealCard } from './deal-card.js';
import { readParcelIdentity } from './parcel-identity.js';
import { PublicIntelligenceStore, type StoredPublicIntelligenceRun } from './public-intelligence-store.js';
import type { CountyRecordsFinding, PublicIntelligenceTaskRecord } from './public-property-intelligence.js';
import {
  getPropertySummaryReadModel,
  synchronizePropertySummarySlice,
  type PropertyIdentityStatus,
  type PropertySummaryReadModel,
} from './property-summary-slice.js';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function countyTask(stored: StoredPublicIntelligenceRun | null): PublicIntelligenceTaskRecord | undefined {
  return stored?.run.tasks.find((task) => task.task === 'county_records');
}

function countyFinding(stored: StoredPublicIntelligenceRun | null): CountyRecordsFinding | null {
  const finding = countyTask(stored)?.finding;
  return finding?.kind === 'county_records' ? finding : null;
}

function countyFact(stored: StoredPublicIntelligenceRun | null, field: string): string | null {
  const row = countyFinding(stored)?.facts.find((fact) => fact.field === field);
  return row == null ? null : text(String(row.value));
}

function officialResolved(stored: StoredPublicIntelligenceRun | null): boolean {
  const task = countyTask(stored);
  return !!stored
    && !stored.parcelKey.startsWith('unresolved:')
    && (stored.run.status === 'complete' || stored.run.status === 'complete_with_gaps')
    && task?.status === 'succeeded'
    && task.evidence.some((item) => item.sourceTier === 'official_county_state' && item.verification === 'official_record');
}

export function synchronizePropertySummaryForDeal(input: {
  dealCardId: number;
  actor: string;
  changeReason: string;
}): PropertySummaryReadModel {
  const deal = getDealCard(input.dealCardId);
  if (!deal) throw new Error('Deal Card not found.');
  const property = (deal.propertyCards[0] ?? {}) as Record<string, unknown>;
  const legacyIdentity = readParcelIdentity(input.dealCardId);
  const store = new PublicIntelligenceStore();
  const latest = store.load(input.dealCardId);
  const resolved = store.loadLatestResolved(input.dealCardId);
  const resolvedOfficially = officialResolved(resolved);

  let status: PropertyIdentityStatus;
  if (legacyIdentity?.state === 'confirmed') {
    status = 'confirmed';
  } else if (resolvedOfficially && legacyIdentity) {
    // Preserve the disagreement explicitly. The new owner read model never
    // exposes a confirmed and candidate identity at the same time.
    status = 'disputed';
  } else if (resolvedOfficially) {
    status = 'confirmed';
  } else if (property.verification_status === 'rejected_mismatch') {
    status = 'rejected';
  } else if (property.verification_status === 'archived') {
    status = 'archived';
  } else if (legacyIdentity?.state === 'candidate') {
    status = 'candidate';
  } else if (legacyIdentity?.state === 'unresolved') {
    status = 'unresolved';
  } else if (property.verification_status === 'address_matched') {
    status = 'candidate';
  } else {
    status = 'unresolved';
  }

  const source = status === 'confirmed' ? resolved : latest;
  const finding = countyFinding(source);
  const jurisdictionParts = finding?.jurisdiction.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
  const sourceRefs = new Set<string>(legacyIdentity?.evidenceRefs ?? []);
  for (const evidence of countyTask(source)?.evidence ?? []) {
    sourceRefs.add(`${evidence.sourceName}:${evidence.evidenceId}`);
  }
  const publicAddress = countyFact(source, 'Situs address');
  const propertyAddress = text(property.address) ?? text(property.active_input_address);
  const acceptedLegacyIdentity = legacyIdentity?.state === 'confirmed';
  const address = acceptedLegacyIdentity
    ? (propertyAddress ?? publicAddress ?? text(deal.title))
    : (publicAddress ?? propertyAddress ?? text(deal.title));
  const publicAcres = positiveNumber(countyFact(source, 'Assessed acreage'));
  const cardAcres = positiveNumber(property.acres);
  const publicOwner = countyFact(source, 'Owner of record');
  const publicApn = countyFact(source, 'APN') ?? (source && !source.parcelKey.startsWith('unresolved:') ? source.parcelKey : null);

  const identity = {
    dealCardId: input.dealCardId,
    propertyCardId: Number.isInteger(Number(property.id)) ? Number(property.id) : null,
    status,
    address,
    city: text(property.city),
    county: text(property.county) ?? (jurisdictionParts[0]?.replace(/\s+County$/i, '') || null),
    state: text(property.state) ?? (jurisdictionParts.at(-1) ?? null),
    zip: text(property.zip),
    // Parcel-specific fields are retained only on a confirmed version. A
    // disputed/candidate/unresolved snapshot contains area context, not a
    // misleading canonical parcel.
    apn: status === 'confirmed'
      ? (acceptedLegacyIdentity ? (text(property.apn) ?? publicApn) : (publicApn ?? text(property.apn)))
      : null,
    owner: status === 'confirmed'
      ? (acceptedLegacyIdentity ? (text(property.owner) ?? publicOwner) : (publicOwner ?? text(property.owner)))
      : null,
    acreage: status === 'confirmed'
      ? (acceptedLegacyIdentity ? (cardAcres ?? publicAcres) : (publicAcres ?? cardAcres))
      : null,
    geometry: status === 'confirmed' ? (source?.orchestration?.subjectGeometry ?? null) : null,
    basis: status === 'confirmed'
      ? (legacyIdentity?.basis || `Official assessor/GIS record from ${countyTask(source)?.evidence[0]?.sourceName ?? 'public records'}.`)
      : status === 'disputed'
        ? 'Legacy parcel verdict and persisted official public run disagree; operator resolution is required.'
        : (legacyIdentity?.basis || 'Exact parcel identity has not been confirmed.'),
    confidence: status === 'confirmed'
      ? Math.max(legacyIdentity?.confidence ?? 0, 0.9)
      : status === 'disputed'
        ? 0
        : (legacyIdentity?.confidence ?? 0),
    sourceRefs: [...sourceRefs],
    changeReason: input.changeReason,
    createdBy: input.actor,
  };

  return synchronizePropertySummarySlice({
    identity,
    publicRun: status === 'confirmed' ? (resolved?.run ?? null) : (latest?.run ?? null),
  });
}

/** Pure read adapter for routes and tests. It performs SELECTs only. */
export function readPropertySummaryForDeal(dealCardId: number): PropertySummaryReadModel | null {
  return getPropertySummaryReadModel(dealCardId);
}
