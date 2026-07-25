import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { checkPendingMigrations, compareSemver } from './migrations.js';

// ── compareSemver ────────────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('v1.0.0', 'v1.0.0')).toBe(0);
  });

  it('patch increment: older < newer', () => {
    expect(compareSemver('v1.0.0', 'v1.0.1')).toBeLessThan(0);
    expect(compareSemver('v1.0.1', 'v1.0.0')).toBeGreaterThan(0);
  });

  it('minor increment dominates patch', () => {
    expect(compareSemver('v1.0.9', 'v1.1.0')).toBeLessThan(0);
  });

  it('major increment dominates minor and patch', () => {
    expect(compareSemver('v1.9.9', 'v2.0.0')).toBeLessThan(0);
  });

  it('sorts a mixed array into ascending order', () => {
    const versions = ['v1.1.0', 'v1.0.0', 'v2.0.0', 'v1.0.1'];
    expect([...versions].sort(compareSemver)).toEqual([
      'v1.0.0',
      'v1.0.1',
      'v1.1.0',
      'v2.0.0',
    ]);
  });

  it('works without v prefix', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('throws on invalid version string', () => {
    expect(() => compareSemver('notaversion', 'v1.0.0')).toThrow('Invalid semver');
    expect(() => compareSemver('v1.0.0', 'notaversion')).toThrow('Invalid semver');
  });
});

// ── checkPendingMigrations ───────────────────────────────────────────────────

describe('checkPendingMigrations', () => {
  let tmpDir: string;

  function writeVersionJson(versions: Record<string, string[]>): void {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'version.json'),
      JSON.stringify({ migrations: versions }, null, 2),
    );
  }

  function writeAppliedJson(lastApplied: string | null): void {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, '.applied.json'),
      JSON.stringify({ lastApplied }, null, 2),
    );
  }

  function createStoreDir(): void {
    fs.mkdirSync(path.join(tmpDir, 'store'), { recursive: true });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-migrations-test-'));
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── fresh clone (no .applied.json, no store/) ───────────────────────────────

  describe('fresh clone', () => {
    it('does not call process.exit', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('writes .applied.json initialised to the latest version', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });

      checkPendingMigrations(tmpDir);

      const appliedFile = path.join(tmpDir, 'migrations', '.applied.json');
      expect(fs.existsSync(appliedFile)).toBe(true);
      const state = JSON.parse(fs.readFileSync(appliedFile, 'utf-8'));
      expect(state.lastApplied).toBe('v1.0.0');
    });

    it('picks the highest version when multiple versions exist', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
        'v1.0.1': ['fix-index'],
      });

      checkPendingMigrations(tmpDir);

      const state = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'migrations', '.applied.json'), 'utf-8'),
      );
      expect(state.lastApplied).toBe('v1.1.0');
    });

    it('second run does not call process.exit (.applied.json now present)', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      checkPendingMigrations(tmpDir); // first run — writes .applied.json
      createStoreDir();               // store/ appears after first real startup

      checkPendingMigrations(tmpDir); // second run

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ── up to date ────────────────────────────────────────────────────────────

  describe('up to date', () => {
    it('does not call process.exit when applied matches latest', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      writeAppliedJson('v1.0.0');

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('does not call process.exit when applied matches latest across multiple versions', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
      });
      writeAppliedJson('v1.1.0');

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ── pending migrations ────────────────────────────────────────────────────

  describe('pending migrations', () => {
    it('calls process.exit(1) when applied is behind latest', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
      });
      writeAppliedJson('v1.0.0');

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('includes applied and latest versions in the error message', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
      });
      writeAppliedJson('v1.0.0');

      checkPendingMigrations(tmpDir);

      const msg = vi.mocked(console.error).mock.calls[0]?.[0] as string;
      expect(msg).toContain('v1.0.0');
      expect(msg).toContain('v1.1.0');
    });
  });

  // ── pre-migration install (no .applied.json but store/ exists) ─────────────

  describe('pre-migration install', () => {
    it('calls process.exit(1) when store/ exists but .applied.json does not', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('error message shows applied as none', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      createStoreDir();

      checkPendingMigrations(tmpDir);

      const msg = vi.mocked(console.error).mock.calls[0]?.[0] as string;
      expect(msg).toContain('none');
    });
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('missing version.json does not throw or call process.exit', () => {
      expect(() => checkPendingMigrations(tmpDir)).not.toThrow();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('empty migrations registry does not call process.exit', () => {
      writeVersionJson({});

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ── fail closed on a broken registry ──────────────────────────────────────
  //
  // The guard's entire job is to stop the app running against a store it has
  // not migrated. A blanket try/catch used to swallow every registry defect,
  // which meant a single corrupt byte silently DISABLED the protection and the
  // app started anyway. Absence is the only legitimate skip; anything
  // present-but-unusable must stop the process with an actionable message.

  describe('fail closed', () => {
    function writeRawVersionJson(contents: string): void {
      const migrationsDir = path.join(tmpDir, 'migrations');
      fs.mkdirSync(migrationsDir, { recursive: true });
      fs.writeFileSync(path.join(migrationsDir, 'version.json'), contents);
    }

    function writeRawAppliedJson(contents: string): void {
      const migrationsDir = path.join(tmpDir, 'migrations');
      fs.mkdirSync(migrationsDir, { recursive: true });
      fs.writeFileSync(path.join(migrationsDir, '.applied.json'), contents);
    }

    /** The message the operator actually sees, if any. */
    function errorMessage(): string {
      return (vi.mocked(console.error).mock.calls[0]?.[0] as string) ?? '';
    }

    it('refuses to start when version.json is corrupt', () => {
      writeRawVersionJson('{ "migrations": { "v1.0.0": ["init"] '); // truncated

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('version.json');
      expect(errorMessage()).toContain('not valid JSON');
      expect(errorMessage()).toContain('Refusing to start');
    });

    it('refuses to start when version.json is not JSON at all', () => {
      writeRawVersionJson('<!doctype html><html>404 Not Found</html>');

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('refuses to start when version.json is empty', () => {
      writeRawVersionJson('');

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('refuses to start when version.json is malformed (no migrations object)', () => {
      writeRawVersionJson(JSON.stringify({ schema: 1 }));

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('structurally invalid');
    });

    it('refuses to start when migrations is an array rather than an object', () => {
      writeRawVersionJson(JSON.stringify({ migrations: ['v1.0.0'] }));

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('structurally invalid');
    });

    it('refuses to start when the registry is a bare JSON scalar', () => {
      writeRawVersionJson('"v1.0.0"');

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('refuses to start when a version key is not a version', () => {
      // This used to throw inside compareSemver and get swallowed by the
      // blanket catch, disabling the guard entirely.
      writeRawVersionJson(JSON.stringify({ migrations: { latest: ['init'] } }));

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('invalid version key');
      expect(errorMessage()).toContain('latest');
    });

    it('refuses to start when version.json is unreadable for a reason other than absence', () => {
      // A directory where a file is expected: readFileSync fails with EISDIR,
      // which is present-but-unreadable, not legitimate absence.
      fs.mkdirSync(path.join(tmpDir, 'migrations', 'version.json'), { recursive: true });

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('could not be read');
    });

    it('refuses to start when .applied.json is corrupt', () => {
      writeVersionJson({ 'v1.0.0': ['init'] });
      writeRawAppliedJson('{ "lastApplied": '); // truncated
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('.applied.json');
      expect(errorMessage()).toContain('not valid JSON');
    });

    it('refuses to start when .applied.json is malformed', () => {
      writeVersionJson({ 'v1.0.0': ['init'] });
      writeRawAppliedJson(JSON.stringify({ applied: 'v1.0.0' })); // wrong field
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('structurally invalid');
    });

    it('refuses to start when .applied.json records a non-version value', () => {
      writeVersionJson({ 'v1.0.0': ['init'] });
      writeRawAppliedJson(JSON.stringify({ lastApplied: 'yesterday' }));
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('not a version string');
    });

    it('refuses to start when the two files are internally inconsistent', () => {
      // Applied is ahead of anything the registry defines: the registry was
      // rolled back or truncated, so "up to date" would be a lie.
      writeVersionJson({ 'v1.0.0': ['init'] });
      writeAppliedJson('v2.0.0');
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('ahead of');
    });

    it('never prints the contents of a broken registry', () => {
      // Refusal messages name the file and the defect. They must not echo the
      // file body, which can carry operator data.
      writeRawVersionJson('{ "migrations": { "v1.0.0": ["OPERATOR-SENSITIVE-PAYLOAD"] ');

      checkPendingMigrations(tmpDir);

      expect(errorMessage()).not.toContain('OPERATOR-SENSITIVE-PAYLOAD');
    });

    // ── the legitimate skip is preserved ────────────────────────────────────

    it('still skips silently when version.json is genuinely absent', () => {
      // The supported optional-registry case. Absence is the ONLY thing that
      // may bypass the guard.
      expect(fs.existsSync(path.join(tmpDir, 'migrations', 'version.json'))).toBe(false);

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('still skips silently when the migrations directory is absent entirely', () => {
      checkPendingMigrations(path.join(tmpDir, 'nonexistent-root'));

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('still accepts a well-formed registry with an empty migrations object', () => {
      // This is the live LandOS state: a registry that exists and defines
      // nothing yet.
      writeVersionJson({});

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('still accepts a valid applied state that matches the registry', () => {
      writeVersionJson({ 'v1.0.0': ['init'], 'v1.1.0': ['next'] });
      writeAppliedJson('v1.1.0');
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('still accepts an applied state recorded without the v prefix', () => {
      // compareSemver normalises the prefix; the consistency check must too,
      // or a cosmetic difference would look like corruption.
      writeVersionJson({ 'v1.1.0': ['next'] });
      writeRawAppliedJson(JSON.stringify({ lastApplied: '1.1.0' }));
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('still accepts a null lastApplied and reports it as pending', () => {
      writeVersionJson({ 'v1.0.0': ['init'] });
      writeAppliedJson(null);
      createStoreDir();

      checkPendingMigrations(tmpDir);

      // Pending, not corrupt: the guard fires with the normal message.
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(errorMessage()).toContain('pending migrations');
    });
  });
});
