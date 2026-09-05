#!/usr/bin/env node
// Backfill `landos_deal_card.subject_key` for cards created before the
// canonical subject gate existed.
//
// Without this the gate is inert against the operator's real data: a new lead
// for a parcel that already has a card would find no key to match and would
// open a second active card, which is the exact defect the gate exists to stop.
//
//   node scripts/data/landos-backfill-subject-keys.mjs            # dry run
//   node scripts/data/landos-backfill-subject-keys.mjs --apply
//
// Reads each ACTIVE CANONICAL card's own current identity version (falling back
// to its linked subject Property Card when no identity version exists) and
// stores the derived key. It writes ONE column and nothing else: no identity is
// changed, no card is archived, no evidence moves.
//
// Collisions are REPORTED, never resolved here. Two active cards sharing a
// subject key is a real duplicate finding that needs the explicit
// canonicalization path and an operator decision — silently archiving one would
// move business evidence on the strength of a derived string.

import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..',
);
const DB_FILE = path.join(ROOT, 'store', 'landos.db');
const APPLY = process.argv.includes('--apply');

// The key derivation is imported from the compiled module when available so
// there is exactly one implementation; the inline fallback below mirrors
// `canonical-subject-identity.ts` for a source-only checkout.
let subjectKey;
try {
  ({ subjectKey } = await import(new URL('../../dist/landos/canonical-subject-identity.js', import.meta.url)));
} catch {
  const normalizeApn = (raw) => {
    if (typeof raw !== 'string') return null;
    const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s.length > 0 ? s : null;
  };
  const stripAbsorbedAcreage = (raw) => {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const trimmed = raw.trim();
    const match = /^(.*)(\d{1,4}\.\d{1,3})$/.exec(trimmed);
    if (!match) return trimmed;
    const acreage = Number(match[2]);
    if (!Number.isFinite(acreage) || acreage <= 0) return trimmed;
    const cleaned = match[1].replace(/[\s\-.]+$/, '');
    return normalizeApn(cleaned) == null ? trimmed : cleaned;
  };
  const normalizeState = (raw) => {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
  };
  const normalizeJurisdiction = (raw) => {
    if (typeof raw !== 'string') return null;
    const c = raw.toUpperCase().replace(/\bCOUNTY\b|\bPARISH\b|\bBOROUGH\b/g, '').replace(/[^A-Z0-9]/g, '');
    return c.length > 0 ? c : null;
  };
  const acceptZip = (zip, address) => {
    if (typeof zip !== 'string') return null;
    const digits = zip.trim().slice(0, 5);
    if (!/^\d{5}$/.test(digits)) return null;
    const house = typeof address === 'string' ? /^\s*(\d+)/.exec(address)?.[1] : undefined;
    return house && house === digits ? null : digits;
  };
  // Mirrors `isPlausibleStreetAddress` in canonical-subject-identity.ts: prose
  // pulled out of a paste must never key a subject.
  const STREET_TOKENS = new RegExp(
    '\\b(?:st|street|rd|road|ln|lane|ave|avenue|dr|drive|ct|court|blvd|boulevard|hwy|highway'
    + '|way|pkwy|parkway|trl|trail|cir|circle|pl|place|ter|terrace|loop|route|rte|pike|run'
    + '|path|row|bnd|bend|xing|crossing|holw|hollow|ridge|rdg|creek|crk|county\\s+road|cr)\\b',
    'i',
  );
  const normalizeAddress = (raw) => {
    if (typeof raw !== 'string') return null;
    const c = raw.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (c.length < 4 || c.length > 120) return null;
    if (/^\s*\d+\s+\S/.test(c)) return c;
    return STREET_TOKENS.test(c) ? c : null;
  };
  subjectKey = (input) => {
    const scope = 'whole';
    const apn = normalizeApn(stripAbsorbedAcreage(input.apn));
    const state = normalizeState(input.state);
    const jurisdiction = normalizeJurisdiction(input.county);
    if (apn && state) return { key: `apn:${state}:${jurisdiction ?? '?'}:${apn}:${scope}`, basis: 'apn', official: true };
    const address = normalizeAddress(input.address);
    const zip = acceptZip(input.zip, input.address);
    if (address && (state || zip)) {
      return { key: `addr:${state ?? '?'}:${zip ?? '?'}:${address}:${scope}`, basis: 'provisional_address', official: false };
    }
    return { key: '', basis: 'none', official: false };
  };
}

const db = new Database(DB_FILE);
db.pragma('foreign_keys = ON');

const cards = db.prepare(`
  SELECT id, title, lead_type FROM landos_deal_card
   WHERE canonical_deal_card_id IS NULL AND deleted_at IS NULL
   ORDER BY id
`).all();

const identityOf = db.prepare(`
  SELECT apn, address, city, county, state, zip FROM landos_property_identity_version
   WHERE deal_card_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1
`);
const propertyOf = db.prepare(`
  SELECT p.apn, p.active_input_address, p.city, p.county, p.state, p.zip
    FROM landos_deal_card_property dp
    JOIN landos_property_card p ON p.id = dp.card_id
   WHERE dp.deal_card_id = ? AND dp.role = 'subject'
   ORDER BY dp.id LIMIT 1
`);

const planned = [];
const byKey = new Map();
for (const card of cards) {
  const identity = identityOf.get(card.id);
  const property = identity ? null : propertyOf.get(card.id);
  const source = identity
    ? { ...identity, origin: 'identity_version' }
    : property
      ? {
        apn: property.apn, address: property.active_input_address,
        county: property.county, state: property.state, zip: property.zip, origin: 'property_card',
      }
      : null;
  if (!source) { planned.push({ id: card.id, title: card.title, leadType: card.lead_type, key: '', basis: 'none', origin: 'none' }); continue; }
  const key = subjectKey({
    apn: source.apn, address: source.address, county: source.county, state: source.state, zip: source.zip,
  });
  planned.push({ id: card.id, title: card.title, leadType: card.lead_type, key: key.key, basis: key.basis, origin: source.origin });
  if (key.key) {
    if (!byKey.has(key.key)) byKey.set(key.key, []);
    byKey.get(key.key).push(card.id);
  }
}

const collisions = [...byKey.entries()].filter(([, ids]) => ids.length > 1);
const keyed = planned.filter((p) => p.key);
const collidingIds = new Set(collisions.flatMap(([, ids]) => ids));

// CLUSTER ANCHORING. An existing duplicate cluster cannot be canonicalized
// here — choosing which of several real Deal Cards owns the subject, and what
// happens to the others' evidence, is the operator's decision. But leaving the
// whole cluster unkeyed also leaves the subject unclaimed, so the very next
// lead for that parcel opens yet another card.
//
// So exactly ONE card per cluster claims the key: the lowest-id real business
// lead. That stops the cluster growing and moves nothing. Only OFFICIAL (APN)
// keys anchor — a provisional address key is too weak to hand a whole cluster,
// and the cluster is reported for the real decision either way.
const anchors = [];
for (const [key, ids] of collisions) {
  const basis = planned.find((p) => p.id === ids[0])?.basis;
  if (basis !== 'apn') continue;
  const anchor = ids
    .map((id) => planned.find((p) => p.id === id))
    .filter((p) => p && p.leadType !== 'test')
    .sort((a, b) => a.id - b.id)[0];
  if (anchor) anchors.push({ ...anchor, key });
}
const anchorIds = new Set(anchors.map((a) => a.id));
const writable = [...keyed.filter((p) => !collidingIds.has(p.id)), ...anchors];

console.log(`Active canonical Deal Cards: ${cards.length}`);
console.log(`  keyable:            ${keyed.length} (${keyed.filter((p) => p.basis === 'apn').length} official APN, ${keyed.filter((p) => p.basis !== 'apn').length} provisional)`);
console.log(`  not keyable:        ${planned.length - keyed.length}`);
console.log(`  safe to write:      ${writable.length} (incl. ${anchors.length} cluster anchor(s))`);
console.log(`  held by collision:  ${collidingIds.size - anchors.length}`);
if (collisions.length) {
  console.log('\nDUPLICATE SUBJECTS FOUND (evidence untouched — canonicalization is an operator decision):');
  for (const [key, ids] of collisions) {
    const anchor = anchors.find((a) => a.key === key);
    console.log(`  ${key}${anchor ? `  [anchor: deal ${anchor.id}]` : '  [no anchor — provisional key]'}`);
    for (const id of ids) {
      const row = planned.find((p) => p.id === id);
      const mark = anchorIds.has(id) ? ' <- anchor' : '';
      console.log(`    deal ${id}${row?.leadType === 'test' ? ' (TEST)' : ''}: ${row?.title ?? ''}${mark}`);
    }
  }
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write the safe keys.');
  process.exit(0);
}

const write = db.prepare('UPDATE landos_deal_card SET subject_key = ?, subject_key_basis = ? WHERE id = ?');
const apply = db.transaction((rows) => {
  for (const row of rows) write.run(row.key, row.basis, row.id);
});
apply(writable);
console.log(`\nWrote subject keys for ${writable.length} Deal Card(s).`);
const check = db.prepare("PRAGMA integrity_check").get();
console.log(`integrity_check: ${check.integrity_check}`);
db.close();
