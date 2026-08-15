// LandOS — Brockovich AI Data Center Reporting: the 20-mile subject screen.
//
// WHY THIS IS NOT THE BROWSER MAP LANE.
// `brockovich-data-center.ts` drives the live map page and reads a page-owned
// `var centers = [...]` dataset. The site no longer publishes that variable: the
// map now loads its markers asynchronously from two published JSON datasets
// instead, so the browser lane's `centersParsed` gate can never pass and the
// data-center answer degraded to "unavailable" on every lead.
//
// This module reads those SAME published datasets directly:
//
//   community-reports.json   ~9k community-reported data-center / BESS /
//                            substation projects, each with ZIP, city/state,
//                            owner, free-text notes and a report date.
//   zip-geocodes.json        the ZIP → lat/lng table the map itself plots with.
//
// Keyless, browserless, no CDP, no paid credit — so the check actually runs on
// every lead rather than only when a browser happens to be reachable.
//
// DISTANCE HONESTY. A community report is located to its ZIP, so the distance
// here is subject-to-ZIP-centroid and is labeled approximate everywhere it is
// surfaced. Per invariant 3 a coordinate never verifies a parcel: this is
// proximity intelligence about the surrounding market, never parcel identity,
// and it is not used to establish anything about the subject itself.
//
// The screen core is PURE (datasets in → screened hits out) so it is fully
// testable offline; only `fetchBrockovichDatasets` touches the network.

export const BROCKOVICH_SITE = 'https://www.brockovichdatacenter.com/';
export const BROCKOVICH_REPORTS_URL = `${BROCKOVICH_SITE}community-reports.json`;
export const BROCKOVICH_ZIP_GEOCODES_URL = `${BROCKOVICH_SITE}zip-geocodes.json`;
export const DATA_CENTER_SCREEN_RADIUS_MILES = 20;

/** One published community report, as the site publishes it. */
export interface BrockovichCommunityReport {
  date?: string | null;
  cityState?: string | null;
  zip?: string | null;
  /** Site's own category: `data`, `bess`, `substation`, … */
  type?: string | null;
  owner?: string | null;
  notes?: string | null;
}

export interface BrockovichDatasets {
  reports: BrockovichCommunityReport[];
  zipGeocodes: Record<string, { lat: number; lng: number }>;
}

export interface DataCenterProximityHit {
  title: string;
  /** Site category, normalized for the operator. */
  kind: 'data_center' | 'battery_storage' | 'substation' | 'other';
  status: 'community_reported';
  operatorOrDeveloper: string | null;
  location: string | null;
  zip: string | null;
  reportedOn: string | null;
  /** Subject to the report's ZIP centroid. Approximate by construction. */
  distanceMiles: number;
  summary: string;
  sourceUrl: string;
}

/**
 * What the radius was measured FROM. A parcel centroid is the real thing; the
 * subject's ZIP centroid is a coarser stand-in used so the check still answers
 * on a lead whose identity has not resolved coordinates yet. Both are proximity
 * only: per invariant 3 neither one says anything about parcel identity.
 */
export type ProximityBasis = 'subject_coordinates' | 'subject_zip_centroid';

export interface DataCenterProximityScreen {
  status: 'found' | 'none_found' | 'not_run' | 'unavailable';
  radiusMiles: number;
  subject: { lat: number; lng: number } | null;
  basis: ProximityBasis | null;
  hits: DataCenterProximityHit[];
  /** Reports the datasets carried that could not be located to a ZIP centroid,
   *  so a silent drop can never read as "nothing nearby". */
  unlocatedReports: number;
  sourceUrl: string;
  attemptedAt: string;
  /** The one sentence the operator reads. Always populated. */
  verdict: string;
}

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (value: number): number => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const KIND_BY_TYPE: Record<string, DataCenterProximityHit['kind']> = {
  data: 'data_center',
  datacenter: 'data_center',
  'data-center': 'data_center',
  bess: 'battery_storage',
  battery: 'battery_storage',
  substation: 'substation',
  transmission: 'substation',
};

export function classifyReportKind(report: BrockovichCommunityReport): DataCenterProximityHit['kind'] {
  const type = (report.type ?? '').trim().toLowerCase();
  if (KIND_BY_TYPE[type]) return KIND_BY_TYPE[type];
  const text = `${report.notes ?? ''} ${report.owner ?? ''}`.toLowerCase();
  if (/\bdata ?cent(er|re)|hyperscale|ai campus\b/.test(text)) return 'data_center';
  if (/\bbess|battery (storage|energy)\b/.test(text)) return 'battery_storage';
  if (/\bsubstation|transmission\b/.test(text)) return 'substation';
  return 'other';
}

const KIND_LABEL: Record<DataCenterProximityHit['kind'], string> = {
  data_center: 'Data center',
  battery_storage: 'Battery storage (BESS)',
  substation: 'Substation / transmission',
  other: 'Reported energy-infrastructure project',
};

function normalizeZip(value: unknown): string | null {
  const zip = String(value ?? '').trim().slice(0, 5);
  return /^\d{5}$/.test(zip) ? zip : null;
}

/**
 * Screen the published community reports against the subject's coordinates.
 * PURE. Never invents a hit and never silently drops one: reports whose ZIP
 * cannot be located are counted, not discarded quietly.
 */
export function screenDataCentersWithinRadius(input: {
  subject: { lat: number; lng: number } | null;
  datasets: BrockovichDatasets | null;
  /** Coarse fallback point, resolved by the caller from the subject's ZIP. Used
   *  only when `subject` is absent, so the check still answers on a lead whose
   *  identity has not produced a parcel centroid yet. */
  subjectZipPoint?: { lat: number; lng: number } | null;
  /** The ZIP that `subjectZipPoint` came from — labelling only. */
  subjectZip?: string | null;
  radiusMiles?: number;
  nowIso?: string;
}): DataCenterProximityScreen {
  const radiusMiles = input.radiusMiles ?? DATA_CENTER_SCREEN_RADIUS_MILES;
  const attemptedAt = input.nowIso ?? new Date().toISOString();
  const base = { radiusMiles, sourceUrl: BROCKOVICH_SITE, attemptedAt, hits: [], unlocatedReports: 0 };

  const hasCoordinates = !!input.subject
    && Number.isFinite(input.subject.lat) && Number.isFinite(input.subject.lng);
  const fallbackZip = normalizeZip(input.subjectZip);
  const zipPoint = !hasCoordinates
    && input.subjectZipPoint
    && Number.isFinite(input.subjectZipPoint.lat)
    && Number.isFinite(input.subjectZipPoint.lng)
    ? input.subjectZipPoint
    : null;
  const subject = hasCoordinates ? input.subject! : zipPoint;
  const basis: ProximityBasis | null = hasCoordinates
    ? 'subject_coordinates'
    : zipPoint ? 'subject_zip_centroid' : null;

  // Nothing to measure from at all is a different answer from a source outage,
  // and it is decided first — an unreachable dataset never hides it.
  if (!subject) {
    return {
      ...base, status: 'not_run', subject: null, basis: null,
      verdict: `The ${radiusMiles}-mile Brockovich data-center screen did not run: the subject has no confirmed coordinates${fallbackZip ? ` and no boundary could be retrieved for its ZIP ${fallbackZip}` : ' and no ZIP'}, so there is no point to measure from.`,
    };
  }
  if (!input.datasets) {
    return {
      ...base, status: 'unavailable', subject, basis,
      verdict: `The ${radiusMiles}-mile Brockovich data-center screen could not run: the published Brockovich datasets were unreachable. This is a source outage, not evidence that nothing is nearby.`,
    };
  }
  const hits: DataCenterProximityHit[] = [];
  let unlocated = 0;
  for (const report of input.datasets.reports) {
    const zip = normalizeZip(report.zip);
    const point = zip ? input.datasets.zipGeocodes[zip] : undefined;
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      unlocated += 1;
      continue;
    }
    const distanceMiles = haversineMiles(subject, point);
    if (distanceMiles > radiusMiles) continue;
    const kind = classifyReportKind(report);
    const location = (report.cityState ?? '').trim() || null;
    const owner = (report.owner ?? '').trim() || null;
    const notes = (report.notes ?? '').replace(/\s+/g, ' ').trim();
    hits.push({
      title: [KIND_LABEL[kind], location].filter(Boolean).join(' — '),
      kind,
      status: 'community_reported',
      operatorOrDeveloper: owner,
      location,
      zip,
      reportedOn: (report.date ?? '').trim() || null,
      distanceMiles: Math.round(distanceMiles * 10) / 10,
      summary: notes || `Community report filed for ${location ?? `ZIP ${zip}`}.`,
      sourceUrl: BROCKOVICH_SITE,
    });
  }
  hits.sort((a, b) => a.distanceMiles - b.distanceMiles);

  const dataCenters = hits.filter((hit) => hit.kind === 'data_center');
  const from = basis === 'subject_zip_centroid'
    ? `the subject's ZIP ${fallbackZip ?? ''} centroid (the parcel has no confirmed coordinates yet)`.replace(/\s+/g, ' ')
    : 'the subject';
  const verdict = hits.length === 0
    ? `No data-center, battery-storage or substation activity is reported within ${radiusMiles} miles of ${from} in Brockovich Data Center Reporting's published community-report dataset (${input.datasets.reports.length.toLocaleString()} U.S. reports screened). That is a real answer, not a gap.`
    : `${hits.length} Brockovich community-reported project(s) fall within ${radiusMiles} miles of ${from}`
      + `${dataCenters.length ? `, ${dataCenters.length} of them data centers` : ' (none classified as a data center)'}`
      + `; nearest is ${hits[0].title || 'an unnamed project'} at approximately ${hits[0].distanceMiles} miles. Distances are measured to each report's ZIP centroid and are approximate.`;

  return {
    ...base,
    status: hits.length ? 'found' : 'none_found',
    subject,
    basis,
    hits,
    unlocatedReports: unlocated,
    verdict,
  };
}

// ── Resolving where a web-reported project actually is ──────────────────────
//
// Search returns national data-center coverage, so a result that does not name
// the subject's county is not evidence the project is far away. Rather than
// drop it, LandOS tries to establish WHERE it is and measures the real distance
// to the subject. A place it cannot resolve confidently stays unverified
// context — never a counted within-radius hit.

const PLACE_PATTERNS: RegExp[] = [
  // "Laramie County, WY" / "Loudoun County, Virginia"
  /\b([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2})\s+County,\s*([A-Z]{2}\b|[A-Z][a-z]+)/,
  // "Cassville, MO" / "New Carlisle, Indiana"
  /\b([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2}),\s*([A-Z]{2}\b|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/,
];

/**
 * The most specific "Place, State" phrase the text states, or null. PURE.
 * Only explicit, comma-joined place/state phrases qualify — a bare capitalised
 * word is never treated as a location.
 */
export function extractPlaceCandidate(text: string): string | null {
  const haystack = (text ?? '').replace(/\s+/g, ' ');
  for (const [index, pattern] of PLACE_PATTERNS.entries()) {
    const match = pattern.exec(haystack);
    if (!match) continue;
    const place = match[1].trim();
    const state = match[2].trim();
    if (!place || !state) continue;
    return index === 0 ? `${place} County, ${state}` : `${place}, ${state}`;
  }
  return null;
}

/** Forward geocode one place name to a point, or null. Keyless, US-only. */
export type PlaceGeocoder = (place: string) => Promise<{ lat: number; lng: number } | null>;

/**
 * The governed keyless place geocoder — the same free OSM-based forward
 * geocoder the address-suggest lane already uses. No key, no browser, no credit.
 */
export function createPlaceGeocoder(options: { timeoutMs?: number } = {}): PlaceGeocoder {
  return async (place) => {
    const query = (place ?? '').trim();
    if (!query) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, options.timeoutMs ?? 8_000));
    try {
      const response = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en`,
        { signal: controller.signal, headers: { 'User-Agent': 'LandOS/1.0 (property resolution)' } },
      );
      if (!response.ok) return null;
      const body = await response.json() as { features?: Array<{ properties?: { countrycode?: string }; geometry?: { coordinates?: unknown } }> };
      const feature = body.features?.[0];
      if (!feature) return null;
      // US-only: a same-named place abroad is not the subject's neighbour.
      if (feature.properties?.countrycode && String(feature.properties.countrycode).toUpperCase() !== 'US') return null;
      const coordinates = feature.geometry?.coordinates;
      if (!Array.isArray(coordinates)) return null;
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface CandidateLocationResult {
  place: string;
  point: { lat: number; lng: number };
  distanceMiles: number;
}

/**
 * Establish where a candidate project is and how far it is from the subject.
 * Null when no place phrase was stated or the geocoder could not resolve it —
 * which keeps the candidate unverified rather than promoting or discarding it.
 */
export async function resolveCandidateLocation(
  text: string,
  subject: { lat: number; lng: number },
  geocode: PlaceGeocoder,
): Promise<CandidateLocationResult | null> {
  const place = extractPlaceCandidate(text);
  if (!place) return null;
  const point = await geocode(place);
  if (!point) return null;
  return { place, point, distanceMiles: Math.round(haversineMiles(subject, point) * 10) / 10 };
}

export type ProximityFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Retrieve both published Brockovich datasets. Returns null (never throws) when
 * either is unreachable — an unreachable source is reported as unavailable by
 * the screen, never as "nothing found".
 */
export async function fetchBrockovichDatasets(
  options: { fetchImpl?: ProximityFetch; timeoutMs?: number } = {},
): Promise<BrockovichDatasets | null> {
  const impl = options.fetchImpl ?? (globalThis.fetch as unknown as ProximityFetch);
  if (typeof impl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, options.timeoutMs ?? 20_000));
  try {
    const [reportsResponse, zipResponse] = await Promise.all([
      impl(BROCKOVICH_REPORTS_URL, { signal: controller.signal }),
      impl(BROCKOVICH_ZIP_GEOCODES_URL, { signal: controller.signal }),
    ]);
    if (!reportsResponse.ok || !zipResponse.ok) return null;
    const reportsJson = await reportsResponse.json();
    const zipJson = await zipResponse.json();
    const reports = Array.isArray(reportsJson) ? reportsJson as BrockovichCommunityReport[] : null;
    if (!reports) return null;
    const zipGeocodes: BrockovichDatasets['zipGeocodes'] = {};
    if (zipJson && typeof zipJson === 'object' && !Array.isArray(zipJson)) {
      for (const [zip, point] of Object.entries(zipJson as Record<string, unknown>)) {
        const value = point as { lat?: unknown; lng?: unknown } | null;
        const lat = Number(value?.lat);
        const lng = Number(value?.lng);
        if (/^\d{5}$/.test(zip) && Number.isFinite(lat) && Number.isFinite(lng)) zipGeocodes[zip] = { lat, lng };
      }
    }
    if (!Object.keys(zipGeocodes).length) return null;
    return { reports, zipGeocodes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Live screen: fetch the published datasets, then run the pure core. */
export async function runDataCenterProximityScreen(input: {
  lat?: number | null;
  lng?: number | null;
  /** The subject's ZIP, for labelling the fallback basis. */
  zip?: string | null;
  /** Coarse fallback point resolved by the caller from that ZIP. */
  zipPoint?: { lat: number; lng: number } | null;
  radiusMiles?: number;
  fetchImpl?: ProximityFetch;
  timeoutMs?: number;
  nowIso?: string;
}): Promise<DataCenterProximityScreen> {
  const subject = Number.isFinite(input.lat) && Number.isFinite(input.lng)
    ? { lat: Number(input.lat), lng: Number(input.lng) }
    : null;
  const zipPoint = input.zipPoint
    && Number.isFinite(input.zipPoint.lat)
    && Number.isFinite(input.zipPoint.lng)
    ? input.zipPoint
    : null;
  // Nothing to measure from: do not reach the network for datasets we cannot use.
  if (!subject && !zipPoint) {
    return screenDataCentersWithinRadius({
      subject: null, datasets: null, subjectZip: input.zip, radiusMiles: input.radiusMiles, nowIso: input.nowIso,
    });
  }
  const datasets = await fetchBrockovichDatasets({ fetchImpl: input.fetchImpl, timeoutMs: input.timeoutMs });
  return screenDataCentersWithinRadius({
    subject, subjectZipPoint: zipPoint, subjectZip: input.zip, datasets,
    radiusMiles: input.radiusMiles, nowIso: input.nowIso,
  });
}
