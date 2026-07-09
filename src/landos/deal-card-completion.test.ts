import { beforeEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, attachCardActivity, getCardActivity } from './property-card.js';

beforeEach(() => {
  _initTestLandosDb();
});

describe('Deal Card activity timeline (backend)', () => {
  it('returns recorded events newest-first, and empty for a card with none', () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '1 Timeline Rd, Town SC' });
    expect(getCardActivity(card.id)).toEqual([]);

    attachCardActivity({ cardId: card.id, agentId: 'tyler/visual', kind: 'visual_capture', summary: 'Captured 2 google visual(s).' });
    attachCardActivity({ cardId: card.id, agentId: 'browser-vision', kind: 'vision_analysis', summary: 'Parcel has road access.' });
    attachCardActivity({ cardId: card.id, agentId: 'tyler/visual-intel', kind: 'visual_intelligence', summary: 'Visual Intelligence run.' });

    const events = getCardActivity(card.id);
    expect(events).toHaveLength(3);
    // Newest first (id DESC is the tiebreaker within the same second).
    expect(events[0].kind).toBe('visual_intelligence');
    expect(events[2].kind).toBe('visual_capture');
    expect(events[0].summary).toContain('Visual Intelligence');
    for (const e of events) expect(typeof e.createdAt).toBe('number');
  });

  it('is scoped per card', () => {
    const a = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '2 A St, Town SC' }).card;
    const b = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '3 B St, Town SC' }).card;
    attachCardActivity({ cardId: a.id, agentId: 'x', kind: 'note', summary: 'note on A' });
    expect(getCardActivity(a.id)).toHaveLength(1);
    expect(getCardActivity(b.id)).toHaveLength(0);
  });
});

describe('Deal Card completion standard (DealCard.tsx source)', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, '../../web/src/components/DealCard.tsx'), 'utf8');

  it('Activity tab renders the real ActivityTimeline, not a dead placeholder', () => {
    expect(SRC).toMatch(/<ActivityTimeline dealId=\{deal\.id\}/);
    expect(SRC).toMatch(/\/api\/landos\/deal-cards\/\$\{dealId\}\/activity/);
    // The old always-empty activity placeholder must be gone.
    expect(SRC).not.toMatch(/text="No activity recorded yet"\s*\/>/);
  });

  it('Documents tab offers real report downloads and drops the disabled CRM clutter', () => {
    expect(SRC).toMatch(/report\/download\?format=pdf/);
    expect(SRC).toMatch(/report\/download\?format=md/);
    // The developer-clutter disabled quick-action buttons must be gone.
    expect(SRC).not.toMatch(/'Push to CRM'/);
    expect(SRC).not.toMatch(/'Make Offer', 'Schedule Follow-Up'/);
  });

  it('Strategy still excludes neighbor sale as an acquisition strategy', () => {
    expect(SRC).toMatch(/Neighbor sale is NOT an acquisition strategy/i);
    expect(SRC).toMatch(/\/neighbor\/i/);
  });

  it('Visual Intelligence panel is present with static-map-fallback hero doctrine intact', () => {
    expect(SRC).toMatch(/function VisualIntelligencePanel/);
    expect(SRC).toMatch(/visual-intelligence/);
  });
});
