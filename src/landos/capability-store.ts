import { randomUUID } from 'node:crypto';

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

function subjectRef(request: CapabilityInvocationRequest): string | null {
  return request.subject.kind === 'canonical_property'
    ? String(request.subject.propertyCardId)
    : request.subject.target ? String(request.subject.target.propertyCardId) : null;
}

function subjectDealCardId(request: CapabilityInvocationRequest): number | null {
  return request.subject.kind === 'canonical_property'
    ? request.subject.dealCardId ?? null
    : request.subject.target?.dealCardId ?? null;
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

export class CapabilityInvocationStore implements CapabilityInvocationPersistence {
  acquireExecutionLock(capabilityId: string, subjectRefValue: string, ownerId: string): { acquired: boolean; ownerId: string; reentrant?: boolean } {
    const db = getLandosDb();
    return db.transaction(() => {
      const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
      db.prepare(`
        DELETE FROM landos_capability_execution_lock
        WHERE capability_id = ? AND subject_ref = ? AND acquired_at < ?
      `).run(capabilityId, subjectRefValue, staleBefore);
      try {
        db.prepare(`
          INSERT INTO landos_capability_execution_lock (capability_id, subject_ref, owner_id, acquired_at)
          VALUES (?, ?, ?, ?)
        `).run(capabilityId, subjectRefValue, ownerId, new Date().toISOString());
        return { acquired: true, ownerId };
      } catch (error) {
        const code = String((error as { code?: string }).code ?? '');
        if (!/SQLITE_CONSTRAINT/.test(code)) throw error;
        const existing = db.prepare(`
          SELECT owner_id FROM landos_capability_execution_lock
          WHERE capability_id = ? AND subject_ref = ?
        `).get(capabilityId, subjectRefValue) as { owner_id: string } | undefined;
        if (!existing) throw error;
        if (existing.owner_id === ownerId) return { acquired: true, ownerId, reentrant: true };
        return { acquired: false, ownerId: existing.owner_id };
      }
    })();
  }

  releaseExecutionLock(capabilityId: string, subjectRefValue: string, ownerId: string): void {
    getLandosDb().prepare(`
      DELETE FROM landos_capability_execution_lock
      WHERE capability_id = ? AND subject_ref = ? AND owner_id = ?
    `).run(capabilityId, subjectRefValue, ownerId);
  }

  findReusable(capabilityId: string, idempotencyKey: string): CapabilityResult | null {
    const row = getLandosDb().prepare(`
      SELECT id, result_json
      FROM landos_capability_invocation
      WHERE capability_id = ? AND idempotency_key = ?
        AND status IN ('succeeded','needs_input') AND result_json <> 'null'
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(capabilityId, idempotencyKey) as InvocationRow | undefined;
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
        SELECT id, status FROM landos_capability_invocation
        WHERE capability_id = ? AND idempotency_key = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(input.metadata.id, input.idempotencyKey) as { id: string; status: string } | undefined;
        if (!existing) throw error;
        if (existing.status !== 'failed') return { started: false, existingInvocationId: existing.id };
        db.prepare(`
          UPDATE landos_capability_invocation
          SET idempotency_key = idempotency_key || ':failed:' || id
          WHERE id = ? AND status = 'failed'
        `).run(existing.id);
        insertRows();
        return { started: true, researchSessionId };
      });
      return recover();
    }
  }

  async waitForResult(invocationId: string): Promise<CapabilityResult> {
    const deadline = Date.now() + 10 * 60_000;
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
    const evidence = result.evidence.map((item) => ({
      ...item,
      id: item.id?.trim() || `evidence_${randomUUID()}`,
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

  latestForProperty(propertyCardId: number, dealCardId?: number): CapabilityResult | null {
    const dealClause = dealCardId == null ? '' : 'AND subject_deal_card_id = ?';
    const row = getLandosDb().prepare(`
      SELECT id, result_json
      FROM landos_capability_invocation
      WHERE capability_id = 'property-resolution'
        AND subject_kind IN ('canonical_property','raw_property') AND subject_ref = ?
        ${dealClause}
        AND status <> 'running' AND result_json <> 'null'
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).get(...(dealCardId == null ? [String(propertyCardId)] : [String(propertyCardId), dealCardId])) as InvocationRow | undefined;
    return parsedResult(row);
  }

  get(invocationId: string): CapabilityResult | null {
    const row = getLandosDb().prepare(`
      SELECT id, result_json FROM landos_capability_invocation WHERE id = ?
    `).get(invocationId) as InvocationRow | undefined;
    return parsedResult(row);
  }
}
