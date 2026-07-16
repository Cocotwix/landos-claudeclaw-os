import { describe, expect, it } from 'vitest';
import { buildResearchMissionView, classifyActivityEvent, type ActivityEventIn } from './research-mission.js';

let nextId = 1;
function ev(kind: string, summary: string, createdAt: number): ActivityEventIn {
  return { id: nextId++, kind, summary, agentId: 'landos', createdAt };
}

const NOW = 1_800_000_000;

describe('activity classification', () => {
  it('classifies superseded, rejected, failed, pending, accepted', () => {
    expect(classifyActivityEvent(ev('visual_capture', 'Capture superseded: parcel association could not be proven', NOW))).toBe('superseded');
    expect(classifyActivityEvent(ev('comp_research', '15 Redfin rows rejected: wrong market (AR vs SC)', NOW))).toBe('rejected');
    expect(classifyActivityEvent(ev('public_intelligence', 'FEMA panel lookup failed: service unavailable', NOW))).toBe('failed');
    expect(classifyActivityEvent(ev('comp_research', 'County sales pull pending next authenticated session', NOW))).toBe('pending');
    expect(classifyActivityEvent(ev('property_inspection', 'Captured 7 verified overlays', NOW))).toBe('accepted');
  });
});

describe('research mission view', () => {
  it('separates the current mission burst from history and groups repeats', () => {
    const events = [
      // Old mission, two identical runs (should group with occurrences=2).
      ev('visual_capture', 'Captured 3 google verified parcel image(s).', NOW - 86400 * 5),
      ev('visual_capture', 'Captured 3 google verified parcel image(s).', NOW - 86400 * 5 + 60),
      ev('report_run', 'Report generated.', NOW - 86400 * 5 + 120),
      // Current mission burst.
      ev('public_intelligence', 'Wetlands overlay computed: 0.999 ac (28.5%).', NOW - 600),
      ev('comp_research', '8 Redfin rows rejected: wrong market.', NOW - 500),
      ev('deal_card_reconcile', 'Reconciled canonical records.', NOW - 400),
    ];
    const view = buildResearchMissionView(events, { nowSeconds: NOW });
    expect(view.current.status).toBe('in_progress');
    expect(view.current.accepted.map((e) => e.kind)).toContain('public_intelligence');
    expect(view.current.rejected).toHaveLength(1);
    expect(view.history.find((e) => e.kind === 'visual_capture')?.occurrences).toBe(2);
    expect(view.history.map((e) => e.kind)).toContain('report_run');
  });

  it('handles empty activity honestly', () => {
    const view = buildResearchMissionView([], { nowSeconds: NOW });
    expect(view.current.status).toBe('none');
    expect(view.history).toHaveLength(0);
    expect(view.counts.accepted).toBe(0);
  });

  it('marks an old burst complete, not in progress', () => {
    const view = buildResearchMissionView([ev('report_run', 'Report generated.', NOW - 86400)], { nowSeconds: NOW });
    expect(view.current.status).toBe('complete');
  });
});
