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
    expect(routes).not.toMatch(/\bresolveProperty\s*\(/);
    expect(routes).toContain("caller: { type: 'tools'");
    expect(routes).toContain("dealIntelligenceCapabilities(deal.id, 'new_lead', 'reuse')");
    expect(routes).toContain("propertyIntelligenceCollectors(id, 'deal_card', 'refresh')");
  });

  it('makes the capability result the root fanout gate', () => {
    const live = read('src/landos/property-intelligence-live.ts');
    const mission = read('src/landos/deal-intelligence-mission.ts');
    expect(live).toContain('invokeRuntimeCapability({');
    expect(live).toContain("capabilityResult.subjectResolution !== 'RESOLVED'");
    expect(mission).toContain("data.capabilityResolution !== 'RESOLVED'");
    expect(mission).toContain("id: 'capability_subject_resolved'");

    const rootFactory = live.slice(live.indexOf('parcel_identity: (ctx)'), live.indexOf('government_records: (ctx)'));
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
});
