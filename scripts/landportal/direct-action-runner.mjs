// LandOS -- bounded, single-action LandPortal repair runner.
//
// This runner deliberately does not import the staged pilot.  One invocation
// opens one already-known parcel URL, returns the map to a baseline, performs
// exactly one deterministic action, and then exits.  It never calls a model.
//
// Usage:
//   node scripts/landportal/direct-action-runner.mjs <action> --deal <id> --card <id> [--overlay <name>]
//
// Actions: capture-road-frontage, capture-close-aerial, capture-overlay,
//          capture-front-3d, capture-rear-3d, inspect-soils
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { loadPropertyInspection, saveLandPortalInspection } from '../../dist/landos/property-card.js';
import { validateLandPortalVisualEvidence } from '../../dist/landos/landportal-evidence-validation.js';
import { evaluateThreeDCaptureEligibility, isVerifiedLandPortalSubjectUrl, validateLandPortalSubjectUrl } from '../../dist/landos/landportal-operating-rules.js';
import { getDealCardIdForPropertyCard } from '../../dist/landos/deal-card.js';
import { getLandosDb } from '../../dist/landos/db.js';

const CDP = 'http://127.0.0.1:9224';
const SHOTS = path.resolve('store/browser-shots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const ACTIONS = new Set([
  'capture-road-frontage', 'capture-close-aerial', 'capture-overlay',
  'capture-front-3d', 'capture-rear-3d', 'inspect-soils',
]);
const LIMIT_MS = {
  'capture-road-frontage': 60_000,
  'capture-close-aerial': 60_000,
  'capture-overlay': 90_000,
  'capture-front-3d': 90_000,
  'capture-rear-3d': 90_000,
  'inspect-soils': 180_000,
};
// Fractions are relative to the known fit-baseline canvas. They are the
// distinct colored regions visibly inside Deal 68's red parcel boundary; the
// popup's displayed Map Unit Name, never a guessed label, is the dedupe key.
const SOIL_REGION_FRACTIONS = [
  { x: 0.693, y: 0.276 },
  { x: 0.700, y: 0.420 },
  { x: 0.788, y: 0.691 },
  { x: 0.634, y: 0.726 },
  { x: 0.922, y: 0.749 },
  { x: 0.263, y: 0.556 },
];

const [action, ...rawArgs] = process.argv.slice(2);
const option = (name) => {
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : undefined;
};
const dealId = Number(option('--deal'));
const cardId = Number(option('--card'));
const overlayInput = option('--overlay');
const soilProbeOnly = rawArgs.includes('--soil-probe');
const soilClickX = option('--soil-x');
const soilClickY = option('--soil-y');
const startedAt = now();
const progressRows = [];
let browser = null;
let page = null;
let timeoutHandle = null;
let settled = false;

function emit(event, detail, extra = {}) {
  const row = { event, detail, at: now(), ...extra };
  progressRows.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
}

function report(status, extra = {}) {
  const result = {
    action,
    dealId: Number.isInteger(dealId) ? dealId : null,
    cardId: Number.isInteger(cardId) ? cardId : null,
    status,
    startedAt,
    finishedAt: now(),
    elapsedMs: Date.now() - Date.parse(startedAt),
    timeoutMs: LIMIT_MS[action] ?? null,
    progress: progressRows,
    ...extra,
  };
  process.stdout.write(`${JSON.stringify({ event: 'result', ...result })}\n`);
  return result;
}

function exactFailure(error) {
  if (error instanceof Error && error.message) return error.message.replace(/\s+/g, ' ').trim();
  return String(error || 'unknown_direct_action_failure').replace(/\s+/g, ' ').trim();
}

function assertInput() {
  if (!ACTIONS.has(action)) throw new Error('invalid_action');
  if (!Number.isInteger(dealId) || dealId <= 0) throw new Error('invalid_deal_id');
  if (!Number.isInteger(cardId) || cardId <= 0) throw new Error('invalid_card_id');
  const expectedDealId = getDealCardIdForPropertyCard(cardId);
  if (expectedDealId !== dealId) throw new Error(`deal_card_mismatch: card ${cardId} belongs to deal ${expectedDealId ?? 'none'}`);
}

function isKnownParcelUrl(value) {
  return isVerifiedLandPortalSubjectUrl(value);
}

function findKnownParcelUrl(value, pathName = '') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findKnownParcelUrl(item, `${pathName}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  // parcelUrl is the canonical retained field. pageUrl is accepted only when
  // it is demonstrably a parcel page, never a market/comps or search surface.
  for (const key of ['parcelUrl', 'pageUrl']) {
    const candidate = value[key];
    if (isKnownParcelUrl(candidate)) return { url: candidate, path: pathName ? `${pathName}.${key}` : key };
  }
  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findKnownParcelUrl(child, pathName ? `${pathName}.${key}` : key);
    if (found) return found;
  }
  return null;
}

function resolveKnownParcelUrl() {
  const inspectionUrl = loadPropertyInspection(cardId)?.parcelUrl ?? null;
  if (isKnownParcelUrl(inspectionUrl)) return { url: inspectionUrl, source: 'property_inspection.parcelUrl' };
  const rows = getLandosDb().prepare(
    `SELECT id, kind, ref FROM landos_card_activity
     WHERE card_id = ? AND kind IN ('property_inspection','landportal_inspection','landportal_browseruse_stage','landportal_browseruse')
     ORDER BY created_at DESC, id DESC`,
  ).all(cardId);
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.ref); } catch { continue; }
    const found = findKnownParcelUrl(parsed);
    if (found) return { url: found.url, source: `activity:${row.id}:${row.kind}:${found.path}` };
  }
  return null;
}

function knownParcelUrl() {
  const resolved = resolveKnownParcelUrl();
  if (!resolved) throw new Error('known_parcel_url_missing');
  return resolved.url;
}

function retainedThreeDSlopeDecision() {
  const values = [loadPropertyInspection(cardId)?.parcelFacts ?? {}];
  const rows = getLandosDb().prepare(
    `SELECT ref FROM landos_card_activity
     WHERE card_id = ? AND kind IN ('property_inspection','landportal_inspection','landportal_browseruse_stage','landportal_browseruse')
     ORDER BY created_at ASC, id ASC`,
  ).all(cardId);
  for (const row of rows) {
    try { values.push(JSON.parse(row.ref)); } catch { /* corrupt history is ignored */ }
  }
  return evaluateThreeDCaptureEligibility(values);
}

async function realClick(selector) {
  const element = await page.$(selector);
  if (!element) throw new Error(`control_not_found:${selector}`);
  const box = await element.boundingBox();
  if (!box) throw new Error(`control_not_visible:${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function realClickAria(label) {
  const selector = `button[aria-label="${label.replace(/"/g, '\\"')}"]`;
  const element = await page.$(selector);
  if (!element) throw new Error(`control_not_found:${selector}`);
  await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(150);
  await realClick(selector);
}

async function focusCanvas() {
  const focused = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    canvas.setAttribute('tabindex', '0');
    canvas.focus();
    return document.activeElement === canvas;
  });
  if (!focused) throw new Error('map_canvas_not_focusable');
}

async function zoomSteps(count) {
  await focusCanvas();
  for (let i = 0; i < Math.abs(count); i += 1) {
    if (count > 0) await realClickAria('Zoom in');
    else await realClickAria('Zoom out');
    await sleep(1_500);
  }
}

async function rotateDrag(px) {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!rect) throw new Error('map_canvas_not_found');
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(x - (px * step / 10), y, { steps: 2 });
    await sleep(50);
  }
  await page.mouse.up({ button: 'right' });
}

async function setKnownBaseline() {
  emit('baseline', 'resetting_to_known_2d_fit_baseline');
  const is3d = await page.$eval('button.lp-map-controls__toggle3d', (el) => el.getAttribute('aria-pressed') === 'true').catch(() => false);
  if (is3d) await realClick('button.lp-map-controls__toggle3d');
  await realClick('button.lp-map-controls__compass');
  await realClick('button.lp-map-controls__fit');
  await sleep(4_000);
  const mapReady = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const r = canvas?.getBoundingClientRect();
    return !!r && r.width >= 600 && r.height >= 400;
  });
  if (!mapReady) throw new Error('map_canvas_not_ready_after_baseline');
  await ensureCompleteParcelFit();
}

async function waitForKnownParcelReady() {
  const deadline = Date.now() + 12_000;
  let lastSignals = null;
  while (Date.now() < deadline) {
    lastSignals = await page.evaluate(() => {
      const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const canvas = document.querySelector('canvas');
      const canvasRect = canvas?.getBoundingClientRect();
      return {
        authenticated: /log\s*out/i.test(body) && !/\blog\s*in\b/i.test(body),
        propertyPanel: /property\s+(overview|details)/i.test(body),
        parcelPanel: /parcel\s+(id|address)/i.test(body),
        ownerPanel: /owner\s+(name|of record)/i.test(body),
        canvas: !!canvasRect && canvasRect.width >= 600 && canvasRect.height >= 400,
      };
    });
    if (lastSignals.authenticated && lastSignals.propertyPanel && lastSignals.parcelPanel && lastSignals.canvas) {
      emit('ready', 'known_parcel_panel_and_map_ready', { signals: lastSignals });
      return;
    }
    await sleep(500);
  }
  throw new Error(`parcel_not_ready_after_navigation:${JSON.stringify(lastSignals ?? {})}`);
}

async function mapClip() {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('canvas'))
      .map((element) => element.getBoundingClientRect())
      .filter((r) => r.width >= 600 && r.height >= 400)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const r = candidates[0];
    if (!r) return null;
    return {
      x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)),
      width: Math.min(window.innerWidth - Math.max(0, Math.floor(r.left)), Math.floor(r.width)) - 40,
      height: Math.min(window.innerHeight - Math.max(0, Math.floor(r.top)), Math.floor(r.height)),
    };
  });
}

function decodePngRgba(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  let offset = 8; let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length); offset += 12 + length;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType)) return null;
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels; const raw = inflateSync(Buffer.concat(idat));
  if (!raw || raw.length < (stride + 1) * height) return null;
  const pixels = Buffer.alloc(width * height * 4); let src = 0;
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src++]; const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0; const up = prior[x] ?? 0; const upLeft = x >= channels ? prior[x - channels] : 0;
      const value = raw[src++];
      row[x] = filter === 0 ? value : filter === 1 ? (value + left) & 255 : filter === 2 ? (value + up) & 255 : filter === 3 ? (value + Math.floor((left + up) / 2)) & 255 : (value + paeth(left, up, upLeft)) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const si = x * channels; const di = (y * width + x) * 4;
      pixels[di] = row[si]; pixels[di + 1] = row[si + 1]; pixels[di + 2] = row[si + 2]; pixels[di + 3] = channels === 4 ? row[si + 3] : 255;
    }
    row.copy(prior);
  }
  return { width, height, pixels };
}

function boundaryMargins(buffer) {
  const decoded = decodePngRgba(buffer);
  if (!decoded) return null;
  let minX = decoded.width; let minY = decoded.height; let maxX = -1; let maxY = -1; let count = 0;
  for (let y = 0; y < decoded.height; y += 1) for (let x = 0; x < decoded.width; x += 1) {
    const i = (y * decoded.width + x) * 4; const r = decoded.pixels[i]; const g = decoded.pixels[i + 1]; const b = decoded.pixels[i + 2]; const a = decoded.pixels[i + 3];
    // LandPortal parcel lines are pure red; surrounding parcel context is
    // orange. Keep the union focused on the subject boundary rather than
    // treating every neighboring parcel line as an edge-touching failure.
    if (a > 80 && r > 180 && g < 90 && b < 90 && r > g * 2 && r > b * 2) { count += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  if (count < 20 || maxX < 0) return { count, width: decoded.width, height: decoded.height, margin: null };
  return { count, width: decoded.width, height: decoded.height, margin: { left: minX, right: decoded.width - 1 - maxX, top: minY, bottom: decoded.height - 1 - maxY } };
}

async function boundaryQa(minMargin = 16) {
  const clip = await mapClip();
  if (!clip || clip.width < 600 || clip.height < 400) throw new Error('map_capture_clip_unavailable');
  const png = await page.screenshot({ encoding: 'binary', clip });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'debug_direct_boundary.png'), png);
  const margins = boundaryMargins(Buffer.from(png));
  if (!margins?.margin) throw new Error('subject_boundary_not_rendered');
  const minimum = Math.min(margins.margin.left, margins.margin.right, margins.margin.top, margins.margin.bottom);
  return { ...margins, minimum, clip };
}

async function ensureCompleteParcelFit() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(1_000);
    try {
      const qa = await boundaryQa(30);
      if (qa.minimum >= 16) { emit('fit', 'complete_multipart_boundary_with_margin', { attempt, boundary: qa }); return qa; }
      emit('fit', 'boundary_margin_too_tight_zooming_out', { attempt, boundary: qa });
    } catch (error) {
      if (!/subject_boundary_not_rendered/.test(String(error?.message ?? error)) || attempt >= 3) throw error;
      emit('fit', 'waiting_for_multipart_boundary_render', { attempt });
    }
    await zoomSteps(-1);
  }
  throw new Error('parcel_boundary_fit_failed');
}

async function captureMap(label, { requireBoundary = false } = {}) {
  const cleanup = await page.evaluate(() => {
    const hidden = [];
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    document.querySelectorAll('button,[role=button],.mapboxgl-ctrl-group,[class*="intelligence" i]').forEach((element) => {
      const r = element.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.width > 240 || r.height > 700) return;
      if (r.left >= c.left && r.top >= c.top - 60) {
        element.setAttribute('data-direct-runner-hidden', '1');
        element.style.setProperty('visibility', 'hidden', 'important');
        hidden.push(true);
      }
    });
    return hidden.length;
  });
  if (cleanup === null) throw new Error('map_canvas_not_found_for_capture');
  try {
    await sleep(500);
    const clip = await mapClip();
    if (!clip || clip.width < 600 || clip.height < 400) throw new Error('map_capture_clip_unavailable');
    fs.mkdirSync(SHOTS, { recursive: true });
    const sourcePath = path.join(SHOTS, `direct_${label}-${Date.now()}.png`);
    const png = await page.screenshot({ encoding: 'binary', clip });
    if (requireBoundary) {
      const qa = boundaryMargins(Buffer.from(png));
      if (!qa?.margin) throw new Error('subject_boundary_not_rendered');
      const minimum = Math.min(qa.margin.left, qa.margin.right, qa.margin.top, qa.margin.bottom);
      if (minimum < 16) throw new Error(`parcel_boundary_touches_edge:${JSON.stringify({ ...qa, minimum })}`);
    }
    fs.writeFileSync(sourcePath, png);
    if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size < 1_024) throw new Error('captured_image_invalid');
    return sourcePath;
  } finally {
    await page.evaluate(() => document.querySelectorAll('[data-direct-runner-hidden]').forEach((element) => {
      element.style.removeProperty('visibility');
      element.removeAttribute('data-direct-runner-hidden');
    }));
  }
}

async function enableOverlay(name) {
  emit('overlay', `enabling_${name}`);
  await realClick('button.lp-map-controls__basemap');
  await sleep(450);
  const enableLabel = `Enable ${name}`;
  const disableLabel = `Disable ${name}`;
  const alreadyEnabled = await page.$(`button[aria-label="${disableLabel}"]`);
  if (!alreadyEnabled) await realClickAria(enableLabel);
  // Soil Type is a server-backed colored tile layer. It routinely paints after
  // the overlay menu closes, so wait for its actual tile window without
  // changing timing for the other direct overlay actions.
  await sleep(name === 'Soil Type' ? 10_000 : 3_200);
  const close = await page.$('button.lp-overlays__close');
  if (close) {
    const box = await close.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await sleep(name === 'Soil Type' ? 2_000 : 600);
}

function overlayConfig() {
  const requestedName = overlayInput || 'Wetlands';
  const name = /^soil$/i.test(requestedName)
    ? 'Soil Type'
    : /^contours?$/i.test(requestedName)
      ? 'Contour Lines'
      : /^fema$/i.test(requestedName)
        ? 'FEMA Floodplain'
        : requestedName;
  const config = {
    Wetlands: { key: 'wetlands_overlay', label: 'Wetlands overlay', purpose: 'Wetlands context over the confirmed parcel boundary.' },
    'Soil Type': { key: 'soil_overlay', label: 'Soil Type overlay', purpose: 'LandPortal Soil Type overlay over the confirmed parcel boundary.' },
    'Contour Lines': { key: 'contour_terrain_view', label: 'Contour terrain view', purpose: 'Contour Lines over the confirmed parcel boundary.' },
    'FEMA Floodplain': { key: 'fema_flood_overlay', label: 'FEMA flood overlay', purpose: 'FEMA Floodplain overlay over the confirmed parcel boundary.' },
  }[name];
  if (!config) throw new Error(`unsupported_overlay:${name}`);
  return { name, ...config };
}

function summarizeSoilPayload(value, pathName = '') {
  const records = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => records.push(...summarizeSoilPayload(item, `${pathName}[${index}]`)));
    return records;
  }
  if (!value || typeof value !== 'object') return records;
  const fields = {};
  const soilContext = /soil|map.?unit|component/i.test(pathName);
  for (const [key, child] of Object.entries(value)) {
    if ((typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') &&
      (/^(soil|mukey|musym|muname|map.?unit|symbol|component|comp(?:onent)?(?:name|pct|percent|key)?|texture|drainage|hydrolog|hydric|tax(?:order|sub|class|family|soil)|aws)/i.test(key) ||
        (soilContext && /name|description|field|slope|percent|value/i.test(key)))) {
      fields[key] = child;
    }
  }
  if (Object.keys(fields).length) records.push({ path: pathName || '$', fields });
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') records.push(...summarizeSoilPayload(child, pathName ? `${pathName}.${key}` : key));
  }
  return records;
}

function startSoilNetworkTrace() {
  const trace = { responses: [], pending: new Set(), clickStartedAt: null };
  const onResponse = (response) => {
    const promise = (async () => {
      const url = response.url();
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      if (!/json|text|xml|javascript/i.test(contentType)) return;
      let body;
      try { body = await response.text(); } catch { return; }
      if (!body || body.length > 1_500_000) return;
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* non-JSON text is still inspected below */ }
      const records = parsed ? summarizeSoilPayload(parsed) : [];
      const bodyMentionsSoil = /\bsoil\b|map\s*unit|mukey|musym|muname|texture|drainage|hydrolog|hydric|taxorder/i.test(body);
      if (!records.length && !bodyMentionsSoil && !/soil/i.test(url)) return;
      trace.responses.push({
        url: (() => { try { const parsedUrl = new URL(url); return `${parsedUrl.origin}${parsedUrl.pathname}`; } catch { return url.split('?')[0]; } })(),
        status: response.status(),
        contentType,
        observedAt: Date.now(),
        fields: records,
        textPreview: bodyMentionsSoil && !records.length ? body.replace(/\s+/g, ' ').slice(0, 500) : undefined,
      });
    })();
    trace.pending.add(promise);
    promise.finally(() => trace.pending.delete(promise));
  };
  page.on('response', onResponse);
  return {
    trace,
    markClick() { trace.clickStartedAt = Date.now(); },
    async finish() {
      await Promise.allSettled([...trace.pending]);
      page.off('response', onResponse);
      return trace;
    },
  };
}

async function canvasGeometry() {
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  if (!geometry) throw new Error('map_canvas_not_found');
  return geometry;
}

async function inspectSoilSurfaces() {
  const inspectBrowserRoot = (rootName) => {
    const inspectRoot = (root, name) => {
      const visible = (element) => {
        const r = element.getBoundingClientRect();
        const s = getComputedStyle(element);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const selectors = '.mapboxgl-popup,.leaflet-popup,[role="dialog"],.lp-overlays__panel,[class*="soil" i],[class*="popup" i],[class*="info" i]';
      const rows = [];
      for (const element of root.querySelectorAll(selectors)) {
        if (!visible(element)) continue;
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 12) continue;
        if (!/soil|symbol|map.?unit|texture|drainage|hydrolog|hydric|mukey|musym|muname/i.test(text)) continue;
        rows.push({ root: name, tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className : '', text });
      }
      for (const element of root.querySelectorAll('*')) {
        if (!element.shadowRoot) continue;
        rows.push(...inspectRoot(element.shadowRoot, `${name}.shadow`));
      }
      return rows;
    };
    return inspectRoot(document, rootName);
  };
  const main = await page.evaluate(inspectBrowserRoot, 'document');
  const frames = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let frameOrigin = '';
    try { frameOrigin = new URL(frame.url()).origin; } catch { /* malformed frame URL */ }
    if (frameOrigin !== 'https://landportal.com') continue;
    try { frames.push({ url: frame.url(), rows: await frame.evaluate(inspectBrowserRoot, 'iframe') }); } catch { /* cross-origin frame */ }
  }
  return {
    document: main,
    frames,
    pages: (await browser.pages()).map((p) => {
      try { const parsedUrl = new URL(p.url()); return `${parsedUrl.origin}${parsedUrl.pathname}`; } catch { return p.url().split('?')[0]; }
    }),
  };
}

async function visibleSoilPanels() {
  return page.evaluate(() => {
    const visible = (element) => {
      const r = element.getBoundingClientRect();
      const s = getComputedStyle(element);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const selectors = '.mapboxgl-popup,.leaflet-popup,[role="dialog"],.lp-overlays__panel,[class*="soil" i]';
    return Array.from(document.querySelectorAll(selectors)).filter(visible).map((element) => ({
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className : '',
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
    })).filter((item) => item.text && item.text.length > 12 && /soil|symbol|map.?unit|texture|drainage|hydrolog|hydric|mukey|musym|muname/i.test(item.text) && !/^soil(?: type)?$/i.test(item.text));
  });
}

async function readSoilPopupRecord() {
  return page.evaluate(() => {
    const visible = (element) => {
      const r = element.getBoundingClientRect();
      const s = getComputedStyle(element);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const popup = Array.from(document.querySelectorAll('.map-overlay-info-tooltip-wr,.overlay-popup,.mapboxgl-popup,.leaflet-popup,[role="dialog"]')).find(visible);
    if (!popup) return null;
    const fields = {};
    for (const row of popup.querySelectorAll('.overlay-popup__row,.overlay-popup__text,tr')) {
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const match = text.match(/^([^:]{2,100}):\s*(.{1,300})$/);
      if (match) fields[match[1].trim()] = match[2].trim();
      const cells = row.querySelectorAll('th,td');
      if (cells.length >= 2) {
        const key = (cells[0].textContent || '').replace(/\s+/g, ' ').trim();
        const value = (cells[1].textContent || '').replace(/\s+/g, ' ').trim();
        if (key && value) fields[key.replace(/:$/, '')] = value;
      }
    }
    if (!Object.keys(fields).length) return null;
    return {
      root: 'document',
      className: typeof popup.className === 'string' ? popup.className : '',
      fields,
      text: (popup.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
}

async function collectSoilDetails(network) {
  const canvas = await page.$('canvas');
  const box = await canvas?.boundingBox();
  if (!box) throw new Error('map_canvas_not_found_for_soil_inspection');
  const details = new Map();
  const popupFields = [];
  const panelFields = [];
  for (const { x: xFraction, y: yFraction } of SOIL_REGION_FRACTIONS) {
    try { await page.keyboard.press('Escape'); } catch { /* popup close is best effort */ }
    await page.mouse.click(box.x + box.width * xFraction, box.y + box.height * yFraction);
    await sleep(450);
    const popup = await readSoilPopupRecord();
    if (!popup) continue;
    const name = popup.fields['Map Unit Name'] ?? popup.fields['Soil Map Unit Name'] ?? null;
    if (!name) continue;
    const dedupeKey = name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!details.has(dedupeKey)) {
      const record = { source: 'dom_popup', symbol: null, name, fields: popup.fields };
      details.set(dedupeKey, record);
      popupFields.push({ ...record, className: popup.className });
    }
  }
  panelFields.push(...await visibleSoilPanels());
  const finishedNetwork = await network.finish();
  const responseFields = finishedNetwork.responses.flatMap((response) => response.fields);
  return {
    records: [...details.values()],
    popupFields,
    panelFields,
    responseFields,
    responses: finishedNetwork.responses,
  };
}

// The acceptance-gated Deal Card projection admits only assets carrying an
// accepted deterministic validation for this exact Property Card. Stamp the
// same contract the Hermes import path uses, from facts this runner measured.
const VIEW_FOR_ASSET_KEY = {
  close_parcel_aerial: 'parcel_context',
  road_frontage_aerial: 'road_frontage',
  wetlands_overlay: 'wetlands',
  fema_flood_overlay: 'fema_flood',
  soil_overlay: 'soil',
  contour_terrain_view: 'contours',
  front_side_3d: 'front_3d',
  rear_side_3d: 'rear_3d',
};

function visualValidationForCapture({ key, sourcePath }) {
  const view = VIEW_FOR_ASSET_KEY[key] ?? 'parcel_context';
  const buffer = fs.readFileSync(sourcePath);
  const boundary = boundaryMargins(buffer);
  const boundaryVisible = !!boundary?.margin && boundary.count >= 20;
  const threeD = view === 'front_3d' || view === 'rear_3d';
  return validateLandPortalVisualEvidence({
    propertyCardId: cardId,
    expectedPropertyCardId: cardId,
    subjectClassification: 'verified_subject',
    requestedView: view,
    activeView: view,
    // 2D captures happen straight after the measured complete-boundary fit;
    // the red boundary must actually be in the pixels. Oblique 3D tilts can
    // legitimately restyle the boundary, so it is not required there.
    boundaryRequired: !threeD,
    boundaryVisible,
    tilesLoaded: true,
    bytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    priorSha256s: (loadPropertyInspection(cardId)?.assets ?? [])
      .map((asset) => asset.validation?.sha256)
      .filter((value) => typeof value === 'string'),
    cameraScale: threeD ? 'context' : 'parcel',
    clipped: false,
    obstructions: [],
  });
}

function persistAsset({ key, label, kind, purpose, sourcePath, overlay, note, soilDetails = [] }) {
  const parcelUrl = knownParcelUrl();
  const urlValidation = validateLandPortalSubjectUrl(parcelUrl);
  if (!urlValidation.valid || !urlValidation.identity) throw new Error(`invalid_verified_subject_url:${urlValidation.reason}`);
  const validation = visualValidationForCapture({ key, sourcePath });
  if (validation.status !== 'accepted') throw new Error(`capture_validation_rejected:${validation.reasons.join('; ')}`);
  const timestamp = now();
  saveLandPortalInspection(cardId, {
    parcelUrl,
    parcelUrlRecord: {
      url: parcelUrl,
      source: `direct_action_runner:${action}`,
      capturedAt: timestamp,
      propertyCardId: cardId,
      dealCardId: dealId,
      verifiedSubject: true,
      apn: urlValidation.identity.apn,
      fips: urlValidation.identity.fips,
      propertyId: urlValidation.identity.propertyId,
    },
    comparablesUrl: null,
    parcelFacts: {},
    assets: [{ key, label, kind, purpose, sourcePath, timestamp, overlay, note, validation }],
    overlays: overlay ? [{ overlay, status: 'captured', note: `Direct action runner captured ${overlay}.`, confidence: 'medium', screenshotKey: key }] : [],
    visualObservations: [],
    comparables: [],
    sources: [{ provider: 'LandPortal', stage: 'direct_action_runner', status: 'used', resultKind: 'retrieved', attemptedAt: timestamp, confidence: 'medium', url: parcelUrl, note: `Deterministic direct action ${action}; no model used.` }],
    evidence: soilDetails.map((detail) => ({
      label: detail.name || 'Soil Type',
      status: 'verified',
      detail: JSON.stringify({ symbol: detail.symbol ?? null, name: detail.name ?? null, fields: detail.fields ?? {} }),
      confidence: 'high',
      source: 'LandPortal Soil Type overlay popup',
      url: parcelUrl,
    })),
    discoveryQuestions: [],
    missingInformation: [],
  });
  return { key, sourcePath };
}

async function runAction() {
  assertInput();
  const resolvedParcel = resolveKnownParcelUrl();
  if (!resolvedParcel) throw new Error('known_parcel_url_missing');
  const parcelUrl = resolvedParcel.url;
  if (action === 'capture-front-3d' || action === 'capture-rear-3d') {
    const eligibility = retainedThreeDSlopeDecision();
    emit('decision', 'three_d_capture_eligibility', { ...eligibility });
    if (eligibility.decision === 'unknown') throw new Error('three_d_eligibility_slope_data_missing');
    if (eligibility.decision === 'not_applicable') {
      const timestamp = now();
      saveLandPortalInspection(cardId, {
        parcelUrl,
        threeDCapture: eligibility,
        parcelUrlRecord: (() => {
          const validation = validateLandPortalSubjectUrl(parcelUrl);
          if (!validation.valid || !validation.identity) return null;
          return { url: parcelUrl, source: 'direct_action_runner:eligibility_check', capturedAt: timestamp, propertyCardId: cardId, dealCardId: dealId, verifiedSubject: true, apn: validation.identity.apn, fips: validation.identity.fips, propertyId: validation.identity.propertyId };
        })(),
        comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [], visualObservations: [], comparables: [],
      });
      return {
        status: 'not_applicable',
        reason: eligibility.reason,
        threeDCapture: eligibility,
        stages: {
          frontSide3d: 'not_applicable',
          rearSide3d: 'not_applicable',
        },
      };
    }
  }
  emit('open', 'opening_known_parcel_url', { source: resolvedParcel.source });
  browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: LIMIT_MS[action] });
  page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 950 });
  await page.goto(parcelUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(45_000, LIMIT_MS[action] - 5_000) });
  await waitForKnownParcelReady();
  await setKnownBaseline();

  if (action === 'capture-road-frontage') {
    emit('action', 'setting_frontage_context');
    await zoomSteps(-2);
    await rotateDrag(420);
    await sleep(900);
    await ensureCompleteParcelFit();
    const sourcePath = await captureMap('road_frontage_aerial', { requireBoundary: true });
    return persistAsset({ key: 'road_frontage_aerial', label: 'Road frontage aerial', kind: 'parcel_page', purpose: 'Road-frontage context for the confirmed parcel.', sourcePath });
  }
  if (action === 'capture-close-aerial') {
    emit('action', 'capturing_close_parcel_aerial');
    const sourcePath = await captureMap('close_parcel_aerial', { requireBoundary: true });
    return persistAsset({ key: 'close_parcel_aerial', label: 'Close parcel aerial', kind: 'parcel_page', purpose: 'Close aerial view of the confirmed parcel boundary.', sourcePath });
  }
  if (action === 'capture-overlay') {
    const overlay = overlayConfig();
    await enableOverlay(overlay.name);
    const sourcePath = await captureMap(overlay.key);
    return persistAsset({ ...overlay, kind: 'overlay', sourcePath, overlay: overlay.name });
  }
  if (action === 'capture-front-3d' || action === 'capture-rear-3d') {
    emit('action', action === 'capture-front-3d' ? 'setting_front_3d_view' : 'setting_rear_3d_view');
    await zoomSteps(-1);
    await realClick('button.lp-map-controls__toggle3d');
    await focusCanvas();
    await page.keyboard.down('Shift');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Shift');
    if (action === 'capture-rear-3d') await rotateDrag(480);
    await sleep(1_200);
    const key = action === 'capture-front-3d' ? 'front_side_3d' : 'rear_side_3d';
    const sourcePath = await captureMap(key);
    return persistAsset({ key, label: action === 'capture-front-3d' ? 'Front-side 3D' : 'Rear-side 3D', kind: 'parcel_3d', purpose: action === 'capture-front-3d' ? 'Oblique front-side parcel context.' : 'Oblique rear-side parcel context.', sourcePath });
  }
  if (action === 'inspect-soils') {
    const network = startSoilNetworkTrace();
    await enableOverlay('Soil Type');
    await realClick('button.lp-map-controls__fit');
    await sleep(900);
    if (soilProbeOnly || (soilClickX !== undefined && soilClickY !== undefined)) {
      const beforeScreenshot = await captureMap('soil_probe_before_click');
      const geometry = await canvasGeometry();
      if (soilProbeOnly && (soilClickX === undefined || soilClickY === undefined)) {
        await network.finish();
        return { soilProbe: { beforeScreenshot, canvas: geometry, instruction: 'Use a visible soil-colored region in this screenshot and rerun with --soil-x/--soil-y fractions.' } };
      }
      const xFraction = Number(soilClickX);
      const yFraction = Number(soilClickY);
      if (![xFraction, yFraction].every((value) => Number.isFinite(value) && value > 0 && value < 1)) throw new Error('soil_click_fraction_out_of_range');
      const x = geometry.x + geometry.width * xFraction;
      const y = geometry.y + geometry.height * yFraction;
      emit('action', 'clicking_representative_soil_region', { method: 'real_mouse_canvas_click', xFraction, yFraction });
      network.markClick();
      await page.mouse.click(x, y);
      await sleep(900);
      const afterScreenshot = await captureMap('soil_probe_after_click');
      const surfaces = await inspectSoilSurfaces();
      const soilTrace = await network.finish();
      return {
        soilProbe: {
          beforeScreenshot,
          afterScreenshot,
          click: { method: 'real_mouse_canvas_click', x, y, xFraction, yFraction },
          surfaces,
          clickNetworkResponses: soilTrace.responses.filter((response) => response.observedAt >= soilTrace.clickStartedAt),
        },
      };
    }
    emit('action', 'inspecting_soil_type_popups_deterministically');
    const soilTrace = await collectSoilDetails(network);
    // Only records extracted from the actual Soil popup are persistable. A
    // generic panel or unrelated property response is never soil evidence.
    const soilDetails = soilTrace.records;
    if (!soilDetails.length) {
      const error = new Error('soil_details_not_exposed_by_dom_popup_network_response_or_information_panel');
      error.soilTrace = soilTrace;
      throw error;
    }
    const sourcePath = await captureMap('soil_overlay');
    const persisted = persistAsset({ key: 'soil_overlay', label: 'Soil Type overlay', kind: 'overlay', purpose: 'LandPortal Soil Type overlay and deterministic popup inspection.', sourcePath, overlay: 'Soil Type', soilDetails, note: JSON.stringify({ soilDetails }) });
    return { ...persisted, soilDetails, soilTrace };
  }
  throw new Error('unreachable_action');
}

function armHardTimeout() {
  const timeoutMs = LIMIT_MS[action];
  timeoutHandle = setTimeout(async () => {
    if (settled) return;
    settled = true;
    emit('timeout', 'hard_timeout_reached');
    report('timed_out', { failureReason: `hard_timeout_${timeoutMs}ms` });
    try { await page?.close(); } catch { /* terminal cleanup */ }
    try { await browser?.disconnect(); } catch { /* terminal cleanup */ }
    process.exit(124);
  }, timeoutMs);
}

try {
  assertInput();
  armHardTimeout();
  const persisted = await runAction();
  settled = true;
  report(persisted?.status === 'not_applicable' ? 'not_applicable' : 'completed', { persisted });
} catch (error) {
  settled = true;
  report('failed', {
    failureReason: exactFailure(error),
    soilTypesFound: error?.soilTrace ? error.soilTrace.records : [],
    popupOrResponseFields: error?.soilTrace ? {
      domPopupFields: error.soilTrace.popupFields,
      informationPanels: error.soilTrace.panelFields,
      networkResponseFields: error.soilTrace.responseFields,
      networkResponses: error.soilTrace.responses,
    } : undefined,
    persistedSoilDetails: [],
  });
  process.exitCode = 1;
} finally {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  try { await page?.close(); } catch { /* terminal cleanup */ }
  try { await browser?.disconnect(); } catch { /* terminal cleanup */ }
}
