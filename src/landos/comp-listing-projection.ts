// One comparable's operator-facing listing projection.
//
// This is the layer the Deal Card actually reads. It joins three honest pieces —
// the retained provider capture, the market-time calculation, and the
// transaction-price decision — into the exact blocks the workspace renders:
// a transaction (or competition) summary, a dated timeline, the source
// description beside the LandOS summary, comparability, and evidence.
//
// A closed valuation comp and an active competitor are DIFFERENT things and this
// projection keeps them different from the start. A closed comp leads with a
// verified sold price and how long it took to sell. An active competitor leads
// with what it is asking and how long it has failed to sell at that price.
// Nothing here renders them through one generic "status" that would let the
// operator mistake current competition for closed evidence.

import {
  computeCompMarketTime, type CompListingEvent, type CompMarketTime,
} from './comp-listing-history.js';
import {
  resolveCompTransactionPrice, TRANSACTION_CONFIDENCE_LABEL,
  type CompSaleVerification, type CompTransactionPrice,
} from './comp-transaction-price.js';
import {
  buildSourceDescription, buildLandosFactualSummary,
  type SourceDescription, type LandosFactualSummary,
} from './comp-listing-summary.js';
import type { PersistedCompListingDetail } from './comp-listing-store.js';
import { isListingPhotoUrl } from './comp-visual.js';

/** The single distinction the operator must never have to work out. */
export type CompTransactionKind = 'closed' | 'active' | 'context';

export const TRANSACTION_KIND_LABEL: Readonly<Record<CompTransactionKind, string>> = {
  closed: 'CLOSED SALE',
  active: 'ACTIVE COMPETITOR',
  context: 'CONTEXT RECORD',
};

export interface CompTimelineRow {
  dateIso: string;
  kind: CompListingEvent['kind'];
  /** The source's own wording. */
  label: string;
  price: number | null;
  source: string;
}

export interface CompListingProjection {
  transactionKind: CompTransactionKind;
  kindLabel: string;
  /** Transaction price decision: verified sale, estimated proxy, or none. */
  price: {
    basis: CompTransactionPrice['basis'];
    amount: number | null;
    perAcre: number | null;
    amountLabel: string;
    perAcreLabel: string;
    confidence: CompTransactionPrice['confidence'];
    confidenceLabel: string;
    usableForValuation: boolean;
    lines: string[];
    disclosureNote: string;
  };
  soldDateIso: string | null;
  /** Market time, with the provider figure and the LandOS figure kept apart. */
  marketTime: {
    originalListingDateIso: string | null;
    originalListPrice: number | null;
    cumulativeDays: number | null;
    /** Label differs for closed vs active so the number cannot be misread. */
    cumulativeLabel: string;
    currentEpisodeDays: number | null;
    providerDaysOnMarket: number | null;
    episodeCount: number;
    relistStitched: boolean;
    stitchUncertain: boolean;
    withdrawnDays: number;
    freshness: CompMarketTime['freshness'];
    freshnessLabel: string | null;
    completeness: CompMarketTime['completeness'];
    priceReductions: CompMarketTime['priceReductions'];
    lines: string[];
  };
  timeline: CompTimelineRow[];
  /** Rows the page printed that could not be dated or classified. */
  unusableRows: Array<{ row: string; why: string }>;
  description: {
    source: SourceDescription | null;
    landos: LandosFactualSummary;
  };
  /** Listing-reported comparison facts retained during provider enrichment.
   * These supplement, and never masquerade as, assessor facts. */
  characteristics: {
    address: string | null;
    acreage: number | null;
    improvementType: string | null;
    buildingSqft: number | null;
    beds: number | null;
    baths: number | null;
    yearBuilt: number | null;
    utilities: string[];
    accessClues: string[];
    features: string[];
    provenance: 'listing_reported' | 'not_retrieved';
  };
  /**
   * The property's own photographs, in the order the provider published them.
   *
   * `items` is empty whenever the page published nothing that could honestly be
   * called a photograph of THIS parcel. That is not a defect to be papered over:
   * `fallbackNote` then says exactly why, and the card falls back to its labeled
   * aerial or road-map visual rather than borrowing a neighbour's photo.
   */
  photos: {
    items: CompProjectedPhoto[];
    count: number;
    /** True only when at least one genuine provider photograph is retained. */
    hasGenuinePhotos: boolean;
    provider: string | null;
    sourcePage: string | null;
    /** Why there is no gallery, when there is none. Null when photos exist. */
    fallbackNote: string | null;
  };
  evidence: {
    /** Operator-facing: the original page, and who published it. */
    sourcePage: string | null;
    provider: string | null;
    sourcePages: Array<{ provider: string; url: string }>;
    apn: string | null;
    /**
     * Retrieval diagnostics — retained for audit and debugging, and deliberately
     * NOT part of the operator's Full details.
     *
     * An operator deciding whether to offer $22,000 on a parcel is not helped by
     * "provider served a bot-verification interstitial" or a capture timestamp or
     * a raw coordinate pair; that text competes for attention with the sold price
     * and the market time, which are the facts the decision actually turns on.
     * The information still matters when a capture has to be debugged, so it is
     * kept here and rendered nowhere the operator works.
     */
    diagnostics: {
      imageProvenance: string;
      imageLabel: string | null;
      imageIsOriginalListingImage: boolean;
      imageReconciledOn: string[];
      photoCount: number;
      lat: number | null;
      lng: number | null;
      transactionPriceConfidence: string;
      listingHistoryCompleteness: string;
      capturedAtIso: string | null;
      limitation: string | null;
    };
  };
}

/** One photograph in the operator-facing carousel. */
export interface CompProjectedPhoto {
  url: string;
  /** 1-based position, as the provider published it. */
  sequence: number;
  /** e.g. "Zillow listing photo". Never a fallback label. */
  label: string;
  provider: string;
  context: 'hero' | 'gallery';
}

export interface BuildListingProjectionInput {
  detail: PersistedCompListingDetail | null;
  transactionKind: CompTransactionKind;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
  subjectAcres: number | null;
  distanceMiles: number | null;
  lat: number | null;
  lng: number | null;
  sourceLabel: string;
  sourceUrl: string | null;
  /** The price already retained on the comp row. */
  retainedPrice: number | null;
  retainedPriceKind: 'sale' | 'list' | 'unknown';
  /** How the closed price was established. Defaults to `independent`. */
  saleVerification?: CompSaleVerification;
  /** Provenance sentence repeated for a source-stated sale. */
  saleVerificationProvenance?: string | null;
  retainedDateIso: string | null;
  providerDaysOnMarket: number | null;
  /** Listing date the comp row retained, used when no capture exists. */
  retainedListingDateIso: string | null;
  propertyClass?: 'land' | 'improved' | 'unknown';
  buildingSqft?: number | null;
  roadFrontageVerified?: boolean | null;
  visualProvenanceDetail: string;
  /**
   * The genuine photograph the comp row already holds, when it holds one.
   *
   * The row's `thumbnail_url` outlives an individual capture: it was written by
   * a capture that reconciled, and a later failed revisit does not clear it. So
   * when the stored capture carries no photo set but the row still carries a
   * real listing photograph, the gallery shows that photograph rather than
   * telling the operator there are none while the card beside it displays one.
   */
  retainedVisual?: { url: string; label: string } | null;
  /** Ordered provider photographs carried by research evidence before a full
   * listing-detail capture is persisted. */
  retainedPhotoUrls?: Array<{ url: string; label: string }>;
  todayIso: string;
}

const COMPLETENESS_TEXT: Record<CompMarketTime['completeness'], string> = {
  full: 'Complete: every episode boundary the record needs is documented.',
  partial: 'Partial: at least one episode boundary is not documented by the source.',
  current_episode_only: 'Current listing episode only: the source does not expose earlier episodes.',
  none: 'None: the source exposed no dated listing history.',
};

const FRESHNESS_TEXT: Record<CompMarketTime['freshness'], string | null> = {
  genuinely_new: 'Appears genuinely new.',
  cosmetically_refreshed: 'Appears cosmetically refreshed: the current episode is a relist, not a new listing.',
  long_running: 'Long-running: exposed for more than six months in one continuous episode.',
  unknown: null,
};

/**
 * Build the projection for one comparable.
 *
 * When no provider capture exists, the projection still renders honestly from
 * the retained row: the price and date LandOS already holds, the provider DOM if
 * the row carried one, and an explicit statement that the listing history was
 * never retrieved. It never invents an original listing date.
 */
export function buildCompListingProjection(input: BuildListingProjectionInput): CompListingProjection {
  const detail = input.detail;
  const events: CompListingEvent[] = detail?.events ?? [];

  // A retained listing date with no captured history still anchors an episode,
  // so an active listing does not lose the one date LandOS genuinely has.
  const seededEvents: CompListingEvent[] = events.length > 0
    ? events
    : input.retainedListingDateIso
      ? [{
        dateIso: input.retainedListingDateIso,
        kind: 'listed',
        price: input.retainedPriceKind === 'list' ? input.retainedPrice : null,
        label: 'Listed for sale',
        source: `${input.sourceLabel} retained listing date`,
      }]
      : [];

  const soldDateIso = input.retainedPriceKind === 'sale' ? input.retainedDateIso : null;
  const marketKind = input.transactionKind === 'active' ? 'active' : 'closed';

  const marketTime = computeCompMarketTime({
    events: seededEvents,
    transactionKind: marketKind,
    soldDateIso,
    todayIso: input.todayIso,
    providerDaysOnMarket: input.providerDaysOnMarket,
  });

  const price = resolveCompTransactionPrice({
    verifiedSoldPrice: input.retainedPriceKind === 'sale' ? input.retainedPrice : null,
    soldDateIso,
    lastAskingPriceAtPending: lastAskingAtPending(seededEvents),
    pendingDateIso: pendingDate(seededEvents),
    state: input.state,
    acres: input.acres,
    sourceProvidesClosedPrice: input.retainedPriceKind === 'sale' && input.retainedPrice != null,
    saleVerification: input.saleVerification ?? 'independent',
    sourceStatedProvenance: input.saleVerificationProvenance ?? null,
  });

  // A LISTED record has no transaction price at all — it has an asking price.
  // Forcing it through the sold-price resolver would be the exact conflation the
  // workspace is meant to prevent, so the asking branch is stated separately.
  //
  // The branch keys off what the source recorded (`list`), never off the
  // record's ROLE. An improved-property listing is context rather than live
  // competition, but its price is still an ask — labelling it "transaction price
  // unavailable" above a printed figure is a contradiction the operator has to
  // decode.
  const isAsking = input.retainedPriceKind === 'list';
  const asking = isAsking && input.retainedPrice != null && input.retainedPrice > 0
    ? input.retainedPrice
    : null;
  const askingPpa = asking != null && input.acres != null && input.acres > 0
    ? Math.round((asking / input.acres) * 100) / 100
    : null;

  const priceBlock: CompListingProjection['price'] = isAsking
    ? {
      basis: 'none',
      amount: asking,
      perAcre: askingPpa,
      amountLabel: 'Current asking price',
      perAcreLabel: 'Current asking price per acre',
      confidence: 'unavailable',
      confidenceLabel: 'Asking price — never sold evidence',
      usableForValuation: false,
      lines: ['An asking price is what a seller wants, not what a buyer paid. It never enters the cleaned sold-price calculations.'],
      disclosureNote: price.disclosure.note,
    }
    : {
      basis: price.basis,
      amount: price.price,
      perAcre: price.pricePerAcre,
      amountLabel: price.priceLabel,
      perAcreLabel: price.ppaLabel,
      confidence: price.confidence,
      confidenceLabel: TRANSACTION_CONFIDENCE_LABEL[price.confidence],
      usableForValuation: price.usableForValuation,
      lines: price.lines,
      disclosureNote: price.disclosure.note,
    };

  const sourceDescription = buildSourceDescription(detail?.sourceDescription ?? null, input.sourceLabel);
  const landos = buildLandosFactualSummary({
    address: input.address,
    acres: input.acres,
    subjectAcres: input.subjectAcres,
    distanceMiles: input.distanceMiles,
    county: input.county,
    state: input.state,
    transactionKind: input.transactionKind,
    verifiedFacts: verifiedFactsFor(input, priceBlock),
    sourceDescription: detail?.sourceDescription ?? null,
    roadFrontageVerified: input.roadFrontageVerified ?? null,
    propertyClass: input.propertyClass,
    buildingSqft: input.buildingSqft,
  });

  const timeline: CompTimelineRow[] = seededEvents
    .map((e) => ({ dateIso: e.dateIso, kind: e.kind, label: e.label, price: e.price, source: e.source }))
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  if (soldDateIso && !timeline.some((r) => r.kind === 'sold')) {
    timeline.push({
      dateIso: soldDateIso,
      kind: 'sold',
      label: 'Sold',
      price: input.retainedPrice,
      source: `${input.sourceLabel} retained sale record`,
    });
    timeline.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  }

  return {
    transactionKind: input.transactionKind,
    kindLabel: TRANSACTION_KIND_LABEL[input.transactionKind],
    price: priceBlock,
    soldDateIso,
    marketTime: {
      originalListingDateIso: marketTime.originalListingDateIso,
      originalListPrice: marketTime.originalListPrice,
      cumulativeDays: marketTime.cumulativeDays,
      cumulativeLabel: input.transactionKind === 'active'
        ? 'LandOS cumulative active market days'
        : 'LandOS cumulative days on market',
      currentEpisodeDays: marketTime.currentEpisodeDays,
      providerDaysOnMarket: marketTime.providerDaysOnMarket,
      episodeCount: marketTime.episodeCount,
      relistStitched: marketTime.relistStitched,
      stitchUncertain: marketTime.stitchUncertain,
      withdrawnDays: marketTime.withdrawnDays,
      freshness: marketTime.freshness,
      freshnessLabel: FRESHNESS_TEXT[marketTime.freshness],
      completeness: marketTime.completeness,
      priceReductions: marketTime.priceReductions,
      lines: detail
        ? marketTime.lines
        : [...marketTime.lines, 'The provider listing page has not been revisited for this record, so no listing history beyond the retained date is available.'],
    },
    timeline,
    unusableRows: detail?.unusableRows ?? [],
    description: { source: sourceDescription, landos },
    characteristics: {
      address: detail?.propertyFacts?.address ?? input.address,
      acreage: detail?.propertyFacts?.acreage ?? input.acres,
      improvementType: detail?.propertyFacts?.improvementType ?? null,
      buildingSqft: detail?.propertyFacts?.buildingSqft ?? input.buildingSqft ?? null,
      beds: detail?.propertyFacts?.beds ?? null,
      baths: detail?.propertyFacts?.baths ?? null,
      yearBuilt: detail?.propertyFacts?.yearBuilt ?? null,
      utilities: detail?.propertyFacts?.utilities ?? [],
      accessClues: detail?.propertyFacts?.accessClues ?? [],
      features: detail?.propertyFacts?.features ?? [],
      provenance: detail?.propertyFacts ? 'listing_reported' : 'not_retrieved',
    },
    photos: buildPhotoBlock(detail, input),
    evidence: {
      sourcePage: input.sourceUrl,
      provider: detail?.provider ?? input.sourceLabel,
      sourcePages: detail?.sourcePages?.length
        ? detail.sourcePages
        : input.sourceUrl ? [{ provider: detail?.provider ?? input.sourceLabel, url: input.sourceUrl }] : [],
      apn: input.apn,
      diagnostics: {
        imageProvenance: input.visualProvenanceDetail,
        imageLabel: detail?.image?.label ?? null,
        imageIsOriginalListingImage: !!detail?.image?.isOriginalListingImage,
        imageReconciledOn: detail?.image?.reconciledOn ?? [],
        photoCount: detail?.photos?.length ?? (detail?.image ? 1 : 0),
        lat: input.lat,
        lng: input.lng,
        transactionPriceConfidence: priceBlock.confidenceLabel,
        listingHistoryCompleteness: COMPLETENESS_TEXT[marketTime.completeness],
        capturedAtIso: detail?.capturedAtIso ?? null,
        limitation: detail?.limitation ?? null,
      },
    },
  };
}

/**
 * The operator-facing photo set.
 *
 * Only a reconciled capture can contribute photographs: the reconciliation is
 * what proves the page belonged to this comparable, and an unreconciled capture
 * has already had its images stripped by the store. When the set is empty the
 * note says which of the three real reasons applies, because "no photos" and
 * "the provider blocked us" lead the operator to different next actions.
 */
function buildPhotoBlock(
  detail: PersistedCompListingDetail | null,
  input: BuildListingProjectionInput,
): CompListingProjection['photos'] {
  const provider = detail?.provider ?? input.sourceLabel;
  const raw = detail?.photos ?? (detail?.image
    ? [{
      url: detail.image.url,
      sequence: 1,
      label: detail.image.label,
      context: detail.image.context,
    }]
    : []);

  const fromDetail: CompProjectedPhoto[] = raw
    .filter((p) => p && typeof p.url === 'string' && p.url.trim())
    .map((p, i) => ({
      url: p.url,
      sequence: p.sequence ?? i + 1,
      label: p.label,
      provider,
      context: p.context === 'hero' ? 'hero' : 'gallery',
    }));

  // Fall back to the photograph the row itself retains. This is not a weaker
  // claim: that URL was written by a capture that reconciled to this exact
  // comparable, and it is the same image the card is already showing.
  const retainedPhotos = (input.retainedPhotoUrls ?? [])
    .filter((photo, index, all) => photo && isListingPhotoUrl(photo.url)
      && all.findIndex((candidate) => candidate.url === photo.url) === index)
    .map((photo, index): CompProjectedPhoto => ({
      url: photo.url,
      sequence: index + 1,
      label: photo.label,
      provider,
      context: index === 0 ? 'hero' : 'gallery',
    }));
  const items: CompProjectedPhoto[] = fromDetail.length > 0
    ? fromDetail
    : retainedPhotos.length > 0
      ? retainedPhotos
    : input.retainedVisual
      ? [{
        url: input.retainedVisual.url,
        sequence: 1,
        label: input.retainedVisual.label,
        provider,
        context: 'hero' as const,
      }]
      : [];

  const fallbackNote = items.length > 0 ? null : operatorFallbackNote(detail);

  return {
    items,
    count: items.length,
    hasGenuinePhotos: items.length > 0,
    provider: items.length > 0 ? provider : null,
    sourcePage: input.sourceUrl,
    fallbackNote,
  };
}

/**
 * Why there is no gallery, in one operator sentence.
 *
 * The raw `limitation` string is written for whoever debugs a capture — it
 * counts refused images and names DOM positions. An operator pricing a parcel
 * needs only the distinction that changes what they do next: the page HAS no
 * photographs of this land (nothing more to find), versus the provider would not
 * serve the page (worth another look, by hand, later). The counting stays in
 * `evidence.diagnostics`.
 */
function operatorFallbackNote(detail: PersistedCompListingDetail | null): string {
  if (!detail) return 'The listing page has not been checked for photographs yet.';
  const limitation = detail.limitation ?? '';
  if (/bot-verification|interstitial|denied|captcha|unusual traffic/i.test(limitation)) {
    return 'The provider would not serve this listing page to LandOS, so no photograph could be retrieved from it.';
  }
  if (!detail.reconciliation?.matched) {
    return 'The page LandOS reached could not be confirmed as this exact property, so nothing from it was kept.';
  }
  return 'The listing page published no photograph of this property.';
}

function verifiedFactsFor(
  input: BuildListingProjectionInput,
  price: CompListingProjection['price'],
): string[] {
  // Keyed off what the source recorded, not the record's role — an improved
  // listing is context, but its price is still an ask and must be named one.
  const facts: string[] = [];
  if (price.basis === 'verified_sale' && price.amount != null) {
    facts.push(`verified closed sale of $${Math.round(price.amount).toLocaleString('en-US')}${input.retainedDateIso ? ` on ${input.retainedDateIso}` : ''}`);
  }
  if (price.basis === 'source_stated_sale' && price.amount != null) {
    facts.push(`a source-stated, independently unverified sale price of $${Math.round(price.amount).toLocaleString('en-US')}${input.retainedDateIso ? ` against the stated date ${input.retainedDateIso}` : ''}`);
  }
  if (input.retainedPriceKind === 'list' && price.amount != null) {
    facts.push(`currently asking $${Math.round(price.amount).toLocaleString('en-US')}`);
  }
  return facts;
}

function lastAskingAtPending(events: CompListingEvent[]): number | null {
  const sorted = [...events].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  let running: number | null = null;
  for (const e of sorted) {
    if (e.kind === 'pending') return e.price ?? running;
    if (typeof e.price === 'number' && e.price > 0 && e.kind !== 'sold') running = e.price;
  }
  return null;
}

function pendingDate(events: CompListingEvent[]): string | null {
  const hit = [...events].sort((a, b) => a.dateIso.localeCompare(b.dateIso)).find((e) => e.kind === 'pending');
  return hit?.dateIso ?? null;
}
