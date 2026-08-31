import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

export const WORKSPACE = path.resolve(import.meta.dirname, '..', '..');
export const MANIFEST_PATH = path.join(
  WORKSPACE,
  'config',
  'hermes',
  'governance',
  'approved-capabilities.json',
);
export const RESEARCH_CAPABILITY_CONTRACT_PATH = path.join(
  WORKSPACE,
  'config',
  'hermes',
  'governance',
  'research-capability-contract.json',
);
export const LANDOS_SHARED_CDP_URL = 'http://127.0.0.1:9224';

export const PROFILE_IDS = Object.freeze([
  'landos-research',
  'landos-public-records',
  'landos-visual-qa',
  'landos-debug',
  'landos-knowledge',
  'landos-automation',
]);

const MANAGED_DIRECTORIES = Object.freeze([
  'memories',
  'sessions',
  'skills',
  'skins',
  'logs',
  'logs/curator',
  'plans',
  'workspace',
  'cron',
  'pairing',
  'hooks',
  'image_cache',
  'audio_cache',
  'home',
  '.landos-governance',
]);

const TEXT_EXTENSIONS = new Set([
  '', '.cjs', '.css', '.csv', '.html', '.ini', '.js', '.json', '.jsx', '.md',
  '.mjs', '.ps1', '.py', '.sh', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml',
]);

const DANGEROUS_PATTERNS = Object.freeze([
  {
    id: 'download-and-execute',
    severity: 'critical',
    pattern: /(?:curl|wget)[^\r\n]*\|\s*(?:ba)?sh\b/i,
  },
  {
    id: 'secret-exfiltration',
    severity: 'critical',
    pattern: /(?:curl|wget|fetch|requests\.(?:get|post)|httpx?\.(?:get|post))[^\r\n]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i,
  },
  {
    id: 'encoded-command-execution',
    severity: 'high',
    pattern: /(?:Invoke-Expression|FromBase64String\s*\(|powershell(?:\.exe)?\s+[^\r\n]*-(?:enc|encodedcommand)\b)/i,
  },
  {
    id: 'destructive-broad-delete',
    severity: 'critical',
    pattern: /(?:rm\s+-[^\r\n]*rf\s+(?:\/|~|\$HOME)|Remove-Item[^\r\n]*-Recurse[^\r\n]*(?:\$HOME|~|[A-Za-z]:\\\s*$))/i,
  },
  {
    id: 'embedded-private-key',
    severity: 'critical',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i,
  },
  {
    id: 'embedded-access-token',
    severity: 'critical',
    pattern: /(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|sk-ant-[A-Za-z0-9_-]{70,}|AKIA[0-9A-Z]{16})/,
  },
]);

const NON_SELECTED_WEB_PROVIDER_PLUGINS = Object.freeze([
  'web/brave_free',
  'web/exa',
  'web/firecrawl',
  'web/parallel',
  'web/searxng',
  'web/tavily',
  'web/xai',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === left.length && right.every((item) => leftSet.has(item));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function assertRelativeRepositoryPath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} escapes the repository`);
  }
  return normalized;
}

function assertWithin(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its allowed root`);
  }
  return resolvedCandidate;
}

function defaultHermesRoot() {
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'hermes')
    : path.join(os.homedir(), '.hermes');
  return base;
}

function defaultRuntimeRoot() {
  return path.join(defaultHermesRoot(), 'hermes-agent');
}

function defaultTargetRoot() {
  return path.join(defaultHermesRoot(), 'profiles');
}

function resolveSelectedProfiles(manifest, requested = 'all') {
  const ids = Object.keys(manifest.profiles);
  if (requested === 'all' || requested == null) return ids;
  if (!ids.includes(requested)) throw new Error(`Unknown governed profile '${requested}'`);
  return [requested];
}

function flattenSkills(manifest) {
  const result = new Map();
  for (const skill of manifest.skills.customSnapshots) {
    result.set(skill.id, skill);
  }
  for (const skill of manifest.skills.optionalApproved) {
    result.set(skill.id, skill);
  }
  for (const skill of manifest.skills.bundled) {
    result.set(skill.id, {
      ...skill,
      kind: 'bundled',
      source: {
        type: 'hermes-bundled',
        path: skill.sourcePath,
        hermesVersion: manifest.runtimeAudit.hermesVersion,
        commit: manifest.runtimeAudit.sourceCommit,
      },
      expectedSha256: null,
    });
  }
  return result;
}

function parseSkillFrontmatter(skillFile) {
  const content = fs.readFileSync(skillFile, 'utf8');
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    throw new Error('SKILL.md does not start with YAML frontmatter');
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('SKILL.md frontmatter is not closed');
  const frontmatter = yaml.load(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object') throw new Error('SKILL.md frontmatter is not a mapping');
  if (typeof frontmatter.name !== 'string' || !frontmatter.name) throw new Error('SKILL.md name is missing');
  if (typeof frontmatter.description !== 'string' || !frontmatter.description) throw new Error('SKILL.md description is missing');
  return { content, frontmatter };
}

function listRegularFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Skill snapshots may not contain symbolic links');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw new Error('Skill snapshots may contain regular files only');
    }
  }
  visit(root);
  return files.sort((a, b) => toPosix(path.relative(root, a)).localeCompare(toPosix(path.relative(root, b))));
}

export function directoryDigest(root) {
  const hash = crypto.createHash('sha256');
  for (const file of listRegularFiles(root)) {
    const relative = toPosix(path.relative(root, file));
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function scanSkillDirectory(root) {
  const findings = [];
  for (const file of listRegularFiles(root)) {
    const relative = toPosix(path.relative(root, file));
    if (/(?:^|\/)(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx))$/i.test(relative)) {
      findings.push({ id: 'sensitive-file', severity: 'critical', file: relative });
      continue;
    }
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(content)) {
        findings.push({
          id: rule.id,
          severity: rule.severity,
          file: relative,
        });
      }
    }
  }
  return findings;
}

function readRuntimeCommit(runtimeRoot) {
  const gitRoot = path.join(runtimeRoot, '.git');
  const headFile = path.join(gitRoot, 'HEAD');
  if (!fs.existsSync(headFile)) return null;
  const head = fs.readFileSync(headFile, 'utf8').trim();
  if (!head.startsWith('ref: ')) return /^[0-9a-f]{40}$/i.test(head) ? head.toLowerCase() : null;
  const ref = head.slice(5).trim();
  const looseRef = path.join(gitRoot, ...ref.split('/'));
  if (fs.existsSync(looseRef)) return fs.readFileSync(looseRef, 'utf8').trim().toLowerCase();
  const packed = path.join(gitRoot, 'packed-refs');
  if (!fs.existsSync(packed)) return null;
  for (const line of fs.readFileSync(packed, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('#') && !line.startsWith('^') && line.endsWith(` ${ref}`)) {
      return line.split(' ', 1)[0].toLowerCase();
    }
  }
  return null;
}

function readRuntimeVersion(runtimeRoot) {
  const pyproject = path.join(runtimeRoot, 'pyproject.toml');
  if (!fs.existsSync(pyproject)) return null;
  const match = fs.readFileSync(pyproject, 'utf8').match(/^version\s*=\s*["']([^"']+)["']/m);
  return match?.[1] ?? null;
}

function pythonSitePackageRoots(runtimeRoot) {
  const roots = [];
  const windowsRoot = path.join(runtimeRoot, 'venv', 'Lib', 'site-packages');
  if (fs.existsSync(windowsRoot)) roots.push(windowsRoot);
  const posixLib = path.join(runtimeRoot, 'venv', 'lib');
  if (fs.existsSync(posixLib)) {
    for (const entry of fs.readdirSync(posixLib, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('python')) {
        const candidate = path.join(posixLib, entry.name, 'site-packages');
        if (fs.existsSync(candidate)) roots.push(candidate);
      }
    }
  }
  return roots;
}

function readPythonPackageVersion(runtimeRoot, packageName) {
  const normalized = packageName.toLowerCase().replaceAll('-', '_');
  for (const sitePackages of pythonSitePackageRoots(runtimeRoot)) {
    for (const entry of fs.readdirSync(sitePackages, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith('.dist-info')) continue;
      const distribution = entry.name.slice(0, -'.dist-info'.length).toLowerCase();
      const separator = distribution.lastIndexOf('-');
      if (separator < 0 || distribution.slice(0, separator).replaceAll('-', '_') !== normalized) continue;
      const metadata = path.join(sitePackages, entry.name, 'METADATA');
      if (!fs.existsSync(metadata)) continue;
      const content = fs.readFileSync(metadata, 'utf8');
      const name = content.match(/^Name:\s*(.+)$/mi)?.[1]?.trim().toLowerCase().replaceAll('-', '_');
      const version = content.match(/^Version:\s*(.+)$/mi)?.[1]?.trim();
      if (name === normalized && version) return version;
    }
  }
  return null;
}

function resolveSkillSource(skill, { workspace, runtimeRoot }) {
  const relative = assertRelativeRepositoryPath(skill.source.path, `skill '${skill.id}' source`);
  const base = skill.source.type === 'repository-snapshot' ? workspace : runtimeRoot;
  const resolved = assertWithin(base, path.join(base, relative), `skill '${skill.id}' source`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Approved source for skill '${skill.id}' is unavailable`);
  }
  return resolved;
}

function validateSkillSource(skill, source) {
  const skillFile = path.join(source, 'SKILL.md');
  if (!fs.existsSync(skillFile)) throw new Error(`Skill '${skill.id}' has no SKILL.md`);
  const { frontmatter } = parseSkillFrontmatter(skillFile);
  if (frontmatter.name !== skill.id) {
    throw new Error(`Skill '${skill.id}' source declares name '${frontmatter.name}'`);
  }
  if (skill.version.startsWith('unversioned@')) {
    if (frontmatter.version != null) throw new Error(`Skill '${skill.id}' was expected to be unversioned`);
  } else if (String(frontmatter.version ?? '') !== skill.version) {
    throw new Error(`Skill '${skill.id}' source version does not match the approved manifest`);
  }
  if (skill.expectedSha256) {
    const actual = sha256(fs.readFileSync(skillFile));
    if (actual !== skill.expectedSha256) throw new Error(`Immutable snapshot mismatch for skill '${skill.id}'`);
  }
  if (skill.kind !== 'bundled') {
    const findings = scanSkillDirectory(source);
    if (findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high')) {
      const ids = [...new Set(findings.map((finding) => finding.id))].sort().join(', ');
      throw new Error(`Dangerous-pattern scan blocked skill '${skill.id}' (${ids})`);
    }
  }
}

function validateManifestStructure(manifest, { workspace, runtimeRoot, strictRuntimeIdentity = true } = {}) {
  const failures = [];
  if (manifest.schemaVersion !== '1.0.0') failures.push('unsupported manifest schemaVersion');
  if (manifest.manifestId !== 'landos-governed-hermes') failures.push('unexpected manifestId');
  if (JSON.stringify(Object.keys(manifest.profiles).sort()) !== JSON.stringify([...PROFILE_IDS].sort())) {
    failures.push('manifest must define exactly the six governed profile ids');
  }
  if (manifest.skills.customSnapshots.length !== 7) failures.push('manifest must define exactly seven custom skill snapshots');
  const approvedProtections = manifest.policy?.approvedProtections ?? {};
  const requiredProtections = ['noSecretOrEnvExposure', 'noArbitrarySqlOrDestructiveDeletes', 'noUnrestrictedDealCardMutation', 'isolatedVisualAcceptance', 'noSelfCertification', 'dirtyStatePreservation', 'crossPropertyRejection'];
  if (!requiredProtections.every((key) => approvedProtections[key] === true)
    || Object.keys(approvedProtections).length !== requiredProtections.length) {
    failures.push('the seven approved protections must be present without blanket-deny policy');
  }
  if (manifest.policy?.noPaidApis !== true) failures.push('paid APIs must remain unauthorized');
  // Capability scoping is declared by the manifest, not fixed here. LandOS
  // doctrine is full capability: every profile receives the same tools, and a
  // skill is procedural guidance rather than a capability boundary. The older
  // per-profile positive scoping is still accepted so an audited historical
  // manifest keeps validating.
  const CAPABILITY_SCOPINGS = ['shared-full-capability', 'profile-positive-toolsets'];
  if (!CAPABILITY_SCOPINGS.includes(manifest.policy?.capabilityScoping)) {
    failures.push(`capabilityScoping must be one of ${CAPABILITY_SCOPINGS.join(' | ')}`);
  }
  if (!Array.isArray(manifest.policy?.terminalDenyRules) || manifest.policy.terminalDenyRules.length === 0) failures.push('native terminal deny rules are missing');
  if (manifest.policy?.mcpMappings !== 'disabled-until-audited-live-adapters') {
    failures.push('MCP mappings must remain disabled until audited live adapters exist');
  }
  const allSkills = flattenSkills(manifest);
  for (const [profileId, profile] of Object.entries(manifest.profiles)) {
    const template = path.join(workspace, assertRelativeRepositoryPath(profile.templatePath, `${profileId} templatePath`));
    if (!fs.existsSync(path.join(template, 'profile.json'))) failures.push(`${profileId} profile template is missing`);
    for (const skill of profile.skillAllowlist) {
      if (!allSkills.has(skill)) failures.push(`${profileId} allows unknown skill '${skill}'`);
    }
    for (const mcp of profile.mcpAllowlist) {
      if (!manifest.mcps[mcp]) failures.push(`${profileId} allows unknown MCP '${mcp}'`);
    }
  }
  for (const [name, mcp] of Object.entries(manifest.mcps)) {
    if (mcp.status !== 'integration-pending') failures.push(`MCP '${name}' must remain integration-pending in this provisioning manifest`);
  }
  if (strictRuntimeIdentity) {
    const version = readRuntimeVersion(runtimeRoot);
    const commit = readRuntimeCommit(runtimeRoot);
    if (version !== manifest.runtimeAudit.hermesVersion) failures.push('installed Hermes version differs from the audited manifest');
    if (commit !== manifest.runtimeAudit.sourceCommit) failures.push('installed Hermes commit differs from the audited manifest');
    for (const skill of manifest.skills.optionalApproved) {
      for (const [packageName, expectedVersion] of Object.entries(skill.runtimeRequirements?.pythonPackages ?? {})) {
        const installedVersion = readPythonPackageVersion(runtimeRoot, packageName);
        if (installedVersion !== expectedVersion) {
          failures.push(`skill '${skill.id}' requires Python package '${packageName}' ${expectedVersion}`);
        }
      }
      const source = resolveSkillSource(skill, { workspace, runtimeRoot });
      const requirements = skill.runtimeRequirements ?? {};
      if (requirements.entrypoint) {
        const entrypoint = assertWithin(source, path.join(source, assertRelativeRepositoryPath(requirements.entrypoint, `skill '${skill.id}' entrypoint`)), `skill '${skill.id}' entrypoint`);
        if (!fs.existsSync(entrypoint) || !fs.statSync(entrypoint).isFile()) {
          failures.push(`skill '${skill.id}' runtime entrypoint is unavailable`);
        } else if (requirements.entrypointSha256 && sha256(fs.readFileSync(entrypoint)) !== requirements.entrypointSha256) {
          failures.push(`skill '${skill.id}' runtime entrypoint digest differs from the audited manifest`);
        }
      }
      if (requirements.skillSha256) {
        const skillFile = path.join(source, 'SKILL.md');
        if (!fs.existsSync(skillFile) || sha256(fs.readFileSync(skillFile)) !== requirements.skillSha256) {
          failures.push(`skill '${skill.id}' SKILL.md digest differs from the audited manifest`);
        }
      }
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  return allSkills;
}

function loadContext(options = {}) {
  const workspace = path.resolve(options.workspace ?? WORKSPACE);
  const manifestPath = path.resolve(options.manifestPath ?? path.join(workspace, 'config', 'hermes', 'governance', 'approved-capabilities.json'));
  const runtimeRoot = path.resolve(options.runtimeRoot ?? defaultRuntimeRoot());
  const manifest = readJson(manifestPath);
  const skills = validateManifestStructure(manifest, {
    workspace,
    runtimeRoot,
    strictRuntimeIdentity: options.strictRuntimeIdentity !== false,
  });
  return { workspace, manifestPath, runtimeRoot, manifest, skills };
}

function resolveMcpActivation(context, options = {}) {
  if (options.activateMcp !== true) return { enabled: false, servers: {}, manifest: null };
  const manifestPath = path.resolve(options.mcpManifestPath ?? path.join(context.workspace, 'config', 'landos-mcp', 'manifest.json'));
  const governancePath = path.resolve(options.mcpGovernancePath ?? path.join(context.workspace, 'config', 'landos-mcp', 'profile-governance-fragment.json'));
  const fragmentPath = path.resolve(options.mcpFragmentPath ?? path.join(context.workspace, 'config', 'landos-mcp', 'hermes-mcp-fragment.yaml'));
  const canonicalBridgePath = path.resolve(options.canonicalBridgePath ?? path.join(context.workspace, 'mcp', 'landos', 'landos_mcp', 'canonical_bridge.py'));
  for (const [label, file] of [
    ['MCP manifest', manifestPath],
    ['MCP profile governance fragment', governancePath],
    ['Hermes MCP fragment', fragmentPath],
    ['canonical MCP bridge', canonicalBridgePath],
  ]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} is unavailable`);
  }
  const manifest = readJson(manifestPath);
  const governance = readJson(governancePath);
  const fragment = yaml.load(fs.readFileSync(fragmentPath, 'utf8')) ?? {};
  const expectedNames = Object.keys(context.manifest.mcps).sort();
  const manifestNames = Object.keys(manifest.servers ?? {}).sort();
  const fragmentNames = Object.keys(fragment.mcp_servers ?? {}).sort();
  if (!jsonEqual(manifestNames, expectedNames) || !jsonEqual(fragmentNames, expectedNames)) {
    throw new Error('MCP manifest and Hermes fragment must define exactly the three governed servers');
  }
  if (manifest.canonicalAdapter?.class !== 'CanonicalBridgeLandosAdapter'
    || manifest.canonicalAdapter?.productionReady !== true) {
    throw new Error('MCP activation requires a production-ready CanonicalBridgeLandosAdapter attestation');
  }
  const bridgeSource = fs.readFileSync(canonicalBridgePath, 'utf8');
  if (!/^\s*production_ready\s*=\s*True\b/m.test(bridgeSource)) {
    throw new Error('CanonicalBridgeLandosAdapter.production_ready is not true in the audited runtime source');
  }
  const configuredFragment = governance.mcpManifest;
  const expectedFragment = toPosix(path.relative(context.workspace, fragmentPath));
  if (configuredFragment !== expectedFragment) throw new Error('MCP profile governance points at a different Hermes fragment');
  for (const profileId of PROFILE_IDS) {
    const declared = governance.profileMcpAllowlists?.[profileId];
    const expected = context.manifest.profiles[profileId].mcpAllowlist;
    if (!sameSet(declared, expected)) throw new Error(`${profileId} MCP allowlist differs between governance artifacts`);
    const denied = governance.profileMcpDenylists?.[profileId];
    if (!Array.isArray(denied) || denied.some((name) => expected.includes(name))) {
      throw new Error(`${profileId} MCP denylist is missing or overlaps its allowlist`);
    }
  }
  const python = runtimePython(context.runtimeRoot);
  if (!python) throw new Error('Pinned Hermes Python runtime is unavailable for MCP activation');
  const launcher = path.join(context.workspace, 'mcp', 'landos', 'run_server.py');
  if (!fs.existsSync(launcher) || !fs.statSync(launcher).isFile()) throw new Error('Fixed LandOS MCP launcher is unavailable');
  const servers = {};
  for (const name of expectedNames) {
    const record = manifest.servers[name];
    if (record?.status !== 'verified-live-canonical') {
      throw new Error(`MCP '${name}' is not verified-live-canonical`);
    }
    const source = fragment.mcp_servers[name];
    if (source?.command !== 'python'
      || !jsonEqual(source?.args, ['-B', 'mcp/landos/run_server.py', name])
      || source?.sampling?.enabled !== false
      || source?.tools?.resources !== false
      || source?.tools?.prompts !== false
      || !sameSet(source?.tools?.include, record.includeTools)
      || !sameSet(source?.tools?.exclude, manifest.denyTools)) {
      throw new Error(`MCP '${name}' Hermes fragment differs from the audited manifest`);
    }
    if (source.env != null || source.url != null || source.headers != null) {
      throw new Error(`MCP '${name}' may not inject environment values or remote transport`);
    }
    servers[name] = {
      ...source,
      command: python,
      args: ['-B', launcher, name],
      cwd: context.workspace,
    };
  }
  return {
    enabled: true,
    servers,
    manifest: {
      path: toPosix(path.relative(context.workspace, manifestPath)),
      sha256: sha256(fs.readFileSync(manifestPath)),
      status: 'verified-live-canonical',
      canonicalAdapter: 'CanonicalBridgeLandosAdapter',
    },
  };
}

function generatedConfig(manifest, profile, workspace, mcpActivation = { enabled: false, servers: {} }) {
  const allowedToolsets = new Set(profile.capabilities.toolsets);
  const allowsDuckDuckGo = allowedToolsets.has('web');
  const hasTerminal = allowedToolsets.has('terminal');
  const hasBrowser = allowedToolsets.has('browser');
  return {
    _config_version: manifest.runtimeAudit.configSchemaVersion,
    model: {
      provider: 'openai-codex',
      default: 'gpt-5.5',
    },
    memory: {
      memory_enabled: true,
      user_profile_enabled: true,
    },
    skills: {
      external_dirs: [],
      inline_shell: true,
      guard_agent_created: false,
      write_approval: false,
    },
    ...(hasTerminal ? { terminal: { cwd: workspace } } : {}),
    // Every browser-capable profile attaches to the ONE dedicated LandOS
    // automation Chrome and gets the full interaction surface. Without
    // cdp_url the native browser_cdp tool gates itself off and Hermes silently
    // degrades to DOM-only inspection, which cannot see canvas/WebGL map
    // changes. Private URLs stay open so LandOS can drive its own localhost
    // dashboard and county/municipal hosts; evaluate is unrestricted so
    // interactive viewers and map canvases can be inspected.
    ...(hasBrowser ? {
      browser: {
        engine: 'auto',
        cdp_url: LANDOS_SHARED_CDP_URL,
        allow_private_urls: true,
        restrict_evaluate: false,
        record_sessions: profile.id === 'landos-visual-qa',
      },
    } : {}),
    ...(allowsDuckDuckGo ? { web: { extract_char_limit: 15_000 } } : {}),
    plugins: {
      disabled: [...NON_SELECTED_WEB_PROVIDER_PLUGINS, ...(allowsDuckDuckGo ? [] : ['web/ddgs'])].sort(),
    },
    approvals: {
      mode: 'smart',
      cron_mode: profile.id === 'landos-automation' ? 'approve' : 'deny',
      deny: [...manifest.policy.terminalDenyRules],
    },
    checkpoints: { enabled: true },
    platform_toolsets: {
      cli: [...profile.capabilities.toolsets],
    },
    known_builtin_toolsets: {
      cli: [...manifest.runtimeAudit.knownBuiltinToolsets],
    },
    known_plugin_toolsets: {
      cli: [...manifest.runtimeAudit.knownPluginToolsets],
    },
    agent: {
      disabled_toolsets: manifest.runtimeAudit.knownImplicitToolsets.filter((toolset) => !allowedToolsets.has(toolset)),
    },
    security: {
      redact_secrets: true,
      tirith_enabled: false,
      allow_lazy_installs: true,
    },
    mcp_servers: mcpActivation.enabled
      ? Object.fromEntries(profile.capabilities.mcpServers.map((name) => [name, mcpActivation.servers[name]]))
      : {},
  };
}

function targetSkillRelative(skill) {
  const category = skill.kind === 'custom'
    ? 'governed'
    : skill.kind === 'official-optional'
      ? 'optional'
      : 'bundled';
  return path.join('skills', category, skill.id);
}

function addDirectoryFiles(expected, sourceRoot, targetRelative) {
  for (const sourceFile of listRegularFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourceFile);
    expected.set(path.join(targetRelative, relative), fs.readFileSync(sourceFile));
  }
}

function profileExpectedFiles(context, profileId, mcpActivation = { enabled: false, servers: {}, manifest: null }) {
  const manifestEntry = context.manifest.profiles[profileId];
  const templateRoot = path.join(context.workspace, assertRelativeRepositoryPath(manifestEntry.templatePath, `${profileId} templatePath`));
  const profile = readJson(path.join(templateRoot, 'profile.json'));
  if (profile.id !== profileId) throw new Error(`${profileId} template declares a different id`);
  if (!sameSet(profile.capabilities.skills, manifestEntry.skillAllowlist)) throw new Error(`${profileId} skill allowlist drift`);
  if (!sameSet(profile.capabilities.toolsets, manifestEntry.toolsetAllowlist)) throw new Error(`${profileId} toolset allowlist drift`);
  if (!sameSet(profile.capabilities.tools, manifestEntry.toolAllowlist)) throw new Error(`${profileId} tool allowlist drift`);
  if (!sameSet(profile.capabilities.mcpServers, manifestEntry.mcpAllowlist)) throw new Error(`${profileId} MCP allowlist drift`);

  const expected = new Map();
  expected.set('SOUL.md', fs.readFileSync(path.join(templateRoot, 'SOUL.md')));
  expected.set(path.join('memories', 'MEMORY.md'), fs.readFileSync(path.join(templateRoot, 'memories', 'MEMORY.md')));
  expected.set(path.join('memories', 'USER.md'), fs.readFileSync(path.join(templateRoot, 'memories', 'USER.md')));
  expected.set('.no-bundled-skills', Buffer.from('Governed profile: bundled auto-seeding is disabled; only the audited allowlist is materialized.\n'));
  expected.set('.env', Buffer.from('# Governed profile-local credentials only. No credentials are provisioned by LandOS.\n'));
  expected.set('config.yaml', Buffer.from(yaml.dump(generatedConfig(context.manifest, profile, context.workspace, mcpActivation), {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  })));
  expected.set(path.join('.landos-governance', 'profile.json'), Buffer.from(stableJson(profile)));

  const provenanceRecords = [];
  for (const skillId of manifestEntry.skillAllowlist) {
    const skill = context.skills.get(skillId);
    const source = resolveSkillSource(skill, context);
    validateSkillSource(skill, source);
    const target = targetSkillRelative(skill);
    addDirectoryFiles(expected, source, target);
    provenanceRecords.push({
      id: skill.id,
      version: skill.version,
      kind: skill.kind,
      sourceType: skill.source.type,
      sourceCommit: skill.source.commit,
      sourceDirectorySha256: directoryDigest(source),
      installedDirectory: toPosix(target),
      reviewedAt: context.manifest.generatedAt,
      updatePolicy: skill.updatePolicy,
    });
  }
  provenanceRecords.sort((a, b) => a.id.localeCompare(b.id));
  expected.set(path.join('.landos-governance', 'skill-provenance.json'), Buffer.from(stableJson({
    schemaVersion: '1.0.0',
    profile: profileId,
    enforcement: 'normal-dirty-worktree-review',
    skills: provenanceRecords,
  })));
  expected.set(path.join('.landos-governance', 'manifest-lock.json'), Buffer.from(stableJson({
    schemaVersion: '1.0.0',
    profile: profileId,
    manifestId: context.manifest.manifestId,
    manifestGeneratedAt: context.manifest.generatedAt,
    manifestSha256: sha256(fs.readFileSync(context.manifestPath)),
    hermesVersion: context.manifest.runtimeAudit.hermesVersion,
    hermesCommit: context.manifest.runtimeAudit.sourceCommit,
    skillGovernance: context.manifest.policy.skillGovernance,
    externalMutation: 'explicit-only',
    mcpMappings: mcpActivation.enabled ? 'verified-live-canonical' : context.manifest.policy.mcpMappings,
    mcpActivation: mcpActivation.manifest,
  })));
  return { expected, profile, templateRoot };
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

function preflightExpectedFiles(profileRoot, expected) {
  const conflicts = [];
  const missing = [];
  for (const [relative, content] of expected) {
    const target = assertWithin(profileRoot, path.join(profileRoot, relative), 'managed profile file');
    if (!fs.existsSync(target)) missing.push([target, content]);
    else if (toPosix(relative).startsWith('skills/')) continue;
    else if (!fs.statSync(target).isFile() || !fs.readFileSync(target).equals(content)) conflicts.push(toPosix(relative));
  }
  return { conflicts, missing };
}

export function provisionProfiles(options = {}) {
  const context = loadContext(options);
  const mcpActivation = resolveMcpActivation(context, options);
  const targetRoot = path.resolve(options.targetRoot ?? defaultTargetRoot());
  const selected = resolveSelectedProfiles(context.manifest, options.profile);
  const dryRun = options.dryRun === true;
  const results = [];
  const productionRoot = assertWithin(targetRoot, path.join(targetRoot, 'landos'), 'production profile');
  if (fs.existsSync(productionRoot) && !fs.statSync(productionRoot).isDirectory()) {
    throw new Error('Existing production profile path is not a directory');
  }
  const productionDigestBefore = fs.existsSync(productionRoot) ? directoryDigest(productionRoot) : null;

  for (const profileId of selected) {
    const profileRoot = assertWithin(targetRoot, path.join(targetRoot, profileId), `target profile '${profileId}'`);
    const { expected } = profileExpectedFiles(context, profileId, mcpActivation);
    const { conflicts, missing } = preflightExpectedFiles(profileRoot, expected);
    if (conflicts.length) {
      results.push({ profile: profileId, status: 'conflict', createdFiles: 0, conflicts });
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(profileRoot, { recursive: true });
      for (const directory of MANAGED_DIRECTORIES) fs.mkdirSync(path.join(profileRoot, directory), { recursive: true });
      for (const [target, content] of missing) writeAtomic(target, content);
    }
    results.push({
      profile: profileId,
      status: dryRun ? 'dry-run' : 'ready',
      createdFiles: missing.length,
      unchangedFiles: expected.size - missing.length,
      conflicts: [],
    });
  }
  const productionDigestAfter = fs.existsSync(productionRoot) ? directoryDigest(productionRoot) : null;
  const productionPreserved = productionDigestBefore === productionDigestAfter;
  return {
    ok: results.every((item) => item.status !== 'conflict') && productionPreserved,
    dryRun,
    productionProfile: {
      present: productionDigestBefore !== null,
      digestBefore: productionDigestBefore,
      digestAfter: productionDigestAfter,
      preserved: productionPreserved,
    },
    results,
  };
}

function configFailures(config, profile, context, mcpActivation = { enabled: false, servers: {} }) {
  const failures = [];
  if (config?._config_version !== context.manifest.runtimeAudit.configSchemaVersion) failures.push('config schema version mismatch');
  if (config?.model?.provider !== 'openai-codex') failures.push('model.provider must be openai-codex');
  if (config?.model?.default !== 'gpt-5.5') failures.push('model.default must be gpt-5.5');
  if (config?.memory?.memory_enabled !== true || config?.memory?.user_profile_enabled !== true) failures.push('profile memory must be enabled');
  if (config?.skills?.write_approval !== false || config?.skills?.guard_agent_created !== false || config?.skills?.inline_shell !== true) failures.push('normal skill use is still gated');
  const expectsTerminal = profile.capabilities.toolsets.includes('terminal');
  if (expectsTerminal && config?.terminal?.cwd !== context.workspace) failures.push('terminal must start in the LandOS workspace');
  if (!expectsTerminal && config?.terminal != null) failures.push('terminal configured outside its profile scope');
  const expectsBrowser = profile.capabilities.toolsets.includes('browser');
  if (expectsBrowser) {
    if (config?.browser?.engine !== 'auto' || config?.browser?.cdp_url !== '' || config?.browser?.restrict_evaluate !== true) failures.push('browser/CDP scope differs from the profile contract');
    if (profile.id === 'landos-visual-qa' && (config?.browser?.allow_private_urls !== true || config?.browser?.record_sessions !== true)) failures.push('visual QA must support isolated localhost recording');
  } else if (config?.browser != null) failures.push('browser configured outside its profile scope');
  const expectsDuckDuckGo = profile.capabilities.skills.includes('duckduckgo-search')
    && profile.capabilities.toolsets.includes('web');
  if (expectsDuckDuckGo) {
    if (config?.web?.backend !== 'ddgs' || config?.web?.search_backend !== 'ddgs' || config?.web?.extract_backend !== 'ddgs') {
      failures.push(`${profile.id} web provider must be pinned to keyless ddgs`);
    }
  } else if (config?.web != null) failures.push('non-research profiles may not configure a web provider');
  const requiredDisabledPlugins = [...NON_SELECTED_WEB_PROVIDER_PLUGINS, ...(expectsDuckDuckGo ? [] : ['web/ddgs'])].sort();
  if (!sameSet(config?.plugins?.disabled, requiredDisabledPlugins)) failures.push('web provider plugin denylist differs from the profile contract');
  if (config?.security?.redact_secrets !== true) failures.push('secret redaction must be enabled');
  if (config?.security?.tirith_enabled !== false || config?.security?.allow_lazy_installs !== true) failures.push('unsupported blanket runtime restrictions remain enabled');
  const expectedCronMode = profile.id === 'landos-automation' ? 'approve' : 'deny';
  if (config?.approvals?.mode !== 'smart' || config?.approvals?.cron_mode !== expectedCronMode || !sameSet(config?.approvals?.deny, context.manifest.policy.terminalDenyRules)) failures.push('approved native command policy differs from the manifest');
  if (config?.checkpoints?.enabled !== true) failures.push('dirty-state checkpoints must be enabled');
  if (!sameSet(config?.platform_toolsets?.cli, profile.capabilities.toolsets)) failures.push('CLI toolsets differ from the profile allowlist');
  if (!sameSet(config?.known_builtin_toolsets?.cli, context.manifest.runtimeAudit.knownBuiltinToolsets)) failures.push('known built-in toolset inventory differs from the audited runtime');
  if (!sameSet(config?.known_plugin_toolsets?.cli, context.manifest.runtimeAudit.knownPluginToolsets)) failures.push('known plugin toolset inventory differs from the audited runtime');
  const expectedImplicitDisabled = context.manifest.runtimeAudit.knownImplicitToolsets.filter((item) => !profile.capabilities.toolsets.includes(item));
  if (!sameSet(config?.agent?.disabled_toolsets, expectedImplicitDisabled)) failures.push('unrequested implicit toolsets are not narrowly disabled');
  const mcpNames = config?.mcp_servers && typeof config.mcp_servers === 'object' ? Object.keys(config.mcp_servers) : [];
  const unauthorizedMcp = mcpNames.filter((name) => !profile.capabilities.mcpServers.includes(name));
  if (unauthorizedMcp.length) failures.push(`unauthorized MCP servers: ${unauthorizedMcp.sort().join(', ')}`);
  if (!mcpActivation.enabled && mcpNames.length) {
    failures.push(`integration-pending MCP mappings must remain disabled: ${mcpNames.sort().join(', ')}`);
  }
  if (mcpActivation.enabled) {
    if (!sameSet(mcpNames, profile.capabilities.mcpServers)) failures.push('active MCP names differ from the profile allowlist');
    for (const name of profile.capabilities.mcpServers) {
      if (!jsonEqual(config.mcp_servers?.[name], mcpActivation.servers[name])) failures.push(`active MCP '${name}' differs from the audited fixed fragment`);
    }
  }
  if (!Array.isArray(config?.skills?.external_dirs) || config.skills.external_dirs.length !== 0) failures.push('external skill directories must remain empty');
  return failures;
}

function installedSkillRoots(profileRoot) {
  const skillsRoot = path.join(profileRoot, 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  const roots = [];
  for (const category of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const entry of fs.readdirSync(path.join(skillsRoot, category.name), { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(skillsRoot, category.name, entry.name));
    }
  }
  return roots;
}

function checkProfile(context, targetRoot, profileId, mcpActivation = { enabled: false, servers: {}, manifest: null }) {
  const profileRoot = assertWithin(targetRoot, path.join(targetRoot, profileId), `target profile '${profileId}'`);
  const failures = [];
  if (!fs.existsSync(profileRoot)) return { profile: profileId, ok: false, failures: ['profile is missing'] };
  const { expected, profile } = profileExpectedFiles(context, profileId, mcpActivation);
  for (const directory of MANAGED_DIRECTORIES) {
    if (!fs.existsSync(path.join(profileRoot, directory))) failures.push(`required directory '${toPosix(directory)}' is missing`);
  }
  const configPath = path.join(profileRoot, 'config.yaml');
  if (!fs.existsSync(configPath)) failures.push('config.yaml is missing');
  else {
    try {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) ?? {};
      failures.push(...configFailures(config, profile, context, mcpActivation));
    } catch {
      failures.push('config.yaml is invalid YAML');
    }
  }
  const marker = path.join(profileRoot, '.no-bundled-skills');
  if (!fs.existsSync(marker)) failures.push('bundled-skill opt-out marker is missing');
  const envFile = path.join(profileRoot, '.env');
  if (!fs.existsSync(envFile)) failures.push('profile-local .env placeholder is missing');
  else {
    const assignments = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#') && /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line));
    if (assignments.length) failures.push('profile-local .env contains assignments not provisioned by governance');
  }
  for (const [relative, content] of expected) {
    if (relative === 'config.yaml') continue;
    if (toPosix(relative).startsWith('skills/')) continue;
    const target = path.join(profileRoot, relative);
    if (!fs.existsSync(target)) failures.push(`managed file '${toPosix(relative)}' is missing`);
    else if (!fs.statSync(target).isFile() || !fs.readFileSync(target).equals(content)) failures.push(`managed file '${toPosix(relative)}' differs from its approved snapshot`);
  }
  const installed = new Map();
  for (const root of installedSkillRoots(profileRoot)) {
    const skillFile = path.join(root, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      failures.push(`skill directory '${toPosix(path.relative(profileRoot, root))}' has no SKILL.md`);
      continue;
    }
    try {
      const { frontmatter } = parseSkillFrontmatter(skillFile);
      if (installed.has(frontmatter.name)) failures.push(`duplicate installed skill '${frontmatter.name}'`);
      installed.set(frontmatter.name, root);
    } catch (error) {
      failures.push(`invalid skill in '${toPosix(path.relative(profileRoot, root))}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const allowed = new Set(profile.capabilities.skills);
  for (const name of installed.keys()) if (!allowed.has(name)) failures.push(`unauthorized installed skill '${name}'`);
  for (const name of allowed) if (!installed.has(name)) failures.push(`allowed skill '${name}' is not installed`);
  return { profile: profileId, ok: failures.length === 0, failures };
}

export function checkProfiles(options = {}) {
  const context = loadContext(options);
  const mcpActivation = resolveMcpActivation(context, options);
  const targetRoot = path.resolve(options.targetRoot ?? defaultTargetRoot());
  const selected = resolveSelectedProfiles(context.manifest, options.profile);
  const results = selected.map((profileId) => checkProfile(context, targetRoot, profileId, mcpActivation));
  return { ok: results.every((item) => item.ok), results };
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateResearchCapabilityRegistry(options = {}) {
  const workspace = path.resolve(options.workspace ?? WORKSPACE);
  const contractPath = path.resolve(options.capabilityContractPath ?? path.join(
    workspace,
    'config',
    'hermes',
    'governance',
    'research-capability-contract.json',
  ));
  const failures = [];
  if (!fs.existsSync(contractPath)) {
    return { ok: false, registryPath: null, failures: ['research capability contract is missing'] };
  }
  const contract = readJson(contractPath);
  const registryPath = path.resolve(options.capabilityRegistryPath ?? path.join(
    workspace,
    assertRelativeRepositoryPath(contract.registryPath, 'research capability registry'),
  ));
  if (!fs.existsSync(registryPath)) {
    return { ok: false, registryPath, failures: ['research capability registry is missing'] };
  }
  const registry = readJson(registryPath);
  if (!Array.isArray(registry.capabilities)) failures.push('research capability registry has no capabilities array');
  const entries = new Map();
  for (const capability of registry.capabilities ?? []) {
    if (!capability || typeof capability.id !== 'string') {
      failures.push('research capability registry contains an invalid capability');
      continue;
    }
    if (entries.has(capability.id)) failures.push(`research capability registry duplicates '${capability.id}'`);
    entries.set(capability.id, capability);
  }
  for (const [id, expected] of Object.entries(contract.capabilities ?? {})) {
    const actual = entries.get(id);
    if (!actual) {
      failures.push(`research capability registry is missing '${id}'`);
      continue;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (!jsonEqual(actual[field], value)) {
        failures.push(`research capability '${id}' field '${field}' differs from the governed contract`);
      }
    }
  }

  const manifestPath = path.resolve(options.manifestPath ?? path.join(workspace, 'config', 'hermes', 'governance', 'approved-capabilities.json'));
  if (fs.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    const optional = new Map((manifest.skills?.optionalApproved ?? []).map((skill) => [skill.id, skill]));
    const evaluations = new Map((manifest.optionalEvaluations ?? []).map((item) => [item.id, item]));
    const allowedProfiles = (skillId) => Object.entries(manifest.profiles ?? {})
      .filter(([, profile]) => profile.skillAllowlist?.includes(skillId))
      .map(([profileId]) => profileId)
      .sort();
    // Free search stays pinned to an audited package version, but it is no
    // longer confined to one profile. Search is ordinary capability: every
    // web-capable profile may use it, and Hermes chooses whether search or
    // full browser interaction is the faster path for the task in front of it.
    const duck = optional.get('duckduckgo-search');
    if (!duck || duck.runtimeRequirements?.pythonPackages?.ddgs !== '9.14.4') {
      failures.push('DuckDuckGo must be pinned to ddgs 9.14.4');
    }
    const grounded = evaluations.get('grounded-citations');
    if (optional.has('grounded-citations') || allowedProfiles('grounded-citations').length || grounded?.status !== 'blocked') {
      failures.push('grounded-citations must remain a required evidence policy with no invented Hermes skill');
    }
    const domain = optional.get('domain-intel');
    if (!domain || !sameSet(domain.owners, ['landos-research'])
      || domain.runtimeRequirements?.executionState !== 'enabled-approved-public-sources'
      || evaluations.get('domain-intel')?.status !== 'approved') {
      failures.push('domain-intel must be pinned and enabled only for approved public-source research');
    }
    for (const id of ['scrapling', 'osint-investigation']) {
      if (optional.has(id) || allowedProfiles(id).length || evaluations.get(id)?.status !== 'blocked') {
        failures.push(`${id} must remain blocked, uninstalled, and unassigned`);
      }
    }
  }
  return {
    ok: failures.length === 0,
    contractPath,
    registryPath,
    checkedCapabilities: Object.keys(contract.capabilities ?? {}).length,
    failures,
  };
}

export function auditRepository(options = {}) {
  const context = loadContext(options);
  const failures = [];
  const customNames = new Set();
  for (const skill of context.manifest.skills.customSnapshots) {
    if (customNames.has(skill.id)) failures.push(`duplicate custom skill '${skill.id}'`);
    customNames.add(skill.id);
  }
  for (const profileId of PROFILE_IDS) {
    try {
      profileExpectedFiles(context, profileId);
    } catch (error) {
      failures.push(`${profileId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const approvedEvaluationStatuses = new Set(['approved', 'bundled-approved']);
  const forbiddenOptional = new Set(context.manifest.optionalEvaluations.filter((item) => !approvedEvaluationStatuses.has(item.status)).map((item) => item.id));
  for (const [profileId, profile] of Object.entries(context.manifest.profiles)) {
    const overlap = profile.skillAllowlist.filter((skill) => forbiddenOptional.has(skill));
    if (overlap.length) failures.push(`${profileId} includes blocked optional skills: ${overlap.join(', ')}`);
  }
  const researchCapabilities = validateResearchCapabilityRegistry({
    ...options,
    workspace: context.workspace,
    manifestPath: context.manifestPath,
  });
  failures.push(...researchCapabilities.failures.map((failure) => `cross-artifact: ${failure}`));
  return {
    ok: failures.length === 0,
    profiles: PROFILE_IDS.length,
    customSkills: customNames.size,
    approvedOptionalSkills: context.manifest.skills.optionalApproved.length,
    researchCapabilities,
    failures,
  };
}

function runtimePython(runtimeRoot) {
  const candidates = process.platform === 'win32'
    ? [path.join(runtimeRoot, 'venv', 'Scripts', 'python.exe')]
    : [path.join(runtimeRoot, 'venv', 'bin', 'python3'), path.join(runtimeRoot, 'venv', 'bin', 'python')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function runtimeHermesLauncher(runtimeRoot) {
  const candidates = process.platform === 'win32'
    ? [path.join(runtimeRoot, 'venv', 'Scripts', 'hermes.exe')]
    : [path.join(runtimeRoot, 'venv', 'bin', 'hermes')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function sanitizedRuntimeEnvironment(profileRoot, { denyNetwork = false } = {}) {
  const environment = {};
  const passthrough = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'TEMP', 'TMP', 'TMPDIR', 'COMSPEC', 'NUMBER_OF_PROCESSORS',
  ];
  for (const key of passthrough) {
    if (process.env[key] != null) environment[key] = process.env[key];
  }
  environment.HERMES_HOME = profileRoot;
  environment.PYTHONDONTWRITEBYTECODE = '1';
  environment.PYTHONUTF8 = '1';
  if (denyNetwork) {
    environment.HTTP_PROXY = 'http://127.0.0.1:9';
    environment.HTTPS_PROXY = 'http://127.0.0.1:9';
    environment.ALL_PROXY = 'http://127.0.0.1:9';
    environment.NO_PROXY = '';
  }
  return environment;
}

function parseTrailingJsonDocument(output, label) {
  const lines = output.trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trim().startsWith('{')) continue;
    try {
      return JSON.parse(lines.slice(index).join('\n'));
    } catch {
      // A nested object can also begin with "{". Keep walking toward the
      // outermost document instead of accepting a partial CLI result.
    }
  }
  throw new Error(`${label} returned no complete JSON document`);
}

function runNamedProfileCliSmoke({ runtimeRoot, targetRoot, profileId, allowedToolsets }) {
  const launcher = runtimeHermesLauncher(runtimeRoot);
  if (!launcher) throw new Error('Pinned Hermes CLI launcher is unavailable');
  if (path.basename(targetRoot).toLowerCase() !== 'profiles') {
    throw new Error("Named-profile CLI smoke requires a target root named 'profiles'");
  }
  const hermesRoot = path.dirname(targetRoot);
  const profileWorkspace = assertWithin(
    targetRoot,
    path.join(targetRoot, profileId, 'workspace'),
    `profile workspace '${profileId}'`,
  );
  const result = spawnSync(launcher, ['--profile', profileId, 'prompt-size', '--json'], {
    cwd: profileWorkspace,
    env: sanitizedRuntimeEnvironment(hermesRoot, { denyNetwork: true }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Hermes named-profile CLI smoke exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  const output = parseTrailingJsonDocument(result.stdout ?? '', 'Hermes named-profile CLI smoke');
  if (output.platform !== 'cli') throw new Error('Hermes named-profile CLI smoke did not initialize the CLI platform');
  const activeToolsets = (output.toolsets_breakdown ?? []).map((item) => item.toolset);
  const attributedToolsets = [...allowedToolsets, ...(allowedToolsets.includes('browser') ? ['web'] : [])];
  if (activeToolsets.some((toolset) => !attributedToolsets.includes(toolset))) {
    throw new Error('Hermes named-profile CLI smoke activated a toolset outside the profile allowlist');
  }
  return {
    ok: true,
    command: `hermes --profile ${profileId} prompt-size --json`,
    networkEnvironment: 'loopback-deny-proxy-and-sanitized-env',
    providerCredentialVariablesInherited: false,
    activeToolsets,
    output,
  };
}

function runRuntimeJson({ python, runtimeRoot, profileRoot, source, args = [] }) {
  const result = spawnSync(python, ['-B', '-c', source, ...args], {
    cwd: runtimeRoot,
    env: sanitizedRuntimeEnvironment(profileRoot),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Hermes offline loader exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  const lines = (result.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('Hermes offline loader returned no JSON');
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    throw new Error('Hermes offline loader returned malformed JSON');
  }
}

export function smokeProfiles(options = {}) {
  const context = loadContext(options);
  const targetRoot = path.resolve(options.targetRoot ?? defaultTargetRoot());
  const selected = resolveSelectedProfiles(context.manifest, options.profile);
  const checked = checkProfiles({ ...options, targetRoot });
  if (!checked.ok) return { ok: false, checked, profiles: [], runtimeCapabilities: null };
  const python = runtimePython(context.runtimeRoot);
  if (!python) throw new Error('Pinned Hermes Python runtime is unavailable for the offline skill-loader smoke');
  const loaderSource = [
    'import hashlib,json',
    'from tools.skills_tool import _find_all_skills,skill_view',
    'items=_find_all_skills()',
    'views=[]',
    'for item in items:',
    " r=skill_view(item['name'],preprocess=False)",
    ' r=json.loads(r) if isinstance(r,str) else r',
    " c=r.get('content','') if isinstance(r,dict) else ''",
    " views.append({'name':item['name'],'success':bool(r.get('success')),'readiness_status':r.get('readiness_status'),'content_sha256':hashlib.sha256(c.encode('utf-8')).hexdigest()})",
    "print(json.dumps({'skills':sorted(views,key=lambda x:x['name'])},sort_keys=True))",
  ].join('\n');
  const commandPolicySource = [
    'import json',
    'from tools.approval import check_dangerous_command',
    "blocked=['Get-Content .env','cat .env','sqlite3 landos.db \\\"UPDATE deal_cards SET status=1\\\"','Remove-Item -Recurse web','curl -X PATCH http://127.0.0.1:3000/api/deal-cards/1 -d {}']",
    "allowed=['git status --short','node --version','Get-Content logs/app.log','npx playwright test --list']",
    "def verdict(command):",
    " r=check_dangerous_command(command,'local')",
    " return {'command':command,'approved':bool(r.get('approved')),'user_deny':bool(r.get('user_deny'))}",
    "print(json.dumps({'blocked':[verdict(x) for x in blocked],'allowed':[verdict(x) for x in allowed]},sort_keys=True))",
  ].join('\n');
  const profiles = [];
  for (const profileId of selected) {
    const profileRoot = assertWithin(targetRoot, path.join(targetRoot, profileId), `target profile '${profileId}'`);
    try {
      const evidence = runRuntimeJson({
        python,
        runtimeRoot: context.runtimeRoot,
        profileRoot,
        source: loaderSource,
      });
      const loadedNames = (evidence.skills ?? []).map((item) => item.name).sort();
      const expectedNames = [...context.manifest.profiles[profileId].skillAllowlist].sort();
      const failures = [];
      if (!jsonEqual(loadedNames, expectedNames)) failures.push('actual Hermes loader skill names differ from the profile allowlist');
      if ((evidence.skills ?? []).some((item) => item.success !== true)) failures.push('actual Hermes loader could not view every allowlisted skill');
      const commandPolicy = runRuntimeJson({
        python,
        runtimeRoot: context.runtimeRoot,
        profileRoot,
        source: commandPolicySource,
      });
      if ((commandPolicy.blocked ?? []).some((item) => item.approved !== false || item.user_deny !== true)) failures.push('approved command policy did not block every protected operation');
      if ((commandPolicy.allowed ?? []).some((item) => item.approved !== true)) failures.push('approved command policy blocked a normal bounded command');
      let cli;
      try {
        cli = runNamedProfileCliSmoke({
          runtimeRoot: context.runtimeRoot,
          targetRoot,
          profileId,
          allowedToolsets: context.manifest.profiles[profileId].toolsetAllowlist,
        });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
        cli = { ok: false };
      }
      profiles.push({
        profile: profileId,
        ok: failures.length === 0,
        skillCount: loadedNames.length,
        skills: evidence.skills ?? [],
        commandPolicy,
        cli,
        failures,
      });
    } catch (error) {
      profiles.push({
        profile: profileId,
        ok: false,
        skillCount: 0,
        skills: [],
        failures: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  const researchRoot = assertWithin(targetRoot, path.join(targetRoot, 'landos-research'), 'research profile');
  const domainRoot = findInstalledSkill(researchRoot, 'domain-intel');
  let runtimeCapabilities;
  try {
    if (!domainRoot) throw new Error('domain-intel is not installed in landos-research');
    const domainScript = path.join(domainRoot, 'scripts', 'domain_intel.py');
    const domainSource = [
      'import json,runpy,socket,sys,urllib.request',
      "deny=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('network disabled'))",
      'socket.create_connection=deny',
      'socket.getaddrinfo=deny',
      'socket.gethostbyname=deny',
      'urllib.request.urlopen=deny',
      'ns=runpy.run_path(sys.argv[1])',
      "print(json.dumps({'bulk':callable(ns['bulk_check']),'commands':sorted(ns['COMMAND_MAP'])},sort_keys=True))",
    ].join(';');
    const domainIntel = runRuntimeJson({
      python,
      runtimeRoot: context.runtimeRoot,
      profileRoot: researchRoot,
      source: domainSource,
      args: [domainScript],
    });
    const ddgsSource = "import importlib.metadata,json; from ddgs import DDGS; print(json.dumps({'imported':bool(DDGS),'version':importlib.metadata.version('ddgs')},sort_keys=True))";
    const duckduckgo = runRuntimeJson({
      python,
      runtimeRoot: context.runtimeRoot,
      profileRoot: researchRoot,
      source: ddgsSource,
    });
    runtimeCapabilities = {
      ok: domainIntel.bulk === true
        && jsonEqual(domainIntel.commands, ['available', 'dns', 'ssl', 'subdomains', 'whois'])
        && duckduckgo.imported === true
        && duckduckgo.version === '9.14.4',
      domainIntel: {
        ...domainIntel,
        networkDuringSmoke: 'denied',
        directExecution: 'enabled-approved-public-sources',
      },
      duckduckgo: { ...duckduckgo, networkDuringSmoke: 'none' },
    };
  } catch (error) {
    runtimeCapabilities = {
      ok: false,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }
  return {
    ok: checked.ok && profiles.every((item) => item.ok) && runtimeCapabilities.ok,
    providerCalls: 0,
    networkCalls: 0,
    checked,
    profiles,
    runtimeCapabilities,
  };
}

function diffDirectory(oldRoot, newRoot) {
  const describe = (root) => {
    const map = new Map();
    if (!root || !fs.existsSync(root)) return map;
    for (const file of listRegularFiles(root)) {
      const buffer = fs.readFileSync(file);
      const extension = path.extname(file).toLowerCase();
      map.set(toPosix(path.relative(root, file)), {
        sha256: sha256(buffer),
        text: TEXT_EXTENSIONS.has(extension) && !buffer.includes(0) ? buffer.toString('utf8') : null,
      });
    }
    return map;
  };
  const before = describe(oldRoot);
  const after = describe(newRoot);
  const added = [...after.keys()].filter((key) => !before.has(key)).sort();
  const modified = [...after.keys()].filter((key) => before.has(key) && before.get(key).sha256 !== after.get(key).sha256).sort();
  const removed = [...before.keys()].filter((key) => !after.has(key)).sort();
  const details = [...new Set([...added, ...modified, ...removed])].sort().map((file) => ({
    file,
    status: added.includes(file) ? 'added' : removed.includes(file) ? 'removed' : 'modified',
    beforeSha256: before.get(file)?.sha256 ?? null,
    afterSha256: after.get(file)?.sha256 ?? null,
    beforeText: before.get(file)?.text ?? null,
    afterText: after.get(file)?.text ?? null,
  }));
  return { added, modified, removed, details, fullTextReview: true };
}

function findInstalledSkill(profileRoot, name) {
  for (const root of installedSkillRoots(profileRoot)) {
    const skillFile = path.join(root, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      if (parseSkillFrontmatter(skillFile).frontmatter.name === name) return root;
    } catch {
      // Invalid skills are handled by the profile check; do not treat them as an approval target.
    }
  }
  return null;
}

function assertMutableTarget(options) {
  if (options.targetRoot) return path.resolve(options.targetRoot);
  if (options.applyExternal === true) return defaultTargetRoot();
  throw new Error('Mutation requires an explicit --target-root or --apply-external');
}

export function stageSkill(options = {}) {
  const context = loadContext(options);
  const targetRoot = assertMutableTarget(options);
  const profileId = options.profile;
  if (!PROFILE_IDS.includes(profileId)) throw new Error('stage-skill requires one governed --profile');
  if (!options.source) throw new Error('stage-skill requires --source');
  const profileRoot = assertWithin(targetRoot, path.join(targetRoot, profileId), `target profile '${profileId}'`);
  if (!fs.existsSync(profileRoot)) throw new Error(`Profile '${profileId}' is not provisioned`);
  let source = path.resolve(options.source);
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    if (path.basename(source).toLowerCase() !== 'skill.md') throw new Error('Skill source file must be named SKILL.md');
    source = path.dirname(source);
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error('Skill source is unavailable');
  const { frontmatter } = parseSkillFrontmatter(path.join(source, 'SKILL.md'));
  const findings = scanSkillDirectory(source);
  if (findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high')) {
    const ids = [...new Set(findings.map((finding) => finding.id))].sort().join(', ');
    throw new Error(`Dangerous-pattern scan rejected the candidate (${ids})`);
  }
  const digest = directoryDigest(source);
  const pendingId = `${frontmatter.name}-${digest.slice(0, 12)}`;
  const pendingRoot = assertWithin(profileRoot, path.join(profileRoot, '.landos-governance', 'pending-skills', pendingId), 'pending skill');
  const candidateRoot = path.join(pendingRoot, 'candidate');
  const recordPath = path.join(pendingRoot, 'record.json');
  if (fs.existsSync(recordPath)) {
    const existing = readJson(recordPath);
    if (existing.candidateSha256 !== digest) throw new Error('Pending id collision');
    return { ok: true, id: pendingId, status: existing.status, existing: true };
  }
  const current = findInstalledSkill(profileRoot, frontmatter.name);
  const diff = diffDirectory(current, source);
  fs.mkdirSync(candidateRoot, { recursive: true });
  for (const file of listRegularFiles(source)) {
    const relative = path.relative(source, file);
    writeAtomic(path.join(candidateRoot, relative), fs.readFileSync(file));
  }
  const stagedAt = new Date().toISOString();
  writeAtomic(path.join(pendingRoot, 'diff.json'), stableJson({
    schemaVersion: '1.0.0',
    id: pendingId,
    skill: frontmatter.name,
    currentSha256: current ? directoryDigest(current) : null,
    candidateSha256: digest,
    ...diff,
    reviewRequired: true,
  }));
  writeAtomic(recordPath, stableJson({
    schemaVersion: '1.0.0',
    id: pendingId,
    profile: profileId,
    skill: frontmatter.name,
    version: String(frontmatter.version ?? ''),
    candidateSha256: digest,
    stagedAt,
    status: 'pending',
    scanner: 'landos-governed-scan-v1',
    findings,
  }));
  return { ok: true, id: pendingId, status: 'pending', existing: false, diff };
}

export function reviewSkill(options = {}) {
  const context = loadContext(options);
  const targetRoot = assertMutableTarget(options);
  const profileId = options.profile;
  if (!PROFILE_IDS.includes(profileId)) throw new Error('review-skill requires one governed --profile');
  if (!options.id) throw new Error('review-skill requires --id');
  if (!['approve', 'reject'].includes(options.decision)) throw new Error('review-skill requires --decision approve|reject');
  const profileRoot = assertWithin(targetRoot, path.join(targetRoot, profileId), `target profile '${profileId}'`);
  const pendingRoot = assertWithin(profileRoot, path.join(profileRoot, '.landos-governance', 'pending-skills', options.id), 'pending skill');
  const recordPath = path.join(pendingRoot, 'record.json');
  if (!fs.existsSync(recordPath)) throw new Error('Pending skill review does not exist');
  const record = readJson(recordPath);
  if (record.profile !== profileId || record.id !== options.id) throw new Error('Pending skill review identity mismatch');
  if (record.status !== 'pending') {
    if (record.status === options.decision.replace('approve', 'approved').replace('reject', 'rejected')) {
      return { ok: true, id: options.id, status: record.status, existing: true };
    }
    throw new Error(`Pending skill is already ${record.status}`);
  }
  const reviewedAt = new Date().toISOString();
  if (options.decision === 'reject') {
    const updated = { ...record, status: 'rejected', reviewedAt, reviewer: 'explicit-owner-decision' };
    writeAtomic(recordPath, stableJson(updated));
    const reviewPath = path.join(profileRoot, '.landos-governance', 'skill-reviews', `${options.id}.json`);
    writeAtomic(reviewPath, stableJson({ ...updated, candidateRetained: true, installed: false }));
    return { ok: true, id: options.id, status: 'rejected', existing: false };
  }

  const manifestProfile = context.manifest.profiles[profileId];
  const approved = context.skills.get(record.skill);
  if (!approved || !manifestProfile.skillAllowlist.includes(record.skill)) {
    throw new Error('Candidate is not on this profile allowlist');
  }
  const candidateRoot = path.join(pendingRoot, 'candidate');
  const candidateDigest = directoryDigest(candidateRoot);
  if (candidateDigest !== record.candidateSha256) throw new Error('Pending candidate changed after staging');
  const findings = scanSkillDirectory(candidateRoot);
  if (findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high')) throw new Error('Pending candidate failed its approval-time scan');
  const approvedSource = resolveSkillSource(approved, context);
  validateSkillSource(approved, approvedSource);
  if (candidateDigest !== directoryDigest(approvedSource)) throw new Error('Candidate differs from the immutable approved source');
  const target = path.join(profileRoot, targetSkillRelative(approved));
  if (fs.existsSync(target) && directoryDigest(target) !== candidateDigest) throw new Error('Installed governed skill has an unreviewed conflicting change');
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    for (const file of listRegularFiles(candidateRoot)) {
      writeAtomic(path.join(target, path.relative(candidateRoot, file)), fs.readFileSync(file));
    }
  }
  const updated = { ...record, status: 'approved', reviewedAt, reviewer: 'explicit-owner-decision' };
  writeAtomic(recordPath, stableJson(updated));
  const reviewPath = path.join(profileRoot, '.landos-governance', 'skill-reviews', `${options.id}.json`);
  writeAtomic(reviewPath, stableJson({ ...updated, candidateRetained: true, installed: true }));
  return { ok: true, id: options.id, status: 'approved', existing: false };
}

function parseArguments(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--apply-external') options.applyExternal = true;
    else if (arg === '--activate-mcp') options.activateMcp = true;
    else if (['--profile', '--target-root', '--runtime-root', '--source', '--id', '--decision', '--capability-registry-path', '--capability-contract-path'].includes(arg)) {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown argument '${arg}'`);
  }
  return { command, options };
}

function safeSummary(result) {
  return JSON.stringify(result, null, 2);
}

export function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  let result;
  if (command === 'audit') result = auditRepository(options);
  else if (command === 'validate-capabilities') result = validateResearchCapabilityRegistry(options);
  else if (command === 'check') result = checkProfiles(options);
  else if (command === 'smoke') result = smokeProfiles(options);
  else if (command === 'provision') {
    if (!options.targetRoot && !options.applyExternal && !options.dryRun) {
      throw new Error('External profile provisioning is deferred: pass --apply-external or an explicit --target-root');
    }
    result = provisionProfiles(options);
  } else if (command === 'stage-skill') result = stageSkill(options);
  else if (command === 'review-skill') result = reviewSkill(options);
  else {
    throw new Error('Usage: governed-profile-manager.mjs <audit|validate-capabilities|check|smoke|provision|stage-skill|review-skill> [options]');
  }
  process.stdout.write(`${safeSummary(result)}\n`);
  if (result.ok === false) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Governed Hermes profiles: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
