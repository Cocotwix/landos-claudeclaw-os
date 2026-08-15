import { compDistanceMiles, resolveGeographicTier, type GeographicTierId } from './acreage-router.js';
import { landPortalSaleStatus } from './deal-intelligence-comps.js';
import { resolveCompVisual, type CompVisual } from './comp-visual.js';
import { normalizeCompAddress, type CompRegistryCandidate } from './comp-registry.js';

export interface LandPortalSidebarComp { propertyId?: string | null; apn?: string | null; price: number | null; acres: number | null; saleDate?: string | null; pricePerAcre?: number | null; rawText?: string | null; detailUrl?: string | null }
export interface CompDrilldownStep { compKey: string; action: 'open_comp_detail' | 'show_on_map'; target: string | null; capture: string[]; reason: string }

function sidebarKey(comp: LandPortalSidebarComp, index: number): string {
  const identity = comp.propertyId?.trim() || comp.apn?.trim() || comp.detailUrl?.trim();
  return identity ? `landportal:${identity}:${index + 1}` : `landportal:sidebar-row-${index + 1}`;
}

export function planCompDrilldown(comps: LandPortalSidebarComp[], subject: { fips?: string | null }): CompDrilldownStep[] {
  return comps.map((comp, index) => ({
    compKey: sidebarKey(comp, index),
    action: comp.detailUrl?.trim() ? 'open_comp_detail' : 'show_on_map',
    target: comp.detailUrl?.trim() || comp.propertyId?.trim() || (comp.apn?.trim() && subject.fips?.trim() ? `${subject.fips.trim()}:${comp.apn.trim()}` : comp.apn?.trim()) || null,
    capture: ['property address and locality', 'stated acreage', 'comparable image and source', 'coordinates or mapped location', 'detail URL'],
    reason: 'Follow the sidebar comparable into its own LandPortal detail or Show-on-Map surface and retain the facts that surface actually states.',
  }));
}

export interface LandPortalCompDetail { address?: string | null; city?: string | null; state?: string | null; zip?: string | null; apn?: string | null; acres?: number | null; price?: number | null; saleDate?: string | null; pricePerAcre?: number | null; lat?: number | null; lng?: number | null; imageUrl?: string | null; imageSourceLabel?: string | null; detailUrl?: string | null }

// ── The comparable sidebar's own payload ─────────────────────────────────────
//
// LandPortal's LP Estimate sidebar does not merely render five price/acre/APN
// rows: its "Show on Map" control carries the whole comparable set as a
// URL-encoded JSON payload in `data-similars`, and that payload states each
// comparable's situs coordinates, situs ZIP, municipality, MLS status and
// LandPortal's own distance to the subject.
//
// LandOS previously read only the visible row text, so five comparables were
// retained carrying an APN and nothing that could place them. This is the
// same approved surface — the subject page's comparable sidebar — read
// completely instead of partially. Nothing here searches, navigates, or
// derives a location: every field below is stated by LandPortal.
//
// A comparable's own property page is a separate, richer surface that would add
// the street address. It is NOT reachable by opening the comparable in a new tab
// or by navigating away: LandPortal holds its authenticated app session per tab,
// so both drop straight to the logged-out teaser. That constraint is why the
// address is absent here rather than invented.

/** One comparable exactly as LandPortal's sidebar payload states it. */
export interface LandPortalSimilarRow {
  apn?: string | null;
  fips?: string | null;
  propertyid?: number | string | null;
  mls_propertyid?: number | string | null;
  mls_status?: string | null;
  mls_dom?: number | null;
  new_date?: string | null;
  mls_price?: number | null;
  mls_priceperacre?: number | null;
  price_acres?: number | null;
  area_acres?: number | null;
  vacant?: boolean | null;
  propertyclassid?: string | null;
  landusecode?: string | null;
  situszip5?: string | null;
  municipality?: string | null;
  situslatitude?: number | null;
  situslongitude?: number | null;
  /** LandPortal's own subject-to-comparable distance, in miles. */
  distance?: number | null;
}

export interface LandPortalSimilarComp {
  row: LandPortalSimilarRow;
  sidebar: LandPortalSidebarComp;
  detail: LandPortalCompDetail;
  /** LandPortal's own stated distance. Never LandOS's computed one. */
  statedDistanceMiles: number | null;
  /** Operator-readable trace of what this payload actually stated. */
  evidenceLine: string;
}

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

const trimmed = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return text ? text : null;
};

/** Latitude/longitude LandPortal published for this parcel, or null. Zero is
 *  refused: a null island coordinate is a missing value, not a location. */
function situsPoint(row: LandPortalSimilarRow): { lat: number; lng: number } | null {
  const lat = finiteNumber(row.situslatitude);
  const lng = finiteNumber(row.situslongitude);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/**
 * Read the comparable sidebar payload. Accepts the raw `data-similars`
 * attribute (URL-encoded JSON), a decoded JSON string, or the parsed array.
 * A row without an APN is dropped: LandOS cannot bind location evidence to a
 * parcel it cannot identify (PERMANENT_MEMORY invariant 2).
 */
export function parseLandPortalSimilars(input: unknown): LandPortalSimilarComp[] {
  let rows: unknown = input;
  if (typeof rows === 'string') {
    const text = rows.trim();
    if (!text) return [];
    let decoded = text;
    if (!/^\s*\[/.test(text)) {
      try { decoded = decodeURIComponent(text); } catch { return []; }
    }
    try { rows = JSON.parse(decoded); } catch { return []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((entry): LandPortalSimilarComp[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as LandPortalSimilarRow;
    const apn = trimmed(row.apn);
    if (!apn) return [];
    const point = situsPoint(row);
    const acres = finiteNumber(row.area_acres);
    const price = finiteNumber(row.mls_price);
    const pricePerAcre = finiteNumber(row.mls_priceperacre) ?? finiteNumber(row.price_acres);
    const saleDate = trimmed(row.new_date);
    const zip = trimmed(row.situszip5);
    const municipality = trimmed(row.municipality);
    const statedDistance = finiteNumber(row.distance);
    const stated = [
      point ? `situs coordinates ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : null,
      zip ? `situs ZIP ${zip}` : null,
      municipality ? `municipality ${municipality}` : null,
      statedDistance != null ? `LandPortal-stated distance ${statedDistance.toFixed(2)} miles` : null,
      trimmed(row.mls_status) ? `MLS status ${trimmed(row.mls_status)}` : null,
    ].filter(Boolean);
    return [{
      row,
      sidebar: {
        propertyId: trimmed(row.propertyid),
        apn,
        price,
        acres,
        saleDate,
        pricePerAcre,
      },
      detail: {
        // LandPortal's comparable payload carries no street address. The
        // municipality is a township name, not a postal city, so it is reported
        // in provenance and never written into an address field.
        address: null,
        city: null,
        state: null,
        zip,
        apn,
        acres,
        price,
        saleDate,
        pricePerAcre,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
      },
      statedDistanceMiles: statedDistance,
      evidenceLine: stated.length
        ? `LandPortal's comparable sidebar payload states ${stated.join(', ')} for APN ${apn}.`
        : `LandPortal's comparable sidebar payload identified APN ${apn} but stated no usable location field.`,
    }];
  });
}

export interface RetainedCompIdentity {
  apn?: string | null;
  price?: number | null;
  acres?: number | null;
  saleOrListDate?: string | null;
  state?: string | null;
}

export interface SimilarReconciliation {
  matched: boolean;
  matchedOn: string[];
  conflicts: string[];
  reason: string;
}

/**
 * Bind one sidebar payload row to one retained comparable.
 *
 * The APN is a hard gate, not a signal: LandPortal states each comparable's
 * parcel number, and location evidence attaches only to the parcel that number
 * identifies. Beyond that, at least one independent record fact — acreage,
 * price, or sale date — must agree, so a parcel whose retained row describes a
 * different transaction never silently absorbs another sale's coordinates.
 */
export function reconcileSimilarToRetainedComp(
  similar: LandPortalSimilarComp,
  retained: RetainedCompIdentity,
): SimilarReconciliation {
  const similarApn = compactApn(similar.row.apn);
  const retainedApn = compactApn(retained.apn);
  if (!similarApn || !retainedApn) {
    return { matched: false, matchedOn: [], conflicts: [], reason: 'Reconciliation refused: one side carries no parcel number, and a comparable location is never attached without parcel identity.' };
  }
  if (similarApn !== retainedApn) {
    return { matched: false, matchedOn: [], conflicts: ['APN differs'], reason: `Reconciliation refused: LandPortal APN ${similar.row.apn} is not the retained comparable's APN ${retained.apn}.` };
  }
  const matchedOn = ['APN'];
  const conflicts: string[] = [];
  const similarAcres = finiteNumber(similar.row.area_acres);
  if (similarAcres != null && retained.acres != null) {
    // LandPortal states calculated acreage to many decimals while the retained
    // row often carries the rounded MLS figure; 1% absorbs that, not a
    // genuinely different parcel size.
    if (Math.abs(similarAcres - retained.acres) / Math.max(retained.acres, 0.01) <= 0.01) matchedOn.push('acreage');
    else conflicts.push(`acreage differs (${similarAcres} vs ${retained.acres})`);
  }
  const similarPrice = finiteNumber(similar.row.mls_price);
  if (similarPrice != null && retained.price != null) {
    if (Math.abs(similarPrice - retained.price) / Math.max(retained.price, 1) <= 0.01) matchedOn.push('price');
    else conflicts.push(`price differs (${similarPrice} vs ${retained.price})`);
  }
  const similarDate = trimmed(similar.row.new_date)?.slice(0, 10) ?? null;
  const retainedDate = trimmed(retained.saleOrListDate)?.slice(0, 10) ?? null;
  if (similarDate && retainedDate) {
    if (similarDate === retainedDate) matchedOn.push('sale date');
    else conflicts.push(`sale date differs (${similarDate} vs ${retainedDate})`);
  }
  const corroborating = matchedOn.filter((item) => item !== 'APN');
  if (conflicts.length) {
    return { matched: false, matchedOn, conflicts, reason: `Reconciliation refused despite the matching APN: ${conflicts.join('; ')}.` };
  }
  if (!corroborating.length) {
    return { matched: false, matchedOn, conflicts, reason: 'Reconciliation unresolved: the APN matched but no acreage, price, or sale date was available on both sides to corroborate it.' };
  }
  return {
    matched: true,
    matchedOn,
    conflicts,
    reason: `Reconciled to the retained comparable on ${matchedOn.join(', ')}.`,
  };
}

/**
 * The persistence patch for one reconciled comparable: the location LandPortal
 * stated, plus the distance LandOS computes from its own retained subject point.
 * LandPortal's stated distance is recorded as corroboration, never substituted
 * for the deterministic computation every other comparable is measured by.
 */
export interface LandPortalCompLocationUpdate {
  apn: string;
  lat: number | null;
  lng: number | null;
  zip: string | null;
  distanceMiles: number | null;
  statedDistanceMiles: number | null;
  tierId: GeographicTierId;
  weightMultiplier: number;
  located: boolean;
  provenance: string;
  /** Exactly what is still missing when this comparable stays unplaced. */
  remainingGap: string | null;
}

export function landPortalCompLocationUpdate(
  similar: LandPortalSimilarComp,
  reconciliation: SimilarReconciliation,
  subject: { lat?: number | null; lng?: number | null },
): LandPortalCompLocationUpdate | null {
  if (!reconciliation.matched) return null;
  const apn = (similar.row.apn ?? '').trim();
  const point = situsPoint(similar.row);
  const distanceMiles = point ? compDistanceMiles(subject, point) : null;
  const tier = resolveGeographicTier(distanceMiles);
  const municipality = trimmed(similar.row.municipality);
  const agreement = point && similar.statedDistanceMiles != null && distanceMiles != null
    ? ` LandPortal states ${similar.statedDistanceMiles.toFixed(2)} miles from its own subject centroid; LandOS measures ${distanceMiles.toFixed(1)} miles from the retained subject point.`
    : '';
  return {
    apn,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    zip: trimmed(similar.row.situszip5),
    distanceMiles,
    statedDistanceMiles: similar.statedDistanceMiles,
    tierId: tier.id,
    weightMultiplier: tier.weightMultiplier,
    located: !!point,
    provenance: [
      `Location from LandPortal: ${similar.evidenceLine}`,
      `${reconciliation.reason}`,
      municipality ? `LandPortal municipality: ${municipality}.` : '',
      point
        ? `Placed from LandPortal's published situs coordinates; nothing was geocoded, approximated, or carried in from another property.${agreement}`
        : 'LandPortal published no usable coordinate for this parcel, so it stays unplaced.',
    ].filter(Boolean).join(' '),
    remainingGap: point
      ? 'No street address. LandPortal publishes the situs address only on the comparable\'s own authenticated property page, which its per-tab session makes unreachable from an automated navigation.'
      : 'No coordinate and no street address were published for this parcel in the comparable sidebar payload.',
  };
}
export interface CompLocationResolution { resolved: boolean; basis: 'coordinates' | 'address' | 'unresolved'; distanceMiles: number | null; tierId: GeographicTierId; weightMultiplier: number; statement: string }
export interface EnrichedLandPortalComp { compKey: string; apn: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; acres: number | null; price: number | null; pricePerAcre: number | null; saleDate: string | null; lat: number | null; lng: number | null; imageUrl: string | null; imageSourceLabel: string | null; detailUrl: string | null; drilledDown: boolean; provenance: string[]; locationResolution: CompLocationResolution }

export type CompEnrichmentProvider = 'Zillow' | 'Redfin' | 'Realtor.com' | 'Web';
export interface CompEnrichmentQuery {
  provider: CompEnrichmentProvider;
  query: string;
  identityBasis: 'address' | 'apn' | 'transaction_signature';
  /** A discovery query is never itself a match; the opened result must pass the
   * reconciliation gate below before any fact or photograph is retained. */
  requiresOpenedPageReconciliation: true;
}

export interface CompListingEnrichmentCandidate {
  provider: CompEnrichmentProvider;
  sourceUrl: string;
  address?: string | null;
  apn?: string | null;
  acres?: number | null;
  price?: number | null;
  saleDate?: string | null;
  lat?: number | null;
  lng?: number | null;
  status?: 'sold' | 'active' | 'unknown';
  thumbnailUrl?: string | null;
  photoUrls?: string[];
  description?: string | null;
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
}

export interface ReconciledCompEnrichment {
  candidate: CompListingEnrichmentCandidate;
  matched: boolean;
  matchedOn: string[];
  reason: string;
}

/** Independent provider searches for enriching this exact LandPortal comp.
 * Strong identifiers are preferred; price+acreage is discovery-only fallback. */
export function planLandPortalCompEnrichment(
  comp: EnrichedLandPortalComp,
  geography: { county?: string | null; state?: string | null },
): CompEnrichmentQuery[] {
  const locality = [comp.city, geography.county ? `${geography.county} County` : null, comp.state ?? geography.state, comp.zip]
    .filter(Boolean).join(' ');
  const identity = comp.address?.trim()
    ? { text: [comp.address, locality].filter(Boolean).join(' '), basis: 'address' as const }
    : comp.apn?.trim()
      ? { text: `parcel ${comp.apn.trim()} ${locality}`.trim(), basis: 'apn' as const }
      : { text: `${comp.acres ?? ''} acres ${comp.price != null ? `$${Math.round(comp.price)}` : ''} ${locality}`.trim(), basis: 'transaction_signature' as const };
  return (['Zillow', 'Redfin', 'Realtor.com', 'Web'] as const).map((provider) => ({
    provider,
    query: `${identity.text} ${provider === 'Web' ? 'property sale listing' : provider}`.trim(),
    identityBasis: identity.basis,
    requiresOpenedPageReconciliation: true,
  }));
}

const compactApn = (value: string | null | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Refuse cross-property contamination while allowing best-available enrichment.
 * APN or exact address is sufficient. Otherwise acreage + price/date or nearby
 * coordinates must independently agree; a search snippet alone never passes. */
export function reconcileLandPortalCompEnrichment(
  comp: EnrichedLandPortalComp,
  candidate: CompListingEnrichmentCandidate,
): ReconciledCompEnrichment {
  const matchedOn: string[] = [];
  const hardConflicts: string[] = [];
  const compApn = compactApn(comp.apn);
  const candidateApn = compactApn(candidate.apn);
  if (compApn && candidateApn) {
    if (compApn === candidateApn) matchedOn.push('APN');
    else hardConflicts.push('APN differs');
  }
  const compAddress = normalizeCompAddress(comp.address);
  const candidateAddress = normalizeCompAddress(candidate.address);
  if (compAddress && candidateAddress) {
    if (compAddress === candidateAddress) matchedOn.push('address');
    else hardConflicts.push('address differs');
  }
  if (comp.acres != null && candidate.acres != null) {
    const drift = Math.abs(comp.acres - candidate.acres) / Math.max(comp.acres, 0.01);
    if (drift <= 0.03) matchedOn.push('acreage');
    else hardConflicts.push('acreage differs');
  }
  if (comp.price != null && candidate.price != null && Math.abs(comp.price - candidate.price) / Math.max(comp.price, 1) <= 0.02) matchedOn.push('price');
  if (comp.saleDate && candidate.saleDate && comp.saleDate.slice(0, 10) === candidate.saleDate.slice(0, 10)) matchedOn.push('sale date');
  if (comp.lat != null && comp.lng != null && candidate.lat != null && candidate.lng != null) {
    const miles = compDistanceMiles(comp, candidate);
    if (miles != null && miles <= 0.35) matchedOn.push('coordinates');
    else if (miles != null) hardConflicts.push('coordinates differ');
  }
  const strongIdentity = matchedOn.includes('APN') || matchedOn.includes('address');
  const matched = hardConflicts.length === 0 && (strongIdentity || matchedOn.length >= 2);
  return {
    candidate,
    matched,
    matchedOn,
    reason: matched
      ? `Reconciled to the LandPortal comp on ${matchedOn.join(', ')}.`
      : hardConflicts.length
        ? `Enrichment refused: ${hardConflicts.join('; ')}.`
        : `Enrichment unresolved: only ${matchedOn.length} independent identity signal(s) agreed.`,
  };
}

/** Convert only reconciled provider pages into additional registry candidates.
 * Failure to resolve a provider produces no row and never invalidates the
 * original LandPortal comp. The canonical registry later merges these by APN,
 * address or transaction identity and exposes all providers on one property. */
export function landPortalEnrichmentCandidates(
  comp: EnrichedLandPortalComp,
  candidates: CompListingEnrichmentCandidate[],
): CompRegistryCandidate[] {
  return candidates
    .map((candidate) => reconcileLandPortalCompEnrichment(comp, candidate))
    .filter((result) => result.matched)
    .map(({ candidate, matchedOn }): CompRegistryCandidate => {
      const improved = !!(candidate.homeType || candidate.homeSizeSqft || candidate.yearBuilt
        || /\b(?:bed|bath|house|home|cabin|residence|dwelling|manufactured)\b/i.test(candidate.description ?? ''));
      return ({
      provider: candidate.provider,
      lane: candidate.status === 'active' ? 'active' : candidate.status === 'sold' ? 'supplemental' : 'unknown',
      addressDesc: candidate.address ?? comp.address,
      apn: candidate.apn ?? comp.apn,
      state: comp.state,
      lat: candidate.lat ?? comp.lat,
      lng: candidate.lng ?? comp.lng,
      price: candidate.price ?? comp.price,
      priceKind: candidate.status === 'active' ? 'list' : candidate.status === 'sold' ? 'sold' : 'unknown',
      saleOrListDate: candidate.saleDate ?? comp.saleDate,
      acres: candidate.acres ?? comp.acres,
      pricePerAcre: candidate.price != null && (candidate.acres ?? comp.acres) != null
        ? Math.round(candidate.price / (candidate.acres ?? comp.acres)!)
        : comp.pricePerAcre,
      sourceUrl: candidate.sourceUrl,
      thumbnailUrl: candidate.thumbnailUrl ?? candidate.photoUrls?.[0] ?? null,
      photoUrls: candidate.photoUrls ?? [],
      compClass: improved ? 'residential' : 'vacant_land',
      statusSource: `${candidate.provider} opened property page reconciled on ${matchedOn.join(', ')}`,
      homeType: candidate.homeType ?? null,
      yearBuilt: candidate.yearBuilt ?? null,
      homeSizeSqft: candidate.homeSizeSqft ?? null,
      });
    });
}

const stated = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined && (typeof value !== 'string' || value.trim().length > 0);

export function mergeCompDetail(sidebar: LandPortalSidebarComp, detail: LandPortalCompDetail | null, subject: { lat?: number | null; lng?: number | null }): EnrichedLandPortalComp {
  const provenance: string[] = [];
  const fromDetail = <K extends keyof LandPortalCompDetail>(key: K): LandPortalCompDetail[K] | undefined => {
    const value = detail?.[key];
    if (stated(value)) { provenance.push(`LandPortal comp detail supplied ${String(key)}.`); return value; }
    return undefined;
  };
  const detailApn = fromDetail('apn');
  const detailAcres = fromDetail('acres');
  const detailPrice = fromDetail('price');
  const detailSaleDate = fromDetail('saleDate');
  const detailPpa = fromDetail('pricePerAcre');
  if (detailApn == null && stated(sidebar.apn)) provenance.push('LandPortal sidebar supplied apn.');
  if (detailAcres == null && stated(sidebar.acres)) provenance.push('LandPortal sidebar supplied acres.');
  if (detailPrice == null && stated(sidebar.price)) provenance.push('LandPortal sidebar supplied price.');
  if (detailSaleDate == null && stated(sidebar.saleDate)) provenance.push('LandPortal sidebar supplied saleDate.');
  if (detailPpa == null && stated(sidebar.pricePerAcre)) provenance.push('LandPortal sidebar supplied pricePerAcre.');
  const address = (fromDetail('address') as string | undefined) ?? null;
  const city = (fromDetail('city') as string | undefined) ?? null;
  const state = (fromDetail('state') as string | undefined) ?? null;
  const zip = (fromDetail('zip') as string | undefined) ?? null;
  const lat = (fromDetail('lat') as number | undefined) ?? null;
  const lng = (fromDetail('lng') as number | undefined) ?? null;
  const imageUrl = (fromDetail('imageUrl') as string | undefined) ?? null;
  const imageSourceLabel = (fromDetail('imageSourceLabel') as string | undefined) ?? null;
  const detailUrl = (fromDetail('detailUrl') as string | undefined) ?? sidebar.detailUrl?.trim() ?? null;
  if (!detail?.detailUrl && sidebar.detailUrl?.trim()) provenance.push('LandPortal sidebar supplied detailUrl.');
  const distanceMiles = compDistanceMiles(subject, { lat, lng });
  const tier = resolveGeographicTier(distanceMiles);
  const resolved = distanceMiles != null;
  const propertyIdentity = sidebar.propertyId?.trim() || (detailApn as string | undefined)?.trim() || sidebar.apn?.trim() || sidebar.detailUrl?.trim();
  const contributed = provenance.some((line) => line.startsWith('LandPortal comp detail'));
  return {
    compKey: propertyIdentity ? `landportal:${propertyIdentity}` : `landportal:${sidebar.price ?? 'unknown'}:${sidebar.acres ?? 'unknown'}:${sidebar.saleDate ?? 'undated'}`,
    apn: (detailApn as string | undefined) ?? sidebar.apn?.trim() ?? null,
    address, city, state, zip,
    acres: (detailAcres as number | undefined) ?? sidebar.acres,
    price: (detailPrice as number | undefined) ?? sidebar.price,
    pricePerAcre: (detailPpa as number | undefined) ?? sidebar.pricePerAcre ?? null,
    saleDate: (detailSaleDate as string | undefined) ?? sidebar.saleDate?.trim() ?? null,
    lat, lng, imageUrl, imageSourceLabel, detailUrl,
    drilledDown: contributed,
    provenance,
    locationResolution: {
      resolved,
      basis: resolved ? 'coordinates' : 'unresolved',
      distanceMiles,
      tierId: tier.id,
      weightMultiplier: tier.weightMultiplier,
      statement: resolved
        ? `LandPortal comp coordinates resolve ${distanceMiles!.toFixed(1)} miles from the subject.`
        : 'The LandPortal comp location could not be resolved, so distance remains unavailable and no location is invented.',
    },
  };
}

export function compVisualForLandPortalComp(comp: EnrichedLandPortalComp): CompVisual {
  return resolveCompVisual({
    thumbnailUrl: comp.imageUrl,
    sourceLabel: comp.imageSourceLabel?.trim() || 'LandPortal',
    lat: comp.lat,
    lng: comp.lng,
    locationResolved: comp.locationResolution.resolved,
    addressOrApn: comp.address || comp.apn,
  });
}

export function buildLandPortalCompPersistence(comp: EnrichedLandPortalComp): { source_label: string; canonical_source: string; address_desc: string | null; city: string | null; state: string | null; zip: string | null; apn: string | null; price: number | null; price_kind: string; sale_or_list_date: string | null; acres: number | null; price_per_acre: number | null; lat: number | null; lng: number | null; distance_miles: number | null; thumbnail_url: string | null; source_url: string | null; notes: string } {
  const status = landPortalSaleStatus({ source: 'LandPortal', dateIso: comp.saleDate });
  return {
    source_label: 'LandPortal',
    canonical_source: 'landportal',
    address_desc: comp.address,
    city: comp.city,
    state: comp.state,
    zip: comp.zip,
    apn: comp.apn,
    price: comp.price,
    price_kind: status.statusBasis === 'closed_sale' ? 'sale' : 'unknown',
    sale_or_list_date: comp.saleDate,
    acres: comp.acres,
    // Dollars per acre is DERIVED from the pair actually retained, never copied
    // from a provider figure. A provider PPA is computed over the acreage that
    // provider used, so carrying it across a corrected acreage publishes a
    // rate neither the price nor the area supports: 044 068.01 held $550,000
    // over 20.55 ac beside a $39,604/ac rate belonging to $200,000 over 5.05.
    price_per_acre: comp.price != null && comp.acres != null && comp.acres > 0
      ? comp.price / comp.acres
      : comp.pricePerAcre,
    lat: comp.lat,
    lng: comp.lng,
    distance_miles: comp.locationResolution.distanceMiles,
    thumbnail_url: comp.imageUrl,
    source_url: comp.detailUrl,
    notes: [...comp.provenance, comp.locationResolution.statement, status.provenance].join(' '),
  };
}
