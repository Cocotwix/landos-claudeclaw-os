#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const SOURCE = path.join(ROOT, 'store', 'landos.db');
const PRIVATE_ROOT = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LandOS', 'Backups');
const DPAPI = path.join(SCRIPT_DIR, 'landos-dpapi.ps1');

function isoSlug() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function chmodPrivate(file) { try { fs.chmodSync(file, 0o600); } catch {} }

function inspectDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = db.pragma('quick_check', { simple: true });
    const foreignKeyViolations = db.pragma('foreign_key_check').length;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'landos_%' ORDER BY name").all().map((r) => r.name);
    const rowCounts = Object.fromEntries(tables.map((name) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));
    const schemaSql = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all().map((r) => r.sql).join('\n');
    return { quickCheck, foreignKeyViolations, rowCounts, schemaSha256: crypto.createHash('sha256').update(schemaSql).digest('hex') };
  } finally { db.close(); }
}

function dpapi(mode, input, output) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DPAPI, '-Mode', mode, '-InputPath', input, '-OutputPath', output], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Windows data protection failed: ${(r.stderr || r.stdout || '').trim()}`);
}

async function createBackup(source = SOURCE, outDir = PRIVATE_ROOT) {
  fs.mkdirSync(outDir, { recursive: true });
  const base = `landos-${isoSlug()}`;
  const plain = path.join(outDir, `${base}.sqlite.tmp`);
  const encrypted = path.join(outDir, `${base}.sqlite.dpapi`);
  const manifestPath = `${encrypted}.manifest.json`;
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  try { await sourceDb.backup(plain); } finally { sourceDb.close(); }
  try {
    const inspection = inspectDatabase(plain);
    if (inspection.quickCheck !== 'ok' || inspection.foreignKeyViolations !== 0) throw new Error('snapshot integrity validation failed');
    dpapi('protect', plain, encrypted);
    const manifest = {
      schema: 1,
      protection: 'Windows DPAPI CurrentUser',
      createdAt: new Date().toISOString(),
      source: path.basename(source),
      plaintextSha256: sha256(plain),
      encryptedSha256: sha256(encrypted),
      plaintextBytes: fs.statSync(plain).size,
      ...inspection,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    chmodPrivate(encrypted); chmodPrivate(manifestPath);
    return { encrypted, manifestPath, manifest };
  } finally {
    if (fs.existsSync(plain)) fs.rmSync(plain, { force: true });
  }
}

function restoreBackup(encrypted, target, manifestPath = `${encrypted}.manifest.json`) {
  if (fs.existsSync(target)) throw new Error(`restore target already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const plain = `${target}.decrypting`;
  try {
    dpapi('unprotect', encrypted, plain);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (sha256(plain) !== manifest.plaintextSha256) throw new Error('restored snapshot checksum does not match manifest');
    const inspection = inspectDatabase(plain);
    if (inspection.quickCheck !== 'ok' || inspection.foreignKeyViolations !== 0) throw new Error('restored database integrity validation failed');
    if (inspection.schemaSha256 !== manifest.schemaSha256 || JSON.stringify(inspection.rowCounts) !== JSON.stringify(manifest.rowCounts)) {
      throw new Error('restored database schema or row counts do not match manifest');
    }
    fs.renameSync(plain, target);
    chmodPrivate(target);
    return inspection;
  } finally {
    if (fs.existsSync(plain)) fs.rmSync(plain, { force: true });
  }
}

async function main() {
  const [command, arg1, arg2] = process.argv.slice(2);
  if (command === 'backup') {
    const result = await createBackup();
    process.stdout.write(`${JSON.stringify({ backup: result.encrypted, manifest: result.manifestPath, quickCheck: result.manifest.quickCheck, foreignKeyViolations: result.manifest.foreignKeyViolations })}\n`);
    return;
  }
  if (command === 'restore') {
    if (!arg1 || !arg2) throw new Error('usage: restore <encrypted-backup> <new-target-db>');
    const inspection = restoreBackup(path.resolve(arg1), path.resolve(arg2));
    process.stdout.write(`${JSON.stringify({ target: path.resolve(arg2), quickCheck: inspection.quickCheck, foreignKeyViolations: inspection.foreignKeyViolations })}\n`);
    return;
  }
  if (command === 'drill') {
    const result = await createBackup();
    const drillRoot = path.join(ROOT, '.runtime', 'landos', 'backup-restore-drill', isoSlug());
    const target = path.join(drillRoot, 'clean', 'store', 'landos.db');
    try {
      const inspection = restoreBackup(result.encrypted, target, result.manifestPath);
      const report = { at: new Date().toISOString(), backup: result.encrypted, manifest: result.manifestPath, restoredTarget: target, removedAfterVerification: true, quickCheck: inspection.quickCheck, foreignKeyViolations: inspection.foreignKeyViolations, rowCountsMatch: true, schemaMatch: true };
      fs.mkdirSync(drillRoot, { recursive: true });
      fs.writeFileSync(path.join(drillRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ report: path.join(drillRoot, 'report.json'), backup: result.encrypted, quickCheck: inspection.quickCheck, rowCountsMatch: true, schemaMatch: true })}\n`);
    } finally {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
    return;
  }
  throw new Error('usage: landos-data.mjs backup | restore <backup> <new-target-db> | drill');
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });

