// Static checks that the Acquisitions department is a cohesive workspace and the
// old feature-based navigation no longer competes with the LandOS operating
// model (docs/LANDOS_VISION_AND_ARCHITECTURE.md). Source-scan style (no jsdom).
//
// The sidebar says WHERE the operator is (the department); the content area says
// WHAT they can do inside it. Acquisitions must feel like an operating
// department (Pipeline, New Lead, Deal Library, Property Intelligence, Discovery,
// Offers, Reports), the saved-deal list is the Deal Library (not a "Deal Card"),
// and the LandOS spine no longer surfaces the old Acquire / Intake / Deal Card
// feature tabs as primary navigation.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

function read(rel: string): string {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
}

const ACQ = read('../../web/src/pages/Acquisitions.tsx');
const APP = read('../../web/src/App.tsx');
const LANDOS = read('../../web/src/pages/LandOS.tsx');
const BOARD = read('../../web/src/pages/PropertyBoard.tsx');
const DEALCARD = read('../../web/src/components/DealCard.tsx');
const V2 = read('../../web/src/pages/AcquisitionWorkspaceV2.tsx');
const OVERVIEW = read('../../web/src/components/AcquisitionWorkspaceV2Overview.tsx');
const OVERVIEW_CSS = read('../../web/src/styles/workspace-v2-overview.css');

describe('Acquisitions is one cohesive department workspace', () => {
  it('defines the seven business sections', () => {
    for (const s of ['Pipeline', 'New Lead', 'Deal Library', 'Property Intelligence', 'Discovery', 'Offers', 'Reports']) {
      expect(ACQ.includes(`label: '${s}'`), `missing section ${s}`).toBe(true);
    }
  });

  it('maps the sections onto existing working surfaces (Board, Acquire, Deal Card)', () => {
    expect(ACQ).toMatch(/<PropertyBoard embedded onOpenDeal=\{openDeal\}/);
    expect(ACQ).toMatch(/<Acquire entity="all" onOpenDealCard=\{openDeal\}/);
    expect(ACQ).toMatch(/<DealCard/);
  });

  it('opens every record in Acquisition Workspace V2 (never Deal Card V1)', () => {
    // openDeal routes pipeline cards, library rows, and new-lead completion to
    // the same record's V2 workspace, preserving deal identity.
    expect(ACQ).toMatch(/function openDeal\(id: number\) \{\s*navigate\(dealWorkspaceHref\(id\)\);\s*\}/);
    // The Deal Library click path routes through openDeal.
    expect(ACQ).toMatch(/<DealCard entity="all" key="library-list" onOpenDeal=\{openDeal\}/);
    // No in-page V1 Deal Card render remains for a selected record.
    expect(ACQ).not.toMatch(/<DealCard dealCardId=/);
    // The old normal ?deal= route redirects to V2 for the same deal.
    expect(ACQ).toMatch(/navigate\(dealWorkspaceHref\(deal\), \{ replace: true \}\)/);
    // A permanent Acquisition Workspace entry exists inside the department.
    expect(ACQ).toMatch(/label="Acquisition Workspace"/);
    expect(ACQ).toMatch(/lastWorkspaceDealId\(\)/);
    expect(ACQ).not.toMatch(/LeadWorkspace/);
    // The workspace never renders the old feature tabs as its navigation.
    for (const bad of ['Cost Control', 'Org / Agents', 'Model Router', 'Command', 'Knowledge']) {
      expect(ACQ.includes(`label="${bad}"`), `Acquisitions must not repeat spine tab ${bad}`).toBe(false);
    }
  });

  it('is routed as a full workspace, before the generic department hub', () => {
    expect(APP).toMatch(/<Route path="\/dept\/acquisitions"><Acquisitions \/><\/Route>/);
    // The special route must precede the catch-all /dept/:slug so it wins.
    expect(APP.indexOf('/dept/acquisitions')).toBeLessThan(APP.indexOf('/dept/:slug'));
  });
});

describe('Deal Card naming — the library is not a "Deal Card"', () => {
  it('presents the saved-deal list as the Deal Library', () => {
    expect(DEALCARD).toMatch(/Section title="Deal Library"/);
    expect(DEALCARD).not.toMatch(/Section title="Saved Deal Cards"/);
    expect(DEALCARD).toMatch(/← Deal Library/);
  });
});

describe('Property Board stays pipeline-only and opens Acquisition Workspace V2', () => {
  it('supports embedding + an open callback; standalone opens the V2 workspace', () => {
    expect(BOARD).toMatch(/onOpenDeal\?: \(dealCardId: number\) => void/);
    expect(BOARD).toMatch(/embedded\?: boolean/);
    // Standalone board rows open the record's V2 workspace, never V1.
    expect(BOARD).toMatch(/navigate\(dealWorkspaceHref\(card\.dealCardId\)\)/);
    expect(BOARD).not.toMatch(/\/landos\?deal=/);
    expect(BOARD).toMatch(/function openDealCard/);
  });
});

describe('LandOS spine — old feature nav demoted', () => {
  it('renames the page as the system spine', () => {
    expect(LANDOS).toMatch(/title="LandOS Spine"/);
    expect(LANDOS).toMatch(/breadcrumb="System"/);
  });

  it('drops the Acquisitions-owned tabs (Acquire / Intake Planner / Deal Card) from the tab bar', () => {
    expect(LANDOS).not.toMatch(/<Tab label="Acquire"/);
    expect(LANDOS).not.toMatch(/<Tab label="Intake Planner"/);
    expect(LANDOS).not.toMatch(/<Tab label="Deal Card"/);
  });

  it('keeps those views reachable by deep link for backward compatibility', () => {
    // The render blocks + the ?view= allow-list still handle the legacy views.
    expect(LANDOS).toMatch(/view === 'dealcard' && <DealCard/);
    expect(LANDOS).toMatch(/'acquire', 'intake'/);
    expect(LANDOS).toMatch(/view === 'acquire' && <Acquire/);
  });
});

describe('Acquisition Workspace V2 Overview is an executive dashboard', () => {
  it('keeps the page as a data/navigation shell and extracts a peer Overview section', () => {
    expect(V2).toMatch(/import \{\s*OverviewSection, type OverviewSnapshotView/);
    expect(V2).toMatch(/<OverviewSection[\s\S]*?compsValuation=\{compsValuation\}/);
    expect(OVERVIEW).toMatch(/export function OverviewSection/);
    expect(OVERVIEW).toMatch(/import '\.\.\/styles\/workspace-v2-overview\.css'/);
    expect(OVERVIEW_CSS).toMatch(/\.awv2-overview-hero/);
  });

  it('uses one canonical decision and valuation state instead of local comp math', () => {
    expect(OVERVIEW).toMatch(/const canonical = operator\?\.canonical/);
    expect(OVERVIEW).toMatch(/const summary = compsValuation\?\.summary/);
    expect(OVERVIEW).toMatch(/summary\.acceptedCount/);
    expect(OVERVIEW).not.toMatch(/snap\.comps|\.sold\?\.length|candidate_closed_sale.*accepted_closed_sale/);
    expect(OVERVIEW).not.toMatch(/A third credible closed vacant-land sale|Two credible closed vacant-land sales/);
  });

  it('separates research delivery from diligence resolution', () => {
    expect(V2).not.toMatch(/class="awv2-statusbar"/);
    expect(OVERVIEW).toMatch(/Diligence queue/);
    expect(OVERVIEW).toMatch(/awv2-diligence-rows/);
  });

  it('keeps owner and seller identities separate and collapses canonical acreage display', () => {
    expect(V2).toMatch(/Owner of record <b>\{owner \|\| 'Unknown'\}/);
    expect(OVERVIEW).toMatch(/<small>Seller \/ lead<\/small><b>\{seller\?\.name \|\| 'Not collected'\}/);
    expect(V2.match(/\{acres\} AC/g)).toHaveLength(1);
    expect(OVERVIEW).not.toMatch(/acres\.toFixed|60\.00|60\.0/);
  });

  it('shows the access ladder once without equating physical and legal access', () => {
    for (const label of [
      'Parcel / landlocked flag',
      'Apparent physical access',
      'Reported legal / easement access',
      'Verified recorded legal access',
    ]) expect(OVERVIEW).toContain(label);
    expect(OVERVIEW).toMatch(/Physical evidence is not legal proof/);
  });

  it('keeps public marketing compact and sends listing evidence to the deeper workspace', () => {
    expect(OVERVIEW).toMatch(/awv2-marketing-compact/);
    expect(OVERVIEW).toMatch(/Off Market/);
    expect(OVERVIEW).toMatch(/No verified public listing/);
    expect(OVERVIEW).toMatch(/View listing evidence/);
    expect(OVERVIEW).not.toMatch(/Zillow views|Zillow saves|browser cleanup|candidate-page/i);
  });

  it('visually separates land basis from the pending whole-property value', () => {
    expect(OVERVIEW).toMatch(/LAND-ONLY INDICATION/);
    expect(OVERVIEW).toMatch(/WHOLE-PROPERTY VALUE/);
    expect(OVERVIEW).toMatch(/Opening reference \(40% of land value, rounded\)/);
    expect(OVERVIEW).toMatch(/not completed whole-property offer recommendations/);
    expect(OVERVIEW_CSS).toMatch(/\.awv2-overview-valuation \.primary b/);
    expect(OVERVIEW_CSS).toMatch(/\.awv2-overview-valuation \.whole b/);
  });

  it('keeps score arithmetic and methodology secondary', () => {
    expect(OVERVIEW).toMatch(/<details class="awv2-overview-details">/);
    expect(OVERVIEW).toMatch(/<details class="awv2-overview-methodology">/);
    expect(OVERVIEW).toMatch(/Positives/);
    expect(OVERVIEW).toMatch(/Risks/);
    expect(OVERVIEW).toMatch(/Could change/);
  });
});
