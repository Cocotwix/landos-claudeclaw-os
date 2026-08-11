// SUBJECT IDENTITY RECONCILIATION — intake is evidence, not truth.
//
// A lead feed supplies a mixture of correct and incorrect information. LandOS
// must reconcile it against stronger evidence instead of either trusting the
// feed or making the operator delete and recreate the lead.
//
// The acceptance case is deal 83 / 9490 Elk Lake Rd. The feed supplied
// "9490 elk lake rd, Williamsburg 46960" — a real street address in a real
// town with an Indiana ZIP pasted onto a Michigan property. That one wrong
// field was enough to leave the property card with NO city, county, state, ZIP,
// APN or acreage, and the card never recovered:
//
//   • Research lanes read their input from that empty card, so every lane fanned
//     out on the bare string "9490 elk lake rd".
//   • LandPortal nevertheless resolved the parcel and returned provider-verified
//     APN, owner and acreage — but its panel prints no county and no state, so
//     the discovery gate rejected the match for want of a jurisdiction, and
//     `discovery.patch` was rendered into a snapshot and then discarded.
//   • Nothing wrote a resolved identity back. Twelve consecutive operator reruns
//     therefore produced the identical nothing.
//
// This module is the missing step: it gathers every identity claim attached to a
// Deal Card, decides ONE canonical answer per field with a stated reason, and
// persists it — to the property card that lanes read, and to the versioned
// identity slice that the Property Summary reads.
//
// What it will not do:
//   • It never invents a jurisdiction. A county name is read from the Census
//     Bureau or derived from a provider's own FIPS key; an unreadable county
//     stays null.
//   • It never promotes a retrieval failure into a finding.
//   • It never silently overwrites the raw intake. The original address and ZIP
//     are preserved in the card's prior-inputs history and named in the change
//     reason, so an operator can always see what the feed said.
//   • It never supersedes an identity the operator has already accepted
//     (`confirmed`) without explicit authority — that guard lives in
//     `createPropertyIdentityVersion` and is deliberately not bypassed here.

import { logger } from '../logger.js';
import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { getPropertyCardRow, loadPropertyInspection, upsertPropertyCard } from './property-card.js';
import { resolveCensusGeography, type CensusGeography } from './land-use-authority.js';
import {
  bareCountyName,
  countyNamesAgree,
  decodeLandPortalCanonicalIdentity,
  stateNamesAgree,
  uspsFromStateName,
} from './landportal-canonical-identity.js';
import {
  createPropertyIdentityVersion,
  readCurrentPropertyIdentity,
  type PropertyIdentityStatus,
} from './property-summary-slice.js';
import type { LandosEntity } from './db.js';

/** Where a single accepted identity value came from. */
export type IdentitySourceId =
  | 'raw_intake'
  | 'census_geography'
  | 'landportal_canonical_url'
  | 'landportal_parcel_panel'
  | 'retained_card';

export const IDENTITY_SOURCE_LABELS: Record<IdentitySourceId, string> = {
  raw_intake: 'Operator/feed intake',
  census_geography: 'U.S. Census Bureau geography service',
  landportal_canonical_url: 'LandPortal canonical parcel identifier',
  landportal_parcel_panel: 'LandPortal authenticated parcel panel',
  retained_card: 'Previously retained property record',
};

export type IdentityField =
  | 'address' | 'city' | 'county' | 'state' | 'zip'
  | 'apn' | 'owner' | 'acreage' | 'fips' | 'lpPropertyId' | 'lat' | 'lng';

export interface IdentityFieldResolution {
  field: IdentityField;
  /** What the card carried before this reconciliation. */
  from: string | null;
  /** What the card carries after it. */
  to: string | null;
  acceptedFrom: IdentitySourceId;
  /** Independent sources that agreed on this value. */
  agreedBy: IdentitySourceId[];
  reason: string;
  /** True when this reconciliation replaced a different retained value. */
  superseded: boolean;
}

export interface SubjectIdentityReconciliation {
  dealCardId: number;
  propertyCardId: number | null;
  status: PropertyIdentityStatus;
  confidence: number;
  basis: string;
  /** Every field this reconciliation decided, changed or not. */
  fields: IdentityFieldResolution[];
  /** Only the fields whose value actually changed. */
  changes: IdentityFieldResolution[];
  conflicts: string[];
  sourceRefs: string[];
  rawIntake: { address: string | null; zip: string | null; text: string | null };
  /** True when the resolved identity was written to the card and versioned. */
  persisted: boolean;
  persistWarnings: string[];
  /** Set when reconciliation could not run at all (no card, no evidence). */
  skippedReason: string | null;
}

function text(value: unknown): string | null {
  const result = String(value ?? '').trim();
  return result && result !== '-' && result.toLowerCase() !== 'null' ? result : null;
}

function num(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A US ZIP as five digits, or null. ZIP+4 keeps only the routing prefix. */
function zip5(value: unknown): string | null {
  const match = /\b(\d{5})(?:-\d{4})?\b/.exec(String(value ?? ''));
  return match?.[1] ?? null;
}

function apnKey(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * A Census `matchedAddress` is "9490 ELK LAKE RD, WILLIAMSBURG, MI, 49690".
 * Pull the city and ZIP the federal address file assigned to the point — this
 * is what corrects a transposed or pasted-in ZIP.
 */
function partsFromMatchedAddress(matched: string | null): { city: string | null; zip: string | null } {
  if (!matched) return { city: null, zip: null };
  const segments = matched.split(',').map((part) => part.trim()).filter(Boolean);
  const zip = zip5(segments[segments.length - 1] ?? '') ?? zip5(matched);
  // Second segment is the city in every shape the geocoder returns.
  const city = segments.length >= 2 ? (text(segments[1]) ?? null) : null;
  const titled = city
    ? city.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : null;
  return { city: titled, zip };
}

export interface ReconcileSubjectIdentityOptions {
  /** Who is asking. Recorded on the identity version. */
  actor?: string;
  /** Skip the network call (tests, and reruns that already have a geography). */
  censusGeography?: CensusGeography | null;
  /** Resolve without writing. Used to show an operator what WOULD change. */
  dryRun?: boolean;
  fetchText?: Parameters<typeof resolveCensusGeography>[1] extends { fetchText?: infer F } ? F : never;
}

/**
 * Reconcile the canonical subject identity for a Deal Card from every claim
 * attached to it, and persist the result.
 *
 * Precedence is per FIELD, because sources are authoritative about different
 * things:
 *
 *   jurisdiction (county, state)  Census geography and the provider's own FIPS
 *                                 key are independent and are cross-checked
 *                                 against each other. Agreement raises
 *                                 confidence; disagreement is a named conflict
 *                                 and NOTHING is written for those fields.
 *   postal (city, ZIP)            The federal address file wins over intake —
 *                                 that is the whole point of the exercise.
 *   parcel (APN, FIPS, property   The authenticated provider's canonical
 *   id, owner, acreage)           identifier and panel, which is where a real
 *                                 APN and owner come from at discovery stage.
 *   address                       Intake wins. The operator's street address is
 *                                 the lead; the geocoder's normalisation is
 *                                 recorded but does not rename the property.
 */
export async function reconcileSubjectIdentity(
  dealCardId: number,
  options: ReconcileSubjectIdentityOptions = {},
): Promise<SubjectIdentityReconciliation> {
  const actor = options.actor ?? 'subject-identity-reconciliation';
  const empty = (skippedReason: string): SubjectIdentityReconciliation => ({
    dealCardId,
    propertyCardId: null,
    status: 'unresolved',
    confidence: 0,
    basis: skippedReason,
    fields: [],
    changes: [],
    conflicts: [],
    sourceRefs: [],
    rawIntake: { address: null, zip: null, text: null },
    persisted: false,
    persistWarnings: [],
    skippedReason,
  });

  const deal = getDealCard(dealCardId);
  if (!deal) return empty(`Deal Card ${dealCardId} does not exist.`);
  const resolution = resolveSubjectPropertyCard(deal);
  const cardId = resolution.cardId;
  if (!cardId) return empty('This Deal Card has no subject property record to reconcile.');
  const card = getPropertyCardRow(cardId);
  if (!card) return empty(`Property card ${cardId} does not exist.`);

  // ── The raw intake, preserved exactly as the feed supplied it ─────────────
  const intakeAddress = text(card.active_input_address);
  const intakeText = text(card.summary) ?? text((deal as { seller_notes?: string }).seller_notes);
  const intakeZip = zip5(card.zip) ?? zip5(intakeText);
  const rawIntake = { address: intakeAddress, zip: intakeZip, text: intakeText };

  // ── Evidence: the provider's own canonical parcel key ─────────────────────
  const inspection = loadPropertyInspection(cardId);
  const parcelUrl = text(inspection?.parcelUrl);
  const canonical = decodeLandPortalCanonicalIdentity(parcelUrl)
    ?? decodeLandPortalCanonicalIdentity(text(card.lp_url));
  const parcelFacts = inspection?.parcelFacts ?? {};
  const panelApn = text(parcelFacts['Parcel ID']) ?? text(parcelFacts['APN']);
  const panelOwner = text(parcelFacts['Owner Name']);
  const panelAcres = num(parcelFacts['Acres']) ?? num(parcelFacts['Calc Acres']);

  // ── Evidence: the federal address file ────────────────────────────────────
  // The one-line route reconciles messy operator text and returns the county,
  // state and the ZIP the address actually has. It is the same service the
  // land-use authority engine already trusts for this decision.
  let census: CensusGeography | null = options.censusGeography ?? null;
  if (census === null && options.censusGeography === undefined) {
    const oneLine = intakeText && intakeText.includes(',')
      ? intakeText
      : [intakeAddress, text(card.city), text(card.state)].filter(Boolean).join(', ');
    try {
      census = await resolveCensusGeography(
        {
          address: intakeAddress,
          city: text(card.city),
          state: text(card.state),
          latitude: card.lat == null ? null : Number(card.lat),
          longitude: card.lng == null ? null : Number(card.lng),
          oneLine,
        },
        options.fetchText ? { fetchText: options.fetchText } : {},
      );
    } catch (err) {
      logger.warn({ err, dealCardId, cardId }, 'subject_identity_census_lookup_failed');
      census = null;
    }
  }

  const censusCounty = bareCountyName(census?.county);
  const censusState = uspsFromStateName(census?.state);
  const matchedParts = partsFromMatchedAddress(census?.matchedAddress ?? null);

  // ── Jurisdiction: two independent claims, cross-checked ───────────────────
  const canonicalState = canonical?.state ?? null;
  const conflicts: string[] = [];
  let county: string | null = null;
  let state: string | null = null;
  let countySource: IdentitySourceId | null = null;
  let stateSource: IdentitySourceId | null = null;
  let countyAgreedBy: IdentitySourceId[] = [];
  let stateAgreedBy: IdentitySourceId[] = [];

  if (censusState && canonicalState && !stateNamesAgree(censusState, canonicalState)) {
    // Two authoritative sources naming different states is never a formatting
    // difference. Neither is written; the Deal Card says so out loud.
    conflicts.push(
      `Jurisdiction conflict: the Census Bureau places this address in ${censusState}, while the LandPortal canonical parcel identifier (FIPS ${canonical?.fips}) is in ${canonicalState}. The subject jurisdiction is not resolved until one is accepted.`,
    );
  } else {
    if (censusState) { state = censusState; stateSource = 'census_geography'; stateAgreedBy = ['census_geography']; }
    if (canonicalState) {
      if (state) stateAgreedBy = [...stateAgreedBy, 'landportal_canonical_url'];
      else { state = canonicalState; stateSource = 'landportal_canonical_url'; stateAgreedBy = ['landportal_canonical_url']; }
    }
    if (censusCounty) {
      county = censusCounty;
      countySource = 'census_geography';
      countyAgreedBy = ['census_geography'];
      // The provider's FIPS agrees on the county only if it agrees on the
      // state; a county name alone is not unique across states.
      if (canonical && canonicalState && stateNamesAgree(censusState ?? canonicalState, canonicalState)) {
        countyAgreedBy = [...countyAgreedBy, 'landportal_canonical_url'];
      }
    }
  }

  // Retained values are the floor: reconciliation may fill or correct a field,
  // never blank one that already had a value.
  const retainedCounty = bareCountyName(card.county);
  const retainedState = text(card.state);
  if (!county && retainedCounty) { county = retainedCounty; countySource = 'retained_card'; countyAgreedBy = ['retained_card']; }
  if (!state && retainedState) { state = retainedState; stateSource = 'retained_card'; stateAgreedBy = ['retained_card']; }

  if (county && retainedCounty && !countyNamesAgree(county, retainedCounty)) {
    conflicts.push(
      `County conflict: the retained record says ${retainedCounty}, stronger evidence says ${county}. The stronger evidence was applied and the prior value is retained in history.`,
    );
  }

  // ── Parcel identity ───────────────────────────────────────────────────────
  if (canonical && panelApn && apnKey(canonical.apn) !== apnKey(panelApn)) {
    conflicts.push(
      `Parcel identifier conflict: the LandPortal canonical identifier carries APN ${canonical.apn} while its parcel panel shows ${panelApn}. They are not formatting variants, so the parcel is not resolved.`,
    );
  }
  const retainedApn = text(card.apn);
  const apn = conflicts.length && canonical && panelApn && apnKey(canonical.apn) !== apnKey(panelApn)
    ? retainedApn
    : (canonical?.apn ?? panelApn ?? retainedApn);
  const apnSource: IdentitySourceId | null = apn == null
    ? null
    : canonical?.apn && apnKey(apn) === apnKey(canonical.apn)
      ? 'landportal_canonical_url'
      : panelApn && apnKey(apn) === apnKey(panelApn)
        ? 'landportal_parcel_panel'
        : 'retained_card';
  const apnAgreedBy: IdentitySourceId[] = apn && canonical?.apn && panelApn
    && apnKey(canonical.apn) === apnKey(panelApn) && apnKey(apn) === apnKey(panelApn)
    ? ['landportal_canonical_url', 'landportal_parcel_panel']
    : apnSource ? [apnSource] : [];

  const owner = panelOwner ?? text(card.owner);
  const acreage = panelAcres ?? num(card.acres);
  const fips = canonical?.fips ?? text(card.fips);
  const lpPropertyId = canonical?.propertyId ?? text(card.lp_property_id);
  const city = matchedParts.city ?? text(card.city);
  const zip = matchedParts.zip ?? zip5(card.zip);
  const lat = census?.latitude ?? (card.lat == null ? null : Number(card.lat));
  const lng = census?.longitude ?? (card.lng == null ? null : Number(card.lng));

  // ── Assemble the per-field record ─────────────────────────────────────────
  const fields: IdentityFieldResolution[] = [];
  const record = (
    field: IdentityField,
    from: string | null,
    to: string | null,
    acceptedFrom: IdentitySourceId | null,
    agreedBy: IdentitySourceId[],
    reason: string,
  ): void => {
    if (to == null || !acceptedFrom) return;
    fields.push({
      field,
      from,
      to,
      acceptedFrom,
      agreedBy: agreedBy.length ? agreedBy : [acceptedFrom],
      reason,
      superseded: from != null && from !== to,
    });
  };

  record('county', retainedCounty, county, countySource, countyAgreedBy,
    countyAgreedBy.length > 1
      ? 'The Census Bureau and the provider\'s own county FIPS independently name the same county.'
      : 'Named by the strongest jurisdiction source available; no second source corroborated it.');
  record('state', retainedState, state, stateSource, stateAgreedBy,
    stateAgreedBy.length > 1
      ? 'The Census Bureau and the provider\'s own county FIPS independently name the same state.'
      : 'Named by the strongest jurisdiction source available; no second source corroborated it.');
  record('zip', zip5(card.zip) ?? intakeZip, zip,
    matchedParts.zip ? 'census_geography' : zip ? 'retained_card' : null, [],
    matchedParts.zip && intakeZip && matchedParts.zip !== intakeZip
      ? `The intake ZIP ${intakeZip} does not belong to this address. The federal address file assigns ${matchedParts.zip}; the intake value is preserved in history.`
      : 'The federal address file confirms the postal code carried on this record.');
  record('city', text(card.city), city, matchedParts.city ? 'census_geography' : city ? 'retained_card' : null, [],
    'The federal address file names the place this address falls in.');
  record('apn', retainedApn, apn, apnSource, apnAgreedBy,
    apnAgreedBy.length > 1
      ? 'The provider\'s canonical parcel identifier and its parcel panel carry the same APN.'
      : 'Carried by the authenticated provider record for this parcel.');
  record('fips', text(card.fips), fips, canonical ? 'landportal_canonical_url' : fips ? 'retained_card' : null, [],
    'The provider addresses this parcel by county FIPS; it is the same key the jurisdiction was derived from.');
  record('lpPropertyId', text(card.lp_property_id), lpPropertyId,
    canonical ? 'landportal_canonical_url' : lpPropertyId ? 'retained_card' : null, [],
    'The provider\'s own primary key for this parcel page.');
  record('owner', text(card.owner), owner, panelOwner ? 'landportal_parcel_panel' : owner ? 'retained_card' : null, [],
    'Recorded owner as published on the authenticated parcel panel. Not a title search.');
  record('acreage', card.acres == null ? null : String(card.acres), acreage == null ? null : String(acreage),
    panelAcres ? 'landportal_parcel_panel' : acreage == null ? null : 'retained_card', [],
    'Assessed acreage as published on the authenticated parcel panel.');

  const changes = fields.filter((field) => field.superseded);

  // ── Status and confidence ─────────────────────────────────────────────────
  // `confirmed` is reserved for an official county parcel record. A provider
  // panel cross-checked against federal geography is a strong CANDIDATE — good
  // enough to research from, never presented as official verification.
  const existing = readCurrentPropertyIdentity(dealCardId);
  const jurisdictionResolved = !!county && !!state;
  const parcelResolved = !!apn;
  const status: PropertyIdentityStatus = conflicts.length > 0
    ? 'disputed'
    : jurisdictionResolved && parcelResolved
      ? 'candidate'
      : 'unresolved';
  const confidence = status === 'candidate'
    ? (countyAgreedBy.length > 1 && apnAgreedBy.length > 1 ? 0.9 : 0.75)
    : status === 'disputed' ? 0.2 : 0;

  const sourceRefs = [
    ...(parcelUrl ? [parcelUrl] : []),
    ...(census?.sourceUrl ? [census.sourceUrl] : []),
  ];

  const basis = status === 'candidate'
    ? `Subject reconciled to APN ${apn} in ${county} County, ${state}${zip ? ` ${zip}` : ''}. ${
      countyAgreedBy.length > 1
        ? 'Jurisdiction is corroborated by the U.S. Census Bureau geography service and the provider\'s own county FIPS key independently.'
        : 'Jurisdiction rests on a single source.'
    } No official county parcel record has confirmed this identity, so it is a research-grade candidate, not an official verification.`
    : status === 'disputed'
      ? `Subject identity is disputed: ${conflicts[0]}`
      : 'Subject identity remains unresolved; no source supplied both a parcel identifier and a jurisdiction.';

  const result: SubjectIdentityReconciliation = {
    dealCardId,
    propertyCardId: cardId,
    status,
    confidence,
    basis,
    fields,
    changes,
    conflicts,
    sourceRefs,
    rawIntake,
    persisted: false,
    persistWarnings: [],
    skippedReason: null,
  };

  if (options.dryRun) return result;
  if (status === 'unresolved' && !changes.length) return result;

  // ── Persist ───────────────────────────────────────────────────────────────
  // The property card is what every research lane reads its input from, so it
  // is written first; the versioned slice records WHY it changed.
  try {
    const priorInputAddress = intakeZip && zip && intakeZip !== zip && intakeAddress
      ? `${intakeAddress}, ${text(card.city) ?? matchedParts.city ?? ''} ${intakeZip}`.replace(/\s+/g, ' ').trim()
      : undefined;
    const upsert = upsertPropertyCard({
      entity: card.entity as LandosEntity,
      activeInputAddress: intakeAddress ?? '',
      cardId,
      ...(city ? { city } : {}),
      ...(county ? { county } : {}),
      ...(state ? { state } : {}),
      ...(zip ? { zip } : {}),
      ...(apn ? { apn } : {}),
      ...(fips ? { fips } : {}),
      ...(lpPropertyId ? { lpPropertyId } : {}),
      ...(parcelUrl ? { lpUrl: parcelUrl } : {}),
      ...(owner ? { owner } : {}),
      ...(acreage == null ? {} : { acres: acreage }),
      ...(lat == null ? {} : { lat }),
      ...(lng == null ? {} : { lng }),
      ...(priorInputAddress ? { priorInputAddress } : {}),
      agentId: actor,
    } as Parameters<typeof upsertPropertyCard>[0]);
    result.persistWarnings = upsert.warnings;

    const changeReason = changes.length
      ? `Reconciled from ${changes.length} superseded value(s): ${changes
        .map((change) => `${change.field} ${change.from ?? '—'} → ${change.to}`)
        .join('; ')}. Raw intake preserved${rawIntake.zip ? ` (feed supplied ZIP ${rawIntake.zip})` : ''}.`
      : 'Reconciled the subject identity from retained research evidence; no previously retained value was replaced.';

    createPropertyIdentityVersion({
      dealCardId,
      propertyCardId: cardId,
      status,
      address: intakeAddress,
      city,
      county,
      state,
      zip,
      apn,
      owner,
      acreage,
      basis,
      confidence,
      sourceRefs,
      changeReason,
      createdBy: actor,
    });
    result.persisted = true;
    logger.info({
      dealCardId,
      cardId,
      status,
      changed: changes.map((change) => change.field),
      conflicts: conflicts.length,
      priorIdentityVersion: existing?.version ?? null,
    }, 'subject_identity_reconciled');
  } catch (err) {
    logger.warn({ err, dealCardId, cardId }, 'subject_identity_persist_failed');
    result.persistWarnings = [
      ...result.persistWarnings,
      `Identity persistence failed: ${err instanceof Error ? err.message : String(err)}`,
    ];
  }

  return result;
}
