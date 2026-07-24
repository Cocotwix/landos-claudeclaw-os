// Architecture-boundary regression guards for the zoning slice. Source-scan
// style (no jsdom): each wall is enforced by reading the module source and
// asserting on its imports and route-handler bodies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => fs.readFileSync(path.join(here, relative), 'utf8');

const ANALYST = read('./zoning-analyst.ts');
const TYPES = read('./zoning-types.ts');
const OPERATOR = read('./zoning-operator.ts');
const ADAPTERS = read('./zoning-adapters.ts');
const JURISDICTION = read('./zoning-jurisdiction.ts');
const LEGACY = read('./zoning-legacy-adapter.ts');
const ROUTES = read('./routes.ts');

function importsOf(source: string): string[] {
  return [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gms)].map((match) => match[1]);
}

describe('zoning architecture boundaries', () => {
  it('the Analyst imports only the shared type contracts — no browser, route, provider, database, filesystem, or UI modules', () => {
    const imports = importsOf(ANALYST);
    expect(imports).toEqual(['./zoning-types.js']);
    expect(ANALYST).not.toMatch(/\bfetch\s*\(/);
    expect(ANALYST).not.toMatch(/getLandosDb|node:fs|node:path|puppeteer|setTimeout|setInterval|process\.env/);
  });

  it('the type contracts are runtime-import free', () => {
    expect(importsOf(TYPES)).toEqual([]);
  });

  it('the jurisdiction determination engine is dependency-free except type contracts', () => {
    const imports = importsOf(JURISDICTION);
    expect(imports).toEqual(['./zoning-types.js']);
    expect(JURISDICTION).not.toMatch(/\bfetch\s*\(|getLandosDb|node:fs/);
  });

  it('collectors cannot make strategy or valuation decisions', () => {
    for (const [name, source] of [['zoning-operator.ts', OPERATOR], ['zoning-adapters.ts', ADAPTERS], ['zoning-legacy-adapter.ts', LEGACY]] as const) {
      const imports = importsOf(source).join('\n');
      expect(imports, name).not.toMatch(/deal-card-strategy|offer-engine|dual-exit-valuation|comp-valuation|underwriting|acquisition/);
    }
  });

  it('the Operator invokes the Analyst but the Analyst never imports the Operator', () => {
    expect(importsOf(OPERATOR)).toContain('./zoning-analyst.js');
    expect(ANALYST).not.toMatch(/zoning-operator|zoning-adapters|zoning-legacy-adapter/);
  });

  it('the zoning GET routes are SELECT-only and rebuild is an explicit POST command', () => {
    const getRoute = ROUTES.match(
      /app\.get\('\/api\/landos\/deal-cards\/:id\/zoning-land-use',[\s\S]*?\n {2}\}\);/,
    )?.[0];
    expect(getRoute).toBeTruthy();
    expect(getRoute!).toContain('readZoningLandUseForDeal');
    expect(getRoute!).not.toMatch(/synchronize|persistZoning|runTracked|rebuild|INSERT|UPDATE|fetch\(/);
    const postRoute = ROUTES.match(
      /app\.post\('\/api\/landos\/deal-cards\/:id\/zoning-land-use\/rebuild',[\s\S]*?\n {2}\}\);/,
    )?.[0];
    expect(postRoute).toBeTruthy();
    expect(postRoute!).toContain('synchronizeZoningLandUseForDeal');
  });

  it('zoning labels cannot be interpreted without a confirmed jurisdiction and a retrieved ordinance source', () => {
    // The single interpretation gate must require all three conditions.
    expect(ANALYST).toMatch(
      /const interpretationAllowed = jurisdiction\.determination === 'confirmed'\s*&&\s*\(baseZoning\.status === 'officially_confirmed'\)\s*&&\s*ordinance\.status === 'retrieved';/,
    );
    // Use findings are emitted only behind that gate.
    expect(ANALYST).toMatch(/if \(!interpretationAllowed \|\| !ordinanceGrade \|\| claim\.locatorStatus !== 'record_located'\)/);
  });

  it('conditional uses can never be presented as by-right uses', () => {
    // The category switch maps each category to its own list only; the
    // by-right list is populated solely from the permitted_by_right case.
    const byRightPushes = [...ANALYST.matchAll(/usesByRight\.push\(([^)]*)\)/g)];
    expect(byRightPushes).toHaveLength(1);
    expect(byRightPushes[0][1]).toContain('useFinding(claim, category');
    expect(ANALYST).toMatch(/case 'permitted_by_right': usesByRight\.push/);
    expect(ANALYST).not.toMatch(/usesByRight\.push\(useFinding\(claim, 'conditional/);
  });

  it('the identity gate blocks zoning collection for unconfirmed identities', () => {
    expect(OPERATOR).toMatch(/identity\.status === 'confirmed'\s*\?\s*input\s*:/);
    expect(OPERATOR).toContain('Confirmed subject property identity and geometry are required before jurisdiction and zoning research.');
  });

  it('jurisdiction determination never keys on the mailing city, ZIP, or address label', () => {
    // mailingCity appears only for the informational mismatch flag and basis
    // text, never in authority selection.
    const selectionBlock = JURISDICTION.slice(
      JURISDICTION.indexOf('let incorporationStatus'),
      JURISDICTION.indexOf('const mailingCityDiffersFromAuthority'),
    );
    expect(selectionBlock.length).toBeGreaterThan(100);
    expect(selectionBlock).not.toMatch(/mailingCity|zip|postal/i);
  });
});
