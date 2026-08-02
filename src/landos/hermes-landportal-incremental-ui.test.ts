import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROUTES = fs.readFileSync(fileURLToPath(new URL('./routes.ts', import.meta.url)), 'utf8');
const PANEL = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/PropertyIntelligencePanel.tsx', import.meta.url)), 'utf8');
const IMPORTER = fs.readFileSync(fileURLToPath(new URL('./hermes-landportal-import.ts', import.meta.url)), 'utf8');

describe('Hermes incremental Deal Card projection', () => {
  it('serves active lane state and accepted category evidence through the existing Property Intelligence read', () => {
    expect(ROUTES).toMatch(/hermesLandPortal: getHermesLandPortalLaneProgress\(dealCardId\)/);
    expect(ROUTES).toMatch(/providerId === 'hermes_landportal_import'/);
    expect(ROUTES).toMatch(/acceptedEvidence:/);
    expect(ROUTES).toMatch(/field: item\.field/);
    expect(ROUTES).toMatch(/subjectClassification: item\.subjectClassification/);
  });

  it('keeps polling while Hermes is independently active and renders address-first category timestamps', () => {
    expect(PANEL).toMatch(/view\?\.hermesLandPortal\?\.status === 'running'/);
    expect(PANEL).toMatch(/data-testid="pi-hermes-incremental-status"/);
    expect(PANEL).toMatch(/Hermes · \{view\.hermesLandPortal\.address\}/);
    expect(PANEL).toMatch(/data-testid="pi-hermes-persisted-categories"/);
    expect(PANEL).toMatch(/result\.persistedAt/);
    expect(PANEL).toMatch(/data-testid="pi-provider-accepted-evidence"/);
  });

  it('renders provider evidence separately without promoting Hermes comps into valuation or strategy', () => {
    expect(PANEL).toMatch(/data-testid=\{`pi-provider-evidence-\$\{item\.kind\}`\}/);
    expect(IMPORTER).toMatch(/subjectClassification: 'context_only'/);
    expect(IMPORTER).toMatch(/classification: 'landportal_context'/);
    expect(IMPORTER).toMatch(/context-only unless transaction status\/date is independently retained/);
  });
});
