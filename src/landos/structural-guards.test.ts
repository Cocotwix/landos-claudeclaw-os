// Structural guards (repeat-violation prevention):
//   1. The comp-search-area wall — the market-research search-area type must be
//      structurally incapable of flowing into parcel-identity verification.
//   2. No committed test/validation code may shell out to read .env secrets.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(HERE, rel), 'utf-8');

describe('comp-search-area structural wall', () => {
  it('comp-search-area.ts imports NOTHING from the parcel-verification path', () => {
    const src = read('comp-search-area.ts');
    expect(src).not.toMatch(/from '\.\/landportal-client/);
    expect(src).not.toMatch(/from '\.\/duke-verification-bridge/);
    expect(src).not.toMatch(/from '\.\/duke-preflight/);
    expect(src).not.toMatch(/from '\.\/resolver-planner/);
  });

  it('the verification path does NOT import the comp-search-area module', () => {
    for (const f of ['landportal-client.ts', 'duke-verification-bridge.ts', 'duke-preflight.ts', 'resolver-planner.ts']) {
      expect(read(f), `${f} must not import comp-search-area`).not.toMatch(/comp-search-area/);
    }
  });

  it('CompSearchArea declares no parcel-identity FIELDS (locality + origin only)', () => {
    const src = read('comp-search-area.ts');
    // No identity field declarations (e.g. "apn:", "owner?:", "fips:", "lat:").
    const identityField = /^\s*(readonly\s+)?(apn|owner|fips|propertyId|property_id|latitude|longitude|lat|lng)\s*\??\s*:/im;
    expect(identityField.test(src)).toBe(false);
  });
});

describe('no shell-based .env secret extraction in committed test/validation code', () => {
  it('no test file shells out to grep/cut/cat/echo .env', () => {
    // Exclude this guard file itself (it necessarily contains the banned pattern
    // as a detection regex).
    const files = fs.readdirSync(HERE).filter((f) => f.endsWith('.test.ts') && f !== 'structural-guards.test.ts');
    // A shell read tool combined with a .env reference is the banned pattern.
    const banned = /\b(grep|cut|cat|awk|sed|echo|type|findstr|Get-Content)\b[^\n]*\.env\b|\.env\b[^\n]*\|\s*(grep|cut|awk|sed)/i;
    for (const f of files) {
      const src = fs.readFileSync(path.join(HERE, f), 'utf-8');
      expect(banned.test(src), `${f} appears to shell-read .env`).toBe(false);
    }
  });
});
