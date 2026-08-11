import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const workspace = path.resolve(path.dirname(scriptPath), '..', '..');

const REQUIRED_REGISTRIES = [
  'architecture-map.json',
  'module-map.json',
  'provider-registry.json',
  'county-gis-source-registry.json',
  'browser-workflow-registry.json',
  'skill-registry.json',
  'mcp-registry.json',
  'decision-records.json',
  'defect-history.json',
  'acceptance-history.json',
  'test-address-history.json',
];

const FORBIDDEN_ABSOLUTE_PATH = /(?:[A-Za-z]:\\Users\\|\/home\/|\/Users\/)/;
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walkFiles(root, predicate, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

export function validateRegistry(document, fileName = '<registry>') {
  const errors = [];
  if (document?.schemaVersion !== 1) errors.push(`${fileName}: schemaVersion must be 1`);
  if (typeof document?.registryId !== 'string' || !document.registryId) errors.push(`${fileName}: registryId is required`);
  if (document?.canonicalAuthority !== 'LandOS') errors.push(`${fileName}: canonicalAuthority must be LandOS`);
  if (!Array.isArray(document?.entries) || document.entries.length === 0) errors.push(`${fileName}: entries must be a non-empty array`);
  const ids = new Set();
  for (const [index, entry] of (document?.entries ?? []).entries()) {
    const at = `${fileName}: entries[${index}]`;
    if (typeof entry?.id !== 'string' || !entry.id) errors.push(`${at}.id is required`);
    else if (ids.has(entry.id)) errors.push(`${at}.id duplicates ${entry.id}`);
    else ids.add(entry.id);
    if (typeof entry?.title !== 'string' || !entry.title) errors.push(`${at}.title is required`);
    if (typeof entry?.status !== 'string' || !entry.status) errors.push(`${at}.status is required`);
    if (typeof entry?.summary !== 'string' || !entry.summary) errors.push(`${at}.summary is required`);
    if (!Array.isArray(entry?.canonicalRefs) || entry.canonicalRefs.length === 0) errors.push(`${at}.canonicalRefs must be non-empty`);
    for (const ref of entry?.canonicalRefs ?? []) {
      if (typeof ref !== 'string' || path.isAbsolute(ref) || ref.split(/[\\/]/).includes('..')) errors.push(`${at}: unsafe canonical ref ${String(ref)}`);
      if (String(ref).toLowerCase().includes('.env')) errors.push(`${at}: environment files cannot be canonical refs`);
    }
    for (const forbiddenKey of ['canonicalData', 'acceptedEvidence', 'dealCardData']) {
      if (Object.hasOwn(entry, forbiddenKey)) errors.push(`${at}: ${forbiddenKey} would duplicate canonical data`);
    }
  }
  return errors;
}

export function validateWatcherRegistry(document, fileName = '<watchers>') {
  const errors = [];
  if (document?.schemaVersion !== 1) errors.push(`${fileName}: schemaVersion must be 1`);
  if (!Array.isArray(document?.definitions) || document.definitions.length === 0) errors.push(`${fileName}: definitions must be non-empty`);
  for (const watcher of document?.definitions ?? []) {
    const at = `${fileName}: ${watcher?.id ?? '<missing-id>'}`;
    if (watcher?.enabled !== false) errors.push(`${at} must remain disabled`);
    if (watcher?.target !== null) errors.push(`${at} target must be null until approved`);
    if (watcher?.schedule !== null) errors.push(`${at} schedule must be null until approved`);
    if (watcher?.delivery !== null) errors.push(`${at} delivery must be null until approved`);
  }
  return errors;
}

export function validateCapabilityRegistry(document, fileName = '<capabilities>') {
  const errors = [];
  const capabilities = document?.capabilities ?? [];
  const primaryFree = capabilities.filter((capability) => capability.category === 'free-search' && capability.selection === 'primary');
  if (primaryFree.length !== 1 || primaryFree[0]?.id !== 'duckduckgo-search') errors.push(`${fileName}: DuckDuckGo must be the single primary free search`);
  const parallel = capabilities.find((capability) => capability.id === 'parallel-cli');
  if (!parallel || parallel.status !== 'blocked') errors.push(`${fileName}: parallel-cli must remain blocked without paid-service authority`);
  const watchers = capabilities.find((capability) => capability.id === 'watchers');
  if (!watchers || watchers.status !== 'available-not-activated') errors.push(`${fileName}: watchers must be available-not-activated`);
  return errors;
}

export function validateCapabilityConsistency(document, hermesManifest, fileName = '<capabilities>') {
  const errors = [];
  const byId = new Map((document?.capabilities ?? []).map((capability) => [capability.id, capability]));
  const evaluations = new Map((hermesManifest?.optionalEvaluations ?? []).map((entry) => [entry.id, entry]));
  const approved = new Map((hermesManifest?.skills?.optionalApproved ?? []).map((entry) => [entry.id, entry]));
  const profileSkills = (id) => hermesManifest?.profiles?.[id]?.skillAllowlist ?? [];

  const duck = byId.get('duckduckgo-search');
  if (duck?.status !== 'approved-enabled' || duck?.runtimeState !== 'installed' || duck?.runtimeVersion !== '9.14.4') {
    errors.push(`${fileName}: DuckDuckGo must be installed and pinned to ddgs 9.14.4`);
  }
  if (JSON.stringify(duck?.profiles) !== JSON.stringify(['landos-research'])) {
    errors.push(`${fileName}: DuckDuckGo ownership must be landos-research only`);
  }
  if (hermesManifest?.freeSearch?.selected !== 'duckduckgo-search' || hermesManifest?.freeSearch?.status !== 'selected-enabled') {
    errors.push(`${fileName}: Hermes free-search selection must match enabled DuckDuckGo`);
  }
  if (evaluations.get('duckduckgo-search')?.status !== 'approved' || !approved.has('duckduckgo-search')) {
    errors.push(`${fileName}: Hermes must approve the DuckDuckGo optional skill`);
  }
  if (!profileSkills('landos-research').includes('duckduckgo-search') || profileSkills('landos-automation').includes('duckduckgo-search')) {
    errors.push(`${fileName}: Hermes profile allowlists must enforce research-only DuckDuckGo ownership`);
  }

  const decisions = [
    ['scrapling', 'blocked', 'blocked'],
    ['domain-intel', 'approved-enabled', 'approved'],
    ['osint-investigation', 'blocked', 'blocked'],
  ];
  for (const [id, landosStatus, hermesStatus] of decisions) {
    if (byId.get(id)?.status !== landosStatus || evaluations.get(id)?.status !== hermesStatus) {
      errors.push(`${fileName}: ${id} must be ${landosStatus} in LandOS and ${hermesStatus} in Hermes governance`);
    }
  }
  if (byId.get('grounded-citations')?.runtimeState !== 'blocked-no-supported-skill'
      || evaluations.get('grounded-citations')?.status !== 'blocked') {
    errors.push(`${fileName}: grounded-citations must remain a required contract with its unsupported skill explicitly blocked`);
  }
  return errors;
}

export function validateKnowledgeTree(root = workspace) {
  const errors = [];
  const registryRoot = path.join(root, 'config', 'landos-knowledge', 'registries');
  for (const name of REQUIRED_REGISTRIES) {
    const file = path.join(registryRoot, name);
    if (!fs.existsSync(file)) {
      errors.push(`${name}: required registry is missing`);
      continue;
    }
    let document;
    try { document = readJson(file); }
    catch (error) { errors.push(`${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); continue; }
    errors.push(...validateRegistry(document, name));
    if (name === 'county-gis-source-registry.json') {
      for (const entry of document.entries ?? []) {
        try {
          const parsed = new URL(entry.url);
          if (parsed.protocol !== 'https:') errors.push(`${name}: ${entry.id} must use HTTPS`);
          if (!entry.allowedDomains?.includes(parsed.hostname)) errors.push(`${name}: ${entry.id} URL host is not allowlisted`);
        } catch { errors.push(`${name}: ${entry.id} has an invalid URL`); }
        if (!entry.sourceFreshness?.verifiedAt || !Number.isInteger(entry.sourceFreshness?.refreshDays)) errors.push(`${name}: ${entry.id} needs source freshness metadata`);
      }
    }
  }

  const knowledgeConfigFile = path.join(root, 'config', 'landos-knowledge', 'knowledge-system.json');
  const knowledge = readJson(knowledgeConfigFile);
  if (knowledge.canonicalSystem !== 'LandOS' || knowledge.duplicatesCanonicalData !== false) errors.push('knowledge-system.json: must preserve LandOS authority without canonical duplication');
  if (knowledge.qmd?.status !== 'blocked' || knowledge.qmd?.runtimePlatform !== 'windows' || knowledge.qmd?.executablePresent !== false) errors.push('knowledge-system.json: QMD Windows blocker must be explicit');
  for (const excluded of ['.env', '.runtime', 'store', 'logs', '.landos/acceptance']) {
    if (!knowledge.primaryIndex?.excludedRoots?.includes(excluded)) errors.push(`knowledge-system.json: excluded root ${excluded} is required`);
  }

  const capabilities = readJson(path.join(root, 'config', 'landos-research', 'capabilities.json'));
  errors.push(...validateCapabilityRegistry(capabilities, 'capabilities.json'));
  const hermesManifestFile = path.join(root, 'config', 'hermes', 'governance', 'approved-capabilities.json');
  if (!fs.existsSync(hermesManifestFile)) errors.push('approved-capabilities.json: governed Hermes manifest is missing');
  else errors.push(...validateCapabilityConsistency(capabilities, readJson(hermesManifestFile), 'capabilities.json'));
  errors.push(...validateWatcherRegistry(readJson(path.join(root, 'config', 'landos-research', 'watchers.json')), 'watchers.json'));

  const scanned = [
    ...walkFiles(path.join(root, 'config', 'landos-knowledge'), (file) => file.endsWith('.json')),
    ...walkFiles(path.join(root, 'config', 'landos-research'), (file) => file.endsWith('.json')),
    ...walkFiles(path.join(root, 'docs', 'landos', 'knowledge'), (file) => file.endsWith('.md')),
  ];
  for (const file of scanned) {
    const content = fs.readFileSync(file, 'utf8');
    if (SECRET_PATTERN.test(content)) errors.push(`${path.relative(root, file)}: possible secret material`);
    if (FORBIDDEN_ABSOLUTE_PATH.test(content)) errors.push(`${path.relative(root, file)}: machine-local absolute path`);
  }

  return { ok: errors.length === 0, errors, registryCount: REQUIRED_REGISTRIES.length, scannedFiles: scanned.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = validateKnowledgeTree();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`LandOS knowledge governance ready: ${result.registryCount} registries, ${result.scannedFiles} files checked.`);
  else for (const error of result.errors) console.error(error);
  if (!result.ok) process.exitCode = 1;
}
