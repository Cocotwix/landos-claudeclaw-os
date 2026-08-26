import { afterEach, describe, expect, it } from 'vitest';
import { getGevProviderStates } from './providers.js';

// The provider matrix is the honest statement of GEV source state. These tests
// pin the doctrine: paid non-Google providers can never present as active,
// free-key providers activate only on their named free credential, and no
// credential VALUE ever appears in the matrix.

const TOUCHED_ENVS = ['FIRMS_MAP_KEY', 'AISSTREAM_API_KEY', 'TOMTOM_API_KEY'] as const;
const saved: Partial<Record<(typeof TOUCHED_ENVS)[number], string | undefined>> = {};
for (const name of TOUCHED_ENVS) saved[name] = process.env[name];

afterEach(() => {
  for (const name of TOUCHED_ENVS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('GEV provider matrix', () => {
  it('keeps TomTom paid-disabled even when a key exists in the environment', () => {
    process.env.TOMTOM_API_KEY = 'synthetic-test-value';
    const tomtom = getGevProviderStates().find((provider) => provider.id === 'tomtom')!;
    expect(tomtom.status).toBe('paid-disabled');
    expect(tomtom.costModel).toBe('paid');
  });

  it('labels free-key providers credential-required without their key and active with it', () => {
    delete process.env.FIRMS_MAP_KEY;
    expect(getGevProviderStates().find((provider) => provider.id === 'firms')!.status).toBe('credential-required');
    process.env.FIRMS_MAP_KEY = 'synthetic-test-value';
    expect(getGevProviderStates().find((provider) => provider.id === 'firms')!.status).toBe('active');
  });

  it('never leaks a credential value into the matrix', () => {
    process.env.FIRMS_MAP_KEY = 'synthetic-secret-value-9x7';
    process.env.AISSTREAM_API_KEY = 'another-synthetic-secret';
    const serialized = JSON.stringify(getGevProviderStates());
    expect(serialized).not.toContain('synthetic-secret-value-9x7');
    expect(serialized).not.toContain('another-synthetic-secret');
  });

  it('keeps every keyless source active and the removed set removed', () => {
    const states = getGevProviderStates();
    const byId = new Map(states.map((provider) => [provider.id, provider]));
    for (const id of ['osm', 'reearth-terrain', 'earthquakes', 'weather', 'satellites', 'launches', 'opensky', 'adsblol-mil', 'traffic-sim', 'routing', 'bikeshare', 'cctv', 'regional-brief', 'radio', 'military-installations', 'local-datasets']) {
      expect(byId.get(id)?.status, id).toBe('active');
    }
    for (const id of ['submarine-cables', 'voice', 'google-places']) {
      expect(byId.get(id)?.status, id).toBe('removed');
    }
  });
});
