import type { AccessEvidenceItem } from './access-evidence-ladder.js';

export const EXACT_ADDRESS_LANE_ID: string = 'exact_address_web';

function canonicalAddress(input: { address: string; city?: string | null; state?: string | null; zip?: string | null }): string {
  return [input.address.trim(), input.city?.trim(), [input.state?.trim(), input.zip?.trim()].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

export function buildExactAddressQueries(input: { address: string; city?: string | null; state?: string | null; zip?: string | null; apn?: string | null }): string[] {
  const address = canonicalAddress(input);
  const queries = [
    address,
    `${address} for sale listing`,
    `${address} listing history prior sale`,
    `${address} access easement driveway`,
  ];
  if (input.apn?.trim()) queries.push(`${address} parcel ${input.apn.trim()}`);
  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

export type DiscoveryResultFamily = 'zillow' | 'redfin' | 'realtor' | 'landwatch' | 'land_listing' | 'auction' | 'brokerage' | 'mls_mirror' | 'official_property' | 'planning_permit' | 'cached' | 'other';

export function classifyDiscoveryResult(url: string): { host: string | null; family: DiscoveryResultFamily; propertySpecific: boolean } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { host: null, family: 'other', propertySpecific: false }; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();
  if (host === 'zillow.com' || host.endsWith('.zillow.com')) return { host, family: 'zillow', propertySpecific: /\/homedetails\//.test(path) };
  if (host === 'redfin.com' || host.endsWith('.redfin.com')) return { host, family: 'redfin', propertySpecific: /\/home\/\d+/.test(path) };
  if (host === 'realtor.com' || host.endsWith('.realtor.com')) return { host, family: 'realtor', propertySpecific: /\/realestateandhomes-detail\//.test(path) };
  // LandWatch and land.com address one listing either as /property/... or as a
  // region path ending in the listing's own /pid/<id>; a bare region page has
  // neither and stays non-specific.
  const landListingDetail = /\/property\//.test(path) || /\/listing\//.test(path) || /\/pid\/\d+/.test(path);
  if (host === 'landwatch.com' || host.endsWith('.landwatch.com')) return { host, family: 'land_listing', propertySpecific: landListingDetail };
  if (host === 'land.com' || host.endsWith('.land.com')) return { host, family: 'land_listing', propertySpecific: landListingDetail };
  if (host === 'auction.com' || host.endsWith('.auction.com')) {
    return {
      host,
      family: 'auction',
      propertySpecific: /\/(?:auction-)?details?\//.test(path) || /\/residential\//.test(path) || /\/assetdetail\//.test(path),
    };
  }
  if (/cache|cached|webcache/.test(host)) return { host, family: 'cached', propertySpecific: false };
  if (/mls|homesnap|movoto|trulia/.test(host)) return { host, family: 'mls_mirror', propertySpecific: /\d/.test(path) };
  if (/realty|realtor|properties|broker/.test(host)) return { host, family: 'brokerage', propertySpecific: /\d/.test(path) };
  const locator = `${host}${path}`;
  const hasRecordIdentity = /\d/.test(path) || parsed.search.length > 1;
  if (/assessor|equalization|parcel|property[-_]?search|county.*gis|gis.*county/.test(locator)) {
    return { host, family: 'official_property', propertySpecific: hasRecordIdentity };
  }
  if (/planning|permit|zoning/.test(locator)) {
    return { host, family: 'planning_permit', propertySpecific: hasRecordIdentity };
  }
  // A previously unknown but credible result can still be followed when its URL
  // itself identifies a property detail. The opened page must still pass the
  // exact street + ZIP identity gate before any evidence is retained.
  const genericPropertyDetail = /\/(?:property|listing|home|real-estate|auction|sale|parcel|permit)s?\//.test(path)
    && hasRecordIdentity;
  return { host, family: 'other', propertySpecific: genericPropertyDetail };
}

export interface ListingAccessStatement { text: string; tier: 'reported_legal'; sourceUrl: string; sourceLabel: string }
export interface ListingEngagementSignal {
  provider: 'zillow';
  views: number | null;
  saves: number | null;
  viewsAvailability: 'available' | 'unavailable';
  savesAvailability: 'available' | 'unavailable';
  /** Engagement is volatile, so even an unavailable observation is time-stamped. */
  retrievedAt: string | null;
}
export interface ExtractedListingEvidence {
  sourceUrl: string; sourceLabel: string; retrievedAt: string | null;
  legalAccessStatements: ListingAccessStatement[];
  drivewayStatements: string[];
  propertyType: string | null;
  buildingSqft: number | null;
  acres: number | null;
  utilities: string[];
  well: boolean | null;
  septic: boolean | null;
  remarks: string[];
  listingStatus: string | null;
  currentPrice: number | null;
  priorAskingPrice: number | null;
  originalListPrice: number | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  structures: string[];
  description: string | null;
  features: string[];
  brokerage: string | null;
  mls: string | null;
  listingHistory: Array<{ date: string | null; event: string; price: number | null }>;
  photoUrls: string[];
  engagement: ListingEngagementSignal | null;
}

const moneyValue = (raw: string): number | null => {
  if (!raw.trim()) return null;
  const value = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) ? value : null;
};
const numberValue = (raw: string): number | null => {
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};
const firstCapture = (body: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const value = body.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return null;
};
const countValue = (body: string, label: 'views' | 'saves'): number | null => {
  const raw = firstCapture(body, [
    new RegExp(`\\b([\\d,]+)\\s+${label}\\b`, 'i'),
    new RegExp(`\\b${label}\\s*[:\\-]?\\s*([\\d,]+)\\b`, 'i'),
  ]);
  return raw == null ? null : numberValue(raw);
};
const sentences = (text: string): string[] => text
  .replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+|[\r\n]+/)
  .map((sentence) => sentence.trim()).filter(Boolean);

export function extractListingEvidence(input: { url: string; sourceLabel?: string | null; title?: string | null; text: string; retrievedAt?: string | null }): ExtractedListingEvidence {
  const body = input.text?.trim() ?? '';
  const parsed = classifyDiscoveryResult(input.url);
  const sourceLabel = input.sourceLabel?.trim() || (parsed.host ?? 'Web listing');
  const allSentences = body ? sentences(body) : [];
  const legal = allSentences.filter((sentence) => /\b(?:legal access|deeded access|easement|right[- ]of[- ]way)\b/i.test(sentence));
  const driveways = allSentences.filter((sentence) => /\b(?:driveway|gravel drive|dirt drive|access drive|private drive)\b/i.test(sentence));
  const sqft = body.match(/\b([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square feet)\b/i);
  const acresMatch = body.match(/\b([\d,]+(?:\.\d+)?)\s*(?:acres?|ac\.)\b/i);
  const propertyTypeMatch = body.match(/\b(vacant land|residential land|undeveloped land|farm|ranch|single[- ]family(?: home)?|manufactured home|mobile home|house|townhouse|condo)\b/i);
  const status = firstCapture(body, [
    /\b(?:listing status|home status|status)\s*[:\-]?\s*(active(?: under contract)?|for sale|pending|contingent|sold|off market|recently sold)\b/i,
    /\b(active(?: under contract)?|for sale|pending|contingent|off market)\s+(?:listing|home|property)\b/i,
    /\b(for sale)\b/i,
  ]);
  const wellMention = /\bwell\b/i.test(body);
  const septicMention = /\bseptic\b/i.test(body);
  const well = !wellMention ? null : /\b(?:no|without|not connected to)\s+(?:a\s+)?well\b/i.test(body) ? false : true;
  const septic = !septicMention ? null : /\b(?:no|without|not connected to)\s+(?:a\s+)?septic\b/i.test(body) ? false : true;
  const utilityCandidates = ['electric', 'electricity', 'power', 'natural gas', 'propane', 'water', 'sewer', 'telephone', 'internet'];
  const utilities = utilityCandidates.filter((utility) => new RegExp(`\\b${utility.replace(' ', '\\s+')}\\b`, 'i').test(body));
  const listingHistory: ExtractedListingEvidence['listingHistory'] = [];
  const historyPatterns: Array<{ re: RegExp; event: string }> = [
    { re: /\bListed(?:\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}))?\s+for\s+(\$[\d,]+(?:\.\d{2})?)/gi, event: 'Listed' },
    { re: /\bPrice\s+(?:cut|reduced)(?:\s+to)?\s+(\$[\d,]+(?:\.\d{2})?)(?:\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4}))?/gi, event: 'Price cut' },
    { re: /\bSold(?:\s+on)?\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+for)?\s+(\$[\d,]+(?:\.\d{2})?)/gi, event: 'Sold' },
  ];
  for (const { re, event } of historyPatterns) {
    for (const match of body.matchAll(re)) {
      if (event === 'Listed') listingHistory.push({ date: match[1] ?? null, event, price: moneyValue(match[2]) });
      else if (event === 'Price cut') listingHistory.push({ date: match[2] ?? null, event, price: moneyValue(match[1]) });
      else listingHistory.push({ date: match[1] ?? null, event, price: moneyValue(match[2]) });
    }
  }
  const priorAskingPrice = listingHistory.find((entry) => entry.event === 'Listed')?.price
    ?? moneyValue(body.match(/\b(?:asking price|listed at|list price)\s*[:\-]?\s*(\$[\d,]+(?:\.\d{2})?)/i)?.[1] ?? '')
    ?? null;
  const currentPrice = moneyValue(firstCapture(body, [
    /\b(?:current price|asking price|list price|price)\s*[:\-]?\s*(\$[\d,]+(?:\.\d{2})?)/i,
    /\b(?:for sale|active)\s+(?:at|for)\s+(\$[\d,]+(?:\.\d{2})?)/i,
  ]) ?? '') ?? [...listingHistory].reverse().find((entry) => entry.price != null)?.price ?? priorAskingPrice;
  const originalListPrice = moneyValue(firstCapture(body, [
    /\b(?:original list price|originally listed (?:at|for))\s*[:\-]?\s*(\$[\d,]+(?:\.\d{2})?)/i,
  ]) ?? '') ?? listingHistory.find((entry) => entry.event === 'Listed')?.price ?? priorAskingPrice;
  const listingDate = firstCapture(body, [
    /\b(?:listed on|listing date|date listed)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i,
  ]) ?? listingHistory.find((entry) => entry.event === 'Listed')?.date ?? null;
  const domRaw = firstCapture(body, [/\b(\d[\d,]*)\s+(?:days? on (?:zillow|market)|DOM)\b/i, /\b(?:days? on market|DOM)\s*[:\-]?\s*(\d[\d,]*)\b/i]);
  const bedsRaw = firstCapture(body, [/\b([\d.]+)\s*(?:beds?|bd)\b/i, /\b(?:beds?|bedrooms?)\s*[:\-]?\s*([\d.]+)\b/i]);
  const bathsRaw = firstCapture(body, [/\b([\d.]+)\s*(?:baths?|ba)\b/i, /\b(?:baths?|bathrooms?)\s*[:\-]?\s*([\d.]+)\b/i]);
  const yearRaw = firstCapture(body, [/\b(?:year built|built in|built)\s*[:\-]?\s*((?:18|19|20)\d{2})\b/i]);
  const structures = allSentences.filter((sentence) => /\b(?:house|home|barn|garage|shed|cabin|workshop|outbuilding|pole building|structure|improvement)\b/i.test(sentence));
  const description = firstCapture(body, [
    /\b(?:listing description|property description|public remarks|remarks)\s*[:\-]\s*([^\r\n]{20,1500})/i,
  ]);
  const featureText = firstCapture(body, [/\b(?:property features|features|highlights)\s*[:\-]\s*([^\r\n]{3,1000})/i]);
  const features = featureText ? featureText.split(/[|;,\u2022]/).map((value) => value.trim()).filter(Boolean) : [];
  const brokerage = firstCapture(body, [
    /\b(?:listed by|listing provided by|brokerage|broker)\s*[:\-]?\s*([^|\r\n]{2,160})/i,
  ]);
  const mls = firstCapture(body, [/\b(?:MLS(?: ID| #| number)?|source)\s*[:#\-]?\s*([A-Z0-9-]{3,30})\b/i]);
  const photoUrls = [...new Set(Array.from(body.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi), (match) => match[0]))];
  const remarks = allSentences.filter((sentence) => /\b(?:remark|property|parcel|acre|access|driveway|utility|well|septic)\b/i.test(sentence));
  const engagement = parsed.family === 'zillow'
    ? (() => {
      const views = countValue(body, 'views');
      const saves = countValue(body, 'saves');
      return {
        provider: 'zillow' as const,
        views,
        saves,
        viewsAvailability: views == null ? 'unavailable' as const : 'available' as const,
        savesAvailability: saves == null ? 'unavailable' as const : 'available' as const,
        retrievedAt: input.retrievedAt?.trim() || null,
      };
    })()
    : null;
  return {
    sourceUrl: input.url,
    sourceLabel,
    retrievedAt: input.retrievedAt?.trim() || null,
    legalAccessStatements: legal.map((text) => ({ text, tier: 'reported_legal', sourceUrl: input.url, sourceLabel })),
    drivewayStatements: driveways,
    propertyType: propertyTypeMatch?.[1] ?? null,
    buildingSqft: sqft ? numberValue(sqft[1]) : null,
    acres: acresMatch ? numberValue(acresMatch[1]) : null,
    utilities,
    well,
    septic,
    remarks,
    listingStatus: status,
    currentPrice,
    priorAskingPrice,
    originalListPrice,
    listingDate,
    daysOnMarket: domRaw == null ? null : numberValue(domRaw),
    beds: bedsRaw == null ? null : numberValue(bedsRaw),
    baths: bathsRaw == null ? null : numberValue(bathsRaw),
    yearBuilt: yearRaw == null ? null : numberValue(yearRaw),
    structures,
    description,
    features,
    brokerage,
    mls,
    listingHistory,
    photoUrls,
    engagement,
  };
}

export function listingAccessEvidenceItems(evidence: ExtractedListingEvidence): AccessEvidenceItem[] {
  return evidence.legalAccessStatements.map((statement) => ({
    tier: 'reported_legal',
    statement: statement.text,
    sourceLabel: statement.sourceLabel,
    sourceKind: 'listing',
    basis: 'source_stated',
    weight: 'likely',
    sourceUrl: statement.sourceUrl,
    observedAt: evidence.retrievedAt,
  }));
}

// ── Operator projection ──────────────────────────────────────────────────────
// The lane already retrieves and extracts. This turns what it retained into the
// operator's read of it, without re-running anything and without promoting a
// listing claim into a verified government or legal fact.

export interface ListingEvidenceSourceView {
  evidenceLabel: 'Listing-reported';
  sourceLabel: string;
  family: DiscoveryResultFamily;
  sourceUrl: string;
  retrievedAt: string | null;
  propertyType: string | null;
  buildingSqft: number | null;
  acres: number | null;
  /** Latest retained listing event, when the page published a history. */
  listingStatus: string | null;
  listingStatusDate: string | null;
  price: number | null;
  originalListPrice: number | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  utilities: string[];
  well: boolean | null;
  septic: boolean | null;
  structures: string[];
  description: string | null;
  features: string[];
  brokerage: string | null;
  mls: string | null;
  listingHistory: Array<{ date: string | null; event: string; price: number | null }>;
  photoUrls: string[];
  engagement: ListingEngagementSignal | null;
  /** Reported legal/easement wording, verbatim. Empty means none was published. */
  accessStatements: string[];
  drivewayStatements: string[];
  /** Says plainly what the page did or did not state about legal access. */
  accessLanguageNote: string;
  provenanceNote: string;
}

export interface ExactAddressListingEvidenceView {
  status: 'retrieved' | 'none' | 'blocked' | 'error';
  note: string;
  queries: string[];
  retrievedAtIso: string | null;
  sources: ListingEvidenceSourceView[];
  /** What the retained listing evidence says the subject IS. */
  subjectRead: {
    improved: boolean;
    buildingSqft: number | null;
    acres: number | null;
    statement: string;
  } | null;
  /** Concise, reconciled operator card. Source detail remains available above. */
  listingCard: {
    active: boolean;
    status: string | null;
    currentPrice: number | null;
    originalListPrice: number | null;
    listingDate: string | null;
    daysOnMarket: number | null;
    priceChanges: Array<{ date: string | null; event: string; price: number | null }>;
    listingUrl: string;
    sourceLabel: string;
    primaryPhotoUrl: string | null;
    additionalPhotoUrls: string[];
    improvementFacts: {
      propertyType: string | null;
      buildingSqft: number | null;
      beds: number | null;
      baths: number | null;
      yearBuilt: number | null;
      structures: string[];
      utilities: string[];
      well: boolean | null;
      septic: boolean | null;
    };
    zillowEngagement: ListingEngagementSignal | null;
    engagementNote: string;
    evidenceLabel: 'Listing-reported';
  } | null;
  disclaimer: string;
}

/**
 * A readable excerpt around the matched wording.
 *
 * Some listing pages publish their whole detail panel with no sentence
 * punctuation, so the extractor's "sentence" is the entire page. Quoting that
 * verbatim buries the operator. The excerpt is centred on the matched term and
 * marked with ellipses so it is never mistaken for the complete statement.
 */
export function listingWordingExcerpt(text: string, term: RegExp, maxChars = 320): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const at = clean.search(term);
  if (at < 0) return `${clean.slice(0, maxChars)}…`;
  const start = Math.max(0, at - Math.floor(maxChars / 2));
  const end = Math.min(clean.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

const ACCESS_TERM = /legal access|deeded access|easement|right[- ]of[- ]way/i;
const DRIVEWAY_TERM = /driveway|gravel drive|dirt drive|access drive|private drive/i;

const LISTING_DISCLAIMER =
  'Listing evidence is reported by the marketplace or brokerage that published it. '
  + 'It is retained at listing-reported confidence and never becomes a verified '
  + 'government, assessor, or recorded-instrument fact. Reported legal access is '
  + 'not a recorded easement.';

export function projectExactAddressListingEvidence(result: {
  status: ExactAddressListingEvidenceView['status'];
  note?: string;
  queries?: string[];
  pages?: ExtractedListingEvidence[];
} | null | undefined): ExactAddressListingEvidenceView | null {
  if (!result) return null;
  const pages = result.pages ?? [];
  const sources: ListingEvidenceSourceView[] = pages.map((page) => {
    const classification = classifyDiscoveryResult(page.sourceUrl);
    const latest = [...(page.listingHistory ?? [])]
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
      .pop() ?? null;
    const accessStatements = page.legalAccessStatements
      .map((statement) => listingWordingExcerpt(statement.text, ACCESS_TERM));
    const listingStatus = page.listingStatus ?? latest?.event ?? null;
    const engagement = classification.family === 'zillow'
      ? page.engagement ?? {
        provider: 'zillow' as const,
        views: null,
        saves: null,
        viewsAvailability: 'unavailable' as const,
        savesAvailability: 'unavailable' as const,
        retrievedAt: page.retrievedAt,
      }
      : null;
    return {
      evidenceLabel: 'Listing-reported' as const,
      sourceLabel: page.sourceLabel,
      family: classification.family,
      sourceUrl: page.sourceUrl,
      retrievedAt: page.retrievedAt,
      propertyType: page.propertyType,
      buildingSqft: page.buildingSqft,
      acres: page.acres,
      listingStatus,
      listingStatusDate: latest?.date ?? null,
      price: page.currentPrice ?? page.priorAskingPrice,
      originalListPrice: page.originalListPrice ?? page.priorAskingPrice,
      listingDate: page.listingDate ?? null,
      daysOnMarket: page.daysOnMarket ?? null,
      beds: page.beds ?? null,
      baths: page.baths ?? null,
      yearBuilt: page.yearBuilt ?? null,
      utilities: page.utilities,
      well: page.well,
      septic: page.septic,
      structures: page.structures ?? [],
      description: page.description ?? null,
      features: page.features ?? [],
      brokerage: page.brokerage ?? null,
      mls: page.mls ?? null,
      listingHistory: page.listingHistory ?? [],
      photoUrls: page.photoUrls ?? [],
      engagement,
      accessStatements,
      drivewayStatements: page.drivewayStatements
        .map((text) => listingWordingExcerpt(text, DRIVEWAY_TERM)),
      accessLanguageNote: accessStatements.length
        ? `This page states access or easement wording, retained verbatim as reported legal access. It is not a recorded instrument.`
        : 'This page published no legal-access or easement wording, so reported legal access stays unresolved from it.',
      provenanceNote: `Retrieved from ${page.sourceLabel}${page.retrievedAt ? ` on ${page.retrievedAt.slice(0, 10)}` : ''} by exact-address web discovery.`,
    };
  });

  const sqfts = sources.map((s) => s.buildingSqft).filter((v): v is number => typeof v === 'number' && v > 0);
  const acreages = sources.map((s) => s.acres).filter((v): v is number => typeof v === 'number' && v > 0);
  const improvedTypes = sources
    .map((s) => s.propertyType)
    .filter((t): t is string => !!t && !/vacant|undeveloped|residential land/i.test(t));
  const improved = sqfts.length > 0 || improvedTypes.length > 0;
  const buildingSqft = sqfts.length ? Math.max(...sqfts) : null;
  const acres = acreages.length ? Math.max(...acreages) : null;

  const subjectRead = sources.length
    ? {
      improved,
      buildingSqft,
      acres,
      statement: improved
        ? `Retained listing evidence describes an improved property${buildingSqft != null ? ` of approx. ${buildingSqft.toLocaleString('en-US')} sqft` : ''}${acres != null ? ` on ${acres} acres` : ''}${improvedTypes.length ? ` (${[...new Set(improvedTypes)].join(', ')})` : ''}. Listing-reported, not an assessor record.`
        : `Retained listing evidence describes${acres != null ? ` ${acres} acres` : ' the property'} without a published structure. Listing-reported, not an assessor record.`,
    }
    : null;

  const isActive = (status: string | null): boolean => !!status && /\b(?:active|for sale|listed for sale)\b/i.test(status)
    && !/sold|off market/i.test(status);
  const cardSource = [...sources].sort((a, b) => {
    const aRank = (isActive(a.listingStatus) ? 4 : 0) + (a.family === 'zillow' ? 2 : 0) + (a.photoUrls.length ? 1 : 0);
    const bRank = (isActive(b.listingStatus) ? 4 : 0) + (b.family === 'zillow' ? 2 : 0) + (b.photoUrls.length ? 1 : 0);
    return bRank - aRank;
  })[0] ?? null;
  const zillowSource = sources.find((source) => source.family === 'zillow') ?? null;
  const photos = cardSource ? [...new Set(cardSource.photoUrls)] : [];
  const listingCard = cardSource
    ? {
      active: isActive(cardSource.listingStatus),
      status: cardSource.listingStatus,
      currentPrice: cardSource.price,
      originalListPrice: cardSource.originalListPrice,
      listingDate: cardSource.listingDate,
      daysOnMarket: cardSource.daysOnMarket,
      priceChanges: cardSource.listingHistory.filter((event) => /price|cut|reduced/i.test(event.event)),
      listingUrl: cardSource.sourceUrl,
      sourceLabel: cardSource.sourceLabel,
      primaryPhotoUrl: photos[0] ?? null,
      additionalPhotoUrls: photos.slice(1),
      improvementFacts: {
        propertyType: cardSource.propertyType,
        buildingSqft: cardSource.buildingSqft,
        beds: cardSource.beds,
        baths: cardSource.baths,
        yearBuilt: cardSource.yearBuilt,
        structures: cardSource.structures,
        utilities: cardSource.utilities,
        well: cardSource.well,
        septic: cardSource.septic,
      },
      zillowEngagement: zillowSource?.engagement ?? null,
      engagementNote: 'Zillow views and saves are a time-varying interest signal, not proof of value or guaranteed buyer demand.',
      evidenceLabel: 'Listing-reported' as const,
    }
    : null;

  return {
    status: result.status,
    note: result.note ?? '',
    queries: result.queries ?? [],
    retrievedAtIso: sources.map((s) => s.retrievedAt).filter(Boolean).sort().pop() ?? null,
    sources,
    subjectRead,
    listingCard,
    disclaimer: LISTING_DISCLAIMER,
  };
}
