// Source-scan checks on the Acquire UI: the NORMAL path is one primary
// "Run Property Analysis" action hitting the CURRENT production DD endpoint
// (/api/landos/acquire/run -> runDealCardReport) and OPENING the resulting Deal
// Card; the legacy /property-analysis result view is retired. The old two-step
// Verify/Create flow remains as a developer fallback. No coordinate/geocoder
// parcel-identity language. (Browser-run component, so we source-scan.)

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/Acquire.tsx', import.meta.url)), 'utf-8');

describe('Acquire — one-button Property Analysis', () => {
  it('exposes a single primary "Run Property Analysis" action', () => {
    expect(SRC).toMatch(/Run Property Analysis/);
    expect(SRC).toMatch(/runPropertyAnalysis/);
  });

  it('the primary action posts to the CURRENT production DD endpoint (not the legacy one)', () => {
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/landos\/acquire\/run'/);
    // the legacy one-button orchestration endpoint is no longer wired to the button
    expect(SRC).not.toMatch(/'\/api\/landos\/property-analysis'/);
  });

  it('opens the Deal Card on a Matched success (res.matched === true && res.dealCardId), never on dealCardId alone', () => {
    // Property-first: the open is gated by a credible Match, not legal-grade verify.
    expect(SRC).toMatch(/res\.ok\s*&&\s*res\.matched\s*===\s*true\s*&&\s*res\.dealCardId/);
    expect(SRC).toMatch(/onOpenDealCard\(res\.dealCardId\)/);
    // It must NOT open on the mere existence of a dealCardId (the old bug).
    expect(SRC).not.toMatch(/if\s*\(res\.dealCardId\s*&&\s*onOpenDealCard\)/);
  });

  it('uses the Universal Smart Intake input (autocomplete) instead of a bare textarea', () => {
    expect(SRC).toMatch(/import \{ SmartIntake \}/);
    expect(SRC).toMatch(/<SmartIntake/);
  });

  it('on no practical match it shows guidance and opens nothing (never an empty shell)', () => {
    expect(SRC).toMatch(/needsClarification/);
    expect(SRC).toMatch(/Needs clarification/i);
  });

  it('shows real progress stages for the property-first pipeline', () => {
    expect(SRC).toMatch(/Resolving the property/);
    expect(SRC).toMatch(/Collecting Realie sold comps/);
    expect(SRC).toMatch(/Adding Zillow supplemental listings/);
  });

  it('does not render the retired legacy PropertyAnalysisResult view', () => {
    expect(SRC).not.toMatch(/Redfin Sold Comps/);
    expect(SRC).not.toMatch(/Local Area Context, Not Parcel Verified/);
    expect(SRC).not.toMatch(/interface PropertyAnalysisResult/);
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
});
