// Static checks on the Deal Card panel UI. Source-scan style (no jsdom here).
//
// The Deal Card is the primary Acquisitions workspace: a living Property
// Intelligence Report. Its Overview is the main working surface (hero, executive
// summary, key facts, what-the-facts-mean, risks/unknowns, market + strategy +
// seller snapshots, source-labeled facts). Operator-language tabs — Overview,
// Property, Market, Strategy, Seller, Documents, Activity — hold the deeper
// editable detail. These tests keep the report from drifting back into internal
// department/report clutter and lock the safety rails.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card — operator-language tabs (Property Intelligence Report)', () => {
  it('defines the seven operator tabs, not internal department tabs', () => {
    expect(SRC).toMatch(/type DealTab =\s*'overview' \| 'property' \| 'market' \| 'strategy' \| 'seller' \| 'documents' \| 'activity'/);
    for (const label of ['Overview', 'Property', 'Market', 'Strategy', 'Seller', 'Documents', 'Activity']) {
      expect(SRC.includes(`label: '${label}'`), `missing tab ${label}`).toBe(true);
    }
    // Old department-shaped tabs are gone from the tab bar.
    expect(SRC).not.toMatch(/label: 'Browser Intelligence'/);
    expect(SRC).not.toMatch(/label: 'Due Diligence'/);
  });

  it('lands on the Overview (the 30-second report read), not a worksheet', () => {
    expect(SRC).toMatch(/useState<DealTab>\('overview'\)/);
    expect(SRC).toMatch(/setActiveTab\('overview'\)/);
    expect(SRC).toMatch(/activeTab === 'overview'/);
    expect(SRC).toMatch(/<OverviewTab/);
  });
});

describe('Deal Card — Overview is a complete property report', () => {
  it('composes the report hierarchy from existing intelligence', () => {
    for (const c of ['HeroVisual', 'OverviewSummary', 'KeyFactsGrid', 'WhatThisMeans', 'KeyRisksUnknowns', 'MarketSnapshot', 'StrategySnapshot', 'SellerSnapshot']) {
      expect(SRC.includes(`function ${c}`), `missing overview component ${c}`).toBe(true);
    }
  });

  it('opens with a hero visual and quick links out (Maps / Street View / Earth / LandPortal)', () => {
    expect(SRC).toMatch(/function HeroVisual/);
    for (const l of ['Google Maps', 'Street View', 'Google Earth', 'LandPortal']) {
      expect(SRC.includes(l), `missing hero link ${l}`).toBe(true);
    }
    // Clean placeholder, never a broken layout, when no imagery exists.
    expect(SRC).toMatch(/No property image captured yet/);
  });

  it('shows an executive property summary that synthesizes, not just lists', () => {
    expect(SRC).toMatch(/Executive Summary/);
    expect(SRC).toMatch(/es\.headline/);
    expect(SRC).toMatch(/es\.whatItIs/);
    expect(SRC).toMatch(/es\.whyInteresting/);
  });

  it('shows source-labeled key facts and uses Unknown for missing facts', () => {
    expect(SRC).toMatch(/Key facts/);
    expect(SRC).toMatch(/function factOf/);
    expect(SRC).toMatch(/\|\| 'Unknown'/);
    // Facts carry a source label when practical (FEMA / USFWS / USGS + provider).
    expect(SRC).toMatch(/'FEMA'/);
    expect(SRC).toMatch(/'USFWS'/);
    expect(SRC).toMatch(/'USGS'/);
  });

  it('explains what the facts mean together and never decides for the operator', () => {
    expect(SRC).toMatch(/What the facts mean together/);
    expect(SRC).toMatch(/combined development constraint/);
    expect(SRC).toMatch(/LandOS does not decide/);
  });

  it('surfaces key risks AND unknowns to verify before offer', () => {
    expect(SRC).toMatch(/Key risks & unknowns/);
    expect(SRC).toMatch(/verify before offer/i);
  });

  it('shows compact market + strategy + seller snapshots near the top', () => {
    expect(SRC).toMatch(/Market snapshot/);
    expect(SRC).toMatch(/Strategy snapshot/);
    expect(SRC).toMatch(/Seller & discovery/);
    // Neighbor sale is NOT an acquisition strategy.
    expect(SRC).toMatch(/\/neighbor\/i/);
  });

  it('keeps source-labeled facts + the full business spine available (collapsed, not gone)', () => {
    expect(SRC).toMatch(/Source-labeled property facts/);
    expect(SRC).toMatch(/DdFactChecklist/);
    expect(SRC).toMatch(/BusinessSpineSection/);
  });
});

describe('Deal Card — enriched report header', () => {
  it('renders full property identity: seller, address, city, county, state, acreage, APN, deal status', () => {
    expect(SRC).toMatch(/function DealIdentityGrid/);
    expect(SRC).toMatch(/<DealIdentityGrid/);
    for (const f of ['Seller / Lead', 'Address', 'City', 'County', 'State', 'Acreage', 'APN / Parcel ID', 'Deal status']) {
      expect(SRC.includes(`label="${f}"`), `missing header field ${f}`).toBe(true);
    }
  });

  it('keeps a sticky header with the always-visible next action', () => {
    expect(SRC).toMatch(/class="sticky/);
    expect(SRC).toMatch(/Stage: \{deal\.status\}/);
    expect(SRC).toMatch(/Next action:/);
  });
});

describe('Deal Card — deeper detail routed to the right tabs', () => {
  it('routes property intelligence detail (parcel, land score, visuals, browser, DD) to Property', () => {
    expect(SRC).toMatch(/activeTab === 'property'/);
    expect(SRC).toMatch(/PropertyHeaderSection/);
    expect(SRC).toMatch(/AtAGlanceStrip/);
    expect(SRC).toMatch(/BrowserIntelligenceSection/);
    expect(SRC).toMatch(/VisualContextSection/);
    expect(SRC).toMatch(/Detailed Due Diligence/);
  });

  it('routes market pulse + comps to Market and decision content to Strategy', () => {
    expect(SRC).toMatch(/activeTab === 'market'[\s\S]*MarketPulseReadSection/);
    expect(SRC).toMatch(/Comparable sales & active listings \(raw\)/);
    expect(SRC).toMatch(/DiscoveryCallReportSection/);
    expect(SRC).toMatch(/ConfirmBeforeOfferSection/);
  });

  it('routes the seller workspace (acquisitions, contacts, comms) to Seller', () => {
    expect(SRC).toMatch(/activeTab === 'seller' && deal\?\.id && <AcquisitionsPanel/);
    expect(SRC).toMatch(/Contacts/);
    expect(SRC).toMatch(/Communication Summary/);
  });

  it('keeps report generation on Documents and a report/credit timeline on Activity', () => {
    expect(SRC).toMatch(/activeTab === 'documents'/);
    expect(SRC).toMatch(/Run Property Intelligence/);
    expect(SRC).toMatch(/activeTab === 'activity'/);
    expect(SRC).toMatch(/Credit usage/);
  });

  it('drops the empty legacy "Land Data / DD Facts" scaffold (covered by Key facts + DD checklist)', () => {
    expect(SRC).not.toMatch(/Section title="Land Data \/ DD Facts"/);
  });
});

describe('Deal Card — retained sections + quick-action shell', () => {
  const RETAINED = [
    'Visual Context', 'At a Glance', 'Market Pulse', 'Confirm Before Offer', 'Land Score',
    'Deal Economics', 'Contacts', 'Communication Summary', 'Exit Strategy Analysis',
    'Documents & Quick Actions', 'Pre-Call Brief',
  ];
  it('retains every still-useful section', () => {
    for (const s of RETAINED) expect(SRC.includes(s), `missing section ${s}`).toBe(true);
  });

  it('renders the quick-action shell with all six actions, disabled/approval-gated', () => {
    for (const a of ['Make Offer', 'Schedule Follow-Up', 'Run Full Report', 'Change Stage', 'Push to CRM', 'Generate PDF']) {
      expect(SRC.includes(a), `missing quick action ${a}`).toBe(true);
    }
    expect(SRC).toMatch(/disabled/);
    expect(SRC).toMatch(/Approval-gated/);
  });

  it('uses the $10k minimum-net baseline in deal economics', () => {
    expect(SRC).toMatch(/MIN_NET_BASELINE_USD = 10_000/);
    expect(SRC).toMatch(/Target-clear baseline/);
  });

  it('caps visual sizing so satellite/Street View do not take over the screen', () => {
    expect(SRC).toMatch(/h-40 sm:h-44 object-cover/);
  });
});

describe('Deal Card — Market Pulse detail (retained)', () => {
  it('names period, sources, active-retrieval status, and signal effect', () => {
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
});

describe('Deal Card — Browser Intelligence retrieval (retained)', () => {
  it('renders the retrieval block with modes, provenance, and seller-authority', () => {
    expect(SRC).toMatch(/function BrowserIntelligenceSection/);
    expect(SRC).toMatch(/<BrowserIntelligenceSection/);
    expect(SRC).toMatch(/retrieve\('parcel_fact'\)/);
    expect(SRC).toMatch(/retrieve\('deep_record'\)/);
    expect(SRC).toMatch(/browser-intel\/cancel/);
    expect(SRC).toMatch(/deal-cards\/\$\{dealId\}\/browser-intel/);
    expect(SRC).toMatch(/NETR→county/);
    expect(SRC).toMatch(/search fallback/);
    expect(SRC).toMatch(/Owner-of-record vs seller/);
    expect(SRC).toMatch(/Authority to sell/);
    expect(SRC).toMatch(/deal-cards\/\$\{dealId\}\/browser-facts/);
    expect(SRC).toMatch(/loadAutoFacts/);
    expect(SRC).toMatch(/Retrieved automatically/);
  });
});

describe('Deal Card panel — create/edit/save', () => {
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
    expect(SRC).toMatch(/await load\(res\.dealCard\.id\)/);
    expect(SRC).toMatch(/await load\(deal\.id\)/);
  });

  it('keeps the write form deal-level only (no parcel-identity editing)', () => {
    expect(SRC).toMatch(/Deal-level fields only/);
    expect(/setField\(['"](apn|fips|verification|lpPropertyId|lpUrl)/i.test(SRC)).toBe(false);
  });
});

describe('Deal Card panel — list / open flow', () => {
  it('presents the saved-deal list as the "Deal Library", not a "Deal Card"', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\('\/api\/landos\/deal-cards'\)/);
    expect(SRC).toMatch(/async function refreshList\(\)/);
    // The list surface is the Deal Library; a single Deal Card is one property.
    expect(SRC).toMatch(/Section title="Deal Library"/);
    expect(SRC).not.toMatch(/Section title="Saved Deal Cards"/);
    expect(SRC).toMatch(/void load\(c\.id\)/);
  });

  it('offers a back-to-library control and an honest empty state', () => {
    expect(SRC).toMatch(/function backToList\(\)/);
    expect(SRC).toMatch(/← Deal Library/);
    expect(SRC).toMatch(/No Deal Cards yet/);
  });
});

describe('Deal Card — non-regression: APN conflict hard stop', () => {
  it('shows the Resolution view (never a half-populated Deal Card) until the parcel is confirmed', () => {
    expect(SRC).toMatch(/const showResolution =/);
    expect(SRC).toMatch(/!resolution\.confirmed/);
    expect(SRC).toMatch(/<ResolutionView/);
    // The report/overview only render when NOT in resolution.
    expect(SRC).toMatch(/mode === 'view' && deal && !showResolution/);
  });
});

describe('Deal Card panel — safety', () => {
  it('reads from the existing deal-card detail route only', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{id\}`\)/);
  });

  it('does not fabricate CRM/GHL data or perform external CRM mutation', () => {
    expect(SRC).toMatch(/not connected/);
    expect(SRC).toMatch(/No external CRM read or write/);
    expect(/apiPost\([^)]*ghl|crm.*sync|sendMessage/i.test(SRC)).toBe(false);
  });

  it('seller asking price is negotiation context only, never an offer basis', () => {
    expect(SRC).toMatch(/negotiation context only/);
  });

  it('treats visuals as supporting context only, never parcel identity', () => {
    expect(SRC).toMatch(/Supporting context only — never parcel identity/);
  });

  it('uses no coordinate/proximity/map-pin verification language', () => {
    expect(/geocod|proximity|nearest parcel|map pin/i.test(SRC)).toBe(false);
  });
});
