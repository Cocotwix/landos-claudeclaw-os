import { describe, it, expect, vi } from 'vitest';
import {
  summarizeDraft, researchDigestDraft, reportSectionDraft, marketPulseDraft,
  classifyDraft, extractDraft, mediaGruntDraft, DRAFT_LABEL, GRUNT_HELPERS,
} from './grunt-helpers.js';
import type { RoutedTaskOutcome } from './model-router-service.js';

const off = { enabled: () => false };
const executed = (text: string, modelId = 'gemma-4-e4b'): RoutedTaskOutcome =>
  ({ status: 'executed', decision: {} as any, result: { text, modelId }, executedModelId: modelId, liveRouting: true });
const on = (text: string) => ({ enabled: () => true, execute: vi.fn(async () => executed(text)) });

describe('grunt helpers — deterministic fallback when live routing OFF (no model call)', () => {
  it('summarize falls back deterministically and never calls the model', async () => {
    const execute = vi.fn();
    const r = await summarizeDraft('One. Two. Three. Four.', { enabled: () => false, execute });
    expect(r.mode).toBe('deterministic');
    expect(r.assistantGenerated).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
  it('report-section restates ONLY provided facts', async () => {
    const r = await reportSectionDraft('Access', ['Frontage on county road', 'No recorded easement'], off);
    expect(r.value).toContain('Frontage on county road');
    expect(r.value).toContain('## Access');
  });
  it('market pulse labels itself non-parcel-verified', async () => {
    const r = await marketPulseDraft(['DOM 70', 'absorption 55%'], off);
    expect(r.value).toMatch(/not parcel-verified/i);
  });
});

describe('grunt helpers — model path when enabled', () => {
  it('summarize uses the model draft and labels it', async () => {
    const d = on('A crisp summary.');
    const r = await summarizeDraft('long text', d);
    expect(r.mode).toBe('model');
    expect(r.assistantGenerated).toBe(true);
    expect(r.label).toBe(DRAFT_LABEL);
    expect(r.value).toBe('A crisp summary.');
  });
  it('research digest routes through the model', async () => {
    const r = await researchDigestDraft('text', on('- a\n- b'));
    expect(r.mode).toBe('model');
  });
});

describe('classify constrains to the label set', () => {
  it('accepts an in-set model label', async () => {
    const r = await classifyDraft('this is residential', ['residential', 'commercial'], on('residential'));
    expect(r.value).toBe('residential');
    expect(r.mode).toBe('model');
  });
  it('rejects an out-of-set model label and uses deterministic', async () => {
    const r = await classifyDraft('this is residential land', ['residential', 'commercial'], on('industrial'));
    expect(r.mode).toBe('deterministic');
    expect(r.value).toBe('residential'); // token match fallback
  });
  it('deterministic returns unclassified when no token matches', async () => {
    const r = await classifyDraft('xyz', ['residential', 'commercial'], off);
    expect(r.value).toBe('unclassified');
  });
});

describe('extract never fabricates', () => {
  it('returns nulls deterministically when off', async () => {
    const r = await extractDraft('some text', ['owner', 'acreage'], off);
    expect(r.value).toEqual({ owner: null, acreage: null });
    expect(r.mode).toBe('deterministic');
  });
  it('parses model JSON but only the requested fields', async () => {
    const r = await extractDraft('text', ['owner', 'acreage'], on('{"owner":"Smith","acreage":"5","extra":"x"}'));
    expect(r.value).toEqual({ owner: 'Smith', acreage: '5' });
    expect(r.mode).toBe('model');
  });
});

describe('media grunt-work', () => {
  it('reports unavailable (no fabrication) when off', async () => {
    const r = await mediaGruntDraft({ kind: 'ocr', prompt: 'scan' }, off);
    expect(r.value).toBe('');
    expect(r.note).toMatch(/unavailable/i);
  });
  it('uses the model when enabled', async () => {
    const r = await mediaGruntDraft({ kind: 'audio', prompt: 'transcribe' }, on('transcript text'));
    expect(r.mode).toBe('model');
    expect(r.value).toBe('transcript text');
  });
});

describe('helper registry (dashboard visibility)', () => {
  it('lists the router-enabled helpers', () => {
    const ids = GRUNT_HELPERS.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['summarize', 'classify', 'extract', 'research_digest', 'report_section', 'market_pulse', 'county_narration', 'media_ocr']));
  });
});
