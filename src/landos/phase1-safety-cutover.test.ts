import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Phase 1 LandPortal network cutover', () => {
  it('has no LandPortal API resolver in structured runtime selection', () => {
    const capability = read('src/landos/parcel-capability.ts');
    const registry = read('src/landos/providers/data-registry.ts');
    expect(capability).not.toMatch(/lpResolveForPreflight|landPortalConfigured|case 'landportal'/);
    expect(registry).not.toMatch(/makeLandPortalParcelAdapter|lpResolveForPreflight|\['landportal'/);
    expect(registry).toContain("parcel: 'realie'");
  });

  it('does not register the LandPortal MCP for the legacy agent id', () => {
    const settings = JSON.parse(read('landos-agents/duke-due-diligence/.claude/settings.json'));
    expect(settings.mcpServers).toEqual({});
    const yaml = read('landos-agents/duke-due-diligence/agent.yaml');
    expect(yaml).not.toMatch(/mcp:landportal|mcp_servers:[\s\S]*landportal/i);
  });
});

describe('Phase 1 functional display labels', () => {
  it('removes mascot display names from audited operator surfaces', () => {
    const surfaces = [
      read('src/landos/departments.ts'),
      read('src/landos/department-registry.ts'),
      read('web/src/components/IntakePlanner.tsx'),
      read('landos-agents/duke-due-diligence/agent.yaml'),
      read('landos-agents/acquisition-copilot/agent.yaml'),
    ].join('\n');
    expect(surfaces).not.toMatch(/name: ['"]?(Duke|Ace|Finn|Mara|Mia|Drew|Rex|Web|Tutor)\b/);
    expect(surfaces).toMatch(/Due Diligence Agent/);
    expect(surfaces).toMatch(/Acquisitions Agent/);
  });
});
