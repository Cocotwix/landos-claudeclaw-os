// LandPortal jurisdiction filters — the second acceptance failure this sprint
// had to repair.
//
// THE LIVE FAILURE: the run reported that it had scoped the search to Tennessee →
// Roane and submitted the owner search, while BOTH jurisdiction dropdowns on
// screen still displayed "Select Value".
//
// ROOT CAUSE, in two halves:
//
//   1. The driver's setScope() reported success whenever it managed to CLICK an
//      option. It never read back what the widget then displayed, so a dependent
//      county list that had not finished loading, a still-disabled control, or a
//      click the widget ignored all produced a "confirmed" scope.
//   2. The search-configuration checkpoint compared the intent against THAT
//      self-report, and derived `jurisdictionScopingAvailable` from it — so when
//      scoping failed, the missing filters were downgraded from a blocker to an
//      "this surface offers no filter" note and the unscoped search went through.
//
// The contract asserted here: a jurisdiction filter counts only when the page
// DISPLAYS it, and a search whose filters cannot be seen is never submitted.

import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect, beforeEach } from 'vitest';

import type { BrowserDriver } from './browser-intelligence.js';
import { scopeLabelMatches } from './browser-session.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  assessScreenshotQuality, verifyResultSelection,
  type CaptureFrame, type CaptureIntent, type LandPortalSubject,
} from './landportal-capability.js';
import { makeLandPortalBrowser } from './landportal-browser.js';
import { listLeadCardIntake, persistLeadCardIntake } from './lead-card-intake.js';
import { upsertPropertyCard } from './property-card.js';
import { smartIntakeImageSha256 } from './smart-intake-image.js';

const ROANE_ROW = 'OLD RIDGE RD  090 04200  KINGSTON, TN, 37763  SACHAN DILEEP S  12.28 ac';
const NASHVILLE_ROW = '2604 COOPER LN  073-09-0-042-00  NASHVILLE, TN, 37216  SMOTHERMAN DEBRA';
const NOISE = Array.from({ length: 39 }, (_, i) => `PARCEL ${i} RD  1${i}0 0${i}100  MEMPHIS, TN, 381${String(i).padStart(2, '0')}  UNRELATED OWNER ${i}`);

const DEAL_32_KEY = {
  apn: '073090 04200',
  apnAlternates: ['090 04200', '073090-04200', '07309004200'],
  owner: 'SACHAN DILEEP S',
  address: 'OLD RIDGE RD, KINGSTON, TN 37763',
  city: 'KINGSTON',
  county: 'Roane',
  state: 'TN',
  zip: '37763',
  acreage: 12.28,
  lat: 35.80044080703417,
  lng: -84.46381750244866,
};

const SUBJECT: LandPortalSubject = { ...DEAL_32_KEY, address: 'OLD RIDGE RD' };

/** Displayed jurisdiction state of the two dropdowns, as the page renders them. */
interface ScopeDisplay { state: string | null; county: string | null; extras: string[] }

/**
 * A LandPortal whose jurisdiction dropdowns behave the way the real ones do, and
 * whose display state is configurable so each failure mode can be reproduced.
 *
 *  - `countyNeedsSecondPass`: the county list only populates after its state has
 *    been applied, so the FIRST setScope leaves the county on "Select Value".
 *  - `stateNeverApplies` / `countyNeverApplies`: the widget silently refuses the
 *    selection and keeps displaying the placeholder — the live failure.
 *  - `staleExtraFilter`: a filter left over from a previous property.
 */
function roaneLandPortal(opts: {
  countyNeedsSecondPass?: boolean;
  stateNeverApplies?: boolean;
  countyNeverApplies?: boolean;
  staleExtraFilter?: string;
  scopeControlsMissing?: boolean;
  failAfterSelection?: boolean;
} = {}) {
  // LandPortal's search is a typeahead: "submitting" is reading the result list
  // and opening a row, so `readCandidates` and `clickCandidate` are what prove
  // whether a search actually went ahead.
  const calls = {
    setScope: [] as string[][], readCandidates: 0, clickedCandidates: 0, screenshots: [] as string[],
    scopeBegin: 0, scopeClose: 0,
  };
  const display: ScopeDisplay = { state: null, county: null, extras: opts.staleExtraFilter ? [opts.staleExtraFilter] : [] };
  let phase: 'search' | 'roane' = 'search';
  let lastTyped = '';
  let lastMethod = '';

  const searchObs = () => ({
    url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
    navItems: ['Map Search'], buttons: ['Search'],
    searchControls: [{ selector: '#main_search_input', placeholder: 'APN, Address, or Owner', value: lastTyped }],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false,
    methodToggle: { current: lastMethod === 'owner' ? 'Owner' : lastMethod === 'apn' ? 'APN' : 'Address' },
  });
  const roaneObs = () => ({
    url: 'https://landportal.com/?property=roane-tn', title: 'Land Portal', headings: ['Property Overview'],
    navItems: ['Map Search'], buttons: [], searchControls: [], links: [], hasMap: true, hasTable: false,
    fields: {
      'Owner Name': 'SACHAN DILEEP S', 'Parcel ID': '090 04200', 'Parcel Address': 'OLD RIDGE RD',
      'City': 'KINGSTON', 'County': 'Roane', 'State': 'TN', 'Acres': '12.28',
      'Latitude': '35.80044', 'Longitude': '-84.46382',
    },
    loginLike: false,
  });

  const driver = {
    id: 'lp', configured: () => true,
    async beginOwnedPageScope() { calls.scopeBegin += 1; return 'scope-1'; },
    async closeOwnedPageScope() { calls.scopeClose += 1; return { closed: 2, failed: 0, preserved: 1 }; },
    async open() { phase = 'search'; lastTyped = ''; return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
    async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
    async readFields() { return { url: '', fields: {}, snippets: [] }; },
    async screenshot(purpose: string) { calls.screenshots.push(purpose); return { path: '/artifacts/lp.png', capturedAtIso: '2026-07-24T18:00:00.000Z', purpose }; },
    async observe() { return phase === 'roane' ? roaneObs() : searchObs(); },
    async selectMethod(m: string) { lastMethod = m; },
    // Applies what the widget would actually accept, then the page DISPLAYS it.
    async setScope(values: string[]) {
      calls.setScope.push([...values]);
      const applied: string[] = [];
      const [state, county] = values;
      if (state && !opts.stateNeverApplies) { display.state = 'Tennessee'; applied.push(display.state); }
      const countyReady = !opts.countyNeedsSecondPass || calls.setScope.length > 1;
      if (county && !opts.countyNeverApplies && countyReady) { display.county = 'Roane County'; applied.push(display.county); }
      return applied;
    },
    async readScope(): Promise<{ available: boolean; state: string | null; county: string | null; extras: string[] }> {
      if (opts.scopeControlsMissing) return { available: false, state: null, county: null, extras: [] };
      return { available: true, state: display.state, county: display.county, extras: [...display.extras] };
    },
    async typeSearch(_s: string, v: string) { lastTyped = v; phase = 'search'; },
    async readCandidates() {
      calls.readCandidates += 1;
      if (lastMethod === 'owner' && /SACHAN/i.test(lastTyped)) return [ROANE_ROW, ...NOISE].map((text, index) => ({ index, text, kind: 'row' }));
      if (lastMethod === 'apn') return [NASHVILLE_ROW, ...NOISE].map((text, index) => ({ index, text, kind: 'row' }));
      return [];
    },
    async clickCandidate(i: number) {
      calls.clickedCandidates += 1;
      if (opts.failAfterSelection) throw new Error('LandPortal stopped responding after the result was selected.');
      if (lastMethod === 'owner' && i === 0) { phase = 'roane'; }
    },
    async clickByText() { /* nav */ },
  } as unknown as BrowserDriver;

  return { driver, calls, display };
}

const run = (driver: BrowserDriver, timeoutMs = 4000) =>
  makeLandPortalBrowser({ driver }).runWorkflow({ searchKey: DEAL_32_KEY }, { timeoutMs });

/** The search-configuration checkpoints a run recorded. */
const configChecks = (ev: Awaited<ReturnType<typeof run>>) =>
  (ev.visualCheckpoints ?? []).filter((c) => c.kind === 'search_configuration');

beforeEach(() => _initTestLandosDb());

describe('a jurisdiction filter counts only when the page DISPLAYS it', () => {
  it('1. the state filter must display the selected state before submission', async () => {
    const { driver, calls } = roaneLandPortal({ stateNeverApplies: true });
    const ev = await run(driver);

    expect(ev.status).not.toBe('retrieved');
    expect(calls.readCandidates).toBe(0); // never got as far as reading results
    const blockers = configChecks(ev).flatMap((c) => c.blockers).join(' ');
    expect(blockers).toMatch(/State filter on screen is "none", intended "TN"/);
  });

  it('2. the county filter must display the selected county before submission', async () => {
    const { driver, calls } = roaneLandPortal({ countyNeverApplies: true });
    const ev = await run(driver);

    expect(ev.status).not.toBe('retrieved');
    expect(calls.readCandidates).toBe(0);
    const blockers = configChecks(ev).flatMap((c) => c.blockers).join(' ');
    expect(blockers).toMatch(/County filter on screen is "none", intended "Roane"/);
  });

  it('3. county selection waits for the chosen state to load its county list', async () => {
    // The real widget only populates counties after its state is applied, so the
    // first pass legitimately leaves the county unset. The run re-applies rather
    // than submitting an unscoped search.
    const { driver, calls } = roaneLandPortal({ countyNeedsSecondPass: true });
    const ev = await run(driver);

    expect(calls.setScope.length).toBeGreaterThan(1);
    expect(ev.note).toMatch(/scope-retry:1 state="Tennessee" county="none"/);
    expect(ev.note).toMatch(/scope-displayed:state="Tennessee",county="Roane County"/);
    expect(ev.status).toBe('retrieved');
  });

  it('4. the search is not submitted when visual filter verification fails', async () => {
    const { driver, calls } = roaneLandPortal({ stateNeverApplies: true, countyNeverApplies: true });
    const ev = await run(driver);

    expect(calls.readCandidates).toBe(0);
    expect(calls.clickedCandidates).toBe(0);
    expect(configChecks(ev).every((c) => !c.passed)).toBe(true);
    expect(ev.note).toMatch(/visual\(search-config\) BLOCKED/);
    // And the run says so honestly rather than reporting a verified search.
    expect(ev.note).not.toMatch(/visually verified \[/);
  });

  it('5. the search proceeds once both filters are visibly correct', async () => {
    const { driver, calls, display } = roaneLandPortal();
    const ev = await run(driver);

    expect(display.state).toBe('Tennessee');
    expect(display.county).toBe('Roane County');
    expect(calls.readCandidates).toBeGreaterThan(0);
    expect(calls.clickedCandidates).toBeGreaterThan(0);
    expect(configChecks(ev).some((c) => c.passed)).toBe(true);
    const confirmed = configChecks(ev).filter((c) => c.passed).flatMap((c) => c.confirmed).join(' ');
    expect(confirmed).toMatch(/State filter "Tennessee" is active/);
    expect(confirmed).toMatch(/County filter "Roane County" is active/);
    expect(ev.status).toBe('retrieved');
  });

  it('6. a stale filter left from another property blocks the search', async () => {
    const { driver, calls } = roaneLandPortal({ staleExtraFilter: 'Land use: Residential' });
    const ev = await run(driver);

    expect(calls.readCandidates).toBe(0);
    expect(configChecks(ev).flatMap((c) => c.blockers).join(' '))
      .toMatch(/Stale filter still active from another property: "Land use: Residential"/);
  });

  it('a surface with no jurisdiction controls is not faulted for lacking them', async () => {
    // Honesty in the other direction: "the site has no county filter" is not the
    // same as "the county filter is not applied", and must not be treated as one.
    const { driver } = roaneLandPortal({ scopeControlsMissing: true });
    const ev = await run(driver);
    const unverified = configChecks(ev).flatMap((c) => c.unverified).join(' ');
    expect(unverified).toMatch(/offers no state filter/);
    expect(unverified).toMatch(/offers no county filter/);
  });

  it('a driver that CAN see the controls is held to what they display; one that cannot is not blocked but is never called verified', async () => {
    // The authority rule. A visual driver reporting a placeholder is a blocker
    // (tests 1 and 2). A driver with no read-back cannot claim the controls even
    // exist, so it must not block every non-visual surface — but the run has to
    // say plainly that nothing was read off the page.
    const blind = roaneLandPortal();
    delete (blind.driver as { readScope?: unknown }).readScope;
    const ev = await run(blind.driver);
    expect(ev.note).toMatch(/scope-not-visually-readable:applied="Tennessee\/Roane County"/);
    expect(ev.note).not.toMatch(/scope-displayed:/);

    // And when it applies nothing at all, the filters are recorded as unverified
    // rather than asserted as active.
    const blindAndFailing = roaneLandPortal({ stateNeverApplies: true, countyNeverApplies: true });
    delete (blindAndFailing.driver as { readScope?: unknown }).readScope;
    const ev2 = await run(blindAndFailing.driver);
    const unverified = configChecks(ev2).flatMap((c) => c.unverified).join(' ');
    expect(unverified).toMatch(/offers no state filter/);
    expect(configChecks(ev2).flatMap((c) => c.confirmed).join(' ')).not.toMatch(/filter "[^"]+" is active/);
  });

  it('the displayed label is compared tolerantly ("Roane" vs "Roane County")', () => {
    expect(scopeLabelMatches('Roane County', 'Roane')).toBe(true);
    expect(scopeLabelMatches('Tennessee', 'Tennessee')).toBe(true);
    expect(scopeLabelMatches('Select Value', 'Roane')).toBe(false);
    expect(scopeLabelMatches('Davidson County', 'Roane')).toBe(false);
  });
});

describe('the filtered owner search reaches the right parcel and refuses the wrong one', () => {
  it('7. Deal 32 owner search ranks the OLD RIDGE RD result first', () => {
    const candidates = [ROANE_ROW, ...NOISE].map((text, index) => ({ index, text, kind: 'row' as const }));
    const selection = verifyResultSelection(candidates, SUBJECT);
    expect(selection.selected?.candidate.index).toBe(0);
    expect(selection.selected?.candidate.text).toMatch(/OLD RIDGE RD/);
    expect(selection.checkpoint.passed).toBe(true);
  });

  it('8. a cross-county APN collision (Nashville) is never selected', () => {
    const candidates = [NASHVILLE_ROW, ...NOISE].map((text, index) => ({ index, text, kind: 'row' as const }));
    const selection = verifyResultSelection(candidates, SUBJECT);
    expect(selection.selected).toBeFalsy();
    expect(selection.checkpoint.passed).toBe(false);
  });

  it('9. the state-format APN reconciles with the county-local APN only in the right county', async () => {
    const { driver } = roaneLandPortal();
    const ev = await run(driver);
    // 073090 04200 (state format) and 090 04200 (LandPortal county-local) are the
    // same Roane parcel — reconciled, never flagged as a conflict.
    expect(ev.facts.find((f) => f.key === 'apn')?.value).toBe('090 04200');
    expect(ev.facts.some((f) => f.key === 'apnConflict')).toBe(false);
    // The same digits in Davidson are a different parcel and are refused.
    const davidson = verifyResultSelection(
      [{ index: 0, text: NASHVILLE_ROW, kind: 'row' as const }],
      SUBJECT,
    );
    expect(davidson.selected).toBeFalsy();
  });
});

describe('a capture is evidence only when it proves its fact', () => {
  const intent: CaptureIntent = {
    provesFact: 'The subject parcel as LandPortal renders it, with its boundary in context.',
    boundaryRequired: true,
    subject: SUBJECT,
  };
  const frame = (over: Partial<CaptureFrame> = {}): CaptureFrame => ({
    url: 'https://landportal.com/?property=roane-tn',
    parcelApn: '090 04200',
    intendedOverlay: null, activeOverlay: null,
    boundaryVisible: true, tilesLoaded: true, obstructions: [],
    bytes: 400_000, screenshotPath: '/artifacts/lp.png',
    ...over,
  });

  it('10. accepts only a capture with the parcel, a visible boundary, loaded tiles, readable bytes and no obstruction', () => {
    expect(assessScreenshotQuality(frame(), intent).result).toBe('accepted');
    expect(assessScreenshotQuality(frame({ boundaryVisible: false }), intent).result).toBe('recapture_required');
    expect(assessScreenshotQuality(frame({ tilesLoaded: false }), intent).result).toBe('recapture_required');
    expect(assessScreenshotQuality(frame({ obstructions: ['modal dialog'] }), intent).result).toBe('recapture_required');
    expect(assessScreenshotQuality(frame({ bytes: 120 }), intent).result).toBe('recapture_required');
    expect(assessScreenshotQuality(frame({ screenshotPath: null }), intent).result).toBe('unavailable');
  });

  it('only accepted captures are ever presented as evidence', async () => {
    const { driver } = roaneLandPortal();
    const ev = await run(driver);
    const accepted = (ev.captureVerdicts ?? []).filter((v) => v.result === 'accepted').length;
    expect(ev.screenshots.length).toBe(accepted);
  });

  it('NO retrieval path can present a LandPortal screenshot without a quality verdict', () => {
    // Structural invariant across the whole module: agentic, workflow and legacy.
    // Two paths used to push a capture straight into the evidence set.
    const src = fs.readFileSync(path.join(process.cwd(), 'src/landos/landportal-browser.ts'), 'utf8');
    const lines = src.split(/\r?\n/);
    const pushes = lines
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => l.line.includes('ev.screenshots.push'));
    // Exactly two push sites exist, and both are the body of a gate that has
    // already assessed the capture: `recordLandPortalCapture` (workflow + legacy)
    // and the agentic `acceptCapture`. Anything else is an ungated capture.
    expect(pushes.map((p) => p.line)).toEqual(['ev.screenshots.push(shot);', 'ev.screenshots.push(shot);']);
    expect(src).toMatch(/function recordLandPortalCapture\([\s\S]{0,600}assessScreenshotQuality\(frame, intent\)[\s\S]{0,400}ev\.screenshots\.push\(shot\)/);
    expect(src).toMatch(/const acceptCapture = \([\s\S]{0,700}assessScreenshotQuality\([\s\S]{0,600}ev\.screenshots\.push\(shot\)/);
  });

  it('a capture of a DIFFERENT parcel than the one verified is still rejected', () => {
    // The guard must stay non-vacuous: judging against the verified record must
    // not become "judge against whatever the page currently shows".
    const verdict = assessScreenshotQuality(frame({ parcelApn: '073-09-0-042-00' }), {
      ...intent,
      subject: { ...SUBJECT, apn: '073090 04200', apnAlternates: ['090 04200'] },
    });
    expect(verdict.result).toBe('recapture_required');
    expect(verdict.reason).toMatch(/Selected parcel is "073-09-0-042-00"/);
  });

  it('the capture is judged against the parcel the PAGE opened, not the input identifier', async () => {
    // An owner search legitimately starts with no APN. Judging the saved image
    // against the input identifier rejected a correct capture of the right parcel
    // with "selected parcel is none"; the opened record's own APN is the answer.
    const { driver } = roaneLandPortal();
    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { ...DEAL_32_KEY, apn: undefined, apnAlternates: ['073090 04200', '090 04200'] } },
      { timeoutMs: 4000 },
    );
    expect(ev.status).toBe('retrieved');
    expect((ev.captureVerdicts ?? []).every((v) => v.result === 'accepted')).toBe(true);
    expect(ev.screenshots.length).toBeGreaterThan(0);
  });
});

describe('11. every outcome closes LandOS-owned LandPortal pages and preserves operator tabs', () => {
  it('closes them on success', async () => {
    const { driver, calls } = roaneLandPortal();
    const ev = await run(driver);
    expect(ev.status).toBe('retrieved');
    expect(calls.scopeBegin).toBe(1);
    expect(calls.scopeClose).toBe(1);
    expect(ev.browserCleanup).toEqual({ closed: 2, failed: 0, preserved: 1 });
    expect(ev.note).toMatch(/browser cleanup: 2 page\(s\) closed, 1 operator page\(s\) preserved/);
  });

  it('closes them when visual verification rejects the search', async () => {
    const { driver, calls } = roaneLandPortal({ stateNeverApplies: true, countyNeverApplies: true });
    const ev = await run(driver);
    expect(ev.status).not.toBe('retrieved');
    expect(calls.scopeClose).toBe(1);
    expect(ev.browserCleanup?.closed).toBe(2);
  });

  it('closes them when the page fails mid-run', async () => {
    const { driver, calls } = roaneLandPortal({ failAfterSelection: true });
    await run(driver);
    expect(calls.scopeClose).toBe(1);
  });

  it('closes them when the run times out', async () => {
    const { driver, calls } = roaneLandPortal();
    await run(driver, 1); // a timeout budget nothing can complete inside
    expect(calls.scopeClose).toBe(1);
  });
});

describe('12. the filtered rerun never loses or duplicates Smart Intake evidence', () => {
  it('a LandPortal run leaves the retained original untouched', async () => {
    const card = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'OLD RIDGE RD', city: 'KINGSTON', county: 'Roane',
      state: 'TN', apn: '073090 04200', owner: 'SACHAN DILEEP S', acres: 12.28,
      verified: true, verificationSource: 'Tennessee Comptroller public parcel layer',
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'LandPortal filtered rerun' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await persistLeadCardIntake({
      dealCardId: deal.id, text: 'Original acceptance screenshot.', idempotencyKey: 'lp-rerun-1',
      imageArtifacts: [{
        documentUploadId: 7, originalFileName: 'codex-clipboard.png',
        fileUrl: `/api/landos/deal-cards/${deal.id}/documents/upload-file/codex-clipboard.png`,
        mimeType: 'image/png', byteSize: 2949777, sha256: smartIntakeImageSha256(png), sourceMethod: 'upload',
        extraction: {
          status: 'complete', exactText: 'OLD RIDGE RD', candidates: { owner: 'SACHAN DILEEP S' },
          uncertainFields: [], missingFields: [], notes: [], otherFacts: [], model: 'test-vision-model',
        },
      }],
    });
    const before = getLandosDb().prepare('SELECT id, sha256 FROM landos_intake_artifact WHERE deal_card_id=?').all(deal.id);

    const { driver } = roaneLandPortal();
    await run(driver);
    await run(driver); // rerun

    const after = getLandosDb().prepare('SELECT id, sha256 FROM landos_intake_artifact WHERE deal_card_id=?').all(deal.id);
    expect(after).toEqual(before);
    expect(listLeadCardIntake(deal.id)).toHaveLength(1);
  });
});
