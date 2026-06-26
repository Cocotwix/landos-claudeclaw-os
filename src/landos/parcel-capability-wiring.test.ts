import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Architecture guard: the LIVE Due Diligence path must request the parcel-identity
// CAPABILITY and must NOT import the LandPortal vendor resolver directly. This
// test fails loudly if a future change reintroduces direct-vendor coupling.

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', 'landos', rel), 'utf-8');

describe('live DD path is vendor-agnostic (capability router, not direct LandPortal)', () => {
  it('duke-preflight imports the capability and NOT the LandPortal client', () => {
    const src = read('duke-preflight.ts');
    expect(src).toMatch(/from '\.\/parcel-capability\.js'/);
    expect(src).toMatch(/resolveParcelIdentity/);
    expect(src).not.toMatch(/lpResolveForPreflight/);
    expect(src).not.toMatch(/from '\.\/landportal-client\.js'/);
  });

  it('no live DD file imports the LandPortal resolver function directly', () => {
    for (const f of ['duke-preflight.ts', 'property-analysis.ts', 'routes.ts']) {
      expect(read(f), `${f} must not call lpResolveForPreflight`).not.toMatch(/lpResolveForPreflight/);
    }
  });

  it('the capability router IS the single encapsulation boundary for the vendor', () => {
    const cap = read('parcel-capability.ts');
    // The boundary is allowed (and expected) to import the vendor client.
    expect(cap).toMatch(/from '\.\/landportal-client\.js'/);
    expect(cap).toMatch(/makeRealieParcelAdapter/);
    expect(cap).toMatch(/county_records_browser/);
  });
});
