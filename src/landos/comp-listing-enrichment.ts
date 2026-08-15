import { listComps, type CompRow } from './comps.js';
import { withAutomationTab, withDisposableContext, type AutomationPage } from './automation-browser.js';
import {
  normalizeListingEvents, reconcileCaptureToComp, rejectedImages, selectListingImage,
  selectListingImages, unusableHistoryRows, type RawListingCapture, type ListingImageCandidate,
  type ListingProvider,
} from './comp-listing-detail.js';
import { reconcileCompAddress } from './comp-location-reconciliation.js';
import { saveCompListingDetail } from './comp-listing-store.js';

export interface ListingEnrichmentResult {
  compId: number; provider: string; sourceUrl: string | null; persisted: boolean;
  matched: boolean; reason: string; thumbnailUpdated: boolean;
}
type DetailPage = {
  goto: AutomationPage['goto'];
  evaluate?: <T>(fn: unknown, ...args: unknown[]) => Promise<T>;
};
type DomImage = { currentSrc?: unknown; src?: unknown; closest?: (selector: string) => { className?: unknown } | null };
declare const document: { body?: { innerText?: unknown }; title?: unknown; querySelectorAll: (selector: string) => ArrayLike<DomImage> };
declare const window: { location?: { href?: unknown } };

function canonicalAddress(value: string | null, sourceUrl: string): string | null {
  return reconcileCompAddress({ capturedAddress: value, sourceUrl })?.postalAddress ?? value?.replace(/\s+/g, ' ').trim() ?? null;
}

/** Browser-side extraction. It only reads the opened page and never follows another property's link. */
function listingReader(): (provider: ListingProvider) => RawListingCapture {
  return (provider: ListingProvider) => {
    const body = String(document.body?.innerText ?? '').replace(/\u00a0/g, ' ');
    const title = String(document.title ?? '');
    const url = String(window.location?.href ?? '');
    const text = `${title}\n${body}`;
    const one = (rx: RegExp): string | null => text.match(rx)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
    const address = one(/(?:^|\n)(\d+\s+[^\n,]+,\s*[^\n,]+,\s*[A-Z]{2}\s+\d{5})(?:\n|$)/m) ?? one(/(\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s+\d{5})/);
    const images: ListingImageCandidate[] = [];
    const seen = new Set<string>();
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const src = String(img.currentSrc ?? img.src ?? '').trim();
      if (!/^https:\/\//i.test(src) || seen.has(src) || !/(zillowstatic|thelandportal\.com\/images)/i.test(src)) continue;
      const container = img.closest?.('[data-testid*="gallery" i],[class*="gallery" i],[class*="media" i],[class*="photo" i]');
      images.push({ url: src, context: container ? 'gallery' : 'unknown', container: container?.className ? String(container.className) : undefined });
      seen.add(src);
    }
    const history: Array<{ dateText: string; eventText: string; priceText: string }> = [];
    const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$|^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(lines[i])) continue;
      const priceText = lines.slice(i, i + 5).find((line) => /^\$[\d,]+/.test(line));
      const eventText = lines.slice(i + 1, i + 4).find((line) => /listed|price change|sold|removed|pending|contract/i.test(line));
      if (priceText && eventText) history.push({ dateText: lines[i], eventText, priceText });
    }
    return {
      provider, sourceUrl: url, capturedAtIso: new Date().toISOString(), images, priceHistory: history,
      description: one(/What's special\s*\n([\s\S]*?)(?:\n(?:Show more|Facts & features|Source:)|$)/i),
      status: one(/(?:^|\n)(For sale|Sold|Pending|Under contract)(?:\n|$)/im), address,
      acresText: one(/(?:^|\n)([\d,.]+\s+Acres?)(?:\n|$)/im),
      priceText: one(/(?:For sale|Listed|Current price|Price)\s*\n?\s*(\$[\d,]+)/i),
      domText: one(/(\d+)\s+days?\s+on\s+(?:Zillow|market)/i),
      apn: one(/(?:Parcel number|APN)[:\s]*([A-Z0-9-]+)/i), lat: null, lng: null, limitation: null,
    };
  };
}

function providerFor(source: string): ListingProvider | null {
  if (/zillow/i.test(source)) return 'Zillow';
  if (/landportal/i.test(source)) return 'LandPortal';
  return null;
}

async function captureOnPage(page: DetailPage, row: CompRow, provider: ListingProvider): Promise<ListingEnrichmentResult> {
  const sourceUrl = row.source_url || null;
  if (!sourceUrl) return { compId: row.id, provider, sourceUrl: null, persisted: false, matched: false, reason: 'retained comparable has no source URL', thumbnailUpdated: false };
  try {
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await new Promise<void>((resolve) => setTimeout(resolve, 3500));
    if (!page.evaluate) throw new Error('provider detail page does not expose DOM evaluation');
    const capture = await page.evaluate<RawListingCapture>(listingReader(), provider);
    const cleanRowAddress = canonicalAddress(row.address_desc || null, sourceUrl);
    const cleanCaptureAddress = canonicalAddress(capture.address, sourceUrl);
    const reconciliation = reconcileCaptureToComp({ ...capture, address: cleanCaptureAddress }, {
      sourceUrl, address: cleanRowAddress, apn: row.apn || null, acres: row.acres, price: row.price, lat: row.lat, lng: row.lng,
    });
    const selected = selectListingImages(capture);
    const image = selectListingImage(capture);
    const detail = {
      compId: row.id, provider, sourceUrl, capturedAtIso: capture.capturedAtIso,
      image: image ? { ...image, sourceProperty: cleanCaptureAddress, reconciledOn: reconciliation.matchedOn } : null,
      photos: selected.map((photo, index) => ({ ...photo, sequence: index + 1 })), photoCount: selected.length,
      events: normalizeListingEvents(capture), unusableRows: unusableHistoryRows(capture), refusedImages: rejectedImages(capture),
      sourceDescription: capture.description, status: capture.status, limitation: capture.limitation, reconciliation,
      propertyFacts: { address: cleanCaptureAddress, acreage: capture.acresText ? Number(capture.acresText.replace(/[^0-9.]/g, '')) || null : null, improvementType: null },
      sourcePages: [{ provider, url: sourceUrl }],
    };
    const saved = saveCompListingDetail(detail);
    return { compId: row.id, provider, sourceUrl, persisted: saved.persisted, matched: reconciliation.matched, reason: saved.reason, thumbnailUpdated: saved.thumbnailUpdated };
  } catch (error) {
    return { compId: row.id, provider, sourceUrl, persisted: false, matched: false, reason: `listing page revisit failed: ${error instanceof Error ? error.message : String(error)}`, thumbnailUpdated: false };
  }
}

/** Revisit retained Zillow/LandPortal pages, identity-gate evidence, and persist only matched facts. */
export async function enrichRetainedCompListings(dealCardId: number): Promise<ListingEnrichmentResult[]> {
  const rows = listComps({ dealCardId }).filter((row) => providerFor(`${row.canonical_source ?? ''} ${row.source_label ?? ''}`));
  const results: ListingEnrichmentResult[] = [];
  for (const row of rows) {
    const provider = providerFor(`${row.canonical_source ?? ''} ${row.source_label ?? ''}`);
    if (!provider) continue;
    const result = provider === 'Zillow'
      ? await withDisposableContext('zillow-comp-enrichment', (page) => captureOnPage(page, row, provider))
      : await withAutomationTab((page) => captureOnPage(page, row, provider), { label: 'landportal-comp-enrichment' });
    results.push(result);
  }
  return results;
}
