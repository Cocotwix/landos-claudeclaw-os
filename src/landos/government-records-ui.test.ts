import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DEAL_CARD = fs.readFileSync(path.resolve(process.cwd(), 'web/src/components/DealCard.tsx'), 'utf8');
const PANEL = fs.readFileSync(path.resolve(process.cwd(), 'web/src/components/GovernmentRecordsSnapshotPanel.tsx'), 'utf8');
const ROUTES = fs.readFileSync(path.resolve(process.cwd(), 'src/landos/routes.ts'), 'utf8');
const ANALYST = fs.readFileSync(path.resolve(process.cwd(), 'src/landos/government-records-analyst.ts'), 'utf8');

describe('Government Records Deal Card UI and architecture contract', () => {
  it('25. Deal Card loads persisted screening and never calls rebuild while opening', () => {
    expect(DEAL_CARD).toContain('loadGovernmentRecords(id)');
    expect(DEAL_CARD).toContain('/government-records`');
    expect(DEAL_CARD).toContain('/government-records/rebuild');
    const loadBody = DEAL_CARD.match(/async function loadGovernmentRecords[\s\S]*?\n  }\n/)?.[0] ?? '';
    expect(loadBody).toContain('apiGet');
    expect(loadBody).not.toContain('apiPost');
    expect(DEAL_CARD).toContain('<GovernmentRecordsSnapshotPanel');
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

  it('keeps the GET route SELECT-only and the Analyst side-effect free', () => {
    const getRoute = ROUTES.match(/app\.get\('\/api\/landos\/deal-cards\/:id\/government-records'[\s\S]*?\n  }\);/)?.[0] ?? '';
    expect(getRoute).toContain('readGovernmentRecordsForDeal');
    expect(getRoute).not.toMatch(/synchronize|browser|provider|write|insert|update/i);
    expect(ANALYST).not.toMatch(/from ['"](?:node:fs|node:path|node:http|\.\/db|\.\/browser|\.\/routes|\.\/property-card)/);
    expect(ANALYST).not.toMatch(/\b(fetch|setTimeout|setInterval|writeFile|readFile|getLandosDb)\s*\(/);
  });
});
