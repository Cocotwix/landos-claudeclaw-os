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
    price_per_acre: comp.pricePerAcre,
    lat: comp.lat,
    lng: comp.lng,
    distance_miles: comp.locationResolution.distanceMiles,
    thumbnail_url: comp.imageUrl,
    source_url: comp.detailUrl,
    notes: [...comp.provenance, comp.locationResolution.statement, status.provenance].join(' '),
  };
}
