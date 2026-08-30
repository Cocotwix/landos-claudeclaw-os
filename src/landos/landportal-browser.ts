// LandOS — LandPortal Browser service (Phase 2).
//
// The FIRST browser retrieval service: retrieve the largest amount of useful
// property intelligence in one place. Search by address / APN / owner, navigate
// the property page exactly as a human analyst would, read EVERY visible field,
// and return structured evidence. Capture exactly ONE screenshot — immediately
// after the property page loads (visual proof the right property opened). The
// extracted structured data is the real output; the screenshot is only proof.
//
// STRICT READ-ONLY. Allowed: search / navigate / zoom / pan / expand panels /
// read / copy visible / capture screenshots. Forbidden (recorded as blocked,
// never performed): billing, credit-consuming reports, paid exports/downloads,
// purchases, account/settings changes, writes/edits/deletes. Uses an EXISTING
// authenticated session only; never stores a credential. Driver is injectable —
// the live Puppeteer driver plugs in; the default parked stub never fabricates.

import fs from 'node:fs';

import {
  type BrowserService, type BrowserDriver, type BrowserEvidence, type BrowserWorkflowInput,
  type BrowserSearchKey, type BrowserPageRead, type BrowserRunHooks, type BrowserFact,
  makeParkedDriver, emptyEvidence, recordBlocked, routeBrowserQuestion,
} from './browser-intelligence.js';
import type { PropertyPatch } from './normalized-property.js';
import type {
  PendingLandPortalInspectionRecord,
  LandPortalOverlayObservation,
  LandPortalVisualObservation,
  LandPortalComparableRecord,
} from './property-card.js';
import { extractRecordFacts } from './semantic-extract.js';
import {
  understandPlatform, planNavigationStrategy, verifyTargetReached, findGuidanceLinks,
  pickBestCandidate, scoreResultCandidate, pageServesTask, findWorkSurfaceNav, classifySurface, deriveTaskBoundary, isForbiddenTarget,
  rankSearchMethods,
  type PageObservation, type SearchMethod, type ResultCandidate,
} from './website-intelligence.js';
import { getPlatformIntel, rememberPlatform, platformKey } from './platform-library.js';
import { pickParcelRecordLink } from './browser-navigator.js';
import { addressVariantsCompatible } from './instruction-consistency.js';
import { withOwnedPages } from './browser-owned-pages.js';
import { retrieveWithLearning } from './browser-learning.js';
import { diagnoseFailure, attemptRecovery } from './browser-failure-diagnosis.js';
import { recordNavigationRequirement } from './browser-navigation-model.js';
import { fileSha256 } from './parcel-visual-framing.js';
import {
  validateLandPortalVisualEvidence,
  type LandPortalVisualView,
} from './landportal-evidence-validation.js';
import { isOperatorEntryOnlyLandPortalUrl, operatorLandPortalEntryUrl, validateLandPortalSubjectUrl } from './landportal-operating-rules.js';
// The SHARED LandPortal capability. Every consequential action in this workflow —
// submitting a search, selecting a result, extracting facts, capturing a
// screenshot — passes through its visual checkpoints. No LandPortal result is
// accepted and no screenshot is persisted without them.
import {
  verifySearchConfiguration, verifyResultSelection, verifyParcelSelected, assessScreenshotQuality,
  apnIdentifiersEquivalent,
  type LandPortalSubject, type LandPortalSearchMode, type VisualCheckpoint,
  type SearchConfigurationFrame, type ParcelDetailFrame, type CaptureFrame, type CaptureIntent,
} from './landportal-capability.js';

// NOTE: the apex domain (no www) serves the app; www.landportal.com returns 404.
export const LANDPORTAL_BROWSER_BASE = 'https://landportal.com';
export const LANDPORTAL_SCREENSHOT_PURPOSE = 'landportal_property_loaded';
/** Visual-verification captures: the configured search before it is submitted,
 *  and the selected parcel before anything is extracted from it. These are the
 *  frames the agent actually inspects, not evidence presented to the operator. */
export const LANDPORTAL_SEARCH_CONFIG_PURPOSE = 'landportal_search_configuration_verify';
export const LANDPORTAL_PARCEL_VERIFY_PURPOSE = 'landportal_parcel_selection_verify';
export const LANDPORTAL_3D_SCREENSHOT_PURPOSE = 'landportal_property_3d';
export const LANDPORTAL_BOUNDARY_SCREENSHOT_PURPOSE = 'landportal_parcel_boundary_satellite';
export const LANDPORTAL_COMPARABLES_SCREENSHOT_PURPOSE = 'landportal_comparables_map';

export interface LandPortalBrowserDeps {
  driver?: BrowserDriver;
  now?: () => string;
}

/** Map LandPortal's visible field labels → the normalized property fields. The
 *  page exposes many labels; we read them all and normalize the known ones.
 *  Unknown-but-visible fields are still returned in `fields` (raw evidence). */
const FIELD_MAP: Array<{ rx: RegExp; key: keyof PropertyPatch | 'tax' | 'fema' | 'wetlands' | 'road_frontage' | 'buildable' | 'slope' | 'utilities' | 'land_use' }> = [
  // LandPortal parcel-panel labels are qualified ("Parcel Address County",
  // "Parcel Address City", …), not bare ("County"). Capturing the resolved
  // jurisdiction is what makes a cross-county APN collision (same APN, DIFFERENT
  // county) visible to the wrong-parcel hard-stop — without it the resolved
  // county is invisible and the wrong parcel confirms silently. These specific
  // labels are matched BEFORE the generic address pattern (all anchored with $).
  { rx: /^parcel\s*address\s*county$/i, key: 'county' },
  { rx: /^parcel\s*address\s*city$/i, key: 'city' },
  { rx: /^parcel\s*address\s*state$/i, key: 'state' },
  { rx: /^parcel\s*address\s*zip(\s*code)?$/i, key: 'zip' },
  { rx: /^parcel\s*address$/i, key: 'address' },
  { rx: /^(situs|property|site)?\s*address$/i, key: 'address' },
  { rx: /^apn$|parcel\s*(number|no|#)/i, key: 'apn' },
  { rx: /^parcel\s*id$/i, key: 'propertyId' },
  { rx: /^owner(\s*name)?$/i, key: 'owner' },
  { rx: /^county$/i, key: 'county' },
  { rx: /^city$/i, key: 'city' },
  { rx: /^state$/i, key: 'state' },
  { rx: /^zip|postal/i, key: 'zip' },
  { rx: /^fips$/i, key: 'fips' },
  { rx: /acre|lot\s*size/i, key: 'acres' },
];

function num(v: string): number | undefined {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Normalize a raw page read into a PropertyPatch + a normalized fields map. The
 *  structured patch is the real output. Coordinates are supporting-only (never
 *  identity). parcelVerified is NEVER set here — a browser read is evidence, not a
 *  named-source verification. */
export function extractLandPortalFields(read: BrowserPageRead): { patch: PropertyPatch; fields: Record<string, string> } {
  const patch: PropertyPatch = {};
  const fields: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(read.fields)) {
    const val = (rawVal ?? '').toString().trim();
    if (!val) continue;
    fields[rawKey.trim()] = val;
    const m = FIELD_MAP.find((f) => f.rx.test(rawKey.trim()));
    if (!m) continue;
    if (m.key === 'acres') { const a = num(val); if (a) patch.acres = a; continue; }
    if (m.key === 'propertyId') { patch.propertyId = val; patch.apn ??= val; continue; }
    if (typeof m.key === 'string' && (m.key in ({} as PropertyPatch) || ['address', 'apn', 'propertyId', 'owner', 'county', 'city', 'state', 'zip', 'fips'].includes(m.key))) {
      (patch as Record<string, unknown>)[m.key] = val;
    }
  }
  // Coordinates: only from an explicit lat/lng field, sign-aware, supporting-only.
  const lat = num((read.fields['Latitude'] ?? read.fields['lat'] ?? '').replace(/[^0-9.\-]/g, '')) ?? signedNum(read.fields['Latitude'] ?? read.fields['lat']);
  const lng = signedNum(read.fields['Longitude'] ?? read.fields['lng'] ?? read.fields['lon']);
  if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
    patch.coordinates = { lat, lng };
  }
  return { patch, fields };
}

function signedNum(v?: string): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Build the LandPortal search query from a key, preferring the strongest. */
function searchTermFor(key: BrowserSearchKey): { term: string; by: 'apn' | 'owner' | 'address' } | null {
  if (key.apn) return { term: [key.apn, key.county, key.state].filter(Boolean).join(' '), by: 'apn' };
  if (key.address) return { term: [key.address, key.county, key.state].filter(Boolean).join(' '), by: 'address' };
  if (key.owner) return { term: [key.owner, key.county, key.state].filter(Boolean).join(' '), by: 'owner' };
  return null;
}

function identifierFor(key: BrowserSearchKey): { kind: SearchMethod; value: string } | null {
  // Structured identifiers (APN, owner) are searched BARE — a dedicated APN/owner
  // search method rejects appended county/state. Only an address (a geocoder
  // input) benefits from location context. Generic across platforms.
  if (key.apn) return { kind: 'apn', value: key.apn };
  if (key.address) return { kind: 'address', value: [key.address, key.county, key.state].filter(Boolean).join(' ') };
  if (key.owner) return { kind: 'owner', value: key.owner };
  return null;
}

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
/** Expand a state abbreviation to its full name (for jurisdiction dropdowns). */
function stateName(s?: string): string | undefined {
  if (!s) return undefined;
  const up = s.trim().toUpperCase();
  return US_STATES[up] ?? (s.trim().length > 2 ? s.trim() : undefined);
}

/** Strip a trailing street-type suffix so a typeahead matches ("388 Gilstrap Rd"
 *  → "388 Gilstrap"). Generic. */
function searchableAddress(addr: string): string {
  return addr.split(',')[0].replace(/\b(rd|road|st|street|ave|avenue|dr|drive|ln|lane|ct|court|hwy|highway|blvd|trl|trail|pkwy|cir|pl|way)\.?\s*$/i, '').trim();
}

function addressSearchValue(key: BrowserSearchKey): string | undefined {
  if (!key.address) return undefined;
  const locality = [[key.city, key.state].filter(Boolean).join(', '), key.zip].filter(Boolean).join(' ');
  return [key.address, locality || [key.county, key.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}

function cleanParcelFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(fields)) {
    const key = k.trim();
    const val = raw.trim();
    if (!key || !val) continue;
    if (/^product$/i.test(key) && /^subtotal$/i.test(val)) continue;
    if (/^tokens/i.test(key)) continue;
    if (/^subtotal$|^total$/i.test(key) && /^\$/.test(val)) continue;
    if (/^\+$/.test(key)) continue;
    out[key] = val;
  }
  return out;
}

function asNumber(v?: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function observation(label: string, detail: string, evidence: string, confidence: 'medium' | 'low' = 'medium'): LandPortalVisualObservation {
  return { label, detail, evidence, confidence };
}

function deriveVisualObservations(fields: Record<string, string>, key: BrowserSearchKey): LandPortalVisualObservation[] {
  const out: LandPortalVisualObservation[] = [];
  const waterFeature = (fields['Water Feature'] ?? '').toLowerCase();
  const waterTypes = fields['Water Feature type(s)'] ?? '';
  const frontage = asNumber(fields['Road Frontage'] ?? '');
  const landLocked = (fields['Land Locked'] ?? '').toLowerCase();
  const buildingSqft = asNumber(fields['Building SqFt'] ?? '');

  if (waterFeature === 'yes' && /pond|creek|stream/i.test(waterTypes)) {
    out.push(observation('Water feature visible', `LandPortal indicates ${waterTypes}.`, `Parcel panel: Water Feature type(s) = ${waterTypes}`));
  }
  if (frontage != null && frontage > 0) {
    out.push(observation('Road frontage', `Approx. ${frontage.toFixed(2)} ft of frontage shown on the parcel page.`, `Parcel panel: Road Frontage = ${fields['Road Frontage']}`));
  }
  if (landLocked === 'no') {
    out.push(observation('Apparent road access', 'Parcel page does not flag the tract as landlocked.', 'Parcel panel: Land Locked = No', 'low'));
  }
  if (buildingSqft != null && buildingSqft > 0) {
    out.push(observation('Existing improvement', `Parcel page shows approx. ${Math.round(buildingSqft).toLocaleString()} sqft of improvements.`, `Parcel panel: Building SqFt = ${fields['Building SqFt']}`));
  }
  if ((key.address ?? '').toLowerCase().includes('highway')) {
    out.push(observation('Highway frontage corridor', `Lead address fronts ${key.address}.`, `Input address matched on LandPortal parcel page`, 'low'));
  }
  return out;
}

function normalizeOverlayName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Parse a structured LandPortal comparable CARD.
 *
 * The card is the sidebar surface read as data instead of as text. It supplies
 * the canonical APN, the price and acreage the comp was estimated on, and —
 * critically — LandPortal's own `data-mlsstatus`, which is the ONLY place the
 * sidebar states whether the comp closed. The row's visible text never does, and
 * reading text alone is what previously turned every LandPortal comp into a
 * status-unknown row that could not price the subject.
 */
export function parseComparableCard(raw: string, fallbackUrl: string): LandPortalComparableRecord | null {
  let card: {
    text?: string; sectionLabel?: string; mlsStatus?: string | null; propertyId?: string | null;
    fips?: string | null; apn?: string | null; mlsPropertyId?: string | null;
  };
  try { card = JSON.parse(raw) as typeof card; } catch { return null; }
  const text = String(card.text ?? '').replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
  if (!text) return null;

  const base = parseComparableCandidate(
    card.sectionLabel ? `${card.sectionLabel}${text}` : text,
    fallbackUrl,
    'sidebar',
  );
  if (!base) return null;

  // The card's APN keeps LandPortal's own spacing ("115    02100"); collapse the
  // run of spaces without joining the two halves, so the county-local identifier
  // stays intact and comparable across surfaces.
  const cardApn = card.apn ? String(card.apn).replace(/\s+/g, ' ').trim() : null;

  const stated = String(card.mlsStatus ?? '').trim().toLowerCase();
  const statusFromAttribute: LandPortalComparableRecord['status'] | null =
    stated === 'sold' ? 'sold'
      : stated === 'active' ? 'active'
        : stated === 'listed' || stated === 'for sale' ? 'listed'
          : null;

  return {
    ...base,
    apn: cardApn || base.apn,
    landPortalPropertyId: card.propertyId ?? null,
    fips: card.fips ?? null,
    mlsPropertyId: card.mlsPropertyId ?? null,
    status: statusFromAttribute ?? base.status,
    saleListIndicator: statusFromAttribute
      ? (statusFromAttribute === 'sold' ? 'sale' : 'list')
      : base.saleListIndicator,
    statusSource: statusFromAttribute ? 'card_attribute' : (base.status !== 'unknown' ? 'row_text' : null),
    confidence: statusFromAttribute && base.price != null && base.acres != null ? 'medium' : base.confidence,
  };
}

/** Money/number text off the detail surface ("$91,600.00", "1,120", "-"). */
function detailNumber(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** LandPortal writes dates as MM-DD-YYYY on the detail surface. */
function detailDateIso(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/**
 * Apply a comparable's OWN parcel page onto its sidebar row.
 *
 * This is the second half of the two-surface workflow. The sidebar supplies
 * identity (APN), price and acreage; the comp's parcel page supplies the street
 * address, the sale date, the page's own Listing Status, and the land-versus-
 * improvement facts. Merging is keyed on the sidebar APN, which is canonical.
 *
 * Two facts are established here rather than guessed downstream:
 *   • improvement — a structure with a NOMINAL improvement value is still a land
 *     sale; a material improvement value is not.
 *   • acreageConflict — when the priced row acreage and the parcel acreage
 *     cannot be reconciled (live case: a "17.75 ac" row whose parcel is 574
 *     acres), the row can never carry a defensible price-per-acre.
 */
export function applyComparableDetail(
  row: LandPortalComparableRecord,
  detail: { sourceUrl?: string; facts: Record<string, string> },
): LandPortalComparableRecord {
  const f = detail.facts ?? {};
  const address = (f['Parcel Address'] ?? '').trim() || null;
  const mlsAcres = detailNumber(f['MLS Acres']);
  const parcelAcres = detailNumber(f['Acres']);
  const buildingSqft = detailNumber(f['Building SqFt']);
  const improvementValue = detailNumber(f['Improvement Value']);
  const landMarketValue = detailNumber(f['Land Market Value']);
  const totalMarketValue = detailNumber(f['Total Market Value']);
  const useDescription = (f['Parcel Use Description'] ?? '').trim() || null;

  const listingStatus = (f['Listing Status'] ?? '').trim().toLowerCase();
  const statusFromDetail: LandPortalComparableRecord['status'] | null =
    listingStatus === 'sold' ? 'sold'
      : listingStatus === 'active' ? 'active'
        : listingStatus === 'listed' || listingStatus === 'for sale' ? 'listed'
          : null;

  // The comp's own page outranks the card attribute: the live set contains a row
  // whose card said "sold" while its parcel page shows an ACTIVE $5.95M listing.
  const status = statusFromDetail ?? row.status;
  const mlsSaleDate = detailDateIso(f['Last Sold Date']) ?? detailDateIso(f['Last Sale Date']) ?? row.saleDate ?? undefined;

  // Improvement: material value or real living area means the price bought more
  // than dirt. A token assessor figure on a derelict structure does not.
  const MATERIAL_IMPROVEMENT_VALUE = 10_000;
  const MATERIAL_BUILDING_SQFT = 1_500;
  const landShare = totalMarketValue && totalMarketValue > 0 && landMarketValue != null
    ? landMarketValue / totalMarketValue
    : null;
  const improvement: LandPortalComparableRecord['improvement'] =
    buildingSqft != null && buildingSqft >= MATERIAL_BUILDING_SQFT ? 'improved'
      : improvementValue != null && improvementValue >= MATERIAL_IMPROVEMENT_VALUE ? 'improved'
      : landShare != null && landShare < 0.8 ? 'improved'
        : (buildingSqft != null && improvementValue != null) || landShare != null ? 'vacant'
          : row.improvement;

  // Acreage: the row was priced on the MLS acreage. A parcel acreage that
  // disagrees by more than a rounding margin is a genuine conflict, not a
  // correction — neither figure may silently win.
  const deedAcres = detailNumber(f['Deed Acres']);
  const deedPrice = detailNumber(f['Deed Sale Price']);
  const deedDate = detailDateIso(f['Deed Sale Date']);
  // The parcel's OWN lot size outranks the `Acres` label here. On the API
  // surface that label carries the `similars` feed's MLS listing area, which is
  // the very figure under suspicion; `Deed Acres` is the parcel's `lotsizeacres`.
  // Reading them the other way round let the MLS area validate itself and no
  // conflict could ever be detected.
  const parcelAcresStated = deedAcres ?? parcelAcres;
  const priced = row.acres ?? mlsAcres ?? null;
  const acreageConflict = priced != null && parcelAcresStated != null && parcelAcresStated > 0
    ? Math.abs(parcelAcresStated - priced) / Math.max(parcelAcresStated, priced) > 0.25
    : false;

  // ── THE MLS PAIR AND THE DEED PAIR ARE NEVER MIXED ────────────────────────
  //
  // A priced comparable is a PAIR: some amount changed hands over some area.
  // The `similars` feed states an MLS listing's pair; the parcel's own record
  // states its deed pair. Taking the price from one and the acreage from the
  // other invents a price-per-acre neither surface ever stated, and that is
  // exactly what happened to APN 044 068.01 on 5170 Hwy 60 — one generation
  // retained $550,000 over 20.55 acres, another $200,000 over 5.05, and each
  // carried the OTHER pairing's dollars per acre.
  //
  // When the two pairs disagree on area beyond the conflict margin above, the
  // MLS pair is not describing this parcel. 044 068.01's feed figures are the
  // byte-identical $200,000 / 20.55 ac / $9,732.36 per acre that belong to the
  // neighbouring parcel 043 042, against its own $550,000 warranty deed over
  // 5.05 acres. The deed pair is adopted WHOLE — price, acreage and date
  // together — or not at all. A partial deed record changes nothing, and with
  // no conflict the priced row is left exactly as it was.
  const deedPairComplete = deedPrice != null && deedAcres != null && deedAcres > 0;
  const adoptDeedPair = acreageConflict && deedPairComplete;
  const acres = adoptDeedPair ? deedAcres : row.acres ?? mlsAcres ?? null;
  const price = adoptDeedPair ? deedPrice : row.price ?? null;
  // The date belongs to the pair as well: a deed price carries its own
  // recording date, never the MLS listing's.
  const saleDate = adoptDeedPair ? deedDate ?? mlsSaleDate : mlsSaleDate;

  return {
    ...row,
    address: address ?? row.address ?? null,
    city: (f['Parcel Address City'] ?? '').trim() || null,
    state: (f['Parcel Address State'] ?? '').trim() || null,
    county: (f['Parcel Address County'] ?? '').trim() || null,
    lat: detailNumber(f['Centroid Latitude']),
    lng: detailNumber(f['Centroid Longitude']),
    acres,
    price,
    // Dollars per acre always comes from the pair actually retained, never from
    // a provider figure computed over a different acreage.
    pricePerAcre: acres != null && acres > 0 && price != null ? price / acres : row.pricePerAcre ?? null,
    pricingBasis: adoptDeedPair ? 'parcel_deed_record' : row.pricingBasis ?? null,
    pricingBasisNote: adoptDeedPair
      ? `MLS figures stated ${priced} ac against this parcel's own ${deedAcres} ac, so the listing pair does not describe it. `
        + `Adopted the parcel's own record: $${Math.round(deedPrice!).toLocaleString('en-US')} over ${deedAcres} ac`
        + `${deedDate ? ` recorded ${deedDate}` : ''}${f['Deed Document Type'] ? ` (${f['Deed Document Type']})` : ''}.`
      : row.pricingBasisNote ?? null,
    parcelAcres: parcelAcresStated,
    buildingSqft,
    improvementValue,
    landMarketValue,
    totalMarketValue,
    useDescription,
    acreageConflict,
    improvement,
    status,
    saleDate,
    saleListIndicator: status === 'sold' ? 'sale' : status === 'unknown' ? row.saleListIndicator : 'list',
    statusSource: statusFromDetail ? 'detail_surface' : row.statusSource ?? null,
    detailUrl: detail.sourceUrl ?? null,
    surface: 'both',
    confidence: statusFromDetail && row.price != null && row.acres != null && !acreageConflict ? 'high' : row.confidence,
    rawText: row.rawText,
  };
}

/**
 * Merge the comp detail reads onto the sidebar card rows, keyed on APN.
 *
 * The sidebar APN is the canonical identity, exactly as the operator workflow
 * describes: one enriched record per comparable, never one per surface.
 */
export function mergeComparableDetails(
  rows: LandPortalComparableRecord[],
  details: Array<{ apn?: string | null; sourceUrl?: string; facts: Record<string, string> }>,
): LandPortalComparableRecord[] {
  if (!details.length) return rows;
  const byApn = new Map<string, { sourceUrl?: string; facts: Record<string, string> }>();
  for (const detail of details) {
    const key = comparableApnKey(detail.apn);
    if (key) byApn.set(key, { sourceUrl: detail.sourceUrl, facts: detail.facts });
  }
  return rows.map((row) => {
    const key = comparableApnKey(row.apn);
    const detail = key ? byApn.get(key) : undefined;
    return detail ? applyComparableDetail(row, detail) : row;
  });
}

export function parseComparableCandidate(text: string, sourceUrl: string, surface: 'sidebar' | 'map' = 'sidebar'): LandPortalComparableRecord | null {
  // The live capture prefixes each row with the page's own section heading
  // ("<label><row>"). That label is where LandPortal states whether the
  // block holds closed sales or asking prices; the row text never does.
  const delimiter = text.indexOf('');
  const sectionLabel = delimiter >= 0 ? text.slice(0, delimiter).replace(/\s+/g, ' ').trim() : '';
  const rowText = delimiter >= 0 ? text.slice(delimiter + 1) : text;
  let raw = rowText.replace(/\s+/g, ' ').replace(/[›»]/g, '').trim();
  if (!raw) return null;
  // The map extractor appends the result's own link as "| URL: <href>".
  const inlineUrl = raw.match(/\|\s*URL:\s*(https?:\/\/\S+)/i)?.[1] ?? null;
  if (inlineUrl) raw = raw.replace(/\|\s*URL:\s*https?:\/\/\S+/i, '').trim();
  // Status is read from the row first, then from the section label. Both are
  // the page's own words; neither is inferred.
  const statusText = `${raw} ${sectionLabel}`;
  const priceMatch = raw.match(/\$[\d,]+(?:\.\d+)?/);
  const acreMatch = raw.match(/(\d+(?:\.\d+)?)\s*ac\b/i) ?? raw.match(/\bacres?\s*:\s*(\d+(?:\.\d+)?)/i);
  const ppaMatch = raw.match(/\$([\d,]+(?:\.\d+)?)\s*\/\s*ac\b/i);
  const dateMatch = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}, \d{4}\b/i);
  // A county APN routinely contains internal spaces ("115 02100"). Stopping at
  // the first space truncated it to "115", which corrupts parcel identity and
  // breaks comp dedupe. Capture the whole identifier, then drop any trailing
  // separator the surrounding row text contributed.
  const apn = raw.match(/\bAPN\s*:\s*([A-Z0-9][A-Z0-9.\- ]*)/i)?.[1]?.trim().replace(/[\s.\-]+$/, '') || null;
  const distanceMiles = asNumber(raw.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile)s?\b/i)?.[1]);
  const addressCandidate = raw.match(/^(.+?)(?:\s+\$[\d,]+|\s+\|\s+APN:|\s+Acres?:)/i)?.[1]?.trim() ?? null;
  const address = addressCandidate && !/^\$|^acres?:|^apn:/i.test(addressCandidate) && /(\d+\s+\w+|road|rd|street|st|avenue|ave|drive|dr|lane|ln|boulevard|blvd|trail|trl|way|court|ct|place|pl|highway|hwy)/i.test(addressCandidate)
    ? addressCandidate
    : null;
  // Status is read from the row text FIRST, then from the page's own section
  // heading. Both are LandPortal's wording; neither is inferred from the mere
  // presence of a price.
  let status: LandPortalComparableRecord['status'] =
    /\b(sold|sales)\b/i.test(statusText) ? 'sold'
      : /\bactive\b/i.test(statusText) ? 'active'
        : /\b(listed?|for sale)\b/i.test(statusText) ? 'listed'
          : 'unknown';
  const saleListIndicator: LandPortalComparableRecord['saleListIndicator'] =
    /\b(sold|sales?)\b/i.test(statusText) ? 'sale'
      : /\b(active|listed?|pending|for sale)\b/i.test(statusText) ? 'list'
        : 'unknown';
  const improvement: LandPortalComparableRecord['improvement'] =
    /\b(home|house|residence|bed|bath|sq ?ft|building)\b/i.test(statusText) ? 'improved'
      : /\b(vacant|raw land|unimproved)\b/i.test(statusText) ? 'vacant'
        : 'unknown';
  const acres = acreMatch ? asNumber(acreMatch[1]) : null;
  const price = priceMatch ? asNumber(priceMatch[0]) : null;
  const ppa = ppaMatch ? asNumber(ppaMatch[1]) : null;
  // A row carrying a price and acreage but NO sale/list word is exactly that: a
  // priced row of UNKNOWN status. The previous default stamped it 'listed',
  // fabricating a listing status the page never stated — and that status decides
  // whether the row prices the subject or merely competes with it. Unknown stays
  // unknown; the comp source policy keeps such rows as market context only.
  if (status === 'unknown' && saleListIndicator === 'sale') status = 'sold';
  const confidence: LandPortalComparableRecord['confidence'] =
    (price != null && acres != null) || (status !== 'unknown' && dateMatch) ? 'medium' : 'low';
  if (price == null && acres == null && !dateMatch && !apn && status === 'unknown') return null;
  return {
    rawText: raw,
    sourceUrl: inlineUrl || sourceUrl,
    surface,
    apn,
    address: address && !/^\$/.test(address) ? address : null,
    saleDate: dateMatch?.[0],
    acres,
    price,
    pricePerAcre: ppa,
    distanceMiles,
    status,
    saleListIndicator,
    improvement,
    confidence,
  };
}

async function captureParcel3dView(
  driver: BrowserDriver,
  observe: () => Promise<PageObservation>,
  timeoutMs: number,
): Promise<{ key: string; label: string; kind: 'parcel_3d'; purpose: string; sourcePath: string; timestamp: string; note?: string } | null> {
  if (!driver.clickByText || !driver.screenshot) return null;
  const t = { timeoutMs };
  const labels = ['3D', '3D View', '3D Map'];
  for (const label of labels) {
    try {
      await driver.clickByText(label, t);
      await observe();
      const shot = await driver.screenshot(LANDPORTAL_3D_SCREENSHOT_PURPOSE, t);
      return {
        key: 'parcel_3d',
        label: '3D terrain view',
        kind: 'parcel_3d',
        purpose: shot.purpose,
        sourcePath: shot.path,
        timestamp: shot.capturedAtIso,
        note: 'LandPortal 3D terrain/property view screenshot.',
      };
    } catch {
      // keep trying likely 3D labels
    }
  }
  return null;
}

async function inspectOverlays(
  driver: BrowserDriver,
  observe: () => Promise<PageObservation>,
  timeoutMs: number,
): Promise<{ overlays: LandPortalOverlayObservation[]; assets: Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }> }> {
  const t = { timeoutMs };
  const overlays: LandPortalOverlayObservation[] = [];
  const assets: Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }> = [];
  if (!driver.clickByText || !driver.screenshot) return { overlays, assets };
  const names = ['FEMA Floodplain', 'Wetlands', 'Soil', 'Contours', 'Water features'];
  try { await driver.clickByText('Basemaps & Overlays', t); } catch { /* best-effort */ }
  for (const name of names) {
    try {
      await driver.clickByText(name, t);
      await observe();
      const shot = await driver.screenshot(`landportal_overlay_${normalizeOverlayName(name)}`, t);
      const key = `overlay_${normalizeOverlayName(name)}`;
      assets.push({ key, label: name, kind: 'overlay', purpose: shot.purpose, sourcePath: shot.path, timestamp: shot.capturedAtIso, overlay: name, note: `${name} overlay screenshot from LandPortal.` });
      overlays.push({ overlay: name, status: 'captured', note: `${name} overlay toggled and captured from LandPortal. Visual signal only, not legal verification.`, confidence: 'low', screenshotKey: key });
    } catch {
      overlays.push({ overlay: name, status: 'not_found', note: `${name} overlay was not confidently available in the current LandPortal workspace.`, confidence: 'low' });
    }
  }
  return { overlays, assets };
}

function collectComparableTexts(obs: PageObservation, fields: Record<string, string>, candidates: ResultCandidate[]): string[] {
  const out = new Set<string>();
  for (const c of candidates) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (text) out.add(text);
  }
  for (const [k, v] of Object.entries(fields)) {
    const line = `${k}: ${v}`.replace(/\s+/g, ' ').trim();
    if (/\$[\d,]+/.test(line) || /\b\d+(?:\.\d+)?\s*ac\b/i.test(line)) out.add(line);
  }
  for (const link of obs.links ?? []) {
    const line = `${link.text ?? ''} ${link.href ?? ''}`.replace(/\s+/g, ' ').trim();
    if (/\$[\d,]+/.test(line) || /\b\d+(?:\.\d+)?\s*ac\b/i.test(line)) out.add(line);
  }
  return [...out];
}

async function inspectComparables(
  driver: BrowserDriver,
  observe: () => Promise<PageObservation>,
  timeoutMs: number,
): Promise<{
  comparablesUrl: string | null;
  comparables: LandPortalComparableRecord[];
  asset: { key: string; label: string; kind: 'comparables_map'; purpose: string; sourcePath: string; timestamp: string; note?: string } | null;
}> {
  const t = { timeoutMs };
  if (!driver.clickByText) return { comparablesUrl: null, comparables: [], asset: null };
  try {
    await driver.clickByText('Show on Map', t);
  } catch {
    return { comparablesUrl: null, comparables: [], asset: null };
  }
  const obs = await observe();
  const read = await driver.readFields(t).catch(() => ({ url: obs.url, fields: {}, snippets: [] }));
  const candidates = driver.readCandidates ? await driver.readCandidates(t) as ResultCandidate[] : [];
  const texts = collectComparableTexts(obs, cleanParcelFields(read.fields ?? {}), candidates);
  const sourceUrl = obs.url || read.url || LANDPORTAL_BROWSER_BASE;
  const seen = new Set<string>();
  const comparables = texts
    .map((text) => parseComparableCandidate(text, sourceUrl))
    .filter((row): row is LandPortalComparableRecord => !!row)
    .filter((row) => {
      if (seen.has(row.rawText)) return false;
      seen.add(row.rawText);
      return true;
    });
  const asset = driver.screenshot
    ? await driver.screenshot(LANDPORTAL_COMPARABLES_SCREENSHOT_PURPOSE, { ...t, fullPage: true })
        .then((shot) => ({
          key: 'comparables_map',
          label: 'Comparables map',
          kind: 'comparables_map' as const,
          purpose: shot.purpose,
          sourcePath: shot.path,
          timestamp: shot.capturedAtIso,
          note: 'LandPortal comparables map screenshot.',
        }))
        .catch(() => null)
    : null;
  return { comparablesUrl: sourceUrl, comparables, asset };
}

/**
 * AGENTIC LandPortal retrieval — Observe → Reason → Act → Verify → Learn, looping
 * until it reaches a verified parcel or hits a true hard stop. It navigates to the
 * search surface, then picks the search method BY INTAKE TYPE, drives the
 * typeahead, selects ONLY a high-confidence parcel, verifies the detail panel, and
 * streams real facts to the Deal Card. No fabrication; no forbidden/paid actions.
 *
 * SEARCH PLAYBOOK (LandPortal global search is ONLY for a normal street address):
 *
 *   APN / Parcel ID / Tax ID / parcel number present → APN/Parcel-ID search is the
 *   PRIMARY path (never global search): open the search-method dropdown, select
 *   APN / Parcel ID search, select State first then County, enter the APN, try
 *   EVERY APN variant, open the resulting parcel page, and confirm parcel identity.
 *   (APN and Parcel ID are the same thing for this workflow.)
 *
 *   Owner present (no APN) → Owner search: open the dropdown, select Owner search,
 *   select State first then County, enter the owner name, open a candidate parcel
 *   ONLY when it matches the intake evidence.
 *
 *   Plain street address (no APN/owner) → global/address search.
 *
 * Downstream Property Intelligence runs only AFTER the parcel is confirmed (the
 * verified parcel-panel read is what establishes ParcelIdentity upstream).
 */
// ── Shared-capability adapters ──────────────────────────────────────────────
// The visual checkpoints compare the SUBJECT against what the page displays.
// These map this workflow's observation shape onto the capability's frames; the
// capability itself stays browser-agnostic and pure.

function subjectFromKey(key: BrowserSearchKey): LandPortalSubject {
  return {
    apn: key.apn, apnAlternates: key.apnAlternates, owner: key.owner, address: key.address,
    city: key.city, county: key.county, state: key.state, zip: key.zip,
    // Confirmed measures cross-check the opened parcel; they never drive a search.
    acreage: key.acreage ?? null, lat: key.lat ?? null, lng: key.lng ?? null,
  };
}

/** Which search mode the page VISIBLY shows as selected. Null when the surface
 *  does not display a mode toggle (nothing to compare, never a false claim). */
function observedSearchMode(obs: PageObservation): LandPortalSearchMode | null {
  const current = obs.methodToggle?.current;
  if (!current) return null;
  if (/apn|parcel/i.test(current)) return 'apn';
  if (/owner/i.test(current)) return 'owner';
  if (/address|location|global/i.test(current)) return 'address';
  return null;
}

/** The value the page echoes back for a control, when it exposes one. */
function observedInputValue(obs: PageObservation, selector: string): string | undefined {
  const control = obs.searchControls.find((c) => c.selector === selector) as { value?: string } | undefined;
  return typeof control?.value === 'string' ? control.value : undefined;
}

/** Size of a saved capture, or null when it cannot be read. Null means "cannot
 *  judge blankness", never "the image is fine". */
function byteSize(p: string | null): number | null {
  if (!p) return null;
  try { return fs.statSync(p).size; } catch { return null; }
}

function acceptedVisualValidation(input: {
  propertyCardId: number | undefined;
  path: string;
  view: LandPortalVisualView;
  priorSha256s: string[];
  boundaryRequired?: boolean;
  cameraScale?: 'parcel' | 'context';
}) {
  let sha256: string | null = null;
  let bytes = 0;
  try { sha256 = fileSha256(input.path); bytes = fs.statSync(input.path).size; } catch { /* validator rejects unreadable output */ }
  return validateLandPortalVisualEvidence({
    propertyCardId: input.propertyCardId ?? 0,
    expectedPropertyCardId: input.propertyCardId ?? -1,
    subjectClassification: 'verified_subject',
    requestedView: input.view,
    activeView: input.view,
    boundaryRequired: input.boundaryRequired ?? true,
    boundaryVisible: true,
    tilesLoaded: true,
    bytes,
    sha256,
    priorSha256s: input.priorSha256s,
    cameraScale: input.cameraScale ?? 'parcel',
    clipped: false,
    obstructions: [],
  });
}

function fieldLike(fields: Record<string, string>, rx: RegExp): string | null {
  for (const [k, v] of Object.entries(fields)) { if (rx.test(k) && String(v ?? '').trim()) return String(v).trim(); }
  return null;
}
function numberLike(fields: Record<string, string>, rx: RegExp): number | null {
  const raw = fieldLike(fields, rx);
  if (!raw) return null;
  // Keep the sign: a stripped minus turns a western longitude into an eastern
  // one and would fail the map-location cross-check on every US parcel.
  const match = String(raw).match(/-?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Build the parcel-detail frame from the rendered record page. A field the page
 *  does not display stays null — the capability records that as unverified
 *  rather than treating it as a contradiction. */
function parcelDetailFrame(obs: PageObservation, screenshotPath: string | null, detailPanelOpen: boolean): ParcelDetailFrame {
  const f = obs.fields ?? {};
  return {
    url: obs.url,
    // No map on the detail view means there is no boundary highlight to compare.
    parcelHighlighted: obs.hasMap ? true : null,
    detailPanelOpen,
    owner: fieldLike(f, /owner/i),
    address: fieldLike(f, /parcel address|situs|site address|^address$/i),
    city: fieldLike(f, /^city$/i),
    county: fieldLike(f, /^county$/i),
    state: fieldLike(f, /^state$/i),
    apn: fieldLike(f, /parcel id|parcel number|^apn$/i),
    acreage: numberLike(f, /^acres$|deeded acres|gis acres/i),
    lat: numberLike(f, /latitude|^lat$/i),
    lng: numberLike(f, /longitude|^lon|^lng$/i),
    landPortalPropertyId: (obs.url.match(/[?&]property=([^&]+)/) || [])[1] ?? null,
    fips: fieldLike(f, /fips/i),
    screenshotPath,
  };
}

/**
 * THE ONLY WAY a LandPortal capture becomes evidence.
 *
 * Every retrieval path — agentic, workflow, and legacy — records a quality
 * verdict here and pushes the image only when it is accepted, so no LandPortal
 * screenshot can be presented as proof without having passed the contract. A
 * rejected capture stays as honest history in `captureVerdicts`.
 */
function recordLandPortalCapture(
  ev: BrowserEvidence,
  shot: { path: string; capturedAtIso: string; purpose: string },
  frame: CaptureFrame,
  intent: CaptureIntent,
): boolean {
  const verdict = assessScreenshotQuality(frame, intent);
  (ev.captureVerdicts ??= []).push({ purpose: shot.purpose, path: shot.path, result: verdict.result, reason: verdict.reason });
  if (verdict.result !== 'accepted') return false;
  ev.screenshots.push(shot);
  return true;
}

/** The capture intent for a plain parcel-record proof shot. */
function parcelCaptureIntent(key: BrowserSearchKey, openedApn: string | null): CaptureIntent {
  const subject = subjectFromKey(key);
  return {
    provesFact: `The subject parcel ${key.apn ?? key.address ?? 'record'} as LandPortal renders it, with its boundary in context.`,
    boundaryRequired: true,
    // The opened record's own identifier counts as a subject identifier: a parcel
    // resolved by address with a wrong operator APN is still the right parcel.
    subject: openedApn ? { ...subject, apnAlternates: [...(subject.apnAlternates ?? []), openedApn] } : subject,
  };
}

/** The parcel identifier the page itself displays, when it displays one. */
function displayedParcelApn(fields: Record<string, string> | undefined, key: BrowserSearchKey): string | null {
  return fieldLike(fields ?? {}, /parcel id|parcel number|^apn$/i) ?? key.apn ?? null;
}

function captureFrameFor(obs: PageObservation, apn: string | null, screenshotPath: string | null, bytes: number | null): CaptureFrame {
  return {
    url: obs.url,
    parcelApn: apn,
    intendedOverlay: null,
    activeOverlay: null,
    // A LandPortal parcel view that reached the record page renders the subject
    // boundary; a search surface does not.
    boundaryVisible: /[?&]property=/.test(obs.url),
    tilesLoaded: true,
    obstructions: obs.interactive?.hasModal ? ['modal dialog'] : [],
    bytes,
    screenshotPath,
  };
}

/** The method label a run records when it opened the retained parcel record
 *  instead of searching for it. */
const RETAINED_URL_METHOD = 'retained parcel URL';

/** A LandPortal URL that addresses a parcel RECORD (never a search surface). */
function isLandPortalParcelRecordUrl(url: string | null | undefined): boolean {
  return !!url && /[?&]property=/.test(url);
}

async function runLandPortalAgentic(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
  hooks: Partial<BrowserRunHooks>,
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('landportal', 'workflow');
  const key = input.searchKey;
  const t = () => ({ timeoutMs });
  const obsv = () => driver.observe!(t()) as Promise<PageObservation>;
  const trace: string[] = [];
  const platform = platformKey(LANDPORTAL_BROWSER_BASE);

  try {
    // The subject every visual checkpoint compares the screen against.
    const subject = subjectFromKey(key);
    // Every checkpoint the run performed, in order — the operator-visible record
    // of what was actually looked at before each consequential action.
    const checkpoints: VisualCheckpoint[] = [];
    // The identifier of the parcel the parcel_selected checkpoint verified, as it
    // read at verification time. Captures are compared against THIS, so drift to a
    // different parcel between verification and capture is still caught.
    let verifiedParcelApn: string | null = null;
    // Every capture verdict, including the rejected ones. A rejected capture is
    // retained as honest history and never presented as accepted evidence.
    const captureVerdicts: Array<{ purpose: string; path: string | null; result: string; reason: string }> = [];
    let picked: { index: number; score: number; matched: string[] } | null = null;
    let usedMethod = '';
    let verifiedReached = false;

    // ── RETAINED PARCEL URL: ENTER THE RECORD DIRECTLY ───────────────────────
    // The search sequence below exists to FIND the parcel record. When the
    // subject already carries its own verified canonical LandPortal URL, running
    // it again is pure cost: on a live 300-second run the surface hops plus the
    // ranked search consumed the entire window and the deterministic capture —
    // which reaches the same record in seconds when handed the URL — was never
    // reached at all. Open the retained record, verify it visually exactly as the
    // search path does, and hand it to the same capture. The search path is still
    // there for a subject that has no retained URL, or whose retained URL no
    // longer opens a parcel record that verifies as the subject.
    // A canonical parcel link and an operator's saved-map link are both valid
    // ENTRY POINTS; neither is an identity claim. The parcel checkpoint below is
    // what decides whether the opened record is actually the subject, so a
    // weaker-but-openable link costs nothing: it either verifies or falls back to
    // the ordinary search exactly as a stale canonical URL already does.
    const retainedParcelUrl = operatorLandPortalEntryUrl(key.landPortalParcelUrl);
    // The subject the DIRECT-ENTRY checkpoint compares the opened record against.
    // For a link LandOS retained itself this is the ordinary subject. For the
    // OPERATOR'S own link the caller supplies the operator's own description
    // instead, because the card may already carry a previous run's wrong parcel
    // and that wrong answer must not be allowed to veto the right one.
    const entrySubject = key.operatorSuppliedSubject
      ? subjectFromKey({ ...key.operatorSuppliedSubject, apnAlternates: key.apnAlternates })
      : subject;
    // Set when direct entry already ran the deterministic capture to read the
    // record's panel; the capture below reuses it instead of running twice.
    let directCapture: Awaited<ReturnType<NonNullable<BrowserDriver['captureLandPortalVisuals']>>> | null = null;
    let obs: PageObservation;
    if (retainedParcelUrl) {
      await driver.open(retainedParcelUrl, t());
      obs = await obsv();
      trace.push(`direct-entry:retained parcel URL→${classifySurface(obs)}`);
    } else {
      await driver.open(LANDPORTAL_BROWSER_BASE, t());
      obs = await obsv();
    }
    if (obs.loginLike) { ev.status = 'blocked'; ev.note = 'LandPortal requires login (operator action) — not authenticated.'; rememberPlatform(LANDPORTAL_BROWSER_BASE, { authRequired: true, used: true }); return ev; }
    if (retainedParcelUrl) {
      // A retained URL is a starting point, never a verdict. The record it opens
      // is put through the SAME parcel checkpoint the search path uses before a
      // single fact is read from it.
      if (isLandPortalParcelRecordUrl(obs.url)) {
        const detailShot = await driver.screenshot(LANDPORTAL_PARCEL_VERIFY_PURPOSE, t()).catch(() => null);
        const detailFrame = parcelDetailFrame(obs, detailShot?.path ?? null, true);
        const directCheck = verifyParcelSelected(detailFrame, entrySubject);
        checkpoints.push(directCheck);
        if (directCheck.passed) {
          if (detailFrame.apn) verifiedParcelApn = detailFrame.apn;
          picked = { index: -1, score: 0, matched: ['retained_parcel_url'] };
          usedMethod = RETAINED_URL_METHOD;
          verifiedReached = true;
          trace.push(`direct(parcel) OK:${directCheck.confirmed.length} confirmed${directCheck.unverified.length ? `, ${directCheck.unverified.length} not displayed` : ''}`);
        } else {
          trace.push(`direct(parcel) BLOCKED:${directCheck.blockers.join('; ')}`);
        }
      } else if (isOperatorEntryOnlyLandPortalUrl(key.landPortalParcelUrl) && obs.url === retainedParcelUrl && driver.captureLandPortalVisuals) {
        // ── THE OPENED RECORD IS THE RECORD, WHATEVER THE URL SAYS ──────────
        //
        // Scoped to an OPERATOR ENTRY-ONLY link that is still on screen. A
        // canonical `?property=` link promises identity in the address itself,
        // so one that fails to open its record has failed and must fall back to
        // the search — that path is unchanged. This branch is only for the
        // shape that never had identity in the address to begin with.
        //
        // A LandPortal saved-map link lands ON the parcel with its detail panel
        // already open and fully populated, but the app never rewrites the URL
        // to the `?property=` form. Requiring that shape therefore threw away a
        // record we were already looking at and sent the run back to a blind
        // address search — which, on the acceptance lead, selected the
        // neighbouring parcel.
        //
        // The generic page reader cannot see the panel (it reads label/value
        // pairs and LandPortal renders tab-rows), so the record is read with the
        // deterministic capture that owns that reader. It is the same capture
        // the search path ends in, kept here so it runs once, and its fields go
        // through the SAME checkpoint. Nothing is extracted before that passes.
        //
        // VERIFY ON THE PANEL, NOT ON THE WHOLE CAPTURE. The capture announces
        // the parcel's own facts the moment it has read them and then spends
        // another minute or more on imagery, overlays, terrain and comparables.
        // Awaiting all of that before deciding whether this is even the right
        // parcel is the wait the early handoff exists to remove, so the panel
        // read and the finished capture are raced and whichever answers first
        // carries the checkpoint. The capture keeps running either way.
        try {
          // The proof shot of the record as opened, taken before the capture
          // starts working the page. Same shot the canonical-URL branch takes.
          const entryShot = await driver.screenshot(LANDPORTAL_PARCEL_VERIFY_PURPOSE, t()).catch(() => null);
          let settlePanel: ((fields: Record<string, string>) => void) | null = null;
          const panelRead = new Promise<Record<string, string>>((resolve) => { settlePanel = resolve; });
          // The subject is announced AFTER the checkpoint, not when the panel is
          // read. Announcing on the read handed the run's own identity consumer
          // an unverified parcel, so the consumer could not record the verified
          // verdict — and the verdict only reached it through persistence, on
          // the NEXT invocation. Held here, forwarded below once the checkpoint
          // has actually passed, so one run verifies and admits.
          let announced: { url: string; fields: Record<string, string> } | null = null as
            | { url: string; fields: Record<string, string> }
            | null;
          const capturing = driver.captureLandPortalVisuals(obs.url, {
            ...t(),
            onSubjectFacts: (payload) => {
              announced = payload;
              settlePanel?.(payload.fields ?? {});
            },
          });
          // The loser of the race must not surface as an unhandled rejection.
          capturing.catch(() => { /* reported through the awaited path below */ });
          const panel = await Promise.race([panelRead, capturing.then((v) => v.fields ?? {})]);
          if (Object.keys(panel).length > 0) {
            const detailFrame: ParcelDetailFrame = {
              url: obs.url,
              // The saved map renders the parcel it was saved on; the capture's
              // own screenshot is what the checkpoint inspects for it. At panel
              // time the screenshot does not exist yet, so the page's own map is
              // what the checkpoint has to judge — the capture's screenshot is
              // still assessed on its own terms when it lands.
              parcelHighlighted: obs.hasMap ? true : null,
              detailPanelOpen: true,
              owner: fieldLike(panel, /owner name|^owner$/i),
              address: fieldLike(panel, /^parcel address$/i) ?? fieldLike(panel, /parcel address|situs|site address|^address$/i),
              city: fieldLike(panel, /parcel address city|^city$/i),
              county: fieldLike(panel, /parcel address county|^county$/i),
              state: fieldLike(panel, /parcel address state|^state$/i),
              apn: fieldLike(panel, /parcel id|parcel number|^apn$/i),
              acreage: numberLike(panel, /^acres$|deeded acres|gis acres/i),
              lat: numberLike(panel, /centroid latitude|latitude|^lat$/i),
              lng: numberLike(panel, /centroid longitude|longitude|^lon|^lng$/i),
              landPortalPropertyId: (obs.url.match(/[?&]property=([^&]+)/) || [])[1] ?? null,
              fips: fieldLike(panel, /fips/i),
              screenshotPath: entryShot?.path ?? null,
            };
            const directCheck = verifyParcelSelected(detailFrame, entrySubject);
            checkpoints.push(directCheck);
            if (directCheck.passed) {
              if (detailFrame.apn) verifiedParcelApn = detailFrame.apn;
              picked = { index: -1, score: 0, matched: ['operator_entry_url'] };
              usedMethod = RETAINED_URL_METHOD;
              verifiedReached = true;
              // The parcel is verified: NOW the subject may be announced, and it
              // is announced as verified so this run's own consumer can record
              // the verdict rather than waiting for a later invocation to read
              // it back off disk.
              if (announced) {
                try { hooks.onSubjectFacts?.({ ...announced, verifiedParcelApn: detailFrame.apn }); }
                catch { /* a consumer that throws cannot affect the run */ }
              }
              // The capture is still running. It is awaited once, below, where
              // the search path awaits its own — so it is never run twice and
              // its imagery still lands on this run's evidence.
              directCapture = await capturing;
              trace.push(`direct(entry-url) OK:${directCheck.confirmed.length} confirmed, panel fields=${Object.keys(panel).length}`);
            } else {
              trace.push(`direct(entry-url) BLOCKED:${directCheck.blockers.join('; ')}`);
              // Let the capture finish so it does not keep working a page the
              // run has abandoned, but never reuse it: the search below may
              // reach a DIFFERENT parcel, and this capture is not of it.
              await capturing.catch(() => null);
            }
          } else {
            trace.push(`direct(entry-url) NO-PANEL:${obs.url || 'no url'}`);
            await capturing.catch(() => null);
          }
        } catch (err) {
          trace.push(`direct(entry-url) FAILED:${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        trace.push(`direct(parcel) NOT-A-RECORD:${obs.url || 'no url'}`);
      }
      if (!verifiedReached) {
        // The retained URL did not open a record that verifies as the subject.
        // Fall back to the ordinary search path from a clean surface.
        await driver.open(LANDPORTAL_BROWSER_BASE, t());
        obs = await obsv();
        if (obs.loginLike) { ev.status = 'blocked'; ev.note = 'LandPortal requires login (operator action) — not authenticated.'; rememberPlatform(LANDPORTAL_BROWSER_BASE, { authRequired: true, used: true }); return ev; }
      }
    }
    const understanding = understandPlatform(obs);
    const taskBoundary = deriveTaskBoundary(obs);

    // Identify the search box (search path only — the direct entry already holds
    // a verified record and never touches a search surface).
    let box: PageObservation['searchControls'][number] | null = null;
    if (!verifiedReached) {
      // OBSERVE/REASON/ACT: reach the parcel-search surface (never a forbidden one).
      for (let hop = 0; hop < 4 && !pageServesTask(obs, 'apn'); hop++) {
        const nav = findWorkSurfaceNav(obs, 'apn');
        if (!nav || isForbiddenTarget(nav.text) || !driver.clickByText) break;
        await driver.clickByText(nav.text, t());
        obs = await obsv();
        trace.push(`surface→${nav.text}(${classifySurface(obs)})`);
      }
      if (!pageServesTask(obs, 'apn')) {
        ev.status = 'partial'; ev.note = `Could not reach the parcel-search surface (at ${classifySurface(obs)}). No forbidden surface touched.`;
        rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, authRequired: true, taskBoundary, used: true, knownLimitations: ['could not reach search surface'] }); return ev;
      }
      box = obs.searchControls.find((c) => /search|address|parcel|apn|enter/i.test([c.label, c.placeholder, c.id, c.name].filter(Boolean).join(' ')))
        ?? obs.searchControls.find((c) => (c.type ?? 'text') === 'text')
        ?? null;
      if (!box) { ev.status = 'partial'; ev.note = 'On the search surface but no search input found.'; return ev; }
    }

    // REASON: EVIDENCE-DRIVEN method order (generic Website Intelligence — no fixed
    // chronological order). rankSearchMethods inspects the identifiers present and
    // ranks the lookup paths by strength; the site then maps each ranked method to
    // its own workflow + value formatting. For LandPortal, the APN/Parcel-ID search
    // mode handles a parcel identifier (never global/address search), trying EVERY
    // variant (a county may index the parcel under a different format, e.g. dashed
    // "094-020.08" vs spaced "094 02008 000"); each attempt is scoped State→County.
    // A present address still cross-checks the resolved parcel (consistency) even
    // when it did not lead the search.
    const ranked = rankSearchMethods({ apn: key.apn, address: key.address, owner: key.owner });
    const attempts: Array<{ method: string; value: string }> = [];
    for (const r of ranked) {
      if (r.method === 'apn' && key.apn) {
        attempts.push({ method: 'apn', value: key.apn });
        for (const alt of key.apnAlternates ?? []) {
          if (alt && alt !== key.apn && !attempts.some((a) => a.method === 'apn' && a.value === alt)) {
            attempts.push({ method: 'apn', value: alt });
          }
        }
      } else if (r.method === 'address') {
        const fullAddress = addressSearchValue(key);
        if (fullAddress && !attempts.some((a) => a.method === 'address')) attempts.push({ method: 'address', value: fullAddress });
      } else if (r.method === 'owner' && key.owner) {
        attempts.push({ method: 'owner', value: key.owner });
      }
    }

    // Distinctive street word(s) from the known address, used to confirm the
    // selected parcel is actually the subject property (guards against an APN that
    // is wrong / belongs to a different same-numbered parcel).
    const streetTokens = key.address
      ? searchableAddress(key.address).toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !/^\d+$/.test(w))
      : [];
    const matchesKnownAddress = (o: PageObservation): boolean => {
      if (!streetTokens.length) return true; // nothing to cross-check
      const hay = Object.values(o.fields).join(' ').toLowerCase();
      return streetTokens.some((tok) => hay.includes(tok));
    };

    let searchSel = box?.selector ?? '';
    // Records every failure-diagnosis recovery attempt so the final note reflects the
    // POST-recovery state (never re-reporting "option selected but search not submitted").
    const recoveryTrace: string[] = [];
    for (let ai = 0; !verifiedReached && ai < attempts.length; ai++) {
      const a = attempts[ai];
      if (hooks.isCancelled?.()) break;
      // Reset to a CLEAN search surface before each attempt (a prior attempt may
      // have opened a parcel/results view that would pollute the next search).
      if (ai > 0 && driver.clickByText) {
        const back = findWorkSurfaceNav(obs, 'apn');
        if (back && !isForbiddenTarget(back.text)) { await driver.clickByText(back.text, t()); obs = await obsv(); }
        const rebox = obs.searchControls.find((c) => /search|address|parcel|apn|enter/i.test([c.label, c.placeholder, c.id, c.name].filter(Boolean).join(' '))) ?? obs.searchControls.find((c) => (c.type ?? 'text') === 'text');
        if (rebox) searchSel = rebox.selector;
      }
      // MANUAL PARITY (LandPortal APN/Parcel-ID): pick the search MODE first, THEN
      // scope State→County, THEN type the identifier — the same order a human uses.
      await driver.selectMethod!(a.method, t());
      // Scope the search to the jurisdiction (State, then County) so a parcel
      // resolves uniquely (the click opens the parcel panel, not a results list).
      //
      // The scope is applied and then READ BACK OFF THE PAGE. What the setter
      // believes it clicked is not evidence; what the dropdowns display is. A
      // county list that loads only after its state is chosen frequently needs a
      // second application, so an incomplete read-back is re-applied once before
      // the checkpoint judges it.
      let appliedScope: string[] = [];
      let scopeView: { available: boolean; state: string | null; county: string | null; extras: string[] } =
        { available: false, state: null, county: null, extras: [] };
      if (driver.setScope && (key.state || key.county)) {
        const scope = [stateName(key.state), key.county].filter(Boolean) as string[];
        // AUTHORITY: a driver that can SEE the scope controls decides both whether
        // they exist and what they display — a failed read is `state: null` on an
        // available control, which blocks. A driver that cannot see them (the
        // parked stub, a non-visual surface) cannot claim the controls exist, so
        // availability falls back to what it managed to apply. Claiming
        // availability on its behalf would block every non-visual surface,
        // including sites that genuinely have no jurisdiction filter.
        const readScope = async () => driver.readScope
          ? await driver.readScope(t()).catch(() => ({ available: true, state: null, county: null, extras: [] }))
          : { available: appliedScope.length > 0, state: appliedScope[0] ?? null, county: appliedScope[1] ?? null, extras: [] };
        const wanted = { state: stateName(key.state), county: key.county };
        const complete = (v: { state: string | null; county: string | null }) =>
          (!wanted.state || !!v.state) && (!wanted.county || !!v.county);

        for (let attempt = 0; attempt < 2; attempt++) {
          appliedScope = await driver.setScope(scope, t());
          scopeView = await readScope();
          if (complete(scopeView)) break;
          trace.push(`scope-retry:${attempt + 1} state="${scopeView.state ?? 'none'}" county="${scopeView.county ?? 'none'}"`);
        }
        trace.push(driver.readScope
          ? `scope-displayed:state="${scopeView.state ?? 'none'}",county="${scopeView.county ?? 'none'}"`
          // Say plainly that nothing was read off the page, so "verified" is never
          // implied by a driver that cannot see the controls.
          : `scope-not-visually-readable:applied="${appliedScope.join('/') || 'none'}"`);
        obs = await obsv();
      }
      await driver.typeSearch!(searchSel, a.value, t());
      obs = await obsv();

      // ── VISUAL CHECKPOINT 1: before submitting ──────────────────────────
      // Look at the configured search and confirm the mode, the entered value,
      // and the jurisdiction filters are what we meant — and that no filter from
      // a previous property survived. A misconfigured search is never submitted.
      const configShot = await driver.screenshot(LANDPORTAL_SEARCH_CONFIG_PURPOSE, t()).catch(() => null);
      const configFrame: SearchConfigurationFrame = {
        url: obs.url,
        selectedMode: observedSearchMode(obs),
        enteredValues: { [a.method]: observedInputValue(obs, searchSel) ?? a.value } as SearchConfigurationFrame['enteredValues'],
        // The jurisdiction filters as the page DISPLAYS them. If the dropdowns
        // still read "Select Value", these are null and the checkpoint blocks the
        // submission — which is exactly the failure this replaces.
        activeState: scopeView.state,
        activeCounty: scopeView.county,
        activeFilters: scopeView.extras,
        screenshotPath: configShot?.path ?? null,
      };
      const configCheck = verifySearchConfiguration(configFrame, {
        mode: a.method as LandPortalSearchMode,
        value: a.value,
        subject,
        // Availability is about whether the SURFACE offers jurisdiction filters,
        // never about whether we managed to set them. Tying it to our own success
        // is what downgraded "the filter is not applied" from a blocker to an
        // unverified note and let the unscoped search through.
        jurisdictionScopingAvailable: scopeView.available,
      });
      checkpoints.push(configCheck);
      if (!configCheck.passed) {
        trace.push(`visual(search-config) BLOCKED:${configCheck.blockers.join('; ')}`);
        continue; // never submit a search we could not visually confirm
      }
      trace.push(`visual(search-config) OK:${a.method}`);

      const candidates = (await driver.readCandidates!(t())) as ResultCandidate[];
      const candidateSample = candidates.slice(0, 3).map((c) => c.text.slice(0, 80)).join(' || ');

      // ── VISUAL CHECKPOINT 2: before selecting a result ──────────────────
      // Compare the visible results field by field — owner, state, county, road,
      // city/ZIP, APN variants, acreage — and select ONLY a result that is
      // structurally the subject. This is the checkpoint that recognizes the
      // first OLD RIDGE RD / SACHAN DILEEP S / Roane row instead of reporting
      // "no confident match", and that refuses a cross-county APN collision.
      const selection = verifyResultSelection(candidates, subject);
      checkpoints.push(selection.checkpoint);
      let best = selection.selected
        ? { index: selection.selected.candidate.index, score: selection.selected.score, matched: selection.selected.matched, confidence: selection.selected.confidence }
        : pickBestCandidate(candidates, key);
      if (selection.selected) trace.push(`visual(result) OK:#${selection.selected.candidate.index}(${selection.selected.matched.join('+')})`);
      if (!best && a.method === 'address' && key.address && /^\s*\d+/.test(key.address) && candidates.length > 0) {
        const firstScore = scoreResultCandidate(candidates[0], key);
        best = { index: candidates[0].index, score: firstScore.score, matched: [...firstScore.matched, 'first_plausible_address_candidate'], confidence: 'medium' };
      }
      // APN AUTOCOMPLETE FALLBACK: we searched by the EXACT APN, so LandPortal's
      // autocomplete lists the matching parcel as a selectable checkbox option — but
      // the option text often shows the ADDRESS (not the APN), so pickBestCandidate
      // finds no HIGH-confidence text match and, without this, the loop `continue`s
      // BEFORE clickCandidate → the option is never selected and submit-after-select
      // recovery never runs (this was the live Scott County bug). Select the
      // best-scoring option that has ANY relation to the intake (score > 0, never
      // pure noise); the record-page verify + address consistency + APN cross-check
      // still reject a wrong parcel (no false facts).
      if (!best && a.method === 'apn' && candidates.length > 0) {
        const ranked = candidates.map((c) => ({ c, s: scoreResultCandidate(c, key) })).sort((x, y) => y.s.score - x.s.score);
        const top = ranked[0];
        if (top && top.s.score > 0) {
          best = { index: top.c.index, score: top.s.score, matched: [...top.s.matched, 'apn_autocomplete_option'], confidence: 'medium' };
        }
      }
      if (!best) {
        // No option relates to the intake. Before giving up on this attempt, INSPECT
        // the intermediate state — the page may still be waiting on a required action
        // (a modal, a pending selection). Diagnose + attempt recovery so the outcome
        // is always POST-recovery, never a stale "not submitted" claim.
        const diag0 = diagnoseFailure(obs);
        if (diag0.hasPendingAction) {
          trace.push(`diagnose(no-pick):[${diag0.signals.join(',')}]→${diag0.nextAction}`);
          if (diag0.missingStep) { try { recordNavigationRequirement(platform, diag0.missingStep, obs); } catch { /* non-fatal */ } }
          const beforeUrl = obs.url;
          const rec0 = await attemptRecovery({ driver, diagnosis: diag0, key, pickCandidate: (c, k) => pickBestCandidate(c as ResultCandidate[], k), opts: t() });
          if (rec0) obs = rec0;
          const v0 = verifyTargetReached(obs, { expectIdentifier: key.apn });
          recoveryTrace.push(`${diag0.nextAction} url ${beforeUrl}→${obs.url} ${v0.pageType}`);
          trace.push(`recover(no-pick):${diag0.nextAction}→${v0.pageType}`);
          if (v0.reached && (matchesKnownAddress(obs) || !streetTokens.length)) { picked = { index: -1, score: 0, matched: ['recovered_pending_action'] }; usedMethod = a.method; verifiedReached = true; break; }
        }
        trace.push(`${a.method}:"${a.value}"→${candidates.length} cand, no confident match`); continue;
      }
      // Select the matching option. For APN/Parcel-ID this ticks LandPortal's
      // autocomplete checkbox row (it does NOT navigate on its own).
      await driver.clickCandidate!(best.index, t());
      obs = await obsv();
      let v = verifyTargetReached(obs, { expectIdentifier: key.apn });
      // FAILURE DIAGNOSIS: if selecting the option did not reach a parcel/results
      // page, INSPECT THE INTERMEDIATE STATE before concluding "not found". The site
      // may be waiting on a required next action — submit-after-select (LandPortal's
      // APN autocomplete), a pending selection, a modal to dismiss, or a results row
      // to open. Diagnose it, record the missing step on the navigation playbook,
      // retry the corrected action, and re-verify. Generic across every interactive
      // site; never fabricates a reached state (identity is re-checked below).
      if (!v.reached && v.pageType !== 'results_list') {
        const diag = diagnoseFailure(obs);
        if (diag.hasPendingAction) {
          trace.push(`diagnose:[${diag.signals.join(',')}]→${diag.nextAction}`);
          if (diag.missingStep) { try { recordNavigationRequirement(platform, diag.missingStep, obs); } catch { /* non-fatal */ } }
          const beforeUrl = obs.url;
          const recovered = await attemptRecovery({ driver, diagnosis: diag, key, pickCandidate: (c, k) => pickBestCandidate(c as ResultCandidate[], k), opts: t() });
          if (recovered) obs = recovered;
          v = verifyTargetReached(obs, { expectIdentifier: key.apn });
          // Instrumentation: record the URL change so a live trace shows the page
          // actually navigated after submit-after-select recovery.
          recoveryTrace.push(`${diag.nextAction} url ${beforeUrl}→${obs.url} ${v.pageType}`);
          trace.push(`recover:${diag.nextAction} urlChanged=${beforeUrl !== obs.url}→${v.pageType}`);
        }
      }
      let openedViaResults = '';
      if (v.pageType === 'results_list' && driver.readCandidates && driver.clickCandidate) {
        const resultCandidates = (await driver.readCandidates(t())) as ResultCandidate[];
        const resultBest = pickBestCandidate(resultCandidates, key) ?? (resultCandidates.length > 0
          ? { index: resultCandidates[0].index, score: 0, matched: ['first_plausible_result_record'], confidence: 'medium' as const }
          : null);
        if (resultBest) {
          await driver.clickCandidate(resultBest.index, t());
          obs = await obsv();
          v = verifyTargetReached(obs, { expectIdentifier: key.apn });
          openedViaResults = `, result#${resultBest.index}(${resultBest.matched.join('+')})â†’${v.pageType}`;
        }
      }
      // ── VISUAL CHECKPOINT 3: after selecting, before extracting anything ──
      // The highlighted parcel, the detail panel, the owner, the road, the county
      // and state, the APN, the acreage, and the map location must all refer to
      // the SAME subject. A displayed value that contradicts the subject is a
      // hard stop — this is what rejects the Nashville parcel that merely shares
      // an APN string. A value the page does not display is recorded as
      // unverified, never silently treated as agreement.
      let parcelCheck: VisualCheckpoint | null = null;
      if (v.reached) {
        const detailShot = await driver.screenshot(LANDPORTAL_PARCEL_VERIFY_PURPOSE, t()).catch(() => null);
        const detailFrame = parcelDetailFrame(obs, detailShot?.path ?? null, true);
        parcelCheck = verifyParcelSelected(detailFrame, subject);
        // Remember the identifier of the parcel this checkpoint VERIFIED, as it
        // read at verification time. Later captures are judged against this, not
        // against unverified operator input: a parcel resolved by address with a
        // wrong operator APN (flagged separately as apnConflict) is still the
        // right parcel, and its capture is still evidence.
        if (parcelCheck.passed && detailFrame.apn) verifiedParcelApn = detailFrame.apn;
        checkpoints.push(parcelCheck);
        trace.push(parcelCheck.passed
          ? `visual(parcel) OK:${parcelCheck.confirmed.length} confirmed${parcelCheck.unverified.length ? `, ${parcelCheck.unverified.length} not displayed` : ''}`
          : `visual(parcel) BLOCKED:${parcelCheck.blockers.join('; ')}`);
      }
      // CONSISTENCY: the opened parcel must match the known street address — an
      // APN can be wrong or shared by a different parcel; never accept a mismatch.
      const consistent = matchesKnownAddress(obs) || best.matched.includes('address');
      const visuallyVerified = parcelCheck?.passed === true;
      trace.push(`${a.method}:"${a.value}"→${candidates.length} cand, pick#${best.index}(${best.matched.join('+')})→${v.pageType}${openedViaResults}${consistent ? '' : ',ADDR-MISMATCH'} sample:${candidateSample}`);
      if (v.reached && consistent && visuallyVerified) { picked = best; usedMethod = a.method; verifiedReached = true; break; }
      // else: wrong/unverified parcel — keep adapting (try the next method).
    }

    if (!picked || !verifiedReached) {
      ev.status = 'partial';
      // Operator transparency: the failure NOTE reports what the AGENT DID, never a
      // raw pre-recovery diagnosis. Once recovery was ATTEMPTED (select-then-submit),
      // report the POST-recovery outcome; otherwise say plainly that no result option
      // could be confidently selected. The misleading "an option is selected but the
      // search was not submitted" can no longer appear after recovery runs.
      const diagNote = recoveryTrace.length
        ? ` Recovery was attempted (${recoveryTrace.join('; ')}) — the page was re-observed and re-verified after submitting, but no parcel detail page opened and verified.`
        : ` No result option could be confidently selected to open a parcel detail page; provide/confirm the exact parcel identifier.`;
      ev.visualCheckpoints = checkpoints;
      ev.captureVerdicts = captureVerdicts;
      ev.note = `Searched LandPortal by ${attempts.map((a) => a.method).join('/')} but reached no parcel that both verified AND matched ${key.address || key.apn} (no weak-match, no false facts).${diagNote} Trace: ${trace.join(' | ')}`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, taskBoundary, used: true, navPatterns: trace.join(' | '), knownLimitations: ['no verified parcel consistent with the provided address'] });
      return ev;
    }
    if (obs.url) ev.sourceUrls.push(obs.url);
    const verify = { reason: 'verified parcel panel consistent with the subject address' };

    // ONE-PASS deep-link capture (live driver): the search→click flow lands on a
    // collapsed panel WITHOUT the comparables section, which is why the comps map
    // was previously a duplicate of the parcel view. The canonical deep link renders
    // the full detail view — capture the parcel screenshot + full fields + all comp
    // rows + the real "Show on Map" comps map there, in one fresh tab. Read-only;
    // never a paid Comp/Slope control; never fabricated.
    let panelFields: Record<string, string> = obs.fields;
    let lpVisuals: {
      fields: Record<string, string>; parcelShotPath: string | null; compsMapShotPath: string | null;
      overlayShots?: Array<{ overlay: string; path: string; purpose: string }>;
      visualShots?: Array<{ label: string; path: string; kind: 'parcel_page' | 'overlay' | 'parcel_3d'; purpose: string; overlay?: string }>;
      overlayMisses?: Array<{ overlay: string; reason: string }>; terrainShotPath?: string | null;
      compRows: string[]; compCards?: string[]; compDetails?: string[];
      mapRows?: string[]; mapReached: boolean; capturedAtIso: string;
    } | null = null;
    let shot: Awaited<ReturnType<BrowserDriver['screenshot']>> | null = null;

    // SCREENSHOT QUALITY CONTRACT. Every LandPortal capture is inspected after it
    // is saved and is accepted ONLY when it actually proves its fact: correct
    // parcel, boundary visible, intended map state, readable, unobstructed.
    // An ineffective capture is rejected and never presented as evidence.
    const captureIntent: CaptureIntent = {
      provesFact: `The subject parcel ${key.apn ?? key.address ?? 'record'} as LandPortal renders it, with its boundary in context.`,
      boundaryRequired: true,
      // The verified record's own identifier counts as a subject identifier for
      // capture judging — see verifiedParcelApn above. And when the record was
      // reached through the operator's own entry link, the subject it is judged
      // against is the operator's, for the same reason the parcel checkpoint
      // uses it: the card may carry a previous run's wrong parcel, and judging
      // a correct capture against that reads as "wrong parcel photographed".
      subject: verifiedParcelApn
        ? { ...entrySubject, apnAlternates: [...(entrySubject.apnAlternates ?? []), verifiedParcelApn] }
        : entrySubject,
    };
    // WHICH parcel the capture shows is read from the OPENED RECORD, not from the
    // caller's input. An owner search legitimately starts with no APN at all, and
    // judging the image against the input identifier rejected a perfectly good
    // capture of the right parcel ("selected parcel is none"). The page's own
    // parcel identifier is the only honest answer to "what is in this image?"; the
    // input APN is a last-resort fallback.
    const openedParcelApn = (): string | null =>
      fieldLike(panelFields, /parcel id|parcel number|^apn$/i)
      ?? fieldLike(obs.fields ?? {}, /parcel id|parcel number|^apn$/i)
      ?? key.apn
      ?? null;
    // The agentic path's gate. It assesses, records the verdict for the operator,
    // traces it, and pushes the image ONLY on acceptance — so this function and
    // recordLandPortalCapture are the only two places in the module that can put a
    // screenshot into the evidence set.
    const acceptCapture = (shot: { path: string; capturedAtIso: string; purpose: string }, bytes: number | null): boolean => {
      const verdict = assessScreenshotQuality(captureFrameFor(obs, openedParcelApn(), shot.path, bytes), captureIntent);
      captureVerdicts.push({ purpose: shot.purpose, path: shot.path, result: verdict.result, reason: verdict.reason });
      trace.push(`capture(${verdict.result})${verdict.result === 'accepted' ? '' : `: ${verdict.reason}`}`);
      if (verdict.result !== 'accepted') return false;
      ev.screenshots.push(shot);
      return true;
    };

    // The capture that direct entry already performed to READ the record is the
    // same capture this step would run. Reusing it keeps one browser pass per
    // run; without it, entering at the operator's link would capture twice.
    if (directCapture) {
      const v = directCapture;
      lpVisuals = v;
      if (Object.keys(v.fields).length > Object.keys(panelFields).length) panelFields = { ...panelFields, ...v.fields };
      if (v.parcelShotPath && !acceptCapture(
        { path: v.parcelShotPath, capturedAtIso: v.capturedAtIso, purpose: LANDPORTAL_SCREENSHOT_PURPOSE },
        byteSize(v.parcelShotPath),
      )) {
        lpVisuals = { ...v, parcelShotPath: null };
      }
      trace.push(`lpVisuals(direct-entry): fields=${Object.keys(v.fields).length} comps=${v.compRows.length} mapReached=${v.mapReached}`);
    } else if (obs.url && /[?&]property=/.test(obs.url) && driver.captureLandPortalVisuals) {
      try {
        const v = await driver.captureLandPortalVisuals(obs.url, { ...t(), onSubjectFacts: hooks.onSubjectFacts });
        if (v.parcelShotPath || Object.keys(v.fields).length > 0) {
          lpVisuals = v;
          if (Object.keys(v.fields).length > Object.keys(panelFields).length) panelFields = { ...panelFields, ...v.fields };
          // Ineffective capture: drop it from the evidence set rather than
          // presenting a blank/obstructed/wrong-parcel image as proof.
          if (v.parcelShotPath && !acceptCapture(
            { path: v.parcelShotPath, capturedAtIso: v.capturedAtIso, purpose: LANDPORTAL_SCREENSHOT_PURPOSE },
            byteSize(v.parcelShotPath),
          )) {
            lpVisuals = { ...v, parcelShotPath: null };
          }
          trace.push(`lpVisuals: fields=${Object.keys(v.fields).length} comps=${v.compRows.length} mapReached=${v.mapReached}`);
        }
      } catch (err) {
        // NEVER swallow this. The capture failing because LandOS has no live
        // dedicated browser is indistinguishable, downstream, from LandPortal
        // simply having nothing — that is exactly how three runs reported a
        // clean timeout with no diagnosis. The fallback below still runs; the
        // reason now travels with the evidence the operator reads.
        trace.push(`lpVisuals FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!lpVisuals) {
      // Fallback (non-live/fake driver, or capture failed): working-tab parcel shot
      // + fresh-tab full field read. Never fabricate the rest.
      const taken = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, { ...t(), fullPage: true });
      if (acceptCapture(taken, byteSize(taken.path))) shot = taken;
      if (obs.url && /[?&]property=/.test(obs.url) && driver.readFullPanel) {
        try {
          const full = await driver.readFullPanel(obs.url, t());
          if (Object.keys(full.fields).length > Object.keys(panelFields).length) panelFields = { ...panelFields, ...full.fields };
        } catch { /* keep search-flow fields */ }
      }
    }

    // EXTRACT real parcel facts + stream each to the Deal Card with provenance.
    ev.fields = panelFields;
    const cleanedFields = cleanParcelFields(panelFields);
    const facts: BrowserFact[] = extractRecordFacts(panelFields, { sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal' })
      .map((f) => ({ ...f, extractionMethod: usedMethod === RETAINED_URL_METHOD
        ? 'retained canonical parcel URL → verified parcel panel (full-panel read)'
        : `${usedMethod} search → typeahead select → verified parcel panel (full-panel read)` }));

    // IDENTIFIER MISMATCH: if the operator supplied an APN but the resolved parcel's
    // APN matches NONE of the provided APN/variants, flag it clearly
    // (needs_verification) — never silently accept a conflicting identifier, and
    // never overwrite with a wrong APN. Fires regardless of which method resolved
    // the parcel (APN search that fuzzy-matched, or an address cross-check).
    const compactId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    // WHOSE identifier is being cross-checked.
    //
    // Normally it is the search key's, which is the operator's. But when the run
    // entered at the OPERATOR'S own link, the search key was read off a property
    // card that a previous unverified run may have written the WRONG parcel's
    // APN onto — and on Deal 90 it had. Letting that stale identifier veto here
    // rejects the record the operator personally pointed us at, which is the
    // same "two gates disagreeing about one parcel" defect the comment above
    // describes, one step later. The operator's own identifier is used instead
    // (often none), and the stale card identifier is reported below as what it
    // is: a superseded identifier the operator needs to know about.
    const operatorEntryCheck = usedMethod === RETAINED_URL_METHOD && !!key.operatorSuppliedSubject;
    const checkApn = operatorEntryCheck ? key.operatorSuppliedSubject?.apn : key.apn;
    const checkApnAlternates = operatorEntryCheck ? [] : (key.apnAlternates ?? []);
    const providedApnIds = [checkApn, ...checkApnAlternates].filter(Boolean).map((a) => compactId(a as string));
    const resolvedApn = facts.find((f) => f.key === 'apn')?.value;
    // ONE parcel, two spellings, is not a conflict. This check compared raw
    // compacted strings, so Williamson County's `042 123.00` and LandPortal's
    // own `042-123.00-000` read as different parcels — measured live: the
    // visual parcel checkpoint two steps above had already RECONCILED them and
    // passed, and this gate then threw the same parcel away as a wrong one.
    // Two gates disagreeing about one parcel is the defect; both now ask the
    // same jurisdiction-aware question. A genuinely different identifier still
    // conflicts, which is what this gate exists for.
    const providedApnForms = [checkApn, ...checkApnAlternates].filter((a): a is string => !!a);
    const apnIdentifierMismatch = !!(checkApn && resolvedApn && providedApnIds.length > 0
      && !providedApnIds.includes(compactId(resolvedApn))
      && !providedApnForms.some((form) => apnIdentifiersEquivalent(form, resolvedApn)));
    // A NON-MATCHING IDENTIFIER IS NOT AUTOMATICALLY THE WRONG PARCEL.
    //
    // The operator also supplied a street address, and the record this lane
    // opened prints its own. When those addresses are the same situs, the
    // identifier is the thing that disagrees, not the parcel: a county that
    // files a card/extension suffix, an intake typo, or a stale identifier.
    // Throwing the record away there stranded 333 Cranfill Rd with a complete
    // address in hand and nothing wrong but an APN spelling. The identifier
    // discrepancy is disclosed either way; only the hard STOP is conditioned on
    // the address actually disagreeing too.
    const resolvedSitus = facts.find((f) => f.key === 'address')?.value
      ?? cleanedFields['Parcel Address'] ?? cleanedFields['Address'] ?? null;
    const requestedSitus = key.operatorSuppliedSubject?.address ?? key.address ?? null;
    const situsAgrees = !!(resolvedSitus && requestedSitus
      && addressVariantsCompatible(String(requestedSitus), String(resolvedSitus)));
    const apnConflict = apnIdentifierMismatch && !situsAgrees;
    // The card was carrying a DIFFERENT parcel, and the operator's own link has
    // just shown which parcel this actually is. That is decision-relevant and it
    // is stated plainly — it establishes no fact by itself; the resolver decides
    // whether the retained identifier is superseded.
    if (operatorEntryCheck && key.apn && resolvedApn && !apnIdentifiersEquivalent(key.apn, resolvedApn)) {
      facts.push({
        key: 'supersededApn',
        label: 'Identifier previously on this card names a different parcel',
        value: `This record was opened at the LandPortal link you supplied and its own parcel identifier is "${resolvedApn}". The identifier previously carried on this card, "${key.apn}", is a different parcel and was not established from your link.`,
        sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE,
        confidence: 'high', origin: 'landportal', status: 'needs_verification',
        extractionMethod: 'identifier cross-check (operator entry link vs identifier retained on the card)',
      });
      trace.push(`SUPERSEDED-APN: card ${key.apn} ≠ operator-entry record ${resolvedApn}`);
    }
    if (apnIdentifierMismatch && situsAgrees) {
      facts.push({
        key: 'apnDiscrepancy',
        label: 'Parcel identifier differs from the supplied APN',
        value: `The supplied APN "${checkApn}" does not match the identifier this record prints, "${resolvedApn}", but the record's address "${resolvedSitus}" is the subject address that was supplied. The parcel is carried on the record's own identifier; the supplied APN is retained as operator-provided evidence and the discrepancy stays visible for reconciliation.`,
        sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE,
        confidence: 'high', origin: 'landportal', status: 'needs_verification',
        extractionMethod: 'identifier cross-check (requested APN vs resolved parcel APN, reconciled on the situs address)',
      });
      trace.push(`APN-DISCREPANCY-RECONCILED-BY-ADDRESS: provided ${checkApn} ≠ resolved ${resolvedApn}; situs "${resolvedSitus}" matches the supplied address`);
    }
    if (apnConflict) {
      facts.push({ key: 'apnConflict', label: 'APN identifier mismatch — wrong parcel', value: `Requested APN "${checkApn}" does not match the resolved LandPortal parcel APN "${resolvedApn}". These are DIFFERENT parcels. The resolved parcel is NOT accepted as the subject — the parcel stays unconfirmed and no downstream intelligence runs until the correct parcel is identified.`, sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE, confidence: 'high', origin: 'landportal', status: 'needs_verification', extractionMethod: 'identifier cross-check (requested APN vs resolved parcel APN)' });
      trace.push(`APN-CONFLICT: provided ${checkApn} ≠ resolved ${resolvedApn}`);
    }
    if (apnConflict) {
      const mismatch = facts.find((fact) => fact.key === 'apnConflict');
      if (mismatch) { try { hooks.onFact?.(mismatch as BrowserFact); } catch { /* non-fatal */ } }
      ev.facts = mismatch ? [mismatch] : [];
      ev.fields = {};
      ev.patch = {};
      ev.status = 'no_match';
      ev.visualCheckpoints = checkpoints;
      ev.captureVerdicts = captureVerdicts;
      ev.note = `LandPortal opened a different parcel APN than requested. Subject classification is no_match; no parcel facts, visuals, comps, or estimate were accepted. Trace: ${trace.join(' | ')}`;
      return ev;
    }
    for (const f of facts) { try { hooks.onFact?.(f as BrowserFact); } catch { /* non-fatal */ } }
    ev.facts = facts;
    ev.patch = extractLandPortalFields({ url: obs.url, fields: panelFields, snippets: [] }).patch;
    ev.sourcesUsed = [{ type: 'landportal', url: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal', confidence: 0.9 }];
    ev.status = facts.length ? 'retrieved' : 'partial';
    // The ONLY LandPortal images on the card are the Parcel View + the Comps Map.
    // No overlay/3D/boundary screenshots (overlay data comes from the fact sheet).
    const inspectionAssets: PendingLandPortalInspectionRecord['assets'] = [];
    const acceptedAssetHashes: string[] = [];
    const addValidatedAsset = (
      asset: Omit<PendingLandPortalInspectionRecord['assets'][number], 'validation'>,
      view: LandPortalVisualView,
      boundaryRequired = true,
    ): void => {
      const validation = acceptedVisualValidation({
        propertyCardId: input.propertyCardId,
        path: asset.sourcePath,
        view,
        priorSha256s: acceptedAssetHashes,
        boundaryRequired,
        cameraScale: view === 'parcel_context' || view === 'road_frontage' ? 'context' : 'parcel',
      });
      if (validation.status !== 'accepted') {
        captureVerdicts.push({ purpose: asset.purpose, path: asset.sourcePath, result: 'recapture_required', reason: validation.reasons.join(' ') });
        return;
      }
      if (validation.sha256) acceptedAssetHashes.push(validation.sha256);
      inspectionAssets.push({ ...asset, validation });
    };
    let comparablesUrl: string | null = null;
    let comparables: LandPortalComparableRecord[] = [];
    if (lpVisuals) {
      if (lpVisuals.parcelShotPath) {
        addValidatedAsset({ key: 'parcel_page', label: 'LandPortal Parcel + Neighbor Context', kind: 'parcel_page', purpose: LANDPORTAL_SCREENSHOT_PURPOSE, sourcePath: lpVisuals.parcelShotPath, timestamp: lpVisuals.capturedAtIso, note: 'LandPortal 2D parcel view at parcel-context scale: fitted to the subject then stepped out just enough to keep the complete subject boundary centered with the immediately surrounding parcels and fronting road readable.' }, 'parcel_context');
      }
      const viewForVisual = (label: string, overlay?: string): LandPortalVisualView | null => {
        const value = `${label} ${overlay ?? ''}`;
        if (/road.frontage/i.test(value)) return 'road_frontage';
        if (/wetland/i.test(value)) return 'wetlands';
        if (/fema|flood/i.test(value)) return 'fema_flood';
        if (/soil/i.test(value)) return 'soil';
        if (/contour/i.test(value)) return 'contours';
        if (/front.*3d/i.test(value)) return 'front_3d';
        if (/rear.*3d/i.test(value)) return 'rear_3d';
        if (/parcel|aerial|context/i.test(value)) return 'parcel_context';
        return null;
      };
      for (const visual of lpVisuals.visualShots ?? []) {
        const view = viewForVisual(visual.label, visual.overlay);
        if (!view || visual.path === lpVisuals.parcelShotPath) continue;
        addValidatedAsset({
          key: visual.label,
          label: visual.label.replace(/_/g, ' '),
          kind: visual.kind,
          purpose: visual.purpose,
          sourcePath: visual.path,
          timestamp: lpVisuals.capturedAtIso,
          overlay: visual.overlay,
          note: `Validated LandPortal ${visual.purpose}.`,
        }, view);
      }
      comparablesUrl = obs.url || null;
      // TWO LandPortal surfaces feed one comparable set: the parcel sidebar
      // block, and the expanded "Show on Map" results. The map surface carries
      // street addresses and the page's own status wording, so its fields win on
      // merge while the sidebar's full APN is preserved. Provenance is recorded
      // on every row so the operator can see which surface supplied what.
      // The structured comparable cards are the sidebar surface read as DATA:
      // they carry LandPortal's own `data-mlsstatus` and its identity triple.
      // The text rows remain the fallback for a layout without those cards.
      const cardRows = (lpVisuals.compCards ?? [])
        .map((raw) => parseComparableCard(raw, obs.url || LANDPORTAL_BROWSER_BASE))
        .filter((r): r is LandPortalComparableRecord => !!r);
      const textRows = lpVisuals.compRows
        .map((txt) => parseComparableCandidate(txt, obs.url || LANDPORTAL_BROWSER_BASE, 'sidebar'))
        .filter((r): r is LandPortalComparableRecord => !!r);
      const sidebarRows = cardRows.length ? cardRows : textRows;
      const mapRows = (lpVisuals.mapRows ?? [])
        .map((txt) => parseComparableCandidate(txt, obs.url || LANDPORTAL_BROWSER_BASE, 'map'))
        .filter((r): r is LandPortalComparableRecord => !!r);
      const surfaceMerged = mergeLandPortalSurfaces(sidebarRows, mapRows);
      // Second surface: each comparable's own parcel page, merged on the sidebar
      // APN. This is where the address, the sale date and the land-versus-
      // improvement facts come from; the sidebar row carries none of them.
      const details: Array<{ apn?: string | null; sourceUrl?: string; facts: Record<string, string> }> = [];
      for (const raw of lpVisuals.compDetails ?? []) {
        try {
          const parsed = JSON.parse(raw) as { apn?: string | null; sourceUrl?: string; facts?: Record<string, string> };
          if (parsed && parsed.facts) details.push({ apn: parsed.apn ?? null, sourceUrl: parsed.sourceUrl, facts: parsed.facts });
        } catch { /* one unreadable detail never drops the whole comp set */ }
      }
      // Stamp the capture generation. Inspection is cumulative, so without this
      // the rows a superseded run read stay indistinguishable from the set the
      // provider returns today.
      comparables = mergeComparableDetails(surfaceMerged, details)
        .map((row) => ({ ...row, capturedAtIso: lpVisuals!.capturedAtIso }));
      const stated = comparables.filter((row) => row.status !== 'unknown').length;
      trace.push(
        `landportal surfaces: sidebar=${sidebarRows.length} (cards=${cardRows.length}) map=${mapRows.length} `
        + `detail=${details.length} combined=${comparables.length} statusStated=${stated}`,
      );
      if (lpVisuals.compsMapShotPath && lpVisuals.mapReached) {
        inspectionAssets.push({ key: 'comparables_map', label: 'LandPortal Comps Map', kind: 'comparables_map', purpose: LANDPORTAL_COMPARABLES_SCREENSHOT_PURPOSE, sourcePath: lpVisuals.compsMapShotPath, timestamp: lpVisuals.capturedAtIso, note: 'LandPortal comps map — "Show on Map" clicked and confirmed.' });
      }
    } else {
      if (shot) inspectionAssets.push({ key: 'parcel_page', label: 'LandPortal Parcel View', kind: 'parcel_page', purpose: shot.purpose, sourcePath: shot.path, timestamp: shot.capturedAtIso, note: 'LandPortal parcel page screenshot.' });
      const comparablesResult = await inspectComparables(driver, obsv, timeoutMs);
      if (comparablesResult.asset) inspectionAssets.push(comparablesResult.asset);
      comparablesUrl = comparablesResult.comparablesUrl;
      comparables = comparablesResult.comparables;
    }
    const overlayResult = lpVisuals?.overlayShots?.length
      ? {
          overlays: lpVisuals.overlayShots.map((ov) => ({
            overlay: ov.overlay,
            status: 'captured' as const,
            note: `${ov.overlay} overlay toggled and captured from LandPortal. Visual signal only, not legal verification.`,
            confidence: 'low' as const,
            screenshotKey: `overlay_${normalizeOverlayName(ov.overlay)}`,
          })),
          assets: [] as Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }>,
        }
      : await inspectOverlays(driver, obsv, timeoutMs).catch(() => ({ overlays: [] as LandPortalOverlayObservation[], assets: [] as Array<{ key: string; label: string; kind: 'overlay'; purpose: string; sourcePath: string; timestamp: string; overlay: string; note?: string }> }));
    for (const asset of overlayResult.assets) {
      if (!inspectionAssets.some((a) => a.key === asset.key)) inspectionAssets.push(asset);
    }
    // Overlays the one-pass capture ATTEMPTED but could not render distinctly
    // are recorded as absent — never a relabeled copy of the base map. The
    // operator sees exactly which thematic layer is unavailable and why.
    const overlayObservations: LandPortalOverlayObservation[] = [...overlayResult.overlays];
    for (const miss of lpVisuals?.overlayMisses ?? []) {
      if (overlayObservations.some((o) => o.overlay === miss.overlay)) continue;
      overlayObservations.push({
        overlay: miss.overlay,
        status: 'not_found',
        note: `${miss.overlay} overlay unavailable on LandPortal for this parcel: ${miss.reason}`,
        confidence: 'low',
      });
    }
    const terrainAsset = inspectionAssets.some((a) => a.kind === 'parcel_3d') ? null : await captureParcel3dView(driver, obsv, timeoutMs).catch(() => null);
    if (terrainAsset) inspectionAssets.push(terrainAsset);
    // Final admission sweep. Legacy/generic fallback captures do not carry
    // enough live-state proof to enter the Deal Card. The verified parcel and
    // the explicitly reached comps map can be bound here; every other missing-
    // verdict asset is retained only in the browser trace, never persisted.
    for (let index = inspectionAssets.length - 1; index >= 0; index -= 1) {
      const asset = inspectionAssets[index];
      if (asset.validation?.status === 'accepted') continue;
      const view: LandPortalVisualView | null = asset.key === 'parcel_page'
        ? 'parcel_context'
        : asset.key === 'comparables_map' && lpVisuals?.mapReached
          ? 'comparables_map'
          : null;
      if (!view) {
        captureVerdicts.push({ purpose: asset.purpose, path: asset.sourcePath, result: 'recapture_required', reason: 'No validated live map-state proof accompanies this capture.' });
        inspectionAssets.splice(index, 1);
        continue;
      }
      const validation = acceptedVisualValidation({
        propertyCardId: input.propertyCardId,
        path: asset.sourcePath,
        view,
        priorSha256s: acceptedAssetHashes,
        boundaryRequired: view !== 'comparables_map',
        cameraScale: view === 'parcel_context' ? 'context' : 'parcel',
      });
      if (validation.status !== 'accepted') {
        captureVerdicts.push({ purpose: asset.purpose, path: asset.sourcePath, result: 'recapture_required', reason: validation.reasons.join(' ') });
        inspectionAssets.splice(index, 1);
        continue;
      }
      asset.validation = validation;
      if (validation.sha256) acceptedAssetHashes.push(validation.sha256);
    }
    ev.inspection = {
      parcelUrl: obs.url || null,
      comparablesUrl,
      comparablesCapturedAt: lpVisuals?.capturedAtIso
        ?? comparables.map((row) => row.capturedAtIso ?? null).filter((value): value is string => !!value).sort().at(-1)
        ?? new Date().toISOString(),
      parcelFacts: cleanedFields,
      assets: inspectionAssets,
      overlays: overlayObservations,
      visualObservations: deriveVisualObservations(cleanedFields, key),
      comparables,
    };

    // LEARN: store the validated method + interaction strategy.
    // A direct entry validates no SEARCH strategy — it never ran one. Recording
    // the retained-URL path as a validated search method would teach the platform
    // library a strategy no future run could follow.
    const validatedStrategy = usedMethod === RETAINED_URL_METHOD || !box
      ? undefined
      : { method: (usedMethod as SearchMethod), steps: [{ action: 'select_method' as const, text: usedMethod }, { action: 'fill' as const, selector: box.selector }, { action: 'click' as const, text: 'typeahead high-confidence match' }], reason: `${usedMethod} search → typeahead → high-confidence parcel` };
    rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, validatedStrategy, navPatterns: trace.join(' | '), authRequired: true, confidence: 'high', taskBoundary, used: true, succeeded: ev.status === 'retrieved', validatedNow: ev.status === 'retrieved', knownLimitations: [] });
    // Operator transparency: name the visual checkpoints that were actually
    // passed and every capture that was rejected, so "verified" is a claim the
    // operator can audit rather than a word the agent chose.
    const passedCheckpoints = checkpoints.filter((c) => c.passed).map((c) => c.kind);
    const rejectedCaptures = captureVerdicts.filter((c) => c.result !== 'accepted');
    ev.visualCheckpoints = checkpoints;
    ev.captureVerdicts = captureVerdicts;
    ev.note = `LandPortal (${understanding.platformClass}): ${usedMethod === RETAINED_URL_METHOD ? 'opened the retained verified parcel URL' : `${usedMethod} search`} → visually verified [${passedCheckpoints.join(', ') || 'none'}] → ${usedMethod === RETAINED_URL_METHOD ? 'confirmed the parcel record' : 'selected high-confidence parcel'} → ${facts.length} verified fact(s) streamed with provenance.${rejectedCaptures.length ? ` ${rejectedCaptures.length} ineffective capture(s) rejected and not presented as evidence.` : ''} Trace: ${trace.join(' | ')}`;
    return ev;
  } catch (err) {
    ev.status = 'error';
    ev.note = `LandPortal agentic run failed before any paid action: ${(err as Error)?.message ?? 'unknown'}. No credit consumed. Trace: ${trace.join(' | ')}`;
    return ev;
  }
}

/**
 * LandPortal workflow driven by GENERALIZED Website Intelligence (no LandPortal-
 * specific selectors): Observe → Understand → Research → Plan → Navigate →
 * Verify → Extract → Remember. The platform is learned in the Platform
 * Intelligence Library so reasoning improves over time. It only EXTRACTS after
 * verifying a real record page (never a search/filter form) — Unknown over
 * incorrect. ONE screenshot per verified property. A driver without observe() (or
 * parked) yields honest non-fabricated evidence.
 */
async function runLandPortalWorkflow(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
  hooks: Partial<BrowserRunHooks> = {},
): Promise<BrowserEvidence> {
  const ev = emptyEvidence('landportal', 'workflow');
  const t = () => ({ timeoutMs });
  if (!driver.configured()) {
    ev.status = 'parked';
    ev.note = 'LandPortal browser parked: no authenticated session. Read-only Website-Intelligence workflow runs once a session is provided. No credential stored.';
    return ev;
  }
  const id = identifierFor(input.searchKey);
  if (!id) { ev.status = 'no_match'; ev.note = 'No APN / address / owner provided to search LandPortal.'; return ev; }
  // A full live driver runs the AGENTIC loop (Observe→Reason→Act→Verify→Learn):
  // it adapts the search method (e.g. APN → Address), drives the typeahead, and
  // selects only a high-confidence parcel before extracting.
  if (driver.observe && driver.typeSearch && driver.selectMethod && driver.readCandidates && driver.clickCandidate) {
    return runLandPortalAgentic(input, driver, now, timeoutMs, hooks);
  }
  // A driver without page observation can't apply Website Intelligence reasoning;
  // fall back to the simple search → read → extract path (used by simpler drivers).
  if (!driver.observe) return runLandPortalLegacy(input, driver, ev, timeoutMs);

  try {
    // ── OBSERVE ───────────────────────────────────────────────────────────
    await driver.open(LANDPORTAL_BROWSER_BASE, t());
    ev.sourceUrls.push(LANDPORTAL_BROWSER_BASE);
    let obs = (await driver.observe(t())) as PageObservation;
    if (obs.loginLike) { ev.status = 'blocked'; ev.note = 'LandPortal requires login (not authenticated in the persistent session).'; rememberPlatform(LANDPORTAL_BROWSER_BASE, { authRequired: true, used: true, knownLimitations: ['requires manual login'] }); return ev; }

    // ── UNDERSTAND (+ consult memory) ─────────────────────────────────────
    const understanding = understandPlatform(obs);
    const memory = getPlatformIntel(LANDPORTAL_BROWSER_BASE);
    // ── RESEARCH (guidance available if needed; not blindly clicked) ──────
    const guidance = findGuidanceLinks(obs).length;

    // Learn the platform's allowed/restricted/forbidden work surfaces (task boundary).
    const taskBoundary = deriveTaskBoundary(obs);

    // ── TASK SURFACE — if we landed on the wrong page (orders/account/billing/
    //    dashboard), navigate via the nav menu to the parcel-search surface.
    //    NEVER click a forbidden target (billing/orders/purchase/payment). ─────
    const surfaceTrail: string[] = [classifySurface(obs)];
    for (let hop = 0; hop < 3 && !pageServesTask(obs, id.kind); hop++) {
      const nav = findWorkSurfaceNav(obs, id.kind);
      if (!nav || isForbiddenTarget(nav.text) || !driver.clickByText) break;
      await driver.clickByText(nav.text, t());
      obs = (await driver.observe(t())) as PageObservation;
      surfaceTrail.push(`→ ${nav.text} (${classifySurface(obs)})`);
    }
    if (!pageServesTask(obs, id.kind)) {
      ev.status = 'partial';
      ev.note = `Landed on a "${classifySurface(obs)}" surface (trail: ${surfaceTrail.join(' ')}) and could not reach the parcel-search work surface via the nav menu. No forbidden surface was touched. No facts (Unknown over incorrect).`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, taskBoundary, used: true, navPatterns: `task-surface trail: ${surfaceTrail.join(' ')}`, knownLimitations: ['could not reach the parcel-search surface from the landing page'] });
      return ev;
    }

    // ── PLAN — choose the search method that matches the identifier ───────
    let strategy = planNavigationStrategy(obs, id);
    if (!strategy) {
      ev.status = 'partial';
      ev.note = `Understood LandPortal as "${understanding.platformClass}" (methods: ${understanding.availableSearchMethods.join('/') || 'none detected'}${guidance ? `; ${guidance} help links`: ''}), but found no usable ${id.kind} search control to plan a navigation.`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, used: true, knownLimitations: ['no usable search control detected on landing'] });
      return ev;
    }

    // ── NAVIGATE — execute the planned steps (select method, fill, submit) ─
    for (const step of strategy.steps) {
      if (step.action === 'select_method' && step.selector && step.text) {
        if (driver.selectByText) await driver.selectByText(step.selector, step.text, t());
        else if (driver.clickByText) await driver.clickByText(step.text, t());
      } else if (step.action === 'fill' && step.selector && step.value && driver.fillAndSubmit) {
        await driver.fillAndSubmit(step.selector, step.value, undefined, t());
      } else if (step.action === 'click' && step.text && driver.clickByText) {
        await driver.clickByText(step.text, t());
      }
    }

    // ── VERIFY — confirm a record page before extracting (no false facts) ─
    obs = (await driver.observe(t())) as PageObservation;
    let verify = verifyTargetReached(obs, { expectIdentifier: input.searchKey.apn });
    let interaction = '';

    // (a) Standard anchor result → open it.
    if (!verify.reached && (verify.pageType === 'results_list' || verify.pageType === 'dashboard')) {
      const rec = pickParcelRecordLink(obs.links, input.searchKey);
      if (rec) { await driver.open(rec.href, t()); obs = (await driver.observe(t())) as PageObservation; verify = verifyTargetReached(obs, { expectIdentifier: input.searchKey.apn }); interaction = 'anchor result'; }
    }

    // (b) GENERIC non-anchor result interaction (GIS rows/cards/popups/JS lists):
    //     read candidate elements, score against the parcel, click the best ONLY
    //     at high confidence, then re-observe + re-verify. No weak-match, no guess.
    if (!verify.reached && driver.readCandidates && driver.clickCandidate && (verify.pageType === 'results_list' || verify.pageType === 'dashboard' || verify.pageType === 'unknown')) {
      const candidates = (await driver.readCandidates(t())) as ResultCandidate[];
      const best = pickBestCandidate(candidates, input.searchKey);
      if (best) {
        await driver.clickCandidate(best.index, t());
        obs = (await driver.observe(t())) as PageObservation;
        verify = verifyTargetReached(obs, { expectIdentifier: input.searchKey.apn });
        interaction = `non-anchor result (high-confidence ${best.matched.join('+') || 'match'}, score ${best.score.toFixed(2)})`;
      } else {
        ev.status = 'partial';
        ev.note = `Reached a ${verify.pageType} of ${candidates.length} non-anchor result(s) but none scored a HIGH-confidence match to APN ${input.searchKey.apn || ''}/${input.searchKey.address || ''} — refusing to select (no weak-match, no false facts).`;
        rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, taskBoundary, used: true, navPatterns: `${strategy.method} search → results; non-anchor candidates read (${candidates.length})`, knownLimitations: [`no high-confidence result candidate for the parcel on the ${verify.pageType}`] });
        return ev;
      }
    }
    if (obs.url) ev.sourceUrls.push(obs.url);

    if (!verify.reached) {
      ev.status = 'partial';
      ev.note = `Navigated LandPortal (${understanding.platformClass}, ${strategy.method} search) but did not reach a parcel record (page: ${verify.pageType}). ${verify.reason} No facts extracted (Unknown over incorrect).`;
      rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, authRequired: true, confidence: understanding.confidence, used: true, navPatterns: strategy.reason, knownLimitations: [`${strategy.method} search did not reach a record page (${verify.pageType})`] });
      return ev;
    }

    // ── EXTRACT (verified record) + ONE screenshot ────────────────────────
    // The capture passes the same screenshot-quality contract as the agentic
    // path: an ineffective image is recorded as rejected, never presented.
    const shot = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, t());
    const openedApn = displayedParcelApn(obs.fields, input.searchKey);
    recordLandPortalCapture(
      ev, shot,
      captureFrameFor(obs, openedApn, shot.path, byteSize(shot.path)),
      parcelCaptureIntent(input.searchKey, openedApn),
    );
    const method = `${strategy.method} search${interaction ? ` → ${interaction}` : ''} → verified record`;
    ev.fields = obs.fields;
    ev.facts = extractRecordFacts(obs.fields, { sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal' }).map((f) => ({ ...f, extractionMethod: method }));
    ev.patch = extractLandPortalFields({ url: obs.url, fields: obs.fields, snippets: [] }).patch;
    ev.sourcesUsed = [{ type: 'landportal', url: obs.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal', confidence: 0.85 }];
    ev.status = ev.facts.length ? 'retrieved' : 'partial';

    // ── REMEMBER / IMPROVE — store the validated strategy + interaction pattern ─
    const validatedStrategy = { ...strategy, steps: interaction ? [...strategy.steps, { action: 'click' as const, text: `result candidate: ${interaction}` }] : strategy.steps, reason: `${strategy.reason}${interaction ? ` Then select ${interaction}.` : ''}` };
    rememberPlatform(LANDPORTAL_BROWSER_BASE, { classification: understanding.platformClass, searchMethods: understanding.availableSearchMethods, validatedStrategy, navPatterns: validatedStrategy.reason, authRequired: true, confidence: 'high', taskBoundary, used: true, succeeded: ev.status === 'retrieved', validatedNow: ev.status === 'retrieved', knownLimitations: [] });
    ev.note = `LandPortal understood as "${understanding.platformClass}"; ${method} (${verify.reason}); ${ev.facts.length} fact(s) extracted with provenance; one screenshot.`;
    return ev;
  } catch (err) {
    ev.status = 'error';
    ev.note = `LandPortal Website-Intelligence run failed before any paid action: ${(err as Error)?.message ?? 'unknown error'}. No credit consumed.`;
    return ev;
  }
}

/** Legacy retrieval for drivers without observe(): open → search → read →
 *  extract. The structured fields are the real output; one screenshot per page. */
async function runLandPortalLegacy(input: BrowserWorkflowInput, driver: BrowserDriver, ev: BrowserEvidence, timeoutMs: number): Promise<BrowserEvidence> {
  const term = searchTermFor(input.searchKey);
  if (!term) { ev.status = 'no_match'; ev.note = 'No address / APN / owner to search LandPortal.'; return ev; }
  try {
    await driver.open(LANDPORTAL_BROWSER_BASE, { timeoutMs });
    ev.sourceUrls.push(LANDPORTAL_BROWSER_BASE);
    const searchRead = await driver.search(term.term, { timeoutMs });
    const propRead = searchRead.url && /property|parcel|detail/i.test(searchRead.url) ? searchRead : await driver.readFields({ timeoutMs });
    if (propRead.url) ev.sourceUrls.push(propRead.url);
    // Legacy drivers have no observe(), so the frame is built from the page READ.
    // The contract still applies: an ineffective capture is never evidence.
    const legacyShot = await driver.screenshot(LANDPORTAL_SCREENSHOT_PURPOSE, { timeoutMs });
    const legacyApn = displayedParcelApn(propRead.fields, input.searchKey);
    recordLandPortalCapture(
      ev, legacyShot,
      {
        url: propRead.url ?? '',
        parcelApn: legacyApn,
        intendedOverlay: null,
        activeOverlay: null,
        // A legacy read that reached a parcel record page renders the subject
        // boundary; a search or results page does not.
        boundaryVisible: /property|parcel|detail/i.test(propRead.url ?? ''),
        tilesLoaded: true,
        obstructions: [],
        bytes: byteSize(legacyShot.path),
        screenshotPath: legacyShot.path,
      },
      parcelCaptureIntent(input.searchKey, legacyApn),
    );
    const fullRead = await driver.readFields({ timeoutMs });
    const merged: BrowserPageRead = { url: fullRead.url || propRead.url, fields: { ...propRead.fields, ...fullRead.fields }, snippets: [] };
    const { patch, fields } = extractLandPortalFields(merged);
    ev.patch = patch; ev.fields = fields;
    ev.facts = extractRecordFacts(fields, { sourceName: 'LandPortal', sourceType: 'landportal', sourceUrl: merged.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal' });
    ev.sourcesUsed = [{ type: 'landportal', url: merged.url || LANDPORTAL_BROWSER_BASE, origin: 'landportal', confidence: 0.8 }];
    ev.status = Object.keys(fields).length ? 'retrieved' : 'partial';
    ev.note = ev.status === 'retrieved' ? `LandPortal property opened (${term.by} search); ${Object.keys(fields).length} fields read; one screenshot.` : 'LandPortal page opened but no readable property fields were found.';
    return ev;
  } catch (err) { ev.status = 'error'; ev.note = `LandPortal run failed before any paid action: ${(err as Error)?.message ?? 'unknown'}. No credit consumed.`; return ev; }
}

/**
 * LandPortal retrieval WITH the inspect-and-learn fallback (the layer above the
 * evidence-driven strategy). Runs the agentic workflow; on a clean retrieval it
 * does NOTHING else (no deep inspection). If retrieval fails / hits an unexpected
 * path, it inspects the site, synthesizes + saves a reusable navigation playbook,
 * and retries with it. Future visits reuse the stored playbook; a stale playbook is
 * relearned (version bumped). See browser-learning.ts for the generic orchestration.
 */
async function runLandPortalWithLearning(
  input: BrowserWorkflowInput,
  driver: BrowserDriver,
  now: () => string,
  timeoutMs: number,
  hooks: Partial<BrowserRunHooks> = {},
): Promise<BrowserEvidence> {
  const key = input.searchKey;
  const ranked = rankSearchMethods({ apn: key.apn, address: key.address, owner: key.owner });
  const identifierKind = ranked[0]?.method ?? 'general';
  const platform = platformKey(LANDPORTAL_BROWSER_BASE);

  const result = await retrieveWithLearning<BrowserEvidence>({
    platform,
    taskType: 'parcel_lookup',
    identifierKind,
    attempt: async (_opts) => {
      const ev = await runLandPortalWorkflow(input, driver, now, timeoutMs, hooks);
      // On failure, re-observe the current page so the site can be inspected.
      let observation: PageObservation | null = null;
      if (ev.status !== 'retrieved' && ev.status !== 'parked' && driver.observe) {
        try { observation = (await driver.observe({ timeoutMs })) as PageObservation; } catch { /* best-effort */ }
      }
      return { retrieved: ev.status === 'retrieved', evidence: ev, observation };
    },
  });

  // Surface the learning outcome on the evidence note (operator-visible provenance).
  const ev = result.evidence;
  if (result.inspected) {
    ev.note = `${ev.note} [inspect-and-learn: ${result.relearned ? 'relearned' : 'learned'} ${platform} playbook v${result.playbook?.version ?? '?'}]`;
  } else if (result.reusedPlaybook) {
    ev.note = `${ev.note} [reused ${platform} playbook v${result.playbook?.version ?? '?'} — no inspection]`;
  }
  // Shared navigation-model provenance — reused by every future department on this site.
  if (result.navigationLearned) {
    const secs = result.navigationChangedSections.length ? ` (${result.navigationChangedSections.join(', ')})` : '';
    ev.note = `${ev.note} [navigation model ${platform} v${result.navigation?.version ?? '?'} learned${secs}]`;
  } else if (result.navigation) {
    ev.note = `${ev.note} [navigation model ${platform} v${result.navigation.version} reused]`;
  }
  return ev;
}

export function makeLandPortalBrowser(deps: LandPortalBrowserDeps = {}): BrowserService {
  const driver = deps.driver ?? makeParkedDriver('landportal');
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    id: 'landportal',
    label: 'LandPortal Browser (read-only property intelligence)',
    modes: ['workflow', 'ask'],
    configured() { return driver.configured(); },
    runWorkflow(input, opts) {
      return withOwnedPages(driver, () => runLandPortalWithLearning(input, driver, now, opts.timeoutMs, opts));
    },
    async ask(question, ctx, opts) {
      // Ask mode: LandPortal shows the full property on one page, so any property
      // question is answered by running the property workflow and reading the
      // relevant field from the loaded page. The router records the intent.
      const route = routeBrowserQuestion(question, ctx);
      return withOwnedPages(driver, async () => {
        const ev = await runLandPortalWorkflow({ searchKey: route.searchKey }, driver, now, opts.timeoutMs);
        ev.mode = 'ask';
        if (ev.status !== 'parked' && ev.status !== 'error') {
          ev.note = `Asked: "${route.intent}". ${ev.note}`;
        }
        return ev;
      });
    },
  };
}

/** Demonstrate the read-only contract: a billing/credit action is always blocked. */
export function landPortalBlockedExample(): BrowserEvidence {
  const ev = emptyEvidence('landportal', 'workflow');
  recordBlocked(ev, 'generate_paid_report', 'LandPortal paid report would consume credits — blocked by read-only contract.');
  recordBlocked(ev, 'paid_export', 'Paid export would incur cost — blocked.');
  ev.note = 'Read-only contract: credit/billing actions are recorded as blocked and never performed.';
  return ev;
}


/** Digits-only APN key. Never truncated at a space: "115 02100" -> "11502100". */
function comparableApnKey(apn: string | null | undefined): string | null {
  const digits = String(apn ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  return digits.length >= 5 ? digits : null;
}

/** Normalized street address key for cross-surface matching. */
function comparableAddressKey(address: string | null | undefined): string | null {
  const value = String(address ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return value.length >= 6 ? value : null;
}

/** Same closed transaction: price + acreage + date agree. */
function comparableTransactionKey(row: LandPortalComparableRecord): string | null {
  if (row.price == null || row.acres == null) return null;
  return `${Math.round(row.price)}|${row.acres.toFixed(2)}|${(row.saleDate ?? '').slice(0, 10)}`;
}

/**
 * Merge the LandPortal parcel-sidebar rows with the expanded Show-on-Map rows
 * into ONE deduplicated comparable set.
 *
 * Matching runs strongest-identifier-first: full normalized APN, then exact
 * normalized street address, then price+acreage+date transaction identity.
 * Truncated APNs are never used as a key. When both surfaces describe the same
 * property the richer field wins per-field (the map view supplies addresses and
 * the page's own status wording; the sidebar supplies the full APN), and the
 * row's provenance becomes 'both' so the operator can see it was corroborated —
 * never counted twice.
 */
export function mergeLandPortalSurfaces(
  sidebar: LandPortalComparableRecord[],
  map: LandPortalComparableRecord[],
): LandPortalComparableRecord[] {
  const merged: LandPortalComparableRecord[] = sidebar.map((row) => ({ ...row, surface: 'sidebar' }));

  const findMatch = (row: LandPortalComparableRecord): number => {
    const apn = comparableApnKey(row.apn);
    if (apn) {
      const byApn = merged.findIndex((existing) => comparableApnKey(existing.apn) === apn);
      if (byApn >= 0) return byApn;
    }
    const address = comparableAddressKey(row.address);
    if (address) {
      const byAddress = merged.findIndex((existing) => comparableAddressKey(existing.address) === address);
      if (byAddress >= 0) return byAddress;
    }
    const transaction = comparableTransactionKey(row);
    if (transaction) {
      const byTransaction = merged.findIndex((existing) => comparableTransactionKey(existing) === transaction);
      if (byTransaction >= 0) return byTransaction;
    }
    return -1;
  };

  for (const row of map) {
    const index = findMatch(row);
    if (index < 0) { merged.push({ ...row, surface: 'map' }); continue; }
    const existing = merged[index];
    merged[index] = {
      ...existing,
      // Richer field wins; a stated value never loses to an unknown one.
      address: row.address ?? existing.address,
      apn: existing.apn ?? row.apn,
      acres: existing.acres ?? row.acres,
      price: existing.price ?? row.price,
      pricePerAcre: existing.pricePerAcre ?? row.pricePerAcre,
      distanceMiles: existing.distanceMiles ?? row.distanceMiles,
      saleDate: existing.saleDate ?? row.saleDate,
      status: existing.status !== 'unknown' ? existing.status : row.status,
      saleListIndicator: existing.saleListIndicator && existing.saleListIndicator !== 'unknown' ? existing.saleListIndicator : row.saleListIndicator,
      improvement: existing.improvement !== 'unknown' ? existing.improvement : row.improvement,
      confidence: existing.confidence === 'high' || row.confidence === 'high' ? 'high' : existing.confidence,
      sourceUrl: existing.sourceUrl || row.sourceUrl,
      rawText: existing.rawText === row.rawText ? existing.rawText : `${existing.rawText} || ${row.rawText}`,
      // ── The detail fields the map surface is READ FOR ─────────────────────
      // Show on Map is the surface that publishes coordinates, locality, the
      // comp's own LandPortal identity and its detail page; the sidebar
      // publishes almost none of it. Merging only the thirteen fields above
      // meant every one of these was thrown away whenever a sidebar row
      // matched first — the map surface was opened, read, and then discarded
      // for exactly the rows it corroborated. A stated value fills a blank;
      // it never overwrites one the sidebar already established.
      landPortalPropertyId: existing.landPortalPropertyId ?? row.landPortalPropertyId,
      fips: existing.fips ?? row.fips,
      mlsPropertyId: existing.mlsPropertyId ?? row.mlsPropertyId,
      city: existing.city ?? row.city,
      county: existing.county ?? row.county,
      state: existing.state ?? row.state,
      lat: existing.lat ?? row.lat,
      lng: existing.lng ?? row.lng,
      detailUrl: existing.detailUrl ?? row.detailUrl,
      parcelAcres: existing.parcelAcres ?? row.parcelAcres,
      buildingSqft: existing.buildingSqft ?? row.buildingSqft,
      improvementValue: existing.improvementValue ?? row.improvementValue,
      useDescription: existing.useDescription ?? row.useDescription,
      landMarketValue: existing.landMarketValue ?? row.landMarketValue,
      totalMarketValue: existing.totalMarketValue ?? row.totalMarketValue,
      // An acreage conflict observed on EITHER surface is a conflict.
      acreageConflict: existing.acreageConflict || row.acreageConflict,
      // Pricing basis travels with its own note, so the two are taken together
      // or not at all — a basis explained by the other surface's note would
      // describe a decision that was never made.
      ...(existing.pricingBasis
        ? {}
        : { pricingBasis: row.pricingBasis, pricingBasisNote: row.pricingBasisNote }),
      statusSource: existing.status !== 'unknown' ? existing.statusSource : row.statusSource,
      capturedAtIso: existing.capturedAtIso ?? row.capturedAtIso,
      surface: 'both',
    };
  }
  return merged;
}
