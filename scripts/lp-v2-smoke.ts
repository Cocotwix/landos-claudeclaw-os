// Manual LandPortal API v2 diagnostic script. Run by hand only -- it makes LIVE
// LandPortal v2 calls. It is NOT wired into tests, build, startup, the dashboard,
// or any agent flow.
//
// It MAY call (exact parcel lookup only):
//   GET /v2/properties
//   GET /v2/properties/{propertyId}
// It MUST NOT call:
//   GET /v2/properties/point   (coordinate/point lookup)
//   /reports or any comp endpoint (lp_comp_report_create / lp_comp_report_get)
//
// Output is deliberately constrained:
//   - token diagnostics are value-free (booleans + a source label only -- never
//     the value, length, hash, fingerprint, or any characters)
//   - results are a safe whitelist only (status, verified, match/presence
//     booleans, candidate count, and the adapter's safe match_notes)
// It never prints the token, .env contents, process.env, Authorization headers,
// Bearer strings, or raw/full property responses.
//
// Usage (generic examples; supply your own parcel):
//   LANDPORTAL_API_VERSION=v2 npx tsx scripts/lp-v2-smoke.ts --apn 5149-021 --fips 06037
//   LANDPORTAL_API_VERSION=v2 npx tsx scripts/lp-v2-smoke.ts --address "123 Main St" --city "Los Angeles" --state CA --zip 90012

import fs from 'fs';
import path from 'path';
import { lpResolveForPreflight, apnMatchKey, type LpResolveArgs } from '../src/landos/landportal-client.js';
import { PROJECT_ROOT } from '../src/config.js';

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : undefined;
}

// ── Value-free token diagnostics ─────────────────────────────────────────────
// Report ONLY booleans/labels. Never the value, length, characters, hash, or
// any fingerprint of a token, and never a line from .env.
const ENV_FILE = path.join(PROJECT_ROOT, '.env');

function presentInProcessEnv(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

function presentInEnvFile(key: string): boolean {
  try {
    const content = fs.readFileSync(ENV_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      if (t.slice(0, eq).trim() !== key) continue;
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) val = val.slice(1, -1);
      return val.length > 0; // boolean only -- never the value
    }
  } catch { /* ignore */ }
  return false;
}

function tokenDiagnostics() {
  const v2InProc = presentInProcessEnv('LANDPORTAL_V2_TOKEN');
  const v2InFile = presentInEnvFile('LANDPORTAL_V2_TOKEN');
  const v1InProc = presentInProcessEnv('LP_JWT_TOKEN');
  const v1InFile = presentInEnvFile('LP_JWT_TOKEN');
  const v2Present = v2InProc || v2InFile;
  const v1Present = v1InProc || v1InFile;
  // Mirror readLpV2Token precedence: prefer LANDPORTAL_V2_TOKEN, else LP_JWT_TOKEN.
  const selected_token_source = v2Present ? 'LANDPORTAL_V2_TOKEN' : v1Present ? 'LP_JWT_TOKEN' : 'NONE';
  return {
    landportal_v2_token_present_in_process_env: v2InProc,
    landportal_v2_token_present_in_repo_env_file: v2InFile,
    lp_jwt_token_present_in_process_env: v1InProc,
    lp_jwt_token_present_in_repo_env_file: v1InFile,
    selected_token_source,
  };
}

async function main(): Promise<void> {
  // Fail closed: this harness runs v2 smoke calls ONLY. The shared client
  // defaults to the v1 path when the flag is missing/typoed, so refuse to run
  // (before any LandPortal client call) unless the operator explicitly opted in.
  // We never set the flag internally.
  if (process.env.LANDPORTAL_API_VERSION !== 'v2') {
    console.log(JSON.stringify({
      refused: true,
      message: 'Refusing to run: set LANDPORTAL_API_VERSION=v2 for this manual LandPortal v2 smoke harness.',
    }));
    process.exit(1);
  }

  // Value-free token diagnostics (booleans/labels only).
  console.log(JSON.stringify({ token_diagnostics: tokenDiagnostics() }, null, 2));

  const apn = arg('--apn');
  const fips = arg('--fips');
  const address = arg('--address');
  const city = arg('--city');
  const state = arg('--state');
  const zip = arg('--zip');

  const args: LpResolveArgs = apn
    ? { apn, ...(fips ? { fips } : {}) }
    : {
        ...(address ? { address } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(zip ? { zip } : {}),
      };

  const r = await lpResolveForPreflight(args, 20_000);

  const apnMatch = apn ? apnMatchKey(apn).length > 0 && apnMatchKey(apn) === apnMatchKey(r.apn) : 'n/a';
  const fipsMatch = fips ? fips === (r.fips ?? '') : 'n/a';
  const addressMatch = address ? r.verified : 'n/a';

  // Whitelist only. match_notes is safe by construction (never contains token).
  console.log(JSON.stringify({
    input_kind: apn ? 'apn/fips' : 'address',
    status: r.status,
    verified: r.verified,
    apn_match: apnMatch,
    fips_match: fipsMatch,
    address_match: addressMatch,
    returned_apn_present: !!r.apn,
    returned_fips_present: !!r.fips,
    returned_address_present: !!r.situs_address,
    candidate_count: r.candidates?.length ?? 0,
    match_notes: r.match_notes,
  }, null, 2));
}

main().catch((err) => {
  // Print only the error message, never a stack/object that could carry env.
  console.log(JSON.stringify({ fatal: true, message: (err as Error)?.message ?? String(err) }));
  process.exit(1);
});
