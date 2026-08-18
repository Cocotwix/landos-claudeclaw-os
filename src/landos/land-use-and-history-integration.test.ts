import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const ZONING = 'ZONING_SUBDIVISION_CAPABILITY_ID';
const HISTORY = 'PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID';

describe('two capabilities, one implementation each, reached by Tools, New Lead and the V2 Deal Card', () => {
  it('registers Zoning & Subdivision and Property Development History as separate capabilities', () => {
    const registry = read('src/landos/capability-registry.ts');
    expect(registry).toContain(ZONING);
    expect(registry).toContain(HISTORY);
    expect(registry).toContain('ZONING_SUBDIVISION_CAPABILITY as unknown');
    expect(registry).toContain('PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY as unknown');

    // They are separate modules with separate business truth. Neither imports
    // the other, which is what keeps a jurisdiction rule package and a parcel's
    // planning history from becoming one record.
    const zoning = read('src/landos/zoning-subdivision-capability.ts');
    const history = read('src/landos/property-development-history-capability.ts');
    expect(zoning).not.toContain("from './property-development-history-capability.js'");
    expect(history).not.toContain("from './zoning-subdivision-capability.js'");
  });

  it('routes Tools through Property Resolution and then each capability, creating no lead', () => {
    const routes = read('src/landos/routes.ts');

    const zoningTool = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/zoning-subdivision/invoke'"),
      routes.indexOf("app.post('/api/landos/capabilities/property-development-history/invoke'"),
    );
    expect(zoningTool).toContain(`capabilityId: ${ZONING}`);
    expect(zoningTool).toContain("caller: { type: 'tools'");
    expect(zoningTool).toContain('runToolsPropertyResolution(body)');
    expect(zoningTool).toContain('resolveSubject: async () => resolution');

    const historyTool = routes.slice(
      routes.indexOf("app.post('/api/landos/capabilities/property-development-history/invoke'"),
      routes.indexOf("app.post('/api/landos/property/resolve'"),
    );
    expect(historyTool).toContain(`capabilityId: ${HISTORY}`);
    expect(historyTool).toContain("caller: { type: 'tools'");
    expect(historyTool).toContain('runToolsPropertyResolution(body)');
    expect(historyTool).toContain('resolveSubject: async () => resolution');

    // Neither Tools path creates a Deal Card, a Property Card or a CRM lead.
    for (const route of [zoningTool, historyTool]) {
      expect(route).not.toContain('createDealCard');
      expect(route).not.toContain('upsertPropertyCard');
      expect(route).not.toContain('createLead');
    }
  });

  it('lets the V2 Deal Card run and rerun both against the canonical subject it already has', () => {
    const routes = read('src/landos/routes.ts');

    const zoningCard = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/zoning-subdivision/capability'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-development-history/capability'"),
    );
    expect(zoningCard).toContain(`capabilityId: ${ZONING}`);
    expect(zoningCard).toContain("caller: { type: 'deal_card'");
    expect(zoningCard).toContain("kind: 'canonical_property'");
    expect(zoningCard).toContain('runLandUseResearch: landUseResearchLane');

    const historyCard = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/property-development-history/capability'"),
      routes.indexOf("app.get('/api/landos/deal-cards/:id/property-intelligence/progress'"),
    );
    expect(historyCard).toContain(`capabilityId: ${HISTORY}`);
    expect(historyCard).toContain("caller: { type: 'deal_card'");
    expect(historyCard).toContain("kind: 'canonical_property'");
    expect(historyCard).toContain('runHistorySearch: propertyHistoryLane');

    // The subject is the card's EXISTING canonical property; neither route
    // resolves, replaces or reassigns identity.
    for (const route of [zoningCard, historyCard]) {
      expect(route).toContain('dealCardAssessorTaxSubject(id)');
      expect(route).toContain('propertyCardId: subject.cardId');
      expect(route).not.toContain('runToolsPropertyResolution');
    }

    // Both are readable without running, so the card shows the last result.
    expect(routes).toContain("app.get('/api/landos/deal-cards/:id/zoning-subdivision/capability'");
    expect(routes).toContain("app.get('/api/landos/deal-cards/:id/property-development-history/capability'");
  });

  it('runs the New Lead land-use and history lanes inside the capabilities', () => {
    const routes = read('src/landos/routes.ts');
    const newLead = routes.slice(
      routes.indexOf('const throughLandUseCapabilities ='),
      routes.indexOf('const propertyIntelligenceCollectors ='),
    );
    expect(newLead).toContain(`capabilityId: ${ZONING}`);
    expect(newLead).toContain(`capabilityId: ${HISTORY}`);
    expect(newLead).toContain("kind: 'canonical_property'");
    expect(newLead).toContain('runLandUseResearch: async ()');
    expect(newLead).toContain('runHistorySearch: async ()');
    expect(newLead).toContain("parameters: { lane: 'research', runId }");
    expect(newLead).toContain("'authority_and_zoning',");
    expect(newLead).toContain("'subdivision_rules',");

    // The fanout itself is wired through the wrapper, so the mission's own
    // lanes cannot run outside the capability envelope.
    expect(routes).toContain('...throughLandUseCapabilities(dealCardId, resolutionCaller, livePostResolutionCapabilities())');
  });

  it('leaves no active caller with its own authoritative land-use or history execution', () => {
    const routes = read('src/landos/routes.ts');

    // Exactly one call site each for the underlying research entry points, and
    // both are inside the lane functions the capabilities inject.
    expect(routes.split('runLandUseResearch({').length - 1).toBe(1);
    expect(routes.split('runPropertyBackstoryForDeal(').length - 1).toBe(1);

    // The compatibility land-use URL now executes inside the capability.
    const compat = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/land-use/run'"),
      routes.indexOf("app.get('/api/landos/gis-platforms'"),
    );
    expect(compat).toContain(`capabilityId: ${ZONING}`);
    expect(compat).toContain("parameters: { lane: 'research' }");
    expect(compat).toContain('runLandUseResearch: async (input)');

    // The Property Backstory lane has one live wiring, and the New Lead
    // capability delegates to it rather than holding a second copy.
    const post = read('src/landos/post-resolution-capabilities.ts');
    expect(post.split('runPropertyBackstory(').length - 1).toBe(1);
    expect(post).toContain('export async function runPropertyBackstoryForDeal');
    expect(post).toContain('runPropertyBackstoryForDeal(dealCardId, {');
  });

  it('keeps opportunistic context capture in Property Resolution and off its release gate', () => {
    const resolver = read('src/landos/universal-property-resolution.ts');
    // The resolver mines and retains material context from documents it had to
    // download anyway. That is the capture invariant, in the accepted code.
    expect(resolver).toContain('mineDocumentContext(');
    expect(resolver).toContain('retainDiscoveredContext(');

    // And that capture may never participate in identity: the miner's own
    // contract says so, and the module states the separation.
    const context = read('src/landos/official-document-context.ts');
    expect(context).toContain('may NEVER change subject identity');
    expect(context).toContain('IdentityEvidence   may participate in subject resolution.');

    // The history capability consumes exactly that retained context, and it
    // does so before any search.
    const history = read('src/landos/property-development-history-capability.ts');
    expect(history).toContain('consumedBeforeSearch: true');
    expect(history).toContain('readDocumentIntelligence');
    expect(history.indexOf('1. Everything LandOS already discovered, consumed FIRST'))
      .toBeLessThan(history.indexOf('2. Only then, a bounded targeted search'));
  });

  it('surfaces both capabilities on the V2 Deal Card with clickable official sources', () => {
    const section = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');
    expect(section).toContain('<ZoningSubdivisionCapabilityRun dealId={dealId} />');
    expect(section).toContain('<PropertyDevelopmentHistoryPanel dealId={dealId} />');

    const zoningPanel = read('web/src/components/AcquisitionWorkspaceV2ZoningSubdivision.tsx');
    expect(zoningPanel).toContain('/zoning-subdivision/capability');
    // The by-right STATUS leads; a lot count never renders without it.
    expect(zoningPanel).toContain('Subdivision by right: {byRight.statusLabel');
    expect(zoningPanel).toContain('href={rule.sourceUrl}');
    expect(zoningPanel).toContain('href={source.url}');

    const historyPanel = read('web/src/components/AcquisitionWorkspaceV2PropertyDevelopmentHistory.tsx');
    expect(historyPanel).toContain('/property-development-history/capability');
    expect(historyPanel).toContain('No material prior development or entitlement history was established');
    expect(historyPanel).toContain('Final entitlement status:');
    expect(historyPanel).toContain('Applicant / developer:');
    expect(historyPanel).toContain('this does not change the');
    expect(historyPanel).toContain('href={event.sourceUrl}');
  });

  it('exposes both capabilities in the Tools area', () => {
    const tools = read('web/src/pages/Tools.tsx');
    expect(tools).toContain("'/api/landos/capabilities/zoning-subdivision/invoke'");
    expect(tools).toContain("'/api/landos/capabilities/property-development-history/invoke'");
    expect(tools).toContain('data-testid="zoning-subdivision-run"');
    expect(tools).toContain('data-testid="property-development-history-run"');
    expect(tools).toContain('Nothing here creates a lead or a Deal Card.');
    // Official sources stay one click away from the Tools result.
    expect(tools).toContain('data-testid="zoning-subdivision-sources"');
    expect(tools).toContain('data-testid="property-history-sources"');
    expect(tools).toContain('data-testid="property-history-related-parties"');
  });
});
