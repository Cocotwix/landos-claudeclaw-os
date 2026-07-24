// Static checks on the Deal Card panel UI. Source-scan style (no jsdom here).
//
// The Deal Card is one coherent executive briefing: the Overview reads like an
// investment memo (executive summary first), Property is the canonical parcel
// facts page, Market answers "should I want land here?", Strategy answers
// "should I pursue this opportunity?", and Seller holds the call workspace.
// These tests keep the card from drifting back into internal department/report
// clutter, lock the safety rails, and keep legacy scaffolding out.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/DealCard.tsx', import.meta.url)),
  'utf-8',
);

describe('Deal Card — operator-language tabs (Property Intelligence Report)', () => {
  it('keeps Smart Intake visibly reachable from the pinned Deal Card controls', () => {
    expect(SRC).toMatch(/data-testid="open-smart-intake"/);
    expect(SRC).toMatch(/\+ Smart Intake/);
    expect(SRC).toMatch(/deal-card-smart-intake/);
  });

  it('shows and polls durable new-lead research until the Deal Card refreshes with returned evidence', () => {
    expect(SRC).toMatch(/data-testid="deal-card-research-progress"/);
    expect(SRC).toMatch(/Automatic property research is running/);
    expect(SRC).toMatch(/research-mission/);
    expect(SRC).toMatch(/setInterval[\s\S]{0,180}3_000/);
    expect(SRC).toMatch(/load\(deal\.id, false\)/);
    expect(SRC).toMatch(/data-testid="deal-card-research-retry"/);
  });

  it('keeps lower Deal Card controls scrollable above the persistent Max panel', () => {
    expect(SRC).toMatch(/data-testid="deal-card-root"[^>]*pb-40/);
  });

  it('puts usable Google satellite and Street View capture on the Visuals tab', () => {
    expect(SRC).toMatch(/data-testid="capture-google-visuals"/);
    expect(SRC).toMatch(/Capture \/ refresh Street View/);
    expect(SRC).toMatch(/activeTab === 'visuals'[\s\S]{0,2200}<VisualContextSection/);
    expect(SRC).toMatch(/nearest road imagery/);
    expect(SRC).not.toMatch(/false && activeTab === 'property'/);
  });

  it('defines the ten operator tabs, including persistent resources outside Overview', () => {
    expect(SRC).toMatch(/type DealTab =\s*'overview' \| 'property' \| 'diligence' \| 'market' \| 'strategy' \| 'visuals' \| 'seller' \| 'resources' \| 'documents' \| 'activity'/);
    for (const label of ['Overview', 'Property', 'Due Diligence', 'Market', 'Strategy', 'Visuals', 'Seller', 'Resources', 'Documents', 'Activity']) {
      expect(SRC.includes(`label: '${label}'`), `missing tab ${label}`).toBe(true);
    }
    expect(SRC).not.toMatch(/label: 'Browser Intelligence'/);
  });

  it('lands on the Overview (the memo read), not a worksheet', () => {
    expect(SRC).toMatch(/useState<DealTab>\('overview'\)/);
    expect(SRC).toMatch(/setActiveTab\('overview'\)/);
    expect(SRC).toMatch(/activeTab === 'overview'/);
    expect(SRC).toMatch(/<OverviewTab/);
  });
});

describe('Deal Card — Overview is an executive investment memo', () => {
  it('composes the memo from existing intelligence', () => {
    for (const c of ['HeroVisual', 'OverviewSummary', 'KeyFactsGrid', 'WhatThisMeans', 'KeyRisksUnknowns', 'StrategySnapshot', 'SellerSnapshot', 'NextActionsPanel', 'BestCompsPanel']) {
      expect(SRC.includes(`function ${c}`), `missing overview component ${c}`).toBe(true);
    }
  });

  it('reads executive-summary-first — the first thing before calling the seller', () => {
    const overview = SRC.slice(SRC.indexOf('function OverviewTab'), SRC.indexOf('export function DealCard'));
    const summaryAt = overview.indexOf('<OverviewSummary');
    const heroAt = overview.indexOf('<HeroVisual');
    const factsAt = overview.indexOf('<KeyFactsGrid');
    expect(summaryAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(heroAt);
    expect(heroAt).toBeLessThan(factsAt);
  });

  it('shows only the best five comps on the memo (BestCompsPanel), never twenty', () => {
    const overview = SRC.slice(SRC.indexOf('function OverviewTab'), SRC.indexOf('export function DealCard'));
    expect(overview).toMatch(/<BestCompsPanel/);
    expect(overview).not.toMatch(/<MarketCompsSection/);
  });

  it('answers probable worth with the ONE reconciled valuation', () => {
    const overview = SRC.slice(SRC.indexOf('function OverviewTab'), SRC.indexOf('export function DealCard'));
    expect(overview).toMatch(/<ValuationPanel/);
  });

  it('closes with next operator actions', () => {
    expect(SRC).toMatch(/Next operator actions/);
    const overview = SRC.slice(SRC.indexOf('function OverviewTab'), SRC.indexOf('export function DealCard'));
    expect(overview).toMatch(/<NextActionsPanel/);
  });

  it('removed widget clutter from the memo (no compact visual panel, no market snapshot widget, no collapsed spine)', () => {
    const overview = SRC.slice(SRC.indexOf('function OverviewTab'), SRC.indexOf('export function DealCard'));
    expect(overview).not.toMatch(/<VisualIntelligencePanel/);
    expect(overview).not.toMatch(/MarketSnapshot/);
    expect(overview).not.toMatch(/BusinessSpineSection/);
  });

  it('opens with a hero visual and quick links out (Maps / Street View / Earth / LandPortal)', () => {
    expect(SRC).toMatch(/function HeroVisual/);
    for (const l of ['Google Maps', 'Street View', 'Google Earth', 'LandPortal']) {
      expect(SRC.includes(l), `missing hero link ${l}`).toBe(true);
    }
    // Honest placeholder, never a broken layout or a misleading generic image.
    expect(SRC).toMatch(/No boundary-verified parcel image is attached here yet/);
    // Hero priority: APN-specific LandPortal parcel imagery outranks Google.
    expect(SRC).toMatch(/lpHero \? \{ url: lpHero\.url/);
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
});

describe('Deal Card — Property is the canonical parcel facts page', () => {
  it('keeps Visuals interpretation compact and never repeats provider diagnostics or captured galleries', () => {
    const start = SRC.indexOf('function VisualIntelligencePanel');
    const end = SRC.indexOf('function ActivityTimeline', start);
    const panel = SRC.slice(start, end);
    expect(panel).toMatch(/Visual observations/);
    expect(panel).toMatch(/Refresh observations/);
    expect(panel).toMatch(/does not prove frontage, access, utilities, or buildability/);
    expect(panel).not.toMatch(/Source status|Captured visuals|implementation gap|Google Earth 3D \/ tilted terrain/);
  });

  it('routes parcel identity, reconciled facts, land score, visuals, browser intel, and official records to Property', () => {
    expect(SRC).toMatch(/activeTab === 'property'/);
    expect(SRC).toMatch(/PropertyHeaderSection/);
    expect(SRC).toMatch(/ReconciledFactsPanel/);
    expect(SRC).toMatch(/AtAGlanceStrip/);
    expect(SRC).toMatch(/BrowserIntelligenceSection/);
    expect(SRC).toMatch(/VisualContextSection/);
    expect(SRC).toMatch(/LandPortalImageryPanel/);
    expect(SRC).toMatch(/PublicRecordsResearchSection/);
    expect(SRC).toMatch(/Detailed Due Diligence/);
  });

  it('separates multi-parcel leads into Parcel A / Parcel B with honest per-parcel states', () => {
    expect(SRC).toMatch(/function ParcelRosterBlock/);
    expect(SRC).toMatch(/parcelRoster/);
    // Per-parcel imagery is scoped to that parcel's own card id, and only when
    // the parcel is resolved WITH verified imagery.
    expect(SRC).toMatch(/entry\.status === 'resolved_verified_imagery' && \(\s*<VisualIntelligencePanel cardId=\{card\.id\}/);
    expect(SRC).toMatch(/never reused across parcels/i);
    // Unresolved parcels state it honestly with the next action — no stand-in image.
    expect(SRC).toMatch(/Unresolved · awaiting parcel resolution/);
    expect(SRC).toMatch(/no imagery or facts are shown for this parcel/i);
  });

  it('keeps source-labeled facts without the internal business-spine diagnostics', () => {
    expect(SRC).toMatch(/Source-labeled property facts/);
    expect(SRC).toMatch(/DdFactChecklist/);
    expect(SRC).not.toMatch(/<BusinessSpineSection\b/);
  });

  it('renders legacy county-record owner facts through the reconciled person name', () => {
    expect(SRC).toMatch(/ownerName=\{seller\?\.name \?\? prop\?\.owner\}/);
    expect(SRC).toMatch(/\^owner\(\?:\\s\+of\\s\+record\)\?\$\/i\.test\(fact\.field\.trim\(\)\) \? ownerName : fact\.value/);
    expect(SRC).toMatch(/<RetainedLandPortalPanel[^>]+ownerName=\{seller\?\.name \?\? prop\?\.owner\}/);
  });

  it('removed the manual DD worksheet from the Property tab (canonical facts only)', () => {
    expect(SRC).toMatch(/Manual DD worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual DD \/ research worksheet"/);
  });

  it('drops the on-demand duplicate Land Score widget (the report Land Score is canonical)', () => {
    expect(SRC).not.toMatch(/Compute Land Score/);
    expect(SRC).not.toMatch(/Refresh Land Score/);
    // The report-inline Land Score stays.
    expect(SRC).toMatch(/LandScoreSection/);
  });
});

describe('Deal Card — Market answers "should I want land here?"', () => {
  it('opens with the operator question and retained asking references', () => {
    expect(SRC).toMatch(/Should I want land here\?/);
    expect(SRC).toMatch(/activeTab === 'market'[\s\S]*LandPortalComparableTable/);
    expect(SRC).toMatch(/<CompMap dealCardId=/);
  });

  it('has a Data Center Watch that explains why each finding matters', () => {
    expect(SRC).toMatch(/Data Center Watch/);
    expect(SRC).toMatch(/Why this matters:/);
    expect(SRC).toMatch(/None found \(2025\+\)/);
    expect(SRC).toMatch(/market-scan/);
  });

  it('filters growth signals through land relevance (irrelevant news never shown)', () => {
    expect(SRC).toMatch(/Growth signals/);
    expect(SRC).toMatch(/irrelevant local news is filtered out|irrelevant item/i);
  });

  it('removes raw provider rows and the manual market worksheet', () => {
    expect(SRC).not.toMatch(/Raw provider rows \(technical audit\)/);
    expect(SRC).toMatch(/Manual market worksheet removed/);
    expect(SRC).not.toMatch(/Collapsible title="Manual market research worksheet"/);
  });
});

describe('Deal Card — Strategy answers "should I pursue this opportunity?"', () => {
  it('leads with the pursuit decision and the attractive acquisition price', () => {
    expect(SRC).toMatch(/function PursuitPanel/);
    expect(SRC).toMatch(/<PursuitPanel/);
    expect(SRC).toMatch(/Attractive acquisition price/);
    expect(SRC).toMatch(/Pursue with caution/);
  });

  it('shows the highest & best exit with runner-ups, blockers, and remaining verification', () => {
    expect(SRC).toMatch(/Highest & best exit/);
    expect(SRC).toMatch(/Runner-up/);
    expect(SRC).toMatch(/Major blockers/);
    expect(SRC).toMatch(/Remaining verification/);
    expect(SRC).toMatch(/ConfirmBeforeOfferSection/);
  });

  it('replaced "Can I buy this property?" — identity is a gate, not a strategy', () => {
    expect(SRC).not.toMatch(/Can I buy this property\?/);
  });

  it('does not duplicate parcel facts, imagery, or the valuation panel on Strategy', () => {
    const strategyBlocks = SRC.split("activeTab === 'strategy'").slice(1).join(' ');
    expect(strategyBlocks).not.toMatch(/<KeyFactsGrid|<PropertyHeaderSection|<HeroVisual|<ValuationPanel|<VisualIntelligencePanel/);
  });

  it('the Seller tab shows the practical seller workspace without readiness UI', () => {
    expect(SRC).not.toMatch(/<DiscoveryCallReportSection/);
    expect(SRC).toMatch(/activeTab === 'seller'[\s\S]{0,400}<SellerSnapshot/);
    expect(SRC).toMatch(/<SellerQuestionsPanel questions=\{operatorRecord\.sellerQuestions\}/);
    expect(SRC).not.toMatch(/<SellerReadinessPanel\b/);
  });
});

describe('Deal Card — Executive Orchestrator review', () => {
  it('does not render internal coherence diagnostics on owner-facing tabs', () => {
    expect(SRC).toMatch(/function OrchestrationBanner/);
    expect(SRC).not.toMatch(/<OrchestrationBanner\b/);
  });
});

describe('Deal Card — legacy scaffolding is gone', () => {
  it('removed the empty placeholder sections operators kept seeing', () => {
    expect(SRC).not.toMatch(/Section title="Deal Economics"/);
    expect(SRC).not.toMatch(/Section title="Communication Summary"/);
    expect(SRC).not.toMatch(/Section title="Exit Strategy Analysis"/);
    expect(SRC).not.toMatch(/Section title="Pre-Call Brief"/);
    expect(SRC).not.toMatch(/Section title="Land Data \/ DD Facts"/);
  });

  it('Documents tab shows real report actions, not disabled CRM clutter', () => {
    expect(SRC).toMatch(/report\/download\?format=pdf/);
    expect(SRC).toMatch(/report\/download\?format=md/);
    expect(SRC).not.toMatch(/'Push to CRM'/);
    expect(SRC).not.toMatch(/'Make Offer', 'Schedule Follow-Up'/);
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
  it('keeps retrieval capability off the owner-facing card while public findings remain', () => {
    expect(SRC).toMatch(/function BrowserIntelligenceSection/);
    expect(SRC).not.toMatch(/<BrowserIntelligenceSection\b/);
    expect(SRC).toMatch(/<PublicPropertyIntelligencePanel dealId=\{deal\.id\}/);
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

  it('keeps general deal editing separate from verified identity correction', () => {
    expect(SRC).toMatch(/Deal-level fields only/);
    expect(SRC).toMatch(/function PropertyIdentityControl/);
    expect(SRC).toMatch(/Save verified property identity/);
  });
});

describe('Deal Card panel — list / open flow', () => {
  it('presents the saved-deal list as the "Deal Library", not a "Deal Card"', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\('\/api\/landos\/deal-cards'\)/);
    expect(SRC).toMatch(/async function refreshList\(\)/);
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
    expect(SRC).toMatch(/mode === 'view' && deal && !showResolution/);
  });

  it('keeps retained Smart Intake evidence and editable candidates reachable while resolution gates property intelligence', () => {
    const resolutionBranch = SRC.slice(
      SRC.indexOf('{/* Resolution view'),
      SRC.indexOf("{mode === 'view' && deal && !showResolution"),
    );
    const confirmedBranch = SRC.slice(
      SRC.indexOf("{mode === 'view' && deal && !showResolution"),
      SRC.indexOf('{/* ══ OVERVIEW TAB'),
    );
    expect(resolutionBranch).toMatch(/!terminalParcel[\s\S]*<SmartIntakePanel/);
    expect(resolutionBranch).toMatch(/Smart Intake evidence and editable candidates remain available/);
    expect(confirmedBranch).toMatch(/<SmartIntakePanel/);
  });
});

describe('Deal Card panel — safety', () => {
  it('reads from the existing deal-card detail route only', () => {
    expect(SRC).toMatch(/apiGet<[^>]*>\(`\/api\/landos\/deal-cards\/\$\{id\}`\)/);
  });

  it('does not fabricate CRM/GHL data or perform external CRM mutation', () => {
    expect(SRC).toMatch(/not connected/);
    expect(SRC).toMatch(/No external CRM\/GHL mutation/);
    expect(/apiPost\([^)]*ghl|crm.*sync|sendMessage/i.test(SRC)).toBe(false);
  });

  it('seller asking price is negotiation context only, never an offer basis', () => {
    expect(SRC).toMatch(/negotiation context only/);
  });

  it('treats visuals as supporting context only, never parcel identity', () => {
    expect(SRC).toMatch(/Supporting context only — never parcel identity/);
  });

  it('uses no coordinate/map-pin identity language, and proximity is never called frontage', () => {
    expect(/geocod|nearest parcel|map pin/i.test(SRC)).toBe(false);
    expect(/ft mapped frontage/i.test(SRC)).toBe(false);
  });
});
  it('hard-gates rejected parcel mismatches from every downstream panel', () => {
    expect(SRC).toContain("const rejectedMismatch = prop?.verification_status === 'rejected_mismatch'");
    expect(SRC).toContain('No property intelligence, facts, valuation, Land Score, strategy, report, or offer is shown');
  });
