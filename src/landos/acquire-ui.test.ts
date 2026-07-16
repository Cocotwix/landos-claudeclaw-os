// Source-scan checks on the Acquire (New Lead) UI: the intake is a CONVERSATION
// with LandOS — natural-language turns are preserved verbatim, extraction is
// additive (chips show what was understood), voice dictation inserts into the
// SAME conversational intake, and one primary action runs the production
// pipeline (/api/landos/acquire/run → Property Resolution → DD) and opens the
// Deal Card. No coordinate/geocoder parcel-identity language. (Browser-run
// component, so we source-scan.)

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/Acquire.tsx', import.meta.url)), 'utf-8');
const BROWSER_SRC = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/BrowserIntelControl.tsx', import.meta.url)), 'utf-8');

describe('Acquire — conversational New Lead', () => {
  it('drives a conversation through the intake/conversation endpoint', () => {
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/landos\/intake\/conversation'/);
    expect(SRC).toMatch(/role: 'operator'/);
    expect(SRC).toMatch(/role: 'landos'/);
    expect(SRC).toMatch(/conv\.reply/);
  });

  it('shows what LandOS understood as structured chips (extraction is additive, never a rewrite)', () => {
    expect(SRC).toMatch(/understood/);
    expect(SRC).toMatch(/conv\.understood/);
    expect(SRC).toMatch(/never rewrites/i);
  });

  it('adds browser voice dictation that inserts into the same conversational intake', () => {
    expect(SRC).toMatch(/SpeechRecognition/);
    expect(SRC).toMatch(/webkitSpeechRecognition/);
    expect(SRC).toMatch(/interimResults = true/);
    expect(SRC).toMatch(/Dictate/);
    expect(SRC).toMatch(/Listening/);
    // Honest note when the browser cannot dictate — never silent failure.
    expect(SRC).toMatch(/not supported in this browser/);
  });

  it('exposes a single primary "Run Property Intelligence" action', () => {
    expect(SRC).toMatch(/Run Property Intelligence/);
    expect(SRC).toMatch(/runPropertyAnalysis/);
  });

  it('the primary action posts the FULL raw conversation to the production DD endpoint', () => {
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/landos\/acquire\/run'/);
    expect(SRC).toMatch(/const rawInput = \(combinedText \|\| text\)\.trim\(\)/);
    expect(SRC).toMatch(/text: rawInput, rawInput/);
    expect(SRC).not.toMatch(/selectedSuggestion/);
    expect(SRC).not.toMatch(/'\/api\/landos\/property-analysis'/);
  });

  it('opens the Deal Card on a Matched success (res.matched === true && res.dealCardId), never on dealCardId alone', () => {
    expect(SRC).toMatch(/res\.ok\s*&&\s*res\.matched\s*===\s*true\s*&&\s*res\.dealCardId/);
    expect(SRC).toMatch(/onOpenDealCard\(res\.dealCardId\)/);
    expect(SRC).not.toMatch(/if\s*\(res\.dealCardId\s*&&\s*onOpenDealCard\)/);
  });

  it('uses the Universal Smart Intake input instead of a bare textarea', () => {
    expect(SRC).toMatch(/import \{ SmartIntake \}/);
    expect(SRC).toMatch(/<SmartIntake/);
    expect(SRC).not.toMatch(/onSelectSuggestion=\{/);
  });

  it('on no practical match it shows guidance and opens nothing (never an empty shell)', () => {
    expect(SRC).toMatch(/needsClarification/);
    expect(SRC).toMatch(/Needs clarification/i);
  });

  it('shows real progress stages for the property-first pipeline', () => {
    expect(SRC).toMatch(/Understanding the property you entered/);
    expect(SRC).toMatch(/Checking public parcel records/);
    expect(SRC).toMatch(/Screening public property intelligence/);
  });

  it('the legacy two-step Verify/Create developer fallback is gone (one generation, one flow)', () => {
    expect(SRC).not.toMatch(/DeveloperFallback/);
    expect(SRC).not.toMatch(/'\/api\/landos\/intake\/duke-verification'/);
    expect(SRC).not.toMatch(/'\/api\/landos\/deal-cards\/from-verification'/);
  });

  it('does not render the retired legacy PropertyAnalysisResult view', () => {
    expect(SRC).not.toMatch(/Redfin Sold Comps/);
    expect(SRC).not.toMatch(/Local Area Context, Not Parcel Verified/);
    expect(SRC).not.toMatch(/interface PropertyAnalysisResult/);
  });

  it('uses no coordinate/geocoder/proximity parcel-identity language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|centroid/i.test(SRC)).toBe(false);
  });

  it('does not start or authenticate Land Portal when the page loads', () => {
    expect(SRC).not.toMatch(/BrowserIntelControl/);
    const mount = BROWSER_SRC.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[\]\);/);
    expect(mount?.[1]).toContain('void refresh()');
    expect(mount?.[1]).not.toContain('ensure');
  });
});
