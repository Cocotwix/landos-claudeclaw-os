import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('one Assessor & Tax implementation serves Tools, New Lead and the Deal Card', () => {
  it('routes every surface through the registered Assessor & Tax Capability', () => {
    const registry = read('src/landos/capability-registry.ts');
    expect(registry).toContain('ASSESSOR_TAX_CAPABILITY_ID');
    expect(registry).toContain('ASSESSOR_TAX_CAPABILITY');

    const routes = read('src/landos/routes.ts');
    const live = read('src/landos/property-intelligence-live.ts');

    // Tools.
    const toolsRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/assessor-tax/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    expect(toolsRoute).toContain('capabilityId: ASSESSOR_TAX_CAPABILITY_ID');
    expect(toolsRoute).toContain("caller: { type: 'tools'");
    expect(toolsRoute).toContain('runToolsPropertyResolution(body)');
    expect(toolsRoute).toContain('resolveSubject: async () => resolution');

    // Deal Card.
    const dealRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/assessor-tax'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    expect(dealRoute).toContain('capabilityId: ASSESSOR_TAX_CAPABILITY_ID');
    expect(dealRoute).toContain("caller: { type: 'deal_card'");
    expect(dealRoute).toContain("kind: 'canonical_property'");

    // New Lead, through the Deal Intelligence government-records collector.
    const collector = live.slice(
      live.indexOf('async function assessorTaxRecordsForDeal'),
      live.indexOf('export async function collectGovernmentRecords'),
    );
    expect(collector).toContain('capabilityId: ASSESSOR_TAX_CAPABILITY_ID');
    expect(collector).toContain("kind: 'canonical_property'");
    expect(collector).toContain('assessorTaxSnapshotFacts(result)');
  });

  it('leaves no caller with its own authoritative assessor read', () => {
    const live = read('src/landos/property-intelligence-live.ts');
    const routes = read('src/landos/routes.ts');

    // Government records no longer builds assessor/tax facts itself.
    expect(live).not.toContain('countyRecordFactsFromPublicRun');
    expect(live).not.toContain('governmentFactsFromPublicRecordOutcomes');
    expect(live).not.toContain('listPublicRecordOutcomes');

    const government = live.slice(
      live.indexOf('export async function collectGovernmentRecords'),
      live.indexOf('// ── Zoning and land use'),
    );
    expect(government).toContain('assessorTax.facts');
    expect(government).not.toContain('lookupOfficialParcel(');

    // No Tools or Deal Card assessor route reaches the parcel adapters directly.
    const toolsRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/assessor-tax/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    const dealRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/assessor-tax'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    for (const surface of [toolsRoute, dealRoute]) {
      expect(surface).not.toContain('lookupOfficialParcel(');
      expect(surface).not.toContain('makeLivePublicIntelligenceAdapters(');
      expect(surface).not.toContain('buildTaxStatusRead(');
    }
  });

  it('reuses the existing official parcel and county-records implementation', () => {
    const capability = read('src/landos/assessor-tax-capability.ts');
    // The parcel adapters and the county_records adapter are reused, not rebuilt.
    expect(capability).toContain("from './public-property-intelligence-live.js'");
    expect(capability).toContain('lookupOfficialParcel');
    expect(capability).toContain('makeLivePublicIntelligenceAdapters');
    expect(capability).toContain("candidate.task === 'county_records'");
    // The retained reads and the tax-standing rule are the existing ones too.
    expect(capability).toContain('countyRecordFactsFromPublicRun');
    expect(capability).toContain('governmentFactsFromPublicRecordOutcomes');
    expect(capability).toContain('buildTaxStatusRead');
    expect(capability).toContain('taxAuthorityFor');
    // No second resolver and no second parcel matcher.
    expect(capability).not.toContain('resolveSubjectProperty(');
    expect(capability).not.toContain('reconcileSubjectIdentity(');
    expect(capability).not.toMatch(/\bupsertPropertyCard\s*\(/);
    expect(capability).not.toMatch(/\bcreateDealCard\s*\(/);
    expect(capability).not.toMatch(/\blinkPropertyToDeal\s*\(/);
  });

  it('gives Tools a run control that creates no lead and the Deal Card a rerun control', () => {
    const tools = read('web/src/pages/Tools.tsx');
    expect(tools).toContain('/api/landos/capabilities/assessor-tax/invoke');
    expect(tools).toContain('data-testid="assessor-tax-run"');
    expect(tools).toContain('data-testid="assessor-tax-result"');
    expect(tools).toContain('Nothing here creates a lead or a Deal Card.');
    expect(tools).not.toContain('/api/landos/deal-cards');
    expect(tools).not.toContain('intake');

    // The live Deal Card is Acquisition Workspace V2.
    const workspace = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');
    expect(workspace).toContain('data-testid="awv2-assessor-tax-run"');
    expect(workspace).toContain('data-testid="awv2-assessor-tax-result"');
    expect(workspace).toContain('/api/landos/deal-cards/${dealId}/assessor-tax');
    expect(workspace).toContain('<AssessorTaxRun dealId={dealId} />');

    // The hidden legacy Deal Card reaches the same capability route.
    const panel = read('web/src/components/PropertyIntelligencePanel.tsx');
    expect(panel).toContain('data-testid="assessor-tax-rerun"');
    expect(panel).toContain('/assessor-tax`');
    expect(panel).toContain('snapshot.dealCardId');
  });
});
