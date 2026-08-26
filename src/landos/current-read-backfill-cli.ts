// LandOS — one-shot CURRENT READ backfill runner.
//
//   node dist/landos/current-read-backfill-cli.js <dealCardId> [layers...]
//
// Repairs persisted intelligence products that predate the Current Read
// upgrade. Reads the persisted product, asks that layer's own specialist for
// the operator brief it would have written, and supersedes the snapshot with
// the read attached. No research, no web search, no Stage A rerun. A layer that
// already carries a read costs nothing.

import { invokeHermesCli, resolveAnalystModel } from './acquisition-analyst.js';
import { readDerivedSnapshot, writeDerivedSnapshot } from './derived-intelligence-store.js';
import {
  DEAL_INTELLIGENCE_PRODUCT_TYPE,
  MARKET_INTELLIGENCE_PRODUCT_TYPE,
  PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
} from './intelligence-stack-contract.js';
import {
  backfillCurrentReads,
  type BackfillLayerResult,
  type CurrentReadLayer,
} from './current-read-backfill.js';
import { SPECIALIST_PROFILES, specialistInvocationArgs } from './specialist-intelligence-executor.js';

const SNAPSHOT_TYPE: Record<CurrentReadLayer, string> = {
  property: PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
  market: MARKET_INTELLIGENCE_PRODUCT_TYPE,
  deal: DEAL_INTELLIGENCE_PRODUCT_TYPE,
};

const CURRENT_READ_ACTOR = 'current-read-backfill';
const TIMEOUT_MS = 20 * 60_000;

export async function runCurrentReadBackfill(
  dealCardId: number,
  layers: readonly CurrentReadLayer[],
): Promise<BackfillLayerResult[]> {
  const model = resolveAnalystModel({ provider: null, model: null });
  return backfillCurrentReads({
    layers,
    deps: {
      readProduct: (layer) => readDerivedSnapshot<Record<string, unknown>>(dealCardId, SNAPSHOT_TYPE[layer]),
      writeProduct: (layer, product) => {
        writeDerivedSnapshot({
          dealCardId,
          snapshotType: SNAPSHOT_TYPE[layer],
          payload: product,
          completeness: { currentRead: true },
          changeReason: `Current Read synthesized by ${SPECIALIST_PROFILES[layer]} from the persisted ${layer} product. No research ran.`,
          actor: CURRENT_READ_ACTOR,
          auditEvent: 'current_read_backfill',
        });
      },
      invoke: (layer, prompt) => invokeHermesCli(
        specialistInvocationArgs({ profile: SPECIALIST_PROFILES[layer], prompt, model }),
        TIMEOUT_MS,
      ),
    },
  });
}

async function main(): Promise<void> {
  const [rawDeal, ...rest] = process.argv.slice(2);
  const dealCardId = Number(rawDeal);
  if (!Number.isInteger(dealCardId) || dealCardId <= 0) {
    console.error('Usage: current-read-backfill-cli <dealCardId> [property|market|deal ...]');
    process.exit(2);
    return;
  }
  const requested = rest.filter((item): item is CurrentReadLayer =>
    item === 'property' || item === 'market' || item === 'deal');
  const layers: CurrentReadLayer[] = requested.length ? requested : ['property', 'market', 'deal'];

  const results = await runCurrentReadBackfill(dealCardId, layers);
  for (const result of results) {
    console.log(`\n===== ${result.layer.toUpperCase()} :: ${result.status} :: modelCalls=${result.modelCalls} :: outlook=${result.outlook?.status ?? 'none'}`);
    if (result.detail) console.log(`detail: ${result.detail}`);
    if (result.read) console.log(result.read);
  }
  const failed = results.filter((result) => result.status === 'failed');
  if (failed.length) process.exit(1);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('current-read-backfill-cli.js');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
