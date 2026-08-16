import { dealCardsAwaitingCanonicalReconciliation, nameCardFromCanonicalIdentity, resolveCanonicalIdentity } from './canonical-identity.js';
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
  allowAcceptedSupersession?: boolean;
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
    allowAcceptedSupersession: input.allowAcceptedSupersession,
  };

  const model = synchronizePropertySummarySlice({
    identity,
    publicRun: status === 'confirmed' ? (resolved?.run ?? null) : (latest?.run ?? null),
  });

  // The seam that makes an accepted identity durable also makes it VISIBLE.
  if (status === 'confirmed') nameCardFromCanonicalIdentity(input.dealCardId, input.actor);

  return model;
}

/** Pure read adapter for routes and tests. It performs SELECTs only. */
export function readPropertySummaryForDeal(dealCardId: number): PropertySummaryReadModel | null {
  return getPropertySummaryReadModel(dealCardId);
}

/**
 * WRITE. Build the durable versioned Property Summary for an identity the
 * operator has already accepted.
 *
 * Confirming a parcel wrote the legacy verdict; if the versioned slice was never
 * built, the Deal Card showed a confirmed parcel in one panel and an unresolved,
 * pipeline-locked property in another. Called at confirmation time and by startup
 * recovery — never from a GET, so opening or refreshing a Deal Card stays
 * read-only. Idempotent: it does nothing unless a reconciliation is actually owed.
 */
export function reconcileCanonicalIdentity(input: {
  dealCardId: number;
  actor: string;
  changeReason: string;
}): { reconciled: boolean; reason: string } {
  const canonical = resolveCanonicalIdentity(input.dealCardId);
  if (!canonical.confirmed) return { reconciled: false, reason: 'No accepted canonical identity to reconcile.' };
  if (!canonical.versionPending) return { reconciled: false, reason: 'Versioned identity already agrees with the accepted verdict.' };
  synchronizePropertySummaryForDeal({
    dealCardId: input.dealCardId,
    actor: input.actor,
    changeReason: input.changeReason,
  });
  return { reconciled: true, reason: 'Built the versioned Property Summary from the accepted canonical identity.' };
}

/**
 * Startup recovery: reconcile every Deal Card whose parcel identity was accepted
 * but whose versioned slice was never built, so a card confirmed by an older code
 * path stops contradicting itself. Failures are isolated per card.
 */
export function reconcileAllPendingCanonicalIdentities(actor = 'canonical-identity-recovery'): {
  inspected: number; reconciled: number; failed: number;
} {
  const dealCardIds = dealCardsAwaitingCanonicalReconciliation();
  let reconciled = 0, failed = 0;
  for (const dealCardId of dealCardIds) {
    try {
      if (reconcileCanonicalIdentity({
        dealCardId,
        actor,
        changeReason: 'Startup reconciliation: accepted canonical identity had no versioned Property Summary.',
      }).reconciled) reconciled += 1;
    } catch { failed += 1; }
  }
  return { inspected: dealCardIds.length, reconciled, failed };
}
