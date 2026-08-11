// Browser Use LandPortal pilot lane — contract tests.
//
// Covers: schema validation (typing, attribution, capture-file confinement,
// honest-null findings), persistence round-trip on the subject property card,
// cross-card isolation, failure behavior (invalid result never merged, one
// failed run never erases earlier evidence), and the auth gate.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, loadPropertyInspection, getCardActivity } from './property-card.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import {
  validateBrowserUsePilotResult,
  persistBrowserUseRun,
  loadBrowserUseRun,
  runLandPortalBrowserUsePilot,
  browserUseRunStatus,
  hasPersistedBrowserUseCaptureForDeal,
  resolveBrowserUseCapturePath,
  _resetBrowserUseRunState,
  BROWSERUSE_ACTIVITY_KIND,
  type BrowserUsePilotResult,
  type PersistedBrowserUseRun,
} from './landportal-browseruse.js';
import type { LandPortalReadiness } from './browser-session.js';

beforeEach(() => {
  _initTestLandosDb();
  _resetBrowserUseRunState();
});

const ADDRESS = '499 Campground Road, Liberty, SC 29657';

function goodResult(over: Partial<BrowserUsePilotResult> = {}): BrowserUsePilotResult {
  return {
    runner: 'browser-use',
    runnerVersion: '0.13.7',
    startedAt: '2026-07-30T00:00:00+00:00',
    finishedAt: '2026-07-30T00:05:00+00:00',
    subject: { address: ADDRESS, city: 'Liberty', state: 'SC', county: 'Pickens', apn: null },
    findings: {
      subject_identity: {
        address_queried: ADDRESS,
        landportal_address: '499 Campground Rd, Liberty, SC 29657',
        apn: '4321-00-11-2233',
        county: 'Pickens',
        state: 'SC',
        parcel_match: 'confirmed',
        match_reasoning: 'Address, county and acreage all match the search result.',
      },
      property_facts: {
        acreage: 12.21,
        owner_shown: 'EXAMPLE OWNER LLC',
        coordinates: '34.76,-82.71',
        property_type: 'Vacant land',
        roads_serving: ['Campground Road'],
        other_characteristics: ['Wooded: mostly'],
        unavailable_fields: ['flood zone (behind paid report)'],
      },
      visual_observations: {
        parcel_shape: 'Roughly rectangular with a narrow neck to the road',
        apparent_road_frontage: 'Short road frontage on Campground Road at the south corner',
        apparent_access: 'Access neck at the southern boundary',
        surroundings: 'Rural residential parcels and timber',
        notes: [],
      },
      conflicts: [
        {
          structured_field: 'road_frontage_ft',
          structured_value: '0',
          visual_observation: 'Visible road frontage on Campground Road in the aerial',
          explanation: 'The structured field disagrees with the imagery; both preserved.',
        },
      ],
      comp_attempt: {
        attempted: true,
        outcome: 'Visible similar-sales panel read without opening any paid report.',
        candidates: [
          {
            address: '120 Example Ln, Liberty, SC',
            distance: '1.4 mi',
            sale_date: '2026-03-02',
            sale_price: '$95,000',
            acreage: 10.1,
            price_per_acre: '$9,406',
            property_type: 'Vacant land',
            source_context: 'LandPortal visible similar-sales list',
            relevance: 'Similar acreage band and same county.',
          },
        ],
      },
      failed_actions: [],
      auth_required: false,
      paid_feature_encountered: 'Skip-trace upsell banner appeared; it was dismissed, never clicked.',
      confidence: 'high',
      confidence_reasoning: 'All core fields visible and consistent.',
    },
    captures: [
      { label: 'clean_parcel_aerial', file: 'browseruse_clean_parcel_aerial-1785400000000.png', pageUrl: 'https://landportal.com/', capturedAt: '2026-07-30T00:02:00+00:00' },
      { label: 'wider_context', file: 'browseruse_wider_context-1785400001000.png', pageUrl: 'https://landportal.com/', capturedAt: '2026-07-30T00:03:00+00:00' },
    ],
    agentErrors: [],
    urlsVisited: ['https://landportal.com/'],
    complete: true,
    ...over,
  };
}

function subjectCard(address = ADDRESS) {
  const card = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: address, county: 'Pickens', state: 'SC' }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Browser Use pilot' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { card, deal };
}

const authOk: LandPortalReadiness = {
  phase: 'authenticated', ready: true, sessionStatus: 'live', authenticated: true,
  reason: null, missingEnv: [], attempted: false, note: '',
} as LandPortalReadiness;

const authNeeded: LandPortalReadiness = {
  ...authOk, phase: 'auth_failed', ready: false, authenticated: false, reason: 'login wall',
} as LandPortalReadiness;

const testConfig = {
  enabled: true,
  cdpUrl: 'http://127.0.0.1:9224',
  screenshotDir: 'store/browser-shots',
  profileDir: 'unused',
} as ReturnType<typeof import('./browser-session.js').readSessionConfig>;

describe('validateBrowserUsePilotResult', () => {
  it('accepts a fully typed result', () => {
    const v = validateBrowserUsePilotResult(goodResult(), ADDRESS);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('rejects a result attributed to a different property', () => {
    const v = validateBrowserUsePilotResult(goodResult(), '1 Other Rd, Elsewhere, TN');
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/cross-property attribution/);
  });

  it('rejects capture files that are not plain browseruse basenames', () => {
    const bad = goodResult();
    bad.captures[0].file = '..\\..\\.env';
    expect(validateBrowserUsePilotResult(bad, ADDRESS).ok).toBe(false);
    const bad2 = goodResult();
    bad2.captures[0].file = 'deal64_county_records_final-1785338374198.png';
    expect(validateBrowserUsePilotResult(bad2, ADDRESS).ok).toBe(false);
  });

  it('accepts honest failure documents (findings null, complete false)', () => {
    const failed = goodResult({ findings: null, complete: false, agentErrors: ['navigation timeout'] });
    const v = validateBrowserUsePilotResult(failed, ADDRESS);
    expect(v.ok).toBe(true);
  });

  it('rejects complete=true without findings', () => {
    const v = validateBrowserUsePilotResult(goodResult({ findings: null, complete: true }), ADDRESS);
    expect(v.ok).toBe(false);
  });

  it('rejects wrongly typed comp candidates instead of quantity-gating them', () => {
    const zeroComps = goodResult();
    zeroComps.findings!.comp_attempt.candidates = [];
    expect(validateBrowserUsePilotResult(zeroComps, ADDRESS).ok).toBe(true);

    const badType = goodResult();
    (badType.findings!.comp_attempt.candidates[0] as unknown as { acreage: string }).acreage = 'ten';
    expect(validateBrowserUsePilotResult(badType, ADDRESS).ok).toBe(false);
  });
});

describe('persistence and isolation', () => {
  it('round-trips a run on the subject property card', () => {
    const { card, deal } = subjectCard();
    const run: PersistedBrowserUseRun = {
      dealCardId: deal.id, propertyCardId: card.id, result: goodResult(),
      schemaValid: true, validationErrors: [], persistedAt: new Date().toISOString(),
    };
    persistBrowserUseRun(run);
    const loaded = loadBrowserUseRun(card.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.dealCardId).toBe(deal.id);
    expect(loaded!.result.findings?.subject_identity.parcel_match).toBe('confirmed');
    expect(loaded!.result.captures.length).toBe(2);
  });

  it('never contaminates another card and never touches inspection lanes', () => {
    const { card, deal } = subjectCard();
    const other = subjectCard('700 Unrelated Rd, Pickens, SC');
    persistBrowserUseRun({
      dealCardId: deal.id, propertyCardId: card.id, result: goodResult(),
      schemaValid: true, validationErrors: [], persistedAt: new Date().toISOString(),
    });
    expect(loadBrowserUseRun(other.card.id)).toBeNull();
    // The property-inspection reader must not absorb browseruse rows.
    expect(loadPropertyInspection(card.id)).toBeNull();
    const kinds = getCardActivity(card.id).map((a) => a.kind);
    expect(kinds).toContain(BROWSERUSE_ACTIVITY_KIND);
  });

  it('a newer run supersedes for display but the older row remains as history', () => {
    const { card, deal } = subjectCard();
    const first = goodResult();
    persistBrowserUseRun({ dealCardId: deal.id, propertyCardId: card.id, result: first, schemaValid: true, validationErrors: [], persistedAt: '2026-07-30T01:00:00Z' });
    const second = goodResult();
    second.findings!.property_facts.acreage = 12.3;
    persistBrowserUseRun({ dealCardId: deal.id, propertyCardId: card.id, result: second, schemaValid: true, validationErrors: [], persistedAt: '2026-07-30T02:00:00Z' });
    expect(loadBrowserUseRun(card.id)!.result.findings!.property_facts.acreage).toBe(12.3);
    const rows = getCardActivity(card.id).filter((a) => a.kind === BROWSERUSE_ACTIVITY_KIND);
    expect(rows.length).toBe(2);
  });
});

describe('runLandPortalBrowserUsePilot', () => {
  it('refuses to run without an authenticated LandPortal session', async () => {
    const { deal } = subjectCard();
    const outcome = await runLandPortalBrowserUsePilot(deal.id, {
      ensureAuth: async () => authNeeded,
      config: testConfig,
      execRunner: async () => { throw new Error('must not spawn'); },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/not authenticated/);
    expect(browserUseRunStatus(deal.id).state).toBe('failed');
  });

  it('persists a valid runner result and reports completed', async () => {
    const { card, deal } = subjectCard();
    const outcome = await runLandPortalBrowserUsePilot(deal.id, {
      ensureAuth: async () => authOk,
      config: testConfig,
      execRunner: async () => ({ stdout: JSON.stringify(goodResult()), exitCode: 0, stderrTail: '' }),
    });
    expect(outcome.error).toBeNull();
    expect(outcome.ok).toBe(true);
    expect(browserUseRunStatus(deal.id).state).toBe('completed');
    expect(loadBrowserUseRun(card.id)).not.toBeNull();
  });

  it('rejects and does NOT persist a schema-invalid result, preserving earlier evidence', async () => {
    const { card, deal } = subjectCard();
    persistBrowserUseRun({ dealCardId: deal.id, propertyCardId: card.id, result: goodResult(), schemaValid: true, validationErrors: [], persistedAt: '2026-07-30T01:00:00Z' });

    const invalid = goodResult();
    (invalid as unknown as { subject: { address: string } }).subject.address = '999 Wrong Property Rd';
    const outcome = await runLandPortalBrowserUsePilot(deal.id, {
      ensureAuth: async () => authOk,
      config: testConfig,
      execRunner: async () => ({ stdout: JSON.stringify(invalid), exitCode: 0, stderrTail: '' }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/schema validation/);
    // Earlier evidence untouched.
    const rows = getCardActivity(card.id).filter((a) => a.kind === BROWSERUSE_ACTIVITY_KIND);
    expect(rows.length).toBe(1);
    expect(loadBrowserUseRun(card.id)!.result.findings!.property_facts.acreage).toBe(12.21);
  });

  it('reports a runner crash honestly without corrupting state', async () => {
    const { card, deal } = subjectCard();
    const outcome = await runLandPortalBrowserUsePilot(deal.id, {
      ensureAuth: async () => authOk,
      config: testConfig,
      execRunner: async () => ({ stdout: '', exitCode: 3, stderrTail: 'ANTHROPIC_API_KEY missing' }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/exited with code 3/);
    expect(loadBrowserUseRun(card.id)).toBeNull();
  });

  it('refuses a second concurrent run for the same deal card', async () => {
    const { deal } = subjectCard();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const first = runLandPortalBrowserUsePilot(deal.id, {
      ensureAuth: async () => authOk,
      config: testConfig,
      execRunner: async () => { await gate; return { stdout: JSON.stringify(goodResult()), exitCode: 0, stderrTail: '' }; },
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await runLandPortalBrowserUsePilot(deal.id, { ensureAuth: async () => authOk, config: testConfig, execRunner: async () => { throw new Error('must not spawn'); } });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already in progress/);
    release();
    await first;
  });
});

describe('resolveBrowserUseCapturePath', () => {
  it('resolves only plain capture basenames inside the shot dir', () => {
    const ok = resolveBrowserUseCapturePath('browseruse_clean_parcel_aerial-1785400000000.png', testConfig);
    expect(ok).toMatch(/browser-shots/);
    expect(resolveBrowserUseCapturePath('..\\secrets.png', testConfig)).toBeNull();
    expect(resolveBrowserUseCapturePath('deal64_county_records_final-1785338374198.png', testConfig)).toBeNull();
    expect(resolveBrowserUseCapturePath('browseruse_x-1.png', testConfig)).toBeNull();
  });
});

describe('historical capture authorization', () => {
  it('authorizes a retained capture from an older run for the same deal only', () => {
    const { card, deal } = subjectCard();
    persistBrowserUseRun({ dealCardId: deal.id, propertyCardId: card.id, result: goodResult(), schemaValid: true, validationErrors: [], persistedAt: '2026-07-30T01:00:00Z' });
    const newer = goodResult();
    newer.captures = [{ ...newer.captures[0], file: 'browseruse_newer-1785400002000.png' }];
    persistBrowserUseRun({ dealCardId: deal.id, propertyCardId: card.id, result: newer, schemaValid: true, validationErrors: [], persistedAt: '2026-07-30T02:00:00Z' });
    expect(hasPersistedBrowserUseCaptureForDeal(deal.id, 'browseruse_clean_parcel_aerial-1785400000000.png')).toBe(true);
    expect(hasPersistedBrowserUseCaptureForDeal(deal.id, 'browseruse_newer-1785400002000.png')).toBe(true);
    expect(hasPersistedBrowserUseCaptureForDeal(deal.id, 'browseruse_unrelated-1785400003000.png')).toBe(false);
  });
});
