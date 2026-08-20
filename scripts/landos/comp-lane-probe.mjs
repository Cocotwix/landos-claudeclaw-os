// LandOS — comparable-lane retrieval probe.
//
// Runs a marketplace comp lane against ONE deal's real subject through the same
// code path the research run uses, and prints what every search route actually
// did: whether it was reached, whether the provider blocked it, how many result
// cards the page exposed, whether the page was verified as this subject's
// market, and how many records survived the lane's own filters.
//
// This exists because "ran and returned no results" was being recorded for a
// lane whose every route failed to resolve. Those are different facts and the
// operator has to be able to tell them apart.
//
// Usage:
//   node scripts/landos/comp-lane-probe.mjs --deal 83 [--lane redfin|realtor|both] [--mode sold|active|both]
//
// Safety: read-only public browsing inside a disposable context of the owned
// automation browser. Nothing is persisted; nothing touches LandPortal.

import { fetchRedfinLandComps } from '../../dist/landos/redfin-land-comps.js';
import { fetchRealtorLandComps } from '../../dist/landos/realtor-land-comps.js';
import { fetchZillowLandComps } from '../../dist/landos/zillow-land-comps.js';
import { readSessionConfig } from '../../dist/landos/browser-session.js';
import { getLandosDb } from '../../dist/landos/db.js';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dealId = Number(opt('--deal'));
const laneArg = (opt('--lane') ?? 'both').toLowerCase();
const modeArg = (opt('--mode') ?? 'both').toLowerCase();

if (!Number.isInteger(dealId) || dealId <= 0) { console.error('--deal <id> is required.'); process.exit(2); }

const subject = getLandosDb().prepare(`
  SELECT p.active_input_address, p.city, p.county, p.state, p.zip, p.apn, p.lat, p.lng, p.acres
  FROM landos_property_card p
  JOIN landos_deal_card_property d ON d.card_id = p.id
  WHERE d.deal_card_id = ? AND d.role = 'subject'
  ORDER BY d.id ASC LIMIT 1
`).get(dealId);
if (!subject) { console.error(`deal ${dealId} has no subject property card`); process.exit(2); }

const market = {
  address: subject.active_input_address || undefined,
  city: subject.city || undefined,
  county: subject.county || undefined,
  state: subject.state || undefined,
  zip: subject.zip || undefined,
  apn: subject.apn || undefined,
  lat: typeof subject.lat === 'number' ? subject.lat : undefined,
  lng: typeof subject.lng === 'number' ? subject.lng : undefined,
  subjectAcres: typeof subject.acres === 'number' ? subject.acres : null,
};

let liveMode = false;
try { liveMode = !!readSessionConfig().enabled; } catch { liveMode = false; }
const deps = liveMode ? {} : { force: true };

console.log(`[lane-probe] deal ${dealId} subject: ${JSON.stringify(market)}`);
console.log(`[lane-probe] live browser mode ${liveMode ? 'on' : 'off (forcing the lane so it is actually exercised)'}`);

const lanes = laneArg === 'both' || laneArg === 'all' ? ['zillow', 'redfin', 'realtor'] : [laneArg];
const modes = modeArg === 'both' ? ['sold', 'active'] : [modeArg];
const report = [];

for (const lane of lanes) {
  for (const mode of modes) {
    const started = Date.now();
    const result = lane === 'zillow'
      ? await fetchZillowLandComps({ ...market, mode, ...(mode === 'sold' ? { dateWindowMonths: 12 } : {}) }, deps)
      : lane === 'redfin'
        ? await fetchRedfinLandComps({ ...market, mode, ...(mode === 'sold' ? { dateWindowMonths: 12 } : {}) }, deps)
        : await fetchRealtorLandComps({ ...market, mode }, deps);
    const row = {
      lane, mode,
      elapsedMs: Date.now() - started,
      status: result.status,
      searchVerified: result.searchVerified,
      comps: result.comps.length,
      retrievalCounts: result.retrievalCounts ?? null,
      note: result.note,
      routes: result.routes,
      sample: result.comps.slice(0, 12).map((c) => ({ address: c.address, price: c.price, acres: c.acres, ppa: c.pricePerAcre, status: c.status, soldDate: c.soldDate ?? null, homeType: c.homeType ?? null })),
    };
    report.push(row);
    console.log(`\n[lane-probe] ${lane}/${mode} → status=${result.status} searchVerified=${result.searchVerified} comps=${result.comps.length} (${row.elapsedMs}ms)`);
    console.log(`  note: ${result.note}`);
    for (const route of result.routes) {
      console.log(`  · ${route.label} | reached=${route.reached} blocked=${route.blocked} cards=${route.cardsFound} marketVerified=${route.marketVerified} qualifying=${route.qualifying}`);
      console.log(`      ${route.outcome}`);
    }
    if (!result.routes.length) console.log('  · no route was attempted at all.');
  }
}

console.log('\n[lane-probe] JSON');
console.log(JSON.stringify(report, null, 2));
