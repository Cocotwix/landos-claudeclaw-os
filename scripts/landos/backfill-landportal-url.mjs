// Attach an operator-supplied LandPortal link to an EXISTING property card.
//
// This exists because a lead saved before the intake fix has no `lp_url`, so the
// LandPortal lanes still rediscover the parcel by search instead of opening the
// record the operator already found. It writes exactly one column through the
// app's own upsert, which preserves every other field, and it never creates a
// card or a lead.
//
//   node scripts/landos/backfill-landportal-url.mjs <cardId> <url>
//
// It prints the before/after value so the change is visible and reviewable.

import { upsertCardFromDukeRun, getPropertyCardRow } from '../../dist/landos/property-card.js';
import { operatorLandPortalEntryUrl, isVerifiedLandPortalSubjectUrl } from '../../dist/landos/landportal-operating-rules.js';

const [cardIdRaw, url] = process.argv.slice(2);
const cardId = Number(cardIdRaw);

if (!Number.isInteger(cardId) || !url) {
  console.error('usage: node scripts/landos/backfill-landportal-url.mjs <cardId> <landportal-url>');
  process.exit(2);
}

const entry = operatorLandPortalEntryUrl(url);
if (!entry) {
  console.error(`Refused: ${url} is not a LandPortal link this system will open as an entry point.`);
  process.exit(1);
}

const before = getPropertyCardRow(cardId);
if (!before) {
  console.error(`Refused: no property card ${cardId}.`);
  process.exit(1);
}

console.log(`card ${cardId} (${before.active_input_address})`);
console.log(`  lp_url before      : ${JSON.stringify(before.lp_url)}`);
console.log(`  carries identity   : ${isVerifiedLandPortalSubjectUrl(entry)}`);
console.log(`  entry point only   : ${!isVerifiedLandPortalSubjectUrl(entry)} (open + verify still required)`);

upsertCardFromDukeRun({
  entity: before.entity,
  cardId,
  activeInputAddress: before.active_input_address,
  lpUrl: entry,
  // Nothing else is supplied, so the upsert's own preserve-on-blank rule leaves
  // every other field exactly as it was. This is a hint, never a verification:
  // `verified` stays false and no verification source is claimed.
  verified: false,
});

const after = getPropertyCardRow(cardId);
console.log(`  lp_url after       : ${JSON.stringify(after.lp_url)}`);
console.log(`  apn unchanged      : ${JSON.stringify(before.apn)} -> ${JSON.stringify(after.apn)}`);
console.log(`  owner unchanged    : ${JSON.stringify(before.owner)} -> ${JSON.stringify(after.owner)}`);
console.log(`  verification status: ${after.verification_status}`);
