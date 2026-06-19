// Static checks on the Deal Card Market Research worksheet UI (source-scan style).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card Market Research worksheet UI', () => {
  it('renders a Market Research section', () => {
    expect(SRC).toMatch(/title="Market Research"/);
  });

  it('surfaces every required market demand lane', () => {
    for (const f of [
      'Local buyer demand', 'Manufactured-home demand', 'Subdivision demand',
      'Infill-lot demand', 'Rural acreage demand',
    ]) {
      expect(SRC.includes(f), `missing demand lane ${f}`).toBe(true);
    }
  });

  it('surfaces listing/sold/growth context and exit-support fields', () => {
    for (const f of [
      'Target market / area', 'County / city / region notes', 'Active listing notes',
      'Sold comp context notes', 'Days-on-market notes', 'County growth / planning notes',
      'Exit strategy support notes', 'Source confidence',
    ]) {
      expect(SRC.includes(f), `missing market field ${f}`).toBe(true);
    }
  });

  it('exposes the six honest demand labels', () => {
    for (const l of ['Not reviewed', 'Needs research', 'Weak demand', 'Moderate demand', 'Strong demand', 'Mixed / uncertain']) {
      expect(SRC.includes(l), `missing demand label ${l}`).toBe(true);
    }
    expect(SRC).toMatch(/const MARKET_DEMAND_LABELS = \[/);
    expect(SRC).toMatch(/const MARKET_SOURCE_CONFIDENCE = \[/);
  });

  it('reads and writes Market Research via the dedicated GET/PUT routes', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{id\}\/market`\)/);
    expect(SRC).toMatch(/apiPut<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{deal\.id\}\/market`/);
  });

  it('re-loads the saved worksheet after a write (persistence, no duplicate)', () => {
    expect(SRC).toMatch(/await loadMarket\(deal\.id\)/);
    expect(SRC).toMatch(/await loadMarket\(id\)/);
  });

  it('surfaces a market demand badge and guardrail warnings', () => {
    expect(SRC).toMatch(/MarketDemandBadge/);
    expect(SRC).toMatch(/marketWarnings/);
  });

  it('honest empty state when market not reviewed yet', () => {
    expect(SRC).toMatch(/Market not reviewed yet/);
  });

  it('keeps market research manual/local with no fabricated comp/demand/price language', () => {
    // The panel must state it computes nothing.
    expect(SRC).toMatch(/are computed or fabricated/);
    expect(SRC).toMatch(/separate from property-level DD/);
    // Market must not CLAIM to compute comps/demand/pricing.
    expect(/auto.?comp|generate[ds]? comps|computed (demand|comps|price|value)/i.test(SRC)).toBe(false);
  });

  it('uses no coordinate/proximity/map-pin/geocoder language in the market worksheet', () => {
    expect(/geocod|proximity|nearest parcel|map pin|satellite imagery to identify/i.test(SRC)).toBe(false);
  });
});
