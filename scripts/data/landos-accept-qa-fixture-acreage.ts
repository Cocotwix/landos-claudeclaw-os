#!/usr/bin/env tsx
// Accept the controlled QA card's governing acreage from fixture truth through
// the real subject-acceptance path (operator acreage acceptance + a new
// identity version), the same seam `landos-promote-accepted-survey-basis.ts`
// uses for Deal 90.
//
//   npx tsx scripts/data/landos-accept-qa-fixture-acreage.ts            # dry run
//   npx tsx scripts/data/landos-accept-qa-fixture-acreage.ts --apply
//
// Why this exists
// ---------------
// The controlled QA card (7348 Overbey Rd, Williamson County TN, parcel
// 046 05000 000) carried three acreages: the LandPortal parcel record's 43.7 on
// the property card, the QA intake's 52.18 (a listing's MLS acreage) on the
// identity version, and the official Williamson County assessment record's
// 50.8 retrieved through the Assessor & Tax capability. The official
// acreage/extent reconciliation names 50.8 as the confirmed current acreage
// but refuses adoption while the 52.18 intake figure sits unexplained in
// identity history. The fixture (`scripts/qa/landos-controlled-qa-lead.mts`)
// now states 50.8, the official record, so the acceptance below records that
// fixture truth with the official record as its basis and retires the two
// figures it supersedes, each with its reason. Nothing here is an operator
// adjudication of conflicting evidence: the accepted figure IS the official
// assessor record, and the acceptance says so.

import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..',
);
void ROOT;

const APPLY = process.argv.includes('--apply');
const DEAL = 128;
const FIXTURE_ACRES = 50.8;
const OFFICIAL_SOURCE = 'Williamson County Property Assessment Database (inigo.williamson-tn.org), parcel 046 05000 000';

const { getLandosDb } = await import('../../src/landos/db.js');
const { readCurrentPropertyIdentity, createPropertyIdentityVersion } = await import('../../src/landos/property-summary-slice.js');
const { resolveSubjectAcreage, recordOperatorAcceptedAcreage } = await import('../../src/landos/subject-acreage.js');
const { readAcreageExtentRecord } = await import('../../src/landos/official-acreage-run.js');

const db = getLandosDb();
const current = readCurrentPropertyIdentity(DEAL);
if (!current) throw new Error(`Deal ${DEAL} has no current identity version`);
const before = resolveSubjectAcreage(DEAL, current.propertyCardId);
const extent = readAcreageExtentRecord(DEAL);
const official = extent?.decision.retained.find((row) => row.valueType === 'official_reported');
if (!official || Math.abs(official.valueAcres - FIXTURE_ACRES) > 0.005) {
  throw new Error(`the retained official acreage-extent record does not carry ${FIXTURE_ACRES} ac as the official figure`);
}

// The retained figures the acceptance retires, each named with its reason.
const rows = db.prepare(`
  SELECT id, fact_key, normalized_value_json, source_name FROM landos_property_evidence_item
   WHERE deal_card_id = ? AND domain IN ('assessor_gis', 'acreage_extent')
     AND fact_key IN ('Parcel-record acreage', 'acreage_historical_project', 'acreage_provider_reported')
   ORDER BY id DESC
`).all(DEAL) as Array<{ id: number; fact_key: string; normalized_value_json: string; source_name: string }>;
const supersedes = rows.slice(0, 6).map((row) => ({
  evidenceId: row.id,
  reason: row.fact_key === 'acreage_historical_project'
    ? 'The QA intake stated the listing\'s MLS acreage (52.18); the controlled fixture now carries the official assessment-record acreage.'
    : 'Provider copy of an older roll value (43.7); the current official assessment record carries 50.8.',
}));

console.log(`Deal ${DEAL} identity v${current.version}: apn=${current.apn} acreage=${current.acreage}`);
console.log(`Governing acreage before: ${before.governing.value ?? 'null'} (${before.governing.kind ?? 'none'})`);
console.log(`Official extent record: ${official.valueAcres} ac from ${official.source} retrieved ${official.retrievedAt}`);
console.log(`Would retire ${supersedes.length} retained figure(s): ${supersedes.map((s) => `#${s.evidenceId}`).join(', ')}`);

const basisLabel = `Controlled QA fixture acreage: ${OFFICIAL_SOURCE}, official record retrieved through the Assessor & Tax capability`;
const observedAt = official.retrievedAt ?? new Date().toISOString();

if (!APPLY) {
  console.log(`\nWould record an operator acceptance of ${FIXTURE_ACRES} ac (basis: ${basisLabel}; observed ${observedAt})`);
  console.log('Would create a new confirmed identity version carrying that acreage.');
  console.log('\nDry run. Re-run with --apply.');
  process.exit(0);
}

const acceptance = recordOperatorAcceptedAcreage({
  dealCardId: DEAL,
  acres: FIXTURE_ACRES,
  basisLabel,
  observedAt,
  supersedes,
  note: 'Controlled QA card: the accepted figure is the official county assessment record, recorded through the fixture rather than by operator adjudication.',
});
console.log(`Acceptance evidence: ${acceptance.evidenceIds.join(', ') || 'none'}${acceptance.skippedReason ? ` (${acceptance.skippedReason})` : ''}`);

const version = createPropertyIdentityVersion({
  dealCardId: DEAL,
  propertyCardId: current.propertyCardId,
  status: current.status,
  address: current.address,
  city: current.city,
  county: current.county,
  state: current.state,
  zip: current.zip,
  apn: current.apn,
  owner: current.owner,
  acreage: FIXTURE_ACRES,
  geometry: current.geometry,
  basis: `${current.basis} Governing acreage ${FIXTURE_ACRES} ac accepted from the controlled QA fixture, which carries the official ${OFFICIAL_SOURCE} figure (retrieved ${observedAt}); the LandPortal 43.7 and the intake's 52.18 are retained as superseded history.`,
  confidence: current.confidence,
  sourceRefs: [...new Set([...(current.sourceRefs ?? []), 'https://inigo.williamson-tn.org/property_search/', ...acceptance.evidenceIds.map((id) => `evidence:${id}`)])],
  changeReason: `Controlled QA fixture acreage accepted: official ${FIXTURE_ACRES} ac replaces the intake's 52.18 on the identity version; prior figures retained as history.`,
  createdBy: 'operational-closure',
  allowAcceptedSupersession: true,
});
console.log(`Created identity v${version.version} (#${version.id}) acreage=${version.acreage}`);
const after = resolveSubjectAcreage(DEAL, current.propertyCardId);
console.log(`Governing acreage after: ${after.governing.value ?? 'null'} (${after.governing.kind ?? 'none'})`);
