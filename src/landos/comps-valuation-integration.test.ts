import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const CAPABILITY_ID = 'COMPS_VALUATION_CAPABILITY_ID';

describe('one Comps & Valuation implementation serves Tools, New Lead and the V2 Deal Card', () => {
  it('routes every surface through the registered Comps & Valuation Capability', () => {
    const registry = read('src/landos/capability-registry.ts');
    expect(registry).toContain(CAPABILITY_ID);
    expect(registry).toContain('COMPS_VALUATION_CAPABILITY');

    const routes = read('src/landos/routes.ts');

    // Tools.
    const toolsRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/comps-valuation/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    expect(toolsRoute).toContain(`capabilityId: ${CAPABILITY_ID}`);
    expect(toolsRoute).toContain("caller: { type: 'tools'");
    expect(toolsRoute).toContain('runToolsPropertyResolution(body)');
    expect(toolsRoute).toContain('resolveSubject: async () => resolution');

    // V2 Deal Card.
    const dealRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/comps-valuation/capability'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    expect(dealRoute).toContain(`capabilityId: ${CAPABILITY_ID}`);
    expect(dealRoute).toContain("caller: { type: 'deal_card'");
    expect(dealRoute).toContain("kind: 'canonical_property'");

    // New Lead: the comparable-collection lane and the valuation lane both
    // execute inside the capability.
    const newLead = routes.slice(
      routes.indexOf('const compsValuationEntity ='),
      routes.indexOf('const propertyIntelligenceCollectors ='),
    );
    expect(newLead).toContain(`capabilityId: ${CAPABILITY_ID}`);
    expect(newLead).toContain("parameters: { lane: 'comp_collection' }");
    expect(newLead).toContain("parameters: { lane: 'mission_valuation' }");
    expect(newLead).toContain("kind: 'canonical_property'");
    expect(newLead).toContain('runCompCollection: async ()');
    expect(newLead).toContain('runMissionValuation: async ()');
  });

  it('leaves no Tools, New Lead or V2 Deal Card caller with its own authoritative comp or valuation execution', () => {
    const routes = read('src/landos/routes.ts');

    // The New Lead comparable collector now runs inside the capability.
    expect(routes).toContain('comparables: (ctx) => throughCompCollection(dealCardId, resolutionCaller, () => live.comparables(ctx))');
    // The New Lead valuation lane is injected with the capability envelope.
    expect(routes).toContain('compsValuation: (input) => throughMissionValuation(dealCardId, resolutionCaller, input)');

    // Exactly one call site for the shared valuation computation outside its
    // own fallbacks, and it is inside the wrapper the capability injects.
    const wrapper = routes.slice(
      routes.indexOf('const throughMissionValuation ='),
      routes.indexOf('const propertyIntelligenceCollectors ='),
    );
    expect(wrapper).toContain('computeMissionCompValuation(input)');

    // The mission holds ONE valuation implementation, and the lane reaches it
    // through the injected capability when one is wired.
    const mission = read('src/landos/deal-intelligence-mission.ts');
    expect(mission).toContain('export function computeMissionCompValuation(');
    expect(mission).toContain('compsValuation?: (input: MissionCompValuationInput) => Promise<MissionCompValuationResult>');
    expect(mission).toContain('capabilities.compsValuation');
    // The selection and valuation implementation appears once, in that function.
    expect((mission.match(/selectWorkingComps\(\{/g) ?? [])).toHaveLength(1);
    expect((mission.match(/valuationFromWorkingSet\(/g) ?? [])).toHaveLength(1);

    // Neither capability route runs a comp search or a valuation of its own.
    const toolsRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/comps-valuation/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    const dealRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/comps-valuation/capability'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    for (const surface of [toolsRoute, dealRoute]) {
      expect(surface).not.toContain('selectWorkingComps(');
      expect(surface).not.toContain('valuationFromWorkingSet(');
      expect(surface).not.toContain('fetchZillowLandComps(');
      expect(surface).not.toContain('fetchRedfinLandComps(');
      expect(surface).not.toContain('computeMissionCompValuation(');
    }
  });

  it('reuses the existing comp-selection and valuation implementation instead of rebuilding it', () => {
    const capability = read('src/landos/comps-valuation-capability.ts');
    // The existing canonical projection is reused, not reimplemented.
    expect(capability).toContain("from './comps-valuation.js'");
    expect(capability).toContain('buildCompsValuationView');
    // The collection lane and the mission valuation are injected executors.
    expect(capability).toContain('runCompCollection?:');
    expect(capability).toContain('runMissionValuation?:');
    // No second comp engine and no second valuation method.
    expect(capability).not.toContain('computeCompsValuation(');
    expect(capability).not.toContain('computeCleanedValuation(');
    expect(capability).not.toContain('computeImprovementValuation(');
    expect(capability).not.toContain('selectWorkingComps(');
    expect(capability).not.toContain('applyCompSourcePolicy(');
    expect(capability).not.toContain('fetchZillowLandComps(');
    // No second resolver and no record creation of any kind.
    expect(capability).toContain('PROPERTY_RESOLUTION_CAPABILITY_ID');
    expect(capability).not.toMatch(/\bupsertPropertyCard\s*\(/);
    expect(capability).not.toMatch(/\bcreateDealCard\s*\(/);
    expect(capability).not.toMatch(/\blinkPropertyToDeal\s*\(/);
    expect(capability).not.toMatch(/\bsetCompValuationSelection\s*\(/);
  });

  it('keeps the accepted acreage rule for the valuation components', () => {
    const capability = read('src/landos/comps-valuation-capability.ts');
    // Land Value / House Value / Whole Property Value only above one acre.
    expect(capability).toContain('acres > 1');
    expect(capability).toContain('one acre or less');
    expect(capability).toContain('House Value');
    expect(capability).not.toContain('Improved Value');

    const cv = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
    expect(cv).toContain('const showValuationSplit = subjectAcres != null && subjectAcres > 1');
    expect(cv).toContain('{showValuationSplit && (');
    expect(cv).toContain('data-testid="cv-no-valuation-split"');
    // The existing naming and the existing overlay behaviour are untouched.
    expect(cv).toContain('House Valuation');
    expect(cv).toContain('+ House Value');
    expect(cv).toContain('= Estimated Whole Property Value');
    expect(cv).not.toMatch(/Improvement Valuation|\+ Improvement Value/);
  });

  it('gives Tools a run control that creates no lead and the V2 Deal Card a rerun control', () => {
    const tools = read('web/src/pages/Tools.tsx');
    expect(tools).toContain('/api/landos/capabilities/comps-valuation/invoke');
    expect(tools).toContain('data-testid="comps-valuation-run"');
    expect(tools).toContain('data-testid="comps-valuation-result"');
    expect(tools).toContain('Nothing here creates a lead or a Deal Card.');
    expect(tools).not.toContain('/api/landos/deal-cards');
    expect(tools).not.toContain('intake');

    // The live Deal Card is Acquisition Workspace V2. The rerun control lives in
    // its own component beside the existing Comps & Valuation section, and it
    // runs against the canonical subject the card already has.
    const control = read('web/src/components/AcquisitionWorkspaceV2CompsValuationRun.tsx');
    expect(control).toContain('data-testid="awv2-comps-valuation-run-button"');
    expect(control).toContain('data-testid="awv2-comps-valuation-run-result"');
    expect(control).toContain('/api/landos/deal-cards/${dealId}/comps-valuation/capability');
    expect(control).toContain('never changes which parcel this card is about');
    const section = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
    expect(section).toContain('<CompsValuationCapabilityRun dealId={dealId} />');
  });
});
