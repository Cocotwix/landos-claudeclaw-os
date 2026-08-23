// Structure the corridor distances already retained in a utility availability
// record, without researching anything.
//
// WHY THIS EXISTS. The retained record stated the measurements in prose —
// "approximately 13 ft from the parcel boundary", "approximately 41 ft from the
// north boundary" — inside its own research notes and development traces. The
// corridor observation itself carried only a relationship, so every distance
// collapsed into the single word ADJACENT, and a main thirteen feet off the
// boundary was projected exactly like one four hundred feet away.
//
// Since `distanceToBoundaryFeet` and `setting` now decide whether a position
// reads as at the property edge or merely adjoining the site, the number has to
// be on the observation. This script lifts it from the SAME retained record,
// verbatim. It runs no browser, opens no provider, calls no model and contacts
// no external source: the input is the record and the output is the record.
//
// It is additive. `landos_card_activity` is append-only and the record loader
// takes the newest row of its kind, so the prior row stays exactly where it is
// and remains readable. Nothing already retained is edited or removed.
//
// Usage:
//   node scripts/landos/structure-utility-corridor-distance.mjs --card 79 \
//     --water 13:adjoining_development --sewer 41:public_row [--apply]
//
// Without --apply it prints the before/after and writes nothing.

import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

const RECORD_KIND = 'utility_availability_resolution_v1';
const SETTINGS = new Set(['public_row', 'utility_easement', 'adjoining_development', 'within_subject', 'unknown']);

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function parseCorridor(value, label) {
  if (!value) return null;
  const [feetRaw, settingRaw] = String(value).split(':');
  const feet = Number(feetRaw);
  if (!Number.isFinite(feet) || feet < 0) throw new Error(`--${label} needs FEET[:SETTING], got "${value}"`);
  const setting = settingRaw ?? 'unknown';
  if (!SETTINGS.has(setting)) throw new Error(`--${label} setting must be one of ${[...SETTINGS].join(', ')}`);
  return { distanceToBoundaryFeet: feet, setting };
}

const cardId = Number(arg('card'));
if (!Number.isInteger(cardId)) throw new Error('--card <propertyCardId> is required');
const water = parseCorridor(arg('water'), 'water');
const sewer = parseCorridor(arg('sewer'), 'sewer');
if (!water && !sewer) throw new Error('give at least one of --water / --sewer');
const apply = process.argv.includes('--apply');

const db = new Database(path.resolve('store/landos.db'));
const row = db.prepare(
  'SELECT id, ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1',
).get(cardId, RECORD_KIND);
if (!row?.ref) throw new Error(`no retained ${RECORD_KIND} for property card ${cardId}`);

const record = JSON.parse(row.ref);
// Cloned, not referenced: the patch below mutates the parsed record in place,
// and a shared reference would make the dry run print the new value as the old.
const before = structuredClone({ water: record.water?.corridor ?? null, sewer: record.sewer?.corridor ?? null });

for (const [kind, patch] of [['water', water], ['sewer', sewer]]) {
  if (!patch) continue;
  const corridor = record[kind]?.corridor;
  if (!corridor) throw new Error(`retained record has no ${kind} corridor observation to structure`);
  // Only the two new structured fields are set. The relationship, layer, size,
  // source, screenshot and every other retained value travel untouched.
  corridor.distanceToBoundaryFeet = patch.distanceToBoundaryFeet;
  corridor.setting = patch.setting;
}

const summarize = (corridor) => (corridor
  ? `${corridor.relationship}${corridor.distanceToBoundaryFeet != null ? ` · ${corridor.distanceToBoundaryFeet} ft` : ' · no measurement'}${corridor.setting ? ` · ${corridor.setting}` : ''}`
  : 'none');

console.log(`property card ${cardId}, retained activity row ${row.id}`);
console.log(`  water before: ${summarize(before.water)}`);
console.log(`  water after : ${summarize(record.water?.corridor)}`);
console.log(`  sewer before: ${summarize(before.sewer)}`);
console.log(`  sewer after : ${summarize(record.sewer?.corridor)}`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to append the structured record.');
  process.exit(0);
}

const inserted = db.prepare(
  'INSERT INTO landos_card_activity (card_id, agent_id, kind, summary, ref) VALUES (?, ?, ?, ?, ?)',
).run(
  cardId,
  'utility-service-screen',
  RECORD_KIND,
  'Utility corridor distances structured from the retained record (no new research).',
  JSON.stringify(record),
).lastInsertRowid;

console.log(`\nAppended activity row ${inserted}. Row ${row.id} is unchanged and still readable.`);
