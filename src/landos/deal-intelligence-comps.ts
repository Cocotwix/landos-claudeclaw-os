// The operator-facing comp working set — Phase 5 comp correction.
//
// The Deal Card was rendering four comp pipelines at once: the current snapshot,
// the legacy comp-map registry, the raw LandPortal table and an ownerAnalysis
// "fair market value". They disagreed on accepted counts, on active counts and
// on whether the parcel was priceable at all. This module produces the ONE set
// the operator reads, so the snapshot can be the single answer.
//
// What it decides, and nothing else:
//   • which comps are the working set (at most five sold, at most five active),
//   • which rows are evidence-only, with a COUNT and a reason instead of a wall
//     of rejection text,
//   • how a LandPortal row is classified when the source never stated a status,
//   • which of the three valuation conclusions the evidence actually supports.
//
// It does NOT collect, score value, or decide strategy. Pure: no I/O, no clock.
//
// Two rules are structural rather than advisory:
//   1. LandPortal, Zillow, Redfin and direct Realtor.com property evidence may
//      enter the current handback.
//      HomeHarvest and Realie stay in historical storage only; they never enter
//      current counts, maps, snapshots, rendering, or valuation.
//   2. Nothing here consults an assessor, recorder, deed or parcel record. A
//      comp's status comes from the marketplace that published it.

import type { CompSourcePolicyResult } from './comp-source-policy.js';
import { listingPhotoPriority } from './comp-visual.js';
import {
  buildAcreageMarketContext,
  compDistanceMiles,
  inAcreagePool,
  resolveGeographicTier,
  routeAcreage,
  routedAcreageSimilarity,
  type AcreageMarketContext,
  type AcreageRoute,
} from './acreage-router.js';
import type {
  SnapshotComp, SnapshotComps, SnapshotRejectedComp, SnapshotValuation,
} from './property-intelligence-snapshot.js';

/** At most this many rows in each operator-facing lane. */
export const WORKING_SET_LIMIT = 5;
/** At most this many active listings in the operator-facing lane. */
export const ACTIVE_WORKING_SET_LIMIT = 4;

/** Marketplaces whose rows may price or compete with the subject. */
export const WORKING_SET_SOURCES = [/landportal/i, /zillow/i, /redfin/i, /realtor(?:\.com)?/i];

/** Aggregators retained as evidence only. They never enter the working set. */
export const EVIDENCE_ONLY_SOURCES = [/homeharvest/i, /realie/i];

export function isWorkingSetSource(source: string | null | undefined): boolean {
  const value = (source ?? '').trim();
  if (!value) return false;
  if (EVIDENCE_ONLY_SOURCES.some((pattern) => pattern.test(value))) return false;
  return WORKING_SET_SOURCES.some((pattern) => pattern.test(value));
}

export function isEvidenceOnlySource(source: string | null | undefined): boolean {
  return EVIDENCE_ONLY_SOURCES.some((pattern) => pattern.test((source ?? '').trim()));
}

/**
 * How a comp row's transaction status was established.
 *
 * `unconfirmed` is a first-class answer, not a missing value: LandPortal
 * publishes priced rows with no sale-or-list wording anywhere on the row or its
 * section heading, and calling those "sold" would invent the one fact that
 * decides whether they may price the subject.
 */
export type CompStatusBasis = 'closed_sale' | 'active_listing' | 'unconfirmed';

export function landPortalSaleStatus(row: {
  source: string;
  dateIso: string | null;
  priceKind?: string | null;
}): { statusBasis: CompStatusBasis; provenance: string } {
  if (!/landportal/i.test(row.source)) {
    return { statusBasis: 'unconfirmed', provenance: 'Not evaluated: this helper governs LandPortal rows only.' };
  }
  const statedDate = row.dateIso?.trim() ?? '';
  if (!statedDate || !Number.isFinite(Date.parse(statedDate))) {
    return { statusBasis: 'unconfirmed', provenance: 'LandPortal did not state a parseable sale date.' };
  }
  return {
    statusBasis: 'closed_sale',
    provenance: `LandPortal stated the sale date ${statedDate}.`,
  };
}

export interface CompCandidateRow {
  key: string;
  /** Provider-owned property/listing identifier, when exposed. */
  providerId?: string | null;
  /** The comp's assessor parcel number, exactly as the source stated it. */
  apn?: string | null;
  address: string | null;
  source: string;
  sourceUrl: string | null;
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  dateIso: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  views?: number | null;
  saves?: number | null;
  priceChanges?: Array<{ at: string | null; price: number | null; note: string }>;
  thumbnailUrl?: string | null;
  photoUrls?: string[];
  collectedAt?: string | null;
  distanceMiles: number | null;
  lat?: number | null;
  lng?: number | null;
  /** Vacant land, improved, or unknown. */
  landClass: 'vacant_land' | 'improved' | 'unknown';
  /** Retained only for the dedicated land-home lane. It never changes the
   *  vacant-land classification or valuation decision. */
  improvedClass?: 'manufactured' | 'residential' | 'commercial' | null;
  statusBasis: CompStatusBasis;
  /** Locality the row sits in, for same-market scoring. */
  locality: string | null;
  /**
   * The comp source policy's stated reason this row may not enter the working
   * set — a wrong-market rejection, or a sold row the policy did not accept
   * (an over-cap supplement, for instance). Selection buckets the row under
   * this reason; without it, a policy-rejected row with in-band acreage would
   * re-enter the very set the policy excluded it from.
   */
  policyExcluded?: string | null;
  /** Priced acreage irreconcilable with the parcel record; carries no acreage. */
  acreageConflict?: boolean;
  /** All marketplaces that corroborated this physical property/event. */
  providerAttributions?: string[];
  /** Number of provider rows collapsed into this canonical property beyond the
   * one row retained. This is provenance, never another comp count. */
  duplicatesMerged?: number;
  /** Optional normalized (0-1) subject-similarity signals. Missing is neutral. */
  accessSimilarity?: number | null;
  terrainSimilarity?: number | null;
  /**
   * Terrain similarity may affect selection only when the source/calculation
   * has been checked for the correct parcel, units and geometry. Deal 64 showed
   * why a bare terrain percentage is not trustworthy enough to rank comps.
   */
  terrainSimilarityReliable?: boolean;
  utilitiesSimilarity?: number | null;
  developmentContextSimilarity?: number | null;
  /** Manufactured-home detail retained for the dedicated land-home lane. */
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
}

export interface CompSelectionSubject {
  acres: number | null;
  locality: string | null;
  county: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Canonical subject identifiers used only to keep the subject itself out of
   *  the comparable working set. A current listing for the subject remains
   *  evidence/seller context, never an "active competitor." */
  address?: string | null;
  apn?: string | null;
}

export interface CompEvidenceBucket {
  reason: string;
  count: number;
  sources: string[];
}

export interface CompWorkingSet {
  sold: WeightedSnapshotComp[];
  active: WeightedSnapshotComp[];
  /** Recent, nearby, qualifying manufactured-home closed sales. This is a
   *  separate strategy lane and never enters vacant-land value. */
  landHomeOnly: WeightedSnapshotComp[];
  /** Close-acreage rows whose status the source never stated. Shown prominently
   *  as an asking-market reference, never as sold evidence. */
  askingReferences: WeightedSnapshotComp[];
  evidence: CompEvidenceBucket[];
  duplicatesRemoved: number;
  totalCollected: number;
  /** The ONE conclusion the evidence supports. */
  conclusion: CompConclusion;
  acreageRouting: AcreageRoute | null;
  geographicExpansion: string;
  acreageMarketContext: AcreageMarketContext | null;
}

/**
 * Runtime-compatible extension of SnapshotComp. Older stored snapshots remain
 * readable, while new selections expose the actual weight and material
 * differences the operator needs to judge the comp.
 */
export interface WeightedSnapshotComp extends SnapshotComp {
  weight: number;
  weightLabel: 'strong' | 'moderate' | 'limited';
  materialDifferences: string[];
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
  thumbnailUrl?: string | null;
  photoUrls?: string[];
  duplicatesMerged?: number;
}

export type CompConclusion =
  /** Usable in-band closed sales exist; a value band may be stated from them. */
  | 'sold_supported'
  /** Only active or status-unconfirmed references support a range. */
  | 'asking_indication'
  /** Neither is adequate. */
  | 'not_priceable';

// ── Acreage comparability ───────────────────────────────────────────────────

/** The band a row must sit in to compete with or price the subject. */
export function acreageBand(subjectAcres: number | null): { lo: number; hi: number } | null {
  const route = routeAcreage(subjectAcres);
  return route ? { lo: route.pool.min, hi: route.pool.max } : null;
}

/**
 * 1 when the acreage matches the subject exactly, falling off with the ratio.
 *
 * Scored on the RATIO, not the difference: a 2-acre gap is decisive on a
 * 3-acre subject and irrelevant on a 300-acre one.
 */
export function acreageSimilarity(subjectAcres: number | null, acres: number | null): number {
  return routedAcreageSimilarity(acres, routeAcreage(subjectAcres));
}

function recencyScore(dateIso: string | null, nowMs: number): number {
  if (!dateIso) return 0;
  const stamp = Date.parse(dateIso);
  if (!Number.isFinite(stamp)) return 0;
  const months = (nowMs - stamp) / (1000 * 60 * 60 * 24 * 30.4);
  if (months <= 0) return 1;
  // Halves roughly every year; a two-year-old sale still counts, faintly.
  return 1 / (1 + months / 12);
}

function localityScore(subject: CompSelectionSubject, row: CompCandidateRow): number {
  const norm = (value: string | null): string => (value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const rowLocality = norm(row.locality) || norm(row.address);
  if (!rowLocality) return 0;
  if (subject.locality && rowLocality.includes(norm(subject.locality))) return 1;
  if (subject.county && rowLocality.includes(norm(subject.county))) return 0.5;
  return 0;
}

function distanceScore(distanceMiles: number | null): number {
  if (distanceMiles == null || !Number.isFinite(distanceMiles)) return 0;
  return 1 / (1 + Math.max(0, distanceMiles) / 10);
}

/**
 * Practical comparability, deliberately NOT distance alone.
 *
 * Acreage dominates because it is what makes a row a comparable at all: in a
 * market that sells both half-acre lake lots and 40-acre tracts, the nearest row
 * is routinely the least comparable one.
 */
export function comparabilityScore(
  subject: CompSelectionSubject,
  row: CompCandidateRow,
  nowMs: number,
): number {
  const acreage = acreageSimilarity(subject.acres, row.acres);
  const land = row.landClass === 'vacant_land' ? 1 : row.landClass === 'unknown' ? 0.4 : 0;
  const bounded = (value: number | null | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const score = (
    acreage * 5 +
    land * 3 +
    localityScore(subject, row) * 2 +
    recencyScore(row.dateIso, nowMs) * 2 +
    distanceScore(row.distanceMiles) * 1 +
    bounded(row.accessSimilarity) * 0.75 +
    (row.terrainSimilarityReliable === true ? bounded(row.terrainSimilarity) * 0.75 : 0) +
    bounded(row.utilitiesSimilarity) * 0.5 +
    bounded(row.developmentContextSimilarity) * 0.5
  );
  return score * resolveGeographicTier(row.distanceMiles).weightMultiplier;
}

/** Operator-facing normalized selection weight. This explains rank; it is not
 * a statistical confidence interval and never changes the comp's sale price. */
export function compSelectionWeight(
  subject: CompSelectionSubject,
  row: CompCandidateRow,
  nowMs: number,
): number {
  const maximumScore = 15.5;
  return Math.max(0, Math.min(100, Math.round((comparabilityScore(subject, row, nowMs) / maximumScore) * 100)));
}

// ── Deduplication ───────────────────────────────────────────────────────────

const normAddress = (value: string | null): string =>
  (value ?? '').toLowerCase().replace(/\b(lot|unit|#)\s*[\w-]+/g, '').replace(/[^a-z0-9]/g, '');

function isSubjectProperty(subject: CompSelectionSubject, row: CompCandidateRow): boolean {
  const subjectApn = normalizedApn(subject.apn);
  const rowApn = normalizedApn(row.apn);
  if (subjectApn && rowApn && subjectApn === rowApn) return true;

  const subjectAddress = normAddress(subject.address ?? null);
  const rowAddress = normAddress(row.address);
  if (!subjectAddress || !rowAddress) return false;

  // Marketplace rows commonly append city/state/ZIP while intake retains only
  // the street address. Prefix agreement in either direction identifies the
  // same subject without requiring locality text to be identical.
  return subjectAddress === rowAddress
    || (subjectAddress.length >= 8 && rowAddress.startsWith(subjectAddress))
    || (rowAddress.length >= 8 && subjectAddress.startsWith(rowAddress));
}

/**
 * A stable identity for one physical property.
 *
 * Address first. When a row carries no address — LandPortal publishes priced
 * rows identified only by APN — price and acreage identify it instead.
 */
export function compIdentity(row: CompCandidateRow): string {
  const apn = (row.apn ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (apn) return `apn:${apn}`;
  const address = normAddress(row.address);
  if (address) return `addr:${address}`;
  if (typeof row.lat === 'number' && typeof row.lng === 'number') {
    return `coord:${row.lat.toFixed(5)}:${row.lng.toFixed(5)}`;
  }
  // Provider ids are deliberately below cross-provider property identifiers.
  // They are useful only inside one marketplace and must never prevent the
  // same address/APN from reconciling across four sources.
  if (row.providerId) return `provider:${row.source.toLowerCase()}:${row.providerId.trim().toLowerCase()}`;
  const price = row.price != null ? Math.round(row.price) : 'x';
  const acres = row.acres != null ? row.acres.toFixed(2) : 'x';
  return `event:${row.statusBasis}:${price}:${acres}:${row.dateIso ?? 'undated'}`;
}

/** The price+acreage signature, when the row carries both. */
function priceAcreKey(row: CompCandidateRow): string | null {
  if (row.price == null || row.acres == null) return null;
  return `pa:${Math.round(row.price)}:${row.acres.toFixed(2)}`;
}

function normalizedApn(value: string | null | undefined): string | null {
  const normalized = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length >= 4 ? normalized : null;
}

function validPhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return /^\/api\/landos\/deal-cards\/\d+\/(?:comp-image|browseruse\/image)\/[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : null;
}

function mergedPhotoUrls(...rows: CompCandidateRow[]): string[] {
  const unique = [...new Set(rows.flatMap((row) => [
    validPhotoUrl(row.thumbnailUrl),
    ...(row.photoUrls ?? []).map(validPhotoUrl),
  ]).filter((value): value is string => value != null))];
  // A genuine listing photograph is the underwriting aid. Keep it ahead of a
  // generic provider tile or LandPortal thumbnail while preserving provider
  // order inside each tier.
  return unique
    .map((url, index) => ({ url, index, priority: listingPhotoPriority(url) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ url }) => url)
    .slice(0, 20);
}

function bestThumbnail(...rows: CompCandidateRow[]): string | null {
  return mergedPhotoUrls(...rows)[0] ?? null;
}

function sameCoordinates(a: CompCandidateRow, b: CompCandidateRow): boolean {
  if (typeof a.lat !== 'number' || typeof a.lng !== 'number'
    || typeof b.lat !== 'number' || typeof b.lng !== 'number') return false;
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return false;
  // Roughly 55 m latitude; longitude is tighter away from the equator.
  return Math.abs(a.lat - b.lat) <= 0.0005 && Math.abs(a.lng - b.lng) <= 0.0005;
}

function sameSaleEvent(a: CompCandidateRow, b: CompCandidateRow): boolean {
  if (priceAcreKey(a) == null || priceAcreKey(a) !== priceAcreKey(b)) return false;
  const oneAnonymous = !normAddress(a.address) || !normAddress(b.address);
  const sameDatedEvent = !!a.dateIso && !!b.dateIso
    && a.dateIso.slice(0, 10) === b.dateIso.slice(0, 10)
    && a.statusBasis === b.statusBasis;
  // An exact transaction signature can bridge an address-less LandPortal row
  // to a richer listing record. It must never collapse two explicitly different
  // addressed properties that happened to sell for the same amount and acreage.
  if (sameDatedEvent && oneAnonymous) return true;
  // LandPortal can expose an address-less priced row whose status is unstated;
  // merge it into a corroborating marketplace event only when the exact price
  // and acreage match and the anonymous row carries no conflicting identifier.
  const oneUnconfirmed = a.statusBasis === 'unconfirmed' || b.statusBasis === 'unconfirmed';
  return oneAnonymous && oneUnconfirmed && a.source.toLowerCase() !== b.source.toLowerCase();
}

function samePhysicalProperty(a: CompCandidateRow, b: CompCandidateRow): boolean {
  const aApn = normalizedApn(a.apn);
  const bApn = normalizedApn(b.apn);
  // A shared price, acreage, coordinate, or address must never override an
  // explicit parcel-identity conflict.
  if (aApn && bApn && aApn !== bApn) return false;
  if (aApn && bApn && aApn === bApn) return true;
  if (a.providerId && b.providerId
    && a.source.toLowerCase() === b.source.toLowerCase()
    && a.providerId.trim().toLowerCase() === b.providerId.trim().toLowerCase()) return true;
  const aAddress = normAddress(a.address);
  const bAddress = normAddress(b.address);
  if (aAddress && bAddress && aAddress === bAddress) return true;
  return sameCoordinates(a, b) || sameSaleEvent(a, b);
}

/**
 * Collapse duplicates within and across sources.
 *
 * Two rows are the same property when they share a normalized address OR the
 * same price-and-acreage signature. The second test is what recognises a row
 * across marketplaces: LandPortal publishes "$100,000 Acres: 10.30" with no
 * address at all, and Redfin publishes the same parcel as 117 Hensley Rd. On
 * address alone they would both survive and the operator would see one property
 * twice — once as an asking reference and once as a closed sale.
 *
 * The kept row has the strongest status basis, then the most complete data, so
 * a confirmed sale always beats an identical row of unstated status. Facts the
 * loser carried are merged in; none are invented.
 */
export function dedupeCompRows(rows: CompCandidateRow[]): { rows: CompCandidateRow[]; removed: number } {
  const basisRank: Record<CompStatusBasis, number> = { closed_sale: 3, active_listing: 2, unconfirmed: 1 };
  const completeness = (row: CompCandidateRow): number =>
    (row.acres != null ? 2 : 0) + (row.dateIso ? 1 : 0) + (row.address ? 1 : 0)
    + (row.apn ? 2 : 0) + (row.sourceUrl ? 1 : 0) + (row.photoUrls?.length ?? 0);

  const normalizeRow = (row: CompCandidateRow): CompCandidateRow => {
    const photos = mergedPhotoUrls(row);
    return {
      ...row,
      thumbnailUrl: bestThumbnail(row) ?? null,
      photoUrls: photos,
      providerAttributions: [...new Set(row.providerAttributions ?? [row.source])],
      duplicatesMerged: row.duplicatesMerged ?? 0,
    };
  };

  const mergeRows = (a: CompCandidateRow, b: CompCandidateRow): CompCandidateRow => {
    const winner = basisRank[b.statusBasis] !== basisRank[a.statusBasis]
      ? (basisRank[b.statusBasis] > basisRank[a.statusBasis] ? b : a)
      : (completeness(b) > completeness(a) ? b : a);
    const loser = winner === b ? a : b;
    return {
      ...winner,
      providerId: winner.providerId ?? loser.providerId,
      acres: winner.acres ?? loser.acres,
      dateIso: winner.dateIso ?? loser.dateIso,
      address: winner.address ?? loser.address,
      apn: winner.apn ?? loser.apn,
      pricePerAcre: winner.pricePerAcre ?? loser.pricePerAcre,
      distanceMiles: winner.distanceMiles ?? loser.distanceMiles,
      sourceUrl: winner.sourceUrl ?? loser.sourceUrl,
      listingDate: winner.listingDate ?? loser.listingDate,
      daysOnMarket: winner.daysOnMarket ?? loser.daysOnMarket,
      views: winner.views ?? loser.views,
      saves: winner.saves ?? loser.saves,
      collectedAt: winner.collectedAt ?? loser.collectedAt,
      priceChanges: [...(winner.priceChanges ?? []), ...(loser.priceChanges ?? [])]
        .filter((change, index, all) => all.findIndex((candidate) => candidate.at === change.at
          && candidate.price === change.price && candidate.note === change.note) === index),
      lat: winner.lat ?? loser.lat,
      lng: winner.lng ?? loser.lng,
      thumbnailUrl: bestThumbnail(winner, loser),
      photoUrls: mergedPhotoUrls(winner, loser),
      providerAttributions: [...new Set([
        ...(winner.providerAttributions ?? [winner.source]),
        ...(loser.providerAttributions ?? [loser.source]),
      ])],
      duplicatesMerged: (winner.duplicatesMerged ?? 0) + (loser.duplicatesMerged ?? 0) + 1,
      homeType: winner.homeType ?? loser.homeType,
      yearBuilt: winner.yearBuilt ?? loser.yearBuilt,
      homeSizeSqft: winner.homeSizeSqft ?? loser.homeSizeSqft,
      accessSimilarity: winner.accessSimilarity ?? loser.accessSimilarity,
      terrainSimilarity: winner.terrainSimilarity ?? loser.terrainSimilarity,
      terrainSimilarityReliable: winner.terrainSimilarityReliable ?? loser.terrainSimilarityReliable,
      utilitiesSimilarity: winner.utilitiesSimilarity ?? loser.utilitiesSimilarity,
      developmentContextSimilarity: winner.developmentContextSimilarity ?? loser.developmentContextSimilarity,
    };
  };

  const kept: CompCandidateRow[] = [];
  let removed = 0;

  for (const row of rows) {
    let merged = normalizeRow(row);
    let insertion = kept.length;
    // A later provider page can be the bridge between an APN-only LandPortal
    // row and an earlier address-only marketplace row. Keep coalescing after
    // every merge so identity is transitive and input order cannot leave the
    // same physical property in two canonical records.
    for (;;) {
      const slot = kept.findIndex((held) => samePhysicalProperty(held, merged));
      if (slot < 0) break;
      insertion = Math.min(insertion, slot);
      merged = mergeRows(kept[slot], merged);
      kept.splice(slot, 1);
      removed += 1;
    }
    kept.splice(Math.min(insertion, kept.length), 0, merged);
  }
  return { rows: kept, removed };
}

// ── Selection ───────────────────────────────────────────────────────────────

function toSnapshotComp(
  row: CompCandidateRow,
  lane: 'sold' | 'active',
  why: string,
  subject: CompSelectionSubject,
  nowMs: number,
): WeightedSnapshotComp {
  const ppa = row.pricePerAcre
    ?? (row.price != null && row.acres != null && row.acres > 0 ? Math.round(row.price / row.acres) : null);
  const similarities: string[] = [];
  const differences: string[] = [];
  const geographicTier = resolveGeographicTier(row.distanceMiles);
  if (row.acres != null && subject.acres != null && subject.acres > 0) {
    const ratio = row.acres / subject.acres;
    if (ratio >= 0.8 && ratio <= 1.25) {
      similarities.push(`${row.acres.toFixed(2)} ac, close to the subject's ${subject.acres.toFixed(2)} ac`);
    } else {
      differences.push(`${row.acres.toFixed(2)} ac versus ${subject.acres.toFixed(2)} subject acres (${ratio.toFixed(2)}x).`);
    }
  } else if (row.acres != null) {
    similarities.push(`${row.acres.toFixed(2)} ac`);
  }
  if (row.distanceMiles != null) {
    if (row.distanceMiles <= 10) similarities.push(`${row.distanceMiles.toFixed(1)} mi from the subject (${geographicTier.label})`);
    else differences.push(`${row.distanceMiles.toFixed(1)} mi away in the ${geographicTier.label} tier; local demand may differ.`);
  } else {
    differences.push(`${geographicTier.label}: no straight-line miles were invented because the comp location could not be resolved.`);
  }
  if (row.acres == null) differences.push('No acreage on the row.');
  if (!row.dateIso) differences.push('No transaction date published.');
  else {
    const ageMonths = Math.max(0, (nowMs - Date.parse(row.dateIso)) / (30.4 * 86_400_000));
    if (Number.isFinite(ageMonths) && ageMonths > 24) differences.push(`Sale is ${Math.round(ageMonths)} months old.`);
  }
  if (row.statusBasis === 'unconfirmed') differences.push('The source did not state whether this is a sale or an asking price.');
  if (row.terrainSimilarity != null && row.terrainSimilarityReliable !== true) {
    differences.push('Terrain similarity is unverified and was excluded from the selection weight.');
  }
  if (row.accessSimilarity != null && row.accessSimilarity < 0.4) differences.push('Access appears materially different from the subject.');
  if (row.utilitiesSimilarity != null && row.utilitiesSimilarity < 0.4) differences.push('Utility context appears materially different from the subject.');
  const weight = compSelectionWeight(subject, row, nowMs);
  const weightLabel: WeightedSnapshotComp['weightLabel'] = weight >= 70 ? 'strong' : weight >= 50 ? 'moderate' : 'limited';
  return {
    key: row.key,
    apn: row.apn ?? null,
    address: row.address,
    lane,
    source: [...new Set(row.providerAttributions ?? [row.source])].join(' + '),
    providerAttributions: [...new Set(row.providerAttributions ?? [row.source])],
    sourceUrl: row.sourceUrl,
    status: row.statusBasis === 'closed_sale' ? 'Closed sale'
      : row.statusBasis === 'active_listing' ? 'Active listing'
        : 'Asking price, status unconfirmed',
    dateIso: row.dateIso,
    price: row.price,
    acres: row.acres,
    pricePerAcre: ppa,
    distanceMiles: row.distanceMiles,
    originalListingDate: row.listingDate ?? null,
    collectionDate: row.collectedAt ?? null,
    daysOnMarket: row.daysOnMarket ?? calculatedDaysOnMarket(row.listingDate, row.collectedAt),
    priceChanges: row.priceChanges ?? [],
    views: row.views ?? null,
    saves: row.saves ?? null,
    engagement: typeof row.views === 'number' || typeof row.saves === 'number'
      ? ((row.views ?? 0) >= 100 || (row.saves ?? 0) >= 5 ? 'strong' : 'weak')
      : 'inconclusive',
    whyUseful: `${why} Geographic tier: ${geographicTier.label}; ${geographicTier.rationale} Selection weight ${weight}/100 (${weightLabel}); acreage, property type, locality, recency and distance drive the weight.`,
    similarities,
    differences,
    weight,
    weightLabel,
    materialDifferences: differences,
    homeType: row.homeType ?? null,
    yearBuilt: row.yearBuilt ?? null,
    homeSizeSqft: row.homeSizeSqft ?? null,
    thumbnailUrl: validPhotoUrl(row.thumbnailUrl) ?? mergedPhotoUrls(row)[0] ?? null,
    photoUrls: mergedPhotoUrls(row),
    duplicatesMerged: row.duplicatesMerged ?? 0,
  };
}

function calculatedDaysOnMarket(listingDate?: string | null, collectedAt?: string | null): number | null {
  if (!listingDate || !collectedAt) return null;
  const listed = Date.parse(listingDate);
  const collected = Date.parse(collectedAt);
  if (!Number.isFinite(listed) || !Number.isFinite(collected) || collected < listed) return null;
  return Math.floor((collected - listed) / 86_400_000);
}

function bucketEvidence(buckets: Map<string, CompEvidenceBucket>, reason: string, source: string): void {
  const held = buckets.get(reason);
  if (held) {
    held.count += 1;
    if (!held.sources.includes(source)) held.sources.push(source);
    return;
  }
  buckets.set(reason, { reason, count: 1, sources: [source] });
}

function structureSignal(row: CompCandidateRow): string | null {
  if (row.homeSizeSqft != null) return `${row.homeSizeSqft.toLocaleString('en-US')} sqft home/building size`;
  if (row.yearBuilt != null) return `year built ${row.yearBuilt}`;
  if (row.homeType && /home|house|residen|manufactured|mobile|condo|town|single|multi/i.test(row.homeType)) {
    return `residential home type ${row.homeType}`;
  }
  if (row.landClass === 'improved') return 'provider classification as improved property';
  return null;
}

/**
 * Build the operator-facing working set.
 *
 * Everything not selected is counted into an evidence bucket with ONE reason
 * line, because printing a rejection sentence per row is how eighty-nine of them
 * ended up in the operator's primary view.
 */
export function selectWorkingComps(input: {
  subject: CompSelectionSubject;
  rows: CompCandidateRow[];
  nowMs: number;
  sourceCaps?: { zillow: number; redfin: number; realtor?: number };
}): CompWorkingSet {
  const { subject, nowMs } = input;
  const rows = input.rows.map((row): CompCandidateRow => {
    if (typeof row.distanceMiles === 'number' && Number.isFinite(row.distanceMiles)) return row;
    const distanceMiles = compDistanceMiles(subject, row);
    return distanceMiles == null ? row : { ...row, distanceMiles };
  });
  // Disabled historical aggregators are not part of any current count. Direct
  // callers may still pass them for audit classification, but they do not
  // inflate the current collected/selected totals.
  const totalCollected = rows.filter((row) => !isEvidenceOnlySource(row.source)).length;
  const buckets = new Map<string, CompEvidenceBucket>();

  const approved: CompCandidateRow[] = [];
  const manufacturedHomeCandidates: CompCandidateRow[] = [];
  for (const row of rows) {
    if (isEvidenceOnlySource(row.source)) {
      // Keep one generic archival bucket without serializing the disabled
      // provider name into a current snapshot/UI handback.
      bucketEvidence(
        buckets,
        'Aggregator row from a historical disabled provider is retained for database integrity only; it never executes, counts, maps, renders, prices, or competes with the subject.',
        'Historical disabled provider',
      );
      continue;
    }
    if (!isWorkingSetSource(row.source)) {
      bucketEvidence(buckets, 'Source is not one of the approved comparable marketplaces (LandPortal, Zillow, Redfin, Realtor.com).', row.source || 'unknown');
      continue;
    }
    if (isSubjectProperty(subject, row)) {
      bucketEvidence(
        buckets,
        'The subject property itself is retained as seller/listing context and excluded from comparable sales and active competition.',
        row.source,
      );
      continue;
    }
    if (row.landClass === 'improved' && row.improvedClass === 'manufactured') {
      manufacturedHomeCandidates.push(row);
      continue;
    }
    if (row.policyExcluded) {
      bucketEvidence(buckets, row.policyExcluded, row.source);
      continue;
    }
    approved.push(row);
  }

  const { rows: unique, removed } = dedupeCompRows(approved);

  const band = acreageBand(subject.acres);
  const acreageRouting = routeAcreage(subject.acres);
  const inBand = (acres: number | null): boolean => {
    if (acreageRouting == null || acres == null) return false;
    return inAcreagePool(acres, acreageRouting);
  };

  const soldPool: CompCandidateRow[] = [];
  const activePool: CompCandidateRow[] = [];
  const askingPool: CompCandidateRow[] = [];

  for (const row of unique) {
    if (row.price == null || row.price <= 0) {
      bucketEvidence(buckets, 'No usable price on the row.', row.source);
      continue;
    }
    if (row.landClass === 'improved') {
      const signal = structureSignal(row) ?? 'provider classification as improved property';
      bucketEvidence(buckets, `Improved property (${signal}) — retained as structure evidence and never used as vacant-land value or active vacant-land competition.`, row.source);
      continue;
    }
    if (row.acres == null) {
      bucketEvidence(buckets, row.acreageConflict === true
        ? 'Priced acreage conflicts with the parcel record and cannot be reconciled, so the row carries no defensible per-acre figure.'
        : 'No acreage available from the provider, so the row cannot be compared on a per-acre basis.', row.source);
      continue;
    }
    if (!inBand(row.acres)) {
      bucketEvidence(buckets, band
        ? `Acreage outside the subject's comparable band (${band.lo.toFixed(2)}-${band.hi.toFixed(2)} ac).`
        : 'Subject acreage is unknown, so no comparable band can be applied.', row.source);
      continue;
    }
    if (row.statusBasis === 'closed_sale') soldPool.push(row);
    else if (row.statusBasis === 'active_listing') {
      const signal = structureSignal(row);
      if (row.landClass !== 'vacant_land') {
        bucketEvidence(
          buckets,
          signal
            ? `Active row carries a structure signal (${signal}); retained as evidence, not active vacant-land competition.`
            : 'Active row is not affirmatively classified as vacant land; retained as evidence, not active vacant-land competition.',
          row.source,
        );
        continue;
      }
      activePool.push(row);
    } else askingPool.push(row);
  }

  const rank = (rows: CompCandidateRow[]): CompCandidateRow[] =>
    [...rows].sort((a, b) => comparabilityScore(subject, b, nowMs) - comparabilityScore(subject, a, nowMs));

  const sourceCaps = input.sourceCaps ?? { zillow: WORKING_SET_LIMIT, redfin: WORKING_SET_LIMIT, realtor: WORKING_SET_LIMIT };
  const applySourceCaps = (rows: CompCandidateRow[], laneLabel: string): CompCandidateRow[] => {
    const accepted: CompCandidateRow[] = [];
    const used = { zillow: 0, redfin: 0, realtor: 0 };
    for (const row of rank(rows)) {
      const family = /zillow/i.test(row.source) ? 'zillow'
        : /redfin/i.test(row.source) ? 'redfin'
          : /realtor/i.test(row.source) ? 'realtor' : null;
      const cap = family === 'realtor' ? (sourceCaps.realtor ?? WORKING_SET_LIMIT) : family ? sourceCaps[family] : null;
      if (family && cap != null && used[family] >= cap) {
        const label = family === 'zillow' ? 'Zillow' : family === 'redfin' ? 'Redfin' : 'Realtor.com';
        bucketEvidence(buckets, `${label} ${laneLabel} supplement cap is ${cap}.`, row.source);
        continue;
      }
      if (family) used[family] += 1;
      accepted.push(row);
    }
    return accepted;
  };

  const rankedSold = applySourceCaps(soldPool, 'closed-sale');
  const rankedActive = applySourceCaps(activePool, 'active-competition');
  const rankedAsking = applySourceCaps(askingPool, 'asking-reference');
  const recentManufacturedCutoff = nowMs - 36 * 30.4 * 86_400_000;
  const landHomeOnly = dedupeCompRows(manufacturedHomeCandidates).rows
    .filter((row) =>
      row.statusBasis === 'closed_sale'
      && row.price != null && row.price > 200_000
      && row.distanceMiles != null && row.distanceMiles <= 5
      && row.dateIso != null
      && Number.isFinite(Date.parse(row.dateIso))
      && Date.parse(row.dateIso) >= recentManufacturedCutoff)
    .sort((a, b) =>
      (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY)
      || (Date.parse(b.dateIso ?? '') || 0) - (Date.parse(a.dateIso ?? '') || 0))
    .slice(0, WORKING_SET_LIMIT)
    .map((row) => toSnapshotComp(
      row,
      'sold',
      `Manufactured-home closed sale above $200,000 within five miles, retained only to test finished land-home-package demand.`,
      subject,
      nowMs,
    ));

  for (const row of rankedSold.slice(WORKING_SET_LIMIT)) {
    bucketEvidence(buckets, `Beyond the ${WORKING_SET_LIMIT} most comparable closed sales.`, row.source);
  }
  for (const row of rankedActive.slice(ACTIVE_WORKING_SET_LIMIT)) {
    bucketEvidence(buckets, `Beyond the ${ACTIVE_WORKING_SET_LIMIT} most comparable active listings.`, row.source);
  }
  for (const row of rankedAsking.slice(WORKING_SET_LIMIT)) {
    bucketEvidence(buckets, `Beyond the ${WORKING_SET_LIMIT} most comparable asking references.`, row.source);
  }

  const sold = rankedSold.slice(0, WORKING_SET_LIMIT).map((row) =>
    toSnapshotComp(row, 'sold', `Closed vacant-land sale at ${row.acres!.toFixed(2)} ac, inside the subject's comparable acreage band.`, subject, nowMs));
  const active = rankedActive.slice(0, ACTIVE_WORKING_SET_LIMIT).map((row) =>
    toSnapshotComp(row, 'active', `Active vacant-land listing at ${row.acres!.toFixed(2)} ac — what the subject competes against today.`, subject, nowMs));
  const askingReferences = rankedAsking.slice(0, WORKING_SET_LIMIT).map((row) =>
    toSnapshotComp(row, 'active', `${row.source} asking-market reference at ${row.acres!.toFixed(2)} ac. The source did not state whether it closed, so it is NOT sold evidence.`, subject, nowMs));
  if (subject.acres && acreageRouting) {
    for (const comp of [...sold, ...active, ...askingReferences]) {
      if (!comp.acres) continue;
      if (comp.acres < acreageRouting.preferred.min || comp.acres > acreageRouting.preferred.max) {
        comp.whyUseful += ` The acreage search widened beyond the preferred ${acreageRouting.preferred.label} range to the ${acreageRouting.pool.label} participation pool.`;
      }
    }
  }

  const conclusion: CompConclusion = sold.length > 0
    ? 'sold_supported'
    : (askingReferences.length > 0 || active.length > 0) ? 'asking_indication' : 'not_priceable';

  const marketComps = sold.length > 0 ? sold : [...askingReferences, ...active];
  const acreageMarketContext = buildAcreageMarketContext({
    route: acreageRouting,
    comps: marketComps.map((comp) => ({
      acres: comp.acres,
      pricePerAcre: comp.pricePerAcre,
      distanceMiles: comp.distanceMiles,
    })),
  });

  return {
    sold,
    active,
    landHomeOnly,
    askingReferences,
    evidence: [...buckets.values()].sort((a, b) => b.count - a.count),
    duplicatesRemoved: removed,
    totalCollected,
    conclusion,
    acreageRouting,
    geographicExpansion: acreageMarketContext?.expansionExplanation
      ?? 'Subject acreage is unavailable, so no acreage route or geographic miles expansion was invented.',
    acreageMarketContext,
  };
}

// ── Bridge from the source policy ───────────────────────────────────────────

/**
 * Turn the comp source policy's decisions into working-set candidate rows.
 *
 * The policy decides which SOURCES may speak; this module decides which ROWS the
 * operator actually reads. Keeping them separate is what lets a LandPortal row
 * be simultaneously an approved source and a rejected comparable, with a stated
 * reason for each, instead of one opaque verdict.
 *
 * Disabled historical aggregator rows are deliberately omitted here. Their DB
 * records remain intact, but a current snapshot handback must not name, count,
 * map, render, or value them.
 */
export function candidateRowsFromPolicy(policy: CompSourcePolicyResult): CompCandidateRow[] {
  return policy.decisions
    .filter((decision) => decision.role !== 'legacy_evidence')
    .map((decision, index): CompCandidateRow => {
    const c = decision.candidate;
    const kind = String(c.priceKind ?? '').toLowerCase();
    const landPortalStatus = landPortalSaleStatus({
      source: c.provider,
      dateIso: c.saleOrListDate ?? null,
      priceKind: kind,
    });
    // A status is 'stated' only when the provider said so. `laneOf` in the
    // policy defaults an unstated row to the sold lane for its own bookkeeping;
    // treating that default as evidence here would price the subject on a guess.
    const statusBasis: CompStatusBasis =
      kind === 'sold' || kind === 'sale' ? 'closed_sale'
        : kind === 'list' || kind === 'active' ? 'active_listing'
          : landPortalStatus.statusBasis;
    const landClass: CompCandidateRow['landClass'] =
      decision.compClass === 'vacant_land' || decision.compClass === 'farm' ? 'vacant_land'
        : decision.compClass === 'residential' || decision.compClass === 'manufactured' || decision.compClass === 'commercial' ? 'improved'
          : 'unknown';
    // A row whose priced acreage cannot be reconciled with its parcel acreage
    // carries no defensible per-acre figure, so it enters with none.
    const acres = c.acreageConflict === true ? null : (typeof c.acres === 'number' ? c.acres : null);
    // The policy's verdict travels WITH the row. A rejected row (wrong market,
    // non-market transfer) and a sold row the policy did not accept (an
    // over-cap Zillow/Redfin supplement) must both stay out of the working
    // set; without this, an in-band rejected row re-entered it and the
    // two-supplement cap was bypassed for sold rows beyond the cap.
    const policyExcluded =
      decision.role === 'rejected' ? decision.reason
        : statusBasis === 'closed_sale' && !decision.fmvEligible ? decision.reason
          : null;
    return {
      key: `${decision.family}:${c.apn ?? c.addressDesc ?? c.sourceUrl ?? index}`,
      apn: c.apn ?? null,
      address: c.addressDesc ?? null,
      source: c.provider,
      sourceUrl: c.sourceUrl ?? null,
      price: typeof c.price === 'number' ? c.price : null,
      acres,
      pricePerAcre: c.acreageConflict === true ? null : (typeof c.pricePerAcre === 'number' ? c.pricePerAcre : null),
      dateIso: c.saleOrListDate ?? null,
      listingDate: c.listingDate ?? null,
      daysOnMarket: c.daysOnMarket ?? null,
      views: c.views ?? null,
      saves: c.saves ?? null,
      priceChanges: c.priceChanges ?? [],
      thumbnailUrl: validPhotoUrl(c.thumbnailUrl),
      photoUrls: Array.isArray((c as unknown as { photoUrls?: unknown }).photoUrls)
        ? ((c as unknown as { photoUrls: unknown[] }).photoUrls)
            .map(validPhotoUrl)
            .filter((value): value is string => value != null)
        : validPhotoUrl(c.thumbnailUrl) ? [validPhotoUrl(c.thumbnailUrl)!] : [],
      collectedAt: c.collectedAt ?? null,
      distanceMiles: typeof c.distanceMiles === 'number' ? c.distanceMiles : null,
      landClass,
      improvedClass: decision.compClass === 'manufactured' ? 'manufactured'
        : decision.compClass === 'residential' ? 'residential'
          : decision.compClass === 'commercial' ? 'commercial' : null,
      statusBasis,
      locality: c.addressDesc ?? null,
      policyExcluded,
      acreageConflict: c.acreageConflict === true,
      providerId: c.id == null ? null : String(c.id),
      lat: typeof c.lat === 'number' ? c.lat : null,
      lng: typeof c.lng === 'number' ? c.lng : null,
      providerAttributions: [c.provider],
      duplicatesMerged: 0,
      homeType: c.homeType ?? null,
      yearBuilt: typeof c.yearBuilt === 'number' ? c.yearBuilt : null,
      homeSizeSqft: typeof c.homeSizeSqft === 'number' ? c.homeSizeSqft : null,
    };
    });
}

// ── Valuation ───────────────────────────────────────────────────────────────

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

export interface EvidenceValueAdjustment {
  label: string;
  /** Signed percentage: -10 is a 10% deduction, +5 is a 5% premium. */
  percent: number;
  /** Subject-versus-comp evidence supporting the adjustment. */
  evidence: string;
  reliability: 'verified' | 'supported' | 'questionable';
  /** True when the selected sales already share/price the condition. */
  alreadyReflectedInComps?: boolean;
}

/**
 * The ONE valuation conclusion, derived from the working set that is on screen.
 *
 * The page must never show "not priceable" beside a definitive number, so this
 * is the only place a value is formed and it reads the same comps the operator
 * sees. Three outcomes, never two at once:
 *
 *   sold_supported ..... a value band from closed sales, with a working value.
 *   asking_indication .. an ASKING-market indication only. Explicitly not an
 *                        FMV: asking prices say what sellers want, not what
 *                        buyers paid.
 *   not_priceable ...... stated plainly, with what would unblock it.
 */
export function valuationFromWorkingSet(
  subject: CompSelectionSubject,
  set: CompWorkingSet,
  context: {
    constraints?: string[];
    hardRisks?: string[];
    /** Numeric changes require an explicit percentage and reliable evidence.
     * Legacy constraint strings remain qualitative and never silently deduct. */
    adjustments?: EvidenceValueAdjustment[];
    identityState?: 'confirmed' | 'provisional' | 'conflicted' | 'unresolved';
    discoveryIdentityUsable?: boolean;
    identityBasis?: string | null;
  } = {},
): SnapshotValuation {
  const acres = subject.acres != null && subject.acres > 0 ? subject.acres : null;
  const conditionalIdentity = context.identityState === 'provisional'
    && context.discoveryIdentityUsable === true;
  const ppaOf = (comps: SnapshotComp[]): number[] => comps
    .map((comp) => comp.pricePerAcre)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  const uncertainty: string[] = [];
  const materialGaps: string[] = [];
  if (conditionalIdentity) {
    uncertainty.push(
      `Working subject match: ${context.identityBasis?.trim()
        || 'the retained parcel evidence consistently identifies one discovery-stage subject'}.`,
    );
  }
  if (acres == null) materialGaps.push('The subject acreage is unknown, so no per-acre conclusion can be scaled to this parcel.');
  if (set.duplicatesRemoved > 0) uncertainty.push(`${set.duplicatesRemoved} duplicate row(s) across providers were merged into single properties before valuing.`);

  if (set.conclusion === 'sold_supported' && acres != null) {
    const ppa = ppaOf(set.sold);
    if (ppa.length) {
      const observedLow = Math.min(...ppa);
      const observedHigh = Math.max(...ppa);
      const mid = median(ppa);
      const thinWidening = set.sold.length === 1 ? 0.15 : set.sold.length === 2 ? 0.08 : 0;
      let evidenceFactor = 1;
      const adjustments: string[] = [];
      for (const adjustment of context.adjustments ?? []) {
        const usable = adjustment.reliability !== 'questionable'
          && adjustment.alreadyReflectedInComps !== true
          && Number.isFinite(adjustment.percent)
          && Math.abs(adjustment.percent) <= 30
          && adjustment.evidence.trim().length > 0;
        if (!usable) {
          adjustments.push(`${adjustment.label}: no numeric adjustment applied because ${
            adjustment.alreadyReflectedInComps
              ? 'the selected sales already reflect the condition'
              : adjustment.reliability === 'questionable'
                ? 'the input is questionable'
                : 'the percentage or evidence is not supportable'
          }.`);
          continue;
        }
        evidenceFactor *= 1 + adjustment.percent / 100;
        adjustments.push(`${adjustment.label}: ${adjustment.percent > 0 ? '+' : ''}${adjustment.percent.toFixed(1)}% supported by ${adjustment.evidence}`);
      }
      evidenceFactor = Math.max(0.7, Math.min(1.3, evidenceFactor));
      const low = observedLow * (1 - thinWidening) * evidenceFactor;
      const high = observedHigh * (1 + thinWidening) * evidenceFactor;
      const round = (value: number): number => Math.round(value / 500) * 500;
      const adjustedMid = mid * evidenceFactor;
      const sources = [...new Set(set.sold.map((comp) => comp.source))].join(', ');
      if (set.sold.length < 3) uncertainty.push(`Only ${set.sold.length} closed sale(s) support this band; a wider comp set would tighten it.`);
      const undated = set.sold.filter((comp) => !comp.dateIso).length;
      if (undated) uncertainty.push(`${undated} of the selected sale(s) carry no published transaction date.`);
      if (set.askingReferences.length) {
        uncertainty.push(`${set.askingReferences.length} priced row(s) of unstated status are shown separately as asking references and are NOT in this band.`);
      }
      if (context.hardRisks?.length) {
        uncertainty.push(`Open risk(s) that could move value or kill the deal: ${context.hardRisks.join('; ')}.`);
      }
      if (context.constraints?.length) {
        adjustments.push(
          `No automatic deduction was applied for qualitative constraint text (${context.constraints.join('; ')}). A numeric change requires a reliable subject-versus-comp difference and an explicit percentage; questionable terrain, slope, buildability or septic inputs remain neutral.`,
        );
      }
      if (!adjustments.length) adjustments.push('No numeric subject adjustment was applied; the selected sales already define the raw market indication.');
      const baseConfidence: SnapshotValuation['confidence'] =
        set.sold.length >= 4 ? 'high' : set.sold.length >= 2 ? 'medium' : 'low';
      const evidenceConfidence: SnapshotValuation['confidence'] = context.hardRisks?.length
        ? baseConfidence === 'high' ? 'medium' : 'low'
        : baseConfidence;
      const confidence: SnapshotValuation['confidence'] = conditionalIdentity ? 'low' : evidenceConfidence;
      return {
        priceable: true,
        range: { low: round(low * acres), high: round(high * acres) },
        pricePerAcreRange: { low: Math.round(low), high: Math.round(high) },
        likelyRetail: { low: round(adjustedMid * acres), high: round(high * acres) },
        dispositionRange: { low: round(low * acres * 0.7), high: round(adjustedMid * acres * 0.85) },
        basis: `${conditionalIdentity ? 'Working discovery estimate from the retained parcel match. ' : ''}${set.sold.length} closed vacant-land sale(s) inside the subject's comparable acreage band, from ${sources}, at $${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()} per acre applied to ${acres.toFixed(2)} acres.`,
        primaryBasis: `Raw comp indication $${Math.round(observedLow).toLocaleString()}–$${Math.round(observedHigh).toLocaleString()}/ac. Closed sales: ${set.sold.map((comp) => `${comp.address ?? comp.source} ${comp.acres != null ? `${comp.acres.toFixed(2)}ac` : ''} @ $${(comp.pricePerAcre ?? 0).toLocaleString()}/ac, weight ${(comp as WeightedSnapshotComp).weight ?? 'n/a'}/100`).join('; ')}.${thinWidening ? ` The supported range is widened ${Math.round(thinWidening * 100)}% for thin-market uncertainty.` : ''}`,
        workingValue: round(adjustedMid * acres),
        adjustments,
        // Confidence follows the evidence count, never the desire for a number.
        confidence,
        uncertainty,
        materialGaps,
        notPriceableReason: null,
        nextActionToPrice: null,
      };
    }
  }

  if ((set.conclusion === 'asking_indication' || set.sold.length === 0) && acres != null) {
    const references = [...set.askingReferences, ...set.active];
    const ppa = ppaOf(references);
    if (ppa.length) {
      const low = Math.min(...ppa);
      const high = Math.max(...ppa);
      const round = (value: number): number => Math.round(value / 500) * 500;
      return {
        priceable: false,
        range: null,
        pricePerAcreRange: { low: Math.round(low), high: Math.round(high) },
        likelyRetail: null,
        dispositionRange: null,
        basis: `Asking-market indication only: ${references.length} priced row(s) at $${Math.round(low).toLocaleString()}–$${Math.round(high).toLocaleString()} per acre (about $${round(low * acres).toLocaleString()}–$${round(high * acres).toLocaleString()} across ${acres.toFixed(2)} acres). These are what sellers ASK, not what buyers paid.`,
        primaryBasis: 'No closed sale supports a value band; the figures shown are asking prices and unconfirmed-status rows.',
        workingValue: null,
        adjustments: [],
        confidence: 'low',
        uncertainty: [...uncertainty, 'No closed sale is available, so no fair market value is asserted.'],
        materialGaps,
        notPriceableReason: 'No accepted closed vacant-land sale inside the subject acreage band, so a fair market value cannot be stated. An asking-market indication is shown instead.',
        nextActionToPrice: 'Confirm a closed sale price and date for at least one in-band comparable.',
      };
    }
  }

  return {
    priceable: false,
    range: null,
    pricePerAcreRange: null,
    likelyRetail: null,
    dispositionRange: null,
    basis: 'No comparable evidence survived selection.',
    primaryBasis: null,
    workingValue: null,
    adjustments: [],
    confidence: 'none',
    uncertainty,
    materialGaps,
    notPriceableReason: acres == null
      ? 'The subject acreage is unknown, so no per-acre conclusion can be applied to this parcel.'
      : `No usable comparable survived selection from ${set.totalCollected} collected row(s). Every held-back row carries a stated reason in the evidence list.`,
    nextActionToPrice: 'Re-run comparable research, or record a closed in-band vacant-land sale manually.',
  };
}

/** Render the working set into the snapshot's comps section. */
export function workingSetToSnapshotComps(
  set: CompWorkingSet,
  plan: { policyExplanation: string; landPortalUsable: boolean; landPortalRowsSeen: number; caps: { zillow: number; redfin: number } },
): SnapshotComps {
  // `rejected` stays populated for readers that predate the evidence buckets,
  // but as ONE line per reason rather than one per row.
  const rejected: SnapshotRejectedComp[] = set.evidence.map((bucket) => ({
    address: null,
    source: bucket.sources.join(', '),
    price: null,
    reason: `${bucket.count} row(s): ${bucket.reason}`,
  }));
  const summary =
    `${set.sold.length} accepted sold comp(s), ${set.active.length} active competitor(s) and ` +
    `${set.askingReferences.length} asking-market reference(s) shown from ${set.totalCollected} collected row(s); ` +
    `${set.duplicatesRemoved} duplicate(s) merged. Remaining rows are retained as evidence with a stated reason.`;
  return {
    policyExplanation: plan.policyExplanation,
    landPortalUsable: plan.landPortalUsable,
    landPortalRowsSeen: plan.landPortalRowsSeen,
    caps: plan.caps,
    sold: set.sold,
    active: set.active,
    landHomeOnly: set.landHomeOnly,
    rejected,
    duplicatesMerged: set.duplicatesRemoved,
    summaryLine: summary,
    askingReferences: set.askingReferences,
    evidenceBuckets: set.evidence,
    totalCollected: set.totalCollected,
    conclusion: set.conclusion,
  };
}
