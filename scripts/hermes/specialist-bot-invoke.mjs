// Minimal LandOS → Hermes specialist invocation seam (Bot Mode foundation,
// Slice 5). Proves LandOS can programmatically address a persistent
// specialist profile's canonical Bot Chat through a supported Hermes
// integration path, without the Desktop UI and without touching canonical
// LandOS state.
//
//   node scripts/hermes/specialist-bot-invoke.mjs <profile> "<message>"
//
// Transport (Hermes v0.20.5): the same local bot-messaging contract Hermes'
// own peer DMs document —
//
//   hermes --profile <bot> chat -c "Bot Chat" --create-if-missing -q "<msg>"
//
// The canonical persistent Bot Chat is the profile session titled "Bot Chat"
// (title-resolved, created once, resumed on every later call). Continuity is
// Hermes-side per profile; LandOS never stores the conversation as truth and
// the call writes nothing to canonical LandOS state.
//
// The API server is the identified Slice 6 seam for production migration
// (gateway api_server platform on 127.0.0.1:8642, /p/<profile>/api/sessions,
// bearer auth). It is deliberately NOT used here: named-profile routes fail
// closed unless API_SERVER_KEY exists in each profile's own secret store, and
// writing that new secret into profile .env files is approval-gated
// (PERMANENT_MEMORY invariant 8). `gateway.multiplex_profiles` and the
// four-specialist `gateway.multiplex_profile_allowlist` are already
// configured so the seam is ready the moment Tyler approves the key.

import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SPECIALISTS = new Set([
  'landos-property',
  'landos-market',
  'landos-seller',
  'landos-deal-brain',
]);

const BOT_CHAT_TITLE = 'Bot Chat';

const [profile, message] = process.argv.slice(2);
if (!SPECIALISTS.has(profile || '') || !message) {
  console.error('usage: node scripts/hermes/specialist-bot-invoke.mjs <landos-property|landos-market|landos-seller|landos-deal-brain> "<message>"');
  process.exit(2);
}

const defaultHome = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'hermes')
  : path.join(os.homedir(), '.hermes');
const agentRoot = path.join(defaultHome, 'hermes-agent');
const python = process.platform === 'win32'
  ? path.join(agentRoot, 'venv', 'Scripts', 'python.exe')
  : path.join(agentRoot, 'venv', 'bin', 'python');
const launcher = path.join(agentRoot, 'hermes');

// Reasoning-only: the clarify toolset keeps the specialist unable to browse,
// research, run commands, or write files. Capability requests stay a LandOS
// verb, never a free tool.
const result = spawnSync(python, [
  launcher,
  '--profile', profile,
  'chat',
  '-c', BOT_CHAT_TITLE,
  '--create-if-missing',
  '-t', 'clarify',
  '-q', message,
], {
  cwd: path.resolve(import.meta.dirname, '..', '..'),
  encoding: 'utf8',
  windowsHide: true,
  timeout: 600_000,
});

if (result.status !== 0) {
  const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/, 1)[0];
  console.error(`specialist invoke failed: ${detail || `Hermes exited with status ${result.status}`}`);
  process.exit(1);
}
process.stdout.write(result.stdout);
