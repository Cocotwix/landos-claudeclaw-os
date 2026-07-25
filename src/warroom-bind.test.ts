/**
 * War Room network exposure contract.
 *
 * The War Room WebSocket carries no connection-level authentication of its
 * own. The dashboard token gates the Hono proxy in src/dashboard.ts, and a
 * client that dials the War Room port directly bypasses that proxy entirely.
 * Binding it to 0.0.0.0 therefore published an unauthenticated
 * agent-control-and-microphone socket to every host that could reach this
 * machine.
 *
 * These tests pin two separate things:
 *   1. Structure — no listener path in the War Room may reintroduce a
 *      hardcoded all-interfaces bind.
 *   2. Behavior — config.resolve_bind() actually returns loopback by default
 *      and actually honors an explicit WARROOM_BIND override. This half runs
 *      the real Python resolver, so it cannot pass on a source string that
 *      merely looks right.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_PY = path.join(PROJECT_ROOT, 'warroom', 'server.py');
const CONFIG_PY = path.join(PROJECT_ROOT, 'warroom', 'config.py');

const serverSource = fs.readFileSync(SERVER_PY, 'utf-8');
const configSource = fs.readFileSync(CONFIG_PY, 'utf-8');

/**
 * Resolve a usable Python interpreter, or null when this machine has none.
 * The behavioral half is skipped rather than failed in that case: the
 * structural half above still holds the line, and a missing interpreter is an
 * environment fact, not a regression in the bind contract.
 */
function findPython(): string | null {
  for (const candidate of ['python', 'python3', 'py']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const python = findPython();

/** Run config.resolve_bind() in a subprocess under a controlled environment. */
function resolveBind(env: Record<string, string | undefined>): string {
  const script = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(path.join(PROJECT_ROOT, 'warroom'))})`,
    'import config',
    'print(config.resolve_bind())',
  ].join('; ');

  // Strip the inherited value first so "unset" genuinely means unset — a
  // WARROOM_BIND already exported in the developer's shell would otherwise
  // make the default case vacuously pass.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.WARROOM_BIND;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }

  return execFileSync(python as string, ['-c', script], {
    encoding: 'utf-8',
    env: childEnv,
    cwd: PROJECT_ROOT,
  }).trim();
}

describe('War Room bind — structure', () => {
  it('server.py binds the transport to the resolved address, not a literal', () => {
    expect(serverSource).toContain('host=resolve_bind()');
  });

  it('server.py contains no hardcoded all-interfaces bind', () => {
    // Catches host="0.0.0.0" / host='0.0.0.0' in any listener path, and any
    // log line that would misreport the bind as all-interfaces.
    expect(serverSource).not.toMatch(/host\s*=\s*["']0\.0\.0\.0["']/);
    expect(serverSource).not.toContain('0.0.0.0');
  });

  it('config.py declares loopback as the default bind', () => {
    expect(configSource).toMatch(/DEFAULT_WARROOM_BIND\s*=\s*["']127\.0\.0\.1["']/);
  });

  it('config.py reads the override from WARROOM_BIND', () => {
    expect(configSource).toContain('WARROOM_BIND');
  });

  it('the dashboard War Room proxy still dials loopback', () => {
    // The proxy is what a normal operator actually uses. If it ever dialed
    // something other than loopback, tightening the server bind would break
    // the dashboard instead of only closing the LAN hole.
    const dashboard = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'dashboard.ts'), 'utf-8');
    expect(dashboard).toContain('ws://127.0.0.1:${WARROOM_PORT}');
  });
});

describe.skipIf(python === null)('War Room bind — behavior', () => {
  it('defaults to 127.0.0.1 when WARROOM_BIND is unset', () => {
    expect(resolveBind({ WARROOM_BIND: undefined })).toBe('127.0.0.1');
  });

  it('honors an explicit WARROOM_BIND override', () => {
    expect(resolveBind({ WARROOM_BIND: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveBind({ WARROOM_BIND: '192.168.1.50' })).toBe('192.168.1.50');
  });

  it('treats an empty or whitespace-only WARROOM_BIND as unset', () => {
    // A stray `WARROOM_BIND=` in .env must not read as "bind everywhere".
    expect(resolveBind({ WARROOM_BIND: '' })).toBe('127.0.0.1');
    expect(resolveBind({ WARROOM_BIND: '   ' })).toBe('127.0.0.1');
  });

  it('trims surrounding whitespace from an intentional override', () => {
    expect(resolveBind({ WARROOM_BIND: '  10.0.0.4  ' })).toBe('10.0.0.4');
  });
});
