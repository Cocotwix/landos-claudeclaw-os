// Static checks on the Deal Card panel UI. Source-scan style (no jsdom here).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card panel — required sections', () => {
  // Brief sections shown by default + legacy sections retained (collapsed).
  const SECTIONS = [
    'Visual Context',
    'At a Glance',
    'Market Pulse',
    'Confirm Before Offer',
    'Land Score',
    'Deal Economics',
    'Land Data / DD Facts',
    'Contacts',
    'Communication Summary',
    'Exit Strategy Analysis',
    'Documents / Activity / Quick Actions',
    'Pre-Call Brief',
  ];
  it('renders every required panel section', () => {
    for (const s of SECTIONS) expect(SRC.includes(s), `missing section ${s}`).toBe(true);
  });

  it('renders a SLIM sticky header (parcel facts live once, in the property header)', () => {
    expect(SRC).toMatch(/class="sticky/);
    expect(SRC).toMatch(/entityBadge/);
    expect(SRC).toMatch(/Stage: \{deal\.status\}/);
    // The sticky bar no longer repeats County/State + APN + Verification — those
    // belong to PropertyHeaderSection so each fact appears exactly once.
    expect(SRC).not.toMatch(/County\/State: \{/);
    expect(SRC).toMatch(/PropertyHeaderSection/);
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

  it('treats visuals as supporting context only and removes the duplicate Imagery panel + contradiction', () => {
    expect(SRC).toMatch(/Visual Context/);
    expect(SRC).toMatch(/Supporting context only — never parcel identity/);
    // The standalone always-on "Imagery" panel — which showed "visual not captured
    // yet" even when Visual Context already had visuals — is removed.
    expect(SRC).not.toMatch(/Capture supporting imagery/);
    expect(SRC).not.toMatch(/Supporting context — not identity verification/);
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

describe('Deal Card panel — concise DD operator brief', () => {
  it('collapses legacy worksheets / seller / contacts / comms / documents / call prep by default', () => {
    expect(SRC).toMatch(/function Collapsible/);
    expect(SRC).toMatch(/Worksheets, seller \/ acquisitions, contacts, documents/);
    // The raw comp table + provider chain are collapsed out of the default brief.
    expect(SRC).toMatch(/Comparable sales & active listings \(raw\)/);
  });

  it('surfaces Confirm Before Offer exactly once, not scattered across panels', () => {
    expect(SRC).toMatch(/ConfirmBeforeOfferSection/);
    expect(SRC).toMatch(/Confirm Before Offer/);
  });

  it('keeps seller-call questions OUT of the default DD brief (Acquisitions owns them)', () => {
    // The Executive Summary no longer renders an "Ask the seller" column in the brief.
    expect(SRC).not.toMatch(/Ask the seller/);
  });

  it('Market Pulse names period, sources, active-retrieval status, and signal effect', () => {
    expect(SRC).toMatch(/Sold period/);
    expect(SRC).toMatch(/Sold source/);
    expect(SRC).toMatch(/Active source/);
    expect(SRC).toMatch(/Active retrieval/);
    expect(SRC).toMatch(/Effect on land demand/);
    expect(SRC).toMatch(/Local developments · rezonings/);
  });

  it('fixes the active-listing contradiction (incomplete vs honest zero)', () => {
    expect(SRC).toMatch(/function activeRetrievalState/);
    expect(SRC).toMatch(/Active listing retrieval incomplete/);
    expect(SRC).toMatch(/No active land listings found \(retrieval ran\)/);
  });

  it('caps visual sizing so satellite/Street View do not take over the screen', () => {
    expect(SRC).toMatch(/h-40 sm:h-44 object-cover/);
  });

  it('Market Pulse prioritizes $/ac by acreage band + county $/ac + active asking over absorption', () => {
    expect(SRC).toMatch(/Land \$\/ac by acreage band/);
    expect(SRC).toMatch(/function ppaByAcreageBand/);
    expect(SRC).toMatch(/County median \$\/ac/);
    expect(SRC).toMatch(/Active asking \(land\)/);
    expect(SRC).toMatch(/Local developments · rezonings/);
    // Absorption is demoted to a secondary line, not a primary metric grid.
    expect(SRC).toMatch(/Absorption \(secondary\)/);
  });

  it('renders the Browser Intelligence retrieval block with modes, provenance, and seller-authority', () => {
    expect(SRC).toMatch(/function BrowserIntelligenceSection/);
    expect(SRC).toMatch(/<BrowserIntelligenceSection/);
    // Two search modes + operator stop.
    expect(SRC).toMatch(/retrieve\('parcel_fact'\)/);
    expect(SRC).toMatch(/retrieve\('deep_record'\)/);
    expect(SRC).toMatch(/browser-intel\/cancel/);
    expect(SRC).toMatch(/deal-cards\/\$\{dealId\}\/browser-intel/);
    // Provenance: LandPortal vs NETR→county vs search fallback.
    expect(SRC).toMatch(/NETR→county/);
    expect(SRC).toMatch(/search fallback/);
    // Inherited/representative seller: owner-of-record vs seller + authority status.
    expect(SRC).toMatch(/Owner-of-record vs seller/);
    expect(SRC).toMatch(/Authority to sell/);
  });
});

describe('Deal Card panel — create/edit/save (Checkpoint 3)', () => {
  it('renders New / Edit / Save / Cancel controls', () => {
    expect(SRC).toMatch(/New Deal Card/);
    expect(SRC).toMatch(/Edit/);
    expect(SRC).toMatch(/saving \? 'Saving…' : 'Save'/);
    expect(SRC).toMatch(/Cancel/);
  });

  it('creates via POST and updates via PATCH on the deal-cards routes', () => {
    expect(SRC).toMatch(/apiPost<[^>]*>\('\/api\/landos\/deal-cards'/);
    expect(SRC).toMatch(/apiPatch<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{deal\.id\}`/);
  });

  it('re-loads the saved card by id after any write (persistence + no duplicate)', () => {
    // Both create and edit paths call load(...) after the write.
    expect(SRC).toMatch(/await load\(res\.dealCard\.id\)/);
    expect(SRC).toMatch(/await load\(deal\.id\)/);
  });

  it('offers a stage picker and an entity choice for create', () => {
    expect(SRC).toMatch(/DEAL_STAGES/);
    expect(SRC).toMatch(/LAND_ALLY/);
    expect(SRC).toMatch(/TY_LAND_BIZ/);
    // Entity is immutable once a card exists.
    expect(SRC).toMatch(/disabled=\{mode === 'edit'\}/);
  });

  it('keeps the write form deal-level only (no parcel-identity editing)', () => {
    expect(SRC).toMatch(/Deal-level fields only/);
    // The form must not edit APN / verification / FIPS / LandPortal id.
    expect(/setField\(['"](apn|fips|verification|lpPropertyId|lpUrl)/i.test(SRC)).toBe(false);
  });
});

describe('Deal Card panel — list / open flow (Final Foundation)', () => {
  it('fetches the saved-cards list from the list route on mount', () => {
    // List route is the bare collection path (no :id), via a refreshList helper.
    expect(SRC).toMatch(/apiGet<[^>]*>\('\/api\/landos\/deal-cards'\)/);
    expect(SRC).toMatch(/async function refreshList\(\)/);
    expect(SRC).toMatch(/else void refreshList\(\)/);
  });

  it('renders a Saved Deal Cards list and opens a row via load(id)', () => {
    expect(SRC).toMatch(/Saved Deal Cards/);
    expect(SRC).toMatch(/cards\.map/);
    expect(SRC).toMatch(/void load\(c\.id\)/);
  });

  it('highlights the currently selected card in the list', () => {
    expect(SRC).toMatch(/deal\?\.id === c\.id/);
  });

  it('shows an honest empty state when there are no saved cards', () => {
    expect(SRC).toMatch(/No Deal Cards yet/);
    // Empty state distinguishes "none exist" from a fabricated/zero row.
    expect(SRC).toMatch(/cards\.length === 0/);
  });

  it('refreshes the list after create and after edit (saved card is openable)', () => {
    // Two refreshList() calls in save(): one on the create path, one on edit.
    expect((SRC.match(/await refreshList\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('offers a back-to-list control to deselect the open card', () => {
    expect(SRC).toMatch(/function backToList\(\)/);
    expect(SRC).toMatch(/← Deal Cards/);
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
