// LandOS — the governed FREE, KEYLESS, NON-BROWSER search transport.
//
// This is not a new search architecture. It is the transport LandOS governance
// already selected, made callable from the Universal Property Resolver:
//
//   config/hermes/governance/approved-capabilities.json
//     freeSearch.selected = "duckduckgo-search"   status: selected-enabled
//     runtimeRequirements.pythonPackages.ddgs = "9.14.4"
//   config/landos-research/capabilities.json
//     id: duckduckgo-search  selection: primary  costPolicy: free-keyless-only
//     runtimeState: installed  runtimeVersion: 9.14.4
//
// It runs inside the SAME pinned Hermes Python runtime the governed MCP
// launcher resolves (`mcp/landos/run_server.py`), so there is one runtime
// contract rather than two:
//
//   LANDOS_SEARCH_PYTHON  →  LANDOS_MCP_PYTHON  →  the pinned Hermes venv
//
// Properties that matter for the parallel-sprint boundary:
//   • No browser, no CDP, no Playwright. A child process and stdout.
//   • No API key, no account, no paid credit. `ddgs` is keyless by design.
//   • The query travels on STDIN, never in argv, so it never reaches a process
//     listing, and the child receives a MINIMAL environment rather than this
//     process's, so no credential can leak into it.
//   • It returns candidate URLs and snippets ONLY. Nothing here establishes
//     identity; the resolver's existing gate does that.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface IdentitySearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface IdentitySearchOptions {
  maxResults?: number;
  timeoutMs?: number;
}

/** What the indexed-web identity lane consumes. One function, injectable. */
export type IdentitySearchProvider = (query: string, options?: IdentitySearchOptions) => Promise<IdentitySearchHit[]>;

export interface HermesFreeSearchAvailability {
  available: boolean;
  /** Absolute path to the runtime, or null. Never a credential. */
  python: string | null;
  /** Installed `ddgs` version, when it could be read. */
  ddgsVersion: string | null;
  reason: string;
}

/**
 * The pinned Python runtime, resolved exactly the way the governed MCP launcher
 * resolves it. An override must be absolute and must exist — a relative or
 * missing path is a configuration error, never a silent fallback.
 */
export function resolveGovernedPython(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ['LANDOS_SEARCH_PYTHON', 'LANDOS_MCP_PYTHON'] as const) {
    const configured = (env[key] ?? '').trim();
    if (!configured) continue;
    if (!path.isAbsolute(configured)) return null;
    return fs.existsSync(configured) && fs.statSync(configured).isFile() ? configured : null;
  }
  const localAppData = (env.LOCALAPPDATA ?? '').trim();
  if (!localAppData) return null;
  const candidate = path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe');
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** The child receives only what a keyless search needs. Never this process's env. */
function minimalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'HOME', 'USERPROFILE', 'LANG'];
  const out: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
  for (const key of allowed) if (env[key]) out[key] = env[key];
  return out;
}

function runPython(
  python: string,
  script: string,
  stdin: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(python, ['-B', '-c', script], { env: minimalEnv(env), windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, Math.max(1_000, timeoutMs));
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${(error as Error).message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(stdin);
  });
}

const AVAILABILITY_SCRIPT = `
import json, sys
try:
    import importlib.metadata as meta
    from ddgs import DDGS  # noqa: F401
    print(json.dumps({"ok": True, "version": meta.version("ddgs")}))
except Exception as exc:  # pragma: no cover - reported, never raised
    print(json.dumps({"ok": False, "error": type(exc).__name__ + ": " + str(exc)}))
`.trim();

const SEARCH_SCRIPT = `
import json, sys
try:
    from ddgs import DDGS
except Exception as exc:
    print(json.dumps({"ok": False, "error": "ddgs unavailable: " + type(exc).__name__ + ": " + str(exc)}))
    sys.exit(0)
try:
    request = json.loads(sys.stdin.read() or "{}")
    rows = DDGS().text(
        request.get("query", ""),
        max_results=int(request.get("maxResults", 8)),
        region=request.get("region") or "us-en",
    ) or []
    print(json.dumps({"ok": True, "results": [
        {"title": r.get("title") or "", "url": r.get("href") or "", "snippet": r.get("body") or ""}
        for r in rows if r.get("href")
    ]}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": type(exc).__name__ + ": " + str(exc)}))
`.trim();

/**
 * Is the governed free-search capability actually installed?
 *
 * Verifies the INSTALLATION, not the documentation: the runtime must exist and
 * must be able to import `ddgs`. No network call is made.
 */
export async function hermesFreeSearchAvailability(
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<HermesFreeSearchAvailability> {
  const env = options.env ?? process.env;
  const python = resolveGovernedPython(env);
  if (!python) {
    return { available: false, python: null, ddgsVersion: null, reason: 'No governed Python runtime was resolved (LANDOS_SEARCH_PYTHON, LANDOS_MCP_PYTHON, or the pinned Hermes venv).' };
  }
  const outcome = await runPython(python, AVAILABILITY_SCRIPT, '', options.timeoutMs ?? 20_000, env);
  if (outcome.timedOut) return { available: false, python, ddgsVersion: null, reason: 'The governed Python runtime did not answer the capability probe in time.' };
  try {
    const parsed = JSON.parse(outcome.stdout.trim() || '{}') as { ok?: boolean; version?: string; error?: string };
    return parsed.ok
      ? { available: true, python, ddgsVersion: parsed.version ?? null, reason: `Governed keyless search is installed (ddgs ${parsed.version ?? 'unknown'}).` }
      : { available: false, python, ddgsVersion: null, reason: `The governed runtime could not load ddgs: ${parsed.error ?? 'unknown error'}.` };
  } catch {
    return { available: false, python, ddgsVersion: null, reason: 'The governed runtime returned an unreadable capability probe result.' };
  }
}

/**
 * The governed free-search provider.
 *
 * Returns [] rather than throwing when the capability is unavailable or the
 * search is refused: an identity lane that cannot search reports no evidence,
 * it never fails the mission.
 */
export function createHermesFreeSearch(
  options: { env?: NodeJS.ProcessEnv; python?: string | null; region?: string } = {},
): IdentitySearchProvider {
  const env = options.env ?? process.env;
  const python = options.python === undefined ? resolveGovernedPython(env) : options.python;
  return async (query, searchOptions = {}) => {
    if (!python || !query.trim()) return [];
    const payload = JSON.stringify({
      query: query.trim(),
      maxResults: Math.max(1, Math.min(searchOptions.maxResults ?? 8, 25)),
      region: options.region ?? 'us-en',
    });
    const outcome = await runPython(python, SEARCH_SCRIPT, payload, searchOptions.timeoutMs ?? 25_000, env);
    if (outcome.timedOut) return [];
    try {
      const parsed = JSON.parse(outcome.stdout.trim() || '{}') as { ok?: boolean; results?: IdentitySearchHit[] };
      if (!parsed.ok || !Array.isArray(parsed.results)) return [];
      return parsed.results
        .filter((row) => typeof row?.url === 'string' && /^https?:\/\//i.test(row.url))
        .map((row) => ({ title: String(row.title ?? ''), url: row.url, snippet: String(row.snippet ?? '') }));
    } catch {
      return [];
    }
  };
}
