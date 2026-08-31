import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import yaml from 'js-yaml';

import {
  MANIFEST_PATH,
  PROFILE_IDS,
  RESEARCH_CAPABILITY_CONTRACT_PATH,
  WORKSPACE,
  auditRepository,
  checkProfiles,
  provisionProfiles,
  smokeProfiles,
  validateResearchCapabilityRegistry,
} from './governed-profile-manager.mjs';

const HERMES_COMMIT = '3f497e2b4f92ef83f45a98c02f7cb47c12ee069e';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeSkill(name, version) {
  const versionLine = version?.startsWith('unversioned@') ? '' : `version: ${version}\n`;
  return `---\nname: ${name}\ndescription: Use when exercising the governed profile test fixture.\n${versionLine}author: Test\nlicense: MIT\n---\n\n# ${name}\n\nFixture content.\n`;
}

function makeFakeRuntime(root) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  write(path.join(root, 'pyproject.toml'), '[project]\nname = "hermes-agent"\nversion = "0.19.1"\n');
  write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  write(path.join(root, '.git', 'refs', 'heads', 'main'), `${HERMES_COMMIT}\n`);
  write(path.join(root, 'venv', 'Scripts', 'python.exe'), 'test runtime placeholder\n');
  write(path.join(root, 'venv', 'bin', 'python3'), 'test runtime placeholder\n');
  for (const skill of manifest.skills.bundled) {
    write(path.join(root, skill.sourcePath, 'SKILL.md'), makeSkill(skill.id, skill.version));
  }
  for (const skill of manifest.skills.optionalApproved) {
    write(path.join(root, skill.source.path, 'SKILL.md'), makeSkill(skill.id, skill.version));
    for (const [packageName, version] of Object.entries(skill.runtimeRequirements?.pythonPackages ?? {})) {
      const normalized = packageName.replaceAll('-', '_');
      write(
        path.join(root, 'venv', 'Lib', 'site-packages', `${normalized}-${version}.dist-info`, 'METADATA'),
        `Metadata-Version: 2.1\nName: ${packageName}\nVersion: ${version}\n`,
      );
    }
  }
}

function makeMcpActivationFixture(fixture) {
  const mcpRoot = path.join(fixture.root, 'mcp-activation');
  const mcpManifestPath = path.join(mcpRoot, 'manifest.json');
  const mcpGovernancePath = path.join(mcpRoot, 'profile-governance-fragment.json');
  const mcpFragmentPath = path.join(mcpRoot, 'hermes-mcp-fragment.yaml');
  const canonicalBridgePath = path.join(mcpRoot, 'canonical_bridge.py');
  const manifest = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'config', 'landos-mcp', 'manifest.json'), 'utf8'));
  manifest.canonicalAdapter = { class: 'CanonicalBridgeLandosAdapter', productionReady: true };
  for (const server of Object.values(manifest.servers)) server.status = 'verified-live-canonical';
  const governance = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'config', 'landos-mcp', 'profile-governance-fragment.json'), 'utf8'));
  governance.mcpManifest = path.relative(WORKSPACE, mcpFragmentPath).split(path.sep).join('/');
  write(mcpManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  write(mcpGovernancePath, `${JSON.stringify(governance, null, 2)}\n`);
  write(mcpFragmentPath, fs.readFileSync(path.join(WORKSPACE, 'config', 'landos-mcp', 'hermes-mcp-fragment.yaml')));
  write(canonicalBridgePath, 'class CanonicalBridgeLandosAdapter:\n    production_ready = True\n');
  return {
    mcpManifestPath,
    mcpGovernancePath,
    mcpFragmentPath,
    canonicalBridgePath,
  };
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-governed-'));
  const runtimeRoot = path.join(root, 'runtime');
  const targetRoot = path.join(root, 'profiles');
  makeFakeRuntime(runtimeRoot);
  write(path.join(targetRoot, 'landos', 'production-sentinel.txt'), 'existing production profile\n');
  const contract = JSON.parse(fs.readFileSync(RESEARCH_CAPABILITY_CONTRACT_PATH, 'utf8'));
  const capabilityContractPath = path.join(root, 'research-capability-contract.json');
  const capabilityRegistryPath = path.join(root, 'research-capabilities.json');
  write(capabilityContractPath, `${JSON.stringify(contract, null, 2)}\n`);
  write(capabilityRegistryPath, `${JSON.stringify({
    schemaVersion: 1,
    canonicalSystem: 'LandOS',
    capabilities: Object.entries(contract.capabilities).map(([id, capability]) => ({ id, ...capability })),
  }, null, 2)}\n`);
  return {
    root,
    runtimeRoot,
    targetRoot,
    capabilityContractPath,
    capabilityRegistryPath,
    cleanup() {
      const resolvedRoot = path.resolve(root);
      const resolvedTemp = path.resolve(os.tmpdir());
      const relative = path.relative(resolvedTemp, resolvedRoot);
      if (path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || !path.basename(resolvedRoot).startsWith('landos-governed-')) {
        throw new Error('Refusing to remove a non-fixture directory');
      }
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    },
  };
}

function options(fixture, extra = {}) {
  return {
    workspace: WORKSPACE,
    runtimeRoot: fixture.runtimeRoot,
    targetRoot: fixture.targetRoot,
    strictRuntimeIdentity: false,
    capabilityContractPath: fixture.capabilityContractPath,
    capabilityRegistryPath: fixture.capabilityRegistryPath,
    ...extra,
  };
}

function installedNames(profileRoot) {
  const names = [];
  const skillsRoot = path.join(profileRoot, 'skills');
  for (const category of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const entry of fs.readdirSync(path.join(skillsRoot, category.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const content = fs.readFileSync(path.join(skillsRoot, category.name, entry.name, 'SKILL.md'), 'utf8');
      names.push(content.match(/^name:\s*(.+)$/m)?.[1]?.trim());
    }
  }
  return names.filter(Boolean).sort();
}

test('repository audit and practical profile provisioning are isolated and idempotent', () => {
  const fixture = makeFixture();
  try {
    const audit = auditRepository(options(fixture));
    assert.equal(audit.ok, true, audit.failures.join('\n'));
    assert.equal(audit.profiles, 6);
    assert.equal(audit.customSkills, 7);

    const first = provisionProfiles(options(fixture));
    assert.equal(first.ok, true);
    assert.equal(first.productionProfile.preserved, true);
    assert.equal(first.productionProfile.digestBefore, first.productionProfile.digestAfter);
    assert.deepEqual(first.results.map((item) => item.profile), PROFILE_IDS);
    assert.ok(first.results.every((item) => item.createdFiles > 0));

    const productionSentinel = path.join(fixture.targetRoot, 'landos', 'production-sentinel.txt');
    assert.equal(fs.readFileSync(productionSentinel, 'utf8'), 'existing production profile\n');
    assert.deepEqual(fs.readdirSync(path.join(fixture.targetRoot, 'landos')), ['production-sentinel.txt']);

    const second = provisionProfiles(options(fixture));
    assert.equal(second.ok, true);
    assert.ok(second.results.every((item) => item.createdFiles === 0));

    const checked = checkProfiles(options(fixture));
    assert.equal(checked.ok, true, JSON.stringify(checked.results, null, 2));

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const roots = new Set();
    for (const profileId of PROFILE_IDS) {
      const profileRoot = path.join(fixture.targetRoot, profileId);
      roots.add(fs.realpathSync(profileRoot));
      assert.ok(fs.statSync(path.join(profileRoot, 'sessions')).isDirectory());
      assert.ok(fs.statSync(path.join(profileRoot, 'memories')).isDirectory());
      assert.deepEqual(installedNames(profileRoot), [...manifest.profiles[profileId].skillAllowlist].sort());
      const config = yaml.load(fs.readFileSync(path.join(profileRoot, 'config.yaml'), 'utf8'));
      assert.deepEqual(new Set(config.platform_toolsets.cli), new Set(manifest.profiles[profileId].toolsetAllowlist));
      assert.deepEqual(config.mcp_servers, {});
      assert.equal(config.skills.write_approval, false);
      assert.equal(config.skills.guard_agent_created, false);
      assert.equal(config.skills.inline_shell, true);
      assert.equal(config.security.allow_lazy_installs, true);
      assert.equal(config.security.redact_secrets, true);
      assert.equal(config.checkpoints.enabled, true);
      assert.equal(config.approvals.cron_mode, profileId === 'landos-automation' ? 'approve' : 'deny');
      assert.deepEqual(new Set(config.approvals.deny), new Set(manifest.policy.terminalDenyRules));
      assert.deepEqual(config.skills.external_dirs, []);
      for (const runtimeDirectory of ['logs/curator', 'pairing', 'hooks', 'image_cache', 'audio_cache']) {
        assert.ok(fs.statSync(path.join(profileRoot, runtimeDirectory)).isDirectory());
      }
      if (['landos-research', 'landos-public-records'].includes(profileId)) {
        assert.equal(config.web.search_backend, 'ddgs');
        assert.equal(config.plugins.disabled.includes('web/ddgs'), false);
      } else {
        assert.equal(config.web, undefined);
        assert.equal(config.plugins.disabled.includes('web/ddgs'), true);
      }
      const contract = JSON.parse(fs.readFileSync(path.join(
        WORKSPACE,
        manifest.profiles[profileId].templatePath,
        'profile.json',
      ), 'utf8'));
      assert.deepEqual(new Set(contract.capabilities.tools), new Set(manifest.profiles[profileId].toolAllowlist));
      assert.ok(fs.existsSync(path.join(profileRoot, '.landos-governance', 'skill-provenance.json')));
    }
    assert.equal(roots.size, PROFILE_IDS.length);
    assert.equal(manifest.profiles['landos-research'].toolsetAllowlist.includes('browser'), true);
    assert.equal(manifest.profiles['landos-research'].toolAllowlist.includes('browser_cdp'), true);
    assert.equal(manifest.profiles['landos-visual-qa'].toolsetAllowlist.includes('terminal'), true);
    assert.equal(manifest.profiles['landos-visual-qa'].toolsetAllowlist.includes('file'), false);
    assert.equal(manifest.profiles['landos-debug'].toolsetAllowlist.includes('file'), false);
    assert.equal(manifest.profiles['landos-knowledge'].toolsetAllowlist.includes('file'), true);
    assert.equal(manifest.profiles['landos-automation'].toolsetAllowlist.includes('cronjob'), true);
  } finally {
    fixture.cleanup();
  }
});

test('check denies unauthorized skills, tools, and MCP servers without touching production', () => {
  const fixture = makeFixture();
  try {
    assert.equal(provisionProfiles(options(fixture)).ok, true);
    const profileRoot = path.join(fixture.targetRoot, 'landos-visual-qa');
    const configPath = path.join(profileRoot, 'config.yaml');
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    config.platform_toolsets.cli.push('coding');
    config.mcp_servers = {
      unauthorized: { command: 'never-run' },
      'landos-acceptance': { command: 'still-pending' },
    };
    write(configPath, yaml.dump(config));
    write(
      path.join(profileRoot, 'skills', 'optional', 'unauthorized', 'SKILL.md'),
      makeSkill('unauthorized', '1.0.0'),
    );

    const checked = checkProfiles(options(fixture, { profile: 'landos-visual-qa' }));
    assert.equal(checked.ok, false);
    const failures = checked.results[0].failures.join('\n');
    assert.match(failures, /toolsets differ/i);
    assert.match(failures, /unauthorized MCP/i);
    assert.match(failures, /integration-pending MCP mappings/i);
    assert.match(failures, /unauthorized installed skill/i);
    assert.equal(
      fs.readFileSync(path.join(fixture.targetRoot, 'landos', 'production-sentinel.txt'), 'utf8'),
      'existing production profile\n',
    );
  } finally {
    fixture.cleanup();
  }
});

test('cross-artifact validator catches research capability drift', () => {
  const fixture = makeFixture();
  try {
    const valid = validateResearchCapabilityRegistry(options(fixture));
    assert.equal(valid.ok, true, valid.failures.join('\n'));
    const registry = JSON.parse(fs.readFileSync(fixture.capabilityRegistryPath, 'utf8'));
    registry.capabilities.find((item) => item.id === 'duckduckgo-search').profiles.push('landos-automation');
    registry.capabilities.find((item) => item.id === 'scrapling').runtimeState = 'installed';
    registry.capabilities.find((item) => item.id === 'domain-intel').status = 'approved';
    write(fixture.capabilityRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const invalid = validateResearchCapabilityRegistry(options(fixture));
    assert.equal(invalid.ok, false);
    const failures = invalid.failures.join('\n');
    assert.match(failures, /duckduckgo-search.*profiles/i);
    assert.match(failures, /scrapling.*runtimeState/i);
    assert.match(failures, /domain-intel.*status/i);
  } finally {
    fixture.cleanup();
  }
});

test('MCP activation is explicit, profile-filtered, and fails closed on pending adapters', () => {
  const fixture = makeFixture();
  try {
    const activation = makeMcpActivationFixture(fixture);
    const activeRoot = path.join(fixture.root, 'active-profiles');
    write(path.join(activeRoot, 'landos', 'production-sentinel.txt'), 'existing production profile\n');
    const activeOptions = options(fixture, {
      ...activation,
      targetRoot: activeRoot,
      activateMcp: true,
    });
    const provisioned = provisionProfiles(activeOptions);
    assert.equal(provisioned.ok, true, JSON.stringify(provisioned, null, 2));
    assert.equal(provisioned.productionProfile.preserved, true);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    for (const profileId of PROFILE_IDS) {
      const config = yaml.load(fs.readFileSync(path.join(activeRoot, profileId, 'config.yaml'), 'utf8'));
      assert.deepEqual(Object.keys(config.mcp_servers).sort(), [...manifest.profiles[profileId].mcpAllowlist].sort());
      for (const server of Object.values(config.mcp_servers)) {
        assert.ok(path.isAbsolute(server.command));
        assert.ok(path.isAbsolute(server.args[1]));
        assert.equal(server.cwd, WORKSPACE);
        assert.equal(server.sampling.enabled, false);
      }
    }
    assert.equal(checkProfiles(activeOptions).ok, true);
    assert.equal(checkProfiles({ ...activeOptions, activateMcp: false }).ok, false);

    const pending = JSON.parse(fs.readFileSync(activation.mcpManifestPath, 'utf8'));
    pending.servers['landos-read'].status = 'integration-pending';
    write(activation.mcpManifestPath, `${JSON.stringify(pending, null, 2)}\n`);
    assert.throws(
      () => provisionProfiles({ ...activeOptions, targetRoot: path.join(fixture.root, 'pending-profiles') }),
      /landos-read.*not verified-live-canonical/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test('normal governed skill edits are preserved without staging or digest gates', () => {
  const fixture = makeFixture();
  try {
    assert.equal(provisionProfiles(options(fixture, { profile: 'landos-visual-qa' })).ok, true);
    const installedSkill = path.join(
      fixture.targetRoot,
      'landos-visual-qa',
      'skills',
      'governed',
      'landos-sprint-acceptance',
      'SKILL.md',
    );
    fs.appendFileSync(installedSkill, '\nLocal governed improvement.\n');
    const checked = checkProfiles(options(fixture, { profile: 'landos-visual-qa' }));
    assert.equal(checked.ok, true, JSON.stringify(checked, null, 2));
    const reprovisioned = provisionProfiles(options(fixture, { profile: 'landos-visual-qa' }));
    assert.equal(reprovisioned.ok, true, JSON.stringify(reprovisioned, null, 2));
    assert.match(fs.readFileSync(installedSkill, 'utf8'), /Local governed improvement/);
    const provenance = JSON.parse(fs.readFileSync(path.join(fixture.targetRoot, 'landos-visual-qa', '.landos-governance', 'skill-provenance.json'), 'utf8'));
    assert.equal(provenance.enforcement, 'normal-dirty-worktree-review');
  } finally {
    fixture.cleanup();
  }
});

test('native policy keeps the seven protections while normal capabilities remain enabled', () => {
  const fixture = makeFixture();
  try {
    assert.equal(provisionProfiles(options(fixture)).ok, true);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assert.equal(Object.keys(manifest.policy.approvedProtections).length, 7);
    assert.ok(manifest.policy.terminalDenyRules.some((rule) => rule.includes('get-content') && rule.includes('.env')));
    assert.ok(manifest.policy.terminalDenyRules.includes('*cat *.env*'));
    assert.ok(manifest.policy.terminalDenyRules.some((rule) => rule.includes('sqlite3')));
    assert.ok(manifest.policy.terminalDenyRules.some((rule) => rule.includes('remove-item')));
    assert.ok(manifest.policy.terminalDenyRules.some((rule) => rule.includes('patch') && rule.includes('deal')));

    const soul = path.join(fixture.targetRoot, 'landos-debug', 'SOUL.md');
    fs.appendFileSync(soul, '\nconflicting local edit\n');
    const checked = checkProfiles(options(fixture, { profile: 'landos-debug' }));
    assert.equal(checked.ok, false);
    assert.match(checked.results[0].failures.join('\n'), /managed file.*differs/i);
    const reprovisioned = provisionProfiles(options(fixture, { profile: 'landos-debug' }));
    assert.equal(reprovisioned.ok, false);
    assert.equal(reprovisioned.productionProfile.preserved, true);
  } finally {
    fixture.cleanup();
  }
});

test('audited Hermes resolves only each profile toolset allowlist', (t) => {
  const installedRuntime = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent')
    : null;
  const python = installedRuntime
    ? path.join(installedRuntime, 'venv', 'Scripts', 'python.exe')
    : null;
  if (!installedRuntime || !python || !fs.existsSync(python)) {
    t.skip('installed Windows Hermes runtime is unavailable');
    return;
  }
  const fixture = makeFixture();
  try {
    assert.equal(provisionProfiles(options(fixture)).ok, true);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const source = [
      'import json, sys, yaml',
      'from hermes_cli.tools_config import _get_platform_tools',
      'from toolsets import resolve_multiple_toolsets',
      "cfg = yaml.safe_load(open(sys.argv[1], encoding='utf-8'))",
      "toolsets = sorted(_get_platform_tools(cfg, 'cli', include_default_mcp_servers=False))",
      "print(json.dumps({'toolsets': toolsets, 'tools': sorted(resolve_multiple_toolsets(toolsets))}))",
    ].join('; ');
    for (const profileId of PROFILE_IDS) {
      const result = spawnSync(
        python,
        ['-c', source, path.join(fixture.targetRoot, profileId, 'config.yaml')],
        { cwd: installedRuntime, encoding: 'utf8', windowsHide: true },
      );
      assert.equal(result.status, 0, result.stderr);
      const lines = result.stdout.trim().split(/\r?\n/);
      const effective = JSON.parse(lines.at(-1));
      assert.deepEqual(effective.toolsets, [...manifest.profiles[profileId].toolsetAllowlist].sort());
      const contract = JSON.parse(fs.readFileSync(path.join(
        WORKSPACE,
        manifest.profiles[profileId].templatePath,
        'profile.json',
      ), 'utf8'));
      assert.deepEqual(effective.tools, [...contract.capabilities.tools].sort());
    }
  } finally {
    fixture.cleanup();
  }
});

test('provider-free Hermes smoke loads every provisioned skill and pinned local research runtime', (t) => {
  const installedRuntime = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent')
    : null;
  const python = installedRuntime
    ? path.join(installedRuntime, 'venv', 'Scripts', 'python.exe')
    : null;
  if (!installedRuntime || !python || !fs.existsSync(python)) {
    t.skip('installed Windows Hermes runtime is unavailable');
    return;
  }
  const fixture = makeFixture();
  try {
    const runtimeOptions = options(fixture, {
      runtimeRoot: installedRuntime,
      strictRuntimeIdentity: true,
    });
    const provisioned = provisionProfiles(runtimeOptions);
    assert.equal(provisioned.ok, true, JSON.stringify(provisioned, null, 2));
    const smoke = smokeProfiles(runtimeOptions);
    assert.equal(smoke.ok, true, JSON.stringify(smoke, null, 2));
    assert.equal(smoke.providerCalls, 0);
    assert.equal(smoke.networkCalls, 0);
    assert.ok(smoke.profiles.every((profile) => profile.skillCount > 0));
    assert.ok(smoke.profiles.every((profile) => profile.commandPolicy.blocked.every((item) => item.approved === false && item.user_deny === true)));
    assert.ok(smoke.profiles.every((profile) => profile.commandPolicy.allowed.every((item) => item.approved === true)));
    assert.deepEqual(smoke.runtimeCapabilities.domainIntel.commands, ['available', 'dns', 'ssl', 'subdomains', 'whois']);
    assert.equal(smoke.runtimeCapabilities.domainIntel.networkDuringSmoke, 'denied');
    assert.equal(smoke.runtimeCapabilities.domainIntel.directExecution, 'enabled-approved-public-sources');
    assert.equal(smoke.runtimeCapabilities.duckduckgo.version, '9.14.4');
  } finally {
    fixture.cleanup();
  }
});
