#!/usr/bin/env node
// Record an operator-accepted governing acreage for a Deal Card.
//
// `buildAcreageBasis` has always had `operator_accepted` at the top of its
// precedence and nothing in LandOS ever wrote one, so the operator could not
// actually settle an acreage that a stale official record disagreed with. This
// is the write path for that decision.
//
// It writes ONE evidence row. It never edits, deletes or rewrites a retained
// measurement: the records it supersedes keep their original values, sources and
// dates and are named in the acceptance so the supersession is auditable.
//
//   node scripts/data/record-operator-acreage.mjs \
//     --deal 115 --acres 1.50 \
//     --basis "Signed boundary survey supplied by the seller" \
//     --observed 2026-08-17 \
//     --supersede <evidenceId>:"reason" [--supersede ...] \
//     [--note "..."] [--dry-run]

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = { supersede: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--dry-run') { args.dryRun = true; continue; }
    if (flag === '--deal') { args.deal = Number(value); i += 1; continue; }
    if (flag === '--acres') { args.acres = Number(value); i += 1; continue; }
    if (flag === '--basis') { args.basis = value; i += 1; continue; }
    if (flag === '--observed') { args.observed = value; i += 1; continue; }
    if (flag === '--note') { args.note = value; i += 1; continue; }
    if (flag === '--supersede') {
      const split = String(value ?? '').indexOf(':');
      if (split > 0) {
        args.supersede.push({ evidenceId: Number(value.slice(0, split)), reason: value.slice(split + 1) });
      }
      i += 1;
      continue;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!Number.isInteger(args.deal) || !Number.isFinite(args.acres) || !args.basis || !args.observed) {
  console.error('Usage: --deal <id> --acres <n> --basis "<what the operator relied on>" --observed <YYYY-MM-DD> [--supersede <id>:"reason"] [--note "..."] [--dry-run]');
  process.exit(2);
}

const { recordOperatorAcceptedAcreage, resolveSubjectAcreage } = await import(
  pathToFileURL(path.join(ROOT, 'dist', 'landos', 'subject-acreage.js')).href
);
const { resolveCanonicalSubjectState } = await import(
  pathToFileURL(path.join(ROOT, 'dist', 'landos', 'canonical-subject-state.js')).href
);

const before = resolveCanonicalSubjectState(args.deal);
console.log(`Deal ${args.deal} — before`);
console.log(`  subject version : ${before.subjectVersion}`);
console.log(`  governing acres : ${before.governingAcreage.value ?? 'not established'} (${before.governingAcreage.kind ?? 'no basis'})`);
for (const signal of resolveSubjectAcreage(args.deal, before.propertyCardId).signals) {
  console.log(`  signal          : ${signal.acres} ac · ${signal.basis} · ${signal.source} · evidence ${signal.evidenceId ?? 'n/a'} · observed ${signal.observedAt ?? 'not stated'}`);
}

if (args.dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

const result = recordOperatorAcceptedAcreage({
  dealCardId: args.deal,
  acres: args.acres,
  basisLabel: args.basis,
  observedAt: args.observed,
  supersedes: args.supersede,
  note: args.note,
});
console.log(`\nWrote acceptance: evidence ${result.evidenceIds.join(', ') || '(deduplicated)'}${result.skippedReason ? ` — ${result.skippedReason}` : ''}`);

const after = resolveCanonicalSubjectState(args.deal);
console.log(`\nDeal ${args.deal} — after`);
console.log(`  subject version : ${after.subjectVersion}`);
console.log(`  governing acres : ${after.governingAcreage.value ?? 'not established'} (${after.governingAcreage.kind ?? 'no basis'})`);
console.log(`  basis source    : ${after.governingAcreage.source ?? 'none'}`);
console.log(`  disputed        : ${after.governingAcreage.disputed}`);
for (const entry of after.supersededAcreage) {
  console.log(`  superseded      : ${entry.value} ac · ${entry.source} · ${entry.reason}`);
}
