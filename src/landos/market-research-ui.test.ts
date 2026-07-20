// Market Research workspace — sidebar/route integration + geometry cache.
//
// Structural contract: the existing Market Research sidebar tab
// (/dept/market-research) hosts the workspace (no parallel route, no duplicate
// sidebar item), both views share one snapshot/filter/selection state, and ZIP
// geometry is retained in landos_mr_geometry (fetched once, never refetched).

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { getZipGeometries } from './market-research-geometry.js';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('Market Research sidebar integration', () => {
  it('mounts the workspace on the existing /dept/market-research sidebar route', () => {
    const app = read('web/src/App.tsx');
    expect(app).toContain(`<Route path="/dept/market-research"><MarketResearch /></Route>`);
    // The dedicated route must precede the generic department shell route.
    expect(app.indexOf('/dept/market-research')).toBeLessThan(app.indexOf('"/dept/:slug"'));
  });

  it('keeps one Market Research department entry pointing at the workspace', () => {
    const depts = read('web/src/lib/departments.ts');
    expect(depts).toContain(`slug: 'market-research'`);
    expect(depts).toContain(`href: '/dept/market-research'`);
    expect((depts.match(/slug: 'market-research'/g) ?? []).length).toBe(1);
  });

  it('shares one snapshot + filter + selection state across Heat Map and Drill Deep', () => {
    const page = read('web/src/pages/MarketResearch.tsx');
    // Two view tabs over ONE shared drill/selection state.
    expect(page).toContain(`label="Heat Map"`);
    expect(page).toContain(`label="Drill Deep"`);
    for (const shared of ['drillState', 'drillCounty', 'selectedGeo', 'snapshot']) {
      expect(page).toContain(shared);
    }
    // Both views receive the SAME selection + navigation callbacks.
    expect(page).toContain('<HeatMapView');
    expect(page).toContain('<DrillDeepTable');
    // Fixed context is visible, and absence is never rendered as zero.
    expect(page).toContain('Trailing 1 year');
    expect(page).toContain('never zero');
  });

  it('renders absent map values as no-data, never zero', () => {
    const map = read('web/src/components/MarketHeatMap.tsx');
    expect(map).toContain('No retained result');
    expect(map).toContain('never shown as zero');
  });
});

describe('ZIP geometry retention', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('fetches a missing ZCTA once, retains it, and reports unavailable ZIPs honestly', async () => {
    let calls = 0;
    const fetcher = async (zips: string[]) => {
      calls++;
      const m = new Map<string, unknown>();
      for (const z of zips) if (z === '30214') m.set(z, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
      return m;
    };
    const first = await getZipGeometries(['30214', '99999'], fetcher);
    expect(first.features.map((f) => f.properties.zip)).toEqual(['30214']);
    expect(first.unavailable).toEqual(['99999']);
    expect(calls).toBe(1);

    // Retained: the second read serves from landos_mr_geometry without refetching 30214.
    const second = await getZipGeometries(['30214'], async () => { throw new Error('must not be called'); });
    expect(second.features).toHaveLength(1);
    const stored = getLandosDb().prepare(`SELECT source FROM landos_mr_geometry WHERE geo_key = 'zip:30214'`).get() as { source: string };
    expect(stored.source).toBe('census_tigerweb_zcta520');
  });
});
