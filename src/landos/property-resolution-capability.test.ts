import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { listRuntimeCapabilities, invokeRuntimeCapability } from './capability-registry.js';
import { CapabilityInvocationStore, SharedCapabilityExecutionLock, sharedCapabilityLockRoot } from './capability-store.js';
import { _initTestLandosDb, _refreshTestLandosSchema, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import type { IdentityLaneResult } from './universal-property-resolution.js';

beforeEach(() => { _initTestLandosDb(); });

const official = (patch: IdentityLaneResult['patch']): IdentityLaneResult => ({
  lane: 'official_parcel',
  status: 'evidence',
  note: 'Official county parcel record matched the requested parcel.',
  source: { label: 'Williamson County Property Assessor', url: 'https://williamsoncounty-tn.gov/property/042-123', officiality: 'official' },
  patch,
});

function rawRequest(
  caller: 'tools' | 'new_lead' | 'deal_card' | 'internal_workflow' = 'tools',
  entity: 'LAND_ALLY' | 'TY_LAND_BIZ' = 'TY_LAND_BIZ',
) {
  return {
    capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
    caller: { type: caller, ref: `${caller}:test` },
    subject: { kind: 'raw_property' as const, entity, rawInput: 'Map 042 Parcel 123, Fairview, Tennessee' },
  };
}

describe('Slice 7 runtime capability contract', () => {
  it('keeps a live renewable lock authoritative beyond fifteen minutes and across processes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-capability-lock-'));
    let now = 0;
    const first = new SharedCapabilityExecutionLock({ root, now: () => now, currentPid: 101, pidAlive: (pid) => pid === 101, heartbeatMs: 0 });
    const second = new SharedCapabilityExecutionLock({ root, now: () => now, currentPid: 202, pidAlive: (pid) => pid === 101, heartbeatMs: 0 });
    try {
      expect(first.acquire('property-resolution', 'deal:7', 'run-a')).toMatchObject({ acquired: true });
      now += 16 * 60_000;
      expect(second.acquire('property-resolution', 'deal:7', 'run-b')).toEqual({ acquired: false, ownerId: 'run-a' });
      first.release('property-resolution', 'deal:7', 'run-a');
      expect(second.acquire('property-resolution', 'deal:7', 'run-b')).toMatchObject({ acquired: true });
      second.release('property-resolution', 'deal:7', 'run-b');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives the same lock authority root for linked Git worktrees', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-git-common-'));
    const primary = path.join(root, 'primary');
    const worktree = path.join(root, 'worktree');
    const gitCommon = path.join(primary, '.git');
    const worktreeGit = path.join(gitCommon, 'worktrees', 'candidate');
    fs.mkdirSync(worktreeGit, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${worktreeGit}`);
    fs.writeFileSync(path.join(worktreeGit, 'commondir'), '../..');
    try {
      expect(sharedCapabilityLockRoot(worktree)).toBe(sharedCapabilityLockRoot(primary));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reclaims only old malformed lock files and never steals a recent unreadable lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-malformed-lock-'));
    const authority = new SharedCapabilityExecutionLock({ root, currentPid: 303, pidAlive: () => false, heartbeatMs: 0, staleMs: 1_000 });
    const file = path.join(root, `${createHash('sha256').update('property-resolution\0deal:9').digest('hex')}.json`);
    fs.writeFileSync(file, '{');
    try {
      expect(authority.acquire('property-resolution', 'deal:9', 'new-owner')).toEqual({ acquired: false, ownerId: 'unknown-owner' });
      const old = new Date(Date.now() - 5_000);
      fs.utimesSync(file, old, old);
      expect(authority.acquire('property-resolution', 'deal:9', 'new-owner')).toMatchObject({ acquired: true, ownerId: 'new-owner' });
      authority.release('property-resolution', 'deal:9', 'new-owner');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('upgrades the Boundary 1 ledger without losing retained invocation rows', () => {
    const db = getLandosDb();
    db.exec(`
      DROP INDEX IF EXISTS idx_capability_invocation_subject_deal;
      ALTER TABLE landos_capability_invocation DROP COLUMN subject_deal_card_id;
      CREATE INDEX idx_capability_invocation_subject
        ON landos_capability_invocation(capability_id, subject_kind, subject_ref, completed_at DESC);
    `);
    db.prepare(`
      INSERT INTO landos_capability_invocation (
        id, capability_id, capability_version, caller_type, caller_ref, subject_kind, subject_entity,
        subject_ref, research_session_id, mode, parameters_json, context_json, idempotency_key,
        status, resolution_state, result_json, started_at, completed_at, created_at
      ) VALUES ('cap-boundary-1', 'property-resolution', '1.0', 'deal_card', 'deal:7',
        'canonical_property', 'TY_LAND_BIZ', '11', NULL, 'reuse', '{}', '{}', 'boundary-1-key',
        'succeeded', 'RESOLVED', '{"invocationId":"cap-boundary-1"}', ?, ?, ?)
    `).run('2026-08-17T00:00:00.000Z', '2026-08-17T00:00:01.000Z', '2026-08-17T00:00:00.000Z');

    _refreshTestLandosSchema();
    _refreshTestLandosSchema();
    const columns = db.prepare('PRAGMA table_info(landos_capability_invocation)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('subject_deal_card_id');
    expect(db.prepare('SELECT id, subject_deal_card_id FROM landos_capability_invocation WHERE id = ?').get('cap-boundary-1'))
      .toEqual({ id: 'cap-boundary-1', subject_deal_card_id: null });
    const indexes = db.prepare('PRAGMA index_list(landos_capability_invocation)').all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain('idx_capability_invocation_subject_deal');
    expect(indexes.map((index) => index.name)).not.toContain('idx_capability_invocation_subject');
  });

  it('registers Property Resolution as the first callable LandOS capability', () => {
    // Property Resolution stays the root capability. Slice 8 registered
    // Assessor & Tax beside it, so this asserts position rather than count.
    expect(listRuntimeCapabilities()[0]).toEqual(expect.objectContaining({
      id: 'property-resolution',
      name: 'Property Resolution',
      contractVersion: '1.0',
    }));
  });

  it('persists one normalized Tools result and evidence without creating a lead or Deal Card', async () => {
    const before = {
      leads: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_lead').get() as { n: number }).n),
      deals: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_deal_card').get() as { n: number }).n),
    };
    const result = await invokeRuntimeCapability(rawRequest(), {
      universalOptions: {
        lanes: { official_parcel: async () => official({
          apn: '042-123.00-000', county: 'Williamson', state: 'TN', city: 'Fairview', owner: 'LANDSOUTH LLC',
          acres: 75.9, verified: true, verificationSource: 'Williamson County Property Assessor',
        }) },
      },
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject).toMatchObject({ kind: 'research_session', temporary: true });
    expect(result.facts.canonicalIdentity).toMatchObject({ apn: '042-123.00-000', county: 'Williamson', state: 'TN' });
    expect(result.evidence).toEqual([expect.objectContaining({ source: 'Williamson County Property Assessor' })]);

    const after = {
      leads: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_lead').get() as { n: number }).n),
      deals: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_deal_card').get() as { n: number }).n),
    };
    expect(after).toEqual(before);
    const persisted = getLandosDb().prepare(`
      SELECT e.invocation_id, e.capability_id, e.subject_kind, e.subject_ref, e.source_label
      FROM landos_capability_evidence e
    `).all();
    expect(persisted).toEqual([expect.objectContaining({
      invocation_id: result.invocationId,
      capability_id: 'property-resolution',
      subject_kind: 'research_session',
      subject_ref: result.canonicalSubject?.id,
      source_label: 'Williamson County Property Assessor',
    })]);
  });

  it('reuses the same invocation unless an explicit refresh is requested', async () => {
    let calls = 0;
    const runtime = {
      universalOptions: { lanes: { official_parcel: async () => {
        calls += 1;
        return official({ apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Assessor' });
      } } },
    };
    const first = await invokeRuntimeCapability(rawRequest(), runtime);
    const reused = await invokeRuntimeCapability(rawRequest(), runtime);
    const refreshed = await invokeRuntimeCapability({ ...rawRequest(), mode: 'refresh' }, runtime);
    expect(reused.invocationId).toBe(first.invocationId);
    expect(reused.execution.reused).toBe(true);
    expect(refreshed.invocationId).not.toBe(first.invocationId);
    expect(refreshed.execution.mode).toBe('refresh');
    expect(calls).toBe(2);
  });

  it('atomically reuses one in-flight invocation under concurrent callers', async () => {
    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const runtime = {
      universalOptions: { lanes: { official_parcel: async () => {
        calls += 1;
        entered();
        await gate;
        return official({ apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Assessor' });
      } } },
    };
    const firstPromise = invokeRuntimeCapability(rawRequest(), runtime);
    await started;
    const secondPromise = invokeRuntimeCapability(rawRequest(), runtime);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(calls).toBe(1);
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.execution.reused).toBe(true);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n).toBe(1);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_research_session').get() as { n: number }).n).toBe(1);
  });

  it('allows a fresh atomic retry after a terminal failed reuse invocation', async () => {
    let calls = 0;
    const lane = async () => {
      calls += 1;
      return official({ apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Assessor' });
    };
    const failed = await invokeRuntimeCapability(rawRequest(), {
      universalOptions: { lanes: { official_parcel: lane } },
      onUniversalResult: () => { throw new Error('post-resolution persistence adapter failed'); },
    });
    const retried = await invokeRuntimeCapability(rawRequest(), {
      universalOptions: { lanes: { official_parcel: lane } },
    });
    expect(failed.status).toBe('FAILED');
    expect(retried.status).toBe('SUCCEEDED');
    expect(retried.invocationId).not.toBe(failed.invocationId);
    expect(calls).toBe(2);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n).toBe(2);
  });

  it('returns honest ambiguity and never releases a selected parcel', async () => {
    const result = await invokeRuntimeCapability(rawRequest(), {
      universalOptions: {
        lanes: { official_parcel: async () => ({
          lane: 'official_parcel', status: 'evidence', note: 'Two official candidates remain.',
          ambiguousCandidates: [
            { apn: '042-123.00-000', county: 'Williamson', state: 'TN' },
            { apn: '042-124.00-000', county: 'Williamson', state: 'TN' },
          ],
        }) },
      },
    });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.subjectResolution).toBe('AMBIGUOUS');
    expect(result.facts.released).toBe(false);
    expect(result.facts.candidates).toHaveLength(2);
  });

  it('reuses an existing verified property identity instead of creating a duplicate', async () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Kingwood Blvd, Fairview TN', apn: '042-123.00-000',
      county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    const countBefore = Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n);
    const result = await invokeRuntimeCapability(rawRequest(), {
      universalOptions: { lanes: { official_parcel: async () => official({
        apn: '042 123.00 000', county: 'Williamson County', state: 'TN', verified: true, verificationSource: 'Assessor',
      }) } },
    });
    const countAfter = Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n);
    expect(result.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: card.id, temporary: false });
    expect(countAfter).toBe(countBefore);
  });

  it('keeps same-input reuse and evidence isolated by entity', async () => {
    const { card: ally } = upsertPropertyCard({
      entity: 'LAND_ALLY', activeInputAddress: 'Kingwood Blvd, Fairview TN', apn: '042-123.00-000',
      county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    const { card: ty } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Kingwood Blvd, Fairview TN', apn: '042-123.00-000',
      county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    const runtime = {
      universalOptions: { lanes: { official_parcel: async () => official({
        apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Assessor',
      }) } },
    };
    const tyResult = await invokeRuntimeCapability(rawRequest('tools', 'TY_LAND_BIZ'), runtime);
    const allyResult = await invokeRuntimeCapability(rawRequest('tools', 'LAND_ALLY'), runtime);
    expect(tyResult.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: ty.id });
    expect(allyResult.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: ally.id });
    expect(tyResult.invocationId).not.toBe(allyResult.invocationId);
    const evidence = getLandosDb().prepare(`
      SELECT invocation_id, subject_ref FROM landos_capability_evidence ORDER BY invocation_id
    `).all() as Array<{ invocation_id: string; subject_ref: string }>;
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ invocation_id: tyResult.invocationId, subject_ref: String(ty.id) }),
      expect.objectContaining({ invocation_id: allyResult.invocationId, subject_ref: String(ally.id) }),
    ]));
  });

  it('keeps merely observed no-result sources out of supporting capability evidence', async () => {
    const result = await invokeRuntimeCapability(rawRequest(), {
      universalOptions: { lanes: { official_parcel: async () => ({
        lane: 'official_parcel', status: 'no_evidence', note: 'The portal was checked but no matching parcel record was found.',
        observedSources: [{ label: 'County portal landing page', url: 'https://county.example.gov/search', officiality: 'official' }],
      }) } },
    });
    expect(result.subjectResolution).toBe('UNRESOLVED');
    expect(result.evidence).toEqual([]);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_evidence').get() as { n: number }).n).toBe(0);
  });

  it('resolves raw New Lead input into its existing canonical container without a second engine', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Map 042 Parcel 123' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Map 042 Parcel 123', state: 'TN', agentId: 'test',
    });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const result = await invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'new_lead', ref: `deal:${deal.id}` },
      subject: {
        kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview, Tennessee',
        target: { dealCardId: deal.id, propertyCardId: card.id },
      },
      mode: 'refresh',
    }, {
      universalOptions: { lanes: { official_parcel: async () => official({
        apn: '042-123.00-000', county: 'Williamson', state: 'TN', city: 'Fairview', owner: 'LANDSOUTH LLC',
        verified: true, verificationSource: 'Williamson County Property Assessor',
      }) } },
    });
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: card.id, dealCardId: deal.id, temporary: false });
    const persisted = getLandosDb().prepare('SELECT apn, county, verification_status FROM landos_property_card WHERE id = ?').get(card.id);
    expect(persisted).toMatchObject({ apn: '042-123.00-000', county: 'Williamson', verification_status: 'verified_property' });
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_research_session').get() as { n: number }).n).toBe(0);
  });

  it('owns retained-evidence reconciliation before releasing the canonical subject', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Capability preflight' });
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Capability preflight parcel', state: 'TN' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const order: string[] = [];
    const result = await invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      beforeResolve: async () => {
        order.push('capability-before-resolve');
        upsertPropertyCard({
          entity: 'TY_LAND_BIZ', cardId: card.id, activeInputAddress: 'Capability preflight parcel',
          apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true,
          verificationSource: 'Williamson County Property Assessor', agentId: 'capability-test',
        });
      },
      onUniversalResult: () => { order.push('resolver-release'); },
    });
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(order).toEqual(['capability-before-resolve', 'resolver-release']);
  });

  it('rejects fake canonical IDs and caller-supplied evidence or confidence', async () => {
    const fake = await invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: 'deal:404' },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: 404, dealCardId: 404 },
      mode: 'refresh',
    });
    expect(fake.status).toBe('FAILED');
    expect(fake.subjectResolution).toBe('ERROR');
    expect(fake.warnings.join(' ')).toMatch(/not the subject|canonical property/i);
    expect(new CapabilityInvocationStore().get(fake.invocationId)?.subjectResolution).toBe('ERROR');

    await expect(invokeRuntimeCapability({
      ...rawRequest(),
      parameters: { confidence: 1, evidence: 'trust me' },
    })).rejects.toThrow(/does not accept caller-supplied evidence/i);
    await expect(invokeRuntimeCapability({
      ...rawRequest(),
      context: { workflow: 'tools', nested: { confidence: 1, evidence: 'trust me' } },
    })).rejects.toThrow(/context cannot contain caller-supplied evidence/i);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation WHERE caller_type = ?').get('tools') as { n: number }).n).toBe(0);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_research_session').get() as { n: number }).n).toBe(0);
  });

  it('preserves an accepted canonical parcel when a refresh returns a conflicting APN', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Accepted parcel' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Kingwood Blvd, Fairview TN', apn: '042-123.00-000',
      county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const result = await invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      universalOptions: {
        retainedFastPath: false,
        lanes: { official_parcel: async () => official({
          apn: '042-999.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'Conflicting source',
        }) },
      },
    });
    const row = getLandosDb().prepare('SELECT apn, verification_source FROM landos_property_card WHERE id = ?').get(card.id) as { apn: string; verification_source: string };
    expect(row).toEqual({ apn: '042-123.00-000', verification_source: 'Williamson County Property Assessor' });
    expect(result.warnings.join(' ')).toMatch(/conflict/i);
    const evidence = getLandosDb().prepare(`
      SELECT source_label FROM landos_capability_evidence WHERE invocation_id = ?
    `).all(result.invocationId) as Array<{ source_label: string }>;
    expect(evidence.map((item) => item.source_label)).not.toContain('Williamson County Property Assessor');
    expect(evidence.map((item) => item.source_label)).not.toContain('Conflicting source');
  });
});
