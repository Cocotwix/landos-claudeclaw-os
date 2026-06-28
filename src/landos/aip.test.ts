import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  registerAsset, getAsset, listAssets, setTranscriptStatus, setExtractionStatus,
  addKnowledge, getKnowledge, listKnowledge, approveKnowledge, rejectKnowledge, knowledgeGraph,
  generatePlaybookSection, publishPlaybookSection, getPublishedPlaybookSection, listPlaybook,
  coachingLookup, getIngestionHandler, registerIngestionHandler, aipRawKey, AIP_R2_PATHS,
} from './aip.js';

beforeEach(() => { _initTestLandosDb(); });

describe('AIP — assets + metadata + R2 contract (raw media never in Git)', () => {
  it('registers an asset with metadata + an R2 key (no file content stored)', () => {
    const a = registerAsset({ sourceType: 'mp3', title: 'Discovery call #1', author: 'Tyler', metadata: { tags: ['discovery'], confidence: 'high', durationSec: 1800 }, ext: 'mp3' });
    expect(a.id).toBeGreaterThan(0);
    expect(a.r2Key).toContain(AIP_R2_PATHS.raw);
    expect(a.r2Key).toMatch(/mp3\/\d+\.mp3$/);
    expect(a.metadata.tags).toContain('discovery');
    // reload
    const r = getAsset(a.id)!;
    expect(r.title).toBe('Discovery call #1'); expect(r.metadata.durationSec).toBe(1800);
    expect(listAssets().length).toBe(1);
    // the record holds only a key + metadata — never raw bytes (raw media lives in R2)
    expect(JSON.stringify(r)).not.toMatch(/[A-Za-z0-9+/]{200,}/); // no embedded blob
  });
  it('transcript + extraction status are placeholders until pipelines exist', () => {
    const a = registerAsset({ sourceType: 'mp4', title: 'x' });
    expect(a.transcriptStatus).toBe('pending');
    expect(setTranscriptStatus(a.id, 'placeholder')!.transcriptStatus).toBe('placeholder');
    expect(setExtractionStatus(a.id, 'extracted')!.extractionStatus).toBe('extracted');
  });
  it('ingestion is a pluggable contract; media unsupported until implemented, text accepts manual', async () => {
    const mp3 = getIngestionHandler('mp3'); expect(mp3.implemented).toBe(false);
    expect((await mp3.prepare(getAsset(registerAsset({ sourceType: 'mp3', title: 'a' }).id)!)).transcriptStatus).toBe('unsupported');
    const tx = getIngestionHandler('transcript');
    expect((await tx.prepare(getAsset(registerAsset({ sourceType: 'transcript', title: 'b' }).id)!)).transcriptStatus).toBe('manual');
    // replaceable / model-agnostic: a real handler can be registered
    registerIngestionHandler({ sourceType: 'youtube', implemented: true, prepare: async () => ({ transcriptStatus: 'transcribed', note: 'stub' }) });
    expect(getIngestionHandler('youtube').implemented).toBe(true);
  });
  it('aipRawKey is deterministic and under agents/acquisitions/training/raw', () => {
    expect(aipRawKey('mp3', 7, 'mp3')).toBe('agents/acquisitions/training/raw/mp3/7.mp3');
  });
});

describe('AIP — knowledge, citations, approval, versioning, graph', () => {
  it('knowledge persists with citations + links; starts proposed (not active)', () => {
    const a = registerAsset({ sourceType: 'transcript', title: 'Miner call' });
    const k = addKnowledge({ category: 'objection_category', content: 'Price objection: anchor on recent sales.', citations: [{ assetId: a.id, sourceTitle: 'Miner call', locator: '12:30', quote: 'it\'s worth more' }], confidence: 'high', sourceAssetId: a.id });
    expect(k.status).toBe('proposed'); // never active until approved
    const r = getKnowledge(k.id)!;
    expect(r.citations[0].assetId).toBe(a.id);
    expect(r.citations[0].locator).toBe('12:30');
  });
  it('approval workflow + version history; reject path', () => {
    const k = addKnowledge({ category: 'negotiation_technique', content: 'Use silence after the number.' });
    expect(getKnowledge(k.id)!.version).toBe(1);
    const ap = approveKnowledge(k.id)!;
    expect(ap.status).toBe('approved'); expect(ap.version).toBe(2);
    const k2 = addKnowledge({ category: 'mistake', content: 'Talking price too early.' });
    expect(rejectKnowledge(k2.id)!.status).toBe('rejected');
  });
  it('knowledge graph links knowledge -> knowledge and -> assets', () => {
    const a = registerAsset({ sourceType: 'book', title: 'NEPQ' });
    const base = addKnowledge({ category: 'psychology', content: 'Problem awareness questions.' });
    const k = addKnowledge({ category: 'discovery_question', content: 'What made you start looking at selling?', citations: [{ assetId: a.id, sourceTitle: 'NEPQ' }], links: [{ type: 'knowledge', refId: base.id, relation: 'derived_from' }] });
    const g = knowledgeGraph(k.id);
    expect(g.linkedKnowledge[0].id).toBe(base.id);
    expect(g.citedAssets[0].id).toBe(a.id);
  });
});

describe('AIP — playbook generation (approved only) + publish/version', () => {
  it('generates a section FROM APPROVED knowledge only; unapproved is excluded', () => {
    const approved = approveKnowledge(addKnowledge({ category: 'discovery_question', content: 'Ask motivation first.' }).id)!;
    addKnowledge({ category: 'discovery_question', content: 'PROPOSED — should NOT appear.' }); // proposed, excluded
    const gen = generatePlaybookSection('discovery');
    expect(gen.record.status).toBe('proposed'); // never auto-published
    expect(gen.record.knowledgeRefs).toContain(approved.id);
    expect(gen.record.content).toContain('Ask motivation first');
    expect(gen.record.content).not.toContain('should NOT appear');
  });
  it('publish supersedes prior published + bumps version; reads back the latest', () => {
    approveKnowledge(addKnowledge({ category: 'follow_up_timing', content: 'Follow up in 3 days.' }).id);
    const g1 = generatePlaybookSection('follow_up');
    const p1 = publishPlaybookSection(g1.record.id)!;
    expect(p1.status).toBe('published'); expect(p1.version).toBe(1);
    const g2 = generatePlaybookSection('follow_up');
    const p2 = publishPlaybookSection(g2.record.id)!;
    expect(p2.version).toBe(2);
    expect(getPublishedPlaybookSection('follow_up')!.id).toBe(p2.id); // latest published
    expect(listPlaybook('follow_up').filter((r) => r.status === 'superseded').length).toBe(1);
  });
});

describe('AIP — coaching engine (approved-only, cited)', () => {
  it('coaching returns only APPROVED knowledge, with citations', () => {
    const a = registerAsset({ sourceType: 'offer_call', title: 'Offer call A' });
    approveKnowledge(addKnowledge({ category: 'offer_framing', content: 'Frame offer as certainty + speed.', citations: [{ assetId: a.id, sourceTitle: 'Offer call A' }] }).id);
    addKnowledge({ category: 'offer_framing', content: 'PROPOSED framing — excluded.' }); // not approved
    const r = coachingLookup({ mode: 'offer_review', query: 'how should I frame the offer' });
    expect(r.insights.length).toBe(1);
    expect(r.insights[0].content).toMatch(/certainty/);
    expect(r.citations[0].sourceTitle).toBe('Offer call A');
    expect(r.insights.every((k) => k.status === 'approved')).toBe(true);
  });
});

describe('AIP — full acceptance flow (register -> ... -> coaching -> reload)', () => {
  it('runs the 10-step learning loop end to end and persists', () => {
    // 1. register asset  2. metadata  3. placeholder transcript
    const a = registerAsset({ sourceType: 'mp3', title: 'Jeremy Miner — objections', author: 'JM', metadata: { tags: ['objections', 'negotiation'], confidence: 'high' }, ext: 'mp3' });
    setTranscriptStatus(a.id, 'placeholder');
    // 4. extract sample knowledge  5. store citations
    const k = addKnowledge({ category: 'objection_category', content: '"It\'s worth more" -> get curious, ask how they arrived at the number.', citations: [{ assetId: a.id, sourceTitle: 'Jeremy Miner — objections', locator: '04:10' }], confidence: 'high', sourceAssetId: a.id });
    setExtractionStatus(a.id, 'extracted');
    // 7. require approval BEFORE it can drive the playbook
    let gen = generatePlaybookSection('objection_handling');
    expect(gen.record.content).not.toContain('get curious'); // unapproved excluded
    approveKnowledge(k.id);
    // 6. generate playbook section (now from approved)  8. publish approved version
    gen = generatePlaybookSection('objection_handling');
    expect(gen.record.content).toContain('get curious');
    const pub = publishPlaybookSection(gen.record.id)!;
    expect(pub.status).toBe('published');
    // 9. coaching lookup using approved knowledge
    const coach = coachingLookup({ mode: 'negotiation_review', query: 'price objection worth more' });
    expect(coach.insights.some((x) => /worth more/i.test(x.content))).toBe(true);
    // 10. persist + reload everything (fresh reads from SQLite)
    expect(getAsset(a.id)!.extractionStatus).toBe('extracted');
    expect(getKnowledge(k.id)!.status).toBe('approved');
    expect(getPublishedPlaybookSection('objection_handling')!.id).toBe(pub.id);
  });
});
