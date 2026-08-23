// Artifact download headers must survive a non-ASCII display name.
//
// HTTP header values are ByteStrings. An artifact whose display name carried a
// single em dash — which an ordinance title or a captured map name routinely
// does — threw while the response was being built, and the operator got a 500
// for a file sitting on disk perfectly intact. Both artifact routes had it.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = fs.readFileSync(path.join(process.cwd(), 'src/landos/routes.ts'), 'utf8');

/** The sanitiser the routes apply, restated so its behaviour is pinned. */
function asciiFilename(displayName: string): string {
  return displayName.replace(/"/g, '').replace(/[^\x20-\x7E]/g, '_');
}

describe('artifact Content-Disposition', () => {
  it('every artifact route builds an ASCII fallback filename', () => {
    // Both the zoning and government-record artifact routes carry this.
    const sanitised = ROUTES.match(/const asciiName = artifact\.displayName/g) ?? [];
    expect(sanitised.length).toBeGreaterThanOrEqual(2);
    // And none of them interpolates the raw display name into the header.
    expect(ROUTES).not.toMatch(/filename="\$\{artifact\.displayName\.replace\(\/"\/g, ''\)\}"/);
  });

  it('carries the real name in filename* so nothing is lost', () => {
    expect(ROUTES).toMatch(/filename\*=UTF-8''\$\{encodeURIComponent\(artifact\.displayName\)\}/);
  });

  it('strips the character that actually broke it', () => {
    const name = 'Fairview Character District map — subject parcel.png';
    const ascii = asciiFilename(name);
    // 8212 is the em dash — the exact code point the runtime rejected.
    expect([...name].some((character) => character.codePointAt(0) === 8212)).toBe(true);
    expect(ascii).toBe('Fairview Character District map _ subject parcel.png');
    for (const character of ascii) {
      expect(character.codePointAt(0)!).toBeLessThanOrEqual(255);
    }
  });

  it('leaves an ordinary ASCII name alone apart from quotes', () => {
    expect(asciiFilename('Zoning Map 2026.pdf')).toBe('Zoning Map 2026.pdf');
    expect(asciiFilename('a "quoted" name.pdf')).toBe('a quoted name.pdf');
  });
});
