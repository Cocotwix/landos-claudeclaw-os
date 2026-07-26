import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LandPortal visual capture contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/landos/browser-session.ts'), 'utf8');

  it('uses exact overlay controls and closes the dialog before each screenshot', () => {
    const captureStart = source.indexOf('const captureOverlay = async');
    const captureEnd = source.indexOf("await captureOverlay('Contour Lines'", captureStart);
    const capture = source.slice(captureStart, captureEnd);

    expect(capture).toContain('`Enable ${label}`');
    expect(capture).toContain('`Disable ${label}`');
    expect(capture).toContain('await closeOverlayDialog()');
    expect(capture.indexOf('await closeOverlayDialog()')).toBeLessThan(capture.indexOf('await page.screenshot'));
    expect(capture).not.toContain('clickVisible');
  });

  it('reuses the authenticated working tab so the SPA property route retains session state', () => {
    const captureStart = source.indexOf('async captureLandPortalVisuals');
    const captureEnd = source.indexOf('// Full-panel read', captureStart);
    const capture = source.slice(captureStart, captureEnd);
    expect(capture).toContain('let page = await getWorkingPage()');
    expect(capture).not.toContain('const page = await state.browser.newPage()');
    expect(capture).toContain('for (const candidate of await state.browser.pages())');
    expect(capture).toContain('reusedReadyParcelPage');
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

  it('zooms the retained 2D parcel screenshot out five steps before capture', () => {
    const zoomAt = source.indexOf('await zoomOutParcelMap(5)');
    const parcelShotAt = source.indexOf('await page.screenshot({ path: parcelFile })');
    expect(source).toContain("clickNamedButton('Fit')");
    expect(source).toContain("clickNamedButton('Zoom out')");
    expect(source).toContain("page.keyboard.press('-')");
    expect(source).toContain('zoomedOutSteps !== 5');
    expect(zoomAt).toBeGreaterThan(-1);
    expect(parcelShotAt).toBeGreaterThan(zoomAt);
  });

  it('orients the road below the parcel and refuses an unpainted satellite canvas', () => {
    expect(source).toContain("page.keyboard.press('Shift+ArrowRight')");
    expect(source).toContain('landportal_visual_orientation');
    expect(source).toContain("reason: 'satellite_tiles_unpainted'");
    expect(source).toContain('fs.statSync(parcelFile).size < 500_000');
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
