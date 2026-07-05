import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  createTrainingSession,
  getFieldBinding,
  saveDraftPlaybook,
  decidePlaybook,
} from './browser-training-db.js';
import { captureFieldBinding, synthesizePlaybook } from './browser-training.js';
import { runTrainedPlaybook, type TrainedBackend } from './trained-playbook-runner.js';
import { listBrowserFacts } from './browser-fact-store.js';
import type { PageLike } from './browser-session.js';

beforeEach(() => { _initTestLandosDb(); });

// Fake page whose evaluate() answers each script builder deterministically.
function makePage(opts: {
  probe?: Record<string, unknown>;
  labelSearch?: Record<string, unknown>;
  selectorValues?: Record<string, string>;
  labelValues?: Record<string, string>; // keyed by lowercased label
} = {}): { page: PageLike; clicks: number } {
  const state = { clicks: 0 };
  const page: PageLike = {
    goto: async () => ({}),
    url: () => 'https://landportal.com/map',
    evaluate: (async (fn: any) => {
      const src = String(fn);
      if (src.includes('LABELVALUE')) {
        for (const [lbl, val] of Object.entries(opts.labelValues ?? {})) {
          if (src.includes(JSON.stringify(lbl.toLowerCase()))) return val;
        }
        return '';
      }
      if (src.includes('previousElementSibling')) return JSON.stringify(opts.probe ?? '');
      if (src.includes('wants')) return JSON.stringify(opts.labelSearch ?? '');
      if (src.includes('.click(')) { state.clicks++; return undefined; }
      if (src.includes('textContent')) {
        for (const [sel, val] of Object.entries(opts.selectorValues ?? {})) {
          if (src.includes(JSON.stringify(sel))) return val;
        }
        return '';
      }
      if (src.includes('querySelector')) return true;
      return undefined;
    }) as PageLike['evaluate'],
    screenshot: async () => ({}),
    type: async () => {},
  };
  return { page, clicks: state.clicks };
}

function backend(page: PageLike): TrainedBackend {
  return { id: 'trained:test', configured: () => true, getPage: async () => page, screenshotDir: 'shots' };
}

describe('captureFieldBinding', () => {
  it('binds a clicked element to a high-confidence selector', async () => {
    const s = createTrainingSession({ title: 't', website: 'https://landportal.com/' });
    const { page } = makePage({ probe: { selector: '#owner', id: 'owner', text: 'Jane Doe', labelText: 'Owner' } });
    const res = await captureFieldBinding(s.id, { phrase: 'this is the owner name', page, clickSelector: '#owner' });
    expect(res?.field).toBe('owner');
    expect(res?.entry.selector).toBe('#owner');
    expect(res?.entry.confidence).toBe('high');
    const stored = getFieldBinding(s.id, 'owner')!;
    expect(stored.selector).toBe('#owner');
    expect(stored.sampleValue).toBe('Jane Doe');
  });

  it('binds via label search when nothing was clicked (id found near the label)', async () => {
    const s = createTrainingSession({ title: 't', website: 'https://landportal.com/' });
    const { page } = makePage({ labelSearch: { id: 'wetlandsVal', text: 'None mapped', labelText: 'Wetlands' } });
    const res = await captureFieldBinding(s.id, { phrase: "that's the wetlands", page });
    expect(res?.field).toBe('wetlands');
    expect(res?.entry.selector).toBe('#wetlandsVal');
    expect(getFieldBinding(s.id, 'wetlands')!.strategy).toBe('id');
  });

  it('falls back to a label-only binding when there is no page (low confidence)', async () => {
    const s = createTrainingSession({ title: 't' });
    const res = await captureFieldBinding(s.id, { field: 'slope', page: null });
    expect(res?.entry.strategy).toBe('label');
    expect(res?.entry.confidence).toBe('low');
    expect(getFieldBinding(s.id, 'slope')!.label).toBe('Slope');
  });

  it('re-binding the same field replaces the previous binding', async () => {
    const s = createTrainingSession({ title: 't', website: 'https://landportal.com/' });
    await captureFieldBinding(s.id, { field: 'apn', page: null });
    const { page } = makePage({ probe: { selector: '#apn', id: 'apn', text: '123-45', labelText: 'APN' } });
    await captureFieldBinding(s.id, { field: 'apn', page, clickSelector: '#apn' });
    expect(getFieldBinding(s.id, 'apn')!.selector).toBe('#apn');
  });

  it('ignores utterances that are not field bindings', async () => {
    const s = createTrainingSession({ title: 't' });
    const res = await captureFieldBinding(s.id, { phrase: 'ok let me scroll down a bit' });
    expect(res).toBeNull();
  });
});

describe('synthesis attaches captured field selectors', () => {
  it('includes fieldSelectors in the generated playbook body', async () => {
    const s = createTrainingSession({ title: 'LandPortal Map Search', website: 'https://landportal.com/' });
    const { page } = makePage({ probe: { selector: '#owner', id: 'owner', text: 'Jane', labelText: 'Owner' } });
    await captureFieldBinding(s.id, { field: 'owner', page, clickSelector: '#owner' });
    await captureFieldBinding(s.id, { field: 'wetlands', page: null }); // label-only
    const pb = await synthesizePlaybook(s.id);
    const fs = (pb.body as any).fieldSelectors;
    expect(fs.owner.selector).toBe('#owner');
    expect(fs.owner.confidence).toBe('high');
    expect(fs.wetlands.strategy).toBe('label');
    expect(fs.wetlands.label).toBe('Wetlands');
  });
});

describe('execution extracts bound fields and writes them back', () => {
  function approvedWithSelectors(): number {
    const draft = saveDraftPlaybook({
      sessionId: null,
      slug: 'lp_map_search',
      name: 'LandPortal Map Search',
      website: 'https://landportal.com/',
      body: {
        website: 'https://landportal.com/',
        steps: [
          { action: 'Navigate to parcel', url: 'https://landportal.com/map?parcel=1' },
          { action: 'Capture screenshot: sidebar', note: 'sidebar' },
        ],
        fieldSelectors: {
          owner: { selector: '#owner', label: 'Owner', confidence: 'high', strategy: 'provided' },
          wetlands: { selector: '', label: 'Wetlands', confidence: 'medium', strategy: 'label' },
        },
      },
    });
    return decidePlaybook(draft.id, 'approved', 'Tyler').id;
  }

  it('extracts via selector and via label fallback, and writes facts in live mode', async () => {
    const id = approvedWithSelectors();
    const { page } = makePage({
      selectorValues: { '#owner': 'Jane Doe' },
      labelValues: { wetlands: 'None mapped' },
    });
    const res = await runTrainedPlaybook(id, { mode: 'live', dealCardId: 55, backend: backend(page) });
    const exec = res.execution!;
    const owner = exec.extractedFields.find((f) => f.field === 'owner')!;
    const wet = exec.extractedFields.find((f) => f.field === 'wetlands')!;
    expect(owner.value).toBe('Jane Doe');
    expect(owner.strategy).toBe('selector');
    expect(wet.value).toBe('None mapped');
    expect(wet.strategy).toBe('label'); // selector empty → label fallback
    expect(exec.fieldsWritten).toBe(2);

    const facts = listBrowserFacts(55);
    expect(facts.map((f) => f.key).sort()).toEqual(['owner', 'wetlands']);
    expect(facts.find((f) => f.key === 'owner')!.confidence).toBe('high');
    expect(facts.find((f) => f.key === 'wetlands')!.confidence).toBe('medium');
  });

  it('extracts in dry-run but does NOT write to the Deal Card', async () => {
    const id = approvedWithSelectors();
    const { page } = makePage({ selectorValues: { '#owner': 'Jane Doe' }, labelValues: { wetlands: 'None mapped' } });
    const res = await runTrainedPlaybook(id, { mode: 'dry_run', dealCardId: 56, backend: backend(page) });
    expect(res.execution!.extractedFields.length).toBe(2);
    expect(res.execution!.fieldsWritten).toBe(0);
    expect(listBrowserFacts(56)).toHaveLength(0);
  });

  it('a paid step stops before extraction/writeback even with bound fields', async () => {
    const draft = saveDraftPlaybook({
      sessionId: null, slug: 'lp_paid', name: 'LP', website: 'https://landportal.com/',
      body: {
        website: 'https://landportal.com/',
        steps: [{ action: 'Click Buy Report', selector: '#buy' }],
        fieldSelectors: { owner: { selector: '#owner', label: 'Owner', confidence: 'high', strategy: 'provided' } },
      },
    });
    const id = decidePlaybook(draft.id, 'approved', 'Tyler').id;
    const { page } = makePage({ selectorValues: { '#owner': 'Jane Doe' } });
    const res = await runTrainedPlaybook(id, { mode: 'live', dealCardId: 57, backend: backend(page) });
    expect(res.execution!.status).toBe('blocked');
    expect(res.execution!.approvalRequired).toBe(true);
    expect(res.execution!.extractedFields.length).toBe(0);
    expect(res.execution!.fieldsWritten).toBe(0);
    expect(listBrowserFacts(57)).toHaveLength(0);
  });
});
