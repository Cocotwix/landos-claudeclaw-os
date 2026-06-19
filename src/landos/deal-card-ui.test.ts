// Static checks on the Deal Card panel UI. Source-scan style (no jsdom here).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card panel — required sections', () => {
  const SECTIONS = [
    'Imagery',
    'Deal Economics',
    'Land Data / DD Facts',
    'Owner / Seller',
    'Communication Summary',
    'Exit Strategy Analysis',
    'Documents / Activity / Quick Actions',
    'Pre-Call Brief',
  ];
  it('renders every required panel section', () => {
    for (const s of SECTIONS) expect(SRC.includes(s), `missing section ${s}`).toBe(true);
  });

  it('renders a sticky/header area with entity badge, county/state, APN, stage', () => {
    expect(SRC).toMatch(/class="sticky/);
    expect(SRC).toMatch(/entityBadge/);
    expect(SRC).toMatch(/County\/State/);
    expect(SRC).toMatch(/APN:/);
    expect(SRC).toMatch(/Stage:/);
  });

  it('maps entity to Land Ally / My Business / Unknown without breaking validation', () => {
    expect(SRC).toMatch(/LAND_ALLY.*Land Ally/s);
    expect(SRC).toMatch(/TY_LAND_BIZ.*My Business/s);
    expect(SRC).toMatch(/return 'Unknown'/);
  });

  it('uses the $10k minimum-net baseline in deal economics', () => {
    expect(SRC).toMatch(/MIN_NET_BASELINE_USD = 10_000/);
    expect(SRC).toMatch(/Target-clear baseline/);
  });

  it('treats imagery as supporting context only, never parcel identity', () => {
    expect(SRC).toMatch(/never verifies parcel identity/);
    expect(SRC).toMatch(/Visual\/source image not captured yet/);
  });

  it('renders the quick-action shell with all six actions, disabled/approval-gated', () => {
    for (const a of ['Make Offer', 'Schedule Follow-Up', 'Run Full Report', 'Change Stage', 'Push to CRM', 'Generate PDF']) {
      expect(SRC.includes(a), `missing quick action ${a}`).toBe(true);
    }
    expect(SRC).toMatch(/disabled/);
    expect(SRC).toMatch(/Approval-gated/);
  });

  it('renders the Pre-Call Brief fields', () => {
    for (const f of [
      'What the seller wants', 'Current max / walk-away', 'Last thing the seller said',
      'Critical data gaps', 'Questions to ask next', 'What not to mention yet',
    ]) {
      expect(SRC.includes(f), `missing pre-call field ${f}`).toBe(true);
    }
  });
});

describe('Deal Card panel — safety', () => {
  it('reads from the existing deal-card detail route only', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{id\}`\)/);
  });

  it('does not fabricate CRM/GHL data or perform external CRM mutation', () => {
    expect(SRC).toMatch(/not connected/);
    expect(SRC).toMatch(/No external CRM read or write/);
    // No write/sync calls to CRM/GHL from the panel.
    expect(/apiPost\([^)]*ghl|crm.*sync|sendMessage/i.test(SRC)).toBe(false);
  });

  it('seller asking price is negotiation context only, never an offer basis', () => {
    expect(SRC).toMatch(/negotiation context only/);
  });

  it('uses no coordinate/proximity/map-pin verification language', () => {
    expect(/geocod|proximity|nearest parcel|map pin/i.test(SRC)).toBe(false);
  });
});
