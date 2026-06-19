// Static checks on the Deal Card DD/Research worksheet UI (source-scan style).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card DD/Research worksheet UI', () => {
  it('renders a Due Diligence / Research section', () => {
    expect(SRC).toMatch(/Due Diligence \/ Research/);
  });

  it('surfaces every required DD field label', () => {
    for (const f of [
      'APN / Parcel ID', 'County / State', 'Acreage', 'Zoning / land use',
      'Access', 'Utilities', 'Flood', 'Wetlands', 'Road / frontage notes',
      'Source links', 'Data gaps', 'Risk flags',
    ]) {
      expect(SRC.includes(f), `missing DD field ${f}`).toBe(true);
    }
  });

  it('exposes the six confidence labels including local-area-context', () => {
    for (const l of ['Verified', 'Seller stated', 'Assumed', 'Unknown', 'Needs verification', 'Local Area Context, Not Parcel Verified']) {
      expect(SRC.includes(l), `missing label ${l}`).toBe(true);
    }
  });

  it('reads and writes DD via the dedicated GET/PUT routes', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{id\}\/dd`\)/);
    expect(SRC).toMatch(/apiPut<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{deal\.id\}\/dd`/);
  });

  it('re-loads the saved worksheet after a write (persistence, no duplicate)', () => {
    expect(SRC).toMatch(/await loadDd\(deal\.id\)/);
    expect(SRC).toMatch(/await loadDd\(id\)/);
  });

  it('shows missing fields as missing and surfaces a parcel-identity badge', () => {
    expect(SRC).toMatch(/Placeholder text="Missing"/);
    expect(SRC).toMatch(/DdIdentityBadge/);
    expect(SRC).toMatch(/Local Area Context, Not Parcel Verified/);
  });

  it('surfaces guardrail warnings returned by the API', () => {
    expect(SRC).toMatch(/ddWarnings/);
  });

  it('keeps DD entry manual/local with no coordinate/proximity verification language', () => {
    expect(SRC).toMatch(/manual\/local/);
    expect(/geocod|proximity|nearest parcel|map pin/i.test(SRC)).toBe(false);
  });

  it('honest empty state when no DD data captured yet', () => {
    expect(SRC).toMatch(/No DD\/Research data captured yet/);
  });
});
