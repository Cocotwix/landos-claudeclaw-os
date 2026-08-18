import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const CAPABILITY_ID = 'LANDPORTAL_RESEARCH_CAPABILITY_ID';

describe('one LandPortal Research implementation serves Tools, New Lead and the V2 Deal Card', () => {
  it('routes every surface through the registered LandPortal Research Capability', () => {
    const registry = read('src/landos/capability-registry.ts');
    expect(registry).toContain(CAPABILITY_ID);
    expect(registry).toContain('LANDPORTAL_RESEARCH_CAPABILITY');

    const routes = read('src/landos/routes.ts');

    // Tools.
    const toolsRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/landportal-research/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    expect(toolsRoute).toContain(`capabilityId: ${CAPABILITY_ID}`);
    expect(toolsRoute).toContain("caller: { type: 'tools'");
    expect(toolsRoute).toContain('runToolsPropertyResolution(body)');
    expect(toolsRoute).toContain('resolveSubject: async () => resolution');

    // V2 Deal Card.
    const dealRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/landportal-research'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    expect(dealRoute).toContain(`capabilityId: ${CAPABILITY_ID}`);
    expect(dealRoute).toContain("caller: { type: 'deal_card'");
    expect(dealRoute).toContain("kind: 'canonical_property'");

    // New Lead: both LandPortal lanes execute inside the capability.
    const newLead = routes.slice(
      routes.indexOf('const landPortalResearchEntity ='),
      routes.indexOf('const propertyIntelligenceCollectors ='),
    );
    expect(newLead).toContain(`capabilityId: ${CAPABILITY_ID}`);
    expect(newLead).toContain("parameters: { lane: 'parcel_inspection' }");
    expect(newLead).toContain("parameters: { lane: 'agentic_specialists'");
    expect(newLead).toContain("kind: 'canonical_property'");
    expect(newLead).toContain('runParcelInspection: async ()');
    expect(newLead).toContain('runAgenticSpecialists: async ()');
  });

  it('leaves no Tools, New Lead or V2 Deal Card caller with its own authoritative LandPortal execution', () => {
    const routes = read('src/landos/routes.ts');

    // The New Lead collector deps no longer reach the executors directly.
    expect(routes).toContain('captureHermesLandPortal: (input) => throughLandPortalAgenticSpecialists(');
    expect(routes).toMatch(/captureLandPortalInspection: async \(\{ cardId, searchKey, onSubjectReady \}\) =>\s+throughLandPortalParcelInspection\(/);
    expect(routes).not.toContain('captureHermesLandPortal: (input) => runHermesLandPortalLane(input)');

    // Exactly one call site each for the two underlying executors, and both are
    // inside the capability runtime the wrapper injects.
    const hermesCalls = routes.match(/runHermesLandPortalLane\(input\)/g) ?? [];
    expect(hermesCalls).toHaveLength(1);
    const wrapper = routes.slice(
      routes.indexOf('const throughLandPortalAgenticSpecialists ='),
      routes.indexOf('const propertyIntelligenceCollectors ='),
    );
    expect(wrapper).toContain('runHermesLandPortalLane(input)');

    // Neither capability route opens a LandPortal browser or lookup of its own.
    const toolsRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/landportal-research/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    const dealRoute = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/landportal-research'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    for (const surface of [toolsRoute, dealRoute]) {
      expect(surface).not.toContain('lpResolveForPreflight(');
      expect(surface).not.toContain('runPropertyInspection(');
      expect(surface).not.toContain('runHermesLandPortalLane(');
      expect(surface).not.toContain('makeLandPortalBrowser(');
    }
  });

  it('reuses the existing LandPortal and Hermes implementation instead of rebuilding it', () => {
    const capability = read('src/landos/landportal-research-capability.ts');
    // The existing deterministic property read and the existing retained
    // evidence store are reused, not reimplemented.
    expect(capability).toContain("from './landportal-client.js'");
    expect(capability).toContain('lpResolveForPreflight');
    expect(capability).toContain('loadPropertyInspection');
    expect(capability).toContain('decodeLandPortalCanonicalIdentity');
    // The browser and Hermes executors are injected, never re-created here.
    expect(capability).toContain('runParcelInspection?:');
    expect(capability).toContain('runAgenticSpecialists?:');
    expect(capability).not.toContain('runPropertyInspection(');
    expect(capability).not.toContain('runHermesLandPortalLane(');
    expect(capability).not.toContain('makeLandPortalBrowser(');
    expect(capability).not.toContain('makeLiveBrowserDriver(');
    // No second resolver and no record creation of any kind.
    expect(capability).toContain('PROPERTY_RESOLUTION_CAPABILITY_ID');
    expect(capability).not.toMatch(/\bupsertPropertyCard\s*\(/);
    expect(capability).not.toMatch(/\bcreateDealCard\s*\(/);
    expect(capability).not.toMatch(/\blinkPropertyToDeal\s*\(/);
  });

  it('gives Tools a run control that creates no lead and the V2 Deal Card a rerun control', () => {
    const tools = read('web/src/pages/Tools.tsx');
    expect(tools).toContain('/api/landos/capabilities/landportal-research/invoke');
    expect(tools).toContain('data-testid="landportal-research-run"');
    expect(tools).toContain('data-testid="landportal-research-result"');
    expect(tools).toContain('Nothing here creates a lead or a Deal Card.');
    expect(tools).not.toContain('/api/landos/deal-cards');
    expect(tools).not.toContain('intake');

    // The live Deal Card is Acquisition Workspace V2. The run control lives in
    // its own component so the workspace page, the Property Intelligence
    // section and the Overview section stay free of mutation calls and section
    // switching can never trigger research.
    const control = read('web/src/components/AcquisitionWorkspaceV2LandPortalResearch.tsx');
    expect(control).toContain('data-testid="awv2-landportal-research-run"');
    expect(control).toContain('data-testid="awv2-landportal-research-result"');
    expect(control).toContain('/api/landos/deal-cards/${dealId}/landportal-research');
    const workspace = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');
    expect(workspace).toContain('<LandPortalResearchRun dealId={dealId} />');
    expect(workspace).not.toMatch(/apiPost|apiPut|apiDelete/);
  });
});
