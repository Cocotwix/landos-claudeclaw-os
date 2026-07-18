import type { DealCardReportView, MarketCompView } from './deal-card-report.js';
import type { PropertyInspectionRecord } from './property-card.js';

export type ComparableStatus = 'sold' | 'pending' | 'active' | 'listed' | 'unknown';
export type ComparablePropertyType = 'vacant_land' | 'manufactured_home' | 'existing_residence' | 'agricultural_improvements' | 'commercial_improvements' | 'other_structures' | 'unknown';
export type IntelligenceConfidence = 'high' | 'medium' | 'low';

export interface NormalizedComparable {
  apn?: string | null;
  address: string | null;
  acreage: number | null;
  salePrice: number | null;
  pricePerAcre: number | null;
  saleDate: string | null;
  status: ComparableStatus;
  saleListIndicator?: 'sale' | 'list' | 'unknown';
  distanceMiles?: number | null;
  radiusTier?: '3_miles' | '5_miles' | '10_miles' | 'county_wide' | null;
  recencyTier?: '12_months' | '18_months' | '24_months' | null;
  propertyType: ComparablePropertyType;
  source: string;
  sourceUrl: string | null;
  confidence: IntelligenceConfidence;
  rawText?: string;
  notes: string[];
  parsingErrors: string[];
}

export interface SubjectPropertyClassification {
  type: ComparablePropertyType;
  confidence: IntelligenceConfidence;
  evidence: string[];
  note: string;
}

export interface ComparableIntelligence {
  subjectClassification: SubjectPropertyClassification;
  acreageBand: string | null;
  comparables: NormalizedComparable[];
  selectedComparables: NormalizedComparable[];
  /** Pending/active/listed rows retained for market context, never valuation. */
  contextComparables: NormalizedComparable[];
  rejectedComparables: Array<{ comparable: NormalizedComparable; reason: string }>;
  estimatedPricePerAcre: { low: number | null; mid: number | null; high: number | null };
  estimatedMarketValue: { low: number | null; mid: number | null; high: number | null } | null;
  confidence: IntelligenceConfidence;
  evidenceUsed: string[];
  evidenceMissing: string[];
  factorsAffectingValue: string[];
}

const ACREAGE_BANDS = [
  { label: 'under-2', min: 0, max: 2 },
  { label: '2-5', min: 2, max: 5 },
  { label: '5-10', min: 5, max: 10 },
  { label: '10-20', min: 10, max: 20 },
  { label: '20-50', min: 20, max: 50 },
  { label: '50-100', min: 50, max: 100 },
  { label: '100+', min: 100, max: Number.POSITIVE_INFINITY },
] as const;

const median = (ns: number[]): number | null => {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const quantile = (ns: number[], q: number): number | null => {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor((s.length - 1) * q)))];
};

function acreageBand(acres: number | null): string | null {
  if (acres == null || acres <= 0) return null;
  return ACREAGE_BANDS.find((b) => acres >= b.min && acres < b.max)?.label ?? null;
}

function sameAcreageBand(subjectAcres: number | null, compAcres: number | null): boolean {
  if (subjectAcres == null || compAcres == null || subjectAcres <= 0 || compAcres <= 0) return false;
  if (acreageBand(subjectAcres) === acreageBand(compAcres)) return true;
  const ratio = compAcres / subjectAcres;
  return ratio >= 0.5 && ratio <= 2;
}

function cleanMoney(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

function normalizeStatus(v?: string | null): ComparableStatus {
  const s = (v ?? '').toLowerCase();
  if (/sold|closed/.test(s)) return 'sold';
  if (/pending|under contract|contingent/.test(s)) return 'pending';
  if (/active|for sale/.test(s)) return 'active';
  if (/list/.test(s)) return 'listed';
  return 'unknown';
}

function normalizeSaleListIndicator(v?: string | null): 'sale' | 'list' | 'unknown' {
  const s = (v ?? '').toLowerCase();
  if (s === 'sale' || /sold/.test(s)) return 'sale';
  if (s === 'list' || /active|listed|pending/.test(s)) return 'list';
  return 'unknown';
}

function classifyText(text: string): ComparablePropertyType {
  if (/\b(manufactured|mobile\s*home|double\s*wide|single\s*wide)\b/i.test(text)) return 'manufactured_home';
  if (/\b(commercial|industrial|retail|warehouse|office)\b/i.test(text)) return 'commercial_improvements';
  if (/\b(farm|barn|pasture|agricultur|poultry|orchard)\b/i.test(text)) return 'agricultural_improvements';
  if (/\b(home|house|residence|dwelling|bed|bath|sq ?ft|building|structure)\b/i.test(text)) return 'existing_residence';
  if (/\b(vacant|raw land|unimproved|lot|acreage|land only|undeveloped)\b/i.test(text)) return 'vacant_land';
  return 'unknown';
}

function extractAddress(raw: string): string | null {
  const beforePrice = raw.split(/\s+\$[\d,]+/)[0]?.trim();
  if (beforePrice && !/^\$|^acres?:|^apn:/i.test(beforePrice) && /^(\d+\s+\S+|county road|state highway|highway)/i.test(beforePrice)) {
    return beforePrice.replace(/^(sold|active|pending|listed)\s*[:-]?\s*/i, '').trim();
  }
  return null;
}

function parseDate(raw: string): string | null {
  const found = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}, \d{4}\b/i)?.[0];
  if (!found) return null;
  const t = Date.parse(found);
  return Number.isNaN(t) ? found : new Date(t).toISOString().slice(0, 10);
}

export function inferSubjectPropertyType(inspection?: PropertyInspectionRecord | DealCardReportView['landportalInspection'] | null): SubjectPropertyClassification {
  const facts = inspection?.parcelFacts ?? {};
  const observations = inspection?.visualObservations ?? [];
  const factNumber = (label: RegExp): number | null => {
    const entry = Object.entries(facts).find(([key]) => label.test(key));
    if (!entry) return null;
    const value = Number(String(entry[1]).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(value) ? value : null;
  };
  const buildingSqft = factNumber(/^building\s*(sq\s*ft|sqft)?$/i);
  const improvementValue = factNumber(/^improvement value$/i);
  const yearBuilt = factNumber(/^(structure )?year built$/i);
  const observationText = observations.map((o) => `${o.label}: ${o.detail} ${'evidence' in o ? o.evidence : ''}`).join(' ');
  const visualImprovement = /\b(home|house|manufactured|mobile\s*home|structure)\b.{0,45}\b(visible|present|on (?:the )?parcel)\b|\b(visible|present)\b.{0,45}\b(home|house|manufactured|mobile\s*home|structure)\b/i.test(observationText);
  const hasStructure = (buildingSqft != null && buildingSqft > 0)
    || (improvementValue != null && improvementValue > 0)
    || (yearBuilt != null && yearBuilt >= 1900)
    || visualImprovement;
  // County use descriptions can state that a manufactured home is allowed or
  // taxed separately while the actual parcel has zero building area/value. That
  // is feasibility information, not evidence of a manufactured home on site.
  const knownUnimproved = !hasStructure && (buildingSqft === 0 || improvementValue === 0);
  const text = [
    ...Object.entries(facts).map(([k, v]) => `${k}: ${v}`),
    observationText,
  ].join(' ');
  const type = knownUnimproved ? 'vacant_land' : classifyText(text);
  const evidence: string[] = [];
  if (hasStructure) evidence.push('Visual / parcel facts indicate visible improvements or structure-related fields.');
  if (knownUnimproved) evidence.push('Parcel facts report zero building area or improvement value; manufactured-home use text is treated as feasibility, not an on-site structure.');
  if (/vacant|raw land|unimproved|no building|land locked|road frontage|water feature/i.test(text)) evidence.push('Parcel facts and imagery observations are consistent with land-focused use.');
  if (/commercial|industrial|retail|warehouse/i.test(text)) evidence.push('Commercial improvement keywords appear in facts or observations.');
  const confidence: IntelligenceConfidence = evidence.length >= 2 ? 'high' : evidence.length === 1 ? 'medium' : 'low';
  return {
    type,
    confidence,
    evidence,
    note: type === 'unknown'
      ? 'Property type could not be classified from current visual and parcel evidence; comparable confidence should be reduced.'
      : `Subject appears to be ${type.replace(/_/g, ' ')} from current visual and parcel evidence.`,
  };
}

function normalizeLandPortalComparable(row: NonNullable<DealCardReportView['landportalInspection']>['comparables'][number]): NormalizedComparable {
  const raw = (row.rawText ?? '').replace(/\s+/g, ' ').trim();
  const acreage = typeof row.acres === 'number' && row.acres > 0 ? row.acres : null;
  const salePrice = cleanMoney(row.price);
  let ppa = cleanMoney(row.pricePerAcre);
  const parsingErrors: string[] = [];
  const notes: string[] = [];
  if (ppa == null && salePrice != null && acreage != null) ppa = Math.round(salePrice / acreage);
  if (ppa != null && salePrice != null && acreage != null) {
    const computed = salePrice / acreage;
    if (Math.abs(ppa - computed) / computed > 0.2) {
      parsingErrors.push(`Price-per-acre ${ppa} differs materially from price / acreage (${Math.round(computed)}).`);
      ppa = Math.round(computed);
    }
  }
  if (salePrice != null && salePrice < 1000) parsingErrors.push('Sale price appears nominal or misparsed.');
  if (acreage != null && acreage > 10000) parsingErrors.push('Acreage appears implausibly large.');
  const propertyType = row.improvement === 'vacant' ? 'vacant_land' : row.improvement === 'improved' ? classifyText(raw || 'home') : classifyText(raw);
  if (propertyType === 'unknown') notes.push('No reliable vacant/improved signal was parsed.');
  return {
    apn: row.apn ?? null,
    address: row.address ?? extractAddress(raw),
    acreage,
    salePrice,
    pricePerAcre: ppa,
    saleDate: row.saleDate ? parseDate(row.saleDate) ?? row.saleDate : parseDate(raw),
    status: normalizeStatus(row.status),
    saleListIndicator: row.saleListIndicator
      ? normalizeSaleListIndicator(row.saleListIndicator)
      : (normalizeStatus(row.status) === 'sold'
        ? 'sale'
        : normalizeStatus(row.status) === 'unknown'
          ? 'unknown'
          : 'list'),
    distanceMiles: row.distanceMiles ?? null,
    propertyType,
    source: 'LandPortal',
    sourceUrl: row.sourceUrl || null,
    confidence: parsingErrors.length ? 'low' : row.confidence === 'high' ? 'high' : row.confidence === 'medium' ? 'medium' : 'low',
    rawText: raw,
    notes,
    parsingErrors,
  };
}

function normalizeMarketComp(row: MarketCompView, status: ComparableStatus, fallbackSource: string): NormalizedComparable {
  const notes: string[] = [];
  const parsingErrors: string[] = [];
  const acreage = typeof row.acres === 'number' && row.acres > 0 ? row.acres : null;
  const salePrice = cleanMoney(row.price);
  let ppa = cleanMoney(row.pricePerAcre);
  if (ppa == null && salePrice != null && acreage != null) ppa = Math.round(salePrice / acreage);
  if (salePrice != null && salePrice < 1000) parsingErrors.push('Price appears nominal or misparsed.');
  const text = [row.propertyTypeText, row.useCode, row.descriptionText, row.addressDesc, row.classReason, row.compClass].filter(Boolean).join(' ');
  const propertyType = row.compClass === 'vacant_land' || row.compClass === 'farm' ? 'vacant_land' : classifyText(text);
  if (row.compClass && row.compClass !== 'vacant_land' && row.compClass !== 'farm') notes.push(row.classReason ?? `Classified as ${row.compClass}.`);
  return {
    address: row.addressDesc ?? null,
    acreage,
    salePrice,
    pricePerAcre: ppa,
    saleDate: row.saleDateIso || null,
    status,
    distanceMiles: typeof (row as MarketCompView & { distanceMiles?: number | null }).distanceMiles === 'number'
      ? (row as MarketCompView & { distanceMiles?: number | null }).distanceMiles
      : null,
    propertyType,
    source: row.sourceLabel || fallbackSource,
    sourceUrl: row.sourceUrl || null,
    confidence: parsingErrors.length ? 'low' : row.compClass === 'vacant_land' || row.compClass === 'farm' ? 'high' : 'medium',
    notes,
    parsingErrors,
  };
}

function dedupe(rows: NormalizedComparable[]): NormalizedComparable[] {
  const seen = new Set<string>();
  const out: NormalizedComparable[] = [];
  for (const row of rows) {
    const key = [
      (row.apn ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
      (row.address ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
      row.acreage ?? '',
      row.salePrice ?? '',
      row.saleDate ?? '',
      row.status,
      row.apn || row.address ? '' : row.sourceUrl ?? '',
    ].join('|');
    const rawKey = (row.rawText ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const k = key.replace(/\|+$/g, '') || rawKey;
    if (k && seen.has(k)) continue;
    const hasStructuredIdentity = Boolean(row.apn || row.address || (row.salePrice && row.saleDate));
    if (!hasStructuredIdentity && rawKey && seen.has(rawKey)) continue;
    seen.add(k);
    if (!hasStructuredIdentity && rawKey) seen.add(rawKey);
    out.push(row);
  }
  return out;
}

function comparableIdentity(row: NormalizedComparable): string {
  return [row.apn ?? '', row.address ?? '', row.acreage ?? '', row.salePrice ?? '', row.saleDate ?? '', row.status, row.sourceUrl ?? '']
    .join('|').toLowerCase();
}

function subjectAcresFrom(report: DealCardReportView): number | null {
  const checklist = report.ddFactChecklist ?? [];
  const raw = checklist.find((r) => r.key === 'acres')?.value
    ?? report.landportalInspection?.parcelFacts?.Acres
    ?? report.landportalInspection?.parcelFacts?.['Calc Acres'];
  const n = raw ? Number(String(raw).replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function typeMatches(subject: ComparablePropertyType, comp: ComparablePropertyType): boolean {
  if (subject === 'unknown' || comp === 'unknown') return false;
  if (subject === 'vacant_land') return comp === 'vacant_land';
  if (subject === 'manufactured_home') return comp === 'manufactured_home';
  if (subject === 'existing_residence') return comp === 'existing_residence';
  return subject === comp;
}

function monthsSince(date: string | null): number | null {
  if (!date) return null;
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return null;
  const now = new Date();
  const then = new Date(parsed);
  const months = (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + now.getUTCMonth() - then.getUTCMonth();
  return Math.max(0, months);
}

function qualifySoldComparable(
  row: NormalizedComparable,
  subjectAcres: number | null,
  subjectType: ComparablePropertyType,
): NormalizedComparable | null {
  if (row.status !== 'sold' || row.salePrice == null || row.pricePerAcre == null || row.acreage == null) return null;
  const age = monthsSince(row.saleDate);
  const distance = row.distanceMiles;
  if (age == null || age > 24 || distance == null || distance < 0 || distance > 10) return null;
  if (subjectAcres != null && !sameAcreageBand(subjectAcres, row.acreage)) return null;
  // "No contradiction found" is not a property-type check. Both the subject
  // and the candidate must have an observed classification before the row can
  // influence valuation; otherwise it remains useful, source-linked context.
  if (subjectType === 'unknown' || row.propertyType === 'unknown' || !typeMatches(subjectType, row.propertyType)) return null;
  if (row.parsingErrors.length) return null;
  return {
    ...row,
    radiusTier: distance <= 3 ? '3_miles' : distance <= 5 ? '5_miles' : '10_miles',
    recencyTier: age <= 12 ? '12_months' : age <= 18 ? '18_months' : '24_months',
  };
}

export function buildComparableIntelligence(report: DealCardReportView): ComparableIntelligence {
  const subjectAcres = subjectAcresFrom(report);
  const subjectClassification = inferSubjectPropertyType(report.landportalInspection ?? null);
  const lpRows = (report.landportalInspection?.comparables ?? []).map(normalizeLandPortalComparable);
  const marketRows = [
    ...(report.marketComps?.sold ?? []).map((c) => normalizeMarketComp(c, 'sold', 'market_comps')),
    ...(report.marketComps?.supplementalSold ?? []).map((c) => normalizeMarketComp(c, 'sold', 'supplemental_sold')),
    ...(report.marketComps?.active ?? []).map((c) => normalizeMarketComp(c, 'active', 'active_market')),
  ];
  const comparables = dedupe([...lpRows, ...marketRows]);
  const sold = comparables.filter((c) => c.status === 'sold' && c.pricePerAcre != null);
  const asking = comparables.filter((c) => (c.status === 'active' || c.status === 'listed' || c.status === 'pending') && c.pricePerAcre != null);
  const selectBySubject = (rows: NormalizedComparable[]) => rows
    .filter((c) => sameAcreageBand(subjectAcres, c.acreage))
    .filter((c) => subjectClassification.type === 'unknown' || typeMatches(subjectClassification.type, c.propertyType) || c.propertyType === 'unknown');
  const qualifiedSold = sold
    .map((row) => qualifySoldComparable(row, subjectAcres, subjectClassification.type))
    .filter((row): row is NormalizedComparable => !!row)
    .sort((a, b) => {
      const distance = (a.distanceMiles ?? Number.POSITIVE_INFINITY) - (b.distanceMiles ?? Number.POSITIVE_INFINITY);
      if (distance !== 0) return distance;
      return (monthsSince(a.saleDate) ?? Number.POSITIVE_INFINITY) - (monthsSince(b.saleDate) ?? Number.POSITIVE_INFINITY);
    });
  // Phase 1 valuation is closed-sale only. Asking/pending/active rows stay
  // visible as context and never backfill a missing sold sample.
  const finalSelected = qualifiedSold.slice(0, 5);
  const ppas = finalSelected.map((c) => c.pricePerAcre).filter((n): n is number => typeof n === 'number' && n > 0);
  const low = quantile(ppas, 0.25);
  const mid = median(ppas);
  const high = quantile(ppas, 0.75);
  const estimatedMarketValue = subjectAcres != null && mid != null
    ? {
        low: Math.round((low ?? mid) * subjectAcres),
        mid: Math.round(mid * subjectAcres),
        high: Math.round((high ?? mid) * subjectAcres),
      }
    : null;
  const rejectedComparables = comparables
    .filter((c) => !finalSelected.some((selected) => comparableIdentity(selected) === comparableIdentity(c)))
    .map((c) => ({
      comparable: c,
      reason: c.status !== 'sold'
        ? 'Not a sold comparable; useful as market context but weaker for value.'
        : monthsSince(c.saleDate) == null
          ? 'Sale date is missing or invalid; excluded from the 12/18/24-month valuation sequence.'
          : (monthsSince(c.saleDate) ?? 25) > 24
            ? 'Sale is older than the 24-month maximum; retained as context only.'
            : c.distanceMiles == null
              ? 'Distance is not established; excluded until its 3/5/10-mile or county-wide tier is known.'
              : c.distanceMiles > 10
                ? 'Outside the 10-mile search tier; county-wide use requires an explicit thin-rural-market disclosure.'
            : !sameAcreageBand(subjectAcres, c.acreage)
          ? 'Outside the subject acreage band; retained as evidence but weighted lower.'
          : subjectClassification.type === 'unknown' || c.propertyType === 'unknown'
            ? 'Property type is not established on both the subject and comparable; retained as context only.'
          : !typeMatches(subjectClassification.type, c.propertyType)
            ? 'Different property type than the subject; retained for interpretation only.'
            : 'Lower-confidence comparable.',
    }));
  const evidenceMissing: string[] = [];
  if (subjectAcres == null) evidenceMissing.push('Subject acreage');
  if (subjectClassification.type === 'unknown') evidenceMissing.push('Confirmed subject property type');
  if (finalSelected.length < 3) evidenceMissing.push('At least three sold comparables in the same acreage band');
  if (!sold.some((c) => monthsSince(c.saleDate) != null && (monthsSince(c.saleDate) ?? 25) <= 24)) evidenceMissing.push('Sold comparable dates within the 24-month maximum');
  if (!sold.some((c) => c.distanceMiles != null && c.distanceMiles <= 10)) evidenceMissing.push('Comparable distances in the 3/5/10-mile search sequence');
  // Comp-source coverage reads the SINGLE reconciled comp state first (the same
  // object Market/Activity show), then the comparables themselves — so Strategy
  // never claims a source's comps are "missing" while Activity says it retrieved N.
  const compSourceRetrieved = (re: RegExp): boolean => {
    const cs = report.compState?.sources?.find((sx) => re.test(sx.source) || re.test(sx.label));
    if (cs && (cs.status === 'retrieved' || cs.count > 0)) return true;
    return comparables.some((c) => re.test(c.source));
  };
  if (!compSourceRetrieved(/zillow/i)) evidenceMissing.push('Zillow sold land comparable check');
  if (!compSourceRetrieved(/redfin/i)) evidenceMissing.push('Redfin sold land comparable check');
  const confidence: IntelligenceConfidence = finalSelected.length >= 5 && subjectClassification.confidence !== 'low'
      ? 'high'
      : finalSelected.length >= 2
        ? 'medium'
        : 'low';
  return {
    subjectClassification,
    acreageBand: acreageBand(subjectAcres),
    comparables,
    selectedComparables: finalSelected,
    contextComparables: asking,
    rejectedComparables,
    estimatedPricePerAcre: { low, mid, high },
    estimatedMarketValue,
    confidence,
    evidenceUsed: [
      finalSelected.length
        ? `${finalSelected.length} sold comparable(s) selected by status, 12/18/24-month recency, 3/5/10-mile distance, acreage band, property type, and provider hierarchy.`
        : `No sold comparable qualified for valuation; ${asking.length} asking/pending/active row(s) remain context only.`,
      report.landportalInspection?.comparables?.length ? 'LandPortal comparable rows' : '',
      report.marketComps?.sold?.length ? 'Sold market comparable rows' : '',
    ].filter(Boolean),
    evidenceMissing,
    factorsAffectingValue: [
      'Access, road frontage, utilities, slope, floodplain, wetlands, water features, parcel shape, and visible improvements can materially move value.',
      'No numerical adjustments are fabricated; differences are interpreted directionally only.',
    ],
  };
}
