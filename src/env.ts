import fs from 'fs';
import path from 'path';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}

/**
 * Return an env object with the requested secret keys filled from the .env FILE
 * when they are MISSING from `base` (default process.env). The app deliberately
 * keeps secrets in the .env file (readEnvFile) and never loads them into
 * process.env (so they don't leak to child processes) — but some provider
 * adapters read their key from an env object. This bridges the two WITHOUT
 * globally mutating process.env. Honors LANDOS_DISABLE_DOTENV_FALLBACK and only
 * reads the keys that are actually missing. `reader` is injectable for tests.
 */
export function withEnvFileSecrets(
  keys: string[],
  base: NodeJS.ProcessEnv = process.env,
  reader: (k: string[]) => Record<string, string> = readEnvFile,
): NodeJS.ProcessEnv {
  if (base.LANDOS_DISABLE_DOTENV_FALLBACK) return base;
  const present = (v: string | undefined) => typeof v === 'string' && v.trim().length > 0;
  const missing = keys.filter((k) => !present(base[k]));
  if (missing.length === 0) return base;
  try {
    const fromFile = reader(missing);
    return Object.keys(fromFile).length ? { ...base, ...fromFile } : base;
  } catch {
    return base;
  }
}
