import fs from 'fs';
import path from 'path';

interface VersionRegistry {
  migrations: Record<string, string[]>;
}

interface AppliedState {
  lastApplied: string | null;
}

function parseSemver(v: string): [number, number, number] {
  const match = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: ${v}`);
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

export function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

function isSemver(v: unknown): v is string {
  return typeof v === 'string' && /^v?\d+\.\d+\.\d+$/.test(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Refuse to start.
 *
 * The guard exists to stop the app running against a store it has not
 * migrated. Swallowing a broken registry silently disabled exactly that
 * protection, so anything short of "the file legitimately isn't there" stops
 * the process with an actionable message instead.
 *
 * The message names the file and the defect only — never its contents, which
 * could carry operator data.
 */
function refuseToStart(problem: string): void {
  console.error(
    `\n⚠️  ClaudeClaw cannot verify migrations: ${problem}\n` +
      `    Refusing to start rather than running against a possibly unmigrated store.\n` +
      `    Fix or restore the file, then restart.\n`,
  );
  process.exit(1);
}

export function checkPendingMigrations(projectRoot: string): void {
  const migrationsDir = path.join(projectRoot, 'migrations');
  const versionFile = path.join(migrationsDir, 'version.json');
  const appliedFile = path.join(migrationsDir, '.applied.json');
  const storeDir = path.join(projectRoot, 'store');

  // ── version.json ──────────────────────────────────────────────────
  // ABSENT is the one legitimate skip: an install that has no migration
  // registry has nothing to verify. PRESENT-but-broken is not — it means the
  // guard cannot tell whether the store is migrated, which is precisely when
  // it must refuse.
  let raw: string;
  try {
    raw = fs.readFileSync(versionFile, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
    return refuseToStart(`migrations/version.json exists but could not be read (${code}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuseToStart('migrations/version.json is present but is not valid JSON.');
  }

  if (!isPlainObject(parsed) || !isPlainObject((parsed as Record<string, unknown>).migrations)) {
    return refuseToStart(
      'migrations/version.json is structurally invalid (expected an object with a "migrations" object).',
    );
  }
  const registry = parsed as unknown as VersionRegistry;

  const versionKeys = Object.keys(registry.migrations);
  if (versionKeys.length === 0) return;

  // A non-semver key would make compareSemver throw mid-sort. Left uncaught
  // that crashed with a stack; caught by the old blanket try/catch it silently
  // disabled the guard. Neither is acceptable — name the bad key instead.
  const badVersion = versionKeys.find((v) => !isSemver(v));
  if (badVersion !== undefined) {
    return refuseToStart(
      `migrations/version.json contains an invalid version key ${JSON.stringify(badVersion)}.`,
    );
  }

  const versions = [...versionKeys].sort(compareSemver);
  const latest = versions[versions.length - 1];

  // ── .applied.json ─────────────────────────────────────────────────
  let lastApplied: string | null = null;
  if (fs.existsSync(appliedFile)) {
    let appliedRaw: string;
    try {
      appliedRaw = fs.readFileSync(appliedFile, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
      return refuseToStart(`migrations/.applied.json exists but could not be read (${code}).`);
    }

    let appliedParsed: unknown;
    try {
      appliedParsed = JSON.parse(appliedRaw);
    } catch {
      return refuseToStart('migrations/.applied.json is present but is not valid JSON.');
    }

    if (!isPlainObject(appliedParsed) || !('lastApplied' in appliedParsed)) {
      return refuseToStart(
        'migrations/.applied.json is structurally invalid (expected an object with a "lastApplied" field).',
      );
    }

    const value = (appliedParsed as Record<string, unknown>).lastApplied;
    if (value !== null && !isSemver(value)) {
      return refuseToStart(
        'migrations/.applied.json records a "lastApplied" value that is not null and not a version string.',
      );
    }

    // Recorded as applied but ahead of everything the registry defines: the
    // two files disagree, so "no pending migrations" below would be a
    // meaningless answer. Compared by semver, not string equality, so a
    // "1.2.0" / "v1.2.0" prefix difference is not mistaken for a conflict.
    if (value !== null && compareSemver(value, latest) > 0) {
      return refuseToStart(
        `migrations/.applied.json records version ${JSON.stringify(value)}, which is ahead of the latest version migrations/version.json defines (${latest}).`,
      );
    }

    lastApplied = value as string | null;
  } else if (!fs.existsSync(storeDir)) {
    // Fresh clone — store/ hasn't been created yet, so the bot has never run.
    // Write .applied.json now so subsequent starts (after store/ is created) don't
    // mistake this for a pre-migration install.
    try {
      fs.writeFileSync(appliedFile, JSON.stringify({ lastApplied: latest }, null, 2) + '\n');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown error';
      return refuseToStart(
        `migrations/.applied.json could not be initialised (${code}); migration state cannot be recorded.`,
      );
    }
    return;
  }
  // If .applied.json is absent but store/ exists, this is a pre-migration install.
  // Fall through with lastApplied = null so the guard fires.

  const hasPending =
    lastApplied === null || compareSemver(lastApplied, latest) < 0;

  if (hasPending) {
    console.error(
      `\n⚠️  ClaudeClaw has pending migrations (applied: ${lastApplied ?? 'none'}, latest: ${latest}).\n` +
        `    Run \`npm run migrate\` to update, then restart.\n`,
    );
    process.exit(1);
  }
}
