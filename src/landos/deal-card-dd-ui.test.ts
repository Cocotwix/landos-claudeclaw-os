// Static checks: the manual DD worksheet was REMOVED from the operator Deal
// Card (canonical reconciled facts + the DD business-status panel own that
// read now), and no unsafe access/identity language can render.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card DD — canonical records, not a worksheet', () => {
  it('removed the manual DD worksheet from the Property tab', () => {
    expect(SRC).toMatch(/Manual DD worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual DD \/ research worksheet"/);
  });

  it('renders the DD business-status panel (execution ≠ completeness ≠ strength)', () => {
    expect(SRC).toMatch(/<DdBusinessStatusPanel rows=\{ddBusinessStatus\}/);
  });

  it('uses no coordinate/map-pin identity language, and proximity is never called frontage', () => {
    expect(/geocod|nearest parcel|map pin/i.test(SRC)).toBe(false);
    expect(/ft mapped frontage/i.test(SRC)).toBe(false);
    expect(/mapped frontage ft/i.test(SRC)).toBe(false);
    expect(/road and frontage screen/i.test(SRC)).toBe(false);
    expect(SRC).toMatch(/Frontage footage is not established/);
  });

  it('the legacy detailed-DD dump is gone from the Property tab', () => {
    expect(SRC).toMatch(/Legacy "Detailed Due Diligence & Research" dump removed/);
  });
});
