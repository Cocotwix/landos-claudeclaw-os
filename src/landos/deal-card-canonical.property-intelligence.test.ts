import { describe, expect, it } from 'vitest';
import { modelVersionForCard, retainedCompRunsFromReport, type ReportCompLanes } from './deal-card-canonical.js';
import { buildCompRegistry } from './comp-registry.js';

describe('Deal Card canonical Property Intelligence provider outcomes', () => {
  it('retains result, no-result, blocked, timeout, failure, and LandPortal outcomes without calling providers', () => {
    const lanes: ReportCompLanes = {
      providers: [
        { providerId: 'Realie', status: 'collected', kept: 1 },
        { providerId: 'Zillow', status: 'no_results', kept: 0 },
        { providerId: 'Redfin', status: 'blocked', kept: 0 },
        { providerId: 'Realtor', status: 'timeout', kept: 0 },
        { providerId: 'Home Harvest', status: 'failed', kept: 0 },
        { providerId: 'Public transfers', status: 'not_authorized', kept: 0 },
      ],
      sold: [{ sourceLabel: 'Realie', addressDesc: '1 Retained Result Rd, Newport, TN', price: 70_000, saleDateIso: '2026-01-15', acres: 7, sourceUrl: 'https://realie.example/1', lat: 35.9, lng: -83.2 }],
      landportalComps: { status: 'no_results', count: 0, note: 'Free visible similar-sales surface returned no rows.', rows: [] },
    };

    const runs = retainedCompRunsFromReport(lanes);
    expect(Object.fromEntries(runs.map((run) => [run.provider, run.status]))).toMatchObject({
      Realie: 'succeeded', Zillow: 'no_result', Redfin: 'blocked', Realtor: 'timeout',
      'Home Harvest': 'failed', 'Public transfers': 'blocked', 'LandPortal visible': 'no_result',
    });
    expect(runs.find((run) => run.provider === 'Realie')?.candidates[0]).toMatchObject({ lat: 35.9, lng: -83.2 });
    expect(runs.find((run) => run.provider === 'LandPortal visible')?.note).toMatch(/Free visible similar-sales surface returned no rows/);
    expect(runs.every((run) => run.elapsedMs === 0 && run.result === null)).toBe(true);
  });

  it('does not advertise a persisted-row reconcile for rejected report-only candidates', () => {
    const reportOnly = buildCompRegistry({ state: 'TN' }, [{
      provider: 'Zillow', lane: 'active', addressDesc: '327 S 3rd St E, Magrath, AB T0K 1J0 ROYAL',
      price: 75_000, priceKind: 'list', sourceUrl: 'https://zillow.example/ca',
    }]);
    expect(modelVersionForCard(null, reportOnly).reasons).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/persisted comp row/i),
    ]));

    const persisted = buildCompRegistry({ state: 'TN' }, [{
      id: 42, provider: 'Zillow', lane: 'active', addressDesc: '327 S 3rd St E, Magrath, AB T0K 1J0 ROYAL',
      price: 75_000, priceKind: 'list', sourceUrl: 'https://zillow.example/ca',
    }]);
    expect(modelVersionForCard(null, persisted).reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/1 persisted comp row/i),
    ]));
  });
});
