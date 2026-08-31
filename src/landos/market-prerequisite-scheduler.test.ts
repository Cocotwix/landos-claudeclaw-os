import { describe, expect, it, vi } from 'vitest';

import { runMarketPrerequisiteWork } from './market-prerequisite-scheduler.js';

describe('market prerequisite scheduler', () => {
  it('starts county research, County Pulse, and ZIP research together without parcel identity', async () => {
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const task = (id: string) => vi.fn(() => new Promise((resolve) => {
      started.push(id); releases.set(id, () => resolve({ id }));
    }));
    const countyResearch = task('county');
    const countyPulse = task('pulse');
    const zipResearch = task('zip');
    const work = runMarketPrerequisiteWork(
      { county: 'Iredell', state: 'NC', zip: '28625' },
      { countyResearch, countyPulse, zipResearch },
    );
    await Promise.resolve();
    expect(started).toEqual(['county', 'pulse', 'zip']);
    releases.forEach((release) => release());
    const result = await work;
    expect(Object.values(result).every((item) => item.status === 'returned')).toBe(true);
  });

  it('runs county work when ZIP and parcel are unknown', async () => {
    const countyResearch = vi.fn(async () => ({ scope: 'county' }));
    const countyPulse = vi.fn(async () => ({ scope: 'county-pulse' }));
    const zipResearch = vi.fn(async () => ({ scope: 'zip' }));
    const result = await runMarketPrerequisiteWork(
      { county: 'Iredell', state: 'NC', zip: null },
      { countyResearch, countyPulse, zipResearch },
    );
    expect(result.county_market_research.status).toBe('returned');
    expect(result.county_market_pulse.status).toBe('returned');
    expect(result.zip_market_research.status).toBe('waiting_prerequisite');
    expect(zipResearch).not.toHaveBeenCalled();
  });

  it('runs ZIP research independently when county is unknown', async () => {
    const countyResearch = vi.fn(async () => null);
    const countyPulse = vi.fn(async () => null);
    const zipResearch = vi.fn(async () => ({ scope: 'zip' }));
    const result = await runMarketPrerequisiteWork(
      { county: null, state: 'NC', zip: '28625' },
      { countyResearch, countyPulse, zipResearch },
    );
    expect(result.zip_market_research.status).toBe('returned');
    expect(result.county_market_research.status).toBe('waiting_prerequisite');
    expect(countyResearch).not.toHaveBeenCalled();
    expect(countyPulse).not.toHaveBeenCalled();
  });
});
