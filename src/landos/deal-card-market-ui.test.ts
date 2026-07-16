// Static checks: the manual market worksheet was REMOVED — market truth is the
// unique comparable registry + cluster analysis, and Market Pulse never shows
// one-point medians/bands/sell-through.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card Market — registry + clusters, not a worksheet', () => {
  it('removed the manual market research worksheet', () => {
    expect(SRC).toMatch(/Manual market worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual market research worksheet"/);
  });

  it('keeps raw provider rows collapsed as a technical audit', () => {
    expect(SRC).toMatch(/Raw provider rows \(technical audit\)/);
  });

  it('Market Pulse gates statistics on validated closed-sale counts', () => {
    expect(SRC).toMatch(/validatedSoldCount=\{compRegistry\?\.counts\.validatedSold\}/);
    expect(SRC).toMatch(/const statsSupported = soldBasis >= 3/);
    // The one-point contradictions Tyler saw must be impossible:
    expect(SRC).toMatch(/land-market direction unresolved/i);
    expect(SRC).toMatch(/Growth research incomplete/);
  });

  it('absorption/sell-through never renders from a thin closed-sale base', () => {
    expect(SRC).toMatch(/\{statsSupported && \([\s\S]{0,400}sell-through/);
  });

  it('uses no coordinate/map-pin/geocoder identity language', () => {
    expect(/geocod|nearest parcel|map pin|satellite imagery to identify/i.test(SRC)).toBe(false);
  });
});
