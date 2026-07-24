// Source-scan contract for the Deal Card Zoning & Land Use panel (no jsdom).
// CRLF-normalized so the scans behave identically on autocrlf checkouts.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');

const DEAL_CARD = readSource('web/src/components/DealCard.tsx');
const PANEL = readSource('web/src/components/ZoningLandUsePanel.tsx');
const ROUTES = readSource('src/landos/routes.ts');

describe('Zoning & Land Use Deal Card UI contract', () => {
  it('the Deal Card loads the persisted zoning snapshot with GET only and never rebuilds while opening', () => {
    expect(DEAL_CARD).toContain('loadZoningLandUse(id)');
    expect(DEAL_CARD).toContain('/zoning-land-use`');
    expect(DEAL_CARD).toContain('/zoning-land-use/rebuild');
    const loadBody = DEAL_CARD.match(/async function loadZoningLandUse[\s\S]*?\n {2}\}\n/)?.[0] ?? '';
    expect(loadBody).toContain('apiGet');
    expect(loadBody).not.toContain('apiPost');
    expect(DEAL_CARD).toContain('<ZoningLandUsePanel');
  });

  it('rebuild is an explicit operator command bound to the POST route', () => {
    const rebuildBody = DEAL_CARD.match(/async function rebuildZoningLandUse[\s\S]*?\n {2}\}\n/)?.[0] ?? '';
    expect(rebuildBody).toContain('apiPost');
    expect(rebuildBody).toContain('/zoning-land-use/rebuild');
    expect(PANEL).toContain('data-testid="zoning-rebuild"');
    expect(PANEL).toContain('onClick={props.onRebuild}');
  });

  it('renders every requested operator-facing section', () => {
    for (const phrase of [
      'Zoning & Land Use',
      'Controlling zoning authority',
      'Base zoning district',
      'Governing ordinance',
      'Uses permitted by right',
      'Conditional / special-approval uses',
      'Prohibited uses',
      'Key dimensional & development standards',
      'Development implications',
      'Risks & conflicts',
      'Missing evidence',
      'Official sources & retained evidence',
      'Snapshot v',
      'zoning-last-researched',
    ]) expect(PANEL).toContain(phrase);
    expect(PANEL).toContain('zoning-land-use/artifacts');
  });

  it('separates by-right and conditional uses into distinct sections and never merges them', () => {
    expect(PANEL).toContain('testId="zoning-uses-by-right"');
    expect(PANEL).toContain('testId="zoning-uses-conditional"');
    expect(PANEL).toContain('data-testid={testId}');
    expect(PANEL).toMatch(/testId="zoning-uses-by-right"\s*\n?\s*uses=\{analysis\.usesByRight\}/);
    expect(PANEL).toMatch(/testId="zoning-uses-conditional"\s*\n?\s*uses=\{analysis\.conditionalOrSpecialUses\}/);
    // The by-right list is bound only to usesByRight; conditional uses are
    // never concatenated into it.
    expect(PANEL).not.toMatch(/uses=\{\[\s*\.\.\.analysis\.usesByRight[\s\S]*?conditionalOrSpecialUses/);
    expect(PANEL).not.toMatch(/uses=\{\[\s*\.\.\.analysis\.conditionalOrSpecialUses[\s\S]*?usesByRight/);
  });

  it('presents honest empty and uninterpreted states instead of fabricated permissions', () => {
    expect(PANEL).toContain('No zoning and land-use research has been persisted yet.');
    expect(PANEL).toContain('opening this card never triggers it');
    expect(PANEL).toContain('Absence here is never a statement that a use is allowed or prohibited.');
    expect(PANEL).toContain('Label not interpreted until jurisdiction + ordinance are confirmed');
    expect(PANEL).toContain('Third-party report only — not official');
    expect(PANEL).toContain('never used in this determination');
    // Regression (overlay-empty-state-not-affirmed): the overlay section states
    // its honest empty result instead of disappearing.
    expect(PANEL).toContain('No overlay or special district was located on the official overlay layers searched');
    expect(PANEL).toContain('not a guarantee that no overlay exists');
  });

  it('the UI never imports collector, adapter, or Analyst engine modules', () => {
    for (const source of [DEAL_CARD, PANEL]) {
      expect(source).not.toMatch(/zoning-operator|zoning-adapters|zoning-analyst|zoning-legacy-adapter|government-records-operator|better-sqlite3/);
    }
    expect(PANEL).not.toMatch(/\bfetch\s*\(|apiPost|apiGet/);
  });

  it('the GET route stays SELECT-only while the panel exists', () => {
    const getRoute = ROUTES.match(
      /app\.get\('\/api\/landos\/deal-cards\/:id\/zoning-land-use',[\s\S]*?\n {2}\}\);/,
    )?.[0] ?? '';
    expect(getRoute).toContain('readZoningLandUseForDeal');
    expect(getRoute).not.toMatch(/synchronize|persistZoning|runTracked|INSERT|UPDATE/);
  });
});
