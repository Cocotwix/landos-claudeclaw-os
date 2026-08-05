// Acquisition Workspace V2 is the official operator workspace — routing
// contract. Source-scan style (repo idiom, node-safe); live behavior is proven
// in the operator browser walkthrough.
//
// Every normal operator entry point (pipeline, library, new lead, deep links,
// spine backward-compat views) opens V2 for the exact record. Deal Card V1
// stays intact but is reachable only through the hidden /legacy/deal/:id
// route, which appears in no normal navigation.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

function read(rel: string): string {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
}

const APP = read('../../web/src/App.tsx');
const ACQ = read('../../web/src/pages/Acquisitions.tsx');
const LANDOS = read('../../web/src/pages/LandOS.tsx');
const BOARD = read('../../web/src/pages/PropertyBoard.tsx');
const V2 = read('../../web/src/pages/AcquisitionWorkspaceV2.tsx');
const LEGACY = read('../../web/src/pages/LegacyDealCard.tsx');
const NAV = read('../../web/src/lib/workspace-v2-nav.ts');
const SIDEBAR = read('../../web/src/components/Sidebar.tsx');
const ROUTES_LIB = read('../../web/src/lib/routes.ts');

describe('V2 is the default workspace for every deal route', () => {
  it('redirects the normal /deal/:id route to V2 with identity preserved', () => {
    expect(APP).toMatch(/<Route path="\/deal\/:id">/);
    expect(APP).toMatch(/\$\{WORKSPACE_V2_PATH\}\?deal=\$\{n\}/);
    // Replace-style redirect keeps browser history sane (back never loops).
    expect(APP).toMatch(/replace \/>/);
  });

  it('keeps Deal Card V1 only behind the hidden legacy route', () => {
    expect(APP).toMatch(/<Route path="\/legacy\/deal\/:id">/);
    expect(LEGACY).toMatch(/<DealCard dealCardId=\{dealCardId\}/);
    expect(LEGACY).toMatch(/rollback and comparison only/);
    // The legacy route appears in no normal navigation surface.
    expect(SIDEBAR).not.toMatch(/legacy\/deal/);
    expect(ROUTES_LIB).not.toMatch(/legacy\/deal/);
    expect(ACQ).not.toMatch(/legacy\/deal/);
    expect(BOARD).not.toMatch(/legacy\/deal/);
  });

  it('redirects the old ?deal= deep links (Acquisitions + spine) to V2', () => {
    expect(ACQ).toMatch(/navigate\(dealWorkspaceHref\(deal\), \{ replace: true \}\)/);
    expect(LANDOS).toMatch(/navigate\(dealWorkspaceHref\(deal\), \{ replace: true \}\)/);
  });

  it('opens V2 from every list surface (pipeline, library, spine list)', () => {
    expect(ACQ).toMatch(/function openDeal\(id: number\) \{\s*navigate\(dealWorkspaceHref\(id\)\);\s*\}/);
    expect(BOARD).toMatch(/navigate\(dealWorkspaceHref\(card\.dealCardId\)\)/);
    expect(LANDOS).toMatch(/onOpenDeal=\{\(id\) => navigate\(dealWorkspaceHref\(id\)\)\}/);
    // No surface navigates to the old V1 deep link anymore.
    for (const src of [ACQ, BOARD, LANDOS]) expect(src).not.toMatch(/\/landos\?deal=/);
  });
});

describe('new leads land in V2 immediately after creation', () => {
  it('routes New Lead completion through openDeal → V2 in Acquisitions', () => {
    expect(ACQ).toMatch(/<Acquire entity="all" onOpenDealCard=\{openDeal\}/);
  });

  it('routes the legacy spine Acquire view to V2 as well', () => {
    expect(LANDOS).toMatch(/onOpenDealCard=\{\(id\) => navigate\(dealWorkspaceHref\(id\)\)\}/);
  });

  it('V2 opens a lead whose property identity is still unresolved', () => {
    // A deal record without a property-intelligence snapshot renders the
    // workspace with an explicit pending state instead of a dead end.
    expect(V2).toMatch(/pendingResolution/);
    expect(V2).toMatch(/Property identity resolution pending/);
    // The visible label prefers address, then best available identity —
    // never the bare internal deal number.
    expect(V2).toMatch(/bestIdentity/);
  });
});

describe('the operator can always return to V2', () => {
  it('V2 remembers the active deal and section for this session', () => {
    expect(V2).toMatch(/rememberWorkspaceDeal\(dealId, SECTION_SLUGS\[section\]/);
    expect(NAV).toMatch(/landos\.workspaceV2\.lastDeal/);
  });

  it('the Acquisitions department has a permanent Acquisition Workspace entry', () => {
    expect(ACQ).toMatch(/label="Acquisition Workspace"/);
    // Entry behavior: last-used deal in V2, otherwise the pipeline selector.
    expect(ACQ).toMatch(/function openWorkspace\(\) \{[\s\S]*?lastWorkspaceDealId\(\)[\s\S]*?setSection\('pipeline'\)/);
  });

  it('a bare V2 URL never renders an unidentified record', () => {
    // No hard-coded default deal; without ?deal= it falls back to the
    // session's last deal or leaves for the pipeline.
    expect(V2).not.toMatch(/: 81;/);
    expect(V2).toMatch(/lastWorkspaceDealId\(\)/);
    expect(V2).toMatch(/navigate\('\/dept\/acquisitions', \{ replace: true \}\)/);
  });
});
