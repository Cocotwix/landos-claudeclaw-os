// Shared LandPortal capability — the visual-verification, screenshot-quality, and
// browser-lifecycle contracts. Deal 32 (Roane County, TN) is the acceptance case:
// LandOS had enough confirmed information to find the parcel and reported "40
// candidates, no confident match" while the correct result was visibly first.

import { readFileSync } from 'node:fs';

import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestLandosDb } from './db.js';
import {
  verifySearchConfiguration, verifyResultSelection, verifyParcelSelected,
  verifyPreCapture, assessScreenshotQuality, captureVerified,
  requireVisualCheckpoint, LandPortalVisualVerificationError,
  apnIdentifiersEquivalent, rankLandPortalResults,
  runLandPortalJob, runLandPortalJanitor, openLandPortalResourceCount,
  persistCaptureVerdict, readAcceptedCaptures,
  MIN_USEFUL_CAPTURE_BYTES,
  type LandPortalSubject, type SearchConfigurationFrame, type ParcelDetailFrame,
  type CaptureFrame, type CaptureIntent, type TrackedLandPortalResource,
} from './landportal-capability.js';

// ── The Deal 32 subject, exactly as the operator confirmed it ────────────────
const DEAL_32: LandPortalSubject = {
  owner: 'SACHAN DILEEP S',
  address: 'OLD RIDGE RD',
  city: 'KINGSTON',
  state: 'TN',
  zip: '37763',
  county: 'Roane County',
  apn: '073090 04200',
  apnAlternates: ['090 04200', '073090-04200', '07309004200'],
  acreage: 12.28,
  lat: 35.80044080703417,
  lng: -84.46381750244866,
};

// The real LandPortal owner-search result set: the correct parcel is first,
// followed by unrelated same-owner-surname noise across the state.
const OWNER_SEARCH_RESULTS = [
  { index: 0, text: 'OLD RIDGE RD  090 04200  KINGSTON, TN, 37763  SACHAN DILEEP S  12.28 ac', kind: 'row' },
  ...Array.from({ length: 39 }, (_, i) => ({
    index: i + 1,
    text: `PARCEL ${i} RD  1${i}0 0${i}100  MEMPHIS, TN, 381${String(i).padStart(2, '0')}  UNRELATED OWNER ${i}`,
    kind: 'row',
  })),
];

// The cross-county collision: a Davidson-county (Nashville) parcel whose APN
// string matches the Roane state-format APN.
const NASHVILLE_COLLISION = {
  index: 0,
  text: '2604 COOPER LN  073-09-0-042-00  NASHVILLE, TN, 37216  SMOTHERMAN DEBRA',
  kind: 'row',
};

const configFrame = (over: Partial<SearchConfigurationFrame> = {}): SearchConfigurationFrame => ({
  url: 'https://landportal.com/',
  selectedMode: 'owner',
  enteredValues: { owner: 'SACHAN DILEEP S' },
  activeState: 'Tennessee',
  activeCounty: 'Roane',
  activeFilters: [],
  screenshotPath: '/artifacts/search-config.png',
  ...over,
});

const detailFrame = (over: Partial<ParcelDetailFrame> = {}): ParcelDetailFrame => ({
  url: 'https://landportal.com/?property=roane-tn',
  parcelHighlighted: true,
  detailPanelOpen: true,
  owner: 'SACHAN DILEEP S',
  address: 'OLD RIDGE RD',
  city: 'KINGSTON',
  county: 'Roane',
  state: 'TN',
  apn: '090 04200',
  acreage: 12.28,
  lat: 35.8004408, lng: -84.4638175,
  screenshotPath: '/artifacts/parcel.png',
  ...over,
});

const captureIntent: CaptureIntent = {
  provesFact: 'The subject parcel boundary in road context.',
  boundaryRequired: true,
  subject: DEAL_32,
};

const captureFrame = (over: Partial<CaptureFrame> = {}): CaptureFrame => ({
  url: 'https://landportal.com/?property=roane-tn',
  parcelApn: '090 04200',
  intendedOverlay: null,
  activeOverlay: null,
  boundaryVisible: true,
  tilesLoaded: true,
  obstructions: [],
  bytes: 240_000,
  screenshotPath: '/artifacts/parcel-boundary.png',
  ...over,
});

// ═══ 1. Visual verification is required before search submission ════════════
describe('visual verification is required before a LandPortal search is submitted', () => {
  it('passes only when the mode, values and jurisdiction filters on screen are correct', () => {
    const cp = verifySearchConfiguration(configFrame(), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    });
    expect(cp.passed).toBe(true);
    expect(cp.confirmed.join(' ')).toMatch(/Tennessee/);
    expect(cp.confirmed.join(' ')).toMatch(/Roane/);
  });

  it('blocks submission when nothing was visually inspected', () => {
    const cp = verifySearchConfiguration(configFrame({ screenshotPath: null }), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    });
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/No visual capture/i);
  });

  it('blocks submission when the wrong search mode is selected on screen', () => {
    const cp = verifySearchConfiguration(configFrame({ selectedMode: 'apn' }), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    });
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/mode on screen is "apn"/i);
  });

  it('blocks submission when the entered value on screen is not what was intended', () => {
    const cp = verifySearchConfiguration(configFrame({ enteredValues: { owner: 'SACHAN DILEEP' } }), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    });
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/Entered owner value on screen/i);
  });

  it('blocks submission when a stale county filter from another property is still active', () => {
    const cp = verifySearchConfiguration(configFrame({ activeCounty: 'Davidson' }), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    });
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/County filter on screen is "Davidson"/i);
  });

  it('blocks submission when a value from a previous search is still in another field', () => {
    const cp = verifySearchConfiguration(
      configFrame({ enteredValues: { owner: 'SACHAN DILEEP S', apn: '094-020.08' } }),
      { mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true },
    );
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/Stale "apn" value/i);
  });

  it('records an unobservable signal as unverified rather than claiming it matched', () => {
    const cp = verifySearchConfiguration(configFrame({ selectedMode: null, enteredValues: {} }), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    });
    expect(cp.unverified.join(' ')).toMatch(/does not display which search mode/i);
    expect(cp.unverified.join(' ')).toMatch(/does not echo the entered owner value/i);
    expect(cp.confirmed.join(' ')).not.toMatch(/mode "owner" is selected/i);
  });

  it('the gate throws when a consequential action is attempted without a passing checkpoint', () => {
    const failing = verifySearchConfiguration(configFrame({ screenshotPath: null }), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32,
    });
    expect(() => requireVisualCheckpoint(failing)).toThrow(LandPortalVisualVerificationError);
    expect(() => requireVisualCheckpoint(verifySearchConfiguration(configFrame(), {
      mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
    }))).not.toThrow();
  });
});

// ═══ 2, 6, 7, 9. Visual verification before result selection ════════════════
describe('visual verification is required before a LandPortal result is selected', () => {
  it('Deal 32: owner search selects the OLD RIDGE RD Roane County result', () => {
    const { checkpoint, selected } = verifyResultSelection(OWNER_SEARCH_RESULTS, DEAL_32);
    expect(checkpoint.passed).toBe(true);
    expect(selected).not.toBeNull();
    expect(selected!.candidate.index).toBe(0);
    expect(selected!.candidate.text).toMatch(/OLD RIDGE RD/);
    expect(selected!.confidence).toBe('high');
  });

  it('Deal 32: the selection is a field-by-field comparison, not a text guess', () => {
    const { selected, checkpoint } = verifyResultSelection(OWNER_SEARCH_RESULTS, DEAL_32);
    expect(selected!.comparison).toMatchObject({
      owner: true, road: true, city: true, state: true, zip: true, apn: true, acreage: true,
    });
    expect(checkpoint.confirmed.join(' ')).toMatch(/Compared owner=true road=true/);
  });

  it('exact owner + exact county + exact road ranks above unrelated candidates', () => {
    const ranked = rankLandPortalResults(OWNER_SEARCH_RESULTS, DEAL_32);
    expect(ranked[0].candidate.index).toBe(0);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('never reports "no confident match" when the exact owner/road/county row is present', () => {
    const { checkpoint } = verifyResultSelection(OWNER_SEARCH_RESULTS, DEAL_32);
    expect(checkpoint.blockers).toHaveLength(0);
  });

  it('rejects the cross-county Nashville APN collision', () => {
    const { checkpoint, selected } = verifyResultSelection([NASHVILLE_COLLISION], DEAL_32);
    expect(selected).toBeNull();
    expect(checkpoint.passed).toBe(false);
    expect(checkpoint.confirmed.join(' ')).toMatch(/cross-jurisdiction identifier collision/i);
  });

  it('prefers the Roane result over the Nashville collision when both are visible', () => {
    const { selected } = verifyResultSelection([NASHVILLE_COLLISION, ...OWNER_SEARCH_RESULTS.map((r) => ({ ...r, index: r.index + 100 }))], DEAL_32);
    expect(selected!.candidate.text).toMatch(/OLD RIDGE RD/);
  });

  it('selects nothing when two results tie at high confidence', () => {
    const twin = { ...OWNER_SEARCH_RESULTS[0], index: 99 };
    const { selected, checkpoint } = verifyResultSelection([OWNER_SEARCH_RESULTS[0], twin], DEAL_32);
    expect(selected).toBeNull();
    expect(checkpoint.blockers.join(' ')).toMatch(/tie at high confidence/i);
  });

  it('selects nothing when there is nothing to compare', () => {
    const { selected, checkpoint } = verifyResultSelection([], DEAL_32);
    expect(selected).toBeNull();
    expect(checkpoint.blockers.join(' ')).toMatch(/No result rows/i);
  });
});

// ═══ 3, 8. Visual verification after parcel selection ═══════════════════════
describe('visual verification is required after a LandPortal parcel is selected', () => {
  it('confirms the highlighted parcel, panel, owner, road, county, state, APN, acreage and map', () => {
    const cp = verifyParcelSelected(detailFrame(), DEAL_32);
    expect(cp.passed).toBe(true);
    const confirmed = cp.confirmed.join(' ');
    expect(confirmed).toMatch(/highlighted on the map/i);
    expect(confirmed).toMatch(/detail panel is open/i);
    expect(confirmed).toMatch(/Owner of record matches/i);
    expect(confirmed).toMatch(/Road\/situs matches/i);
    expect(confirmed).toMatch(/County matches/i);
    expect(confirmed).toMatch(/Acreage matches/i);
    expect(confirmed).toMatch(/Map location matches/i);
  });

  it('reconciles the state-prefixed APN 073090 04200 with the county-local 090 04200 in Roane', () => {
    const cp = verifyParcelSelected(detailFrame({ apn: '090 04200' }), DEAL_32);
    expect(cp.passed).toBe(true);
    expect(cp.confirmed.join(' ')).toMatch(/APN reconciles with the subject identifier: 090 04200/);
    expect(apnIdentifiersEquivalent('073090 04200', '090 04200')).toBe(true);
  });

  it('does not reconcile the Nashville parcel identifier with the Roane parcel', () => {
    expect(apnIdentifiersEquivalent('073090 04200', '073-09-0-042-00')).toBe(false);
    const cp = verifyParcelSelected(detailFrame({
      apn: '073-09-0-042-00', owner: 'SMOTHERMAN DEBRA', address: '2604 COOPER LN', county: 'Davidson', city: 'NASHVILLE',
    }), DEAL_32);
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/County on the parcel detail is "Davidson"/);
    expect(cp.blockers.join(' ')).toMatch(/Owner on the parcel detail is "SMOTHERMAN DEBRA"/);
  });

  it('blocks extraction when the detail panel never opened', () => {
    const cp = verifyParcelSelected(detailFrame({ detailPanelOpen: false }), DEAL_32);
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/detail panel is not open/i);
  });

  it('blocks extraction when the selected parcel was never looked at', () => {
    const cp = verifyParcelSelected(detailFrame({ screenshotPath: null }), DEAL_32);
    expect(cp.passed).toBe(false);
    expect(cp.blockers.join(' ')).toMatch(/No visual capture of the selected parcel/i);
  });

  it('records a field the page does not display as unverified, not as agreement', () => {
    const cp = verifyParcelSelected(detailFrame({ county: null, acreage: null }), DEAL_32);
    expect(cp.passed).toBe(true);
    expect(cp.unverified.join(' ')).toMatch(/does not display a county/i);
    expect(cp.unverified.join(' ')).toMatch(/does not display acreage/i);
    expect(cp.confirmed.join(' ')).not.toMatch(/County matches/i);
  });

  it('a differing APN on a situs-corroborated parcel is an operator review flag, not a rejection', () => {
    const cp = verifyParcelSelected(detailFrame({ apn: '999 11111' }), DEAL_32);
    expect(cp.passed).toBe(true);
    expect(cp.unverified.join(' ')).toMatch(/needs operator review/i);
  });
});

// ═══ 4, 5. Screenshot quality ═══════════════════════════════════════════════
describe('a LandPortal screenshot cannot be accepted without visual quality verification', () => {
  it('accepts a capture that proves its fact', () => {
    const v = assessScreenshotQuality(captureFrame(), captureIntent);
    expect(v.result).toBe('accepted');
    expect(v.checkpoint.passed).toBe(true);
  });

  it('reports unavailable when the browser produced no image at all', () => {
    const v = assessScreenshotQuality(captureFrame({ screenshotPath: null }), captureIntent);
    expect(v.result).toBe('unavailable');
    expect(v.checkpoint.blockers.join(' ')).toMatch(/No image was produced/i);
  });

  it('rejects a blank capture', () => {
    const v = assessScreenshotQuality(captureFrame({ bytes: MIN_USEFUL_CAPTURE_BYTES - 1 }), captureIntent);
    expect(v.result).toBe('recapture_required');
    expect(v.reason).toMatch(/blank or torn/i);
  });

  it('rejects a capture with the boundary missing', () => {
    expect(assessScreenshotQuality(captureFrame({ boundaryVisible: false }), captureIntent).result).toBe('recapture_required');
  });

  it('rejects a capture obstructed by a dialog', () => {
    const v = assessScreenshotQuality(captureFrame({ obstructions: ['cookie dialog', 'overlay dropdown'] }), captureIntent);
    expect(v.result).toBe('recapture_required');
    expect(v.reason).toMatch(/Obstructed by: cookie dialog/i);
  });

  it('rejects a capture taken before the map tiles loaded', () => {
    expect(assessScreenshotQuality(captureFrame({ tilesLoaded: false }), captureIntent).result).toBe('recapture_required');
  });

  it('rejects a capture of the WRONG parcel', () => {
    const v = assessScreenshotQuality(captureFrame({ parcelApn: '111 22222' }), captureIntent);
    expect(v.result).toBe('recapture_required');
    expect(v.reason).toMatch(/Selected parcel is "111 22222"/);
  });

  it('rejects a capture whose overlay is not the intended map state', () => {
    const v = assessScreenshotQuality(
      captureFrame({ activeOverlay: 'Flood' }),
      { ...captureIntent, overlay: 'Satellite' },
    );
    expect(v.result).toBe('recapture_required');
    expect(v.reason).toMatch(/Active overlay is "Flood", intended "Satellite"/);
  });

  it('the pre-capture checkpoint refuses a frame that would not prove the fact', () => {
    expect(verifyPreCapture(captureFrame({ boundaryVisible: false }), captureIntent).passed).toBe(false);
    expect(verifyPreCapture(captureFrame(), captureIntent).confirmed.join(' ')).toMatch(/This frame proves:/);
  });

  it('recaptures an ineffective screenshot until it is accepted', async () => {
    let observed = 0;
    let captured = 0;
    const result = await captureVerified({
      intent: captureIntent,
      // The map is still loading on the first look, ready afterwards.
      observe: async () => { observed += 1; return captureFrame({ tilesLoaded: observed > 1 }); },
      // The first real capture comes back blank; the second is good.
      capture: async () => { captured += 1; return captureFrame({ bytes: captured < 2 ? 100 : 240_000 }); },
      hashArtifact: async () => 'sha256:deadbeef',
      maxAttempts: 4,
      nowIso: () => '2026-07-24T18:00:00.000Z',
    });
    expect(result.result).toBe('accepted');
    expect(result.artifactHash).toBe('sha256:deadbeef');
    // First attempt was blocked before capture (tiles), second was blank, third accepted.
    expect(result.attempts.length).toBeGreaterThan(1);
    expect(result.attempts.some((a) => a.result === 'recapture_required')).toBe(true);
  });

  it('never returns an ineffective capture as evidence when the budget is spent', async () => {
    const result = await captureVerified({
      intent: captureIntent,
      observe: async () => captureFrame(),
      capture: async () => captureFrame({ bytes: 10, screenshotPath: '/artifacts/blank.png' }),
      maxAttempts: 2,
      nowIso: () => '2026-07-24T18:00:00.000Z',
    });
    expect(result.result).toBe('recapture_required');
    expect(result.screenshotPath).toBeNull();
    expect(result.attempts).toHaveLength(2);
  });
});

describe('screenshot quality verdicts are persisted as evidence', () => {
  beforeEach(() => _initTestLandosDb());

  it('persists the result, reason, timestamp, parcel, source URL and artifact hash', () => {
    persistCaptureVerdict({
      dealCardId: 32, parcelApn: '073090 04200',
      sourceUrl: 'https://landportal.com/?property=roane-tn', purpose: 'landportal_property_loaded',
      capture: {
        result: 'accepted', reason: 'Capture proves the boundary.', screenshotPath: '/artifacts/ok.png',
        capturedAtIso: '2026-07-24T18:00:00.000Z', artifactHash: 'sha256:abc', attempts: [],
      },
    });
    const accepted = readAcceptedCaptures(32);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      purpose: 'landportal_property_loaded',
      sourceUrl: 'https://landportal.com/?property=roane-tn',
      screenshotPath: '/artifacts/ok.png',
      artifactHash: 'sha256:abc',
      capturedAtIso: '2026-07-24T18:00:00.000Z',
    });
  });

  it('an ineffective capture is retained as history but never presented as accepted evidence', () => {
    persistCaptureVerdict({
      dealCardId: 32, parcelApn: '073090 04200',
      sourceUrl: 'https://landportal.com/?property=roane-tn', purpose: 'landportal_property_loaded',
      capture: {
        result: 'recapture_required', reason: 'Saved image is 100 bytes — blank or torn.',
        screenshotPath: '/artifacts/blank.png', capturedAtIso: '2026-07-24T18:00:00.000Z',
        artifactHash: null, attempts: [],
      },
    });
    expect(readAcceptedCaptures(32)).toHaveLength(0);
  });
});

// ═══ 17, 18. Browser lifecycle ══════════════════════════════════════════════
describe('every LandPortal job closes every browser resource it opened', () => {
  beforeEach(() => _initTestLandosDb());

  const resource = (key: string, closed: string[], type: TrackedLandPortalResource['type'] = 'page'): TrackedLandPortalResource => ({
    key, type, safeUrl: 'https://landportal.com/',
    close: async () => { closed.push(key); },
  });

  it('closes pages, popups and viewers after SUCCESS', async () => {
    const closed: string[] = [];
    const run = await runLandPortalJob({
      mission: 'property_research', requestKey: 'deal-32-success', timeoutMs: 2000,
      run: async ({ track }) => {
        track(resource('ctx', closed, 'context'));
        track(resource('page', closed));
        track(resource('popup', closed, 'popup'));
        track(resource('viewer', closed, 'viewer'));
        return 'facts';
      },
    });
    expect(run.outcome).toBe('succeeded');
    expect(run.value).toBe('facts');
    expect(closed).toHaveLength(4);
    expect(run.cleanup.status).toBe('succeeded');
    expect(run.cleanup.openResourceCountAfter).toBe(0);
    expect(openLandPortalResourceCount()).toBe(0);
  });

  it('closes children before parents', async () => {
    const closed: string[] = [];
    await runLandPortalJob({
      mission: 'property_research', requestKey: 'order', timeoutMs: 2000,
      run: async ({ track }) => { track(resource('context', closed, 'context')); track(resource('child-page', closed)); return null; },
    });
    expect(closed).toEqual(['child-page', 'context']);
  });

  it('closes every resource after FAILURE', async () => {
    const closed: string[] = [];
    const run = await runLandPortalJob({
      mission: 'property_research', requestKey: 'deal-32-failure', timeoutMs: 2000,
      run: async ({ track }) => { track(resource('page', closed)); throw new Error('LandPortal returned an error page.'); },
    });
    expect(run.outcome).toBe('failed');
    expect(run.error).toMatch(/error page/);
    expect(closed).toEqual(['page']);
    expect(openLandPortalResourceCount()).toBe(0);
  });

  it('closes every resource after TIMEOUT', async () => {
    const closed: string[] = [];
    const run = await runLandPortalJob({
      mission: 'property_research', requestKey: 'deal-32-timeout', timeoutMs: 60,
      run: async ({ track }) => {
        track(resource('page', closed));
        await new Promise((resolve) => setTimeout(resolve, 400));
        return 'never';
      },
    });
    expect(run.outcome).toBe('timed_out');
    expect(closed).toEqual(['page']);
    expect(openLandPortalResourceCount()).toBe(0);
  });

  it('closes every resource after a VISUAL-VERIFICATION rejection', async () => {
    const closed: string[] = [];
    const run = await runLandPortalJob({
      mission: 'property_research', requestKey: 'deal-32-visual-reject', timeoutMs: 2000,
      run: async ({ track }) => {
        track(resource('page', closed));
        requireVisualCheckpoint(verifySearchConfiguration(configFrame({ selectedMode: 'apn' }), {
          mode: 'owner', value: 'SACHAN DILEEP S', subject: DEAL_32, jurisdictionScopingAvailable: true,
        }));
        return 'never';
      },
    });
    expect(run.outcome).toBe('visual_rejected');
    expect(closed).toEqual(['page']);
    expect(openLandPortalResourceCount()).toBe(0);
  });

  it('closes every resource after CANCELLATION', async () => {
    const closed: string[] = [];
    const run = await runLandPortalJob({
      mission: 'property_research', requestKey: 'deal-32-cancel', timeoutMs: 2000,
      isCancelled: () => true,
      run: async ({ track }) => { track(resource('page', closed)); return 'partial'; },
    });
    expect(run.outcome).toBe('cancelled');
    expect(closed).toEqual(['page']);
    expect(openLandPortalResourceCount()).toBe(0);
  });

  it('a resource that refuses to close is recorded, never silently dropped', async () => {
    const run = await runLandPortalJob({
      mission: 'property_research', requestKey: 'stubborn', timeoutMs: 2000,
      run: async ({ track }) => {
        track({ key: 'stuck', type: 'page', close: async () => { throw new Error('detached frame'); } });
        return null;
      },
    });
    expect(run.cleanup.status).toBe('failed');
    expect(run.cleanup.error).toMatch(/detached frame/);
    expect(run.cleanup.openResourceCountAfter).toBe(1);
  });

  it('repeated LandPortal jobs do not steadily increase open browser resources', async () => {
    for (let i = 0; i < 10; i++) {
      const closed: string[] = [];
      await runLandPortalJob({
        mission: 'property_research', requestKey: `repeat-${i}`, timeoutMs: 2000,
        run: async ({ track }) => {
          track(resource(`ctx-${i}`, closed, 'context'));
          track(resource(`page-${i}`, closed));
          track(resource(`popup-${i}`, closed, 'popup'));
          return i;
        },
      });
      expect(closed).toHaveLength(3);
      // The open count returns to zero after EVERY job, never creeping upward.
      expect(openLandPortalResourceCount()).toBe(0);
    }
  });

  it('the janitor closes abandoned LandOS resources and never touches an operator tab', async () => {
    const closed: string[] = [];
    // A job whose resource could not be closed leaves a row behind.
    await runLandPortalJob({
      mission: 'property_research', requestKey: 'abandoned', timeoutMs: 2000,
      run: async ({ track }) => {
        track({ key: 'leaked', type: 'page', close: async () => { throw new Error('context lost'); } });
        return null;
      },
    });
    expect(openLandPortalResourceCount()).toBe(1);

    // The janitor can only select rows LandOS itself registered. An operator's own
    // tab is not in the ledger, so it is not even a candidate.
    const swept = await runLandPortalJanitor({
      activeResources: new Map([
        ['leaked', { key: 'leaked', type: 'page', close: async () => { closed.push('leaked'); } } as TrackedLandPortalResource],
        ['operator-own-tab', { key: 'operator-own-tab', type: 'page', close: async () => { closed.push('operator-own-tab'); } } as TrackedLandPortalResource],
      ]),
      abandonedBefore: Math.floor(Date.now() / 1000) + 60,
    });
    expect(swept.closed).toBe(1);
    expect(closed).toEqual(['leaked']);
    expect(closed).not.toContain('operator-own-tab');
    expect(openLandPortalResourceCount()).toBe(0);
  });

  it('the LandPortal workflow closes every page it caused and preserves operator tabs', async () => {
    const { makeLandPortalBrowser } = await import('./landportal-browser.js');
    // Two operator tabs are already open; the job opens three more (its own tab
    // plus the comps map and parcel deep link LandPortal opens for it).
    const operatorTabs = ['operator-research', 'operator-email'];
    let pages = [...operatorTabs];
    const closed: string[] = [];
    let scopeSnapshot: string[] = [];

    const driver = {
      id: 'lp', configured: () => true,
      async beginOwnedPageScope() { scopeSnapshot = [...pages]; return 'scope-1'; },
      async closeOwnedPageScope() {
        const owned = pages.filter((p) => !scopeSnapshot.includes(p));
        for (const p of owned) closed.push(p);
        pages = pages.filter((p) => scopeSnapshot.includes(p));
        return { closed: owned.length, failed: 0, preserved: scopeSnapshot.length };
      },
      async open() { pages.push('job-working-tab'); return { url: 'https://landportal.com/', fields: {}, snippets: [] }; },
      async search(q: string) { return { url: 'search:' + q, fields: {}, snippets: [] }; },
      async readFields() { return { url: '', fields: {}, snippets: [] }; },
      async screenshot(purpose: string) { return { path: '/tmp/x.png', capturedAtIso: 't', purpose }; },
      async observe() {
        pages.push('site-opened-comps-map');
        return {
          url: 'https://landportal.com/', title: 'Land Portal', headings: ['Map Search'], navItems: ['Map Search'],
          buttons: [], searchControls: [], links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false,
        };
      },
      async clickByText() { /* nav */ },
    } as unknown as import('./browser-intelligence.js').BrowserDriver;

    const ev = await makeLandPortalBrowser({ driver }).runWorkflow(
      { searchKey: { apn: '073090 04200', county: 'Roane', state: 'TN' } },
      { timeoutMs: 2000 },
    );

    expect(ev.browserCleanup).toBeTruthy();
    expect(ev.browserCleanup!.closed).toBeGreaterThan(0);
    expect(ev.browserCleanup!.preserved).toBe(2);
    expect(ev.note).toMatch(/browser cleanup: \d+ page\(s\) closed, 2 operator page\(s\) preserved/);
    // The operator's own tabs survive; every page the job caused is gone.
    expect(pages).toEqual(operatorTabs);
    for (const tab of operatorTabs) expect(closed).not.toContain(tab);
  });

  it("LandOS's own working tab is closed even though it predates the scope", () => {
    // Live finding: the sign-in step creates the working tab BEFORE the workflow
    // opens its scope, so treating "already open" as "the operator's" left one
    // more authenticated LandPortal page behind on every single run. The working
    // tab only ever exists because LandOS created it, so it is always LandOS's
    // to close; every other pre-existing tab is the operator's and is preserved.
    const source = readFileSync(new URL('./browser-session.ts', import.meta.url), 'utf8');
    const scope = source.slice(source.indexOf('async closeOwnedPageScope'), source.indexOf('async open(url, opts)'));
    expect(scope).toMatch(/const landosOwned = page === state\.workingPage/);
    expect(scope).toMatch(/if \(preexisting\.has\(page\) && !landosOwned\) continue/);
    expect(scope).toMatch(/if \(landosOwned\) state\.workingPage = null/);
  });

  it('an abandoned resource whose runtime handle is gone is closed out honestly', async () => {
    await runLandPortalJob({
      mission: 'property_research', requestKey: 'gone', timeoutMs: 2000,
      run: async ({ track }) => {
        track({ key: 'vanished', type: 'page', close: async () => { throw new Error('process exited'); } });
        return null;
      },
    });
    const swept = await runLandPortalJanitor({ activeResources: new Map(), abandonedBefore: Math.floor(Date.now() / 1000) + 60 });
    expect(swept.unavailable).toBe(1);
    expect(openLandPortalResourceCount()).toBe(0);
  });
});
