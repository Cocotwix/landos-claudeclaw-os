// Static checks: the manual strategy worksheet was REMOVED — strategy truth is
// the shared strategy-readiness record, and Confirm-Before-Offer merged with
// Remaining Verification into one specific-blocker panel.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card Strategy — shared readiness record, not a worksheet', () => {
  it('removed the manual strategy worksheet', () => {
    expect(SRC).toMatch(/Manual strategy worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual strategy worksheet"/);
  });

  it('renders the pursuit and exit analysis without readiness panels', () => {
    expect(SRC).toMatch(/<PursuitPanel pursuit=\{pursuit\}/);
    expect(SRC).toMatch(/<OwnerStrategiesPanel analysis=\{ownerAnalysis\}/);
    expect(SRC).not.toMatch(/<StrategyReadinessPanel\b/);
    expect(SRC).not.toMatch(/<RemainingBlockersPanel\b/);
    expect(SRC).not.toMatch(/report\?\.valuation\?\.conflict/);
  });

  it('uses no coordinate/map-pin identity language', () => {
    expect(/geocod|nearest parcel|map pin/i.test(SRC)).toBe(false);
  });
});
