// Static checks on the Deal Card Strategy worksheet UI (source-scan style).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card Strategy worksheet UI', () => {
  it('renders a Strategy section', () => {
    expect(SRC).toMatch(/title="Strategy"/);
  });

  it('surfaces every required distinct exit strategy lane', () => {
    for (const f of [
      'Quick flip', 'Subdivide', 'Land-home package',
      'Improved-property / mobile-home value-add', 'Teardown / land-only fallback',
      'Pass / no-offer reason',
    ]) {
      expect(SRC.includes(f), `missing strategy lane ${f}`).toBe(true);
    }
  });

  it('surfaces the strategy analysis fields', () => {
    for (const f of [
      'Current recommendation', 'Most viable strategy', 'Strategy candidates',
      'Blockers', 'Next confirmations', 'Pre-call strategy notes',
      'Risk-adjusted notes', 'Target profit note',
    ]) {
      expect(SRC.includes(f), `missing strategy field ${f}`).toBe(true);
    }
  });

  it('exposes the five honest offer-readiness labels', () => {
    for (const l of ['Ready for offer', 'Needs confirmation', 'Blocked', 'Pass', 'Not reviewed']) {
      expect(SRC.includes(l), `missing readiness label ${l}`).toBe(true);
    }
    expect(SRC).toMatch(/const STRATEGY_READINESS = \[/);
  });

  it('reads and writes Strategy via the dedicated GET/PUT routes', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{id\}\/strategy`\)/);
    expect(SRC).toMatch(/apiPut<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{deal\.id\}\/strategy`/);
  });

  it('re-loads the saved worksheet after a write (persistence, no duplicate)', () => {
    expect(SRC).toMatch(/await loadStrategy\(deal\.id\)/);
    expect(SRC).toMatch(/await loadStrategy\(id\)/);
  });

  it('surfaces an offer-readiness badge and guardrail warnings', () => {
    expect(SRC).toMatch(/StrategyReadinessBadge/);
    expect(SRC).toMatch(/strategyWarnings/);
  });

  it('honest empty state when strategy not reviewed yet', () => {
    expect(SRC).toMatch(/Strategy not reviewed yet/);
  });

  it('keeps strategy manual/local with no fabricated offer/EV/comp language', () => {
    expect(SRC).toMatch(/never a final offer/);
    expect(SRC).toMatch(/not a calculated offer/);
    // Strategy must not CLAIM to compute an offer/EV/comp.
    expect(/auto.?offer|generate[ds]? an offer|computed (offer|ev)/i.test(SRC)).toBe(false);
  });

  it('uses no coordinate/proximity/map-pin language in the strategy worksheet', () => {
    expect(/geocod|proximity|nearest parcel|map pin/i.test(SRC)).toBe(false);
  });
});
