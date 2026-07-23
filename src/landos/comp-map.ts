// Embedded LandOS comp map — the shared, deduplicated map payload.
//
// One pure assembly for EVERY property: subject marker + the final unified comp
// registry (validated sold / active, duplicates merged, rejected audited),
// top-five selection with transparent scores, non-selected classifications, and
// labeled PPA on every usable record. The interactive map (Leaflet + OSM tiles,
// cost-free, attribution required) renders exactly THIS payload — never raw
// provider duplicates. The raw LandPortal "Show on Map" screenshot remains
// separate provider evidence in the visual registry; this map is the final
// deduplicated set and is labeled as such.
//
// Coordinates are ENRICHMENT: provider-supplied or a bounded cached geocode.
// A comp without coordinates stays in the table (never fabricated onto the map).

import type { CompRegistry, UniqueComp } from './comp-registry.js';
import { selectBestComps, type BestCompsSelection, type CompCandidate, type SelectedComp } from './deal-card-reconciliation.js';
import { classifyNonSelected, labeledPricePerAcre, distanceMilesFromSubject, type LabeledPpa, type NonSelectedCandidate } from './comp-orchestrator.js';

export interface CompMapSubject {
  address: string | null;
  apn: string | null;
  acres: number | null;
  lat: number | null;
  lng: number | null;
  /** Optional official GIS parcel ring; absent is an honest map state. */
  polygon?: Array<{ lat: number; lng: number }> | null;
}

export type CompMarkerStatus = 'sold' | 'active' | 'context' | 'duplicate' | 'rejected';

export interface CompMapMarker {
  key: string | null;
  address: string | null;
  apn: string | null;
  status: CompMarkerStatus;
  selected: boolean;
  /** Transparent selection score when the ranking engine scored it. */
  selectionScore: number | null;
  /** Why selected — or why not (classification reason). */
  why: string;
  acres: number | null;
  /** Comp acres minus subject acres (signed), when both known. */
  acresDeltaFromSubject: number | null;
  price: number | null;
  ppa: LabeledPpa | null;
  dateIso: string | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  providers: string[];
  /** Direct links to the original provider pages. */
  providerLinks: string[];
  thumbnailUrl: string | null;
  sourceConfidence: 'high' | 'medium' | 'low' | null;
  comparability: string | null;
  lat: number | null;
  lng: number | null;
  distanceMiles: number | null;
}

export interface CompMapView {
  subject: CompMapSubject;
  markers: CompMapMarker[];
  selection: { rationale: string; selectedCount: number; consideredCount: number };
  counts: {
    sold: number;
    active: number;
    context: number;
    rejected: number;
    duplicatesMerged: number;
    plottable: number;
    tableOnly: number;
  };
  refreshDateIso: string;
  attribution: string;
  /** Labels the two map artifacts apart (raw provider screenshot vs this). */
  mapKind: 'landos_final_deduplicated_registry';
  summaryLine: string;
}

export interface CoordsLookup {
  /** Resolve coordinates for a comp address; null when unknown. Never fabricates. */
  get(address: string | null | undefined): { lat: number; lng: number } | null;
}

const dash = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

function uniqueToCandidate(c: UniqueComp, sold: boolean, subject: CompMapSubject, coords: CoordsLookup): CompCandidate {
  const point = coords.get(c.address);
  return {
    price: c.primary.price,
    pricePerAcre: c.primary.pricePerAcre,
    acres: c.acres,
    saleDateIso: c.primary.dateIso,
    sourceUrl: c.primary.sourceUrls[0] ?? null,
    sourceLabel: c.providers[0] ?? null,
    addressDesc: c.address,
    distanceMiles: point ? distanceMilesFromSubject(subject, point) : c.distanceMiles,
    lane: sold ? 'sold' : 'active',
  };
}

function markerFromUnique(
  c: UniqueComp,
  sold: boolean,
  subject: CompMapSubject,
  coords: CoordsLookup,
  selectedByAddress: Map<string, SelectedComp>,
  nonSelectedByKey: Map<string, NonSelectedCandidate>,
  forceContext = false,
): CompMapMarker {
  const point = coords.get(c.address);
  const addrKey = (c.address ?? '').trim().toLowerCase();
  const sel = addrKey ? selectedByAddress.get(addrKey) : undefined;
  const non = nonSelectedByKey.get(c.key);
  const status: CompMarkerStatus = forceContext ? 'context' : sold ? 'sold' : 'active';
  const acresDelta = typeof c.acres === 'number' && typeof subject.acres === 'number'
    ? Math.round((c.acres - subject.acres) * 100) / 100
    : null;
  return {
    key: c.key,
    address: c.address,
    apn: c.apn,
    status,
    selected: !!sel,
    selectionScore: sel?.score ?? null,
    why: c.inclusionReason ?? (forceContext && c.primary.qualification.missing.length
      ? `Claimed sale retained as context only; missing ${c.primary.qualification.missing.join(' and ')} evidence.`
      : sel ? sel.why : (non?.reason ?? c.comparabilityWhy ?? '')),
    acres: c.acresDisplay ?? c.acres,
    acresDeltaFromSubject: acresDelta,
    price: c.primary.price,
    ppa: labeledPricePerAcre(sold ? 'sold' : 'list', c.primary.price, c.acres),
    dateIso: c.primary.dateIso,
    listingDate: c.primary.listingDate,
    daysOnMarket: c.primary.daysOnMarket,
    providers: c.providers,
    providerLinks: c.transactions.flatMap((t) => t.sourceUrls).filter((u, i, a) => /^https?:\/\//i.test(u) && a.indexOf(u) === i),
    thumbnailUrl: c.primary.thumbnailUrl,
    sourceConfidence: c.sourceConfidence,
    comparability: c.comparability,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    distanceMiles: point ? distanceMilesFromSubject(subject, point) : c.distanceMiles,
  };
}

/**
 * Assemble the embedded comp-map payload from the unified registry. Pure — the
 * caller supplies the subject, registry, and a coordinates lookup (persisted
 * provider coords + cached geocode fills).
 */
export function buildCompMapView(input: {
  subject: CompMapSubject;
  registry: CompRegistry;
  coords: CoordsLookup;
  now?: () => Date;
}): CompMapView {
  const { subject, registry, coords } = input;
  const nowIso = (input.now ?? (() => new Date()))().toISOString();

  // Top-five transparent selection over the validated SOLD uniques only.
  const soldCandidates = registry.validatedSold.map((c) => uniqueToCandidate(c, true, subject, coords));
  const selection: BestCompsSelection = selectBestComps(subject.acres, soldCandidates, 5);
  const selectedByAddress = new Map<string, SelectedComp>();
  for (const s of selection.comps) {
    const k = (s.addressDesc ?? '').trim().toLowerCase();
    if (k) selectedByAddress.set(k, s);
  }
  const selectedKeys = new Set<string>();
  for (const c of registry.validatedSold) {
    const k = (c.address ?? '').trim().toLowerCase();
    if (k && selectedByAddress.has(k)) selectedKeys.add(c.key);
  }

  const nonSelected = classifyNonSelected(registry, selectedKeys);
  const nonSelectedByKey = new Map<string, NonSelectedCandidate>();
  for (const n of nonSelected) if (n.key) nonSelectedByKey.set(n.key, n);

  const markers: CompMapMarker[] = [
    ...registry.validatedSold.map((c) => markerFromUnique(c, true, subject, coords, selectedByAddress, nonSelectedByKey)),
    ...registry.validatedActive.map((c) => markerFromUnique(c, false, subject, coords, selectedByAddress, nonSelectedByKey)),
    ...registry.uniqueComps
      .filter((c) => !registry.validatedSold.some((sold) => sold.key === c.key) && !registry.validatedActive.some((active) => active.key === c.key))
      .map((c) => markerFromUnique(c, c.primary.kind === 'sold', subject, coords, selectedByAddress, nonSelectedByKey, true)),
    // Rejected candidates stay visible (never plotted as usable evidence).
    ...registry.rejected.map((r): CompMapMarker => ({
      key: null, address: dash(r.address), apn: null, status: 'rejected', selected: false,
      selectionScore: null, why: r.reason, acres: null, acresDeltaFromSubject: null,
      price: r.price, ppa: null, dateIso: null, listingDate: null, daysOnMarket: null, providers: [r.provider], providerLinks: [],
      thumbnailUrl: null,
      sourceConfidence: null, comparability: null, lat: null, lng: null, distanceMiles: null,
    })),
  ];

  const mapEligible = markers.filter((m) => m.status === 'sold' || m.status === 'active');
  const plottable = mapEligible.filter((m) => m.lat != null && m.lng != null).length;
  const sold = registry.counts.validatedSold;
  const active = registry.counts.validatedActive;
  const context = markers.filter((m) => m.status === 'context').length;

  return {
    subject,
    markers,
    selection: { rationale: selection.rationale, selectedCount: selection.comps.length, consideredCount: selection.consideredCount },
    counts: {
      sold, active, context,
      rejected: registry.counts.rejected,
      duplicatesMerged: registry.counts.duplicatesMerged,
      plottable,
      tableOnly: mapEligible.length - plottable,
    },
    refreshDateIso: nowIso,
    attribution: '© OpenStreetMap contributors',
    mapKind: 'landos_final_deduplicated_registry',
    summaryLine: `${sold} accepted sold land comp${sold === 1 ? '' : 's'} and ${active} active land listing${active === 1 ? '' : 's'}; ${plottable} shown on the map.`,
  };
}
