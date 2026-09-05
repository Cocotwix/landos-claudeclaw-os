#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const STORE = path.join(ROOT, 'store');
const SOURCE_DB = path.join(STORE, 'landos.db');
const PRIVATE_ROOT = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LandOS', 'Backups');
const DPAPI = path.join(SCRIPT_DIR, 'landos-dpapi.ps1');
const ARTIFACT_DIRS = ['visuals', 'documents', 'landos-reports', 'training-shots'];
const MAGIC = Buffer.from('LANDOS1\0');

function isoSlug() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function sha256File(file) { const h = crypto.createHash('sha256'); h.update(fs.readFileSync(file)); return h.digest('hex'); }
function run(command, args, opts = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${command} failed: ${(r.stderr || r.stdout || '').trim()}`);
}
function dpapi(mode, input, output) { run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DPAPI, '-Mode', mode, '-InputPath', input, '-OutputPath', output]); }
function chmodPrivate(file) { try { fs.chmodSync(file, 0o600); } catch {} }

function inspectDb(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = db.pragma('quick_check', { simple: true });
    const foreignKeyViolations = db.pragma('foreign_key_check').length;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'landos_%' ORDER BY name").all().map((r) => r.name);
    const rowCounts = Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all().map((r) => r.sql).join('\n');
    return { quickCheck, foreignKeyViolations, rowCounts, schemaSha256: crypto.createHash('sha256').update(schema).digest('hex') };
  } finally { db.close(); }
}

function walkArtifacts() {
  const rows = [];
  const walk = (absolute, relative) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const abs = path.join(absolute, entry.name);
      const rel = path.join(relative, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) rows.push({ path: rel, bytes: fs.statSync(abs).size, sha256: sha256File(abs) });
    }
  };
  for (const dir of ARTIFACT_DIRS) {
    const abs = path.join(STORE, dir);
    if (fs.existsSync(abs)) walk(abs, dir);
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

async function encryptTar(tarFile, encrypted, wrappedKey) {
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const keyTemp = `${wrappedKey}.tmp`;
  try {
    fs.writeFileSync(keyTemp, key, { mode: 0o600 });
    dpapi('protect', keyTemp, wrappedKey);
    const out = fs.createWriteStream(encrypted, { mode: 0o600 });
    out.write(MAGIC); out.write(nonce);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    await pipeline(fs.createReadStream(tarFile), cipher, out);
    fs.appendFileSync(encrypted, cipher.getAuthTag());
  } finally {
    key.fill(0);
    if (fs.existsSync(keyTemp)) fs.rmSync(keyTemp, { force: true });
  }
}

async function decryptTar(encrypted, wrappedKey, tarFile) {
  const keyTemp = `${tarFile}.key.tmp`;
  try {
    dpapi('unprotect', wrappedKey, keyTemp);
    const key = fs.readFileSync(keyTemp);
    const fd = fs.openSync(encrypted, 'r');
    const head = Buffer.alloc(MAGIC.length + 12);
    fs.readSync(fd, head, 0, head.length, 0);
    const size = fs.fstatSync(fd).size;
    const tag = Buffer.alloc(16);
    fs.readSync(fd, tag, 0, 16, size - 16);
    fs.closeSync(fd);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a LandOS backup package');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(fs.createReadStream(encrypted, { start: head.length, end: size - 17 }), decipher, fs.createWriteStream(tarFile, { mode: 0o600 }));
    key.fill(0);
  } finally {
    if (fs.existsSync(keyTemp)) fs.rmSync(keyTemp, { force: true });
  }
}

async function createPackage() {
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true });
  const slug = `landos-business-${isoSlug()}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-backup-'));
  const snapshot = path.join(work, 'landos.db');
  const tarFile = path.join(work, 'package.tar');
  const encrypted = path.join(PRIVATE_ROOT, `${slug}.tar.aesgcm`);
  const wrappedKey = `${encrypted}.key.dpapi`;
  const manifestPath = `${encrypted}.manifest.json`;
  const source = new Database(SOURCE_DB, { readonly: true, fileMustExist: true });
  try {
    await source.backup(snapshot);
    const database = inspectDb(snapshot);
    if (database.quickCheck !== 'ok' || database.foreignKeyViolations !== 0) throw new Error('online database snapshot failed integrity checks');
    const artifacts = walkArtifacts();
    // --force-local: GNU tar parses a `-f` path as host:file, so a Windows
    // absolute path like C:\...\package.tar is read as host "C". Without this
    // the backup dies with "Cannot connect to C: resolve failed" and every
    // migration safeguard that depends on a verified backup is unavailable.
    const tarArgs = ['--force-local', '-cf', tarFile, '-C', work, 'landos.db'];
    for (const dir of ARTIFACT_DIRS) if (fs.existsSync(path.join(STORE, dir))) tarArgs.push('-C', STORE, dir);
    run('tar.exe', tarArgs);
    await encryptTar(tarFile, encrypted, wrappedKey);
    const manifest = {
      schema: 1,
      createdAt: new Date().toISOString(),
      encryption: 'AES-256-GCM; random key wrapped by Windows DPAPI CurrentUser',
      packageSha256: sha256File(encrypted),
      wrappedKeySha256: sha256File(wrappedKey),
      database,
      artifacts,
      artifactCount: artifacts.length,
      artifactBytes: artifacts.reduce((n, r) => n + r.bytes, 0),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    chmodPrivate(encrypted); chmodPrivate(wrappedKey); chmodPrivate(manifestPath);
    return { encrypted, wrappedKey, manifestPath, manifest };
  } finally {
    source.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function restorePackage(encrypted, targetRoot) {
  if (fs.existsSync(targetRoot)) throw new Error(`restore target already exists: ${targetRoot}`);
  const wrappedKey = `${encrypted}.key.dpapi`;
  const manifestPath = `${encrypted}.manifest.json`;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (sha256File(encrypted) !== manifest.packageSha256 || sha256File(wrappedKey) !== manifest.wrappedKeySha256) throw new Error('backup package or wrapped key checksum mismatch');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-restore-'));
  const tarFile = path.join(work, 'package.tar');
  try {
    await decryptTar(encrypted, wrappedKey, tarFile);
    fs.mkdirSync(targetRoot, { recursive: true });
    // Extract into targetRoot as the child's working directory rather than with
    // `-C`. GNU tar 1.35 on Windows mangles a `-C` argument under
    // --force-local on EXTRACT (the drive colon is escaped and the path is then
    // opened as a member: "C\:\\Users\...: Cannot open"), which silently left
    // every restore drill unverifiable. Create is unaffected and still uses -C,
    // because it interleaves several -C switches with member names.
    run('tar.exe', ['--force-local', '-xf', tarFile], { cwd: targetRoot });
    const database = inspectDb(path.join(targetRoot, 'landos.db'));
    if (JSON.stringify(database) !== JSON.stringify(manifest.database)) throw new Error('restored database does not match backup manifest');
    const restoredArtifacts = [];
    const previousStore = STORE;
    for (const item of manifest.artifacts) {
      const file = path.join(targetRoot, item.path);
      if (!fs.existsSync(file) || fs.statSync(file).size !== item.bytes || sha256File(file) !== item.sha256) throw new Error(`restored artifact mismatch: ${item.path}`);
      restoredArtifacts.push(item.path);
    }
    void previousStore;
    return { database, restoredArtifacts: restoredArtifacts.length };
  } catch (error) {
    if (fs.existsSync(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true });
    throw error;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

async function main() {
  const [command, input, target] = process.argv.slice(2);
  if (command === 'backup') {
    const r = await createPackage();
    process.stdout.write(`${JSON.stringify({ backup: r.encrypted, wrappedKey: r.wrappedKey, manifest: r.manifestPath, quickCheck: r.manifest.database.quickCheck, artifactCount: r.manifest.artifactCount, artifactBytes: r.manifest.artifactBytes })}\n`);
    return;
  }
  if (command === 'restore') {
    if (!input || !target) throw new Error('usage: restore <backup.tar.aesgcm> <new-target-root>');
    const r = await restorePackage(path.resolve(input), path.resolve(target));
    process.stdout.write(`${JSON.stringify({ target: path.resolve(target), quickCheck: r.database.quickCheck, restoredArtifacts: r.restoredArtifacts })}\n`);
    return;
  }
  if (command === 'drill') {
    const r = await createPackage();
    const drillRoot = path.join(ROOT, '.runtime', 'landos', 'backup-restore-drill', isoSlug());
    const restored = path.join(drillRoot, 'clean-install');
    try {
      const verification = await restorePackage(r.encrypted, restored);
      fs.mkdirSync(drillRoot, { recursive: true });
      const report = { at: new Date().toISOString(), backup: r.encrypted, wrappedKey: r.wrappedKey, manifest: r.manifestPath, cleanTargetRemovedAfterVerification: true, database: verification.database, artifactCount: verification.restoredArtifacts, artifactsMatch: true };
      const reportPath = path.join(drillRoot, 'report.json');
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ report: reportPath, backup: r.encrypted, quickCheck: verification.database.quickCheck, rowCountsMatch: true, schemaMatch: true, artifactCount: verification.restoredArtifacts, artifactsMatch: true })}\n`);
    } finally { if (fs.existsSync(restored)) fs.rmSync(restored, { recursive: true, force: true }); }
    return;
  }
  throw new Error('usage: landos-business-backup.mjs backup | restore <backup> <new-target-root> | drill');
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
