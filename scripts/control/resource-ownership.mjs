// Physical development resources are governed independently of caller labels.
// A logical resource ID is useful for audit; the normalized physical identity is
// the exclusive lock key.

import os from 'node:os';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function networkIdentity(value, label) {
  const text = required(value, label);
  let number = Number(text);
  let host = 'loopback';
  if (!Number.isInteger(number)) {
    try {
      const url = new URL(text.includes('://') ? text : `tcp://${text}`);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      host = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'].includes(hostname)
        ? 'local-host'
        : `host:${hostname}`;
      number = Number(url.port || ({ 'http:': 80, 'https:': 443 }[url.protocol] ?? Number.NaN));
    } catch { number = Number.NaN; }
  }
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${label} must identify a TCP port`);
  if (host === 'loopback') host = 'local-host';
  return `network:tcp:${host}:${number}`;
}

function filesystemIdentity(value, label) {
  const requested = path.resolve(required(value, label));
  let existing = requested;
  const missing = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`${label} has no existing canonical parent`);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  const real = realpathSync.native(existing);
  const stats = statSync(real, { bigint: true });
  const physicalParent = `${stats.dev.toString(16)}:${stats.ino.toString(16)}`;
  if (missing.length === 0) return `filesystem:existing:${physicalParent}`;
  let intended = missing.join('/').replace(/\/+/, '/');
  if (process.platform === 'win32') intended = intended.toLowerCase();
  return `filesystem:reservation:${physicalParent}:${intended}`;
}

export function normalizePhysicalResource({ resourceType, endpoint }) {
  const type = required(resourceType, 'resource type').toLowerCase().replace(/_/g, '-');
  if (['port', 'runtime-port'].includes(type)) return { type: 'runtime-port', identity: networkIdentity(endpoint, 'resource endpoint') };
  if (['cdp', 'browser-cdp', 'cdp-endpoint'].includes(type)) return { type: 'browser-cdp', identity: networkIdentity(endpoint, 'CDP endpoint') };
  if (['endpoint', 'runtime-endpoint'].includes(type)) return { type: 'endpoint', identity: networkIdentity(endpoint, 'resource endpoint') };
  if (['browser-profile', 'profile'].includes(type)) return { type: 'browser-profile', identity: filesystemIdentity(endpoint, 'browser profile') };
  if (['database', 'db'].includes(type)) return { type: 'database', identity: filesystemIdentity(endpoint, 'database path') };
  if (type === 'runtime') return { type, identity: networkIdentity(endpoint, 'runtime endpoint') };
  throw new Error(`unsupported governed resource type ${resourceType}`);
}

function event(db, {
  taskId = null,
  attemptId = null,
  verificationPlanId = null,
  obligationId = null,
  candidateGitSha = null,
  resourceId = null,
  normalizedIdentity = null,
  resourceType = null,
  endpoint = null,
  action,
  outcome,
  summary,
}, now) {
  db.prepare(`
    INSERT INTO managed_resource_event(
      task_id, attempt_id, verification_plan_id, obligation_id, candidate_git_sha,
      resource_id, normalized_identity, resource_type, endpoint,
      action, outcome, summary, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId, attemptId, verificationPlanId, obligationId, candidateGitSha,
    resourceId, normalizedIdentity, resourceType, endpoint,
    action, outcome, summary, now(),
  );
}

function taskAttempt(db, taskId, attemptId) {
  const task = required(taskId, 'task ID'); const attempt = required(attemptId, 'attempt ID');
  const record = db.prepare('SELECT id, task_id, status FROM development_attempt WHERE id = ?').get(attempt);
  if (!record || record.task_id !== task) throw new Error(`attempt ${attempt} is not canonical for task ${task}`);
  return record;
}

function verificationContext(db, attempt, input) {
  const supplied = input.verificationPlanId || input.obligationId || input.candidateGitSha;
  if (!supplied) return { taskId: attempt.task_id, attemptId: attempt.id };
  const verificationPlanId = required(input.verificationPlanId, 'verification plan ID');
  const obligationId = required(input.obligationId, 'verification obligation ID');
  const candidateGitSha = required(input.candidateGitSha, 'verification candidate Git SHA');
  const binding = db.prepare(`
    SELECT 1
    FROM verification_obligation obligation
    JOIN verification_plan plan ON plan.id = obligation.verification_plan_id
    WHERE obligation.id = ? AND obligation.attempt_id = ? AND obligation.task_id = ?
      AND obligation.verification_plan_id = ? AND obligation.candidate_git_sha = ?
      AND plan.lifecycle_state = 'SEALED' AND plan.candidate_git_sha = ?
  `).get(obligationId, attempt.id, attempt.task_id, verificationPlanId, candidateGitSha, candidateGitSha);
  if (!binding) throw new Error('governed resource verification context does not match the sealed obligation');
  return { taskId: attempt.task_id, attemptId: attempt.id, verificationPlanId, obligationId, candidateGitSha };
}

function activePhysicalOwner(db, physical) {
  for (const record of db.prepare("SELECT * FROM managed_resource WHERE status = 'ACTIVE' ORDER BY resource_id").all()) {
    let current;
    try { current = normalizePhysicalResource({ resourceType: record.resource_type, endpoint: record.endpoint }); }
    catch { continue; }
    if (current.identity !== physical.identity) continue;
    if (record.normalized_identity !== current.identity) {
      db.prepare('UPDATE managed_resource SET normalized_identity = ? WHERE resource_id = ?')
        .run(current.identity, record.resource_id);
      record.normalized_identity = current.identity;
    }
    return record;
  }
  return null;
}

export function registerPrimaryResource(db, { resourceId, resourceType, endpoint }, now = () => new Date().toISOString()) {
  const id = required(resourceId, 'resource ID');
  const physical = normalizePhysicalResource({ resourceType, endpoint });
  const sameLogical = db.prepare(`SELECT * FROM managed_resource WHERE resource_id = ? AND owner_kind = 'PRIMARY_RUNTIME' AND status = 'ACTIVE'`).get(id);
  if (sameLogical) {
    const current = normalizePhysicalResource({ resourceType: sameLogical.resource_type, endpoint: sameLogical.endpoint });
    if (current.identity !== physical.identity || sameLogical.resource_type !== physical.type) {
      event(db, { resourceId: id, normalizedIdentity: physical.identity, action: 'REGISTER_PRIMARY', outcome: 'FAIL', summary: `Contradictory primary runtime registration for ${id}.` }, now);
      throw new Error(`contradictory primary runtime registration for ${id}`);
    }
    if (sameLogical.normalized_identity !== physical.identity) {
      db.prepare('UPDATE managed_resource SET normalized_identity = ?, endpoint = ? WHERE resource_id = ?')
        .run(physical.identity, required(endpoint, 'resource endpoint'), id);
      return db.prepare('SELECT * FROM managed_resource WHERE resource_id = ?').get(id);
    }
    return sameLogical;
  }
  const occupied = activePhysicalOwner(db, physical);
  if (occupied) {
    const summary = `physical resource ${physical.identity} is actively owned by ${occupied.owner_kind === 'PRIMARY_RUNTIME' ? 'the protected primary runtime' : occupied.owner_attempt_id}`;
    event(db, { resourceId: id, normalizedIdentity: physical.identity, action: 'REGISTER_PRIMARY', outcome: 'FAIL', summary }, now);
    throw new Error(summary);
  }
  db.prepare(`
    INSERT INTO managed_resource(resource_id, normalized_identity, resource_type, endpoint, owner_kind, owner_task_id, owner_attempt_id, status, acquired_at, released_at)
    VALUES (?, ?, ?, ?, 'PRIMARY_RUNTIME', NULL, NULL, 'ACTIVE', ?, NULL)
    ON CONFLICT(resource_id) DO UPDATE SET normalized_identity = excluded.normalized_identity, resource_type = excluded.resource_type,
      endpoint = excluded.endpoint, owner_kind = 'PRIMARY_RUNTIME', owner_task_id = NULL, owner_attempt_id = NULL,
      status = 'ACTIVE', acquired_at = excluded.acquired_at, released_at = NULL
  `).run(id, physical.identity, physical.type, required(endpoint, 'resource endpoint'), now());
  event(db, { resourceId: id, normalizedIdentity: physical.identity, action: 'REGISTER_PRIMARY', outcome: 'PASS', summary: 'Protected primary resource registered.' }, now);
  return db.prepare('SELECT * FROM managed_resource WHERE resource_id = ?').get(id);
}

export function ensureProtectedPrimaryResources(db, root, now = () => new Date().toISOString()) {
  return [
    registerPrimaryResource(db, { resourceId: 'primary-runtime-port-3141', resourceType: 'runtime-port', endpoint: '3141' }, now),
    registerPrimaryResource(db, { resourceId: 'primary-browser-cdp-9224', resourceType: 'browser-cdp', endpoint: 'http://127.0.0.1:9224' }, now),
    registerPrimaryResource(db, { resourceId: 'primary-browser-profile-landos', resourceType: 'browser-profile', endpoint: path.join(os.homedir(), '.landos-chrome') }, now),
  ];
}

export function acquireResource(db, input, now = () => new Date().toISOString()) {
  const { resourceId, resourceType, endpoint, taskId, attemptId } = input;
  const id = required(resourceId, 'resource ID');
  const attempt = taskAttempt(db, taskId, attemptId);
  const context = verificationContext(db, attempt, input);
  if (!['IN_PROGRESS', 'CANDIDATE'].includes(attempt.status)) {
    const summary = `attempt ${attempt.id} in ${attempt.status} cannot acquire a governed resource`;
    event(db, { ...context, resourceId: id, resourceType, endpoint, action: 'ACQUIRE', outcome: 'FAIL', summary }, now);
    throw new Error(summary);
  }
  let physical;
  try { physical = normalizePhysicalResource({ resourceType, endpoint }); } catch (error) {
    event(db, { ...context, resourceId: id, resourceType, endpoint, action: 'ACQUIRE', outcome: 'FAIL', summary: String(error.message ?? error) }, now);
    throw error;
  }
  const occupied = activePhysicalOwner(db, physical);
  if (occupied) {
    if (occupied.resource_id === id && occupied.owner_kind === 'TASK' && occupied.owner_attempt_id === attempt.id) return occupied;
    const summary = `physical resource ${physical.identity} is actively owned by ${occupied.owner_kind === 'PRIMARY_RUNTIME' ? 'the protected primary runtime' : occupied.owner_attempt_id}`;
    event(db, { ...context, resourceId: id, normalizedIdentity: physical.identity, resourceType: physical.type, endpoint, action: 'ACQUIRE', outcome: 'FAIL', summary }, now);
    throw new Error(summary);
  }
  const reusedId = db.prepare('SELECT * FROM managed_resource WHERE resource_id = ?').get(id);
  if (reusedId?.status === 'ACTIVE') {
    const summary = `logical resource ${id} is already actively owned`;
    event(db, { ...context, resourceId: id, normalizedIdentity: physical.identity, resourceType: physical.type, endpoint, action: 'ACQUIRE', outcome: 'FAIL', summary }, now);
    throw new Error(summary);
  }
  db.prepare(`
    INSERT INTO managed_resource(resource_id, normalized_identity, resource_type, endpoint, owner_kind, owner_task_id, owner_attempt_id, status, acquired_at, released_at)
    VALUES (?, ?, ?, ?, 'TASK', ?, ?, 'ACTIVE', ?, NULL)
    ON CONFLICT(resource_id) DO UPDATE SET normalized_identity = excluded.normalized_identity, resource_type = excluded.resource_type,
      endpoint = excluded.endpoint, owner_kind = 'TASK', owner_task_id = excluded.owner_task_id, owner_attempt_id = excluded.owner_attempt_id,
      status = 'ACTIVE', acquired_at = excluded.acquired_at, released_at = NULL
  `).run(id, physical.identity, physical.type, required(endpoint, 'resource endpoint'), attempt.task_id, attempt.id, now());
  event(db, { ...context, resourceId: id, normalizedIdentity: physical.identity, resourceType: physical.type, endpoint, action: 'ACQUIRE', outcome: 'PASS', summary: 'Governed resource acquired.' }, now);
  return db.prepare('SELECT * FROM managed_resource WHERE resource_id = ?').get(id);
}

export function releaseResource(db, input, now = () => new Date().toISOString()) {
  const { resourceId, taskId, attemptId } = input;
  const id = required(resourceId, 'resource ID'); const attempt = taskAttempt(db, taskId, attemptId);
  const context = verificationContext(db, attempt, input);
  const resource = db.prepare('SELECT * FROM managed_resource WHERE resource_id = ?').get(id);
  if (!resource) {
    event(db, { ...context, resourceId: id, action: 'RELEASE', outcome: 'FAIL', summary: `Unknown governed resource ${id}.` }, now);
    throw new Error(`unknown governed resource ${id}`);
  }
  if (resource.owner_kind !== 'TASK' || resource.owner_task_id !== attempt.task_id || resource.owner_attempt_id !== attempt.id) {
    event(db, { ...context, resourceId: id, normalizedIdentity: resource.normalized_identity, resourceType: resource.resource_type, endpoint: resource.endpoint, action: 'RELEASE', outcome: 'FAIL', summary: `Attempt ${attempt.id} does not own ${id}.` }, now);
    throw new Error(`resource release refused: attempt ${attempt.id} does not own ${id}`);
  }
  if (resource.status !== 'ACTIVE') {
    event(db, { ...context, resourceId: id, normalizedIdentity: resource.normalized_identity, resourceType: resource.resource_type, endpoint: resource.endpoint, action: 'RELEASE', outcome: 'FAIL', summary: `Resource ${id} is not actively acquired.` }, now);
    throw new Error(`resource ${id} is not actively acquired`);
  }
  db.prepare(`UPDATE managed_resource SET status = 'RELEASED', released_at = ? WHERE resource_id = ?`).run(now(), id);
  event(db, { ...context, resourceId: id, normalizedIdentity: resource.normalized_identity, resourceType: resource.resource_type, endpoint: resource.endpoint, action: 'RELEASE', outcome: 'PASS', summary: 'Governed resource released.' }, now);
  return db.prepare('SELECT * FROM managed_resource WHERE resource_id = ?').get(id);
}

export function inspectResources(db) {
  return db.prepare('SELECT * FROM managed_resource ORDER BY normalized_identity, resource_id').all();
}
