import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LandPortal visual capture contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/landos/browser-session.ts'), 'utf8');

  it('uses exact overlay controls and closes the dialog before each screenshot', () => {
    const captureStart = source.indexOf('const captureOverlay = async');
    const captureEnd = source.indexOf('for (const planned of OVERLAY_CAPTURE_PLAN', captureStart);
    const capture = source.slice(captureStart, captureEnd);

    expect(capture).toContain('`Enable ${label}`');
    expect(capture).toContain('`Disable ${label}`');
    expect(capture).toContain('await closeOverlayDialog()');
    expect(capture.indexOf('await closeOverlayDialog()')).toBeLessThan(capture.indexOf("await captureMapViewport(file, 'overlay')"));
    expect(capture).not.toContain('clickVisible');
  });

  it('refuses a relabeled base-map image: every overlay capture passes the distinctness gate or is recorded as a miss', () => {
    const captureStart = source.indexOf('const captureOverlay = async');
    const captureEnd = source.indexOf('for (const planned of OVERLAY_CAPTURE_PLAN', captureStart);
    const capture = source.slice(captureStart, captureEnd);

    // The toggled layer gets real render time before the screenshot.
    expect(capture).toContain('await sleep(4500)');
    // Byte-identity against the base parcel shot AND every earlier capture.
    expect(capture).toContain('isDistinctOverlayCapture(sha, capturedShas)');
    // An identical frame is retried once, then deleted and honestly recorded
    // as unavailable — never pushed into overlayShots.
    expect(capture).toContain('fs.unlinkSync(file)');
    expect(capture).toContain('overlayMisses.push({ overlay,');
    expect(capture.indexOf('overlayShots.push')).toBeGreaterThan(capture.indexOf('isDistinctOverlayCapture'));
    // The base capture seeds the hash set before any overlay is attempted.
    const baseSeedAt = source.indexOf('capturedShas.push(fileSha256(parcelFile))');
    expect(baseSeedAt).toBeGreaterThan(-1);
    expect(baseSeedAt).toBeLessThan(captureStart);
  });

  it('attempts the full Phase 5 overlay set (FEMA, wetlands, soil, contours) from the shared plan and reports misses', () => {
    expect(source).toContain('for (const planned of OVERLAY_CAPTURE_PLAN');
    expect(source).toContain('overlayMisses,');
    // The empty/failed result also carries the miss channel so a failed pass
    // never silently drops the overlay record.
    expect(source).toContain('overlayMisses: [] as Array<{ overlay: string; reason: string }>');
  });

  it('uses only the driver\'s authenticated LANE page and never borrows another Deal page', () => {
    const captureStart = source.indexOf('async captureLandPortalVisuals');
    const captureEnd = source.indexOf('// Full-panel read', captureStart);
    const capture = source.slice(captureStart, captureEnd);
    expect(capture).toContain('const page = await getLanePage()');
    expect(capture).not.toContain('const page = await state.browser.newPage()');
    expect(capture).not.toContain('for (const candidate of await state.browser.pages())');
    expect(capture).not.toContain('reusedReadyParcelPage');
  });

  it('serializes captures on the NAMED LandPortal capture gate (never the broad working-tab gate)', () => {
    const captureStart = source.indexOf('async captureLandPortalVisuals');
    const captureEnd = source.indexOf('// Full-panel read', captureStart);
    const capture = source.slice(captureStart, captureEnd);
    expect(capture).toContain('landportalCaptureGate.then(work, work)');
    expect(capture).not.toContain('workingPageGate');
  });

  it('recovers a dead dedicated browser and fails loudly instead of returning an empty capture', () => {
    const captureStart = source.indexOf('async captureLandPortalVisuals');
    const captureEnd = source.indexOf('// Full-panel read', captureStart);
    const capture = source.slice(captureStart, captureEnd);
    // Recovery first: the launching variant, not the connect-only one.
    expect(capture).toContain('await ensureBrowserSessionReady(deps)');
    // Then loud: an error log naming the endpoint, and a thrown error. The
    // silent `if (!state.browser) return empty` is the defect and must not return.
    expect(capture).toContain("event: 'landportal_capture_browser_unavailable'");
    expect(capture).toContain('logger.error(');
    expect(capture).toMatch(/if \(!state\.browser\) \{[\s\S]{0,600}throw new Error\(/);
    expect(capture).not.toMatch(/if \(!state\.browser\) return empty;/);
  });

  it('releases the capture gate at the holder\'s own declared timeout so an abandoned run cannot queue the next one', () => {
    const captureStart = source.indexOf('async captureLandPortalVisuals');
    const captureEnd = source.indexOf('// Full-panel read', captureStart);
    const capture = source.slice(captureStart, captureEnd);
    // The successor waits on the run OR the holder's own budget, never on the
    // run alone — that unbounded assignment is what queued a 4-second
    // retrieval behind an already-abandoned capture for six minutes.
    expect(capture).not.toMatch(/landportalCaptureGate = run\.then\(/);
    expect(capture).toContain('const staleHoldMs = Math.max(1, opts.timeoutMs)');
    expect(capture).toContain('landportalCaptureGate = Promise.race([');
    expect(capture).toContain("event: 'landportal_capture_gate_released_stale'");
    // Queue cost is measured from before the gate and reported on entry.
    expect(capture.indexOf('const enqueuedAtMs = Date.now()')).toBeLessThan(capture.indexOf('const work = async ()'));
    // Gate wait is measured on ENTRY to the gated work, so a cold browser
    // launch is never reported as queueing.
    expect(capture.indexOf('const queuedMs = Date.now() - enqueuedAtMs'))
      .toBeLessThan(capture.indexOf('await ensureBrowserSessionReady(deps)'));
    expect(capture).toContain("event: 'landportal_capture_entered', queuedMs");
  });

  it('never raises a visible window: bringToFront is guarded to the LandOS-spawned offscreen instance', () => {
    const driverStart = source.indexOf('export function makeLiveBrowserDriver');
    const driverSource = source.slice(driverStart);
    for (const line of driverSource.split('\n')) {
      if (!line.includes('bringToFront')) continue;
      // Every driver-path activation is inside the launchedBackground guard;
      // comment lines describing the guard are allowed.
      const guarded = /launchedBackground/.test(line)
        || /^\s*(\/\/|\*)/.test(line)
        || /try \{ await \(page as unknown as \{ bringToFront/.test(line);
      expect(guarded, `unguarded bringToFront in driver path: ${line.trim()}`).toBe(true);
    }
    // The one allowed activation sits DIRECTLY inside the background guard.
    expect(driverSource).toMatch(/if \(state\.launchedBackground\) \{\s*\n\s*try \{ await \(page as unknown as \{ bringToFront/);
    // readFullPanel opens a fresh tab and must not force the window forward.
    const fullPanelStart = source.indexOf('async readFullPanel');
    const fullPanelEnd = source.indexOf('async readLinks', fullPanelStart);
    expect(source.slice(fullPanelStart, fullPanelEnd)).not.toContain('await page.bringToFront');
  });

  it('lets parcel readiness gates decide after LandPortal misses its navigation event deadline', () => {
    expect(source).toContain('landportal_navigation_timeout_continuing');
    expect(source).toContain('the authenticated panel, identity fields, map');
  });

  it('enters 3D through the exact LandPortal terrain control with the overlay dialog closed', () => {
    const terrainStart = source.indexOf('let terrainShotPath');
    const terrainEnd = source.indexOf('// Expand "View all"', terrainStart);
    const terrain = source.slice(terrainStart, terrainEnd);

    expect(terrain).toContain('await closeOverlayDialog()');
    expect(terrain).toContain("clickNamedButton('Toggle 3D terrain')");
  });

  it('frames the 2D parcel screenshot at parcel-context scale, never a fixed county-scale zoom-out', () => {
    const zoomAt = source.indexOf('await zoomOutParcelMap(contextSteps)');
    const parcelShotAt = source.indexOf("await captureMapViewport(parcelFile, 'parcel_context')");
    expect(source).toContain("clickNamedButton('Fit')");
    expect(source).toContain("clickNamedButton('Zoom out')");
    expect(source).toContain("page.keyboard.press('-')");
    // Steps come from the acreage-aware parcel-context computation, and a
    // partially driven zoom is refused rather than saved at the wrong scale.
    expect(source).toContain('contextZoomOutSteps(parseAcresFromFields(fieldsOut.fields ?? {}))');
    expect(source).toContain('zoomedOutSteps !== contextSteps');
    // The county-scale defect must not return: no fixed five-step zoom-out.
    expect(source).not.toContain('zoomOutParcelMap(5)');
    expect(zoomAt).toBeGreaterThan(-1);
    expect(parcelShotAt).toBeGreaterThan(zoomAt);
  });

  it('orients the road below the parcel and refuses an unpainted satellite canvas', () => {
    expect(source).toContain("page.keyboard.press('Shift+ArrowRight')");
    expect(source).toContain('landportal_visual_orientation');
    expect(source).toContain("reason: 'satellite_tiles_unpainted'");
    expect(source).toContain('fs.statSync(parcelFile).size < 500_000');
  });

  it('waits for late ads, dismisses the current skip-tracing offer, inspects the saved crop, and recaptures on contamination', () => {
    const start = source.indexOf('const captureMapViewport = async');
    const end = source.indexOf('const overlayShots:', start);
    const capture = source.slice(start, end);
    expect(source).toMatch(/skip.\?trac\|buy tokens/);
    expect(source).toContain('enhance your leads');
    // BOUNDED retry: a contaminated frame is deleted and recaptured, and the loop
    // can never spin forever. The exact bound is an implementation detail, so
    // assert the shape and a real second chance rather than a magic number.
    const bound = /for \(let attempt = 1; attempt <= (\d+); attempt \+= 1\)/.exec(capture);
    expect(bound, 'the contamination recapture loop is gone').not.toBeNull();
    expect(Number(bound![1])).toBeGreaterThanOrEqual(2);
    expect(capture).toContain('return false;');
    expect(capture).toContain('inspectSavedParcelVisual');
    expect(capture).toContain('after.dismissed === 0');
    expect(capture).toContain('fs.unlinkSync(file)');
    expect(capture).toContain('late obstruction appeared during saved-image capture');
  });

  it('reads explicit LandPortal tab-row title/value pairs only after parcel readiness', () => {
    const fieldsStart = source.indexOf('const FIELDS =');
    const fieldsEnd = source.indexOf('// Each row is returned', fieldsStart);
    const fields = source.slice(fieldsStart, fieldsEnd);
    expect(fields).toContain("document.querySelectorAll('p.tab-row,.tab-row')");
    expect(fields).toContain("el.querySelector?.('.tab-row__title')");
    expect(fields).toContain("el.querySelector?.('.tab-row__value')");
    expect(fields).not.toContain("querySelectorAll(':scope > span')");
    const readyAt = source.indexOf("reason: 'parcel_not_ready'");
    const readAt = source.indexOf('const fieldsOut = await page.evaluate', readyAt);
    expect(readAt).toBeGreaterThan(readyAt);
  });
});

// ── The capture must never abort on an optional framing step ────────────────
// Live finding on Deal 32: some Chrome/CDP builds reject the combined
// "Shift+ArrowRight" chord with `Unknown key`. That throw propagated out of the
// whole LandPortal capture, so the parcel screenshot, the sidebar comp rows AND
// the entire "Show on Map" surface were lost — the run reported no comps at all
// while the page was perfectly readable.

describe('LandPortal capture resilience', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/landos/browser-session.ts'), 'utf8');

  it('treats map bearing rotation as optional, never fatal', () => {
    const orient = source.slice(source.indexOf('orientRoadBelowParcel'));
    const body = orient.slice(0, orient.indexOf('const zoomOutSteps'));
    expect(body).toContain("page.keyboard.press('Shift+ArrowRight')");
    // The chord attempt is guarded, has a non-chorded fallback, and finally
    // degrades to "no rotation" instead of throwing.
    expect(body).toMatch(/try\s*\{/);
    expect(body).toContain("chorded.down('Shift')");
    expect(body).toContain('bearing_rotation_unsupported');
    expect(body).toContain('return 0;');
  });

  it('reads the Show-on-Map surface after clicking the comps control', () => {
    expect(source).toContain('js-lp-estimate-show-on-map');
    // Results are lazy-loaded: scroll passes run before the rows are read.
    expect(source).toContain('SCROLL_RESULTS');
    expect(source).toContain('MAP_ROWS');
    const clickAt = source.indexOf('js-lp-estimate-show-on-map');
    const scrollAt = source.indexOf('page.evaluate(SCROLL_RESULTS');
    const readAt = source.indexOf('page.evaluate<string[]>(MAP_ROWS');
    expect(scrollAt).toBeGreaterThan(clickAt);
    expect(readAt).toBeGreaterThan(scrollAt);
  });

  it('captures each row with the page section label so status is never invented', () => {
    // Both extractors emit "<section label><row text>".
    expect(source).toContain('labelFor(el)');
    expect(source).toContain('mapRows');
  });

  it('retains a screenshot of the expanded results list', () => {
    expect(source).toContain('landportal-compslist-');
  });
});
