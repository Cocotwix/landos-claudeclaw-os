// Canonical Context Packs are reconstructed from Control Spine state and exact
// Git objects. The invocation supplies only an attempt identity; task facts,
// workspace identity, prior knowledge, policy, capabilities, and hashes are
// derived internally.

import { createHash } from 'node:crypto';
import path from 'node:path';

import { git } from '../dev/verify.mjs';
import {
  canonicalAttempt,
  canonicalTask,
  canonicalTaskContract,
  recordContextPackDelivery,
  relevantTaskKnowledge,
  resolveCommit,
  validateManagedWorkspace,
} from './control-state.mjs';

const CAPABILITY_FILE = '.landos/capabilities.json';

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function stringArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function repositoryPath(value) {
  const relative = required(value, 'repository reference').replace(/\\/g, '/');
  if (path.posix.isAbsolute(relative) || relative === '..' || relative.startsWith('../') || relative.includes('/../')) {
    throw new Error(`canonical repository reference must stay inside the repository: ${relative}`);
  }
  if (/(^|\/)(\.env(?:\.|$)|secrets?|credentials?|tokens?|keys?)(\/|$)/i.test(relative)) {
    throw new Error(`canonical Context Pack refuses secret-bearing repository reference ${relative}`);
  }
  return relative.replace(/^\.\//, '');
}

function gitFile(root, gitSha, relativePath) {
  const sourcePath = repositoryPath(relativePath);
  const result = git(['show', `${gitSha}:${sourcePath}`], root);
  if (result.status !== 0) {
    throw new Error(`canonical Context Pack requires ${sourcePath} at exact commit ${gitSha}`);
  }
  return { path: sourcePath, gitSha, sha256: sha256(result.stdout), content: result.stdout };
}

function activeWorkspace(db, root, task, attempt) {
  const workspaces = db.prepare(`
    SELECT * FROM managed_workspace
    WHERE task_id = ? AND attempt_id = ? AND writer_id = ? AND status = 'ACTIVE'
    ORDER BY id
  `).all(task.id, attempt.id, attempt.primary_writer_id);
  if (workspaces.length !== 1) {
    throw new Error(`canonical Context Pack requires exactly one active managed workspace for attempt ${attempt.id}`);
  }
  const workspace = workspaces[0];
  validateManagedWorkspace(db, root, {
    taskId: task.id,
    attemptId: attempt.id,
    writerId: attempt.primary_writer_id,
    cwd: workspace.workspace_path,
  });
  return workspace;
}

function pathFamilyMatches(candidate, family) {
  const pathValue = String(candidate).replace(/\\/g, '/').replace(/^\.\//, '');
  const familyValue = String(family).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!familyValue) return false;
  if (!familyValue.includes('*')) return pathValue === familyValue || pathValue.startsWith(`${familyValue}/`);
  const escaped = familyValue.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}(?:/.*)?$`).test(pathValue);
}

function capabilityFacts(root, gitSha, contract) {
  const source = gitFile(root, gitSha, CAPABILITY_FILE);
  let parsed;
  try { parsed = JSON.parse(source.content); }
  catch (error) {
    throw new Error(`canonical Context Pack requires valid ${CAPABILITY_FILE} at ${gitSha}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed.capabilities)) throw new Error(`${CAPABILITY_FILE} must contain a capabilities array`);
  const requested = new Set(contract.relevantCapabilityIds);
  const ownedPaths = [...contract.ownedScope, ...contract.ownedInterfaces];
  const selected = parsed.capabilities.filter((capability) => {
    const families = stringArray(
      capability.protectedPaths ?? capability.sharedDependencyPaths ?? [],
      `capability ${capability.id} protected paths`,
    );
    return requested.has(String(capability.id))
      || ownedPaths.some((ownedPath) => families.some((family) => pathFamilyMatches(ownedPath, family)));
  });
  const selectedIds = new Set(selected.map((capability) => String(capability.id)));
  const missing = [...requested].filter((id) => !selectedIds.has(id));
  if (missing.length) throw new Error(`canonical task references unknown capabilities: ${missing.join(', ')}`);
  return {
    source: { path: source.path, gitSha: source.gitSha, sha256: source.sha256 },
    capabilities: selected.map((capability) => ({
      id: required(capability.id, 'capability id'),
      name: required(capability.name, `capability ${capability.id} name`),
      department: capability.department ? String(capability.department) : null,
      invariant: capability.invariant ? String(capability.invariant) : null,
      sharedInvariants: stringArray(capability.sharedInvariants, `capability ${capability.id} shared invariants`),
      protectedPaths: stringArray(
        capability.protectedPaths ?? capability.sharedDependencyPaths,
        `capability ${capability.id} protected paths`,
      ),
      ownedInterfaces: stringArray(capability.ownedInterfaces, `capability ${capability.id} owned interfaces`),
      verificationCommands: stringArray(
        capability.verificationCommands ?? capability.requiredVerification,
        `capability ${capability.id} verification commands`,
      ),
      verificationObligations: stringArray(
        capability.verificationObligations ?? capability.goldenJourneyIds,
        `capability ${capability.id} verification obligations`,
      ),
      governedResources: stringArray(
        capability.governedResources ?? capability.requiredResources,
        `capability ${capability.id} governed resources`,
      ),
      acceptancePolicy: capability.acceptancePolicy ?? capability.tylerAcceptance ?? null,
      riskPolicy: capability.riskPolicy ? String(capability.riskPolicy) : null,
      regressionFixtures: stringArray(capability.regressionFixtures, `capability ${capability.id} fixtures`),
      browserAssertions: stringArray(capability.browserAssertions, `capability ${capability.id} browser assertions`),
      knownLimitations: stringArray(capability.knownLimitations, `capability ${capability.id} limitations`),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function createCanonicalContextPack(db, root, { attemptId }) {
  const attempt = canonicalAttempt(db, required(attemptId, 'attempt ID'));
  const task = canonicalTask(db, attempt.task_id);
  const contract = canonicalTaskContract(db, task.id);
  const workspace = activeWorkspace(db, root, task, attempt);
  const acceptedBaseGitSha = resolveCommit(root, contract.acceptedBaseGitSha);
  const workingBaseGitSha = resolveCommit(root, contract.workingBaseGitSha);
  const policyGitSha = resolveCommit(root, contract.policyGitSha);
  if (attempt.base_git_sha !== workingBaseGitSha || workspace.base_git_sha !== workingBaseGitSha) {
    throw new Error(`canonical task contract working base does not match attempt and managed workspace ${attempt.id}`);
  }
  const executionHeadGitSha = resolveCommit(workspace.workspace_path, 'HEAD');
  const repositoryReferences = [...new Set([
    ...contract.architectureRefs,
    ...contract.invariantRefs,
    ...contract.verificationPolicyRefs,
    CAPABILITY_FILE,
  ].map(repositoryPath))].sort();
  const repositorySources = repositoryReferences.map((reference) => gitFile(root, policyGitSha, reference));
  const payload = {
    schema: 2,
    taskContract: {
      ...contract,
      id: task.id,
      title: task.title,
      nextAction: task.next_action,
    },
    attempt: {
      id: attempt.id,
      taskId: attempt.task_id,
      worker: attempt.worker,
      primaryWriterId: attempt.primary_writer_id,
      approach: attempt.approach,
      workingBaseGitSha: attempt.base_git_sha,
    },
    managedWorkspace: {
      id: workspace.id,
      taskId: workspace.task_id,
      attemptId: workspace.attempt_id,
      path: workspace.workspace_path,
      branch: workspace.branch,
      writerId: workspace.writer_id,
      baseGitSha: workspace.base_git_sha,
    },
    git: {
      authorityRef: 'main',
      acceptedBaseGitSha,
      workingBaseGitSha,
      policyGitSha,
      executionHeadGitSha,
    },
    relevantKnowledge: relevantTaskKnowledge(db, contract),
    capabilityPolicy: capabilityFacts(root, policyGitSha, contract),
    repositorySources,
  };
  const text = canonicalJson(payload);
  return Object.freeze({ ...payload, hash: sha256(text), canonicalJson: text });
}

export function deliverCanonicalContextPack(db, root, { attemptId }) {
  const id = required(attemptId, 'attempt ID');
  const pack = createCanonicalContextPack(db, root, { attemptId: id });
  const delivery = recordContextPackDelivery(db, {
    attemptId: id,
    workspaceId: pack.managedWorkspace.id,
    canonicalJson: pack.canonicalJson,
  });
  return { pack, delivery };
}

export function renderContextPack(pack) {
  return [
    'LandOS Canonical Context Pack',
    `Context-Pack-SHA256: ${pack.hash}`,
    '',
    pack.canonicalJson,
    '',
  ].join('\n');
}
