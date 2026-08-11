import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REGRESSION: LandPortal, deal 83, "9490 Elk Lake Rd".
 *
 * The address was typed, the suggestion list appeared, and the run then clicked
 * candidate #0 — which was the site's own "Map Search" tab, not the top
 * suggestion. The stored trace read:
 *
 *   address:"9490 Elk Lake Rd"→12 cand, pick#0(first_plausible_address_candidate)
 *   →results_list, ADDR-MISMATCH sample: Map Search || Market research ||
 *   9490, Elk Lake Road Grand Traverse MI
 *
 * The real top suggestion sat at index 2, behind two navigation items that the
 * broad selector net had swept in. These tests pin the two properties that make
 * "select the TOP suggestion" mean what it says.
 */
describe('candidate collection: the top suggestion is index 0', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/landos/browser-session.ts'), 'utf8');

  it('reads and clicks through ONE shared collector, so an index cannot mean two things', () => {
    // Exactly one definition of the collector, referenced by both paths.
    expect(source.match(/const CANDIDATE_COLLECTOR_JS = /g)).toHaveLength(1);
    expect(source).toContain('var found = ${CANDIDATE_COLLECTOR_JS}');
    // And no hand-copied second net: the broad selector list appears only
    // inside that one collector.
    expect(source.match(/\.leaflet-popup-content,\[class\*="popup" i\]/g)).toHaveLength(1);

    const readAt = source.indexOf('async readCandidates()');
    const clickAt = source.indexOf('async clickCandidate(index, opts)');
    expect(readAt).toBeGreaterThan(-1);
    expect(clickAt).toBeGreaterThan(readAt);
    const read = source.slice(readAt, clickAt);
    expect(read).toContain('READ_CANDIDATES_JS');
    expect(read).not.toContain('querySelectorAll');
  });

  it('prefers the suggestion list attached to the search input over the generic net', () => {
    const start = source.indexOf('const CANDIDATE_COLLECTOR_JS');
    const end = source.indexOf('interface CandidateBox', start);
    const collector = source.slice(start, end);

    // The dropdown is identified structurally — beneath the input and
    // horizontally overlapping it — not by any vendor class name.
    expect(collector).toContain('r.top >= ir.bottom - 12 && r.top <= ir.bottom + 24');
    expect(collector).toContain('r.left < ir.right && r.right > ir.left');

    // Order of authority: attached dropdown → explicit option roles → broad net.
    const suggestionAt = collector.indexOf('collect(suggestionItems, false)');
    const optionAt = collector.indexOf('querySelectorAll(OPTION_SEL)');
    const broadAt = collector.indexOf('querySelectorAll(BROAD_SEL)');
    expect(suggestionAt).toBeGreaterThan(-1);
    expect(suggestionAt).toBeLessThan(optionAt);
    expect(optionAt).toBeLessThan(broadAt);

    // DOM order is preserved, so index 0 IS the top suggestion. Nothing sorts.
    expect(collector).not.toMatch(/\.sort\(/);
  });

  it('never lets site navigation become a search result', () => {
    const start = source.indexOf('const CANDIDATE_COLLECTOR_JS');
    const end = source.indexOf('interface CandidateBox', start);
    const collector = source.slice(start, end);

    // "Map Search" and "Market research" are LandPortal tabs; the broad net now
    // excludes nav/header/tablist/sidebar chrome.
    expect(collector).toContain('CHROME_SEL');
    for (const chrome of ['nav', 'header', '[role=navigation]', '[role=tablist]', '[class*="sidebar" i]']) {
      expect(collector).toContain(chrome);
    }
    expect(collector).toContain("el.closest(CHROME_SEL)");
    expect(collector).toContain('querySelectorAll(BROAD_SEL)), true)');
    // The exact paths that are already unambiguous do NOT strip chrome, so a
    // dropdown rendered inside a menu-classed wrapper is still readable.
    expect(collector).toContain('collect(suggestionItems, false)');
    expect(collector).toContain('querySelectorAll(OPTION_SEL)), false)');
  });
});

describe('candidate selection uses a real browser interaction', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/landos/browser-session.ts'), 'utf8');

  it('clicks with the mouse and falls back to a DOM click only when it cannot', () => {
    const start = source.indexOf('async clickCandidate(index, opts)');
    const end = source.indexOf('async typeSearch(', start);
    const click = source.slice(start, end);

    expect(click).toContain('page.mouse.move(box.x, box.y');
    expect(click).toContain('page.mouse.down()');
    expect(click).toContain('page.mouse.up()');
    // Both must never fire: the first click may already have navigated.
    expect(click).toContain('if (!clicked) await page.evaluate<boolean>(clickCandidateJs(index))');
  });

  it('opens its lane tab in the BACKGROUND so Chrome never takes the operator\'s screen', () => {
    const start = source.indexOf('const getLanePage = async');
    const end = source.indexOf('const nav = async', start);
    const lane = source.slice(start, end);

    expect(lane).toContain('await openResearchTab(state.browser)');
    expect(lane).not.toContain('bringToFront');

    const helper = source.slice(source.indexOf('async function openBackgroundTab'), source.indexOf('/* ── RESULT / SUGGESTION CANDIDATE COLLECTOR'));
    expect(helper).toContain("'Target.createTarget', { url: 'about:blank', background: true }");
    // A failure here must never fail the lane.
    expect(helper).toContain('return null;');
    // newPage() survives only inside the shared helper, as the CDP fallback.
    const research = source.slice(source.indexOf('async function openResearchTab'), source.indexOf('/* ── RESULT / SUGGESTION CANDIDATE COLLECTOR'));
    expect(research).toContain('await browser.newPage()');
    expect(research).toContain('await suppressPopups(page)');
  });

  it('suppresses page-opened popups at DOCUMENT START, not at click time', () => {
    // The click-time shim did not hold: LandPortal still opened
    // ?market_comps=… as a page-created target, which Chrome activates. A
    // bundle that captured window.open at load time never sees a late shim.
    const start = source.indexOf('const SUPPRESS_POPUPS_JS');
    const end = source.indexOf('async function openResearchTab', start);
    const suppressor = source.slice(start, end);

    expect(suppressor).toContain('window.open = function () { return stub(); }');
    // Capture phase, so it runs before the site's own click handlers.
    expect(suppressor).toContain("document.addEventListener('click', function (event) {");
    expect(suppressor).toContain('}, true);');
    expect(suppressor).toContain('event.preventDefault()');
    // Installed through the document-start hook, never a plain evaluate.
    expect(source).toContain('page.evaluateOnNewDocument?.(SUPPRESS_POPUPS_JS)');
  });

  it('suppresses the popup WITHOUT navigating the lane off the parcel page', () => {
    // Retargeting to _self was tried and reverted: it moved the navigation into
    // the lane tab, sent it into LandPortal's comps SPA, and the lane then
    // exceeded its 90s budget (verified runs sit at 63-71s). Option A cancels
    // the navigation instead of relocating it.
    const start = source.indexOf('const SUPPRESS_POPUPS_JS');
    const end = source.indexOf('async function openResearchTab', start);
    const suppressor = source.slice(start, end);

    expect(suppressor).not.toContain("target = '_self'");
    expect(suppressor).not.toContain('window.location.href =');
    expect(suppressor).not.toContain('location.href = String(u)');

    // And the comps click itself is back to exactly what the verified runs ran.
    const clickStart = source.indexOf('Click the real comps "Show on Map" anchor');
    const clickEnd = source.indexOf('let compsMapShotPath', clickStart);
    const click = source.slice(clickStart, clickEnd);
    expect(click).toContain('a.js-lp-estimate-show-on-map');
    expect(click).not.toContain("a.target = '_self'");
    expect(click).not.toContain('(window as any).open');
  });

  it('never lets LandPortal open the comps map in a popup Chrome would foreground', () => {
    // A CDP target trace showed exactly one target ever becoming its window's
    // active tab: landportal.com/?market_comps=…, with `openerId` = our lane
    // page. The page opened it via target="_blank"; a page-opened target cannot
    // be created with background:true, so the only fix is to not create it.
    const start = source.indexOf('Click the real comps "Show on Map" anchor');
    const end = source.indexOf('let compsMapShotPath', start);
    const click = source.slice(start, end);

    // The click is UNCHANGED from the verified runs. The popup is cancelled
    // upstream by the document-start suppressor, so this call site stays exactly
    // as the completed Comps workflow left it.
    expect(click).toContain('a.js-lp-estimate-show-on-map');
    expect(click).toContain('a.scrollIntoView(); a.click();');
    expect(click).not.toContain('bringToFront');
  });

  it('opens EVERY LandPortal research tab in the background, not just the lane tab', () => {
    // The comp-detail tab and the full-panel reader were the two that still
    // activated: the live watch caught landportal.com/?market_comps=… becoming
    // its window's selected tab mid-run.
    const foreground = source.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes('.newPage()'))
      .filter((line) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'));
    // Exactly one newPage() survives, inside openResearchTab, as the fallback
    // for when the CDP background route is unavailable.
    expect(foreground).toEqual(['const page = await browser.newPage();']);
  });

  it('activates a tab in exactly ONE place: the operator pressing "Open LandPortal"', () => {
    // Research must never activate. The manual-login entry point is the single
    // deliberate exception, because the operator asked to SEE LandPortal.
    const activations = source.split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => l.line.includes('bringToFront?.()') && !l.line.trim().startsWith('//'));
    expect(activations).toHaveLength(2);

    const openAt = source.indexOf('export async function openLandPortalInSession');
    const openEnd = source.indexOf('export async function', openAt + 10);
    const openBody = source.slice(openAt, openEnd);
    expect(openBody).toContain('bringToFront?.()');

    // The other one is the offscreen-window capture path, still gated so a
    // pre-existing VISIBLE Chrome is never raised.
    const guarded = source.indexOf('if (state.launchedBackground) {');
    expect(guarded).toBeGreaterThan(-1);
    expect(source.slice(guarded, guarded + 220)).toContain('bringToFront?.()');
  });
});
