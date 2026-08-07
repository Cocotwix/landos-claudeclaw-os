// STRUCTURAL GUARD: exactly one module may launch or address a browser.
//
// The foreground takeover was never a focus bug. Backgrounding was implemented
// correctly in one place — and then three other modules spawned Chrome directly
// and never ran that code. Fixing them individually would leave the same shape
// behind, so this test asserts the shape instead of the symptom: if a new
// alternate launcher or a bare CDP default appears, it fails here rather than on
// the operator's screen.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(process.cwd(), 'src');
const OWNER = path.join('landos', 'automation-browser.ts');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file),
  text: fs.readFileSync(file, 'utf8'),
}));

const isOwner = (rel: string): boolean => rel === OWNER;

describe('only the automation-browser module may launch Chrome', () => {
  it('no other source file passes --remote-debugging-port', () => {
    const offenders = FILES
      .filter((file) => !isOwner(file.rel) && file.text.includes('--remote-debugging-port'))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('no other source file passes --user-data-dir', () => {
    // A launcher that sets its own profile is a launcher. Throwaway profiles in
    // particular remember no window position, which is exactly how a Chrome
    // ended up centre-screen over the operator's work.
    const offenders = FILES
      .filter((file) => !isOwner(file.rel) && file.text.includes('--user-data-dir'))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('no source file addresses an arbitrary browser endpoint', () => {
  it('never hardcodes the contested 9222 port as a connection target', () => {
    // 9222 is the port every other tool grabs; on the operator's machine
    // msedgewebview2 owns it. Message strings may still mention it.
    const offenders = FILES.filter((file) => {
      if (isOwner(file.rel)) return false;
      // Strip comments: several modules legitimately EXPLAIN why 9222 is
      // refused, and prose about the defect must not read as the defect.
      const code = file.text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      return /(?:browserURL|cdpUrl|endpoint)\s*[:=][^\n]*127\.0\.0\.1:9222/.test(code)
        || /['"`]http:\/\/127\.0\.0\.1:9222['"`]/.test(code)
        || /:\s*9222\b/.test(code);
    }).map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('the owner module refuses port 9222 explicitly', () => {
    const owner = FILES.find((file) => isOwner(file.rel));
    expect(owner?.text).toMatch(/port === 9222/);
  });
});

describe('the owned launch is always offscreen', () => {
  it('the owner module has no onscreen window-position variant', () => {
    const owner = FILES.find((file) => isOwner(file.rel));
    const positions = owner!.text.match(/--window-position=[-\d,]+/g) ?? [];
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.every((flag) => flag === '--window-position=-32000,-32000')).toBe(true);
  });

  it('no source file CALLS a window-activation API during research', () => {
    // Activation is banned outright on research paths: raising an offscreen
    // window still makes Chrome the Windows foreground application and pulls
    // focus out of whatever the operator is typing into.
    //
    // Matches calls (`bringToFront(`), not prose — two modules carry comments
    // stating they deliberately do NOT activate, and those must not trip this.
    // The single permitted call site is the operator explicitly pressing
    // "Open LandPortal" to log in.
    const offenders = FILES
      .filter((file) => /bringToFront\s*[?.]?\.?\s*\(/.test(file.text.replace(/\/\/[^\n]*/g, '')))
      .map((file) => file.rel)
      .filter((rel) => rel !== path.join('landos', 'browser-session.ts'));
    expect(offenders).toEqual([]);
  });
});
