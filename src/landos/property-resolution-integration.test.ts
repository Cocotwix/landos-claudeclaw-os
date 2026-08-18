import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('one Property Resolution implementation serves every caller', () => {
  it('keeps Universal Property Resolution callable only behind the registered Capability', () => {
    const directory = path.join(process.cwd(), 'src/landos');
    const directCallers = fs.readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => name !== 'universal-property-resolution.ts')
      .filter((name) => /\bresolveSubjectProperty\s*\(/.test(fs.readFileSync(path.join(directory, name), 'utf8')));
    expect(directCallers).toEqual(['property-resolution-capability.ts']);

    const routes = read('src/landos/routes.ts');
    const dealRun = read('src/landos/deal-intelligence-run.ts');
    expect(routes).not.toMatch(/\bresolveProperty\s*\(/);
    expect(routes).not.toContain('runParallelParcelResolution(');
    expect(routes).not.toContain('applyParallelResolution(');
    expect(routes).not.toContain('resolveParcelParallel(');
    expect(routes).not.toContain('promoteConfirmedIntakeResolution');
    expect(routes).not.toContain('persistParcelIdentityFromResolution');
    expect(routes).not.toContain('resolveParcelIdentityResult');
    expect(dealRun).not.toContain('reconcileSubjectIdentity(');
    expect(routes).toContain("caller: { type: 'tools'");
    expect(routes).toContain("dealIntelligenceCapabilities(deal.id, 'new_lead', 'reuse')");
    expect(routes).toContain("propertyIntelligenceCollectors(id, 'deal_card', 'refresh')");
  });

  it('makes the capability result the root fanout gate', () => {
    const live = read('src/landos/property-intelligence-live.ts');
    const mission = read('src/landos/deal-intelligence-mission.ts');
    const routes = read('src/landos/routes.ts');
    expect(live).toContain('invokeRuntimeCapability({');
    expect(live).toContain("capabilityResult.subjectResolution !== 'RESOLVED'");
    expect(mission).toContain("data.capabilityResolution !== 'RESOLVED'");
    expect(mission).toContain("id: 'capability_subject_resolved'");
    expect(live).toContain('beforeResolve: promoteSubjectIdentity');
    expect(live).toContain('enrichAfterRelease: false');
    expect(live).toContain('runPublicIntelligenceAfterResolution');
    const collectors = routes.slice(routes.indexOf('const propertyIntelligenceCollectors'), routes.indexOf('captureExactAddressWeb:'));
    expect(collectors.slice(0, collectors.indexOf('runPublicIntelligenceAfterResolution'))).not.toContain('runPublicIntelligenceForDealCard(id)');
    expect(live).not.toContain("promoteSubjectIdentity(ctx.dealCardId, 'landportal-late-capture')");
    expect(live).not.toContain("promoteSubjectIdentity(ctx.dealCardId, 'landportal-subject-upgrade')");
    expect(live).not.toMatch(/\bstartHermesWhenUsable\s*\(/);
    const fullRerun = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/property-intelligence/run'"),
      routes.indexOf('// ── Native mission graph'),
    );
    expect(fullRerun).not.toContain('reconcileSubjectIdentity(');

    const rootFactory = live.slice(live.indexOf('parcel_identity: (ctx)'), live.indexOf('government_records: async (ctx)'));
    expect(rootFactory).not.toContain('exactAddressFor(ctx)');
  });

  it('exposes one Tools catalog route and one Deal Card inspect/refresh control', () => {
    const app = read('web/src/App.tsx');
    const routes = read('web/src/lib/routes.ts');
    const tools = read('web/src/pages/Tools.tsx');
    const deal = read('web/src/components/AcquisitionWorkspaceV2RunStatus.tsx');
    expect(routes.match(/label: 'Tools'/g)).toHaveLength(1);
    expect(app).toContain('<Route path="/tools"><Tools /></Route>');
    expect(tools).toContain('/api/landos/capabilities/property-resolution/invoke');
    expect(tools).toContain('without creating a lead');
    expect(deal).toContain('/property-resolution/run');
    expect(deal).toContain('deal-card-property-resolution-refresh');
  });

  it('keeps the legacy parallel-resolve URL as a normalized capability adapter only', () => {
    const routes = read('src/landos/routes.ts');
    const block = routes.slice(
      routes.indexOf("app.post('/api/landos/deal-cards/:id/parallel-resolve'"),
      routes.indexOf('// Parcel overlay evidence maps'),
    );
    expect(block).toContain("propertyIntelligenceCollectors(id, 'deal_card', 'refresh').parcel_identity");
    expect(block).toContain('latestForProperty(cardId, id)');
    expect(block).not.toMatch(/writeParcelIdentity|upsertCardFromDukeRun|attachCardSourceEvidence|resolveParcelParallel/);
  });

  it('keeps Smart Intake promotion inside the capability-owned raw-target transition', () => {
    const routes = read('src/landos/routes.ts');
    const block = routes.slice(
      routes.indexOf('const beginIntakeCandidateResolution'),
      routes.indexOf("app.post('/api/landos/deal-cards/:id/intake'"),
    );
    expect(block).toContain('invokeRuntimeCapability({');
    expect(block).toContain("caller: { type: 'new_lead'");
    expect(block).not.toMatch(/upsertCardFromDukeRun|writeParcelIdentity|persistParcelIdentityFromResolution/);
  });

  it('keeps active Tools compatibility and Deal Card scoring behind the same capability', () => {
    const routes = read('src/landos/routes.ts');
    const duke = routes.slice(routes.indexOf("app.post('/api/landos/intake/duke-verification'"), routes.indexOf("app.post('/api/landos/deal-cards/from-verification'"));
    const analysis = routes.slice(routes.indexOf("app.post('/api/landos/property-analysis'"), routes.indexOf('// â”€â”€ Smart Address Search'));
    const landScore = routes.slice(routes.indexOf("app.get('/api/landos/deal-cards/:id/land-score'"), routes.indexOf('// On-demand SUPPORTING imagery'));
    expect(duke).toContain('runToolsPropertyResolution({');
    expect(analysis).toContain('runToolsPropertyResolution({');
    expect(landScore).toContain('invokeRuntimeCapability({');
    expect(landScore).toContain("caller: { type: 'deal_card'");
    expect(`${duke}${analysis}${landScore}`).not.toMatch(/resolveParcelIdentityResult|runPropertyAnalysis\(/);
  });
});
