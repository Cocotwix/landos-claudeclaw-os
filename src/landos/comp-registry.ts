// Unique Comparable Registry — ONE deduplicated comp truth for the whole card.
//
// Every provider (LandPortal free rows, Zillow, Redfin, Realie, county records,
// persisted landos_comp rows) contributes CANDIDATES. The registry validates
// each candidate, dedupes at the PROPERTY level and the TRANSACTION level, and
// returns validated unique comps + a full rejection/merge audit. The same sale
// seen through three providers counts ONCE, with every supporting provider
// attached. Provider attempts are never comps; rejected rows never influence
// valuation.
//
// Pure + deterministic. No I/O. The caller maps its lanes/rows into candidates.

import { formatCountyLabel } from './fact-format.js';
import { providerDisplayName } from './comp-providers.js';

export interface CompRegistryCandidate {
  id?: number | string | null;
  provider: string;
  lane: 'sold' | 'active' | 'supplemental' | 'landportal' | 'valuation' | 'unknown';
  addressDesc: string | null;
  apn?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  price: number | null;
  priceKind?: string | null;            // 'sold' | 'list' | …
  saleOrListDate?: string | null;
  acres?: number | null;
  pricePerAcre?: number | null;
  sourceUrl?: string | null;
  /** Optional provider-owned listing image. It is evidence decoration only. */
  thumbnailUrl?: string | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  distanceMiles?: number | null;
  inclusionReason?: string | null;
  /** Persisted status from landos_comp ('rejected' rows stay rejected). */
  persistedStatus?: string | null;
  compClass?: string | null;
}

export interface SubjectMarket {
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  locality?: string | null;
  acres?: number | null;
}

export type CompEventKind = 'sold' | 'active' | 'unknown';

export interface UniqueCompTransaction {
  kind: CompEventKind;
  price: number | null;
  pricePerAcre: number | null;
  /** Acreage attached to THIS transaction, never borrowed from another event. */
  acres: number | null;
  dateIso: string | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  providers: string[];
  sourceUrls: string[];
  thumbnailUrl: string | null;
  /** Whether a closed-sale event has the minimum traceable evidence for valuation. */
  qualification: {
    qualifiedForValuation: boolean;
    missing: Array<'source' | 'sale_date'>;
  };
  mergedCandidates: number;
}

/**
 * Subject comparability — kept STRICTLY separate from sourceConfidence. A comp
 * can be a high-confidence record (multi-provider, APN-matched) and still be a
 * poor subject comparable (wrong acreage cluster), or vice versa.
 */
export type SubjectComparability =
  | 'direct_comparable'          // sold/active in the subject's acreage band
  | 'secondary_local_comparable' // local, adjacent acreage band
  | 'small_lot_context'          // local but materially smaller (sub-band)
  | 'large_acreage_context'      // local but materially larger
  | 'weak_context';              // usable market color only

export interface UniqueComp {
  key: string;
  matchedBy: 'apn' | 'address' | 'coordinates' | 'price_date';
  address: string | null;
  apn: string | null;
  state: string | null;
  acres: number | null;
  /** Acres rounded to operator precision for display (never 0.36999540863177227). */
  acresDisplay: number | null;
  /** Provider-supplied property coordinates retained through registry dedupe. */
  lat: number | null;
  lng: number | null;
  coordinateProvider: string | null;
  distanceMiles: number | null;
  inclusionReason: string | null;
  propertyClass: string | null;
  transactions: UniqueCompTransaction[];
  /** Convenience: the strongest transaction (sold first, then most recent). */
  primary: UniqueCompTransaction;
  providers: string[];
  /** Operator-facing provider names (internal adapter ids stay in `providers`). */
  providersDisplay: string[];
  sourceConfidence: 'high' | 'medium' | 'low';
  comparability: SubjectComparability;
  comparabilityWhy: string;
}

/** A detected local acreage cluster of CLOSED sales (thin-market analysis unit). */
export interface CompCluster {
  id: string;
  label: string;
  acreageRange: { min: number; max: number };
  closedSales: number;
  totalSoldAcres: number;
  totalSoldPrice: number;
  /** total sold price ÷ total sold acreage. */
  weightedPricePerAcre: number | null;
  medianPricePerAcre: number | null;
  subjectPosition: 'inside' | 'above' | 'below' | 'unknown';
  geography: string;
  inclusionRationale: string;
  confidence: 'supported' | 'thin' | 'insufficient';
  limitations: string[];
  compKeys: string[];
}

export interface ClusterAnalysis {
  clusters: CompCluster[];
  /** The cluster (if any) whose pricing behavior is the strongest relevant local pattern. */
  primaryClusterId: string | null;
  /** True when the primary cluster has enough closed observations to serve as a labeled thin-market indication. */
  thinMarketSupported: boolean;
  excludedSegments: string[];
  note: string;
}

export interface RejectedCandidate {
  /** Present only for a candidate read from landos_comp. Report/provider lanes
   *  have no persisted row to mutate during Deal Card reconciliation. */
  persistedId?: number | string | null;
  provider: string;
  address: string | null;
  price: number | null;
  reason: string;
}

export interface DuplicateMerge {
  keptAddress: string | null;
  matchedBy: UniqueComp['matchedBy'];
  providers: string[];
  mergedCount: number;
}

export interface ProviderCoverage {
  provider: string;
  candidates: number;
  validated: number;
  rejected: number;
}

export interface CompRegistry {
  uniqueComps: UniqueComp[];
  validatedSold: UniqueComp[];
  validatedActive: UniqueComp[];
  rejected: RejectedCandidate[];
  duplicateMerges: DuplicateMerge[];
  providerCoverage: ProviderCoverage[];
  counts: {
    rawCandidates: number;
    uniqueProperties: number;
    validatedSold: number;
    validatedActive: number;
    rejected: number;
    duplicatesMerged: number;
  };
  /** At least one validated unique SOLD comp with acreage supports the owner FMV formula. */
  valuationReady: boolean;
  valuationBlockers: string[];
  /** Thin-market local acreage clusters over the validated sold set. */
  clusterAnalysis: ClusterAnalysis;
  summaryLine: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

const IMPROVED_CLASS = /residential|manufactured|commercial|improved|exclude/i;
const US_STATE_TAIL = /,\s*([A-Z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/i;
// Zillow can append brokerage text after a Canadian postal code, so the state /
// province is not always at the absolute tail. Recognize a two-letter region
// followed by either a US ZIP or Canadian postal code anywhere after a comma.
// This lets the canonical registry reject obvious out-of-market rows instead of
// treating an unparsed province as an unknown-but-valid subject-market comp.
const POSTAL_REGION = /,\s*([A-Z]{2})\s+(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/i;

/** Extract a US state code from the tail of a one-line address. */
export function addressStateCode(address: string | null | undefined): string | null {
  const value = (address ?? '').trim();
  const m = value.match(US_STATE_TAIL) ?? value.match(POSTAL_REGION);
  return m ? m[1].toUpperCase() : null;
}

function validate(c: CompRegistryCandidate, subject: SubjectMarket): string | null {
  if ((c.persistedStatus ?? '').toLowerCase() === 'rejected') {
    return 'Previously rejected (failed market/validation screening)';
  }
  const subjState = (subject.state ?? '').trim().toUpperCase();
  const rowState = (c.state ?? '').trim().toUpperCase() || addressStateCode(c.addressDesc);
  if (subjState && rowState && rowState !== subjState) {
    return `Wrong market: comp is in ${rowState}, subject is in ${subjState}`;
  }
  if (subjState && !rowState && /zillow/i.test(c.provider)) {
    return `Missing usable market locality: Zillow row cannot be tied to subject state ${subjState}`;
  }
  const hasPrice = (typeof c.price === 'number' && c.price > 0) || (typeof c.pricePerAcre === 'number' && c.pricePerAcre > 0);
  if (!hasPrice) return 'No usable price evidence';
  return null;
}

// ── Dedup keys ────────────────────────────────────────────────────────────────

const SUFFIX_MAP: Record<string, string> = {
  street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr', lane: 'ln', road: 'rd',
  court: 'ct', circle: 'cir', place: 'pl', terrace: 'ter', highway: 'hwy', parkway: 'pkwy',
  trail: 'trl', point: 'pt', cove: 'cv', harbour: 'harbor',
};

export function normalizeCompAddress(address: string | null | undefined): string | null {
  const raw = (address ?? '').trim().toLowerCase();
  if (!raw) return null;
  // Keep only the street line (before the first comma) + city — ZIP/state noise
  // varies per provider ("Saint Helena Island" vs "St. Helena Island").
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0] ?? '';
  const words = street.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => SUFFIX_MAP[w] ?? w)
    .map((w) => (w === 'saint' ? 'st' : w));
  if (!words.length) return null;
  return words.join(' ');
}

function apnKey(apn: string | null | undefined): string | null {
  const digits = (apn ?? '').replace(/\D/g, '');
  return digits.length >= 5 ? digits : null;
}

function coordKey(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function propertyKey(c: CompRegistryCandidate): { key: string; matchedBy: UniqueComp['matchedBy'] } {
  const apn = apnKey(c.apn);
  if (apn) return { key: `apn:${apn}`, matchedBy: 'apn' };
  const addr = normalizeCompAddress(c.addressDesc);
  if (addr) return { key: `addr:${addr}`, matchedBy: 'address' };
  const coord = coordKey(c.lat, c.lng);
  if (coord) return { key: `coord:${coord}`, matchedBy: 'coordinates' };
  return { key: `pd:${c.price ?? '?'}|${(c.saleOrListDate ?? '').slice(0, 7)}|${c.acres ?? '?'}`, matchedBy: 'price_date' };
}

/**
 * Provider feeds sometimes describe the same closed parcel as, for example,
 * "6 Acres Trentham Rd", "6ACRES Trentham Rd", and "6 Trentham Rd". Keep the
 * normal property key strict, then use this stronger same-transaction alias to
 * merge only rows whose date, price, acreage, geography, and street signature
 * all agree. This avoids inflating a valuation without collapsing unrelated
 * properties that merely share a road name.
 */
function closedTransactionAlias(c: CompRegistryCandidate): string | null {
  if (eventKind(c) !== 'sold') return null;
  const date = validEvidenceDate(c.saleOrListDate);
  if (!date || typeof c.price !== 'number' || c.price <= 0 || typeof c.acres !== 'number' || c.acres <= 0) return null;
  const normalized = normalizeCompAddress(c.addressDesc);
  if (!normalized) return null;
  let words = normalized.split(' ').filter(Boolean);
  if (/^\d+(?:\.\d+)?acres?$/.test(words[0] ?? '')) words = words.slice(1);
  const lead = Number(words[0]);
  if (Number.isFinite(lead) && Math.abs(lead - c.acres) <= 0.02 && words.length > 2) words = words.slice(1);
  words = words
    .filter((word) => !['acre', 'acres', 'parcel', 'par', 'lot', 'off', 'tn'].includes(word) && word !== '00')
    .map((word) => /^\d+$/.test(word) ? String(Number(word)) : word);
  const hwy = words.indexOf('hwy');
  if (hwy > 0 && hwy < words.length - 1 && /^\d+$/.test(words[hwy - 1]) && /^\d+$/.test(words[hwy + 1])) {
    const parcelNumber = words[hwy - 1];
    words = [...words.slice(0, hwy - 1), 'hwy', words[hwy + 1], parcelNumber, ...words.slice(hwy + 2)];
  }
  if (!words.length) return null;
  const state = (c.state ?? addressStateCode(c.addressDesc) ?? '').trim().toUpperCase();
  return `closed:${date.slice(0, 7)}|${Math.round(c.price * 100)}|${c.acres.toFixed(3)}|${state}|${words.join(' ')}`;
}

function eventKind(c: CompRegistryCandidate): CompEventKind {
  const pk = (c.priceKind ?? '').toLowerCase();
  if (pk === 'sold' || c.lane === 'sold' || c.lane === 'supplemental') return 'sold';
  if (pk === 'list' || pk === 'active' || c.lane === 'active') return 'active';
  return 'unknown';
}

function validSourceUrl(value: string | null | undefined): string | null {
  const source = (value ?? '').trim();
  return /^https?:\/\//i.test(source) ? source : null;
}

/** A sale date must be a real calendar date, not merely a parseable fragment. */
function validEvidenceDate(value: string | null | undefined): string | null {
  const date = (value ?? '').trim();
  if (!date) return null;
  // Date.parse accepts fragments such as "2026" and normalizes impossible
  // dates such as 2026-02-31. Neither is evidence of a closed-sale date.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return date;
}

function validCoordinates(c: CompRegistryCandidate): { lat: number; lng: number } | null {
  const { lat, lng } = c;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function transactionKey(c: CompRegistryCandidate): string {
  // Same property + same kind + same price bucket + same month = one transaction.
  const month = (c.saleOrListDate ?? '').slice(0, 7);
  const price = typeof c.price === 'number' ? Math.round(c.price / 100) * 100 : null;
  return `${eventKind(c)}|${price ?? '?'}|${month}`;
}

// ── Subject comparability + acreage clusters ─────────────────────────────────
// Tyler's rule: anything under five acres is a small parcel. Bands give the
// comparability labels; ratio/gap clustering finds the distinct local pricing
// patterns in a thin market instead of blending everything into one average.

const ACREAGE_BANDS: Array<{ min: number; max: number; label: string }> = [
  { min: 0, max: 1, label: 'under 1 ac' },
  { min: 1, max: 2, label: '1–2 ac' },
  { min: 2, max: 5, label: '2–5 ac' },
  { min: 5, max: 10, label: '5–10 ac' },
  { min: 10, max: Infinity, label: '10+ ac' },
];

function bandIndex(acres: number | null | undefined): number {
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return -1;
  return ACREAGE_BANDS.findIndex((b) => acres >= b.min && acres < b.max);
}

export function classifyComparability(subjectAcres: number | null | undefined, compAcres: number | null | undefined): { comparability: SubjectComparability; why: string } {
  const si = bandIndex(subjectAcres);
  const ci = bandIndex(compAcres);
  if (si < 0 || ci < 0) return { comparability: 'weak_context', why: 'Acreage is missing on the subject or the comp — market color only.' };
  if (ci === si) return { comparability: 'direct_comparable', why: `Same acreage band as the subject (${ACREAGE_BANDS[si].label}).` };
  if (Math.abs(ci - si) === 1) return { comparability: 'secondary_local_comparable', why: `Adjacent acreage band (${ACREAGE_BANDS[ci].label} vs subject ${ACREAGE_BANDS[si].label}).` };
  if (ci < si) return { comparability: 'small_lot_context', why: `Materially smaller (${ACREAGE_BANDS[ci].label}) than the subject (${ACREAGE_BANDS[si].label}) — kept visible as small-lot local market context, never blended into the subject's calculation.` };
  return { comparability: 'large_acreage_context', why: `Materially larger (${ACREAGE_BANDS[ci].label}) than the subject (${ACREAGE_BANDS[si].label}) — kept visible as large-acreage context; $/ac behavior at that size does not transfer to the subject.` };
}

function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Detect distinct local acreage clusters over the validated SOLD comps.
 * Sorted by acres, a new cluster starts where the acreage jumps by more than
 * 2× or by more than 5 acres — a 10.3 ac sale never blends into a sub-acre
 * cluster. One-point clusters stay visible but are 'insufficient'.
 */
export function buildClusterAnalysis(subject: SubjectMarket, validatedSold: UniqueComp[]): ClusterAnalysis {
  const geography = [subject.locality, subject.zip, formatCountyLabel(subject.county)].filter(Boolean).join(' · ') || 'local market';
  const sized = validatedSold
    .filter((c) => typeof c.acres === 'number' && c.acres! > 0 && (c.primary.price != null || c.primary.pricePerAcre != null))
    .sort((a, b) => (a.acres! - b.acres!));
  if (!sized.length) {
    return { clusters: [], primaryClusterId: null, thinMarketSupported: false, excludedSegments: [], note: 'No validated closed sales with acreage yet — no local cluster can be analyzed.' };
  }

  const groups: UniqueComp[][] = [];
  let current: UniqueComp[] = [sized[0]];
  for (let i = 1; i < sized.length; i += 1) {
    const prev = current[current.length - 1].acres!;
    const next = sized[i].acres!;
    if (next / Math.max(prev, 0.01) > 2 || next - prev > 5) {
      groups.push(current);
      current = [sized[i]];
    } else {
      current.push(sized[i]);
    }
  }
  groups.push(current);

  const subjAcres = typeof subject.acres === 'number' && subject.acres > 0 ? subject.acres : null;
  const clusters: CompCluster[] = groups.map((rows, idx) => {
    const priced = rows.filter((r) => r.primary.price != null || (r.primary.pricePerAcre != null && r.acres != null));
    const totalAcres = rows.reduce((s, r) => s + r.acres!, 0);
    const totalPrice = priced.reduce((s, r) => s + (r.primary.price ?? (r.primary.pricePerAcre! * r.acres!)), 0);
    const ppas = rows.map((r) => r.primary.pricePerAcre ?? (r.primary.price != null && r.acres ? r.primary.price / r.acres : null)).filter((v): v is number => v != null);
    const min = rows[0].acres!;
    const max = rows[rows.length - 1].acres!;
    const confidence: CompCluster['confidence'] = rows.length >= 3 ? 'supported' : rows.length === 2 ? 'thin' : 'insufficient';
    const limitations: string[] = [];
    if (rows.length < 3) limitations.push(`Only ${rows.length} closed sale${rows.length === 1 ? '' : 's'} — not an adequate closed-observation base on its own.`);
    if (subjAcres != null && (subjAcres < min || subjAcres > max)) limitations.push(`The subject (${round2(subjAcres)} ac) sits outside this cluster's ${round2(min)}–${round2(max)} ac range — a thin-market local indication only, never a direct same-size comparable range.`);
    limitations.push('Cluster pricing is a local indication from closed sales; it is not an appraisal and active asking prices are never mixed in.');
    return {
      id: `cluster_${idx + 1}`,
      label: `${round2(min)}–${round2(max)} ac local closed sales`,
      acreageRange: { min: round2(min), max: round2(max) },
      closedSales: rows.length,
      totalSoldAcres: round2(totalAcres),
      totalSoldPrice: Math.round(totalPrice),
      // A one- or two-sale cluster is useful classification context, but it is
      // not a price statistic. Publish $/acre only once the cluster is supported.
      weightedPricePerAcre: rows.length >= 3 && totalAcres > 0 && totalPrice > 0 ? Math.round(totalPrice / totalAcres) : null,
      medianPricePerAcre: rows.length >= 3 && ppas.length ? Math.round(medianOf(ppas)!) : null,
      subjectPosition: subjAcres == null ? 'unknown' : subjAcres < min ? 'below' : subjAcres > max ? 'above' : 'inside',
      geography,
      inclusionRationale: `Closed sales in ${geography} whose acreage forms one contiguous local pattern (${round2(min)}–${round2(max)} ac); materially different acreage segments are kept as separate context, not blended.`,
      confidence,
      limitations,
      compKeys: rows.map((r) => r.key),
    };
  });

  // Primary cluster: closest to the subject's size with the most closed sales.
  const scored = clusters.map((cl) => {
    const dist = subjAcres == null ? 0 : cl.subjectPosition === 'inside' ? 0 : Math.min(Math.abs(subjAcres - cl.acreageRange.min), Math.abs(subjAcres - cl.acreageRange.max));
    return { cl, score: cl.closedSales * 10 - dist };
  }).sort((a, b) => b.score - a.score);
  const primary = scored[0]?.cl ?? null;
  const excludedSegments = clusters.filter((cl) => cl.id !== primary?.id)
    .map((cl) => `${cl.label} (${cl.closedSales} sale${cl.closedSales === 1 ? '' : 's'}) — kept as separate ${subjAcres != null && cl.acreageRange.min > subjAcres ? 'large-acreage' : 'small-lot'} context, not blended into the primary cluster calculation.`);

  const thinMarketSupported = !!primary && primary.confidence === 'supported';
  return {
    clusters,
    primaryClusterId: primary?.id ?? null,
    thinMarketSupported,
    excludedSegments,
    note: primary
      ? thinMarketSupported
        ? `Primary local cluster: ${primary.label} (${primary.closedSales} closed sales, weighted $${primary.weightedPricePerAcre?.toLocaleString() ?? '—'}/ac). Labeled thin-market indication — see limitations.`
        : `Strongest local cluster (${primary.label}) has only ${primary.closedSales} closed sale${primary.closedSales === 1 ? '' : 's'} — insufficient for even a thin-market indication. LandOS keeps searching for closer 2-to-5-acre and under-10-acre closed sales.`
      : 'No cluster detected.',
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildCompRegistry(subject: SubjectMarket, candidates: CompRegistryCandidate[]): CompRegistry {
  const rejected: RejectedCandidate[] = [];
  const valid: CompRegistryCandidate[] = [];
  const coverage = new Map<string, ProviderCoverage>();

  const cov = (provider: string): ProviderCoverage => {
    const key = provider.trim() || 'Unknown';
    let entry = coverage.get(key.toLowerCase());
    if (!entry) { entry = { provider: key, candidates: 0, validated: 0, rejected: 0 }; coverage.set(key.toLowerCase(), entry); }
    return entry;
  };

  for (const c of candidates) {
    const entry = cov(c.provider);
    entry.candidates += 1;
    const reason = validate(c, subject);
    if (reason) {
      entry.rejected += 1;
      rejected.push({ persistedId: c.id ?? null, provider: c.provider, address: c.addressDesc, price: c.price, reason });
    } else {
      entry.validated += 1;
      valid.push(c);
    }
  }

  // Property-level grouping.
  const groups = new Map<string, { matchedBy: UniqueComp['matchedBy']; rows: CompRegistryCandidate[] }>();
  const propertyGroups = new Map<string, string>();
  const transactionAliases = new Map<string, string>();
  for (const c of valid) {
    const { key, matchedBy } = propertyKey(c);
    const alias = closedTransactionAlias(c);
    const propertyGroup = propertyGroups.get(key);
    const aliasGroup = alias ? transactionAliases.get(alias) : undefined;
    let groupKey = propertyGroup ?? aliasGroup ?? key;
    if (propertyGroup && aliasGroup && propertyGroup !== aliasGroup) {
      const target = groups.get(propertyGroup);
      const source = groups.get(aliasGroup);
      if (target && source) {
        target.rows.push(...source.rows);
        groups.delete(aliasGroup);
        for (const [k, v] of propertyGroups) if (v === aliasGroup) propertyGroups.set(k, propertyGroup);
        for (const [k, v] of transactionAliases) if (v === aliasGroup) transactionAliases.set(k, propertyGroup);
      }
      groupKey = propertyGroup;
    }
    propertyGroups.set(key, groupKey);
    if (alias) transactionAliases.set(alias, groupKey);
    const g = groups.get(groupKey);
    if (g) g.rows.push(c);
    else groups.set(groupKey, { matchedBy, rows: [c] });
  }

  const uniqueComps: UniqueComp[] = [];
  const duplicateMerges: DuplicateMerge[] = [];
  let duplicatesMerged = 0;

  for (const [key, group] of groups) {
    // Transaction-level grouping inside the property.
    const txGroups = new Map<string, CompRegistryCandidate[]>();
    for (const row of group.rows) {
      const tk = transactionKey(row);
      const rows = txGroups.get(tk);
      if (rows) rows.push(row);
      else txGroups.set(tk, [row]);
    }

    const transactions: UniqueCompTransaction[] = [];
    for (const rows of txGroups.values()) {
      const providers = [...new Set(rows.map((r) => r.provider.trim()).filter(Boolean))];
      const richest = [...rows].sort((a, b) => nonNullFields(b) - nonNullFields(a))[0];
      const kind = eventKind(richest);
      const sourceUrls = [...new Set(rows.map((r) => validSourceUrl(r.sourceUrl)).filter((u): u is string => u != null))];
      const dateIso = rows.map((r) => validEvidenceDate(r.saleOrListDate)).find((d): d is string => d != null) ?? null;
      const missing: Array<'source' | 'sale_date'> = [];
      if (kind === 'sold') {
        if (!sourceUrls.length) missing.push('source');
        if (!dateIso) missing.push('sale_date');
      }
      transactions.push({
        kind,
        price: firstNumber(rows.map((r) => r.price)),
        pricePerAcre: firstNumber(rows.map((r) => r.pricePerAcre)),
        acres: firstNumber(rows.map((r) => r.acres)),
        dateIso,
        listingDate: rows.map((r) => validEvidenceDate(r.listingDate)).find((d): d is string => d != null) ?? null,
        daysOnMarket: firstNumber(rows.map((r) => r.daysOnMarket)),
        providers,
        sourceUrls,
        thumbnailUrl: rows.map((r) => validSourceUrl(r.thumbnailUrl)).find((u): u is string => u != null) ?? null,
        qualification: { qualifiedForValuation: kind === 'sold' && missing.length === 0, missing },
        mergedCandidates: rows.length,
      });
      if (rows.length > 1) duplicatesMerged += rows.length - 1;
    }
    // A traceable closed sale is canonical for a property. An untraceable
    // claimed sale remains visible as context, but cannot displace an evidenced
    // sale or flow into the valuation count.
    const transactionRank = (t: UniqueCompTransaction): number => t.kind === 'sold' && t.qualification.qualifiedForValuation ? 0 : t.kind === 'sold' ? 1 : t.kind === 'active' ? 2 : 3;
    transactions.sort((a, b) => transactionRank(a) - transactionRank(b) || String(b.dateIso ?? '').localeCompare(String(a.dateIso ?? '')));

    const allProviders = [...new Set(group.rows.map((r) => r.provider.trim()).filter(Boolean))];
    const richest = [...group.rows].sort((a, b) => nonNullFields(b) - nonNullFields(a))[0];
    const primary = transactions[0];
    // Acreage is transaction-bound. Prefer the primary sale/list event's
    // acreage so its price-per-acre never uses a different event's acreage.
    const acres = primary.acres ?? firstNumber(group.rows.map((r) => r.acres));
    const coordinateRow = group.rows.find((row) => validCoordinates(row) != null) ?? null;
    const coordinate = coordinateRow ? validCoordinates(coordinateRow) : null;
    const cmp = classifyComparability(subject.acres, acres);
    const comp: UniqueComp = {
      key,
      matchedBy: group.matchedBy,
      address: richest.addressDesc ?? null,
      apn: group.rows.map((r) => r.apn).find((a) => a && a.trim()) ?? null,
      state: (richest.state ?? addressStateCode(richest.addressDesc)) ?? null,
      acres,
      acresDisplay: acres == null ? null : round2(acres),
      lat: coordinate?.lat ?? null,
      lng: coordinate?.lng ?? null,
      coordinateProvider: coordinateRow?.provider?.trim() || null,
      distanceMiles: firstNumber(group.rows.map((r) => r.distanceMiles)),
      inclusionReason: group.rows.map((r) => r.inclusionReason).find((value) => value?.trim()) ?? null,
      propertyClass: group.rows.map((r) => r.compClass).find((value) => value?.trim()) ?? null,
      transactions,
      primary,
      providers: allProviders,
      providersDisplay: [...new Set(allProviders.map((prov) => providerDisplayName(prov)))],
      // Multiple independent providers or an APN match = higher source confidence.
      // Source confidence is about the RECORD; comparability (below) is about
      // the SUBJECT — the two are never merged into one label.
      sourceConfidence: allProviders.length >= 2 || group.matchedBy === 'apn' ? 'high' : group.matchedBy === 'address' ? 'medium' : 'low',
      comparability: cmp.comparability,
      comparabilityWhy: cmp.why,
    };
    uniqueComps.push(comp);
    if (group.rows.length > 1) {
      duplicateMerges.push({ keptAddress: comp.address, matchedBy: group.matchedBy, providers: allProviders, mergedCount: group.rows.length });
    }
  }

  uniqueComps.sort((a, b) => String(b.primary.dateIso ?? '').localeCompare(String(a.primary.dateIso ?? '')));
  // A provider label alone is not sale evidence. A claimed sale must carry a
  // traceable source and a parseable sale date before it can count toward value.
  const validatedSold = uniqueComps.filter((c) => !IMPROVED_CLASS.test(c.propertyClass ?? '') && c.transactions.some((t) => t.kind === 'sold' && t.qualification.qualifiedForValuation));
  const validatedActive = uniqueComps.filter((c) => !IMPROVED_CLASS.test(c.propertyClass ?? '') && c.transactions.some((t) => t.kind === 'active'));

  const valuationBlockers: string[] = [];
  if (validatedSold.length < 1) {
    valuationBlockers.push('No validated unique sold comps are available for the FMV calculation.');
  }
  const soldWithAcres = validatedSold.filter((c) => c.acres != null && c.acres > 0);
  if (validatedSold.length >= 1 && soldWithAcres.length < 1) {
    valuationBlockers.push('Validated sold comps lack acreage needed to calculate sold price per acre.');
  }

  const counts = {
    rawCandidates: candidates.length,
    uniqueProperties: uniqueComps.length,
    validatedSold: validatedSold.length,
    validatedActive: validatedActive.length,
    rejected: rejected.length,
    duplicatesMerged,
  };

  const clusterAnalysis = buildClusterAnalysis(subject, validatedSold);

  const summaryLine = uniqueComps.length
    ? `${counts.validatedSold} validated sold, ${counts.validatedActive} active (unique), from ${counts.rawCandidates} candidates (${counts.rejected} rejected, ${counts.duplicatesMerged} duplicate rows merged).`
    : `No validated comps yet (${counts.rawCandidates} candidates, ${counts.rejected} rejected).`;

  return {
    uniqueComps,
    validatedSold,
    validatedActive,
    rejected,
    duplicateMerges,
    providerCoverage: [...coverage.values()].sort((a, b) => b.candidates - a.candidates),
    counts,
    valuationReady: valuationBlockers.length === 0,
    valuationBlockers,
    clusterAnalysis,
    summaryLine,
  };
}

function nonNullFields(c: CompRegistryCandidate): number {
  return [c.addressDesc, c.apn, c.price, c.acres, c.pricePerAcre, c.saleOrListDate, c.listingDate, c.sourceUrl, c.lat, c.lng, c.thumbnailUrl]
    .filter((v) => v != null && v !== '').length;
}

function firstNumber(xs: Array<number | null | undefined>): number | null {
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x;
  return null;
}
