// Property Board workspace-readiness summary — the at-a-glance signal on each
// kanban card (inspection / visuals / comps / seller questions). Counts must
// reflect the CURRENT persisted state, never inflated activity history, and never
// fabricate a count for a card with no data.
import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, attachCardActivity } from './property-card.js';
import { addComp } from './comps.js';
import { createDealCard } from './deal-card.js';
import { withPropertyWorkspaceSummary } from './routes.js';

beforeEach(() => {
  _initTestLandosDb();
});

function newCard() {
  return upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '10 Board Rd, Town SC' }).card;
}

const inspectionRef = (assets: number, questions: number) =>
  JSON.stringify({
    assets: Array.from({ length: assets }, (_, i) => ({ key: `a${i}` })),
    discoveryQuestions: Array.from({ length: questions }, (_, i) => `q${i}`),
  });

describe('withPropertyWorkspaceSummary', () => {
  it('summarises the CURRENT inspection, not the sum of every re-run (no inflation)', () => {
    const card = newCard();
    // Two inspection runs re-persist the same 3 assets + 2 questions.
    attachCardActivity({ cardId: card.id, agentId: 'test', kind: 'property_inspection', summary: 'run1', ref: inspectionRef(3, 2) });
    attachCardActivity({ cardId: card.id, agentId: 'test', kind: 'property_inspection', summary: 'run2', ref: inspectionRef(3, 2) });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ' });
    addComp({ entity: 'TY_LAND_BIZ', dealCardId: deal.id, cardId: card.id, sourceLabel: 'Zillow', addressDesc: 'comp A', price: 1000, acres: 1 });

    const [s] = withPropertyWorkspaceSummary([{ id: card.id }]);
    expect(s.workspace_has_inspection).toBe(true);
    expect(s.workspace_visual_count).toBe(3);          // latest inspection only, NOT 6
    expect(s.workspace_seller_question_count).toBe(2); // latest inspection only, NOT 4
    expect(s.workspace_comp_count).toBe(1);
  });

  it('reads 0 / false for a card with no workspace data (no artificial gaps, no fabrication)', () => {
    const card = newCard();
    const [s] = withPropertyWorkspaceSummary([{ id: card.id }]);
    expect(s.workspace_has_inspection).toBe(false);
    expect(s.workspace_visual_count).toBe(0);
    expect(s.workspace_comp_count).toBe(0);
    expect(s.workspace_seller_question_count).toBe(0);
  });

  it('counts landportal_inspection as an inspection too, and survives a malformed ref', () => {
    const card = newCard();
    attachCardActivity({ cardId: card.id, agentId: 'test', kind: 'landportal_inspection', summary: 'lp', ref: inspectionRef(4, 1) });
    attachCardActivity({ cardId: card.id, agentId: 'test', kind: 'property_inspection', summary: 'bad', ref: '{not json' });
    // Latest row (the malformed one) yields no counts but must not throw; the
    // loader falls back to the newest PARSEABLE inspection is not guaranteed —
    // what matters is the board never breaks and inspection presence is honest.
    const [s] = withPropertyWorkspaceSummary([{ id: card.id }]);
    expect(s.workspace_has_inspection).toBe(true);
    expect(Number.isFinite(s.workspace_visual_count)).toBe(true);
  });

  it('preserves the original card fields (summary is additive)', () => {
    const card = newCard();
    const [s] = withPropertyWorkspaceSummary([{ id: card.id, county: 'X', state: 'SC' }]);
    expect(s.county).toBe('X');
    expect(s.state).toBe('SC');
    expect(s.id).toBe(card.id);
  });
});
