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
const MAP_SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/landos/CompMap.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card Market — registry + clusters, not a worksheet', () => {
  it('removed the manual market research worksheet', () => {
    expect(SRC).toMatch(/Manual market worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual market research worksheet"/);
  });

  it('removes raw provider rows from the owner-facing card', () => {
    expect(SRC).not.toMatch(/Raw provider rows \(technical audit\)/);
  });

  it('renders retained LandPortal asking references and the reconciled valuation', () => {
    expect(SRC).toMatch(/<LandPortalComparableTable inspection=\{report\?\.landportalInspection\}/);
    expect(SRC).toMatch(/report\?\.valuation\?\.primary && <ValuationPanel val=\{report\.valuation\}/);
    expect(SRC).toMatch(/Average LandPortal comp price per acre/);
    expect(SRC).toMatch(/Rough offer range \(40%–60% of FMV\)/);
    expect(SRC).not.toMatch(/Median accepted sold price per acre/);
  });

  it('keeps the retained LandPortal artifact and renders the live comparable-property map', () => {
    expect(SRC).toMatch(/<LandPortalCompMapEvidence inspection=\{report\.landportalInspection\}/);
    expect(SRC).toMatch(/<CompMap dealCardId=/);
    expect(SRC).not.toMatch(/provider attempts|attempt count|evidence count/i);
  });

  it('explains clusters and unresolved source locations in owner language', () => {
    expect(MAP_SRC).toMatch(/comparables in this area\. Zoom in to separate them/);
    expect(MAP_SRC).toMatch(/Numbered circles group nearby comparables/);
    expect(MAP_SRC).toMatch(/do not publish a reliable map point/);
    expect(MAP_SRC).toMatch(/Retry source locations/);
    expect(MAP_SRC).not.toMatch(/record\(s\) lack coordinates/);
  });

  it('uses no coordinate/map-pin/geocoder identity language', () => {
    expect(/geocod|nearest parcel|map pin|satellite imagery to identify/i.test(SRC)).toBe(false);
  });
});
