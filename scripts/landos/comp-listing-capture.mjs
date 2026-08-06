// LandOS — bounded comparable listing-detail capture.
//
// Revisits the EXACT retained provider page for each comparable on one deal and
// recovers three things the workspace was missing: the genuine listing image,
// the dated listing history, and the source property description. It does not
// search, it does not discover comps, and it never opens a page that is not
// already the retained source URL of a comparable.
//
// Usage:
//   node scripts/landos/comp-listing-capture.mjs --deal 81 [--only 925,926] [--limit 5] [--dry-run]
//
// Safety:
//   • Read-only in the browser. No clicks beyond dismissing an overlay, no forms,
//     no logins, no dialogs.
//   • Every task-created tab is closed before exit, including on failure.
//   • Nothing is persisted unless reconcileCaptureToComp() proves the page is the
//     same property as the comparable. A refused capture records the refusal.
//   • The CDP endpoint is the operator's already-authenticated Chrome; this
//     script never launches a browser and never touches the LandPortal session.

import puppeteer from 'puppeteer-core';
import Database from 'better-sqlite3';
import path from 'node:path';

import { selectListingImage, selectListingImages, normalizeListingEvents, unusableHistoryRows, reconcileCaptureToComp, rejectedImages }
  from '../../dist/landos/comp-listing-detail.js';
import { saveCompListingDetail } from '../../dist/landos/comp-listing-store.js';

const CDP = 'http://127.0.0.1:9224';
const NAV_TIMEOUT_MS = 60_000;

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dealId = Number(opt('--deal') ?? 81);
const only = (opt('--only') ?? '').split(',')
  .map((s) => s.trim()).filter(Boolean)
  .map(Number).filter(Number.isInteger);
const limit = Number(opt('--limit') ?? 0);
const dryRun = argv.includes('--dry-run');
// Providers rate-limit. The answer is to ask for less, not to disguise the ask:
// pages are spaced out, a blocked page gets ONE patient retry after a longer
// cooldown, and a page still blocked after that is recorded as blocked. No
// fingerprint spoofing, no proxying, no interstitial defeat.
const DELAY_MS = Number(opt('--delay') ?? 22_000);
const RETRY_COOLDOWN_MS = Number(opt('--cooldown') ?? 75_000);
// How long a page is given to finish rendering before it is read. Providers
// differ by a lot: Redfin is ready in seconds, Realtor.com shows a holding page
// first. Tunable so a slow provider can be given more patience without slowing
// the whole run.
const SETTLE_MS = Number(opt('--settle') ?? 7_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

const PROVIDER_OF = (sourceLabel) => {
  const s = String(sourceLabel ?? '').toLowerCase();
  if (s.startsWith('zillow')) return 'Zillow';
  if (s.startsWith('redfin')) return 'Redfin';
  if (s.startsWith('realtor')) return 'Realtor';
  if (s.startsWith('landportal')) return 'LandPortal';
  return null;
};

// ── In-page extraction ───────────────────────────────────────────────────────
// One provider-neutral reader. It prefers the page's own embedded structured
// data (which survives class-name churn) and falls back to visible DOM. It reads
// only; it never mutates the page.
/* c8 ignore start — runs inside the browser, not under vitest */
function readListingPage() {
  const out = {
    images: [], priceHistory: [], description: null, status: null,
    address: null, acresText: null, priceText: null, domText: null,
    apn: null, lat: null, lng: null, limitation: null, blocked: false,
  };
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  const PHOTO_HOSTS = /(photos\.zillowstatic\.com|maps\.zillowstatic\.com|ssl\.cdn-redfin\.com|cdn-redfin\.com|rdcpix\.com|images\.thelandportal\.com)/i;
  const JUNK = /(sprite|logo|favicon|placeholder|avatar|\.svg|badge|icon|staticmap|streetview|pixel\.gif|1x1\.)/i;

  // Bot-check / interstitial detection: recorded, never worked around.
  const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 4000);
  if (/press\s*(and|&)\s*hold|verify(ing)? you are (a )?human|unusual traffic|are you a robot|captcha|access to this page has been denied/i.test(bodyText)) {
    out.blocked = true;
    out.limitation = 'Provider served a bot-verification interstitial instead of the property page.';
  }

  // 1. Images, each tagged with WHERE on the page it came from.
  //
  // This is the difference between evidence and contamination. A vacant-land
  // page routinely carries no photo of the subject while rendering a "Recently
  // sold homes" carousel full of photographs of OTHER parcels — correct URL,
  // correct page, correct photo CDN, wrong property. So every candidate is
  // classified by its DOM ancestry and only the subject's own media survives.
  const OTHER_PROPERTY_CONTAINER = /homecard|home-card|similar|nearby|recommend|recently[-_ ]?sold|comparable|carousel|related|you[-_ ]?may|also[-_ ]?viewed|more[-_ ]?homes|listing[-_ ]?card|search[-_ ]?result/i;

  // COMPOUND names for this property's own media. These are tested BEFORE the
  // other-property test because the specific name has to beat the generic one:
  // a container literally called "photo carousel" is this property's carousel,
  // while the bare word "carousel" is also what a similar-homes rail is called.
  // Redfin renders its gallery as SixPhotoGridSlide__* inside a
  // ScrollSnapCarousel__track, so without this the entire gallery was refused
  // as "another property" and a 21-photo listing surfaced one photograph.
  const OWN_MEDIA_STRONG = /photo[-_ ]?grid|photo[-_ ]?slide|photo[-_ ]?carousel|photo[-_ ]?browser|photo[-_ ]?preview|photo[-_ ]?strip|photo[-_ ]?gallery|photo[-_ ]?viewer|media[-_ ]?browser|media[-_ ]?stream|mediastream|hdp[-_ ]?photo|image[-_ ]?viewer|lightbox/i;
  // Weaker single words, only trusted when nothing else on the same element says
  // the image belongs to a different property.
  const OWN_MEDIA_CONTAINER = /gallery|hero|primary[-_ ]?photo|main[-_ ]?photo/i;

  const classify = (el) => {
    // Walk up the DOM. The NEAREST meaningful container wins: a gallery nested
    // inside a page wrapper is still a gallery, and an <img> inside a home card
    // is another property's even if that card sits inside a "photos" section.
    let node = el;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      const sig = `${node.className || ''} ${node.id || ''} ${node.getAttribute ? (node.getAttribute('data-testid') || '') : ''}`;
      if (!sig.trim()) continue;
      if (OWN_MEDIA_STRONG.test(sig)) return { context: 'gallery', container: sig.trim().slice(0, 80) };
      if (OTHER_PROPERTY_CONTAINER.test(sig)) return { context: 'other_property_card', container: sig.trim().slice(0, 80) };
      if (OWN_MEDIA_CONTAINER.test(sig)) return { context: 'gallery', container: sig.trim().slice(0, 80) };
    }
    return { context: 'unknown', container: null };
  };

  const seen = new Set();
  const push = (u, context, container) => {
    if (!u || typeof u !== 'string') return;
    const clean = u.split(' ')[0].trim();
    if (!/^https:\/\//i.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    if (JUNK.test(clean) || !PHOTO_HOSTS.test(clean)) {
      out.images.push({ url: clean, context: 'page_furniture', container });
      return;
    }
    out.images.push({ url: clean, context, container });
  };

  // og:image is the page's declared primary image — but only when it is real
  // property photography. Redfin serves its own rocket logo there for a parcel
  // with no photos, which must never become a "listing photo".
  const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
  if (og) push(og.getAttribute('content'), 'hero', 'meta og:image');

  for (const img of Array.from(document.querySelectorAll('img'))) {
    const { context, container } = classify(img);
    push(img.getAttribute('src'), context, container);
    const srcset = img.getAttribute('srcset');
    if (srcset) for (const part of srcset.split(',')) push(part.trim(), context, container);
  }
  for (const src of Array.from(document.querySelectorAll('source[srcset]'))) {
    const { context, container } = classify(src);
    const ss = src.getAttribute('srcset');
    if (ss) for (const part of ss.split(',')) push(part.trim(), context, container);
  }

  // 2. Embedded structured data: deep-walk inline JSON for the fields we need.
  const jsonBlobs = [];
  for (const s of Array.from(document.querySelectorAll('script'))) {
    const t = s.textContent || '';
    if (t.length < 40 || t.length > 4_000_000) continue;
    const type = (s.getAttribute('type') || '').toLowerCase();
    if (type.includes('json')) { jsonBlobs.push(t); continue; }
    const m = /(\{[\s\S]*\})/.exec(t);
    if (m && /"(priceHistory|propertyHistory|homeInsights|description|latitude)"/.test(t)) jsonBlobs.push(m[1]);
  }
  const parsed = [];
  for (const blob of jsonBlobs) {
    try { parsed.push(JSON.parse(blob)); } catch { /* embedded fragment, skip */ }
  }
  // Embedded JSON has no DOM position, so an image found there is trusted ONLY
  // when the key path names the subject's own photo collection. Anything else is
  // 'unknown' and therefore refused — a page's JSON payload also carries the
  // similar-homes carousel it renders.
  const SUBJECT_PHOTO_KEY = /^(responsivephotos|hugephotos|photos|galleryphotos|mediaphotos|listingphotos|images|photolist|smallphotos|mixedsourcesphotos)$/;
  const visit = (node, depth, photoScope) => {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) { for (const v of node) visit(v, depth + 1, photoScope); return; }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      const scope = photoScope || SUBJECT_PHOTO_KEY.test(key);
      if (typeof v === 'string') {
        if (PHOTO_HOSTS.test(v) && !JUNK.test(v)) push(v, scope ? 'gallery' : 'unknown', `json:${k}`);
        if (!out.description && (key === 'description' || key === 'marketingremarks' || key === 'publicremarks' || key === 'remarks') && v.length > 60) {
          out.description = v.replace(/\s+/g, ' ').trim();
        }
        if (!out.apn && (key === 'parcelnumber' || key === 'apn' || key === 'parcelid')) out.apn = v;
        if (!out.status && (key === 'homestatus' || key === 'mlsstatus' || key === 'status') && v.length < 40) out.status = v;
      }
      if (typeof v === 'number') {
        if (!out.lat && (key === 'latitude' || key === 'lat') && Math.abs(v) <= 90 && v !== 0) out.lat = v;
        if (!out.lng && (key === 'longitude' || key === 'lng' || key === 'lon') && Math.abs(v) <= 180 && v !== 0) out.lng = v;
      }
      if (Array.isArray(v) && (key === 'pricehistory' || key === 'propertyhistory' || key === 'events')) {
        for (const row of v) {
          if (!row || typeof row !== 'object') continue;
          const dateText = String(row.date ?? row.eventDate ?? row.dateText ?? row.time ?? '').trim();
          const eventText = String(row.event ?? row.eventName ?? row.eventDescription ?? row.priceChangeReason ?? '').trim();
          const priceRaw = row.price ?? row.priceValue ?? row.listingPrice ?? null;
          const priceText = priceRaw == null ? '' : (typeof priceRaw === 'number' ? `$${priceRaw}` : String(priceRaw));
          if (dateText && eventText) out.priceHistory.push({ dateText, eventText, priceText });
        }
      }
      visit(v, depth + 1, scope);
    }
  };
  for (const p of parsed) visit(p, 0, false);

  // 3. Visible DOM history tables, when the page did not embed the data.
  if (out.priceHistory.length === 0) {
    const HISTORY_SCOPES = [
      '#property-history-transition-node', '[data-testid="property-history"]',
      '[data-rf-test-id="propertyHistory"]', '[id*="price-history" i]',
      '[class*="price-history" i]', '[class*="PriceHistory" i]',
    ];
    for (const scope of HISTORY_SCOPES) {
      const root = document.querySelector(scope);
      if (!root) continue;
      for (const tr of Array.from(root.querySelectorAll('tr'))) {
        const cells = Array.from(tr.querySelectorAll('td, th')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
        if (cells.length < 2) continue;
        const dateText = cells.find((c) => /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/.test(c)) || '';
        const priceText = cells.find((c) => /\$[\d,]+/.test(c)) || '';
        const eventText = cells.find((c) => c && c !== dateText && c !== priceText && /[A-Za-z]{4,}/.test(c)) || '';
        if (dateText && eventText) out.priceHistory.push({ dateText, eventText, priceText });
      }
      if (out.priceHistory.length) break;
    }
  }

  // 4. Visible identity fields.
  out.address = text('[data-testid="address"]') || text('h1[class*="address" i]') || text('h1')
    || (document.querySelector('meta[property="og:title"]') || {}).content || null;
  if (!out.description) {
    out.description = text('[data-testid="description"]') || text('#marketing-remarks-scroll')
      || text('[data-testid="description-text"]') || text('[class*="remarks" i]')
      || text('[data-rf-test-id="abouthis-home"]') || null;
  }
  // Platform-written summaries ("About this home", "What's special") are still
  // the source's own description of the property. They are captured and
  // attributed to the platform — never rewritten, never upgraded to fact.
  if (!out.description) {
    const m = /(?:About this home|What'?s special)\s*\n([\s\S]{60,1400}?)(?:\n(?:Property Type|Vacant land|Lot Size|Price\/Ac|Redfin Estimate|Home value|Facts|Listing Provided|Source:)|$)/.exec(bodyText);
    if (m) out.description = m[1].replace(/\s+/g, ' ').trim();
  }
  const body = bodyText;
  const acres = /([\d,]+(?:\.\d+)?)\s*(?:Acres|acres|ac\b)/.exec(body);
  if (acres) out.acresText = `${acres[1]} acres`;
  const price = /\$[\d,]{4,}/.exec(body);
  if (price) out.priceText = price[0];
  const dom = /(\d+)\s*days?\s*on\s*(Zillow|Redfin|realtor|market)/i.exec(body);
  if (dom) out.domText = dom[0];
  // Realtor.com answers automation with a holding page rather than a hard bot
  // wall. Its <h1> becomes the holding message, which is how it is told apart
  // from a real property page: the page never names the property. Recorded as a
  // gate rather than as "this listing has no photos", because those two facts
  // would lead an operator to opposite conclusions about the parcel.
  if (!out.blocked && /^\s*(this is taking longer than usual|just a moment|checking your browser|loading)/i.test(out.address || '')) {
    out.blocked = true;
    out.limitation = 'Provider served a loading gate instead of the property page.';
  }

  const ownMedia = out.images.filter((i) => i.context === 'hero' || i.context === 'gallery');
  if (!ownMedia.length && !out.limitation) {
    out.limitation = out.images.length
      ? `The property page exposed no photograph of THIS property. ${out.images.length} image(s) were present but belong to other properties on the page, to site chrome, or to an unestablished position.`
      : 'The property page exposed no image on a recognised provider photo CDN.';
  }
  return out;
}
/* c8 ignore stop */

// ── Runner ───────────────────────────────────────────────────────────────────

const summary = {
  deal: dealId, startedAt: nowIso(), visited: 0,
  imagesRecovered: { Zillow: 0, Redfin: 0, Realtor: 0, LandPortal: 0 },
  recordsWithPhotos: 0, recordsWithMultiplePhotos: 0, photosPersisted: 0,
  historyRecovered: 0, descriptionsRecovered: 0,
  refused: [], failures: [], blocked: [], rows: [],
};

let browser = null;
const openedTargets = new Set();

async function main() {
  const db = new Database(path.resolve('store/landos.db'), { readonly: true });
  let comps = db.prepare(`
    SELECT id, source_label, source_url, address_desc, apn, acres, price, price_kind, lat, lng
    FROM landos_comp WHERE deal_card_id = ? AND source_url <> '' ORDER BY id
  `).all(dealId);
  db.close();
  if (only.length) comps = comps.filter((c) => only.includes(c.id));
  if (limit > 0) comps = comps.slice(0, limit);
  console.log(`[capture] deal ${dealId}: ${comps.length} retained provider pages to revisit`);

  browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });

  for (const comp of comps) {
    const provider = PROVIDER_OF(comp.source_label);
    if (!provider) {
      summary.failures.push({ id: comp.id, provider: comp.source_label, error: 'unrecognised provider' });
      continue;
    }
    try {
      let raw = await visit(comp.source_url);
      if (raw.blocked) {
        console.log(`[capture] ${comp.id} ${provider} — blocked; cooling down ${Math.round(RETRY_COOLDOWN_MS / 1000)}s for one patient retry`);
        await sleep(RETRY_COOLDOWN_MS);
        raw = await visit(comp.source_url);
      }

      const capture = {
        provider,
        sourceUrl: comp.source_url,
        capturedAtIso: nowIso(),
        images: raw.images ?? [],
        priceHistory: raw.priceHistory ?? [],
        description: raw.description,
        status: raw.status,
        address: raw.address,
        acresText: raw.acresText,
        priceText: raw.priceText,
        domText: raw.domText,
        apn: raw.apn,
        lat: raw.lat,
        lng: raw.lng,
        limitation: raw.limitation,
      };

      const reconciliation = reconcileCaptureToComp(capture, {
        address: comp.address_desc || null,
        apn: comp.apn || null,
        acres: comp.acres,
        price: comp.price,
        lat: comp.lat,
        lng: comp.lng,
        sourceUrl: comp.source_url,
      });

      const image = reconciliation.matched ? selectListingImage(capture) : null;
      // The full gallery, not just the hero. A land page that publishes twelve
      // photographs is publishing twelve pieces of comparability evidence.
      const photos = reconciliation.matched ? selectListingImages(capture) : [];
      const events = reconciliation.matched ? normalizeListingEvents(capture) : [];

      const detail = {
        compId: comp.id,
        provider,
        sourceUrl: comp.source_url,
        capturedAtIso: capture.capturedAtIso,
        image: image
          ? {
            url: image.url,
            label: image.label,
            provenance: image.provenance,
            tier: image.tier,
            context: image.context,
            isOriginalListingImage: true,
            sourceProperty: capture.address ?? comp.address_desc ?? null,
            reconciledOn: reconciliation.matchedOn,
          }
          : null,
        photos: photos.map((p) => ({
          url: p.url,
          sequence: p.sequence,
          label: p.label,
          provenance: p.provenance,
          context: p.context,
          isOriginalListingImage: true,
        })),
        photoCount: photos.length,
        events,
        unusableRows: unusableHistoryRows(capture),
        refusedImages: rejectedImages(capture),
        sourceDescription: reconciliation.matched ? capture.description : null,
        status: capture.status,
        limitation: capture.limitation,
        reconciliation,
      };

      summary.visited += 1;
      if (raw.blocked) summary.blocked.push({ id: comp.id, provider, note: capture.limitation });
      if (image) summary.imagesRecovered[provider] += 1;
      if (photos.length) {
        summary.recordsWithPhotos += 1;
        summary.photosPersisted += photos.length;
        if (photos.length > 1) summary.recordsWithMultiplePhotos += 1;
      }
      if (events.length) summary.historyRecovered += 1;
      if (detail.sourceDescription) summary.descriptionsRecovered += 1;
      if (!reconciliation.matched) summary.refused.push({ id: comp.id, note: reconciliation.note });

      summary.rows.push({
        id: comp.id, provider, address: comp.address_desc,
        image: image ? image.label : null, photos: photos.length, events: events.length,
        description: !!detail.sourceDescription, matched: reconciliation.matched,
        limitation: capture.limitation,
      });

      if (!dryRun) {
        const w = saveCompListingDetail(detail);
        console.log(`[capture] ${comp.id} ${provider} — ${w.reason}${image ? ` (${image.label}, ${image.tier})` : ''}${photos.length ? `, ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}${events.length ? `, ${events.length} history events` : ''}`);
      } else {
        console.log(`[dry-run] ${comp.id} ${provider} — image=${image ? image.label : 'none'} photos=${photos.length} events=${events.length} matched=${reconciliation.matched}`);
      }
    } catch (err) {
      summary.failures.push({ id: comp.id, provider, error: String(err && err.message ? err.message : err) });
      console.log(`[capture] ${comp.id} ${provider} — FAILED: ${err && err.message ? err.message : err}`);
    }
    await sleep(DELAY_MS);
  }
}

/**
 * Open a tab WITHOUT taking over the operator's screen.
 *
 * `browser.newPage()` creates a foreground tab: Chrome switches to it, and a
 * run over thirty comparables would yank the operator's browser away from
 * whatever they were doing thirty times. `Target.createTarget` with
 * `background: true` creates the same tab without activating it, so the page
 * still loads, still runs scripts, still lazy-loads images, and the operator
 * never sees it. Nothing here calls `bringToFront()`.
 */
async function openBackgroundPage(url) {
  const cdp = await browser.target().createCDPSession();
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url, background: true });
    const target = await browser.waitForTarget((t) => t._targetId === targetId || t.url() === url, { timeout: NAV_TIMEOUT_MS });
    const page = await target.page();
    if (!page) throw new Error('background target did not expose a page');
    return page;
  } finally {
    try { await cdp.detach(); } catch { /* session already gone */ }
  }
}

/**
 * One paced, read-only page visit in a BACKGROUND tab. The tab is always closed
 * before returning, including on failure.
 *
 * Provider galleries lazy-load: the photographs below the fold are not in the
 * DOM until the page has been scrolled. So the visit performs a bounded,
 * scripted scroll — no clicks, no lightbox, no interaction with the operator's
 * input — and then reads. Without it a twelve-photo listing reads as a
 * one-photo listing purely because the rest never rendered.
 */
async function visit(url) {
  let page = null;
  try {
    page = await openBackgroundPage(url);
    openedTargets.add(url);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    // createTarget already navigated; wait for the document rather than re-navigating.
    await page.waitForFunction('document.readyState === "interactive" || document.readyState === "complete"', { timeout: NAV_TIMEOUT_MS })
      .catch(() => { /* slow page; the settle below still gives it time */ });
    await sleep(SETTLE_MS);
    await page.evaluate(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.9));
      for (let y = 0; y < 6000; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 350));
      }
      window.scrollTo(0, 0);
    }).catch(() => { /* a blocked interstitial has nothing to scroll */ });
    await sleep(1_500);
    return await page.evaluate(readListingPage);
  } finally {
    if (page) { try { await page.close(); } catch { /* already gone */ } }
  }
}

main()
  .then(() => {
    summary.finishedAt = nowIso();
    console.log('\n[capture] SUMMARY');
    console.log(JSON.stringify({
      visited: summary.visited,
      imagesRecovered: summary.imagesRecovered,
      recordsWithPhotos: summary.recordsWithPhotos,
      recordsWithMultiplePhotos: summary.recordsWithMultiplePhotos,
      photosPersisted: summary.photosPersisted,
      historyRecovered: summary.historyRecovered,
      descriptionsRecovered: summary.descriptionsRecovered,
      refusedCount: summary.refused.length,
      blockedCount: summary.blocked.length,
      failureCount: summary.failures.length,
    }, null, 2));
    if (summary.blocked.length) console.log('[capture] provider-blocked:', JSON.stringify(summary.blocked, null, 2));
    if (summary.refused.length) console.log('[capture] refused:', JSON.stringify(summary.refused, null, 2));
    if (summary.failures.length) console.log('[capture] failures:', JSON.stringify(summary.failures, null, 2));
  })
  .catch((err) => { console.error('[capture] fatal:', err); process.exitCode = 1; })
  .finally(async () => { if (browser) { try { await browser.disconnect(); } catch { /* noop */ } } });
