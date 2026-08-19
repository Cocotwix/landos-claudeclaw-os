// Provision the dedicated Hermes Acquisition Analyst profile.
//
// This is the SAME provisioning shape `provision-landos-profile.mjs` already
// uses for the LandPortal worker: create the profile once, set its config keys,
// copy the LandOS-owned persona, memory and skill templates over it, verify.
// It deliberately does not introduce a second Hermes architecture.
//
// What the profile owns and keeps across runs:
//   • SOUL.md                      the land-acquisition operating instructions
//   • memories/                    persistent memory (Hermes memory enabled)
//   • skills/landos-acquisition-analysis
//                                  the reusable HOW-TO-EVALUATE-LAND procedure
//
// What the profile does NOT own is the runtime reasoning model. The model and
// provider are ordinary config values written here as the V1 DEFAULT (Gemma 4
// on the local Ollama runtime) and overridden per invocation by LandOS. Swapping
// the model therefore never touches the persona, the skill, or the memory.
//
// Local reasoning only: this profile has no web, browser or terminal toolset,
// so an Acquisition Intelligence run cannot start research of its own.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import yaml from 'js-yaml';

export const ACQUISITION_ANALYST_PROFILE = 'landos-acquisition-analyst';
export const ACQUISITION_ANALYST_SKILL = 'landos-acquisition-analysis';

/** V1 runtime default: Gemma 4 through the local Ollama server.
 *  Hermes resolves the `ollama` provider alias to its local OpenAI-compatible
 *  `custom` transport, so the base URL is the Ollama /v1 endpoint. */
export const DEFAULT_ANALYST_PROVIDER = 'ollama';
export const DEFAULT_ANALYST_MODEL = 'gemma4:12b';
export const DEFAULT_ANALYST_BASE_URL = 'http://localhost:11434/v1';

/**
 * Context window for the local runtime. Two numbers, because they answer two
 * different questions and getting them confused breaks the read silently.
 *
 * `ollama_num_ctx` is what Ollama LOADS the model with. Its default is 4096,
 * and an entire property file does not fit in 4096 tokens — without this the
 * analyst reasons over a TRUNCATED dossier while still emitting something that
 * looks like a complete read. That is the worst failure available here, so it
 * is configured rather than left to a default. Hermes additionally refuses to
 * run an agent on a runtime context below 64K, so 64K is the floor, not a
 * preference.
 *
 * `context_length` is what the model can DO. Gemma 4 12B's real window is 256K;
 * stating it keeps the same gate satisfied on the model side.
 */
export const DEFAULT_ANALYST_LOADED_CONTEXT_TOKENS = 65536;
export const DEFAULT_ANALYST_MODEL_CONTEXT_TOKENS = 262144;

const workspace = path.resolve(import.meta.dirname, '..', '..');
const templates = path.join(workspace, 'config', 'hermes', 'acquisition-analyst');
const defaultHome = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'hermes')
  : path.join(os.homedir(), '.hermes');
const agentRoot = path.join(defaultHome, 'hermes-agent');
const python = process.platform === 'win32'
  ? path.join(agentRoot, 'venv', 'Scripts', 'python.exe')
  : path.join(agentRoot, 'venv', 'bin', 'python');
const launcher = path.join(agentRoot, 'hermes');
const profileHome = path.join(defaultHome, 'profiles', ACQUISITION_ANALYST_PROFILE);
const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`LandOS Acquisition Analyst: ${message}`);
  process.exitCode = 1;
}

function runHermes(args) {
  const result = spawnSync(python, [launcher, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/, 1)[0];
    throw new Error(detail || `Hermes exited with status ${result.status}`);
  }
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

/** LandOS-owned template files. The persona and the skill are overwritten on
 *  every provision so the repository stays the source of truth for them.
 *  MEMORY.md/USER.md are SEEDS: they are written once and then left alone, so
 *  the analyst's learned procedures survive reprovisioning. */
const OVERWRITTEN = [
  ['SOUL.md', 'SOUL.md'],
  [
    path.join('skills', ACQUISITION_ANALYST_SKILL, 'SKILL.md'),
    path.join('skills', ACQUISITION_ANALYST_SKILL, 'SKILL.md'),
  ],
];
const SEEDED = [
  [path.join('memories', 'MEMORY.md'), path.join('memories', 'MEMORY.md')],
  [path.join('memories', 'USER.md'), path.join('memories', 'USER.md')],
];

function verify() {
  const failures = [];
  const configPath = path.join(profileHome, 'config.yaml');
  if (!fs.existsSync(configPath)) failures.push('config.yaml is missing');
  else {
    const config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
    if (!String(config?.model?.provider || '').trim()) failures.push('model.provider is not set');
    if (!String(config?.model?.default || '').trim()) failures.push('model.default is not set');
    if (Number(config?.model?.ollama_num_ctx || 0) < 64000) {
      failures.push('model.ollama_num_ctx is below the 64K runtime context Hermes requires');
    }
    // Hermes refuses to run an agent on a model it believes has under 64K.
    if (Number(config?.model?.context_length || 0) < 64000) {
      failures.push('model.context_length is below the 64K minimum Hermes requires');
    }
    if (config?.memory?.memory_enabled !== true) failures.push('memory.memory_enabled is not true');
    if (config?.memory?.user_profile_enabled !== true) failures.push('memory.user_profile_enabled is not true');
  }
  for (const [, targetRelative] of [...OVERWRITTEN, ...SEEDED]) {
    if (!fs.existsSync(path.join(profileHome, targetRelative))) failures.push(`${targetRelative} is missing`);
  }
  if (failures.length) {
    for (const failure of failures) fail(failure);
    return false;
  }
  const config = yaml.load(fs.readFileSync(path.join(profileHome, 'config.yaml'), 'utf8')) || {};
  console.log(`LandOS Acquisition Analyst ready: ${profileHome}`);
  console.log(`  runtime default: ${config.model.provider} / ${config.model.default}`);
  console.log(`  context window:  ${config.model.ollama_num_ctx} loaded / ${config.model.context_length} model`);
  console.log(`  skill: ${ACQUISITION_ANALYST_SKILL}`);
  return true;
}

if (!fs.existsSync(python) || !fs.existsSync(launcher)) {
  fail(`installed Hermes runtime not found under ${agentRoot}`);
} else if (checkOnly) {
  verify();
} else {
  try {
    if (!fs.existsSync(profileHome)) {
      runHermes([
        'profile', 'create', ACQUISITION_ANALYST_PROFILE,
        '--no-skills', '--no-alias',
        '--description', 'LandOS Acquisition Analyst: reasons across a completed LandOS property dossier and returns one structured acquisitions read.',
      ]);
    }

    // Runtime model + provider. Written as the DEFAULT only; LandOS overrides
    // both per invocation, so changing the reasoning engine later is a setting,
    // never a reprovision and never a loss of persona, skills, or memory.
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'model.provider', DEFAULT_ANALYST_PROVIDER]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'model.default', DEFAULT_ANALYST_MODEL]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'model.base_url', DEFAULT_ANALYST_BASE_URL]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'model.ollama_num_ctx', String(DEFAULT_ANALYST_LOADED_CONTEXT_TOKENS)]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'model.context_length', String(DEFAULT_ANALYST_MODEL_CONTEXT_TOKENS)]);
    // The image pass runs on the same local runtime rather than reaching for a
    // hosted vision model: the analyst inspects retained property imagery on
    // this machine, and nothing about a read leaves it.
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'auxiliary.vision.provider', DEFAULT_ANALYST_PROVIDER]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'auxiliary.vision.model', DEFAULT_ANALYST_MODEL]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'auxiliary.vision.base_url', DEFAULT_ANALYST_BASE_URL]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'terminal.backend', 'local']);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'terminal.cwd', workspace]);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'memory.memory_enabled', 'true']);
    runHermes(['--profile', ACQUISITION_ANALYST_PROFILE, 'config', 'set', 'memory.user_profile_enabled', 'true']);

    for (const [sourceRelative, targetRelative] of OVERWRITTEN) {
      copyFile(path.join(templates, sourceRelative), path.join(profileHome, targetRelative));
    }
    for (const [sourceRelative, targetRelative] of SEEDED) {
      const target = path.join(profileHome, targetRelative);
      if (!fs.existsSync(target)) copyFile(path.join(templates, sourceRelative), target);
    }
    verify();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
