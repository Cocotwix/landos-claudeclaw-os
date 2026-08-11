// LandOS — LandPortal directional trial runner (PROVEN LIVE 2026-07-30 on Deals 66/68).
// Selector/interaction contract: src/landos/landportal-live-controls.ts (the tracked catalog).
// Attaches to the paired Chrome CDP endpoint; read-only on LandPortal; never touches
// paid controls (Reports / Skip Trace / Export / Buy tokens).
// Usage: node scripts/landportal/trial-runner.mjs <cmd> [args...]
// Commands:
//   search-address "<full address>" <outJson>
//   search-apn "<apn>" "<state name>" "<county name>" <outJson>
//   sidebar <outJson>                      (parcel tab must be open)
//   aerials <outJson>                      (close/clean/wider, north-up)
//   frontage <rotateDeg> <zoomIn> <outJson>
//   overlays <outJson>                     (wetlands, soil, contours; sha-gated)
//   threed <frontDeg> <outJson>            (front + rear via right-drag)
//   comps <outJson>                        (sidebar cards + Show on Map + thumbnails)
//   market <stateAbbr> <fips> <zip> <outJson>  (Drill Deep: all bands + county + zip row)
//   zipshot <fips> <zip> <outJson>         (ONE fixed-timeout ZIP screenshot attempt)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SHOTS = 'store/browser-shots';
const CDP = 'http://127.0.0.1:9224';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(SHOTS, f))).digest('hex');
fs.mkdirSync(SHOTS, { recursive: true });

const [cmd, ...args] = process.argv.slice(2);
const outPath = args[args.length - 1];
const writeOut = (o) => { fs.writeFileSync(outPath, JSON.stringify(o, null, 2)); console.log('OUT', outPath); };

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 180000, defaultViewport: null });
async function pageFor(urlPart, create = null) {
  let p = (await browser.pages()).find(x => x.url().includes(urlPart));
  if (!p && create) {
    p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 950 });
    await p.goto(create, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(7000);
    return p;
  }
  if (!p) throw new Error('no tab matching ' + urlPart);
  await p.setViewport({ width: 1600, height: 950 });
  await p.bringToFront().catch(() => {});
  await sleep(1000);
  return p;
}
const realClick = async (page, sel) => {
  const el = await page.$(sel);
  if (!el) return false;
  const bb = await el.boundingBox();
  if (!bb) return false;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  return true;
};

// ── map capture (proven) ────────────────────────────────────────────────────
async function captureMap(page, label) {
  await page.evaluate(() => {
    document.querySelectorAll('button,[role=button],.mapboxgl-ctrl-group,[class*="intelligence" i]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.width > 240 || r.height > 700) return;
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const c = canvas.getBoundingClientRect();
      if (r.left >= c.left && r.top >= c.top - 60) { el.setAttribute('data-trial-hidden', '1'); el.style.setProperty('visibility', 'hidden', 'important'); }
    });
    Array.from(document.querySelectorAll('body *')).filter(el =>
      /^LP Intelligence$/i.test((el.textContent || '').trim()) && el.children.length < 3
    ).forEach(el => { el.setAttribute('data-trial-hidden', '1'); el.style.setProperty('visibility', 'hidden', 'important'); });
  });
  await sleep(600);
  const clip = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('canvas')).map(el => ({ r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width >= 600 && r.height >= 400)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    if (!cs.length) return null;
    const r = cs[0].r;
    return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)),
      width: Math.min(window.innerWidth - Math.max(0, Math.floor(r.left)), Math.floor(r.width)) - 40,
      height: Math.min(window.innerHeight - Math.max(0, Math.floor(r.top)), Math.floor(r.height)) };
  });
  if (!clip) throw new Error('no map canvas');
  const file = `browseruse_${label}-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, file), clip });
  await page.evaluate(() => document.querySelectorAll('[data-trial-hidden]').forEach(el => { el.style.removeProperty('visibility'); el.removeAttribute('data-trial-hidden'); }));
  return { file, bytes: fs.statSync(path.join(SHOTS, file)).size, capturedAt: nowIso() };
}
const focusCanvas = (page) => page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return false; c.setAttribute('tabindex', '0'); c.focus(); return document.activeElement === c; });
async function zoomSteps(page, n) {
  await focusCanvas(page);
  for (let i = 0; i < Math.abs(n); i++) { await page.keyboard.press(n > 0 ? '=' : '-'); await sleep(900); }
}
async function rotateDrag(page, px) { // right-button horizontal drag (proven for 3D rear)
  const clip = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const cx = clip.x + clip.w / 2, cy = clip.y + clip.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx - (px * i / 12), cy, { steps: 3 }); await sleep(60); }
  await page.mouse.up({ button: 'right' });
}
async function rotateKeys(page, deg) { // Shift+Arrow (proven for frontage) — may throw on some CDP builds
  await focusCanvas(page);
  const presses = Math.round(Math.abs(deg) / 10);
  await page.keyboard.down('Shift');
  for (let i = 0; i < presses; i++) { await page.keyboard.press(deg > 0 ? 'ArrowRight' : 'ArrowLeft'); await sleep(120); }
  await page.keyboard.up('Shift');
}

// ── sidebar extraction (proven) ─────────────────────────────────────────────
const EXTRACT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const rows = [];
  const sectionOf = (el) => {
    let node = el;
    for (let hop = 0; hop < 8 && node; hop++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (/tab-title|section__heading/i.test(sib.className || '')) return (sib.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  };
  document.querySelectorAll('p.tab-row,.tab-row').forEach(el => {
    if (!vis(el)) return;
    const t = el.querySelector('.tab-row__title'); const v = el.querySelector('.tab-row__value');
    if (t && v) rows.push({ section: sectionOf(el), label: (t.textContent || '').replace(/\s+/g, ' ').trim(), value: (v.textContent || '').replace(/\s+/g, ' ').trim() });
  });
  const compCards = Array.from(document.querySelectorAll('.lp-estimate-comparable-card')).map((el, i) => ({
    index: i, text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    apn: el.getAttribute('data-apn'), mlsStatus: el.getAttribute('data-mlsstatus'),
    propertyId: el.getAttribute('data-propertyid'), fips: el.getAttribute('data-fips'),
    mlsPropertyId: el.getAttribute('data-mlspropertyid'),
  }));
  const mlsDisabled = !!document.querySelector('.mls-tab__heading.disabled');
  return { rows, compCards, mlsDisabled };
};

// ── commands ────────────────────────────────────────────────────────────────
if (cmd === 'search-address') {
  const [addr] = args;
  const page = await pageFor('__none__', 'https://landportal.com/');
  await page.evaluate(() => document.querySelector('.search-wr-dropdown .selected__option')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(500);
  await page.evaluate(() => {
    const li = Array.from(document.querySelectorAll('li.search__option')).find(x => x.getAttribute('aria-searchtype') === 'address');
    li?.dispatchEvent(new MouseEvent('click', { bubbles: true })); li?.click();
  });
  await sleep(500);
  const st = await page.evaluate(() => document.querySelector('.search-wr')?.getAttribute('data-searchtype'));
  await page.click('#main_search_input', { clickCount: 3 });
  await page.type('#main_search_input', addr, { delay: 60 });
  let variants = [];
  for (let i = 0; i < 20 && !variants.length; i++) {
    await sleep(700);
    variants = await page.evaluate(() => Array.from(document.querySelectorAll('ul.search-variants li.search-variant')).map(li => ({
      text: (li.querySelector('.property-address')?.textContent || '').trim(),
      county: li.getAttribute('data-county'), state: li.getAttribute('data-state'),
      lat: li.getAttribute('data-lat'), lng: li.getAttribute('data-lng'), placetype: li.getAttribute('data-placetype'),
    })));
  }
  if (!variants.length) { writeOut({ error: 'no typeahead variants', searchType: st }); process.exit(2); }
  await page.evaluate(() => {
    const li = document.querySelector('ul.search-variants li.search-variant');
    li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    li.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    li.click();
  });
  let parcelUrl = null;
  for (let i = 0; i < 30 && !parcelUrl; i++) { await sleep(1000); if (/[?&]property=/.test(page.url())) parcelUrl = page.url(); }
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => /Property Overview/i.test(document.body.innerText) && !!document.querySelector('canvas'));
    if (ok) break;
    await sleep(1500);
  }
  await sleep(4000);
  const extraction = await page.evaluate(EXTRACT);
  const file = `browseruse_subject_confirm-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) });
  writeOut({ searchType: st, variants, selectedVariant: variants[0], parcelUrl, extraction, capture: { label: 'subject_confirm', file, capturedAt: nowIso() } });
} else if (cmd === 'search-apn' || cmd === 'search-owner') {
  const [apn, stateName, countyName] = args;
  const mode = cmd === 'search-owner' ? 'owner' : 'parcelnumb';
  const page = await pageFor('__none__', 'https://landportal.com/');
  // 1-2. search-type dropdown → APN / Owner
  await page.evaluate(() => document.querySelector('.search-wr-dropdown .selected__option')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(500);
  await page.evaluate((m) => {
    const li = Array.from(document.querySelectorAll('li.search__option')).find(x => x.getAttribute('aria-searchtype') === m);
    li?.dispatchEvent(new MouseEvent('click', { bubbles: true })); li?.click();
  }, mode);
  await sleep(1000);
  const st = await page.evaluate(() => document.querySelector('.search-wr')?.getAttribute('data-searchtype'));
  // 3-4. select2 State then County inside .search-selects-wr (existing proven scope scripts)
  const pickScope = async (which, value) => {
    const opened = await page.evaluate((w) => {
      const root = document.querySelector('.search-selects-wr') || document;
      const cs = Array.from(root.querySelectorAll('.select2-container')).filter(x => { const r = x.getBoundingClientRect(); return !!x.querySelector('.select2-selection') && r.width > 0 && r.height > 0; });
      const c = cs[w];
      if (!c || String(c.className || '').includes('disabled')) return false;
      const sel = c.querySelector('.select2-selection');
      sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      sel.click();
      return true;
    }, which);
    if (!opened) return { ok: false, reason: 'dropdown would not open' };
    await sleep(700);
    await page.evaluate((v) => {
      const sf = document.querySelector('.select2-search__field');
      if (sf) { sf.value = v; sf.dispatchEvent(new Event('input', { bubbles: true })); sf.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); }
    }, value);
    let has = false;
    for (let i = 0; i < 15 && !has; i++) {
      await sleep(600);
      has = await page.evaluate((v) => {
        const want = String(v).toLowerCase();
        return Array.from(document.querySelectorAll('.select2-results__option')).some((o) => {
          const t = (o.textContent || '').trim().toLowerCase();
          return t && !/searching|loading|no results/.test(t) && (t === want || t.includes(want) || want.includes(t));
        });
      }, value);
    }
    if (!has) return { ok: false, reason: 'option never appeared' };
    const picked = await page.evaluate((v) => {
      const want = String(v).toLowerCase();
      const opts = Array.from(document.querySelectorAll('.select2-results__option'));
      const text = (o) => (o.textContent || '').trim().toLowerCase();
      const el = opts.find((o) => text(o) === want) || opts.find((o) => text(o).replace(/\s+county$/, '') === want) || opts.find((o) => text(o).includes(want));
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
      return true;
    }, value);
    await sleep(1500);
    return { ok: picked };
  };
  const stateSel = await pickScope(0, stateName);
  const countySel = await pickScope(1, countyName);
  // 5-6. APN input (the main input in APN mode)
  await page.click('#main_search_input', { clickCount: 3 }).catch(() => {});
  await page.type('#main_search_input', apn, { delay: 50 });
  await sleep(1500);
  // 7-9. results: search-variants list again (APN mode) → click first
  let variants = [];
  for (let i = 0; i < 25 && !variants.length; i++) {
    await sleep(800);
    variants = await page.evaluate(() => Array.from(document.querySelectorAll('ul.search-variants li.search-variant')).map(li => ({
      text: (li.textContent || '').replace(/\s+/g, ' ').trim(),
      county: li.getAttribute('data-county'), state: li.getAttribute('data-state'), placetype: li.getAttribute('data-placetype'),
    })));
  }
  const preSubmit = `browseruse_apn_search_config-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, preSubmit) });
  if (!variants.length) {
    // Some APN searches submit on Enter with a filter chip instead of a typeahead.
    await page.keyboard.press('Enter');
    await sleep(4000);
    variants = await page.evaluate(() => Array.from(document.querySelectorAll('ul.search-variants li.search-variant,.search-results li,[class*="result"] li')).map(li => ({
      text: (li.textContent || '').replace(/\s+/g, ' ').trim(), placetype: li.getAttribute && li.getAttribute('data-placetype'),
    })).filter(v => v.text));
  }
  if (variants.length) {
    await page.evaluate(() => {
      const li = document.querySelector('ul.search-variants li.search-variant');
      if (li) { li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); li.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); li.click(); }
    });
  }
  let parcelUrl = null;
  for (let i = 0; i < 30 && !parcelUrl; i++) { await sleep(1000); if (/[?&]property=/.test(page.url())) parcelUrl = page.url(); }
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => /Property Overview/i.test(document.body.innerText) && !!document.querySelector('canvas'));
    if (ok) break;
    await sleep(1500);
  }
  await sleep(4000);
  const extraction = parcelUrl ? await page.evaluate(EXTRACT) : null;
  const file = `browseruse_subject_confirm-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) });
  writeOut({ searchType: st, stateSel, countySel, variants, parcelUrl, extraction, preSubmitShot: preSubmit, capture: { label: 'subject_confirm', file, capturedAt: nowIso() } });
} else if (cmd === 'sidebar') {
  const page = await pageFor('property=');
  writeOut(await page.evaluate(EXTRACT));
} else if (cmd === 'aerials') {
  const page = await pageFor('property=');
  await realClick(page, 'button.lp-map-controls__compass'); await sleep(1500);
  await realClick(page, 'button.lp-map-controls__fit'); await sleep(2500);
  await sleep(8000);
  const close = await captureMap(page, 'close_parcel_aerial');
  await zoomSteps(page, -2); await sleep(9000);
  const clean = await captureMap(page, 'clean_parcel_aerial');
  await zoomSteps(page, -3); await sleep(9000);
  const wider = await captureMap(page, 'wider_context');
  writeOut({ close, clean, wider });
} else if (cmd === 'frontage') {
  const [degS, zoomS] = args;
  const page = await pageFor('property=');
  const deg = Number(degS), zoomIn = Number(zoomS);
  if (zoomIn) { await zoomSteps(page, zoomIn); await sleep(4000); }
  // Right-button drag rotation: the only rotation input proven to engage on
  // every tab state (Shift+Arrow silently no-ops on some tabs).
  if (deg) { await rotateDrag(page, Math.round(deg * 480 / 180)); }
  await sleep(9000);
  writeOut({ frontage: await captureMap(page, 'road_frontage_aerial') });
} else if (cmd === 'overlays') {
  const page = await pageFor('property=');
  await realClick(page, 'button.lp-map-controls__compass'); await sleep(1500);
  const openPanel = async () => {
    if (await page.$('.lp-overlays__panel')) return true;
    await realClick(page, 'button.lp-map-controls__basemap');
    await sleep(1200);
    return !!(await page.$('.lp-overlays__panel'));
  };
  const closePanel = async () => { if (await page.$('.lp-overlays__panel')) { await realClick(page, 'button.lp-overlays__close'); await sleep(800); } };
  const clickCard = (label) => page.evaluate((wanted) => {
    const b = Array.from(document.querySelectorAll('button.lp-overlays__cardTop')).find(x => x.getAttribute('aria-label') === wanted);
    if (!b) return false;
    b.scrollIntoView({ block: 'center' }); b.click(); return true;
  }, label);
  const shas = [];
  const base = await captureMap(page, 'overlay_base');
  shas.push(sha(base.file));
  fs.unlinkSync(path.join(SHOTS, base.file));
  const results = [];
  for (const [overlay, names, label] of [
    ['Wetlands', ['Wetlands'], 'wetlands_overlay'],
    ['Soil', ['Soil Survey', 'Soil Type', 'Soil'], 'soil_overlay'],
    ['Contours', ['Contour Lines', 'Contours'], 'contour_terrain_view'],
    ['FEMA', ['FEMA Floodplain'], 'fema_flood_overlay'],
  ]) {
    if (process.env.SKIP_FEMA === '1' && overlay === 'FEMA') { results.push({ overlay, status: 'not_applicable', reason: 'FEMA coverage is 0%' }); continue; }
    if (!(await openPanel())) { results.push({ overlay, status: 'failed', reason: 'panel would not open' }); continue; }
    const all = await page.evaluate(() => Array.from(document.querySelectorAll('button.lp-overlays__cardTop')).map(b => b.getAttribute('aria-label')));
    const name = names.find(n => all.includes(`Enable ${n}`) || all.includes(`Disable ${n}`));
    if (!name) { await closePanel(); results.push({ overlay, status: 'unavailable', reason: 'no toggle in workspace' }); continue; }
    if (all.includes(`Enable ${name}`)) await clickCard(`Enable ${name}`);
    await sleep(5000);
    await closePanel();
    await sleep(4000);
    let shot = await captureMap(page, label);
    let h = sha(shot.file);
    if (shas.includes(h)) {
      await sleep(8000);
      fs.unlinkSync(path.join(SHOTS, shot.file));
      shot = await captureMap(page, label);
      h = sha(shot.file);
    }
    if (shas.includes(h)) {
      fs.unlinkSync(path.join(SHOTS, shot.file));
      results.push({ overlay, status: 'unavailable', reason: 'no visible change at parcel scale' });
    } else { shas.push(h); results.push({ overlay, status: 'completed', label, ...shot }); }
    if (await openPanel()) { await clickCard(`Disable ${name}`); await sleep(800); }
  }
  await closePanel();
  writeOut({ results });
} else if (cmd === 'threed') {
  const [frontDegS] = args;
  const page = await pageFor('property=');
  const pressed = await page.evaluate(() => document.querySelector('button.lp-map-controls__toggle3d')?.getAttribute('aria-pressed'));
  if (pressed !== 'true') { await realClick(page, 'button.lp-map-controls__toggle3d'); await sleep(6000); }
  const frontDeg = Number(frontDegS ?? 90);
  try { await rotateKeys(page, frontDeg); } catch { await rotateDrag(page, Math.round(frontDeg * 480 / 180)); }
  await focusCanvas(page);
  try {
    await page.keyboard.down('Shift');
    for (let i = 0; i < 7; i++) { await page.keyboard.press('ArrowUp'); await sleep(200); }
    await page.keyboard.up('Shift');
  } catch { /* pitch best-effort */ }
  await sleep(9000);
  const front = await captureMap(page, 'front_side_3d');
  await rotateDrag(page, 480); // proven ~180°
  await sleep(9000);
  const rear = await captureMap(page, 'rear_side_3d');
  // restore
  await realClick(page, 'button.lp-map-controls__toggle3d'); await sleep(2500);
  await realClick(page, 'button.lp-map-controls__compass'); await sleep(1500);
  await realClick(page, 'button.lp-map-controls__fit'); await sleep(2000);
  writeOut({ front, rear, distinct: sha(front.file) !== sha(rear.file) });
} else if (cmd === 'comps') {
  // The Show on Map result surface may open in a NEW tab (Trial 2) or navigate
  // the same tab (Trial 1). If a market_comps tab already exists, extract from
  // it directly and skip the click.
  const existing = (await browser.pages()).find(x => x.url().includes('market_comps='));
  let page, sidebarComps;
  if (existing) {
    page = existing;
    await page.setViewport({ width: 1600, height: 950 });
    await page.bringToFront().catch(() => {});
    await sleep(1500);
    const prior = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
    sidebarComps = prior.sidebarComps ?? [];
  } else {
  page = await pageFor('property=');
  await page.evaluate(() => document.querySelector('button.js-lp-estimate-toggle-comparables')?.click());
  await sleep(1500);
  sidebarComps = (await page.evaluate(EXTRACT)).compCards;
  // Real mouse click — a synthetic .click() on this anchor does not fire the
  // site's handler on every layout (proven live in Trial 2).
  await page.evaluate(() => document.querySelector('a.js-lp-estimate-show-on-map')?.scrollIntoView({ block: 'center' }));
  await sleep(800);
  const anchor = await page.$('a.js-lp-estimate-show-on-map');
  if (!anchor) { writeOut({ sidebarComps, error: 'no Show on Map anchor' }); process.exit(2); }
  const abb = await anchor.boundingBox();
  if (abb) await page.mouse.click(abb.x + abb.width / 2, abb.y + abb.height / 2);
  else await page.evaluate(() => document.querySelector('a.js-lp-estimate-show-on-map')?.click());
  // wait for market_comps surface + canvas remount (same tab OR a new tab)
  for (let i = 0; i < 25; i++) {
    await sleep(1500);
    if (page.url().includes('market_comps=')) break;
    const fresh = (await browser.pages()).find(x => x.url().includes('market_comps='));
    if (fresh) { page = fresh; await page.setViewport({ width: 1600, height: 950 }); break; }
  }
  await sleep(6000);
  }
  let compMap = null;
  for (let i = 0; i < 5 && !compMap; i++) { try { compMap = await captureMap(page, 'comp_map'); } catch { await sleep(4000); } }
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, 600);
      document.querySelectorAll('*').forEach(el => { if (el.scrollHeight > el.clientHeight + 80 && el.clientHeight > 120) el.scrollTop += el.clientHeight; });
    });
    await sleep(1200);
  }
  const mapCards = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('div,li,a').forEach(el => {
      if (!el.querySelector) return;
      const img = el.querySelector('img');
      if (!img) return;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/\$[\d,]+/.test(t) || !/MLS acres/i.test(t) || t.length > 400) return;
      if (el.querySelectorAll('*').length > 40) return;
      if (seen.has(t)) return;
      seen.add(t);
      const attrs = {};
      const collect = (node) => {
        if (!node.getAttributeNames) return;
        for (const n of node.getAttributeNames()) if (/mls|property|apn|fips/i.test(n) && n !== 'class') attrs[n] = node.getAttribute(n);
      };
      collect(el);
      let node = el.parentElement;
      for (let hop = 0; hop < 3 && node; hop++) { collect(node); node = node.parentElement; }
      out.push({ text: t.slice(0, 250), img: img.src, attrs });
    });
    return out;
  });
  // thumbnails via element screenshots
  const thumbs = [];
  const imgs = await page.$$('img');
  let ti = 0;
  for (const img of imgs) {
    try {
      const info = await img.evaluate((el) => {
        const r = el.getBoundingClientRect();
        let node = el, text = '';
        for (let hop = 0; hop < 6 && node; hop++) {
          text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (/MLS acres/i.test(text) && /\$[\d,]+/.test(text)) break;
          node = node.parentElement;
        }
        return { w: Math.round(r.width), h: Math.round(r.height), ok: !!node && /MLS acres/i.test(text),
          apn: node?.closest?.('[data-apn]')?.getAttribute('data-apn') || node?.querySelector?.('[data-apn]')?.getAttribute('data-apn') || null };
      });
      if (!info.ok || info.w < 60 || info.h < 40) continue;
      const file = `browseruse_comp_thumb_${ti}-${Date.now()}.png`;
      await img.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await sleep(400);
      await img.screenshot({ path: path.join(SHOTS, file) });
      thumbs.push({ index: ti, file, apn: info.apn });
      ti++;
      if (ti >= 12) break;
    } catch { /* skip */ }
  }
  const listFile = `browseruse_comp_list-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, listFile) });
  writeOut({ sidebarComps, mapCards, thumbs, compMap, listFile, url: page.url() });
} else if (cmd === 'market') {
  const [stateAbbr, fips, zip] = args;
  const page = await pageFor('__none__', 'https://landportal.com/market-research/?template=drill-deep');
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const setSelect = (id, rx) => {
    const s = document.getElementById(id); if (!s) return false;
    const re = new RegExp(rx, 'i');
    const o = Array.from(s.options).find(o => re.test((o.textContent || '').trim()));
    if (!o) return false;
    s.value = o.value;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const clickSold = () => {
    const els = Array.from(document.querySelectorAll('a,button,li')).filter((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === 'sold' && e.getBoundingClientRect().width > 1);
    const rank = (e) => (e.tagName === 'A' || e.tagName === 'BUTTON') ? 0 : 1;
    els.sort((a, b) => rank(a) - rank(b));
    if (els[0]) { els[0].click(); return true; }
    return false;
  };
  const gridReady = () => {
    const t = document.querySelector('.drill-table-scroll table');
    return !!t && Array.from(t.querySelectorAll('tr')).slice(1).some(tr => !/skeleton/i.test(tr.className || '') && /\d/.test(tr.textContent || ''));
  };
  const readRow = (sel) => {
    const tr = document.querySelector(sel);
    if (!tr) return null;
    const tds = Array.from(tr.querySelectorAll('td'));
    if (tds.length < 11) return null;
    return tds.slice(tds.length - 11, tds.length - 1).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
  };
  await ev(clickSold); await sleep(1200);
  await ev(setSelect, 'mrdrill_source', '^Land$'); await sleep(1200);
  await ev(setSelect, 'mrdrill_date', '^1 year$'); await sleep(1500);
  const bandOptions = await ev(() => { const s = document.getElementById('acre_range'); return s ? Array.from(s.options).map(o => o.textContent.trim()) : []; });
  const out = { headers: ['Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'], bands: {}, bandOptions };
  for (const band of bandOptions.filter(b => b && !/custom/i.test(b))) {
    const esc = band.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await ev(setSelect, 'acre_range', `^${esc}$`);
    await sleep(2500);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = await ev(gridReady); if (!ok) await sleep(1500); }
    if (!ok) { out.bands[band] = { error: 'grid never loaded' }; continue; }
    for (let i = 0; i < 10; i++) {
      await ev((st) => { const r = document.querySelector(`tr.state-row[data-state="${st}"]`); if (r && !(r.className || '').includes('active')) r.querySelector('button.expander-btn')?.click(); }, stateAbbr);
      await sleep(2500);
      if (await ev((f) => document.querySelectorAll(`tr.county-row[data-fips="${f}"]`).length, fips) > 0) break;
    }
    if (/^all$/i.test(band) && zip) {
      for (let i = 0; i < 15; i++) {
        await ev((f) => { const r = document.querySelector(`tr.county-row[data-fips="${f}"]`); if (r && !(r.className || '').includes('active')) r.querySelector('button.expander-btn')?.click(); }, fips);
        await sleep(2800);
        const n = await ev((f) => Array.from(document.querySelectorAll(`tr.zip-row[data-fips="${f}"]`)).filter(tr => /\d/.test(tr.textContent || '')).length, fips);
        if (n > 0) break;
      }
    }
    out.bands[band] = {
      state: await ev(readRow, `tr.state-row[data-state="${stateAbbr}"]`),
      county: await ev(readRow, `tr.county-row[data-fips="${fips}"]`),
      zip: zip ? await ev(readRow, `tr.zip-row[data-fips="${fips}"][data-zip="${zip}"]`) : null,
    };
    console.log(band, JSON.stringify(out.bands[band].county), JSON.stringify(out.bands[band].zip));
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  }
  // screenshots on the All view
  await ev(setSelect, 'acre_range', '^All$'); await sleep(4000);
  await ev((f) => document.querySelector(`tr.county-row[data-fips="${f}"]`)?.scrollIntoView({ block: 'center' }), fips);
  await sleep(1000);
  out.countyShot = `browseruse_market_county_all_acreage-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, out.countyShot) });
  const zs = await ev((f, z) => { const r = document.querySelector(`tr.zip-row[data-fips="${f}"][data-zip="${z}"]`); if (r) { r.scrollIntoView({ block: 'center' }); return true; } return false; }, fips, zip);
  await sleep(1000);
  if (zs) {
    out.zipShot = `browseruse_market_zip_all_acreage-${Date.now()}.png`;
    await page.screenshot({ path: path.join(SHOTS, out.zipShot) });
  }
  writeOut(out);
  await page.close();
} else if (cmd === 'zipshot') {
  const [fips, zip] = args;
  const page = await pageFor('__none__', 'https://landportal.com/market-research/?template=drill-deep');
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const deadline = Date.now() + 150000; // fixed budget
  const setSelect = (id, rx) => {
    const s = document.getElementById(id); if (!s) return false;
    const re = new RegExp(rx, 'i');
    const o = Array.from(s.options).find(o => re.test((o.textContent || '').trim()));
    if (!o) return false;
    s.value = o.value;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  await ev(setSelect, 'mrdrill_source', '^Land$'); await sleep(1000);
  await ev(setSelect, 'mrdrill_date', '^1 year$'); await sleep(1000);
  await ev(setSelect, 'acre_range', '^All$'); await sleep(3500);
  while (Date.now() < deadline) {
    await ev((st) => { const r = document.querySelector('tr.state-row[data-state="' + st + '"]'); if (r && !(r.className || '').includes('active')) r.querySelector('button.expander-btn')?.click(); }, 'TN');
    await sleep(2500);
    if (await ev((f) => document.querySelectorAll(`tr.county-row[data-fips="${f}"]`).length, fips) > 0) break;
  }
  let realRows = 0;
  while (Date.now() < deadline && realRows === 0) {
    await ev((f) => { const r = document.querySelector(`tr.county-row[data-fips="${f}"]`); if (r && !(r.className || '').includes('active')) r.querySelector('button.expander-btn')?.click(); }, fips);
    await sleep(3000);
    realRows = await ev((f, z) => { const r = document.querySelector(`tr.zip-row[data-fips="${f}"][data-zip="${z}"]`); return r && /\d/.test(r.textContent || '') ? 1 : 0; }, fips, zip);
  }
  const zipRow = await ev((f, z) => {
    const tr = document.querySelector(`tr.zip-row[data-fips="${f}"][data-zip="${z}"]`);
    if (!tr) return null;
    const tds = Array.from(tr.querySelectorAll('td'));
    return tds.slice(tds.length - 11, tds.length - 1).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
  }, fips, zip);
  await ev((f, z) => document.querySelector(`tr.zip-row[data-fips="${f}"][data-zip="${z}"]`)?.scrollIntoView({ block: 'center' }), fips, zip);
  await sleep(1200);
  const file = `browseruse_market_zip_all_acreage-${Date.now()}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) });
  const skeleton = !realRows;
  writeOut({ zipRow, file: skeleton ? null : file, skeleton, note: skeleton ? 'ZIP sub-table still showed loading skeletons at the fixed timeout; screenshot marked unavailable.' : 'ZIP row rendered with data.' });
  await page.close();
} else {
  console.error('unknown cmd', cmd);
  process.exit(1);
}
await browser.disconnect();
