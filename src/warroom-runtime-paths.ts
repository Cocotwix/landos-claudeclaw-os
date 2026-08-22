/**
 * Platform-safe runtime file locations for the War Room voice stack.
 *
 * The Node dashboard and the Python Pipecat server share small state files
 * (agent roster, pin, voice-session binding, subprocess log). These
 * historically lived under literal `/tmp/...`, which is not a real
 * directory on Windows. Both sides now agree on
 * `<PROJECT_ROOT>/.runtime/warroom/` — mirrored in `warroom/config.py`
 * (RUNTIME_DIR). Keep the two in sync.
 */

import fs from 'fs';
import path from 'path';

import { PROJECT_ROOT } from './config.js';

export const WARROOM_RUNTIME_DIR = path.join(PROJECT_ROOT, '.runtime', 'warroom');

/** Ensure the runtime dir exists and return the absolute path for `name`. */
export function warroomRuntimeFile(name: string): string {
  fs.mkdirSync(WARROOM_RUNTIME_DIR, { recursive: true });
  return path.join(WARROOM_RUNTIME_DIR, name);
}

/** Agent roster written by Node, read by the Python voice stack. */
export const WARROOM_ROSTER_FILE = 'warroom-agents.json';
/** Voice pin/mode state written by the dashboard, read by Python. */
export const WARROOM_PIN_FILE = 'warroom-pin.json';
/** Deal-scoped voice session binding (Slice 8 unified War Room). */
export const WARROOM_VOICE_SESSION_FILE = 'warroom-voice-session.json';
/** Python subprocess stdout/stderr log. */
export const WARROOM_DEBUG_LOG_FILE = 'warroom-debug.log';

/**
 * Command-line fragment that identifies the running voice server process.
 *
 * Process lookup matches the literal command line, and Windows spawns the
 * script as `...\warroom\server.py`. A hardcoded POSIX `warroom/server.py`
 * therefore matched nothing on Windows, so every respawn (voice binding,
 * pin change, voice config apply) silently did nothing and the server kept
 * running with stale configuration.
 */
export const WARROOM_SERVER_PROCESS_PATTERN =
  path.join('warroom', 'server.py');
