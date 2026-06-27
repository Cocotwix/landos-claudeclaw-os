import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { upsertCardFromDukeRun } from './property-card.js';
import {
  COUNTY_VERIFICATION_TASKS, planCountyVerification, detectConflict, DEFAULT_COUNTY_TASK_CONTRACT,
  saveCountyVerificationRecord, loadCountyVerificationRecords, type CountyTaskResult,
} from './county-records-tasks.js';

beforeEach(() => { _initTestLandosDb(); });

describe('county records task planning (no browsing)', () => {
  it('exposes the full post-discovery task set', () => {
    expect(COUNTY_VERIFICATION_TASKS).toContain('verify_owner');
    expect(COUNTY_VERIFICATION_TASKS).toContain('verify_apn');
    expect(COUNTY_VERIFICATION_TASKS).toContain('collect_evidence');
  });

  it('plans a bounded task when exact identifiers exist', () => {
    const p = planCountyVerification('verify_owner', { apn: '00830-054-000', county: 'Worth', state: 'GA' });
    expect(p.allowed).toBe(true);
    expect(p.contract.maxInteractions).toBe(DEFAULT_COUNTY_TASK_CONTRACT.maxInteractions);
    expect(p.contract.stopConditions).toContain('coordinate_or_proximity_only');
    expect(p.fieldUpdated).toBe('owner');
  });

  it('refuses to plan without an exact identifier (coordinates/nearest never authorize)', () => {
    const p = planCountyVerification('verify_apn', { county: 'Worth', state: 'GA' }); // no APN/owner/legal/address
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/exact identifier/i);
  });

  it('detects conflicts (numeric + string)', () => {
    expect(detectConflict(8.6, 12.3).conflict).toBe(true);
    expect(detectConflict('JOHN SMITH', 'john smith').conflict).toBe(false);
    expect(detectConflict('A-1', 'R-1').conflict).toBe(true);
    expect(detectConflict(null, 'x').conflict).toBe(false);
  });

  it('persists + loads manual county verification records (agent dormant)', () => {
    const id = upsertCardFromDukeRun({ entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', county: 'Worth', state: 'GA', apn: '00830-054-000', fips: '13321', owner: 'X', acres: 8.6, verified: true, verificationSource: 'Realie.ai', summary: 'v' }).card.id;
    const rec: CountyTaskResult = {
      task: 'verify_owner', fieldUpdated: 'owner', status: 'needs_human_or_county_call',
      officialSourceUrl: null, sourceTitle: null, extractedFact: null, confidence: 'none',
      timestamp: 't', conflictWith: null, evidenceRefs: [], note: 'call the county',
    };
    saveCountyVerificationRecord(id, rec);
    const loaded = loadCountyVerificationRecords(id);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].status).toBe('needs_human_or_county_call');
  });
});
