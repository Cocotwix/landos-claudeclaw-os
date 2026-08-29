// Deal-level parcel scope projection.
//
// Binds `parcel-scope-context` to what a Deal has actually retained. A subject
// investigation drags in whatever sat next to the subject on the map, so this
// reads the retained parcel records back out, labels each one against the
// subject, and hands the Deal a view where a neighbouring owner's acreage and
// improvements can be displayed without ever reading as the subject's.
//
// Operator-confirmed context is stored as evidence like anything else, and is
// usable the moment it is given: nothing here waits for independent
// corroboration before the Deal is allowed to reason from it. What corroboration
// changes is the label, not the usability.

import { getLandosDb } from './db.js';
import {
  CORROBORATION_LABELS,
  LISTING_SCOPE_LABELS,
  OWNER_RELATION_LABELS,
  PARCEL_SCOPE_LABELS,
  classifyListingScope,
  classifyNeighborParcel,
  evaluateLandHomeTrigger,
  sameApn,
  type LandHomeTrigger,
  type ListingScopeAssessment,
  type NeighborParcelContext,
  type OperatorParcelContext,
} from './parcel-scope-context.js';

const OPERATOR_CONTEXT_DOMAIN = 'operator_context';
const OPERATOR_CONTEXT_FACT_KEY = 'Operator parcel context';

/** Read the operator-confirmed parcel context a Deal carries, if any. */
export function getOperatorParcelContext(dealCardId: number): OperatorParcelContext | null {
  const db = getLandosDb();
  const row = db.prepare(
    `SELECT normalized_value_json FROM landos_property_evidence_item
       WHERE deal_card_id=? AND domain=? AND fact_key=?
       ORDER BY id DESC LIMIT 1`,
  ).get(dealCardId, OPERATOR_CONTEXT_DOMAIN, OPERATOR_CONTEXT_FACT_KEY) as
    { normalized_value_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.normalized_value_json) as Partial<OperatorParcelContext>;
    if (typeof parsed?.statement !== 'string') return null;
    return {
      statement: parsed.statement,
      clusterApns: Array.isArray(parsed.clusterApns)
        ? parsed.clusterApns.filter((x): x is string => typeof x === 'string')
        : [],
      clusterParcelCount: typeof parsed.clusterParcelCount === 'number'
        ? parsed.clusterParcelCount
        : null,
      adjoiningManufacturedHome: parsed.adjoiningManufacturedHome === true,
      corroboration: parsed.corroboration === 'corroborated'
        || parsed.corroboration === 'contradicted'
        ? parsed.corroboration
        : 'operator_confirmed',
    };
  } catch {
    return null;
  }
}

/**
 * Persist operator-confirmed parcel context. Idempotent per Deal: the operator
 * restating the holding replaces the prior statement rather than stacking a
 * second one.
 */
export function saveOperatorParcelContext(
  dealCardId: number,
  context: OperatorParcelContext,
): void {
  const db = getLandosDb();
  const identity = db.prepare(
    `SELECT id FROM landos_property_identity_version
       WHERE deal_card_id=? ORDER BY id DESC LIMIT 1`,
  ).get(dealCardId) as { id: number } | undefined;
  if (!identity) return;
  const payload = JSON.stringify(context);
  db.prepare(
    `INSERT INTO landos_property_evidence_item
       (deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
        raw_value_json, normalized_value_json, source_name, source_tier,
        verification_status, confidence, collector_key, retrieved_at, idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       raw_value_json=excluded.raw_value_json,
       normalized_value_json=excluded.normalized_value_json,
       retrieved_at=excluded.retrieved_at`,
  ).run(
    dealCardId,
    identity.id,
    OPERATOR_CONTEXT_DOMAIN,
    'operator_statement',
    OPERATOR_CONTEXT_FACT_KEY,
    payload,
    payload,
    'Operator',
    'operator_statement',
    'operator_confirmed',
    'operator_confirmed',
    'operator:parcel_context',
    new Date().toISOString(),
    `operator-parcel-context:${dealCardId}`,
  );
}

/** One retained parcel record, reduced to the fields scope labelling needs. */
interface RetainedParcel {
  apn: string;
  owner: string | null;
  acres: number | null;
  buildingSqft: number | null;
}

function readNormalized(value: string | null | undefined): unknown {
  try { return JSON.parse(value ?? 'null'); } catch { return null; }
}

/**
 * Collect the distinct LandPortal parcel records a Deal retained, pairing each
 * APN with the owner, acreage, and building size recorded against it. A parcel
 * appears once no matter how many times research re-retained it.
 */
export function retainedParcelRecords(dealCardId: number): RetainedParcel[] {
  const db = getLandosDb();
  const rows = db.prepare(
    `SELECT fact_key, normalized_value_json, id FROM landos_property_evidence_item
       WHERE deal_card_id=? AND source_name LIKE '%LandPortal%'
       ORDER BY id ASC`,
  ).all(dealCardId) as { fact_key: string | null; normalized_value_json: string; id: number }[];

  // Evidence rows arrive one fact at a time with no parcel key, but a research
  // pass writes a parcel's facts together, so an APN row opens the record that
  // the rows after it describe until the next APN row.
  const byApn = new Map<string, RetainedParcel>();
  let current: RetainedParcel | null = null;
  for (const row of rows) {
    const key = row.fact_key ?? '';
    const value = readNormalized(row.normalized_value_json);
    if (key === 'LandPortal parcel identifier' && typeof value === 'string' && value.trim() !== '') {
      const apn = value.trim();
      const existing = byApn.get(apn);
      current = existing ?? { apn, owner: null, acres: null, buildingSqft: null };
      byApn.set(apn, current);
      continue;
    }
    if (current === null) continue;
    if (key === 'Owner shown on LandPortal parcel record' && typeof value === 'string') {
      current.owner ??= value.trim() === '' ? null : value.trim();
    } else if (key === 'LandPortal calculated acreage' && typeof value === 'number') {
      current.acres ??= value;
    } else if (key === 'Building square feet' && typeof value === 'number') {
      current.buildingSqft ??= value;
    }
  }
  return [...byApn.values()];
}

/**
 * Whether the subject reads as vacant land from its own retained record. Only
 * the subject's parcel record answers this: a neighbouring parcel carrying a
 * building has never said anything about whether the subject does.
 */
export function subjectIsVacantLand(dealCardId: number, subjectApn?: string | null): boolean {
  const apn = subjectApn ?? null;
  const subject = retainedParcelRecords(dealCardId)
    .find((parcel) => apn === null || sameApn(parcel.apn, apn));
  return subject?.buildingSqft === 0;
}

/** Retained marketplace listing facts, when research kept any. */
interface RetainedListing {
  acres: number | null;
  price: number | null;
  mentionsManufacturedHome: boolean;
  apn: string | null;
  source: string | null;
}

export function retainedListingFacts(dealCardId: number): RetainedListing | null {
  const db = getLandosDb();
  const rows = db.prepare(
    `SELECT fact_key, normalized_value_json, source_name FROM landos_property_evidence_item
       WHERE deal_card_id=? AND domain IN ('listing','marketplace','market_listing')
       ORDER BY id DESC`,
  ).all(dealCardId) as
    { fact_key: string | null; normalized_value_json: string; source_name: string }[];
  if (rows.length === 0) return null;
  const listing: RetainedListing = {
    acres: null, price: null, mentionsManufacturedHome: false, apn: null, source: null,
  };
  for (const row of rows) {
    const key = (row.fact_key ?? '').toLowerCase();
    const value = readNormalized(row.normalized_value_json);
    listing.source ??= row.source_name;
    if (listing.acres === null && /acre/.test(key) && typeof value === 'number') listing.acres = value;
    if (listing.price === null && /price/.test(key) && typeof value === 'number') listing.price = value;
    if (listing.apn === null && /apn|parcel/.test(key) && typeof value === 'string' && value.trim() !== '') {
      listing.apn = value.trim();
    }
    if (/manufactured|mobile|home type|property type/.test(key)
      && typeof value === 'string'
      && /manufactured|mobile/i.test(value)) {
      listing.mentionsManufacturedHome = true;
    }
  }
  return listing;
}

export interface DealParcelScopeView {
  subjectApn: string | null;
  subjectOwner: string | null;
  subjectAcres: number | null;
  subjectIsVacant: boolean;
  operatorContext: (OperatorParcelContext & { corroborationLabel: string }) | null;
  neighbors: (NeighborParcelContext & { scopeLabel: string; ownerRelationLabel: string })[];
  listing: (ListingScopeAssessment & {
    acres: number | null;
    price: number | null;
    source: string | null;
  }) | null;
  landHome: LandHomeTrigger;
  /** Named so the Deal can state plainly what may not travel into subject facts. */
  subjectFactGuard: string;
}

/**
 * Build the Deal's parcel-scope view.
 *
 * The subject is taken from the Deal's own resolved identity and is never
 * recomputed here: this labels what surrounds the subject, and a scope label has
 * no business changing the parcel it is measured against.
 */
export function buildDealParcelScopeView(input: {
  dealCardId: number;
  subjectApn: string | null;
  subjectOwner: string | null;
  subjectAcres: number | null;
  subjectIsVacant: boolean;
}): DealParcelScopeView {
  const operator = getOperatorParcelContext(input.dealCardId);
  const clusterApns = operator?.clusterApns ?? [];

  const neighbors = retainedParcelRecords(input.dealCardId)
    .filter((parcel) => !sameApn(parcel.apn, input.subjectApn))
    .map((parcel) => {
      const classified = classifyNeighborParcel(input.subjectApn, input.subjectOwner, {
        apn: parcel.apn,
        displayedOwner: parcel.owner,
        improvement: parcel.buildingSqft == null
          ? 'unknown'
          : parcel.buildingSqft > 0 ? 'improved' : 'vacant',
        source: 'LandPortal parcel record',
        operatorConfirmedClusterApns: clusterApns,
      });
      return {
        ...classified,
        scopeLabel: PARCEL_SCOPE_LABELS[classified.scope],
        ownerRelationLabel: OWNER_RELATION_LABELS[classified.ownerRelation],
      };
    });

  const retainedListing = retainedListingFacts(input.dealCardId);
  const listing = retainedListing === null ? null : {
    ...classifyListingScope({
      listingAcres: retainedListing.acres,
      listingApn: retainedListing.apn,
      mentionsManufacturedHome: retainedListing.mentionsManufacturedHome,
      subjectApn: input.subjectApn,
      subjectAcres: input.subjectAcres,
      subjectIsVacant: input.subjectIsVacant,
      clusterParcelCount: operator?.clusterParcelCount ?? null,
    }),
    acres: retainedListing.acres,
    price: retainedListing.price,
    source: retainedListing.source,
  };

  // The trigger reads the operator's statement, never a neighbouring record: a
  // manufactured home on somebody else's land says nothing about this seller's
  // holding, and that confusion is exactly what this view exists to prevent.
  const landHome = evaluateLandHomeTrigger({
    adjoiningManufacturedHome: operator?.adjoiningManufacturedHome === true,
  });

  return {
    subjectApn: input.subjectApn,
    subjectOwner: input.subjectOwner,
    subjectAcres: input.subjectAcres,
    subjectIsVacant: input.subjectIsVacant,
    operatorContext: operator === null
      ? null
      : { ...operator, corroborationLabel: CORROBORATION_LABELS[operator.corroboration] },
    neighbors,
    listing,
    landHome,
    subjectFactGuard:
      'Only the subject parcel supplies subject facts. Acreage, improvements, home size, and '
      + 'listing price recorded against a related, neighbouring, or cluster-scoped parcel stay '
      + 'with that parcel and never become subject truth or vacant-land comparables.',
  };
}

export { LISTING_SCOPE_LABELS };
