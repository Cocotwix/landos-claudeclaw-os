// Source-scan checks on the Acquire UI: the NORMAL path is one primary
// "Run Property Analysis" action hitting the one-button endpoint; the old
// two-step Verify/Create flow is demoted to a developer fallback. No
// coordinate/geocoder parcel-identity language. (Browser-run component, so we
// source-scan like the other LandOS UI tests.)

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/Acquire.tsx', import.meta.url)), 'utf-8');

describe('Acquire — one-button Property Analysis', () => {
  it('exposes a single primary "Run Property Analysis" action', () => {
    expect(SRC).toMatch(/Run Property Analysis/);
    expect(SRC).toMatch(/runPropertyAnalysis/);
  });

  it('the primary action posts to the one-button orchestration endpoint', () => {
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/landos\/property-analysis'/);
  });

  it('shows real progress stages', () => {
    expect(SRC).toMatch(/Checking parcel identity/);
    expect(SRC).toMatch(/Collecting Redfin sold comps/);
    expect(SRC).toMatch(/Preparing report/);
  });

  it('demotes the old two-step Verify/Create flow to a developer fallback (not the default)', () => {
    expect(SRC).toMatch(/Developer fallback/);
    // The old endpoints still exist ONLY inside the demoted fallback component.
    const fallbackIdx = SRC.indexOf('function DeveloperFallback');
    expect(fallbackIdx).toBeGreaterThan(0);
    expect(SRC.indexOf("'/api/landos/intake/duke-verification'")).toBeGreaterThan(fallbackIdx);
    expect(SRC.indexOf("'/api/landos/deal-cards/from-verification'")).toBeGreaterThan(fallbackIdx);
  });

  it('uses no coordinate/geocoder/proximity parcel-identity language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|centroid/i.test(SRC)).toBe(false);
  });

  it('honestly surfaces the unverified terminal label', () => {
    expect(SRC).toMatch(/Local Area Context, Not Parcel Verified/);
  });
});
