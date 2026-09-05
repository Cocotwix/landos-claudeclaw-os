#!/usr/bin/env tsx
// Promote the operator-accepted governing acreage basis onto the canonical
// Deal Card for the Bradford County subject.
//
//   npx tsx scripts/data/landos-promote-accepted-survey-basis.ts            # dry run
//   npx tsx scripts/data/landos-promote-accepted-survey-basis.ts --apply
//
// Why this exists
// ---------------
// Deal 90's current identity version records the governing acreage of 1.50 ac
// but attributes it to the Florida DEP statewide Cadastral 2023 parcel layer.
// That layer is the HISTORICAL, NON-GOVERNING geometry for this subject: it
// carries 1.846 ac, measured before the boundary survey, and the county has not
// completed its update cycle. The accepted governing evidence is the signed
// boundary survey held by the operator, retained as an `operator_acceptance`
// evidence row (fact key "Operator-accepted governing acreage").
//
// That acceptance was recorded on Deal 115, which is now an archived alias of
// Deal 90. The evidence itself is immutable and stays exactly where it was
// written — it is READ through the canonical family resolver, never copied.
// What must move onto the canonical card is the SUBJECT VERSION, and it moves
// through the ordinary identity writer so versioning, supersession and the
// duplicate rematch all run exactly as they would for any other correction.
//
// It deliberately does NOT reuse Deal 115's identity version as Deal 90's
// canonical version: the alias keeps its own lineage, and Deal 90 gets a new
// verified version of its own.

import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..',
);

const APPLY = process.argv.includes('--apply');
const CANONICAL_DEAL = 90;

const { getLandosDb } = await import('../../src/landos/db.js');
const { readCurrentPropertyIdentity, createPropertyIdentityVersion } = await import('../../src/landos/property-summary-slice.js');
const { resolveDealFamily } = await import('../../src/landos/canonical-deal-family.js');
const { resolveSubjectAcreage, OPERATOR_ACCEPTED_ACREAGE_FACT } = await import('../../src/landos/subject-acreage.js');

const db = getLandosDb();
const family = resolveDealFamily(db, CANONICAL_DEAL);
if (family.requestedIsAlias) throw new Error(`Deal ${CANONICAL_DEAL} is an alias, not the canonical card`);

// The acceptance must be REACHABLE from the canonical family before anything is
// promoted. If the family read cannot see it, the read-model repair is not in
// place and promoting a basis the card cannot evidence would be a bare claim.
const placeholders = family.familyIds.map(() => '?').join(',');
const acceptance = db.prepare(`
  SELECT id, deal_card_id, normalized_value_json, source_name, retrieved_at
    FROM landos_property_evidence_item
   WHERE deal_card_id IN (${placeholders}) AND fact_key = ?
   ORDER BY id DESC LIMIT 1
`).get(...family.familyIds, OPERATOR_ACCEPTED_ACREAGE_FACT) as {
  id: number; deal_card_id: number; normalized_value_json: string;
  source_name: string; retrieved_at: string;
} | undefined;

if (!acceptance) {
  throw new Error('no operator-accepted governing acreage is reachable from the Deal 90 canonical family');
}

const payload = JSON.parse(acceptance.normalized_value_json ?? '{}') as {
  acres?: number; basisLabel?: string; observedAt?: string;
};
const current = readCurrentPropertyIdentity(CANONICAL_DEAL);
const resolved = resolveSubjectAcreage(CANONICAL_DEAL, current?.propertyCardId ?? null);

console.log(`Canonical family: ${family.familyIds.join(', ')}`);
console.log(`Acceptance evidence #${acceptance.id} (owned by deal ${acceptance.deal_card_id}, unmoved)`);
console.log(`  acres:      ${payload.acres}`);
console.log(`  basis:      ${payload.basisLabel}`);
console.log(`  observedAt: ${payload.observedAt}`);
console.log(`Governing acreage now resolved by LandOS: ${resolved.governing.value ?? 'null'} (${resolved.governing.kind ?? 'none'})`);
console.log(`Current identity v${current?.version}: apn=${current?.apn} acreage=${current?.acreage}`);
console.log(`  basis: ${current?.basis}`);

if (!current) throw new Error('Deal 90 has no current identity version to supersede');
if (payload.acres == null) throw new Error('the acceptance carries no acreage');

const basis = `Accepted governing evidence: ${payload.basisLabel ?? 'signed boundary survey held by the operator'}`
  + ` (observed ${payload.observedAt ?? 'date not stated'}), retained as operator acceptance #${acceptance.id}.`
  + ` Parcel identity ${current.apn} in ${current.county} County, ${current.state} remains confirmed against the official`
  + ' assessor/GIS parcel record. The Florida DEP statewide Cadastral 2023 geometry (1.846 ac) is retained as'
  + ' historical, non-governing: it was measured before the boundary survey and the county has not completed its'
  + ' update cycle.';

if (!APPLY) {
  console.log('\nWould create a new canonical subject version for Deal 90:');
  console.log(`  acreage: ${payload.acres}`);
  console.log(`  basis:   ${basis}`);
  console.log('\nDry run. Re-run with --apply.');
  process.exit(0);
}

const version = createPropertyIdentityVersion({
  dealCardId: CANONICAL_DEAL,
  propertyCardId: current.propertyCardId,
  status: 'confirmed',
  address: current.address,
  city: current.city,
  county: current.county,
  state: current.state,
  zip: current.zip,
  apn: current.apn,
  owner: current.owner,
  acreage: payload.acres,
  geometry: current.geometry,
  basis,
  confidence: current.confidence,
  sourceRefs: [...new Set([...(current.sourceRefs ?? []), `evidence:${acceptance.id}`])],
  changeReason: 'Promoted the operator-accepted signed-boundary-survey basis onto the canonical Deal Card. '
    + 'The acceptance evidence remains immutable and source-owned on the archived alias that recorded it; '
    + 'this version records which basis governs, and supersedes the prior version that attributed the '
    + 'governing acreage to the non-governing Cadastral 2023 layer.',
  createdBy: 'operational-closure',
  // The prior version is a confirmed accepted identity, so replacing it is an
  // explicit operator-authorized supersession, never an automated overwrite.
  allowAcceptedSupersession: true,
});

console.log(`\nCreated identity v${version.version} (#${version.id}) for Deal ${CANONICAL_DEAL}`);
console.log(`  acreage: ${version.acreage}`);
console.log(`  basis:   ${version.basis}`);

const lineage = db.prepare(
  'SELECT deal_card_id, version, is_current FROM landos_property_identity_version WHERE deal_card_id IN (90,115) ORDER BY deal_card_id, version',
).all() as Array<{ deal_card_id: number; version: number; is_current: number }>;
console.log('\nLineage preserved:');
for (const row of lineage) {
  console.log(`  deal ${row.deal_card_id} v${row.version}${row.is_current ? ' (current)' : ''}`);
}
