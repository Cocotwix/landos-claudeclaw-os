import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  screenPaidUrl,
  screenPaidAction,
  redactInputValue,
  redactSecrets,
  isSensitiveSurface,
  REDACTED,
} from './training-security.js';
import {
  createTrainingSession,
  appendTrainingEvent,
  listTrainingEvents,
  saveDraftPlaybook,
  editPlaybook,
  decidePlaybook,
  getApprovedPlaybook,
  listPlaybookVersions,
  saveKnowledgeItem,
  listKnowledge,
  setKnowledgeStatus,
  addTrainingUsage,
  getTrainingSession,
} from './browser-training-db.js';
import {
  estimateLiveCost,
  synthesizeFromEventsDeterministic,
  coercePlaybook,
  buildTranscript,
  recordBrowserEvent,
  startSession,
  usageRollup,
  trainingSystemInstruction,
  type SynthesizedPlaybook,
} from './browser-training.js';
import { replayPlaybook } from './browser-training-replay.js';
import type { PageLike } from './browser-session.js';

beforeEach(() => { _initTestLandosDb(); });

// ── Security guard ──────────────────────────────────────────────────
describe('training security guard', () => {
  it('flags billing/checkout/paid URLs as Approval Required', () => {
    for (const u of [
      'https://landportal.com/checkout',
      'https://landportal.com/account/billing',
      'https://site.com/skip-trace',
      'https://checkout.stripe.com/pay/abc',
      'https://x.com/subscribe',
    ]) {
      const v = screenPaidUrl(u);
      expect(v.approvalRequired, u).toBe(true);
      expect(v.allowed).toBe(false);
    }
  });

  it('allows normal workflow URLs', () => {
    for (const u of ['https://landportal.com/', 'https://landportal.com/map?parcel=123', 'https://county.gov/gis']) {
      expect(screenPaidUrl(u).approvalRequired, u).toBe(false);
    }
  });

  it('flags paid action button text but not ordinary controls', () => {
    expect(screenPaidAction('Buy Report').approvalRequired).toBe(true);
    expect(screenPaidAction('Purchase Comps').approvalRequired).toBe(true);
    expect(screenPaidAction('Skip Trace').approvalRequired).toBe(true);
    expect(screenPaidAction('Search').approvalRequired).toBe(false);
    expect(screenPaidAction('Select parcel').approvalRequired).toBe(false);
    expect(screenPaidAction('Next').approvalRequired).toBe(false);
  });

  it('redacts password inputs and secret-named fields', () => {
    expect(redactInputValue({ type: 'password', value: 'hunter2' })).toEqual({ value: REDACTED, redacted: true });
    expect(redactInputValue({ name: 'api_key', value: 'sk-abc' }).redacted).toBe(true);
    expect(redactInputValue({ name: 'search', type: 'text', value: '10 acres GA' })).toEqual({ value: '10 acres GA', redacted: false });
  });

  it('scrubs secret-shaped substrings out of free text', () => {
    const r = redactSecrets('here is LANDPORTAL_PASSWORD=supersecret and Bearer abcdef1234567890');
    expect(r.redacted).toBe(true);
    expect(r.text).not.toContain('supersecret');
    expect(r.text).not.toContain('abcdef1234567890');
    expect(r.text).toContain('LANDPORTAL_PASSWORD=');
  });

  it('identifies sensitive storage surfaces', () => {
    expect(isSensitiveSurface('cookie')).toBe(true);
    expect(isSensitiveSurface('localStorage')).toBe(true);
    expect(isSensitiveSurface('parcel-list')).toBe(false);
  });
});

// ── recordBrowserEvent guard integration ────────────────────────────
describe('recordBrowserEvent', () => {
  it('stores a guard_block and pauses the session on a paid action', () => {
    const s = startSession({ title: 't', website: 'https://landportal.com' });
    const res = recordBrowserEvent({ sessionId: s.id, kind: 'click', controlText: 'Buy Report' });
    expect(res.approvalRequired).toBe(true);
    expect(res.stored.kind).toBe('guard_block');
    expect(getTrainingSession(s.id)!.status).toBe('paused');
    expect(getTrainingSession(s.id)!.approvalRequired).toBe(true);
  });

  it('records normal nav/click events without blocking', () => {
    const s = startSession({ title: 't', website: 'https://landportal.com' });
    const res = recordBrowserEvent({ sessionId: s.id, kind: 'nav', url: 'https://landportal.com/map' });
    expect(res.approvalRequired).toBe(false);
    expect(res.stored.kind).toBe('nav');
  });

  it('redacts a password input value before storing', () => {
    const s = startSession({ title: 't' });
    const res = recordBrowserEvent({ sessionId: s.id, kind: 'input', selector: '#pw', field: { type: 'password', value: 'secret' } });
    expect(res.stored.text).toBe(REDACTED);
  });
});

// ── cost estimation ─────────────────────────────────────────────────
describe('cost estimation', () => {
  it('estimates cost from usage tokens', () => {
    // 1M audio-in @ $3 + 1M audio-out @ $12 = $15
    expect(estimateLiveCost({ audioIn: 1_000_000, audioOut: 1_000_000 })).toBeCloseTo(15, 5);
    expect(estimateLiveCost({})).toBe(0);
  });

  it('accumulates usage onto a session', () => {
    const s = createTrainingSession({ title: 'u' });
    addTrainingUsage(s.id, { audioIn: 100, costUsd: 0.5 });
    addTrainingUsage(s.id, { audioIn: 50, costUsd: 0.25 });
    const got = getTrainingSession(s.id)!;
    expect(got.audioInTokens).toBe(150);
    expect(got.estCostUsd).toBeCloseTo(0.75, 5);
  });
});

// ── playbook synthesis ──────────────────────────────────────────────
describe('playbook synthesis', () => {
  it('builds a deterministic playbook from captured events with safety defaults', () => {
    const s = createTrainingSession({ title: 'LandPortal Map Search', website: 'https://landportal.com' });
    appendTrainingEvent({ sessionId: s.id, kind: 'nav', url: 'https://landportal.com/map' });
    appendTrainingEvent({ sessionId: s.id, kind: 'click', selector: '#parcel-42', text: 'parcel' });
    appendTrainingEvent({ sessionId: s.id, kind: 'screenshot', text: 'sidebar' });
    const events = listTrainingEvents(s.id);
    const pb = synthesizeFromEventsDeterministic(getTrainingSession(s.id)!, events);
    expect(pb.steps.length).toBe(3);
    expect(pb.neverDo.join(' ')).toMatch(/purchase|checkout/i);
    expect(pb.paidActionBlockers.length).toBeGreaterThan(0);
    expect(pb.screenshotsRequired).toContain('sidebar');
    expect(pb.captureMode).toBe('dom');
    expect(pb.needsSelectorConfirmation).toBe(false);
  });

  it('builds a VISUAL/NARRATED workflow (not empty) when there are no DOM events', () => {
    const s = createTrainingSession({ title: 'LandPortal Map Search', website: 'https://landportal.com' });
    // Only speech + screenshots (screen-share session, no CDP/DOM).
    appendTrainingEvent({ sessionId: s.id, kind: 'operator_speech', role: 'operator', text: 'open the map search and search for the parcel' });
    appendTrainingEvent({ sessionId: s.id, kind: 'operator_speech', role: 'operator', text: 'now click the parcel to open the sidebar' });
    appendTrainingEvent({ sessionId: s.id, kind: 'operator_speech', role: 'operator', text: 'ok' }); // shard, dropped
    appendTrainingEvent({ sessionId: s.id, kind: 'screenshot', text: 'Start of session' });
    appendTrainingEvent({ sessionId: s.id, kind: 'screenshot', text: 'Page changed' });
    const pb = synthesizeFromEventsDeterministic(getTrainingSession(s.id)!, listTrainingEvents(s.id));
    expect(pb.captureMode).toBe('visual_narrated');
    expect(pb.needsSelectorConfirmation).toBe(true);
    expect(pb.steps.length).toBeGreaterThan(0); // never "No steps"
    // narrated action steps + screenshot anchors, one-word shard dropped
    expect(pb.steps.some((x) => /map search/i.test(x.action))).toBe(true);
    expect(pb.steps.filter((x) => /Screenshot:/i.test(x.action)).length).toBe(2);
    expect(pb.learningSummary).toMatch(/VISUAL\/NARRATED|needs one CDP pass/i);
  });

  it('coerces messy LLM output into the strict shape, keeping fallbacks', () => {
    const fallback = synthesizeFromEventsDeterministic(
      createTrainingSession({ title: 'x', website: 'w' }),
      [],
    );
    const coerced = coercePlaybook(
      {
        workflowName: 'Parcel lookup',
        steps: ['Open map', { action: 'Click parcel', selector: '#p' }],
        businessRules: ['Only 2-5 acre parcels'],
        fieldsToExtract: ['owner', 'APN'],
      },
      fallback,
    );
    expect(coerced.workflowName).toBe('Parcel lookup');
    expect(coerced.steps).toHaveLength(2);
    expect(coerced.steps[1].selector).toBe('#p');
    expect(coerced.businessRules).toContain('Only 2-5 acre parcels');
    // fallback safety rails preserved when LLM omits them
    expect(coerced.neverDo.length).toBeGreaterThan(0);
  });

  it('renders a transcript that interleaves speech and events', () => {
    const s = createTrainingSession({ title: 'x' });
    appendTrainingEvent({ sessionId: s.id, kind: 'operator_speech', role: 'operator', text: 'this is the parcel' });
    appendTrainingEvent({ sessionId: s.id, kind: 'nav', url: 'https://landportal.com/map' });
    const t = buildTranscript(listTrainingEvents(s.id));
    expect(t).toContain('TYLER: this is the parcel');
    expect(t).toContain('[nav] https://landportal.com/map');
  });
});

// ── playbook versioning + approval ──────────────────────────────────
describe('playbook versioning', () => {
  it('creates versions on edit and supersedes prior approved on approve', () => {
    const v1 = saveDraftPlaybook({ sessionId: null, slug: 'lp_map', name: 'LP Map', website: 'w', body: { a: 1 } });
    expect(v1.version).toBe(1);
    const v2 = editPlaybook(v1.id, { a: 2 });
    expect(v2.version).toBe(2);
    decidePlaybook(v1.id, 'approved', 'Tyler');
    expect(getApprovedPlaybook('lp_map')!.version).toBe(1);
    // approving v2 supersedes v1
    decidePlaybook(v2.id, 'approved', 'Tyler');
    expect(getApprovedPlaybook('lp_map')!.version).toBe(2);
    expect(listPlaybookVersions('lp_map')).toHaveLength(2);
  });
});

// ── knowledge ───────────────────────────────────────────────────────
describe('knowledge store', () => {
  it('saves proposed knowledge and transitions status', () => {
    const s = createTrainingSession({ title: 'x' });
    const k = saveKnowledgeItem({ sessionId: s.id, category: 'business_rule', title: 'Acreage', body: 'Only 2-5 acres' });
    expect(listKnowledge({ status: 'proposed' })).toHaveLength(1);
    setKnowledgeStatus(k.id, 'saved');
    expect(listKnowledge({ status: 'proposed' })).toHaveLength(0);
    expect(listKnowledge({ status: 'saved' })).toHaveLength(1);
  });
});

// ── usage rollup ────────────────────────────────────────────────────
describe('usage rollup', () => {
  it('aggregates sessions into windows and counts playbooks', () => {
    const s = createTrainingSession({ title: 'x' });
    addTrainingUsage(s.id, { costUsd: 1.25 });
    saveDraftPlaybook({ sessionId: s.id, slug: 'p1', name: 'P1', website: 'w', body: {} });
    const roll = usageRollup();
    expect(roll.today.sessions).toBe(1);
    expect(roll.lifetime.costUsd).toBeCloseTo(1.25, 4);
    expect(roll.playbooksCreated).toBe(1);
    expect(roll.provider).toBe('gemini');
  });
});

// ── replay ──────────────────────────────────────────────────────────
describe('replay engine', () => {
  function fakePage(overrides: Partial<Record<string, boolean>> = {}): PageLike {
    return {
      goto: async () => ({}),
      url: () => 'https://landportal.com/map',
      evaluate: (async (fn: any) => {
        const src = String(fn);
        if (src.includes('querySelector')) return overrides['#found'] !== false;
        return undefined;
      }) as PageLike['evaluate'],
      screenshot: async () => ({}),
    };
  }

  it('passes navigations and present selectors, never runs paid steps', async () => {
    const pb: SynthesizedPlaybook = {
      workflowName: 'x', website: 'w', purpose: 'p',
      steps: [
        { action: 'Navigate to map', url: 'https://landportal.com/map' },
        { action: 'Click parcel', selector: '#parcel-1' },
        { action: 'Buy Report', selector: '#buy' },
      ],
      fieldsToExtract: [], screenshotsRequired: [], decisionPoints: [], businessRules: [],
      operatorPreferences: [], exceptions: [], commonMistakes: [], neverDo: [], paidActionBlockers: [],
      failureHandling: [], qaChecklist: [], expectedOutputs: [],
    };
    const res = await replayPlaybook(pb, async () => fakePage());
    expect(res.passed).toBe(2);
    expect(res.paidBlocked).toBe(1);
    expect(res.steps[2].status).toBe('skipped_paid');
    expect(res.ok).toBe(true);
  });

  it('marks a step failed when the selector is missing', async () => {
    const pb: SynthesizedPlaybook = {
      workflowName: 'x', website: 'w', purpose: 'p',
      steps: [{ action: 'Click parcel', selector: '#gone' }],
      fieldsToExtract: [], screenshotsRequired: [], decisionPoints: [], businessRules: [],
      operatorPreferences: [], exceptions: [], commonMistakes: [], neverDo: [], paidActionBlockers: [],
      failureHandling: [], qaChecklist: [], expectedOutputs: [],
    };
    const res = await replayPlaybook(pb, async () => fakePage({ '#found': false }));
    expect(res.failed).toBe(1);
    expect(res.ok).toBe(false);
  });
});

// ── persona ─────────────────────────────────────────────────────────
describe('training persona', () => {
  it('names allowed actions and the paid-action stop rule, no secrets', () => {
    const sys = trainingSystemInstruction({ website: 'https://landportal.com', title: 'Map Search' });
    expect(sys).toMatch(/Approval Required/);
    expect(sys).toMatch(/screenshots/i);
    expect(sys).not.toMatch(/LANDPORTAL_PASSWORD|api[_-]?key/i);
  });
});
