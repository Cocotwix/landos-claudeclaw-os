import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPropertyAnalysis } from './property-analysis.js';
import { toMarkdown, savePropertyAnalysisReport } from './property-analysis-report.js';
import type { LpResolveResult } from './landportal-client.js';

const NOW = '2026-06-21T00:00:00.000Z';

function ambiguousResolve(): LpResolveResult {
  return {
    verified: false, status: 'ambiguous_fips', propertyid: null, fips: null, apn: null,
    situs_address: null, owner: null, match_notes: 'needs county/FIPS', candidates: [],
  };
}

async function sampleResult() {
  return runPropertyAnalysis('472 West Rd, Poulan, GA 31781', {}, {
    nowIso: NOW,
    apiVersion: () => 'v2',
    resolve: async () => ambiguousResolve(),
    compsReadiness: async () => ({ capability: 'comps', ready: false, missing: [], reason: 'not ready', usesStub: true }),
    logCost: () => {},
  });
}

const REQUIRED_SECTIONS = [
  'Parcel Verification',
  'Property / DD Facts',
  'Data Gaps and Risk Flags',
  'Local Market Pulse',
  'Redfin Sold Comps',
  'Comp Inclusion / Exclusion Notes',
  'Strategy Matrix',
  'Underwriting / Offer Readiness',
  'Most Viable Strategy',
  'Discovery Questions',
  'Source Table',
  'Provider Calls',
  'Actual Spend',
];

describe('toMarkdown', () => {
  it('includes every required report section + top badges + timestamp', async () => {
    const md = toMarkdown(await sampleResult());
    for (const s of REQUIRED_SECTIONS) expect(md, `missing section: ${s}`).toContain(s);
    expect(md).toMatch(/Not Verified/);
    expect(md).toMatch(/Report timestamp: 2026-06-21/);
  });

  it('contains no secret/token-like values', async () => {
    const md = toMarkdown(await sampleResult());
    expect(md).not.toMatch(/Bearer\s|APIFY_TOKEN|LP_JWT_TOKEN|DASHBOARD_TOKEN/i);
    // visual section must not leak a keyed static-image URL
    expect(md).not.toMatch(/staticmap\?|streetview\?|[?&]key=/i);
  });

  it('renders explicit canonical Zoning in the DD section when present (e.g. Realie zoningCode)', async () => {
    const r = (await sampleResult()) as any;
    r.ddFacts = { landFacts: { zoning: 'A-1' }, identity: {}, valuation: {}, similars: {}, similarSales: [] };
    r.parcelVerification.verificationSource = 'Realie.ai';
    const md = toMarkdown(r);
    expect(md).toContain('Zoning:');
    expect(md).toContain('A-1');
    expect(md).toContain('Realie.ai');
  });

  it('renders Zoning as Unknown / Needs Verification when no zoning is provided (never fabricated)', async () => {
    const r = (await sampleResult()) as any;
    r.ddFacts = { landFacts: {}, identity: {}, valuation: {}, similars: {}, similarSales: [] };
    const md = toMarkdown(r);
    expect(md).toMatch(/Zoning:.*(Unknown|Needs Verification)/);
  });

  it('includes a Visual Property Context section listing visual services (Not Verified) without a Google call', async () => {
    const md = toMarkdown(await sampleResult());
    expect(md).toContain('## Visual Property Context');
    expect(md).toContain('Visual Signal, Not Verified Fact');
    expect(md).toContain('Maps Static API');        // services rendered
    expect(md).toContain('Street View Static API');
    // unverified sample has no address -> assets render as unavailable (never invented)
    expect(md).toMatch(/image placeholder|unavailable \(no address/);
  });
});

describe('savePropertyAnalysisReport', () => {
  it('writes a local Markdown file and either a real PDF or an honest install blocker (never a stub)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-report-'));
    const out = await savePropertyAnalysisReport(await sampleResult(), { baseDir: dir });
    expect(fs.existsSync(out.markdownPath)).toBe(true);
    expect(fs.readFileSync(out.markdownPath, 'utf-8')).toContain('Parcel Verification');
    if (out.pdfPath) {
      // pdfkit installed -> a real PDF file exists and is non-empty.
      expect(fs.existsSync(out.pdfPath)).toBe(true);
      expect(fs.statSync(out.pdfPath).size).toBeGreaterThan(0);
    } else {
      // pdfkit not installed -> honest, actionable reason (no fake file written).
      expect(out.pdfReason).toMatch(/pdfkit|install/i);
    }
  });
});
