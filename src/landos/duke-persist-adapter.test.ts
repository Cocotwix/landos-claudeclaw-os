import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  buildDukePersistPayload,
  persistDukeRunPostDelivery,
  type DukeDashboardRunInfo,
} from './duke-persist-adapter.js';

beforeEach(() => {
  _initTestLandosDb();
});

const FAKE_REPORT = [
  'DUKE DEFAULT REPORT — 100 Test Rd, Testville TX',
  '',
  'Land Score: 72 — PURSUE WITH CAUTION (PRELIMINARY)',
  '',
  '[Download PDF](/api/files/report?path=D%3A%5Cduke-reports%5C100-test-rd.pdf)',
].join('\n');

const PERSIST_BLOCK = [
  '```landos-persist',
  JSON.stringify({
    parcel: {
      apn: '123-456-789',
      lpPropertyId: 'LP-FAKE-9',
      fips: '48001',
      county: 'Test County',
      state: 'TX',
      verified: true,
      verificationSource: 'lp_property_data record match (APN + FIPS)',
    },
    facts: [
      { fact: 'acreage', value: '5.2', label: 'Verified', source: 'lp_property_data' },
      { fact: 'flood zone', value: 'unknown', label: 'Needs verification' },
    ],
    reportStatus: 'delivered',
  }),
  '```',
].join('\n');

const successInfo = (overrides: Partial<DukeDashboardRunInfo> = {}): DukeDashboardRunInfo => ({
  agentId: 'duke-due-diligence',
  status: 'success',
  elapsedMs: 98_000,
  toolCalls: 3,
  responseText: FAKE_REPORT,
  ...overrides,
});

describe('buildDukePersistPayload', () => {
  it('maps host runtime metadata with TY_LAND_BIZ default entity', () => {
    const payload = buildDukePersistPayload(successInfo());
    expect(payload.entity).toBe('TY_LAND_BIZ');
    expect(payload.agentId).toBe('duke-due-diligence');
    expect(payload.workflow).toBe('default_duke_report');
    expect(payload.status).toBe('success');
    expect(payload.durationMs).toBe(98_000);
    expect(payload.toolCalls).toBe(3);
    expect(payload.reportStatus).toBe('delivered');
    expect(payload.summary).toContain('DUKE DEFAULT REPORT');
  });

  it('extracts the report PDF link as a decoded file ref', () => {
    const payload = buildDukePersistPayload(successInfo());
    expect(payload.fileRefs).toHaveLength(1);
    expect(payload.fileRefs?.[0]).toMatchObject({
      kind: 'pdf',
      pathOrRef: 'D:\\duke-reports\\100-test-rd.pdf',
    });
  });

  it('drops PDF refs that point inside the repo instead of failing', () => {
    const encoded = encodeURIComponent(process.cwd() + '\\report.pdf');
    const payload = buildDukePersistPayload(successInfo({
      responseText: `Report ready.\n[Download PDF](/api/files/report?path=${encoded})`,
    }));
    expect(payload.fileRefs).toBeUndefined();
  });

  it('takes parcel and facts only from an explicit landos-persist block', () => {
    const noBlock = buildDukePersistPayload(successInfo({
      responseText: 'APN 123-456-789, Test County TX, verified via lp_property_data.',
    }));
    expect(noBlock.parcel).toBeUndefined();
    expect(noBlock.facts).toBeUndefined();

    const withBlock = buildDukePersistPayload(successInfo({
      responseText: FAKE_REPORT + '\n\n' + PERSIST_BLOCK,
    }));
    expect(withBlock.parcel?.apn).toBe('123-456-789');
    expect(withBlock.parcel?.lpPropertyId).toBe('LP-FAKE-9');
    expect(withBlock.facts).toHaveLength(2);
  });

  it('ignores an invalid landos-persist block but records the parse error', () => {
    const payload = buildDukePersistPayload(successInfo({
      responseText: FAKE_REPORT + '\n```landos-persist\n{not json}\n```',
    }));
    expect(payload.parcel).toBeUndefined();
    expect(payload.error).toContain('landos-persist block is not valid JSON');
  });

  it('maps timeout and failed runs to non-delivered report statuses', () => {
    expect(buildDukePersistPayload(successInfo({ status: 'timeout' })).reportStatus).toBe('not_generated');
    expect(buildDukePersistPayload(successInfo({ status: 'failed' })).reportStatus).toBe('failed');
  });
});

describe('persistDukeRunPostDelivery', () => {
  it('persists a successful run with parcel, facts, file ref, run, and audit', () => {
    const result = persistDukeRunPostDelivery(successInfo({
      responseText: FAKE_REPORT + '\n\n' + PERSIST_BLOCK,
    }));
    expect(result).not.toBeNull();
    const db = getLandosDb();
    const run = db.prepare('SELECT * FROM landos_agent_run WHERE id = ?').get(result!.runId) as Record<string, unknown>;
    expect(run.agent_id).toBe('duke-due-diligence');
    expect(run.status).toBe('success');
    expect(run.duration_ms).toBe(98_000);
    const parcel = db.prepare('SELECT * FROM landos_parcel WHERE id = ?').get(result!.parcelId) as Record<string, unknown>;
    expect(parcel.verified).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM landos_fact').get()).toMatchObject({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM landos_file_ref').get()).toMatchObject({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM landos_audit_log WHERE action = 'duke_run_persisted'`).get()).toMatchObject({ n: 1 });
  });

  it('persists run metadata alone when the report has no persist block', () => {
    const result = persistDukeRunPostDelivery(successInfo());
    expect(result).not.toBeNull();
    expect(result!.parcelId).toBeNull();
    expect(result!.factIds).toHaveLength(0);
    expect(result!.fileRefIds).toHaveLength(1); // the PDF link
  });

  it('persists a timeout run with the error recorded', () => {
    const result = persistDukeRunPostDelivery({
      agentId: 'duke-due-diligence',
      status: 'timeout',
      elapsedMs: 165_000,
      toolCalls: 7,
      responseText: null,
      error: 'aborted after 165000ms (timeout 165000ms)',
    });
    expect(result).not.toBeNull();
    const run = getLandosDb().prepare('SELECT status, error FROM landos_agent_run WHERE id = ?')
      .get(result!.runId) as Record<string, unknown>;
    expect(run.status).toBe('timeout');
    expect(run.error).toContain('aborted after 165000ms');
  });

  it('is nonfatal when the hard parcel rule refuses the payload', () => {
    const badBlock = '```landos-persist\n' + JSON.stringify({
      parcel: { verified: true, verificationSource: 'geocoder + map pin' },
    }) + '\n```';
    const errors: Array<{ message: string; err: unknown }> = [];
    const result = persistDukeRunPostDelivery(
      successInfo({ responseText: FAKE_REPORT + '\n' + badBlock }),
      (message, err) => errors.push({ message, err }),
    );
    expect(result).toBeNull(); // no throw — delivery already happened
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('nonfatal');
    expect(String(errors[0].err)).toContain('hard parcel rule');
    // nothing partially written
    const db = getLandosDb();
    for (const table of ['landos_agent_run', 'landos_parcel', 'landos_fact', 'landos_file_ref']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toMatchObject({ n: 0 });
    }
  });

  it('never throws, even with a broken error logger', () => {
    const badBlock = '```landos-persist\n{"parcel":{"verified":true,"verificationSource":"satellite"}}\n```';
    expect(() => persistDukeRunPostDelivery(
      successInfo({ responseText: badBlock }),
      () => { throw new Error('logger exploded'); },
    )).not.toThrow();
  });
});
