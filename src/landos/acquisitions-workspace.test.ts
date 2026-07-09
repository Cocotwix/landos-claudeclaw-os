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

  it('opens a Deal Card in-workspace from the pipeline (never bouncing to the spine)', () => {
    expect(ACQ).toMatch(/function openDeal\(id: number\) \{ setDealId\(id\); setSection\('library'\); \}/);
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

describe('Property Board stays pipeline-only and opens the actual Deal Card', () => {
  it('supports embedding + an open-in-place callback while keeping the legacy deep link', () => {
    expect(BOARD).toMatch(/onOpenDeal\?: \(dealCardId: number\) => void/);
    expect(BOARD).toMatch(/embedded\?: boolean/);
    // Legacy standalone behavior (old links) is preserved.
    expect(BOARD).toMatch(/\/landos\?deal=\$\{[^}]+\}/);
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
