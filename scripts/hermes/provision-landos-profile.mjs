import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import yaml from 'js-yaml';

const PROFILE = 'landos';
const workspace = path.resolve(import.meta.dirname, '..', '..');
const templates = path.join(workspace, 'config', 'hermes', 'landos-profile');
const defaultHome = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'hermes')
  : path.join(os.homedir(), '.hermes');
const agentRoot = path.join(defaultHome, 'hermes-agent');
const python = process.platform === 'win32'
  ? path.join(agentRoot, 'venv', 'Scripts', 'python.exe')
  : path.join(agentRoot, 'venv', 'bin', 'python');
const launcher = path.join(agentRoot, 'hermes');
const profileHome = path.join(defaultHome, 'profiles', PROFILE);
const checkOnly = process.argv.includes('--check');
const skillsOnly = process.argv.includes('--skills-only');
const checkSkillsOnly = process.argv.includes('--check-skills');

function fail(message) {
  console.error(`LandOS Hermes profile: ${message}`);
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

function copyDirectory(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function expectedFiles() {
  return [
    ['SOUL.md', 'SOUL.md'],
    [path.join('memories', 'MEMORY.md'), path.join('memories', 'MEMORY.md')],
    [path.join('memories', 'USER.md'), path.join('memories', 'USER.md')],
    [path.join('skills', 'landos-landportal', 'SKILL.md'), path.join('skills', 'landos-landportal', 'SKILL.md')],
    [path.join('skills', 'landos-government-zoning-planning', 'SKILL.md'), path.join('skills', 'landos-government-zoning-planning', 'SKILL.md')],
    [path.join('skills', 'landos-public-records-recovery', 'SKILL.md'), path.join('skills', 'landos-public-records-recovery', 'SKILL.md')],
    [path.join('skills', 'landos-comp-valuation', 'SKILL.md'), path.join('skills', 'landos-comp-valuation', 'SKILL.md')],
  ];
}

function expectedSkillFiles() {
  return expectedFiles().filter(([sourceRelative]) => sourceRelative.startsWith(`skills${path.sep}`));
}

function verify(onlySkills = false) {
  const failures = [];
  if (!onlySkills) {
    const configPath = path.join(profileHome, 'config.yaml');
    if (!fs.existsSync(configPath)) failures.push('config.yaml is missing');
    else {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
      if (config?.model?.provider !== 'openai-codex') failures.push('model.provider is not openai-codex');
      if (config?.model?.default !== 'gpt-5.5') failures.push('model.default is not gpt-5.5');
      if (path.resolve(String(config?.terminal?.cwd || '')) !== workspace) failures.push('terminal.cwd is not the LandOS workspace');
      if (config?.memory?.memory_enabled !== true) failures.push('memory.memory_enabled is not true');
      if (config?.memory?.user_profile_enabled !== true) failures.push('memory.user_profile_enabled is not true');
      if (config?.mcp_servers && Object.keys(config.mcp_servers).length > 0) failures.push('MCP servers are configured');
    }
  }
  for (const [sourceRelative, targetRelative] of onlySkills ? expectedSkillFiles() : expectedFiles()) {
    const source = path.join(templates, sourceRelative);
    const target = path.join(profileHome, targetRelative);
    if (!fs.existsSync(target)) failures.push(`${targetRelative} is missing`);
    else if (sha256(source) !== sha256(target)) failures.push(`${targetRelative} does not match the LandOS template`);
  }
  if (!onlySkills) {
    const cdpSkill = path.join(profileHome, 'skills', 'software-development', 'driving-cdp-browser', 'SKILL.md');
    if (!fs.existsSync(cdpSkill)) failures.push('driving-cdp-browser is missing');
  }
  if (failures.length) {
    for (const failure of failures) fail(failure);
    return false;
  }
  console.log(`LandOS Hermes profile ready: ${profileHome}`);
  return true;
}

if (!fs.existsSync(python) || !fs.existsSync(launcher)) {
  fail(`installed Hermes runtime not found under ${agentRoot}`);
} else if (checkOnly || checkSkillsOnly) {
  verify(checkSkillsOnly);
} else {
  try {
    if (!fs.existsSync(profileHome)) {
      runHermes([
        'profile', 'create', PROFILE,
        '--no-skills', '--no-alias',
        '--description', 'Bounded LandOS Property Intelligence worker beneath Max; exact-subject LandPortal evidence only.',
      ]);
    }

    if (!skillsOnly) {
      runHermes(['--profile', PROFILE, 'config', 'set', 'model.provider', 'openai-codex']);
      runHermes(['--profile', PROFILE, 'config', 'set', 'model.default', 'gpt-5.5']);
      runHermes(['--profile', PROFILE, 'config', 'set', 'terminal.backend', 'local']);
      runHermes(['--profile', PROFILE, 'config', 'set', 'terminal.cwd', workspace]);
      runHermes(['--profile', PROFILE, 'config', 'set', 'memory.memory_enabled', 'true']);
      runHermes(['--profile', PROFILE, 'config', 'set', 'memory.user_profile_enabled', 'true']);
    }

    for (const [sourceRelative, targetRelative] of skillsOnly ? expectedSkillFiles() : expectedFiles()) {
      copyFile(path.join(templates, sourceRelative), path.join(profileHome, targetRelative));
    }
    if (!skillsOnly) {
      copyDirectory(
        path.join(defaultHome, 'skills', 'software-development', 'driving-cdp-browser'),
        path.join(profileHome, 'skills', 'software-development', 'driving-cdp-browser'),
      );
    }
    verify(skillsOnly);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
