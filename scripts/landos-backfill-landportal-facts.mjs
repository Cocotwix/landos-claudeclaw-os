// Deliberate, idempotent backfill: normalize parcel panels retained before the
// normalizer existed. Ordinary reads must not mutate, so this is run on
// purpose rather than lazily on a GET.
import { backfillRetainedLandPortalParcelFacts } from '../dist/landos/landportal-parcel-facts.js';

const results = backfillRetainedLandPortalParcelFacts();
for (const row of results) {
  if (!row.captures) continue;
  console.log(`deal ${row.dealCardId}: ${row.captures} capture(s), ${row.factsWritten} fact(s) written`);
  if (row.factKeys.length) console.log(`  ${row.factKeys.join(', ')}`);
}
console.log(`deals inspected: ${results.length}`);
