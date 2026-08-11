import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Normalize CRLF so source scans behave identically on core.autocrlf=true
// checkouts (Windows) and LF checkouts.
const readSource = (relative: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
const DEAL_CARD = readSource('web/src/components/DealCard.tsx');
const OVERVIEW = readSource('web/src/components/DealWorkspaceOverview.tsx');
const PROPERTY_INTELLIGENCE = readSource('web/src/components/PropertyIntelligencePanel.tsx');
const PANEL = readSource('web/src/components/GovernmentRecordsSnapshotPanel.tsx');
const ROUTES = readSource('src/landos/routes.ts');
const ANALYST = readSource('src/landos/government-records-analyst.ts');

describe('Government Records Deal Card UI and architecture contract', () => {
  it('25. Deal Card does not mount or independently load the legacy screening panel', () => {
    expect(DEAL_CARD).not.toContain('loadGovernmentRecords(id)');
    expect(DEAL_CARD).not.toContain('<GovernmentRecordsSnapshotPanel');
    expect(DEAL_CARD).not.toContain('/government-records/rebuild');
    expect(DEAL_CARD).toContain('<DealWorkspaceOverview');
    expect(OVERVIEW).toContain('<PropertyIntelligenceDueDiligence snapshot={snapshot}');
    expect(OVERVIEW).toContain('Property screening');
  });

  it('renders every requested business section and retained document visuals', () => {
    for (const phrase of [
      'Recorded ownership',
      'Survey & plat availability',
      'Recorded easements & restrictions',
      'Title-risk indicators',
      'Tax delinquency indicators',
      'Lien & judgment screening',
      'Material conflicts',
      'Missing instruments',
      'Property research questions',
      'Retained official documents and page captures',
      'This does not prove a survey or plat does not exist',
      'seller authority is handled outside this screening',
    ]) expect(PANEL).toContain(phrase);
    expect(PANEL).toContain('government-records/artifacts');
    expect(PANEL).toContain('<img');
  });

  it('renders extracted deed facts on the normal document card instead of only a source link', () => {
    expect(PROPERTY_INTELLIGENCE).toMatch(/section\(\s*'Deeds'[\s\S]{0,700}instrumentNumber[\s\S]{0,250}legalDescription/);
    expect(PROPERTY_INTELLIGENCE).toMatch(/facts=\{facts\}/);
    expect(PROPERTY_INTELLIGENCE).toMatch(/facts\.map\(\(fact\)/);
    expect(PROPERTY_INTELLIGENCE).toContain('{fact.label}');
    expect(PROPERTY_INTELLIGENCE).toContain('{fact.value}');
  });

  it('keeps collector diagnostics out of the owner-facing research-gap list', () => {
    expect(DEAL_CARD).toMatch(/function visibleEvidenceGaps/);
    expect(DEAL_CARD).toMatch(/detached frame\|arcgis 499\|provider error\|navigation timeout/);
    expect(DEAL_CARD).toMatch(/visibleEvidenceGaps\(piSnapshot\)\.map/);
    expect(DEAL_CARD).not.toMatch(/\(piSnapshot\?\.missingInformation \?\? \[\]\)\.map/);
  });

  it('keeps the GET route SELECT-only and the Analyst side-effect free', () => {
    const getRoute = ROUTES.match(/app\.get\('\/api\/landos\/deal-cards\/:id\/government-records'[\s\S]*?\n  }\);/)?.[0] ?? '';
    expect(getRoute).toContain('readGovernmentRecordsForDeal');
    expect(getRoute).not.toMatch(/synchronize|browser|provider|write|insert|update/i);
    expect(ANALYST).not.toMatch(/from ['"](?:node:fs|node:path|node:http|\.\/db|\.\/browser|\.\/routes|\.\/property-card)/);
    expect(ANALYST).not.toMatch(/\b(fetch|setTimeout|setInterval|writeFile|readFile|getLandosDb)\s*\(/);
  });
});
