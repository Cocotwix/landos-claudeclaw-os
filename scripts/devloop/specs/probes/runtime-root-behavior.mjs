// Evaluator-owned probe: the runtime's own behaviour must be untouched. The
// defect is in the test's expectation, not in sanitizeEnvironment.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function fail(reason) {
  console.log(`PROBE_FAIL: ${reason}`);
  process.exit(1);
}

const target = path.resolve('scripts/runtime/landos-runtime.mjs');
let mod;
try {
  mod = await import(pathToFileURL(target).href);
} catch (error) {
  fail(`could not import scripts/runtime/landos-runtime.mjs (${error.message})`);
}

for (const name of ['sanitizeEnvironment', 'ROOT']) {
  if (!(name in mod)) fail(`scripts/runtime/landos-runtime.mjs no longer exports ${name}`);
}

// ROOT must be the checkout the module lives in, whatever that directory is
// called. This is the property the suite should have been asserting.
if (path.resolve(mod.ROOT) !== path.resolve(process.cwd())) {
  fail(`ROOT resolved to ${mod.ROOT} but the checkout being evaluated is ${process.cwd()}`);
}

const environment = mod.sanitizeEnvironment('probe-runtime-id', {
  PATH: 'C:\\Tools;C:\\Windows\\System32',
  Path: 'C:\\MoreTools;C:\\Tools',
  SystemRoot: 'C:\\Windows',
  TEMP: 'C:\\Temp',
});

if (environment.LANDOS_RUNTIME_ID !== 'probe-runtime-id') {
  fail(`sanitizeEnvironment no longer sets LANDOS_RUNTIME_ID, got ${JSON.stringify(environment.LANDOS_RUNTIME_ID)}`);
}
if (path.resolve(environment.LANDOS_RUNTIME_ROOT ?? '') !== path.resolve(mod.ROOT)) {
  fail(
    'sanitizeEnvironment must set LANDOS_RUNTIME_ROOT to the repository root, got ' +
      `${JSON.stringify(environment.LANDOS_RUNTIME_ROOT)} against ROOT ${mod.ROOT}`,
  );
}
const pathKeys = Object.keys(environment).filter((key) => key.toUpperCase() === 'PATH');
if (JSON.stringify(pathKeys) !== JSON.stringify(['Path'])) {
  fail(`sanitizeEnvironment must collapse PATH casing to a single "Path" key, got ${JSON.stringify(pathKeys)}`);
}
for (const fragment of ['C:\\Tools', 'C:\\MoreTools']) {
  if (!environment.Path.includes(fragment)) fail(`sanitizeEnvironment dropped ${fragment} from Path: ${environment.Path}`);
}

console.log('PROBE_OK runtime behaviour unchanged');
