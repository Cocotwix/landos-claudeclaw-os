#!/usr/bin/env tsx
// `npm run landos:deal-card:release`
//
// The single reproducible acceptance gate for the Deal Card workflow. It runs
// five consecutive complete cases through the production New Lead route in
// physically isolated synthetic QA storage, then runs a READ-ONLY regression
// against operating data.
//
// The storage mode is set before any LandOS module loads, so this process can
// never open the operating database for writing. The QA root is wiped first:
// a rerun after a failure must start from clean isolated QA storage, not from
// the debris of the run that failed.
//
//   npm run landos:deal-card:release
//   npm run landos:deal-card:release -- --keep-storage   (leave the QA store for inspection)
//
// Exit codes: 0 = five consecutive cases and the regression passed; 1 = not.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..',
);

const QA_ROOT = path.join(ROOT, '.runtime', 'landos', 'deal-card-release-qa');

// MUST precede every LandOS import.
process.env.LANDOS_STORAGE_MODE = 'qa';
process.env.LANDOS_QA_ROOT = QA_ROOT;
// The gate exercises route logic, not the model router or live browser lanes.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// Clean isolated QA storage. Refuses to remove anything that is not the
// dedicated release QA root, so a misconfigured env can never delete real data.
if (!flag('keep-storage') && fs.existsSync(QA_ROOT)) {
  const resolved = path.resolve(QA_ROOT);
  if (!resolved.includes(path.join('.runtime', 'landos')) || resolved.includes(path.join(ROOT, 'store'))) {
    throw new Error(`refusing to clear a QA root outside .runtime/landos: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
fs.mkdirSync(QA_ROOT, { recursive: true });

const { getLandosStorageProfile } = await import('../../src/landos/storage-profile.js');
const profile = getLandosStorageProfile();
if (profile.mode !== 'qa' || !profile.syntheticOnly) {
  throw new Error('refusing to run the release gate outside isolated synthetic QA storage');
}

const { registerLandosRoutes } = await import('../../src/landos/routes.js');
const { runDealCardRelease } = await import('../../src/landos/deal-card-release.js');

// The valuation contract can only be PROVEN where real price-bearing evidence
// exists, which is the operator's own runtime — the isolated QA fixtures carry
// none. This reads the live operator application over plain HTTP, GET only, and
// writes nothing. When the runtime is not up the gate reports the valuation
// contract as UNPROVEN rather than passing it silently.
const { readEnvFile } = await import('../../src/env.js');
const previousCwd = process.cwd();
process.chdir(ROOT);
let dashboardToken = '';
try { dashboardToken = readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN ?? ''; }
finally { process.chdir(previousCwd); }

const fetchLiveValuation = async (dealCardId: number) => {
  if (!dashboardToken) return null;
  const url = new URL(`/api/landos/deal-cards/${dealCardId}/comps-valuation`, 'http://localhost:3141');
  url.searchParams.set('token', dashboardToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const body = await response.json() as Record<string, any>;
  const pkg = body?.compsValuation?.valuationPackage ?? null;
  if (!pkg) return null;
  return {
    offer40: pkg.offer40 ?? null,
    offer60: pkg.offer60 ?? null,
    hasOffer50: Object.prototype.hasOwnProperty.call(pkg, 'offer50'),
    combined: pkg.combinedFmv ?? null,
    provenance: pkg.provenance ?? null,
  };
};

// Same rule for currentness: the "no prior read may present as current"
// contract can only be PROVEN on real Deal Cards with real research history.
// GET only; nothing is written.
const fetchLiveCurrentness = async (dealCardId: number) => {
  if (!dashboardToken) return null;
  const url = new URL(`/api/landos/deal-cards/${dealCardId}/property-intelligence`, 'http://localhost:3141');
  url.searchParams.set('view', 'workspace-v2');
  url.searchParams.set('token', dashboardToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  const body = await response.json() as Record<string, any>;
  const decision = body.dealDecision ?? null;
  const actionText = (value: unknown) => typeof value === 'string' ? value.trim()
    : typeof (value as any)?.action === 'string' ? String((value as any).action).trim()
      : typeof (value as any)?.headline === 'string' ? String((value as any).headline).trim() : '';
  return {
    subjectVersion: body.subject?.subjectVersion ?? null,
    snapshotStale: typeof body.snapshotSubject?.stale === 'boolean' ? body.snapshotSubject.stale : null,
    snapshotRanAgainst: body.snapshotSubject?.ranAgainst ?? null,
    propertyStatus: body.stage3Status?.property?.status ?? null,
    marketStatus: body.stage3Status?.market?.status ?? null,
    developmentPathStatus: body.developmentPathStatus?.status ?? null,
    decisionCorrelation: decision?.correlation ?? null,
    decisionSubjectVersion: decision?.basedOn?.subjectVersion ?? null,
    hasLandosAction: actionText(decision?.nextActions?.landos).length > 0,
    hasOperatorAction: actionText(decision?.nextActions?.operator).length > 0,
  };
};

const report = await runDealCardRelease(registerLandosRoutes, {
  projectRoot: ROOT,
  fetchLiveValuation,
  fetchLiveCurrentness,
});

console.log(`LandOS Deal Card release gate: ${report.outcome.toUpperCase()}`);
console.log(`Consecutive complete cases: ${report.consecutivePasses}/${report.requiredConsecutivePasses}`);
console.log(`Storage: ${report.storageProfile.mode} (syntheticOnly=${report.storageProfile.syntheticOnly})`);
console.log(`Operating database unchanged: ${report.operatingDatabase.unchanged}`);
for (const result of report.cases) {
  console.log(`\n  ${result.ordinal}. ${result.label} — ${result.passed ? 'PASS' : 'FAIL'}`);
  for (const c of result.checks) {
    console.log(`     [${c.passed ? 'x' : ' '}] ${c.contract}: ${c.assertion}`);
    if (!c.passed) console.log(`         ${c.detail}`);
  }
}
if (report.regression.length) {
  console.log('\n  Regression (read-only, operating data):');
  for (const c of report.regression) {
    console.log(`     [${c.passed ? 'x' : ' '}] ${c.assertion}`);
    if (!c.passed) console.log(`         ${c.detail}`);
  }
}
if (report.failure) console.log(`\nFailure: ${report.failure}`);
console.log(`\nReport: ${report.reportJsonPath}`);
console.log(`Report (markdown): ${report.reportMarkdownPath}`);

process.exitCode = report.outcome === 'pass' ? 0 : 1;
