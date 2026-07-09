// Static checks on the redesigned Property Board. The web app runs in a browser
// (no jsdom in this node test env), so behavior is covered by the board/deal-card
// contract tests; here we statically verify the UI wiring. The redesign made the
// Property Board a PIPELINE OVERVIEW ONLY: every card is a concise summary of a
// Deal Card, and a click opens the canonical Deal Card. It must NOT be a second
// property intelligence surface (no comps form, no Deal Review panel, no Duke
// Report control, no discovery/market/strategy rendering).

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
    expect(SRC).toMatch(/setBoard\(\{\s*columns:\s*\{\}\s*,\s*statuses:\s*\[\]\s*\}\)/);
  });
});

describe('Property Board opens the canonical Deal Card (single workspace)', () => {
  it('navigates a card click to the Deal Card, never a board-local modal', () => {
    // A click routes to /landos?deal=<id> — the one operator workspace.
    expect(SRC).toMatch(/\/landos\?deal=\$\{[^}]+\}/);
    expect(SRC).toMatch(/function openDealCard/);
  });

  it('resolves/creates a Deal Card when the property has none linked yet', () => {
    // Ensures the board never dead-ends and never renders intelligence itself.
    expect(SRC).toMatch(/\/api\/landos\/property-cards\/\$\{[^}]+\}\/deal-card/);
    expect(SRC).toMatch(/deal_card_id/);
  });

  it('is a pure pipeline surface — no competing property intelligence', () => {
    // None of the Deal Card / department intelligence surfaces may be rebuilt here.
    expect(/OperatorInspectionBrief/.test(SRC)).toBe(false);
    expect(/Deal Review/.test(SRC)).toBe(false);
    expect(/Add Manual Comp/.test(SRC)).toBe(false);
    expect(/Run Duke Report/.test(SRC)).toBe(false);
    expect(/Comparable Intelligence/.test(SRC)).toBe(false);
    expect(/Market Pulse/.test(SRC)).toBe(false);
    expect(/Acquisition Strateg/.test(SRC)).toBe(false);
    expect(/Discovery Snapshot/.test(SRC)).toBe(false);
    expect(/discoveryReport/.test(SRC)).toBe(false);
    expect(/factSheet/.test(SRC)).toBe(false);
    // No valuation/offer-range surface is assembled on the board.
    expect(/Estimated Market Value|Recommended Offer Range|Land Score/.test(SRC)).toBe(false);
    // No comp report tools from the board (no hidden spend).
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });
});

describe('Property Board concise card content', () => {
  it('summarises seller/owner, place, acreage, and the next action', () => {
    expect(SRC).toMatch(/card\.owner/);
    expect(SRC).toMatch(/card\.acres/);
    expect(SRC).toMatch(/card\.city/);
    expect(SRC).toMatch(/next_action/);
  });

  it('shows a verification badge and never implies value/offer is approved', () => {
    expect(SRC).toMatch(/verification_status === 'verified_property'/);
    // No offer/scoring guidance language on the board (the "Valuation / Comps"
    // owner lane is pipeline routing metadata, not intelligence).
    expect(/offer guidance|before scoring|scoring, valuing/i.test(SRC)).toBe(false);
  });

  it('shows a blocker indicator derived only from existing open_risks data', () => {
    expect(SRC).toMatch(/function parseRisks/);
    expect(SRC).toMatch(/parseRisks\(card\.open_risks\)/);
    expect(SRC).toMatch(/blocker/);
  });

  it('uses no coordinate/proximity/map-pin verification language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|coordinate/i.test(SRC)).toBe(false);
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

  it('allows an inline pipeline stage move without a modal', () => {
    expect(SRC).toMatch(/function moveCard/);
    expect(SRC).toMatch(/kanbanStatus:\s*status/);
    expect(SRC).toMatch(/Move stage/);
  });
});
