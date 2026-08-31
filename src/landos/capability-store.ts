import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getLandosDb } from './db.js';
import type {
  CapabilityInvocationPersistence,
  CapabilityInvocationRequest,
  CapabilityMetadata,
  CapabilityResult,
} from './capability-contract.js';

interface InvocationRow {
  id: string;
  result_json: string;
}

/**
 * How long a second caller waits for an in-flight invocation of the same key.
 *
 * It is also the line past which a still-`running` row is treated as
 * abandoned, because a row this side of it can never be waited on
 * successfully — the two must be the same number or the store would refuse a
 * key it has already given up on.
 */
const WAIT_FOR_RESULT_MS = 10 * 60_000;

function subjectRef(request: CapabilityInvocationRequest): string | null {
  if (request.subject.kind === 'canonical_property') return String(request.subject.propertyCardId);
  if (request.subject.kind === 'raw_property') {
    return request.subject.target ? String(request.subject.target.propertyCardId) : null;
  }
  return null;
}

function subjectDealCardId(request: CapabilityInvocationRequest): number | null {
  if (request.subject.kind === 'canonical_property') return request.subject.dealCardId ?? null;
  if (request.subject.kind === 'raw_property') return request.subject.target?.dealCardId ?? null;
  return null;
}

function resultStatus(result: CapabilityResult): 'succeeded' | 'needs_input' | 'failed' {
  if (result.status === 'SUCCEEDED') return 'succeeded';
  if (result.status === 'NEEDS_INPUT') return 'needs_input';
  return 'failed';
}

function sessionStatus(result: CapabilityResult): 'resolved' | 'ambiguous' | 'unresolved' | 'error' {
  if (result.subjectResolution === 'RESOLVED') return 'resolved';
  if (result.subjectResolution === 'AMBIGUOUS') return 'ambiguous';
  if (result.subjectResolution === 'UNRESOLVED') return 'unresolved';
  return 'error';
}

function parsedResult(row: InvocationRow | undefined): CapabilityResult | null {
  if (!row?.result_json || row.result_json === 'null') return null;
  try { return JSON.parse(row.result_json) as CapabilityResult; }
  catch { return null; }
}

interface SharedLockRecord {
  capabilityId: string;
  subjectRef: string;
  ownerId: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
}

function gitCommonDirectory(cwd = process.cwd()): string | null {
  const dotGit = path.join(cwd, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const pointer = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/im)?.[1]?.trim();
    if (!pointer) return null;
    const gitDir = path.resolve(cwd, pointer);
    const commonRef = path.join(gitDir, 'commondir');
    return fs.existsSync(commonRef)
      ? path.resolve(gitDir, fs.readFileSync(commonRef, 'utf8').trim())
      : gitDir;
  } catch {
    return null;
  }
}

export function sharedCapabilityLockRoot(cwd = process.cwd()): string {
  const common = gitCommonDirectory(cwd);
  return common
    ? path.join(common, 'landos', 'runtime', 'capability-locks')
    : path.join(os.tmpdir(), 'landos-runtime-capability-locks');
}

export function defaultCapabilityLockRoot(cwd = process.cwd()): string {
  if (process.env.NODE_ENV === 'test') return path.join(os.tmpdir(), `landos-capability-locks-test-${process.pid}`);
  return sharedCapabilityLockRoot(cwd);
}

export class SharedCapabilityExecutionLock {
  private readonly held = new Map<string, { ownerId: string; timer: ReturnType<typeof setInterval> | null }>();

  constructor(private readonly options: {
    root?: string;
    now?: () => number;
    currentPid?: number;
    pidAlive?: (pid: number) => boolean;
    heartbeatMs?: number;
    staleMs?: number;
  } = {}) {}

  private key(capabilityId: string, subjectRefValue: string): string {
    return createHash('sha256').update(`${capabilityId}\0${subjectRefValue}`).digest('hex');
  }

  private file(capabilityId: string, subjectRefValue: string): string {
    return path.join(this.options.root ?? defaultCapabilityLockRoot(), `${this.key(capabilityId, subjectRefValue)}.json`);
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
  private pid(): number { return this.options.currentPid ?? process.pid; }
  private alive(pid: number): boolean {
    if (this.options.pidAlive) return this.options.pidAlive(pid);
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  private read(file: string): SharedLockRecord | null {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as SharedLockRecord; }
    catch { return null; }
  }

  private write(file: string, record: SharedLockRecord, exclusive: boolean): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record), { encoding: 'utf8', flag: exclusive ? 'wx' : 'w' });
  }

  private writeAtomic(file: string, record: SharedLockRecord): void {
    const temporary = `${file}.${this.pid()}.${randomUUID()}.tmp`;
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(temporary, 'wx');
      fs.writeFileSync(descriptor, JSON.stringify(record), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporary, file);
    } finally {
      if (descriptor != null) try { fs.closeSync(descriptor); } catch { /* already closed */ }
      if (fs.existsSync(temporary)) try { fs.unlinkSync(temporary); } catch { /* harmless orphan temp */ }
    }
  }

  /**
   * Claim the execution lock for one subject.
   *
   * `isOwnerFinished` lets a caller that knows a run's lifecycle reclaim a lock
   * whose owner has already finished. Liveness alone cannot decide this: a lock
   * is released by the process that took it, so a process that dies mid-run
   * leaves one behind, and the PID recorded in it is recycled by the operating
   * system soon after. Once an unrelated process inherits that number the lock
   * looks permanently alive and the subject can never be researched again.
   */
  acquire(
    capabilityId: string,
    subjectRefValue: string,
    ownerId: string,
    isOwnerFinished?: (ownerId: string) => boolean,
  ): { acquired: boolean; ownerId: string; reentrant?: boolean } {
    const key = this.key(capabilityId, subjectRefValue);
    const local = this.held.get(key);
    if (local?.ownerId === ownerId) return { acquired: true, ownerId, reentrant: true };
    const file = this.file(capabilityId, subjectRefValue);
    const attempt = (): { acquired: boolean; ownerId: string; reentrant?: boolean } => {
      const at = new Date(this.now()).toISOString();
      const record: SharedLockRecord = { capabilityId, subjectRef: subjectRefValue, ownerId, pid: this.pid(), acquiredAt: at, heartbeatAt: at };
      try {
        this.write(file, record, true);
        const heartbeatMs = this.options.heartbeatMs ?? 30_000;
        const timer = heartbeatMs > 0 ? setInterval(() => {
          const current = this.read(file);
          if (!current || current.ownerId !== ownerId || current.pid !== this.pid()) return;
          current.heartbeatAt = new Date(this.now()).toISOString();
          try { this.writeAtomic(file, current); } catch { /* the prior readable heartbeat remains authoritative */ }
        }, heartbeatMs) : null;
        timer?.unref?.();
        this.held.set(key, { ownerId, timer });
        return { acquired: true, ownerId };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = this.read(file);
        if (!existing) {
          let age = 0;
          try { age = this.now() - fs.statSync(file).mtimeMs; } catch { return attempt(); }
          if (age > (this.options.staleMs ?? 120_000)) {
            try { fs.unlinkSync(file); } catch { return { acquired: false, ownerId: 'unknown-owner' }; }
            return attempt();
          }
          return { acquired: false, ownerId: 'unknown-owner' };
        }
        if (existing.ownerId === ownerId && existing.pid === this.pid()) return { acquired: true, ownerId, reentrant: true };
        // A finished run holds nothing. This is checked before staleness and
        // before liveness because it is the only signal that stays true: the
        // owner's own lifecycle says the work is over, whatever process now
        // answers to the recorded PID.
        let finished = false;
        try { finished = isOwnerFinished?.(existing.ownerId) === true; } catch { finished = false; }
        if (finished) {
          try { fs.unlinkSync(file); } catch { return { acquired: false, ownerId: existing.ownerId }; }
          return attempt();
        }
        const heartbeat = Date.parse(existing.heartbeatAt || existing.acquiredAt);
        const stale = Number.isFinite(heartbeat) && this.now() - heartbeat > (this.options.staleMs ?? 120_000);
        if (stale && !this.alive(existing.pid)) {
          try { fs.unlinkSync(file); } catch { return { acquired: false, ownerId: existing.ownerId }; }
          return attempt();
        }
        return { acquired: false, ownerId: existing.ownerId };
      }
    };
    return attempt();
  }

  release(capabilityId: string, subjectRefValue: string, ownerId: string): void {
    const key = this.key(capabilityId, subjectRefValue);
    const local = this.held.get(key);
    if (local?.ownerId === ownerId) {
      if (local.timer) clearInterval(local.timer);
      this.held.delete(key);
    }
    const file = this.file(capabilityId, subjectRefValue);
    const current = this.read(file);
    if (!current || current.ownerId !== ownerId || current.pid !== this.pid()) return;
    try { fs.unlinkSync(file); } catch { /* stale ownership is reclaimed only after heartbeat + PID proof */ }
  }
}

const SHARED_CAPABILITY_LOCK = new SharedCapabilityExecutionLock();

export class CapabilityInvocationStore implements CapabilityInvocationPersistence {
  constructor(private readonly executionLock: SharedCapabilityExecutionLock = SHARED_CAPABILITY_LOCK) {}

  acquireExecutionLock(
    capabilityId: string,
    subjectRefValue: string,
    ownerId: string,
    isOwnerFinished?: (ownerId: string) => boolean,
  ): { acquired: boolean; ownerId: string; reentrant?: boolean } {
    return this.executionLock.acquire(capabilityId, subjectRefValue, ownerId, isOwnerFinished);
  }

  releaseExecutionLock(capabilityId: string, subjectRefValue: string, ownerId: string): void {
    this.executionLock.release(capabilityId, subjectRefValue, ownerId);
  }

  findReusable(capabilityId: string, idempotencyKey: string, contractVersion: string): CapabilityResult | null {
    // Version-scoped reuse: a run recorded under an older contract version is
    // pre-repair behavior and must never be replayed as the current result.
    const row = getLandosDb().prepare(`
      SELECT id, result_json
      FROM landos_capability_invocation
      WHERE capability_id = ? AND idempotency_key = ? AND capability_version = ?
        AND status IN ('succeeded','needs_input') AND result_json <> 'null'
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(capabilityId, idempotencyKey, contractVersion) as InvocationRow | undefined;
    return parsedResult(row);
  }

  begin(input: {
    request: CapabilityInvocationRequest;
    metadata: CapabilityMetadata;
    invocationId: string;
    idempotencyKey: string;
    startedAt: string;
  }): { started: true; researchSessionId: string | null } | { started: false; existingInvocationId: string } {
    const db = getLandosDb();
    const researchSessionId = input.request.subject.kind === 'raw_property' && !input.request.subject.target
      ? `research_${randomUUID()}`
      : null;
    const insertRows = () => {
      if (researchSessionId) {
        db.prepare(`
          INSERT INTO landos_research_session
            (id, capability_id, entity, raw_input, status, latest_invocation_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(
          researchSessionId,
          input.metadata.id,
          input.request.subject.entity,
          input.request.subject.kind === 'raw_property' ? input.request.subject.rawInput : '',
          input.invocationId,
          input.startedAt,
          input.startedAt,
        );
      }
      db.prepare(`
        INSERT INTO landos_capability_invocation (
          id, capability_id, capability_version, caller_type, caller_ref,
          subject_kind, subject_entity, subject_ref, subject_deal_card_id, research_session_id, mode,
          parameters_json, context_json, idempotency_key, status, started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(
        input.invocationId,
        input.metadata.id,
        input.metadata.contractVersion,
        input.request.caller.type,
        input.request.caller.ref ?? null,
        input.request.subject.kind,
        input.request.subject.entity,
        subjectRef(input.request),
        subjectDealCardId(input.request),
        researchSessionId,
        input.request.mode ?? 'reuse',
        JSON.stringify(input.request.parameters ?? {}),
        JSON.stringify(input.request.context ?? {}),
        input.idempotencyKey,
        input.startedAt,
        input.startedAt,
      );
    };
    const write = db.transaction(insertRows);
    try {
      write();
      return { started: true, researchSessionId };
    } catch (error) {
      const code = String((error as { code?: string }).code ?? '');
      if (!/SQLITE_CONSTRAINT/.test(code) && !/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) throw error;
      const recover = db.transaction((): { started: true; researchSessionId: string | null } | { started: false; existingInvocationId: string } => {
        const existing = db.prepare(`
        SELECT id, status, started_at, capability_version FROM landos_capability_invocation
        WHERE capability_id = ? AND idempotency_key = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(input.metadata.id, input.idempotencyKey) as { id: string; status: string; started_at: string | null; capability_version: string | null } | undefined;
        if (!existing) throw error;
        // A run still inside the wait window is the one to wait on.
        //
        // A row left `running` past that window is different: `waitForResult`
        // has already decided it will give up on it, so waiting again can only
        // spend the operator's time to reach the same timeout. It is abandoned
        // — its process died, or it threw on the way to completion — and it is
        // re-keyed exactly like a failed row so the key is usable again. The
        // abandoned row is kept, not deleted: a durable record of a run that
        // never finished is evidence, not clutter.
        const abandoned = existing.status === 'running'
          && Date.now() - Date.parse(existing.started_at ?? '') > WAIT_FOR_RESULT_MS;
        // A row recorded under a different contract version is pre-repair
        // state: it is superseded, never waited on, and re-keyed like a
        // failed row so the key is usable by the current version.
        const superseded = existing.capability_version !== input.metadata.contractVersion;
        if (existing.status !== 'failed' && !abandoned && !superseded) return { started: false, existingInvocationId: existing.id };
        db.prepare(`
          UPDATE landos_capability_invocation
          SET idempotency_key = idempotency_key || ':' || status || ':' || id
          WHERE id = ?
        `).run(existing.id);
        insertRows();
        return { started: true, researchSessionId };
      });
      return recover();
    }
  }

  async waitForResult(invocationId: string): Promise<CapabilityResult> {
    const deadline = Date.now() + WAIT_FOR_RESULT_MS;
    while (Date.now() < deadline) {
      const result = this.get(invocationId);
      if (result) return result;
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
    throw new Error(`timed out waiting for reusable capability invocation ${invocationId}`);
  }

  complete(request: CapabilityInvocationRequest, result: CapabilityResult): CapabilityResult {
    const db = getLandosDb();
    const invocation = db.prepare(`
      SELECT research_session_id
      FROM landos_capability_invocation
      WHERE id = ?
    `).get(result.invocationId) as { research_session_id: string | null } | undefined;
    if (!invocation) throw new Error(`capability invocation ${result.invocationId} was not started`);

    const canonical = result.canonicalSubject;
    const evidenceSubjectKind = canonical?.kind
      ?? (request.subject.kind === 'canonical_property' ? 'property' : 'research_session');
    const evidenceSubjectRef = canonical?.id
      ?? (request.subject.kind === 'canonical_property'
        ? String(request.subject.propertyCardId)
        : invocation.research_session_id ?? 'unassigned');
    // Every evidence row belongs to the invocation that reported it.
    //
    // A capability that consumes another capability's result forwards that
    // result's evidence — Assessor & Tax, LandPortal Research, Comps &
    // Valuation, Zoning & Subdivision and Property Development History all
    // carry Property Resolution's evidence into their own. Those forwarded
    // items already carry the row id the ORIGINAL invocation was written
    // under, so writing them again under that id collides with the row that
    // owns it and the whole invocation fails to complete. Keying this
    // invocation's row by its own invocation id keeps the row unique while
    // preserving which upstream evidence it restates.
    const evidence = result.evidence.map((item) => ({
      ...item,
      id: item.id?.trim()
        ? `${result.invocationId}:${item.id.trim()}`
        : `evidence_${randomUUID()}`,
    }));
    const persisted: CapabilityResult = { ...result, evidence };

    const write = db.transaction(() => {
      db.prepare(`
        UPDATE landos_capability_invocation
        SET status = ?, resolution_state = ?, result_json = ?, completed_at = ?
        WHERE id = ?
      `).run(
        resultStatus(persisted),
        persisted.subjectResolution,
        JSON.stringify(persisted),
        persisted.timestamps.completedAt,
        persisted.invocationId,
      );

      for (const item of evidence) {
        db.prepare(`
          INSERT INTO landos_capability_evidence (
            id, invocation_id, capability_id, subject_kind, subject_ref,
            source_label, source_url, source_type, retrieved_at, evidence_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.id,
          persisted.invocationId,
          persisted.capability.id,
          evidenceSubjectKind,
          evidenceSubjectRef,
          item.source,
          item.sourceUrl ?? null,
          item.sourceType ?? null,
          item.retrievedAt,
          JSON.stringify(item.details ?? {}),
          persisted.timestamps.completedAt,
        );
      }

      if (invocation.research_session_id) {
        db.prepare(`
          UPDATE landos_research_session
          SET status = ?, canonical_subject_kind = ?, canonical_subject_ref = ?,
              canonical_subject_json = ?, latest_invocation_id = ?, updated_at = ?
          WHERE id = ?
        `).run(
          sessionStatus(persisted),
          canonical?.kind ?? null,
          canonical?.id ?? null,
          JSON.stringify(canonical),
          persisted.invocationId,
          persisted.timestamps.completedAt,
          invocation.research_session_id,
        );
      }
    });
    write();
    return persisted;
  }

  latestForProperty(
    propertyCardId: number,
    dealCardId?: number,
    capabilityId = 'property-resolution',
  ): CapabilityResult | null {
    const dealClause = dealCardId == null ? '' : 'AND subject_deal_card_id = ?';
    const row = getLandosDb().prepare(`
      SELECT id, result_json
      FROM landos_capability_invocation
      WHERE capability_id = ?
        AND subject_kind IN ('canonical_property','raw_property') AND subject_ref = ?
        ${dealClause}
        AND status <> 'running' AND result_json <> 'null'
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(...(dealCardId == null
      ? [capabilityId, String(propertyCardId)]
      : [capabilityId, String(propertyCardId), dealCardId])) as InvocationRow | undefined;
    return parsedResult(row);
  }

  get(invocationId: string): CapabilityResult | null {
    const row = getLandosDb().prepare(`
      SELECT id, result_json FROM landos_capability_invocation WHERE id = ?
    `).get(invocationId) as InvocationRow | undefined;
    return parsedResult(row);
  }
}
