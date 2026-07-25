// READ-ONLY schema + integrity verification of the LandOS store.
//
// Opens the SQLite store strictly read-only and reports: SQLite's own
// integrity check, foreign-key violations, presence and row counts for the
// core property/intake tables, and the immutability triggers that protect
// accepted intake artifacts. Nothing is created, altered, or deleted.
//
// Usage:
//   node scripts/landos-store-verify.cjs [db-path] [--table name]... [--json]
//
//   db-path        Path to the store (default: LANDOS_DB_PATH, else store/landos.db)
//   --table name   Additional table to report on; repeatable.
//   --json         Emit a single JSON object instead of human-readable lines.
//
// Exit code 0 when the store is intact, 1 when integrity or foreign-key checks
// fail or a core table is missing, 2 on bad arguments.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Tables that must exist for the owner-facing property and intake read models.
const CORE = [
  'landos_property_card',
  'landos_deal_card',
  'landos_intake_submission',
  'landos_intake_artifact',
  'landos_intake_candidate',
  'landos_parcel_identity',
  'landos_property_identity_version',
];

const argv = process.argv.slice(2);
const extraTables = [];
let dbArg = null;
let asJson = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') asJson = true;
  else if (a === '--table') {
    const name = argv[++i];
    if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
      console.error(`--table needs a plain table name (got "${name ?? ''}")`);
      process.exit(2);
    }
    extraTables.push(name);
  } else if (a.startsWith('--')) {
    console.error(`unknown option "${a}"`);
    process.exit(2);
  } else if (dbArg === null) dbArg = a;
  else {
    console.error(`unexpected argument "${a}"`);
    process.exit(2);
  }
}

const dbPath = path.resolve(dbArg ?? process.env.LANDOS_DB_PATH ?? path.join('store', 'landos.db'));
if (!fs.existsSync(dbPath)) {
  console.error(`No LandOS store at ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
const countOf = (t) => (tables.has(t) ? db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c : null);

const quickCheck = db.pragma('quick_check', { simple: true });
const fkViolations = db.pragma('foreign_key_check').length;
const coreCounts = Object.fromEntries(CORE.map((t) => [t, countOf(t)]));
const extraCounts = Object.fromEntries(extraTables.map((t) => [t, countOf(t)]));
const artifactTriggers = db
  .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'landos_intake_artifact_immutable%'")
  .all()
  .map((r) => r.name);
const landosTableCount = db
  .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'landos_%'")
  .get().c;

const missingCore = CORE.filter((t) => !tables.has(t));
const ok = quickCheck === 'ok' && fkViolations === 0 && missingCore.length === 0;

if (asJson) {
  console.log(JSON.stringify({ dbPath, quickCheck, fkViolations, coreCounts, extraCounts, missingCore, artifactTriggers, landosTableCount, ok }, null, 2));
} else {
  console.log('store:', dbPath);
  console.log('quick_check:', quickCheck);
  console.log('foreign_key_check violations:', fkViolations);
  console.log('--- core property/intake tables ---');
  for (const t of CORE) console.log(' ', t, tables.has(t) ? `rows=${coreCounts[t]}` : 'MISSING');
  if (extraTables.length) {
    console.log('--- requested tables ---');
    for (const t of extraTables) console.log(' ', t, tables.has(t) ? `rows=${extraCounts[t]}` : 'MISSING');
  }
  console.log('artifact immutability triggers:', JSON.stringify(artifactTriggers));
  console.log('landos_* table count:', landosTableCount);
  console.log(ok ? 'STORE OK' : 'STORE PROBLEMS FOUND');
}

db.close();
process.exit(ok ? 0 : 1);
