// Provision the four persistent LandOS specialist Hermes profiles (Bot Mode
// foundation, Slice 5).
//
// Same provisioning shape as `provision-acquisition-analyst.mjs`: create each
// profile once, set its config keys, copy the LandOS-owned persona and memory
// seeds over it, verify. No second Hermes architecture is introduced — a
// "Bot" here IS a Hermes profile; LandOS references and governs it.
//
// What each profile owns and keeps across runs:
//   • SOUL.md              the specialist mandate (overwritten each provision;
//                          the repository stays the source of truth for it)
//   • memories/            persistent cognitive memory (SEEDED once, then the
//                          profile's learned reasoning survives reprovisioning)
//   • sessions/state       the canonical Bot Chat and session continuity
//
// What no profile owns: canonical LandOS facts. The memory seeds and SOULs
// state the authority boundary explicitly; bot memory is cognitive, LandOS
// current evidence is factual truth on every run.
//
// Reasoning-only foundation: profiles are created with --no-skills. LandOS
// grants governed search only to the Market Stage A invocation; Stage B and
// every other specialist remain on the non-research clarify toolset. Profile
// provisioning itself grants no free terminal or research workflow.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import yaml from 'js-yaml';

/** The four persistent specialists. Names follow the existing `landos-<role>`
 *  profile convention already used by the worker and governed profiles. */
export const SPECIALIST_PROFILES = [
  {
    name: 'landos-property',
    title: 'Property Intelligence',
    template: 'landos-property',
    description:
      'LandOS Property Intelligence specialist: reasons over canonical property evidence, records, and grounded visual observations to say what is actually true and materially important about the subject property. Never researches; requests bounded LandOS verification.',
    vision: true,
  },
  {
    name: 'landos-market',
    title: 'Market + Area Intelligence',
    template: 'landos-market',
    description:
      'LandOS Market + Area Intelligence specialist: reads the complete market file and may use governed public web search for material gaps and time-sensitive market evidence. LandOS remains canonical.',
    vision: false,
  },
  {
    name: 'landos-seller',
    title: 'Seller Intelligence',
    template: 'landos-seller',
    description:
      'LandOS Seller Intelligence specialist: reasons over calls, messages, notes, and seller-reported facts to understand the seller, keeping SELLER-REPORTED vs FACT vs INTERPRETATION vs HYPOTHESIS strictly separate. Never turns an inference into canonical fact.',
    vision: false,
  },
  {
    name: 'landos-deal-brain',
    title: 'Deal Brain',
    template: 'landos-deal-brain',
    description:
      'LandOS Deal Brain: executive chair above the specialist reads. Synthesizes Property, Market, and Seller intelligence with deterministic economics into what matters, what conflicts, and what Tyler should do next. Quotes deterministic numbers verbatim; never manufactures consensus.',
    vision: false,
  },
];

/** Same primary reasoning pair the acquisition analyst resolves to, so the
 *  foundation pins the existing preferred reasoning path and introduces no
 *  new provider. A DEFAULT only: LandOS may override per invocation, so
 *  changing the engine stays a setting, never a reprovision. */
export const SPECIALIST_PROVIDER = 'openai-codex';
export const SPECIALIST_MODEL = 'gpt-5.6-sol';

/** Local Ollama route + vision auxiliary, property specialist only — the same
 *  local pair the analyst uses, so retained property imagery is inspected on
 *  this machine. See provision-acquisition-analyst.mjs for the full rationale
 *  on the two context numbers. */
export const SPECIALIST_VISION_PROVIDER = 'ollama';
export const SPECIALIST_VISION_MODEL = 'gemma4:12b';
export const LOCAL_RUNTIME_BASE_URL = 'http://localhost:11434/v1';
export const LOCAL_RUNTIME_LOADED_CONTEXT_TOKENS = 65536;
export const SPECIALIST_MODEL_CONTEXT_TOKENS = 1_050_000;

const workspace = path.resolve(import.meta.dirname, '..', '..');
const templatesRoot = path.join(workspace, 'config', 'hermes', 'specialists');
const defaultHome = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'hermes')
  : path.join(os.homedir(), '.hermes');
const agentRoot = path.join(defaultHome, 'hermes-agent');
const python = process.platform === 'win32'
  ? path.join(agentRoot, 'venv', 'Scripts', 'python.exe')
  : path.join(agentRoot, 'venv', 'bin', 'python');
const launcher = path.join(agentRoot, 'hermes');
const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`LandOS specialist profiles: ${message}`);
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

/** Persona is overwritten every provision; memory files are seeds written
 *  once, so each specialist's learned reasoning survives reprovisioning. */
const OVERWRITTEN = [['SOUL.md', 'SOUL.md']];
const SEEDED = [
  [path.join('memories', 'MEMORY.md'), path.join('memories', 'MEMORY.md')],
  [path.join('memories', 'USER.md'), path.join('memories', 'USER.md')],
];

function verifyProfile(spec) {
  const profileHome = path.join(defaultHome, 'profiles', spec.name);
  const failures = [];
  const configPath = path.join(profileHome, 'config.yaml');
  if (!fs.existsSync(configPath)) failures.push(`${spec.name}: config.yaml is missing`);
  else {
    const config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
    if (String(config?.model?.provider || '').trim() !== SPECIALIST_PROVIDER) {
      failures.push(`${spec.name}: model.provider is not ${SPECIALIST_PROVIDER}`);
    }
    if (String(config?.model?.default || '').trim() !== SPECIALIST_MODEL) {
      failures.push(`${spec.name}: model.default is not ${SPECIALIST_MODEL}`);
    }
    if (Number(config?.model?.context_length || 0) < 64000) {
      failures.push(`${spec.name}: model.context_length is below the 64K minimum Hermes requires`);
    }
    if (config?.memory?.memory_enabled !== true) failures.push(`${spec.name}: memory.memory_enabled is not true`);
    if (config?.memory?.user_profile_enabled !== true) failures.push(`${spec.name}: memory.user_profile_enabled is not true`);
    if (spec.name === 'landos-market') {
      if (String(config?.web?.backend || '').trim() !== 'ddgs') failures.push(`${spec.name}: web.backend is not ddgs`);
      if (String(config?.web?.search_backend || '').trim() !== 'ddgs') failures.push(`${spec.name}: web.search_backend is not ddgs`);
    }
    if (spec.vision) {
      if (!String(config?.auxiliary?.vision?.provider || '').trim()) failures.push(`${spec.name}: auxiliary.vision.provider is not set`);
      if (!String(config?.auxiliary?.vision?.model || '').trim()) failures.push(`${spec.name}: auxiliary.vision.model is not set`);
    }
  }
  for (const [, targetRelative] of [...OVERWRITTEN, ...SEEDED]) {
    if (!fs.existsSync(path.join(profileHome, targetRelative))) {
      failures.push(`${spec.name}: ${targetRelative} is missing`);
    }
  }
  return failures;
}

function verifyAll() {
  const failures = SPECIALIST_PROFILES.flatMap(verifyProfile);
  if (failures.length) {
    for (const failure of failures) fail(failure);
    return false;
  }
  for (const spec of SPECIALIST_PROFILES) {
    console.log(`${spec.name} ready (${spec.title}): ${path.join(defaultHome, 'profiles', spec.name)}`);
  }
  console.log(`  primary model: ${SPECIALIST_PROVIDER} / ${SPECIALIST_MODEL} (all four)`);
  console.log(`  vision auxiliary: ${SPECIALIST_VISION_PROVIDER} / ${SPECIALIST_VISION_MODEL} (landos-property only)`);
  return true;
}

function provisionProfile(spec) {
  const profileHome = path.join(defaultHome, 'profiles', spec.name);
  const templates = path.join(templatesRoot, spec.template);
  if (!fs.existsSync(profileHome)) {
    runHermes([
      'profile', 'create', spec.name,
      '--no-skills', '--no-alias',
      '--description', spec.description,
    ]);
  }
  const set = (key, value) => runHermes(['--profile', spec.name, 'config', 'set', key, value]);
  set('model.provider', SPECIALIST_PROVIDER);
  set('model.default', SPECIALIST_MODEL);
  set('model.base_url', LOCAL_RUNTIME_BASE_URL);
  set('model.ollama_num_ctx', String(LOCAL_RUNTIME_LOADED_CONTEXT_TOKENS));
  set('model.context_length', String(SPECIALIST_MODEL_CONTEXT_TOKENS));
  set('memory.memory_enabled', 'true');
  set('memory.user_profile_enabled', 'true');
  set('terminal.backend', 'local');
  set('terminal.cwd', workspace);
  if (spec.name === 'landos-market') {
    set('web.backend', 'ddgs');
    set('web.search_backend', 'ddgs');
  }
  if (spec.vision) {
    set('auxiliary.vision.provider', SPECIALIST_VISION_PROVIDER);
    set('auxiliary.vision.model', SPECIALIST_VISION_MODEL);
    set('auxiliary.vision.base_url', LOCAL_RUNTIME_BASE_URL);
  }
  for (const [sourceRelative, targetRelative] of OVERWRITTEN) {
    copyFile(path.join(templates, sourceRelative), path.join(profileHome, targetRelative));
  }
  for (const [sourceRelative, targetRelative] of SEEDED) {
    const target = path.join(profileHome, targetRelative);
    if (!fs.existsSync(target)) copyFile(path.join(templates, sourceRelative), target);
    else if (spec.name === 'landos-market' && targetRelative === path.join('memories', 'MEMORY.md')) {
      // One narrow migration for the obsolete research prohibition. Preserve
      // every other learned memory line in the persistent profile.
      const obsolete = 'LandOS is the canonical system of record. This profile reasons over market evidence LandOS assembled; it never collects evidence, never researches, and never writes a comp, valuation, band, or deal state.';
      const replacement = fs.readFileSync(path.join(templates, sourceRelative), 'utf8').split(/\r?\n/, 1)[0];
      const current = fs.readFileSync(target, 'utf8');
      if (current.includes(obsolete)) fs.writeFileSync(target, current.replace(obsolete, replacement), 'utf8');
    }
  }
}

if (!fs.existsSync(python) || !fs.existsSync(launcher)) {
  fail(`installed Hermes runtime not found under ${agentRoot}`);
} else if (checkOnly) {
  verifyAll();
} else {
  try {
    for (const spec of SPECIALIST_PROFILES) provisionProfile(spec);
    verifyAll();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
