import { importHermesLandPortalFile } from '../../src/landos/hermes-landportal-import.js';

function usage(): never {
  throw new Error('Usage: npx tsx scripts/landportal/import-hermes-landportal.ts <hermes-json-path> [--property-card-id <id>]');
}

const args = process.argv.slice(2);
const filePath = args[0] || usage();
let propertyCardId: number | undefined;
for (let index = 1; index < args.length; index += 1) {
  if (args[index] !== '--property-card-id') usage();
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1) usage();
  propertyCardId = value;
  index += 1;
}

try {
  const result = importHermesLandPortalFile(filePath, { propertyCardId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
