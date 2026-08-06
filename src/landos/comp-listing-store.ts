// Reading and writing one comparable's retained provider-page detail.
//
// A capture is atomic: the chosen image, the dated events, the description, and
// the reconciliation that proved the page belongs to this comparable are written
// together or not at all. That is deliberate — an image without its
// reconciliation is exactly the "looks like evidence" failure this lane exists
// to prevent, so the store refuses to persist an image whose capture did not
// reconcile.
//
// The image itself is persisted as the provider's own durable photo-CDN URL on
// the existing `thumbnail_url` column, which is the path the comp workspace
// already renders and which already survives refresh and restart. No blob URL,
// no temporary handle, no new storage architecture.

import { getLandosDb } from './db.js';
import type { PersistedListingDetail } from './comp-listing-detail.js';

export interface ListingDetailWriteResult {
  compId: number;
  persisted: boolean;
  thumbnailUpdated: boolean;
  reason: string;
}

/** Persist one comparable's capture. Refuses an image the capture did not reconcile. */
export function saveCompListingDetail(detail: PersistedListingDetail): ListingDetailWriteResult {
  const db = getLandosDb();
  const row = db.prepare('SELECT id, thumbnail_url, listing_detail_json FROM landos_comp WHERE id = ?')
    .get(detail.compId) as { id: number; thumbnail_url: string; listing_detail_json: string } | undefined;
  if (!row) {
    return { compId: detail.compId, persisted: false, thumbnailUpdated: false, reason: 'comparable row not found' };
  }

  // The gate: an unreconciled capture may record its failure, never its image.
  // The photo SET passes through the same gate as the single image — a gallery
  // is not a weaker claim than a hero, it is the same claim made twelve times,
  // so an unreconciled capture loses all of it.
  const gated: PersistedListingDetail = detail.reconciliation.matched
    ? { ...detail, photoCount: detail.photos?.length ?? (detail.image ? 1 : 0) }
    : { ...detail, image: null, photos: [], photoCount: 0, events: [], sourceDescription: null };

  // A REFUSED capture must never destroy evidence a previous reconciled capture
  // already proved.
  //
  // Provider blocking is intermittent: the same Zillow page that reconciled and
  // gave up a photograph one hour serves a bot-verification interstitial the
  // next. Writing that refusal straight over the row silently deleted a genuine,
  // reconciled listing photo — which is exactly the "previously accepted
  // information changed without asking" failure the workspace is not allowed to
  // have. So a refusal now records ITSELF (its note, its limitation, its
  // timestamp) while the proven image, photo set, events and description are
  // carried forward from the capture that earned them.
  const prior = parseListingDetail(row.listing_detail_json);
  const priorWasProven = !!prior?.reconciliation?.matched && (!!prior.image || (prior.photos?.length ?? 0) > 0 || !!prior.sourceDescription);
  const preserving = !detail.reconciliation.matched && priorWasProven;

  const safe: PersistedListingDetail = preserving
    ? {
      ...gated,
      image: prior!.image,
      photos: prior!.photos ?? [],
      photoCount: prior!.photos?.length ?? (prior!.image ? 1 : 0),
      events: prior!.events ?? [],
      sourceDescription: prior!.sourceDescription,
      // The retained evidence keeps the reconciliation that justified it; the
      // failed revisit is reported alongside rather than replacing it.
      reconciliation: prior!.reconciliation,
      limitation: `${detail.limitation ?? detail.reconciliation.note} Retained evidence from the earlier reconciled capture on ${prior!.capturedAtIso} is preserved.`,
      capturedAtIso: prior!.capturedAtIso,
    }
    : gated;

  const shouldSetThumb = !!safe.image?.url && safe.image.isOriginalListingImage;
  const stmt = shouldSetThumb
    ? db.prepare('UPDATE landos_comp SET listing_detail_json = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?')
    : db.prepare('UPDATE landos_comp SET listing_detail_json = ?, updated_at = ? WHERE id = ?');

  const nowSec = Math.floor(Date.now() / 1000);
  if (shouldSetThumb) stmt.run(JSON.stringify(safe), safe.image!.url, nowSec, detail.compId);
  else stmt.run(JSON.stringify(safe), nowSec, detail.compId);

  return {
    compId: detail.compId,
    persisted: true,
    thumbnailUpdated: shouldSetThumb,
    reason: preserving
      ? `revisit failed (${detail.limitation ?? detail.reconciliation.note}); previously reconciled evidence PRESERVED`
      : safe.reconciliation.matched
        ? (shouldSetThumb ? 'reconciled capture persisted with its listing image' : 'reconciled capture persisted; no genuine listing image was available on the page')
        : `capture recorded WITHOUT its image: ${safe.reconciliation.note}`,
  };
}

/** Parse a stored capture. Returns null for never-visited or corrupt rows. */
export function parseListingDetail(json: string | null | undefined): PersistedListingDetail | null {
  const raw = (json ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedListingDetail;
    if (!parsed || typeof parsed !== 'object') return null;
    // A capture written before the photo set existed carries only `image`. It is
    // still a reconciled genuine photograph, so it is lifted into a one-photo set
    // rather than being read as "this property has no photos".
    const photos = Array.isArray(parsed.photos) && parsed.photos.length
      ? parsed.photos
      : parsed.image
        ? [{
          url: parsed.image.url,
          sequence: 1,
          label: parsed.image.label,
          provenance: parsed.image.provenance,
          context: parsed.image.context,
          isOriginalListingImage: parsed.image.isOriginalListingImage,
        }]
        : [];
    return {
      ...parsed,
      photos,
      photoCount: photos.length,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      unusableRows: Array.isArray(parsed.unusableRows) ? parsed.unusableRows : [],
    };
  } catch {
    return null;
  }
}

export function loadCompListingDetail(compId: number): PersistedListingDetail | null {
  const db = getLandosDb();
  const row = db.prepare('SELECT listing_detail_json FROM landos_comp WHERE id = ?')
    .get(compId) as { listing_detail_json: string } | undefined;
  return parseListingDetail(row?.listing_detail_json);
}
