import { execFile } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Duke Visual Evidence Capture v1 — safety-rail tests.
//
// The capture script is a plain ESM Node script (gen-pdf-bg.js style) that
// Duke invokes directly, so it lives outside the TS rootDir. These tests
// drive its check-only CLI modes as a subprocess: no Chrome is launched,
// no network is touched, nothing is written.

const SCRIPT = path.resolve(
  process.cwd(),
  'landos-agents/duke-due-diligence/scripts/capture-visual.js',
);

function runScript(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args], { timeout: 15_000 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
        ? (err as unknown as { code: number }).code
        : err ? 1 : 0;
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

describe('capture-visual allowlist', () => {
  it('allows https .gov and .us public-record hosts', async () => {
    for (const url of [
      'https://msc.fema.gov/portal/search',
      'https://www.usgs.gov/',
      'https://gis.examplecounty.us/parcelviewer?apn=123-456-789',
    ]) {
      const { code, stdout } = await runScript(['--validate-only', url]);
      expect(stdout, url).toBe('ALLOWED');
      expect(code, url).toBe(0);
    }
  });

  it('blocks listing sites and Google properties via the deny list', async () => {
    for (const url of [
      'https://www.zillow.com/homedetails/123',
      'https://www.redfin.com/TX/some-home',
      'https://www.realtor.com/realestateandhomes-detail/x',
      'https://maps.google.com/maps?q=somewhere',
      'https://www.google.com/maps/@30,-97,18z',
    ]) {
      const { code, stdout } = await runScript(['--validate-only', url]);
      expect(stdout, url).toContain('BLOCKED');
      expect(stdout, url).toContain('deny list');
      expect(code, url).toBe(1);
    }
  });

  it('blocks non-https, embedded credentials, unlisted hosts, and junk', async () => {
    const cases: Array<[string, string]> = [
      ['http://gis.examplecounty.us/viewer', 'only https'],
      ['https://user:pass@msc.fema.gov/portal', 'embedded credentials'],
      ['https://example.com/some-page', 'not on the public-records allowlist'],
      ['not-a-url', 'not a valid URL'],
    ];
    for (const [url, expected] of cases) {
      const { code, stdout } = await runScript(['--validate-only', url]);
      expect(stdout, url).toContain('BLOCKED');
      expect(stdout, url).toContain(expected);
      expect(code, url).toBe(1);
    }
  });
});

describe('capture-visual evidence directory', () => {
  it('refuses any output directory inside the repo', async () => {
    for (const dir of [
      process.cwd(),
      path.join(process.cwd(), 'workspace', 'evidence'),
      path.join(process.cwd(), 'store'),
    ]) {
      const { code, stdout } = await runScript(['--resolve-dir', dir]);
      expect(stdout, dir).toContain('REFUSED');
      expect(stdout, dir).toContain('outside the Git-tracked repo');
      expect(code, dir).toBe(1);
    }
  });

  it('defaults to a directory outside the repo', async () => {
    const { code, stdout } = await runScript(['--resolve-dir']);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain('duke-visual-evidence');
    const resolved = path.resolve(stdout);
    expect(resolved.startsWith(path.resolve(process.cwd()) + path.sep)).toBe(false);
  });
});

describe('capture-visual filenames', () => {
  it('sanitizes labels into safe png filenames', async () => {
    const { code, stdout } = await runScript(['--filename-for', '123 Main St / APN 99-88, Test County TX']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^123-main-st-apn-99-88-test-county-tx-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}\.png$/i);
  });

  it('falls back to a generic name for empty labels', async () => {
    const { code, stdout } = await runScript(['--filename-for', '///']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^visual-.*\.png$/);
  });
});

describe('capture-visual full run safety', () => {
  it('refuses a denied URL before launching Chrome or touching the network', async () => {
    const { code, stdout } = await runScript([
      'https://www.zillow.com/homedetails/123',
      'should-never-capture',
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('Visual capture failed');
    expect(stdout).toContain('deny list');
  });
});
