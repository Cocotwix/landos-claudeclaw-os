// Static checks on the Property Board comp UI. The web app runs in a browser
// (no jsdom in this node test env), so behavior is covered by the comp contract
// tests; here we statically verify the UI wiring, the required new-tab link
// safety, the full source-label set, and that price-per-acre is never
// fabricated. Mirrors the existing source-scan test style.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { KANBAN_STATUSES } from './db.js';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/pages/PropertyBoard.tsx', import.meta.url)),
  'utf-8',
);

describe('Property Board board endpoint wiring', () => {
  it('fetches the board from the real backend route with the entity filter', () => {
    expect(SRC).toMatch(/\/api\/landos\/board\?entity=\$\{encodeURIComponent\(entity\)\}/);
  });

  it('degrades to a clean empty board (no red error) if the board endpoint fails', () => {
    // On load failure the page sets an empty valid board instead of an error.
    expect(SRC).toMatch(/setBoard\(\{\s*columns:\s*\{\}\s*,\s*statuses:\s*\[\]\s*\}\)/);
  });
});

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

describe('Property Board routing display metadata', () => {
  it('renders the stage owner from the routing-map mirror', () => {
    expect(SRC).toMatch(/STAGE_OWNER/);
    expect(SRC).toMatch(/owner:\s*\{STAGE_OWNER\[status\]/);
  });

  it('keeps the STAGE_OWNER mirror in sync with every kanban_status', () => {
    for (const s of KANBAN_STATUSES) {
      expect(SRC.includes(`${s}:`), `STAGE_OWNER missing key ${s}`).toBe(true);
    }
  });

  it('keeps verification badge and never implies value/offer is approved', () => {
    expect(SRC).toMatch(/verification_status === 'verified_property'/);
    // The unverified guardrail warning text stays present.
    expect(SRC).toMatch(/before scoring, valuing, or offer guidance/i);
  });

  it('shows a blocker indicator derived only from existing open_risks data', () => {
    expect(SRC).toMatch(/function parseRisks/);
    expect(SRC).toMatch(/open_risks/);
    expect(SRC).toMatch(/blocker/);
    // Blocker display reads card data only -- no new fetch/endpoint.
    expect(SRC).toMatch(/parseRisks\(card\.open_risks\)/);
  });

  it('uses no coordinate/proximity/map-pin verification language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|coordinate/i.test(SRC)).toBe(false);
  });
});

describe('Property Board Duke Report product model (not Partial vs Full)', () => {
  it('exposes a single Run Duke Report action — no Partial-vs-Full main split, no Full Report button', () => {
    expect(SRC).toMatch(/Run Duke Report/);
    expect(/Run Duke Partial/.test(SRC)).toBe(false);
    expect(/Run Full Report/i.test(SRC)).toBe(false);
  });

  it('offers a comp-source choice: Redfin/Zillow (default) and LandPortal Comps (1 credit)', () => {
    expect(SRC).toMatch(/Redfin\/Zillow/);
    expect(SRC).toMatch(/LandPortal Comps \(1 credit\)/);
    // Default selection is the no-credit path.
    expect(SRC).toMatch(/useState<[^>]*>\('redfin_zillow'\)/);
  });

  it('queues the run via the existing mission endpoint assigned to Duke (no new queue)', () => {
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/mission\/tasks'/);
    expect(SRC).toMatch(/assigned_agent:\s*'duke-due-diligence'/);
  });

  it('Redfin/Zillow prompt uses no LandPortal comp credit', () => {
    expect(SRC).toMatch(/Redfin\/Zillow \(no LandPortal comp credit\)/);
  });

  it('LandPortal Comps prompt carries explicit one-credit approval + Redfin/Zillow fallback', () => {
    expect(SRC).toMatch(/approve spending ONE LandPortal comp credit for THIS run only/);
    expect(SRC).toMatch(/fall back to Redfin\/Zillow\/manual comps/);
  });

  it('every run verifies identity first and only allows labeled Local Area Context when unverified', () => {
    expect(SRC).toMatch(/Verify parcel identity first/);
    expect(SRC).toMatch(/Local Area Context, Not Parcel Verified/);
  });

  it('shows comp source/status and credit-used / fallback from the contract (no fabricated value)', () => {
    expect(SRC).toMatch(/dukePartial\?\.compMode === 'landportal_credit'/);
    expect(SRC).toMatch(/dukePartial\?\.compCreditUsed \? 'comp credit used' : 'no comp credit used'/);
    expect(SRC).toMatch(/compFallbackUsed/);
  });

  it('renders evaluation engine, strategy matrix, and offer readiness sections', () => {
    expect(SRC).toMatch(/Evaluation engine/);
    expect(SRC).toMatch(/Strategy matrix/);
    expect(SRC).toMatch(/Offer readiness/);
  });

  it('never shows offer guidance unless the contract allows it', () => {
    expect(SRC).toMatch(/dukePartial\.offerGuidance\?\.allowed/);
  });

  it('shows a Blocked before valuation / offer gate when unverified', () => {
    expect(SRC).toMatch(/Blocked before valuation \/ offer/);
    expect(SRC).toMatch(/before scoring, valuing, or offer guidance/i);
  });

  it('renders discovery questions and the comp-source note', () => {
    expect(SRC).toMatch(/discoveryQuestions/);
    expect(SRC).toMatch(/Discovery questions/);
    expect(SRC).toMatch(/compSourceNote/);
  });

  it('does not call any LandPortal comp report tool from the UI (no hidden spend)', () => {
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });
});
