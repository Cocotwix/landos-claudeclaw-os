// CLI entry for the out-of-server Market Research band collector.
//   node dist/landos/mr-band-collect-cli.js <band> [maxUnits]
// Runs in its OWN process so the LandOS server event loop (the dashboard)
// stays responsive; progress is resumable via the landos_mr_band_unit ledger.
import { isAcreageBand } from './market-matrix.js';
import { runBandCollection } from './market-research-band-collector.js';

const band = process.argv[2];
const maxUnits = process.argv[3] ? Number(process.argv[3]) : 0;
if (!isAcreageBand(band)) {
  console.error(`Usage: mr-band-collect-cli <band> [maxUnits] — unknown band "${band}"`);
  process.exit(2);
}
runBandCollection(band, { maxUnits, onProgress: (m) => console.log(`${new Date().toISOString()} ${m}`) })
  .then((res) => {
    console.log(JSON.stringify(res));
    process.exit(res.status === 'completed' ? 0 : res.status === 'partial' ? 3 : 1);
  })
  .catch((e) => { console.error(String(e)); process.exit(1); });
