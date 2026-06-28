import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import {
  getAcquisition, upsertSellerProfile, addCommLogEntry, addDiscoveryNote, setAcquisitionStage,
  extractDiscoveryNotes, acquisitionNextAction, sellerStrategySummary, emptyAcquisition,
} from './acquisitions.js';
import { buildCallPrep, buildFollowUpDraft, acquisitionPlaybook, acquisitionTrainingReadiness, ACQ_TRAINING_PATHS } from './acquisition-prep.js';

beforeEach(() => { _initTestLandosDb(); });
const newDeal = () => createDealCard({ entity: 'TY_LAND_BIZ', title: 'acq', leadType: 'test' }).id;

describe('acquisitions — persistence + memory', () => {
  it('seller profile persists and reloads from SQLite', () => {
    const id = newDeal();
    upsertSellerProfile(id, { name: 'Jane Doe', phone: '555', motivation: 'inherited', askingPrice: '$45k' });
    const r = getAcquisition(id);
    expect(r.profile.name).toBe('Jane Doe');
    expect(r.profile.motivation).toBe('inherited');
    // fresh read (reload) keeps it
    expect(getAcquisition(id).profile.askingPrice).toBe('$45k');
  });
  it('communication log persists/reloads (newest first) and never sends', () => {
    const id = newDeal();
    addCommLogEntry(id, { at: '2026-06-01T10:00:00Z', channel: 'call', direction: 'outbound', summary: 'left voicemail' });
    addCommLogEntry(id, { at: '2026-06-02T10:00:00Z', channel: 'text', direction: 'inbound', summary: 'seller replied' });
    const r = getAcquisition(id);
    expect(r.commLog).toHaveLength(2);
    expect(r.commLog[0].summary).toBe('seller replied');
    expect(r.profile.lastContactDate).toBe('2026-06-02');
  });
  it('acquisition memory (profile + comm + discovery) survives reload', () => {
    const id = newDeal();
    upsertSellerProfile(id, { name: 'A' });
    addCommLogEntry(id, { at: '2026-06-01', channel: 'call', direction: 'outbound', summary: 's' });
    addDiscoveryNote(id, extractDiscoveryNotes('They inherited it and want to sell within 30 days. 10 acres with road access.'));
    const r = getAcquisition(id);
    expect(r.profile.name).toBe('A'); expect(r.commLog.length).toBe(1); expect(r.discovery.length).toBe(1);
  });
});

describe('acquisitions — discovery extraction keeps seller-stated separate from verified DD', () => {
  it('extracts motivation/timeline/facts and stores facts as SELLER-STATED on the profile', () => {
    const id = newDeal();
    const ex = extractDiscoveryNotes('We inherited the land and want to sell ASAP. It has about 10 acres, a well, and road access. My brother is also on the deed. I think it is worth more than that.');
    expect(ex.motivation).toMatch(/inherit/i);
    expect(ex.urgency).toBe('high');
    expect(ex.decisionMakers).toMatch(/brother/i);
    expect(ex.sellerClaimedFacts.length).toBeGreaterThan(0);
    expect(ex.objections.length).toBeGreaterThan(0);
    addDiscoveryNote(id, ex);
    const r = getAcquisition(id);
    // seller-claimed facts live under sellerStatedFacts — NOT a verified DD field
    expect(r.profile.sellerStatedFacts!.some((f) => /acre|well|road/i.test(f))).toBe(true);
    expect(r.stage).toBe('discovery_complete');
  });
});

describe('acquisitions — next best action (deterministic) + readiness', () => {
  it('new lead with no discovery -> run discovery call', () => {
    const na = acquisitionNextAction(emptyAcquisition(1));
    expect(na.action).toBe('needs_discovery_call');
    expect(na.reason).toBeTruthy();
  });
  it('paused / pass short-circuit', () => {
    expect(acquisitionNextAction({ ...emptyAcquisition(1), stage: 'paused' }).action).toBe('pass_or_pause');
    expect(acquisitionNextAction({ ...emptyAcquisition(1), stage: 'pass' }).action).toBe('pass_or_pause');
  });
  it('discovery done but parcel unverified -> needs more DD', () => {
    const s = { ...emptyAcquisition(1), stage: 'discovery_complete' as const, commLog: [{ at: '', channel: 'call' as const, direction: 'outbound' as const, summary: 'x', createdAt: '' }], discovery: [extractDiscoveryNotes('motivation: moving. timeline: 30 days. price 40k. brother decides.')], profile: { motivation: 'm', timeline: 't', askingPrice: '$40k', decisionMakers: 'brother' } };
    expect(acquisitionNextAction(s, { ddParcelVerified: false }).action).toBe('needs_more_dd');
  });
  it('discovery captured via notes (no comm-log entry) does NOT force a discovery call (regression)', () => {
    const s = { ...emptyAcquisition(1), stage: 'ready_for_offer_prep' as const, commLog: [], discovery: [extractDiscoveryNotes('inherited; 30 days; 45k; brother decides')], profile: { motivation: 'inherited', timeline: '30 days', askingPrice: '$45k', decisionMakers: 'brother' } };
    expect(acquisitionNextAction(s, { ddParcelVerified: true }).action).toBe('prepare_offer_call');
  });
  it('stage updates persist', () => {
    const id = newDeal();
    setAcquisitionStage(id, 'needs_follow_up');
    expect(getAcquisition(id).stage).toBe('needs_follow_up');
  });
});

describe('acquisitions — call prep + follow-up drafts (never send)', () => {
  it('call prep uses seller + DD context; surfaces do-not-say guardrails', () => {
    const id = newDeal();
    upsertSellerProfile(id, { name: 'Jane', motivation: 'inherited' });
    const acq = getAcquisition(id);
    const na = acquisitionNextAction(acq);
    const cp = buildCallPrep(acq, na, { ddParcelVerified: true, marketBand: '$5k–$8k/ac', topRiskFlags: ['flood'], topMissingDdFacts: ['Zoning'] });
    expect(cp.whatWeKnow.some((x) => /inherited/i.test(x))).toBe(true);
    expect(cp.keyQuestions.length).toBeGreaterThan(2);
    expect(cp.doNotSay.some((x) => /quote a price|comp number/i.test(x))).toBe(true);
    expect(cp.riskTopicsToClarify).toContain('flood');
  });
  it('follow-up draft is produced but NEVER sent (all formats)', () => {
    const acq = emptyAcquisition(1);
    for (const fmt of ['sms', 'email', 'call_script'] as const) {
      const d = buildFollowUpDraft(acq, fmt);
      expect(d.sent).toBe(false);
      expect(d.draft.length).toBeGreaterThan(10);
      expect(d.note).toMatch(/draft only/i);
    }
  });
  it('strategy summary derives current stage + next move', () => {
    const acq = emptyAcquisition(1);
    const sum = sellerStrategySummary(acq, acquisitionNextAction(acq));
    expect(sum.currentStage).toBeTruthy();
    expect(sum.offerCallReady).toBe(false);
  });
});

describe('acquisitions — playbook foundation + R2 training readiness', () => {
  it('playbook is FOUNDATIONAL until training is ingested', () => {
    const pb = acquisitionPlaybook();
    expect(pb.status).toBe('foundational');
    expect(pb.toneRules.length).toBeGreaterThan(0);
    expect(pb.doNotSay.length).toBeGreaterThan(0);
    expect(acquisitionPlaybook(['r2://.../call1.mp3']).status).toBe('trained');
  });
  it('training storage is R2-ready (paths defined; ingestion NOT built)', () => {
    const tr = acquisitionTrainingReadiness();
    expect(tr.ingestionImplemented).toBe(false);
    expect(ACQ_TRAINING_PATHS.rawMp3).toContain('agents/acquisitions/training/raw/mp3');
    expect(ACQ_TRAINING_PATHS.transcripts).toContain('transcripts');
    expect(['r2', 'local-fs']).toContain(tr.backend);
  });
});
