// Static checks on the Property Board comp UI. The web app runs in a browser
// (no jsdom in this node test env), so behavior is covered by the comp contract
// tests; here we statically verify the UI wiring, the required new-tab link
// safety, the full source-label set, and that price-per-acre is never
// fabricated. Mirrors the existing source-scan test style.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/pages/PropertyBoard.tsx', import.meta.url)),
  'utf-8',
);

describe('Property Board manual comp UI', () => {
  it('has a Comps section with an Add Manual Comp action wired to the real API', () => {
    expect(SRC).toMatch(/Add Manual Comp/);
    expect(SRC).toMatch(/\/api\/landos\/property-cards\/\$\{[^}]+\}\/comps/);
    expect(SRC).toMatch(/function saveComp/);
    expect(SRC).toMatch(/function loadComps/);
  });

  it('includes all nine comp source labels', () => {
    for (const label of ['LandPortal', 'Zillow', 'Redfin', 'Land.com', 'LandWatch', 'LandsOfAmerica', 'Realtor', 'County', 'Other']) {
      expect(SRC.includes(`'${label}'`), label).toBe(true);
    }
  });

  it('renders comp source URLs (and the LandPortal URL) in a new tab safely', () => {
    // Every external anchor in the file must carry the safe new-tab attrs.
    const anchors = SRC.match(/<a\b[^>]*href=/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    const targets = SRC.match(/target="_blank"/g) ?? [];
    const rels = SRC.match(/rel="noopener noreferrer"/g) ?? [];
    expect(targets.length).toBeGreaterThanOrEqual(anchors.length);
    expect(rels.length).toBeGreaterThanOrEqual(anchors.length);
    // The comp source link specifically.
    expect(SRC).toMatch(/cp\.source_url[\s\S]{0,200}target="_blank"[\s\S]{0,80}rel="noopener noreferrer"/);
  });

  it('shows price per acre only when present and never fabricates it', () => {
    // Saved comp ppa rendered only when it is a number.
    expect(SRC).toMatch(/typeof cp\.price_per_acre === 'number'/);
    // Form preview returns null unless price and acres parse to positive numbers.
    expect(SRC).toMatch(/parsedPpaPreview/);
    expect(SRC).toMatch(/Number\.isFinite\(price\)[\s\S]{0,120}acres <= 0[\s\S]{0,40}return null/);
  });

  it('never invokes paid LandPortal comp tools from the UI', () => {
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });
});

describe('Deal Card Review Panel', () => {
  it('renders a Deal Review panel fed by the deal-card detail API', () => {
    expect(SRC).toMatch(/Deal Review/);
    expect(SRC).toMatch(/\/api\/landos\/deal-cards\/\$\{[^}]+\}/);
    expect(SRC).toMatch(/dealReview/);
  });

  it('shows property count, distinct properties/APNs, comp count, risks, and next actions', () => {
    expect(SRC).toMatch(/propertyCount/);
    expect(SRC).toMatch(/Properties \/ APNs/);
    expect(SRC).toMatch(/dealReview\.propertyCards\.map/);
    expect(SRC).toMatch(/compCount/);
    expect(SRC).toMatch(/Risks \/ anomaly flags/);
    expect(SRC).toMatch(/dealReview\.nextActions/);
    expect(SRC).toMatch(/latestWriteback/);
  });

  it('shows a verification warning for research/unverified deal cards', () => {
    expect(SRC).toMatch(/hasUnverifiedProperty/);
    expect(SRC).toMatch(/before scoring, valuing, or offer guidance/i);
  });

  it('opens panel LandPortal links in a new tab safely', () => {
    expect(SRC).toMatch(/p\.lp_url[\s\S]{0,120}target="_blank"[\s\S]{0,60}rel="noopener noreferrer"/);
  });
});
