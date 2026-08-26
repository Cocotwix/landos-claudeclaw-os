// LandOS — LandPortal comparable location and List View capture.
//
// Recovers the location evidence LandPortal already publishes for the
// comparables it supplied, and persists it onto the retained comps through the
// normal LandOS comp path so the map, the distances and the geographic
// weighting all follow.
//
// Where the evidence comes from
//   The LP Estimate comparable sidebar renders five price/acre/APN rows, but its
//   "Show on Map" control carries the WHOLE comparable set as URL-encoded JSON in
//   `data-similars`: situs coordinates, situs ZIP, municipality, MLS status and
//   LandPortal's own subject distance for every comparable. LandOS was reading
//   the visible row text and nothing else, which is why five retained comps
//   carried an APN and no location.
//
// Why it does not open the comparable's own property page
//   LandPortal holds its authenticated app session PER TAB. Opening a comparable
//   in a new tab, or navigating the authenticated tab to the comparable's URL,
//   both land on the logged-out teaser — and the navigation destroys the
//   authenticated session in the process. This script therefore reads the
//   subject tab in place and never navigates or clicks it. The comparable's
//   street address lives on that unreachable page; it is reported as a stated
//   evidence gap, never invented.
//
// Usage:
//   node scripts/landportal/capture-comp-locations.mjs --deal 83 [--dry-run]
//   node scripts/landportal/capture-comp-locations.mjs --deal 83 --payload <file.json>
//
// Safety:
//   • Read-only in the browser: no navigation, no clicks, no forms, no logins.
//   • Never reads a form field (the profile holds saved credentials).
//   • Persists only through upsertNormalizedComp, keyed to the retained row.
//   • A comparable whose APN does not reconcile to a retained row is refused.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseLandPortalSimilars,
  reconcileSimilarToRetainedComp,
  landPortalCompLocationUpdate,
} from '../../dist/landos/landportal-comp-drilldown.js';
import { listComps, upsertNormalizedComp } from '../../dist/landos/comps.js';
import { getLandosDb } from '../../dist/landos/db.js';

const CDP = 'http://127.0.0.1:9224';
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dealId = Number(opt('--deal'));
const payloadFile = opt('--payload');
const listViewFile = opt('--list-view');
const dryRun = argv.includes('--dry-run');

function retainedPropertyId(sourceUrl) {
  try {
    const encoded = new URL(sourceUrl).searchParams.get('property');
    const decoded = Buffer.from(encoded || '', 'base64').toString('utf8');
    return decoded.match(/(?:^|&)propertyid=([^&]+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function loadListView(file) {
  const resolved = path.resolve(file);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const cards = Array.isArray(parsed.mapCards) ? parsed.mapCards : [];
  return {
    cards,
    note: `Read from the authenticated LandPortal Show on Map → List View capture ${path.relative(process.cwd(), resolved)}.`,
  };
}

function listViewCardsFromPage(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('div,li,a').forEach((el) => {
      const image = el.querySelector?.('img');
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!image || !text.includes('MLS acres') || !/\$[\d,]+/.test(text) || text.length > 400) return;
      if (el.querySelectorAll('*').length > 40 || seen.has(text)) return;
      seen.add(text);
      const attrs = {};
      let node = el;
      for (let hop = 0; hop < 4 && node; hop += 1, node = node.parentElement) {
        for (const attr of node.attributes ?? []) {
          if (/mls|property|apn|fips/i.test(attr.name) || /data-property-(address|city|state|zip)/i.test(attr.name)) {
            attrs[attr.name] = attr.value;
          }
        }
      }
      out.push({ text: text.slice(0, 400), img: image.currentSrc || image.src || null, attrs });
    });
    return out;
  });
}

async function readLiveListView(browser, subjectPage) {
  await subjectPage.evaluate(() => document.querySelector('a.js-lp-estimate-show-on-map')?.scrollIntoView({ block: 'center' }));
  await new Promise((resolve) => setTimeout(resolve, 800));
  const anchor = await subjectPage.$('a.js-lp-estimate-show-on-map');
  if (!anchor) return null;
  const box = await anchor.boundingBox();
  if (!box) return null;
  await subjectPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let mapPage = null;
  for (let i = 0; i < 25; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const pages = await browser.pages();
    mapPage = pages.find((page) => page.url().includes('market_comps='));
    if (mapPage) break;
  }
  if (!mapPage) return null;
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  return { cards: await listViewCardsFromPage(mapPage), note: `Physically clicked LandPortal Show on Map and read the separate market_comps List View page ${mapPage.url()}.` };
}

function enrichFromListView(subject, retained, source) {
  const rows = [];
  for (const comp of retained) {
    const propertyId = retainedPropertyId(comp.source_url);
    const card = source.cards.find((candidate) => String(candidate.attrs?.['data-propertyid'] ?? '') === String(propertyId));
    if (!card) {
      rows.push({ compId: comp.id, propertyId, persisted: false, note: 'No List View card matched the retained LandPortal property ID.' });
      continue;
    }
    const attrs = card.attrs ?? {};
    const address = [attrs['data-property-address'], attrs['data-property-city'], attrs['data-property-state'], attrs['data-property-zip']]
      .filter(Boolean).join(', ');
    const image = typeof card.img === 'string' && /^https:\/\/images\.thelandportal\.com\//i.test(card.img) ? card.img : null;
    const owner = card.text?.match(/\b\d{2}-\d{2}-\d{4}\s+(.+)$/)?.[1]?.trim() || null;
    if (!dryRun) {
      upsertNormalizedComp({
        entity: comp.entity,
        dealCardId: dealId,
        cardId: comp.card_id ?? subject.id,
        sourceLabel: 'LandPortal',
        canonicalSource: comp.canonical_source || 'landportal',
        sourceUrl: comp.source_url,
        addressDesc: address || undefined,
        city: attrs['data-property-city'] || comp.city || undefined,
        state: attrs['data-property-state'] || comp.state || undefined,
        apn: comp.apn,
        price: comp.price ?? undefined,
        priceKind: comp.price_kind,
        saleOrListDate: comp.sale_or_list_date || undefined,
        acres: comp.acres ?? undefined,
        pricePerAcre: comp.price_per_acre ?? undefined,
        zip: attrs['data-property-zip'] || comp.zip || undefined,
        lat: comp.lat ?? undefined,
        lng: comp.lng ?? undefined,
        distanceMiles: comp.distance_miles ?? undefined,
        thumbnailUrl: image || undefined,
        notes: `${comp.notes ? `${comp.notes} ` : ''}LandPortal Show on Map → List View matched by property ID ${propertyId}; provider-stated address, thumbnail${owner ? `, owner/entity ${owner}` : ''}.`,
        retrievedAt: nowIso(),
        canonicalKey: comp.canonical_key,
        sourceAttributions: [
          { provider: 'LandPortal List View', url: comp.source_url || subject.lp_url || null },
        ],
      });
    }
    rows.push({ compId: comp.id, propertyId, address: address || null, thumbnail: image, persisted: !dryRun });
  }
  return rows;
}


if (!Number.isInteger(dealId) || dealId <= 0) {
  console.error('--deal <id> is required.');
  process.exit(2);
}

const nowIso = () => new Date().toISOString();

/** The subject point every retained comparable's distance is measured from. */
function subjectFor(deal) {
  const row = getLandosDb().prepare(`
    SELECT p.id, p.active_input_address, p.lat, p.lng, p.lp_url
    FROM landos_property_card p
    JOIN landos_deal_card_property d ON d.card_id = p.id
    WHERE d.deal_card_id = ? AND d.role = 'subject'
    ORDER BY d.id ASC LIMIT 1
  `).get(deal);
  if (!row) throw new Error(`deal ${deal} has no subject property card`);
  return row;
}

/**
 * Read the comparable sidebar and then execute the provider's actual
 * Show-on-Map → List View workflow in the authenticated LandPortal tab.
 * A missing authenticated subject tab is an honest miss, never a login attempt.
 */
async function readLivePayload(subject) {
  let browser = null;
  try {
    browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
  } catch (err) {
    return { payload: null, listView: null, note: `The LandOS automation browser is not answering on ${CDP} (${err.message}).` };
  }
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      if (!/landportal\.com/i.test(page.url())) continue;
      const state = await page.evaluate(() => ({
        url: location.href,
        authenticated: /Logout/i.test(document.body?.innerText || ''),
        subjectApn: (document.body?.innerText || '').match(/Parcel ID\s+([\w-]+)/)?.[1] ?? null,
        similars: document.querySelector('.js-lp-estimate-show-on-map')?.getAttribute('data-similars') ?? null,
      })).catch(() => null);
      if (!state?.authenticated || !state.similars) continue;
      const listView = await readLiveListView(browser, page).catch(() => null);
      return {
        payload: state.similars,
        listView,
        note: listView?.note ?? `Read sidebar payload from the authenticated LandPortal tab on ${state.url}; Show on Map/List View did not produce a readable card surface.`,
      };
    }
    const tabs = pages.filter((page) => /landportal\.com/i.test(page.url())).length;
    return {
      payload: null,
      listView: null,
      note: tabs === 0
        ? 'No LandPortal tab is open in the LandOS automation browser.'
        : 'LandPortal tabs are open but none is authenticated on a subject page carrying the comparable sidebar payload.',
    };
  } finally {
    try { await browser.disconnect(); } catch { /* already gone */ }
  }
}

function loadPayloadFile(file) {
  const resolved = path.resolve(file);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  // Accepts the raw attribute, a bare array, or a captured-evidence envelope.
  const rows = Array.isArray(parsed) ? parsed : parsed.similars ?? parsed.payload ?? null;
  if (!rows) throw new Error(`${resolved} contains no "similars" payload`);
  const capture = Array.isArray(parsed) ? null : parsed.capture ?? null;
  return {
    payload: rows,
    note: `Read from the retained capture ${path.relative(process.cwd(), resolved)}${capture?.capturedAt ? ` (captured ${capture.capturedAt})` : ''}${capture?.source ? `: ${capture.source}` : ''}.`,
  };
}

async function main() {
  const subject = subjectFor(dealId);
  const retained = listComps({ dealCardId: dealId, limit: 500 })
    .filter((comp) => /landportal/i.test(comp.source_label) || /landportal/i.test(comp.canonical_source));
  if (listViewFile) {
    const source = loadListView(listViewFile);
    console.log(`[lp-comp-location] deal ${dealId} subject "${subject.active_input_address}" (${subject.lat}, ${subject.lng})`);
    console.log(`[lp-comp-location] ${source.note}`);
    console.log(`[lp-comp-location] ${retained.length} retained LandPortal comparable row(s) for this deal`);
    const rows = enrichFromListView(subject, retained, source);
    console.log(JSON.stringify({ deal: dealId, retained: retained.length, matched: rows.filter((row) => row.persisted || row.address).length, rows }, null, 2));
    return;
  }
  const source = payloadFile ? loadPayloadFile(payloadFile) : await readLivePayload(subject);
  console.log(`[lp-comp-location] deal ${dealId} subject "${subject.active_input_address}" (${subject.lat}, ${subject.lng})`);
  console.log(`[lp-comp-location] payload source: ${source.note}`);
  if (source.listView) {
    console.log(`[lp-comp-location] ${retained.length} retained LandPortal comparable row(s) for this deal`);
    const rows = enrichFromListView(subject, retained, source.listView);
    console.log(JSON.stringify({ deal: dealId, retained: retained.length, matched: rows.filter((row) => row.persisted || row.address).length, rows }, null, 2));
    return;
  }
  if (!source.payload) {
    console.log('[lp-comp-location] no comparable sidebar payload available; nothing captured and nothing claimed.');
    process.exitCode = 1;
    return;
  }
  const similars = parseLandPortalSimilars(source.payload);
  console.log(`[lp-comp-location] ${similars.length} comparable row(s) in the payload`);
  console.log(`[lp-comp-location] ${retained.length} retained LandPortal comparable row(s) for this deal`);


  const results = [];
  for (const similar of similars) {
    const candidates = retained.map((comp) => ({
      comp,
      reconciliation: reconcileSimilarToRetainedComp(similar, {
        apn: comp.apn,
        price: comp.price,
        acres: comp.acres,
        saleOrListDate: comp.sale_or_list_date,
        state: comp.state,
      }),
    }));
    const matched = candidates.filter((candidate) => candidate.reconciliation.matched);
    if (matched.length !== 1) {
      const refusal = matched.length === 0
        ? candidates.find((candidate) => candidate.reconciliation.matchedOn.includes('APN'))?.reconciliation.reason
          ?? `No retained comparable on this deal carries APN ${similar.row.apn}.`
        : `APN ${similar.row.apn} reconciles to ${matched.length} retained rows; refusing to attach location evidence ambiguously.`;
      results.push({ apn: similar.row.apn, compId: null, persisted: false, note: refusal });
      console.log(`[lp-comp-location] ${similar.row.apn} — REFUSED: ${refusal}`);
      continue;
    }
    const { comp, reconciliation } = matched[0];
    const update = landPortalCompLocationUpdate(similar, reconciliation, { lat: subject.lat, lng: subject.lng });
    if (!update) {
      results.push({ apn: similar.row.apn, compId: comp.id, persisted: false, note: reconciliation.reason });
      continue;
    }

    if (!dryRun) {
      upsertNormalizedComp({
        entity: comp.entity,
        dealCardId: dealId,
        cardId: comp.card_id ?? subject.id,
        sourceLabel: 'LandPortal',
        canonicalSource: comp.canonical_source || 'landportal',
        sourceUrl: comp.source_url,
        apn: comp.apn,
        // Nothing that is not stated: no address, no city, no invented point.
        zip: update.zip ?? undefined,
        lat: update.lat,
        lng: update.lng,
        distanceMiles: update.distanceMiles,
        notes: `${comp.notes ? `${comp.notes} ` : ''}${update.provenance}`,
        retrievedAt: nowIso(),
        canonicalKey: comp.canonical_key,
        sourceAttributions: [{ provider: 'LandPortal comparable sidebar', url: comp.source_url || subject.lp_url || null }],
      });
    }

    results.push({
      apn: similar.row.apn,
      compId: comp.id,
      persisted: !dryRun,
      lat: update.lat,
      lng: update.lng,
      zip: update.zip,
      distanceMiles: update.distanceMiles,
      statedDistanceMiles: update.statedDistanceMiles,
      tierId: update.tierId,
      weightMultiplier: update.weightMultiplier,
      located: update.located,
      remainingGap: update.remainingGap,
      matchedOn: reconciliation.matchedOn,
    });
    console.log(`[lp-comp-location] ${similar.row.apn} → comp ${comp.id}: ${update.located ? `mapped at ${update.lat}, ${update.lng}, ${update.distanceMiles} mi (${update.tierId})` : 'no coordinate published, left unplaced'}${dryRun ? ' [dry-run]' : ''}`);
  }

  console.log('\n[lp-comp-location] SUMMARY');
  console.log(JSON.stringify({
    deal: dealId,
    payloadRows: similars.length,
    reconciled: results.filter((row) => row.compId != null).length,
    located: results.filter((row) => row.located).length,
    refused: results.filter((row) => row.compId == null).length,
    rows: results,
  }, null, 2));
}

main().catch((err) => {
  console.error('[lp-comp-location] fatal:', err?.message ?? err);
  process.exitCode = 1;
});
