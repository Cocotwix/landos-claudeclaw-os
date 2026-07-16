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

  it('renders the shared strategy readiness record + merged blocker panel', () => {
    expect(SRC).toMatch(/<StrategyReadinessPanel readiness=\{strategyReadiness\}/);
    expect(SRC).toMatch(/<RemainingBlockersPanel readiness=\{strategyReadiness\} unknowns=\{operatorRecord\?\.unknowns\}/);
    expect(SRC).not.toMatch(/<ConfirmBeforeOfferSection/);
  });

  it('uses no coordinate/map-pin identity language', () => {
    expect(/geocod|nearest parcel|map pin/i.test(SRC)).toBe(false);
  });
});
