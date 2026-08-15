// Acquisition Workspace V2 — lead-card design system contract.
//
// Node-safe source-text test (LandOS vitest has no DOM; operator-visible
// rendering is browser QA). Protected here:
//   1. The reusable design-token layer exists, defines the six functional
//      domain hues, and is loaded LAST so it can restyle every section.
//   2. The section rail is a legend: live sections carry domain swatches.
//   3. The canonical-state contract: Comps & Valuation reports every
//      operator-action refresh back to the workspace boundary, so Overview
//      can never render a pre-action valuation after a tab switch.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
const DESIGN_CSS = read('web/src/styles/workspace-v2-lead-design.css');

const DOMAINS = ['property', 'valuation', 'market', 'risk', 'evidence', 'action'] as const;

describe('lead-card design system layer', () => {
  it('defines a hue and soft tint token for all six functional domains', () => {
    for (const d of DOMAINS) {
      expect(DESIGN_CSS).toMatch(new RegExp(`--awv2-dom-${d}:\\s*#[0-9a-fA-F]{6}`));
      expect(DESIGN_CSS).toMatch(new RegExp(`--awv2-dom-${d}-soft:`));
    }
  });

  it('gives every data-domain surface its own treatment — surface, not just a colored border', () => {
    for (const d of DOMAINS) {
      // Each domain rule paints its own background treatment and carries the
      // legend tick on its title. A border alone is not a domain surface.
      expect(DESIGN_CSS).toMatch(new RegExp(`\\.awv2 \\[data-domain="${d}"\\]\\s*\\{[^}]*background:`));
      expect(DESIGN_CSS).toMatch(new RegExp(`\\[data-domain="${d}"\\]\\s*> \\.awv2-panel-title::before`));
    }
    // Distinct compositions: evidence is photographic-dark, property carries
    // mono record labels, risk colors its list markers.
    expect(DESIGN_CSS).toMatch(/\[data-domain="evidence"\][^{]*\{[^}]*#0f1210/);
    expect(DESIGN_CSS).toMatch(/\[data-domain="property"\] dt/);
    expect(DESIGN_CSS).toMatch(/\[data-domain="risk"\] li::marker/);
  });

  it('is imported last by the workspace page so it can restyle every sheet before it', () => {
    const imports = [...PAGE_SRC.matchAll(/import '\.\.\/styles\/([\w-]+\.css)';/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThanOrEqual(3);
    expect(imports[imports.length - 1]).toBe('workspace-v2-lead-design.css');
  });

  it('renders exactly three visually distinct top-level workspaces', () => {
    expect(PAGE_SRC).toMatch(/SECTION_DOMAINS/);
    expect(PAGE_SRC).toMatch(/data-domain=\{SECTION_DOMAINS\[s\]\}/);
    expect(PAGE_SRC).toContain("['Overview', 'Property & Market', 'Deal Activity']");
    expect(PAGE_SRC).toContain('awv2-workspace-nav');
    expect(PAGE_SRC).not.toContain('Soon');
    expect(DESIGN_CSS).toMatch(/\.awv2-workspace-nav\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
  });

  it('keeps the header parcel identity chips (APN, acreage, county) canonical', () => {
    expect(PAGE_SRC).toMatch(/APN \{id\.apn \|\| card0\?\.apn\}/);
    expect(PAGE_SRC).toMatch(/\{acres\} AC/);
  });
});

describe('canonical cross-page valuation state', () => {
  it('Comps & Valuation accepts and calls the onViewChange canonical-state callback', () => {
    expect(CV_SRC).toMatch(/onViewChange\?\:\s*\(view: CompsValuationViewData\) => void/);
    expect(CV_SRC).toMatch(/onViewChange\?\.\(merged\)/);
    // Both operator mutation paths route through applyView, never bare setView.
    const mutationBodies = CV_SRC.match(/const act = async[\s\S]*?^  };/m)?.[0] ?? '';
    const resolveBody = CV_SRC.match(/const resolveLocations = async[\s\S]*?^  };/m)?.[0] ?? '';
    expect(mutationBodies).toContain('applyView(');
    expect(resolveBody).toContain('applyView(');
    expect(mutationBodies).not.toMatch(/\bsetView\(/);
    expect(resolveBody).not.toMatch(/\bsetView\(/);
  });

  it('the workspace boundary feeds selection refreshes back into page-level compsValuation state', () => {
    expect(PAGE_SRC).toMatch(/<CompsValuationSection[^>]*onViewChange=\{setCompsValuation\}/);
  });
});

// Regression coverage for the ws1 browser-QA findings (sprint
// sprint-2026-08-14-lead-card-redesign): stale counts inside prose, identical
// labels carrying different figures, and the legend-swatch contract.
describe('ws1 QA repairs stay repaired', () => {
  const OVERVIEW_SRC = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');
  const PI_SRC = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');
  const RUN_SRC = read('web/src/components/AcquisitionWorkspaceV2RunStatus.tsx');

  it('Overview reconciles comp counts baked into server decision prose with the canonical summary', () => {
    expect(OVERVIEW_SRC).toMatch(/decisionSummaryRaw\.replace\(\/\\d\+\\s\+accepted closed sale\\\(s\\\)\/g,\s*`\$\{cvSummary\.acceptedCount\} accepted closed sale\(s\)`\)/);
  });

  it('the land-basis references and the negotiation ceiling never share a label', () => {
    // Overview names the 40/50/60% basis in each label.
    expect(OVERVIEW_SRC).toContain('Opening reference (40% of land value, rounded)');
    expect(OVERVIEW_SRC).toContain('Target reference (50% of land value, rounded)');
    expect(OVERVIEW_SRC).toContain('Ceiling reference (60% of land value, rounded)');
    expect(OVERVIEW_SRC).not.toContain('Land-basis ceiling reference');
    // CV names its ceiling as the negotiation figure it actually is.
    expect(CV_SRC).toContain('Land-basis negotiation ceiling');
    expect(CV_SRC).not.toContain('Land-basis ceiling reference');
  });

  it('Overview labels the accepted-sale span so it cannot read as the supported retail range', () => {
    expect(OVERVIEW_SRC).toContain('accepted-sale span');
  });

  it('PI comparable-evidence handoff headline derives from the canonical valuation summary', () => {
    expect(PI_SRC).toMatch(/valuationSummary\s*\?\s*`\$\{valuationSummary\.acceptedCount\} accepted closed sale/);
  });

  it('PI missing-diligence closed-sale row reconciles against the canonical accepted count', () => {
    expect(PI_SRC).toMatch(/valuationSummary\.acceptedCount > 0 && \/closed\[- \]sale\/i\.test\(rawItem\.label\)/);
  });

  it('keeps research measures out of the prime header and distinct in deeper status surfaces', () => {
    expect(PAGE_SRC).not.toContain('research areas delivered');
    expect(PAGE_SRC).not.toContain('awv2-statusbar');
    expect(PAGE_SRC).not.toContain('research lanes delivered');
    expect(PI_SRC).toContain('Research areas delivered');
    expect(RUN_SRC).toContain('lanes reported by this research run');
  });

  it('no operator-visible string literal carries an HTML entity (F7)', () => {
    // Entities are valid only directly inside JSX markup; a string literal is
    // escaped again by the framework and renders the entity to the operator.
    for (const src of [PAGE_SRC, CV_SRC]) {
      expect(src).not.toMatch(/= '[^'\n]*&amp;[^'\n]*'/);
    }
    expect(PAGE_SRC).toContain("'Open Comps & Valuation →'");
  });

  it('the Overview renders reconciled diligence questions as compact visual rows (F8/F11)', () => {
    const OVERVIEW = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');
    // The API sends question objects; compact rows must render their labels.
    expect(OVERVIEW).toMatch(/const questionCards = \(status\?\.openQuestions \?\? \[\]\)\.map/);
    expect(OVERVIEW).toMatch(/typeof question !== 'string'/);
    expect(OVERVIEW).toMatch(/label: question\.label/);
    expect(OVERVIEW).toMatch(/awv2-diligence-rows/);
  });

  it('land-basis reference labels disclose the rounding (F10)', () => {
    const OVERVIEW = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');
    expect(OVERVIEW).toContain('(40% of land value, rounded)');
    expect(OVERVIEW).toContain('rounded to the nearest $500');
  });

  it('consolidates property diligence and valuation under Property & Market', () => {
    expect(PAGE_SRC).toContain("section === 'Property & Market'");
    expect(PAGE_SRC).toContain("propertyMarketView === 'property-intelligence'");
    expect(PAGE_SRC).toContain("propertyMarketView === 'comps-valuation'");
    expect(PAGE_SRC).toContain('Property &amp; diligence');
    expect(PAGE_SRC).toContain('Valuation &amp; comps');
  });
});

// ── ws2: Overview redesign contract ─────────────────────────────────────
describe('ws2 Overview redesign', () => {
  const OVERVIEW_SRC = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');

  it('leads with the decision band and key metrics before any evidence surface', () => {
    const decisionAt = OVERVIEW_SRC.indexOf('awv2-overview-decisionband');
    const heroAt = OVERVIEW_SRC.indexOf('awv2-overview-hero');
    const listingAt = OVERVIEW_SRC.indexOf('awv2-overview-listing ');
    const valuationAt = OVERVIEW_SRC.indexOf('awv2-overview-valuation"');
    expect(decisionAt).toBeGreaterThan(-1);
    expect(decisionAt).toBeLessThan(heroAt);
    expect(valuationAt).toBeLessThan(listingAt);
  });

  it('uses House Value naming and never Improvement Value', () => {
    expect(OVERVIEW_SRC).toContain('HOUSE VALUE');
    expect(OVERVIEW_SRC).not.toMatch(/Improvement Value/i);
  });

  it('separates slope and buildability percentages and presents retained no-flood evidence as zero affected', () => {
    expect(OVERVIEW_SRC).toMatch(/%\\s\*average slope/);
    expect(OVERVIEW_SRC).toMatch(/%\\s\*buildability/);
    expect(OVERVIEW_SRC).toMatch(/not in \(\?:a \)\?flood hazard area/);
  });

  it('gates the Land + House + Whole breakdown on a residential subject over one acre', () => {
    expect(OVERVIEW_SRC).toMatch(/showHouseBreakdown = residentialSubject && \(acresForValuation \?\? 0\) > 1/);
    expect(OVERVIEW_SRC).toMatch(/singleResidentialValue = residentialSubject && acresForValuation != null && acresForValuation <= 1/);
    expect(OVERVIEW_SRC).toMatch(/\{showHouseBreakdown && \(/);
    expect(OVERVIEW_SRC).toMatch(/\{!singleResidentialValue && \(/);
    // A house value the backend has not established renders Pending, never a number.
    expect(OVERVIEW_SRC).toMatch(/houseValue != null \? formatUsd\(houseValue\) : 'Pending'/);
  });

  it('presents access as established for a not-landlocked, road-fronting parcel without warning tones', () => {
    expect(OVERVIEW_SRC).toMatch(/accessEstablished = !!accessView\?\.established && !accessView\?\.evidence\?\.parcelFlagged/);
    expect(OVERVIEW_SRC).toContain("accessEstablished ? 'Access established' : 'Physical evidence is not legal proof'");
    // The unverified-recorded-access rung is neutral, not risk, once access is established.
    expect(OVERVIEW_SRC).toMatch(/accessEstablished \? 'neutral' : 'risk'/);
    // Established access shows the ladder as collapsed provenance.
    expect(OVERVIEW_SRC).toMatch(/accessEstablished \? \(\s*<details/);
  });

  it('marks every functional area with its domain surface', () => {
    for (const domain of ['action', 'property', 'valuation', 'risk', 'market', 'evidence']) {
      expect(OVERVIEW_SRC).toContain(`data-domain="${domain}"`);
    }
  });
});

// ── ws3: Property Intelligence redesign contract ────────────────────────
describe('ws3 Property Intelligence redesign', () => {
  const PI_SRC = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');

  it('carries domain surfaces across its functional areas', () => {
    for (const domain of ['property', 'valuation', 'market', 'risk', 'evidence', 'action']) {
      expect(PI_SRC).toContain(`data-domain="${domain}"`);
    }
  });

  it('presents market context as the one connected Market Intelligence area', () => {
    expect(PI_SRC).toContain('id="market-intelligence"');
    expect(PI_SRC).toMatch(/Market Intelligence <span class="awv2-src-tag">.*Market Pulse \+ Market Research, one connected read/);
  });

  it('retires the legacy access-rung counter so no stray digit joins the real step badge (F13)', () => {
    expect(DESIGN_CSS).toMatch(/\.awv2 \.awv2-access-rung::before \{ content: none; counter-increment: none; \}/);
  });

  it('states the shared access-established read before the evidence ladder', () => {
    expect(PI_SRC).toContain('data-testid="pi-access-established"');
    expect(PI_SRC).toMatch(/accessView\?\.established && !accessView\?\.evidence\?\.parcelFlagged/);
    expect(PI_SRC).toMatch(/Access established:/);
  });
});

// ── ws4: Comps & Valuation redesign contract ────────────────────────────
describe('ws4 Comps & Valuation redesign', () => {
  it('uses House Value naming and never the improvement-value label', () => {
    expect(CV_SRC).toContain('House Valuation');
    expect(CV_SRC).toContain('+ House Value');
    expect(CV_SRC).toContain('Estimated house value');
    expect(CV_SRC).not.toMatch(/Improvement Valuation|\+ Improvement Value|Estimated subject improvement value/);
  });

  it('leads with the decision strip and defaults the comp workspace to the pricing set', () => {
    const decisionAt = CV_SRC.indexOf('awv2-cv-decisionpanel');
    const workspaceAt = CV_SRC.indexOf('aria-label="Comparable workspace"');
    const ledgerAt = CV_SRC.indexOf('aria-label="Valuation explanation"');
    expect(decisionAt).toBeGreaterThan(-1);
    expect(decisionAt).toBeLessThan(workspaceAt);
    expect(workspaceAt).toBeLessThan(ledgerAt);
    expect(CV_SRC).toMatch(/useState<FilterKey>\('decision'\)/);
  });

  it('carries domain surfaces including the Market Intelligence band', () => {
    for (const domain of ['valuation', 'market', 'evidence']) {
      expect(CV_SRC).toContain(`data-domain="${domain}"`);
    }
    expect(CV_SRC).toContain('Market Intelligence — acreage-band context');
  });
});
