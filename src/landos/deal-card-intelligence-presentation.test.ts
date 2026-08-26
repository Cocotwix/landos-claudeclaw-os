// Deal Card intelligence presentation contract.
//
// The analyst's reasoning, prompt, dossier, schema and runtime are untouched by
// this surface: it only decides what an operator sees first and what waits
// behind a control. Two failures are what these tests exist to prevent:
//
//   1. The Overview printing the whole analyst report again. It carried every
//      property-story point, market point, opportunity, constraint, conflict,
//      visual observation, unknown and next action above the property itself.
//   2. Presentation "simplification" that DELETES evidence. Every raw rule,
//      source excerpt, diagnostic and provenance record must remain reachable.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const DIGEST_SRC = read('web/src/lib/acquisition-intelligence-digest.ts');
const DEAL_READ_SRC = read('web/src/components/AcquisitionWorkspaceV2DealRead.tsx');
const DILIGENCE_SRC = read('web/src/components/AcquisitionWorkspaceV2Diligence.tsx');
const OVERVIEW_SRC = read('web/src/components/AcquisitionWorkspaceV2Overview.tsx');
const PI_SRC = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');
const LAND_USE_SRC = read('web/src/components/AcquisitionWorkspaceV2LandUse.tsx');
const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const DEAL_READ_CSS = read('web/src/styles/workspace-v2-deal-read.css');
const DILIGENCE_CSS = read('web/src/styles/workspace-v2-diligence.css');

describe('Page 1 — the Deal Read replaces the analyst report', () => {
  it('renders the compact Deal Read on Overview, not the full analyst section', () => {
    expect(OVERVIEW_SRC).toContain('<DealReadCard');
    // The full section is imported for its TYPES only on Overview; the
    // component itself must not be rendered there any more.
    expect(OVERVIEW_SRC).not.toMatch(/<AcquisitionIntelligenceSection/);
  });

  it('shows the five Deal Read blocks and nothing longer', () => {
    expect(DEAL_READ_SRC).toContain('LandOS Deal Read');
    expect(DEAL_READ_SRC).toContain("Why it&apos;s interesting");
    expect(DEAL_READ_SRC).toContain('Biggest questions');
    expect(DEAL_READ_SRC).toContain('Best strategies');
    expect(DEAL_READ_SRC).toContain('Next move');
    expect(DEAL_READ_SRC).toContain('View full property intelligence');
  });

  it('never prints the full analyst lists on the Overview surface', () => {
    for (const field of ['propertyStory', 'marketStory', 'visualObservations', 'conflicts', 'warnings']) {
      expect(DEAL_READ_SRC).not.toContain(`${field}.map`);
      expect(DEAL_READ_SRC).not.toContain(`${field}?.map`);
    }
  });

  it('keeps attribution and the run-only-on-request rule', () => {
    expect(DEAL_READ_SRC).toContain('Read by {runtimeLine(');
    expect(DEAL_READ_SRC).toContain('Re-read the property file');
    expect(DEAL_READ_SRC).toContain('Nothing runs until you ask for it');
    // Rendering must never start a reasoning run: the only call is the
    // operator-pressed control.
    expect(DEAL_READ_SRC).not.toMatch(/useEffect|apiPost|\/run/);
  });

  it('caps the digest so the card cannot grow back into a report', () => {
    expect(DIGEST_SRC).toContain('opportunities.slice(0, 4)');
    expect(DIGEST_SRC).toContain('questionSource.slice(0, 4)');
    expect(DIGEST_SRC).toContain('ranked.slice(0, 3)');
  });

  it('states how much more the full read holds instead of implying completeness', () => {
    expect(DIGEST_SRC).toContain('depth: {');
    expect(DEAL_READ_SRC).toContain('retained insight');
  });
});

describe('Page 1 — duplication with the Deal Read is reduced', () => {
  it('shows the strongest exits compactly and keeps the rest one control away', () => {
    expect(OVERVIEW_SRC).toContain('strategies.slice(0, 3).map((item) => <StrategyCard item={item} />)');
    expect(OVERVIEW_SRC).toContain('strategies.slice(3).map((item) => <StrategyCard item={item} />)');
    expect(OVERVIEW_SRC).toContain('further exit');
  });

  it('gives each strategy card the four decision lines', () => {
    expect(OVERVIEW_SRC).toContain('<dt>Why it fits</dt>');
    expect(OVERVIEW_SRC).toContain('<dt>Main blocker</dt>');
    expect(OVERVIEW_SRC).toContain('<dt>Next confirmation</dt>');
    // The lane's full assessment is preserved behind the card's own control.
    expect(OVERVIEW_SRC).toContain('<summary>Full assessment</summary>');
  });

  it('ranks the strongest exits first rather than showing lane order', () => {
    expect(OVERVIEW_SRC).toContain('STRATEGY_APPLICABILITY_ORDER');
  });

  it('keeps the long planning narrative behind a control', () => {
    expect(OVERVIEW_SRC).toContain('Full planning narrative');
  });

  it('keeps the useful property overview intact', () => {
    for (const kept of [
      'Average slope', 'Buildability', 'Wetlands', 'FEMA flood',
      'Road access', 'Risk signals', 'Operator actions',
      'Assessment, tax &amp; planning history',
    ]) {
      expect(OVERVIEW_SRC).toContain(kept);
    }
  });
});

describe('Page 2 — a visual diligence workspace', () => {
  it('provides the conclusion-first primitives every section shares', () => {
    for (const primitive of ['function Disclosure', 'function Conclusion', 'function MetricRow', 'function ConflictBanner', 'function WhatItMeans', 'function StillNeeded', 'function HistoryWarning']) {
      expect(DILIGENCE_SRC).toContain(primitive);
    }
  });

  it('leads Access with a conclusion and a reconciled frontage conflict', () => {
    expect(PI_SRC).toMatch(/<Conclusion\s+label="Access"/);
    expect(PI_SRC).toContain('<MetricRow metrics={accessMetrics}');
    expect(PI_SRC).toContain('<ConflictBanner');
    expect(PI_SRC).toContain('frontageConflict');
    // One reconciled span, never two unexplained numbers.
    expect(DILIGENCE_SRC).toContain('Retained sources conflict.');
    expect(PI_SRC).toContain('Exact frontage requires confirmation.');
  });

  it('keeps the discovery-stage access doctrine unchanged', () => {
    expect(PI_SRC).toContain('Recorded-instrument review remains ordinary closing diligence');
    expect(PI_SRC).not.toMatch(/driveway (permit|approval)/i);
  });

  it('routes the analyst read to the section it is about', () => {
    for (const topic of ['access', 'terrain', 'utilities', 'market', 'zoning']) {
      expect(`${PI_SRC}\n${LAND_USE_SRC}`).toContain(`topic="${topic}"`);
    }
  });

  it('shows the acreage-band comparison rather than raw market diagnostics', () => {
    expect(PI_SRC).toContain('awv2-dx-bands');
    expect(PI_SRC).toContain('Subject band');
    expect(PI_SRC).toContain('Most liquid band');
  });

  it('ends on one ranked diligence queue, not twenty unresolved rows', () => {
    expect(PI_SRC).toContain('id="remaining-diligence"');
    expect(PI_SRC).toContain('<h4>High priority</h4>');
    expect(PI_SRC).toContain('<h4>Secondary</h4>');
    expect(PI_SRC).toContain('this is the priority order, not the whole list');
  });

  it('keeps the complete analyst read available on Page 2', () => {
    expect(PI_SRC).toContain('id="full-acquisition-intelligence"');
    expect(PI_SRC).toContain('Full Acquisition Intelligence');
    expect(PI_SRC).toContain('<AcquisitionIntelligenceSection');
    expect(PAGE_SRC).toContain('acquisitionIntelligence={{');
  });
});

describe('Page 2 — zoning is understandable without reading every rule', () => {
  it('leads with the current-zoning conclusion and a concise field grid', () => {
    expect(LAND_USE_SRC).toContain('label="Current zoning"');
    expect(LAND_USE_SRC).toContain('awv2-lu-fields');
    for (const field of [
      'Controlling authority', 'Current use / allowance status',
      'Subdivision path', 'Manufactured-home status',
    ]) {
      expect(LAND_USE_SRC).toContain(field);
    }
    expect(LAND_USE_SRC).toContain('Minor / simple split framework');
    expect(LAND_USE_SRC).toContain('Frontage standard');
    expect(LAND_USE_SRC).toContain('Direct-frontage potential');
    expect(LAND_USE_SRC).toContain('Private / shared access potential');
  });

  it('carries What we know / What it means / Still needed', () => {
    expect(LAND_USE_SRC).toContain('<h4>What we know</h4>');
    expect(LAND_USE_SRC).toContain('<WhatItMeans');
    expect(LAND_USE_SRC).toContain('<StillNeeded');
  });

  it('shows established subdivision facts even while current zoning is unresolved', () => {
    expect(LAND_USE_SRC).toContain("subdivision rule${confirmedRules === 1 ? '' : 's'} confirmed");
  });

  it('moves every rule, source and diagnostic behind disclosure without deleting one', () => {
    expect(LAND_USE_SRC).toMatch(/<Disclosure\s+label="Official sources"/);
    expect(LAND_USE_SRC).toMatch(/<Disclosure\s+label="Full rules"/);
    expect(LAND_USE_SRC).toMatch(/<Disclosure\s+label="Research diagnostics"/);
    // The full rule list is still rendered verbatim inside Full rules.
    expect(LAND_USE_SRC).toContain('...promoted.map((entry) => entry.rule), ...remainingRules');
    expect(LAND_USE_SRC).toContain('r.currentZoning.references.map');
    expect(LAND_USE_SRC).toContain('r.currentZoning.limitations.map');
    expect(LAND_USE_SRC).toContain('r.authority.sources.map');
  });

  it('separates development history from current rules and warns it is not entitlement', () => {
    expect(LAND_USE_SRC).toContain('id="property-development-history"');
    expect(LAND_USE_SRC).toContain('awv2-lu-timeline');
    expect(LAND_USE_SRC).toContain('<HistoryWarning />');
    expect(DILIGENCE_SRC).toContain('does <b>not</b> establish current zoning or entitlement');
  });
});

describe('presentation only — no backend intelligence behavior changed', () => {
  it('digests the persisted read with pure functions and fetches nothing', () => {
    expect(DIGEST_SRC).not.toMatch(/apiGet|apiPost|fetch\(/);
    expect(DILIGENCE_SRC).not.toMatch(/apiGet|apiPost|fetch\(/);
  });

  it('routes insights by matching the retained wording, inventing no facts', () => {
    expect(DIGEST_SRC).toContain('TOPIC_PATTERNS');
    expect(DIGEST_SRC).toContain('the retained sentence, verbatim'.replace('the', 'The'));
  });

  it('renders no analyst run on page load', () => {
    // The workspace fetches the persisted projection; only the operator's
    // explicit control POSTs a run.
    // The Intelligence Stack evolved the endpoint; the contract is unchanged:
    // exactly one explicit control starts a run, rendering never does.
    const runPosts = PAGE_SRC.match(/apiPost\([^)]*\/intelligence\/run/g) ?? [];
    expect(runPosts).toHaveLength(1);
    expect(PAGE_SRC).toContain('const runAcquisitionIntelligence = async () => {');
  });
});

describe('lane-owned styles are loaded', () => {
  it('ships the Deal Read and diligence stylesheets', () => {
    expect(DEAL_READ_SRC).toContain("import '../styles/workspace-v2-deal-read.css'");
    expect(DILIGENCE_SRC).toContain("import '../styles/workspace-v2-diligence.css'");
    expect(DEAL_READ_CSS).toMatch(/\.awv2-dealread-columns/);
    expect(DEAL_READ_CSS).toMatch(/\.awv2-dealread-strategies/);
    expect(DILIGENCE_CSS).toMatch(/\.awv2-dx-conclusion/);
    expect(DILIGENCE_CSS).toMatch(/\.awv2-dx-metrics/);
    expect(DILIGENCE_CSS).toMatch(/\.awv2-dx-queue/);
    expect(DILIGENCE_CSS).toMatch(/\.awv2-lu-fields/);
  });
});
