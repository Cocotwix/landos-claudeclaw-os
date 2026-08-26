// Deal Overview — final operator pass.
//
// The Overview is an operator command center: the deal economics and the
// property lead the page, the strategy semantics are three distinct reads
// rather than one contradictory label, the acreage-band market comparison is
// deterministic and persisted, and the research SYSTEM controls close the page
// instead of consuming premium space. These assertions lock that contract
// against the presentation source; none of them runs research or a model.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OVERVIEW = readFileSync('web/src/components/AcquisitionWorkspaceV2Overview.tsx', 'utf8');
const PAGE = readFileSync('web/src/pages/AcquisitionWorkspaceV2.tsx', 'utf8');
const PROPERTY_PAGE_OWNED = OVERVIEW;

describe('Deal Overview — final operator pass', () => {
  it('resolves a SHORT structured strategy identity, never a sentence', () => {
    expect(OVERVIEW).toContain('const shortStrategyLabel');
    // A persisted value carrying sentence punctuation or running long is
    // refused outright, which is what kept a Deal Brain instruction sentence
    // out of the Top Strategy slot.
    expect(OVERVIEW).toMatch(/if \(\/\[\.!\?\]\/\.test\(text\.slice\(0, -1\)\) \|\| text\.split\(\/\\s\+\/\)\.length > 8\) return null;/);
    expect(OVERVIEW).toContain('shortStrategyLabel(topStrategy)');
  });

  it('separates BASE CASE, LEADING VALUE-ADD and HIGHER-UPSIDE semantics', () => {
    expect(OVERVIEW).toContain('baseCaseCandidate');
    expect(OVERVIEW).toContain('valueAddCandidate');
    expect(OVERVIEW).toContain('higherUpsideCandidate');
    expect(OVERVIEW).toContain('Base case');
    expect(OVERVIEW).toContain('Leading value-add strategy');
    expect(OVERVIEW).toContain('Higher-upside hypothesis');
    // Only a candidate the strategy lane itself marked supported may lead; a
    // rejected major-subdivision thesis never becomes a shown hypothesis.
    expect(OVERVIEW).toContain('SUPPORTED_STRATEGY_FIT');
    expect(OVERVIEW).toMatch(/const stripStrategy = valueAddLabel\s*\n\s*\|\| baseCaseLabel/);
  });

  it('screens large acreage for product transformation before intact resale leads', () => {
    expect(OVERVIEW).toContain('LARGE_ACREAGE_SCREEN_ACRES');
    expect(OVERVIEW).toContain('largeAcreageScreen');
    // The screen never asserts a split works.
    expect(OVERVIEW).toContain('It is not proven; confirm it before pricing it.');
  });

  it('never puts a 50% acquisition value on the Overview', () => {
    const strip = OVERVIEW.slice(OVERVIEW.indexOf('awv2-econ-strip'), OVERVIEW.indexOf('awv2-strategy-clarity'));
    expect(strip).toContain('econLevels.pct40');
    expect(strip).toContain('econLevels.pct60');
    expect(strip).not.toContain('pct50');
    expect(strip).toContain("askingPrice != null ? usd(askingPrice) : 'Not yet known'");
  });

  it('renders Market — by acreage band from persisted market research only', () => {
    expect(OVERVIEW).toContain('overview-market-bands');
    expect(OVERVIEW).toContain('overviewBandRows');
    // Every column reads a persisted metric; nothing is derived or invented.
    expect(OVERVIEW).toContain('metrics.medianPricePerAcre');
    expect(OVERVIEW).toContain('metrics.medianDaysOnMarket');
    expect(OVERVIEW).toContain('metrics.sellThroughRate');
    expect(OVERVIEW).toContain('metrics.monthsOfSupply');
    // A band with no recorded sales is omitted rather than shown as zeros.
    expect(OVERVIEW).toMatch(/row\.sold !== '—' && row\.sold !== '0'/);
  });

  it('highlights the AS-IS band and refuses an invented target band', () => {
    expect(OVERVIEW).toContain('As-is band');
    expect(OVERVIEW).toContain('targetProductAcres');
    // A target band exists only when the supported strategy states a product
    // size AND that size falls inside a band the market record actually has.
    expect(OVERVIEW).toMatch(/const targetBandRow = targetProductAcres != null/);
    expect(OVERVIEW).toContain('bandContains(row.band, targetProductAcres)');
    expect(OVERVIEW).toContain('does not yet establish a product size');
  });

  it('keeps deep report residue off the Overview and on its owning page', () => {
    // The specialist cards render their report blocks only with full={true},
    // which is the Property / Market page. Overview passes full={false}.
    const SPECIALIST = readFileSync('web/src/components/AcquisitionWorkspaceV2SpecialistReads.tsx', 'utf8');
    expect(SPECIALIST).toContain('full={false}');
    expect(PAGE).toContain('<PropertyReadCard');
    expect(PAGE).toContain('<MarketReadCard product={marketIntelRead} stale={specialistStale?.market === true} full />');
    // Nothing the Overview stopped printing was destroyed: the conflict wall,
    // the official-record reconciliation controls and the acreage-extent
    // record are handed to the Property page that owns them.
    expect(PAGE).toContain('record: acreageExtent,');
    expect(PAGE).toContain('onReconcile: runAcreageReconcile,');
    expect(PAGE).toContain('onReconcile: runIntelligenceReconcile,');
    // The score-driver wall that rendered as orphaned vertical text is gone.
    expect(PROPERTY_PAGE_OWNED).not.toContain('function ScoreCard');
  });

  it('moves the research system controls to the foot of the page', () => {
    const slotAt = PAGE.indexOf('awv2-runstatus-slot');
    const overviewAt = PAGE.indexOf('<OverviewSection');
    expect(slotAt).toBeGreaterThan(overviewAt);
    expect(PAGE).toContain('research-system-status');
    // Functionality is preserved, only relocated.
    expect(PAGE).toContain('<PropertyIntelligenceRunStatus dealId={dealId}');
  });

  it('compacts research readiness on the Overview and puts it at the foot', () => {
    const readiness = OVERVIEW.indexOf('<ResearchReadinessStrip');
    const closeout = OVERVIEW.indexOf('awv2-overview-closeout');
    expect(readiness).toBeGreaterThan(closeout);
    expect(OVERVIEW).toMatch(/onBackfill=\{researchReadiness\.onBackfill\}\s*\n\s*compact/);
  });

  it('renders with no model, research or intelligence write on a normal read', () => {
    // The Overview presentation issues no POST of any kind; every value it
    // shows comes from an already-persisted projection passed in as props.
    expect(OVERVIEW).not.toMatch(/fetch\(|apiPost|method:\s*'POST'/);
  });
});
