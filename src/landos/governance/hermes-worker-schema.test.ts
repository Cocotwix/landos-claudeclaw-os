import { describe, expect, it } from 'vitest';

import {
  HERMES_WORKER_OUTPUT_JSON_SCHEMA,
  HermesWorkerBoundaryError,
  validateHermesWorkerOutput,
  type HermesExpectedIdentity,
} from './hermes-worker-schema.js';

const SUBJECT_URL = 'https://landportal.com/?property=Zmlwcz0zNjAxMSZhcG49MDUzODg5Kzc1LjAwLTEtMjQuMTEmcHJvcGVydHlpZD04OTUwNTM4NQ%3D%3D';
const EXPECTED: HermesExpectedIdentity = {
  address: 'ONEIL ROAD, PORT BYRON, NY 13140',
  apn: '053889 75.00-1-24.11',
  propertyId: '89505385',
  propertyCardId: 41,
  subjectUrl: SUBJECT_URL,
};

function subjectOutput(): Record<string, unknown> {
  return {
    evidence_type: 'property_subject',
    subject_verification_status: 'verified_exact_subject',
    subject_verification_note: 'Exact address, APN, URL identity, and parcel id agree.',
    subject_url: SUBJECT_URL,
    address: 'ONEIL RD, PORT BYRON, NY 13140',
    county: 'Cayuga County',
    municipality: 'MENTZ (TOV)',
    apn: '053889 75.00-1-24.11',
    owner: 'WILKINSON DANIEL',
    mailing_address: '1738 NEW YORK CENTRAL RD, PORT BYRON, NY 13140',
    deeded_acres: 75.71,
    mls_acres: null,
    calculated_acres: 66.24,
    road_frontage_ft: 606.18,
    landlocked_status: 'No',
    wetlands_pct: 28.91,
    fema_pct: 29.19,
    average_slope_pct: 4.08,
    pct_under_10pct_slope: 95.22,
    pct_under_10pct_slope_note: 'Derived from visible slope bands.',
    buildability_pct: 98.77,
    lp_estimate_total: 265_375,
    lp_estimate_per_acre: 3_505,
    property_card_id: 41,
    canonical_property_identifier: 'fips=36011&apn=053889+75.00-1-24.11&propertyid=89505385',
    property_id: 89_505_385,
    landportal_property_id: '89505385',
    specialist_category: 'subject',
    completed_categories: ['subject'],
    captured_at: '2026-08-02T14:00:00.000Z',
    retrieved_at: null,
    comps: [],
    visual_artifacts: [],
  };
}

function compOutput(): Record<string, unknown> {
  return {
    ...subjectOutput(),
    specialist_category: 'comps',
    completed_categories: ['comps'],
    comps: [{
      evidence_type: 'comparable',
      price: 337_500,
      acres: 100,
      apn: '053289 47.00-1-6',
      address: null,
      price_per_acre: 3_375,
      sale_date: '2026-06-20',
      source_url: SUBJECT_URL,
    }],
  };
}

function visualOutput(): Record<string, unknown> {
  return {
    ...subjectOutput(),
    specialist_category: 'visuals',
    completed_categories: ['visuals'],
    visual_artifacts: [{
      evidence_type: 'visual_artifact',
      key: 'parcel-context',
      label: 'Exact parcel context',
      kind: 'parcel_boundary',
      purpose: 'Verify exact subject boundary and immediate context.',
      source_path: 'parcel-context.png',
      timestamp: '2026-08-02T14:00:20.000Z',
      requested_view: 'parcel_context',
      active_view: 'parcel_context',
      boundary_required: true,
      boundary_visible: true,
      tiles_loaded: true,
      camera_scale: 'parcel',
      clipped: false,
      obstructions: [],
      overlay: null,
      note: null,
    }],
  };
}

function expectRejected(value: unknown, pattern: RegExp, expected = EXPECTED): void {
  expect(() => validateHermesWorkerOutput(value, expected)).toThrowError(pattern);
}

describe('Hermes worker deterministic boundary schema', () => {
  it('reconciles canonical address, formatted APN, tuple/property ids, and subject URL identity', () => {
    const result = validateHermesWorkerOutput(subjectOutput(), EXPECTED);
    expect(result.canonicalIdentity).toMatchObject({
      address: EXPECTED.address,
      normalizedAddress: 'oneil rd port byron ny 13140',
      normalizedApn: '53889750012411',
      propertyId: '89505385',
      propertyCardId: 41,
      fips: '36011',
    });
    expect(result.output.specialist_category).toBe('subject');
  });

  it('accepts valid comparable and visual specialist handbacks', () => {
    expect(validateHermesWorkerOutput(compOutput(), EXPECTED).output.comps).toHaveLength(1);
    expect(validateHermesWorkerOutput(visualOutput(), EXPECTED).output.visual_artifacts).toHaveLength(1);
  });

  it.each([
    ['comps', '[]', /comps.*array/i],
    ['completed_categories', 'subject', /completed_categories.*array/i],
    ['visual_artifacts', '{}', /visual_artifacts.*array/i],
  ])('rejects a string where %s must be an array', (field, value, pattern) => {
    const output = subjectOutput();
    output[field] = value;
    expectRejected(output, pattern);
  });

  it.each([
    ['', /APN.*required/i],
    ['not-an-apn', /APN.*malformed/i],
    ['../../etc/passwd', /APN.*malformed/i],
    ['A', /APN.*malformed/i],
  ])('rejects malformed APN %j', (apn, pattern) => {
    expectRejected({ ...subjectOutput(), apn }, pattern);
  });

  it.each([
    ['not a URL', /subject URL.*malformed/i],
    ['http://landportal.com/?property=x', /subject URL.*LandPortal/i],
    ['https://example.com/?property=x', /subject URL.*LandPortal/i],
    ['https://landportal.com/search?property=x', /subject URL.*LandPortal/i],
  ])('rejects malformed or non-subject URL %j', (subjectUrl, pattern) => {
    expectRejected({ ...subjectOutput(), subject_url: subjectUrl }, pattern);
  });

  it('rejects address, APN, Property Card, property-id, and subject-URL identity mismatches', () => {
    expectRejected({ ...subjectOutput(), address: '12 OTHER RD, AUBURN, NY 13021' }, /address mismatch/i);
    expectRejected({ ...subjectOutput(), apn: '053889 75.00-1-99' }, /APN mismatch/i);
    expectRejected({ ...subjectOutput(), property_card_id: 99 }, /Property Card identity mismatch/i);
    expectRejected({ ...subjectOutput(), landportal_property_id: '89509999' }, /does not match canonical property identifier/i);
    expectRejected(subjectOutput(), /different canonical property/i, { ...EXPECTED, subjectUrl: makeSubjectUrl('36011', EXPECTED.apn, '89509999') });
  });

  it('rejects malformed explicit property identifiers', () => {
    expectRejected({ ...subjectOutput(), canonical_property_identifier: 'propertyid=abc&fips=36011&apn=053889+75.00-1-24.11' }, /canonical_property_identifier is malformed/i);
    expectRejected({ ...subjectOutput(), property_id: '8950-5385' }, /property_id is malformed/i);
    expectRejected({ ...subjectOutput(), landportal_property_id: 1.5 }, /landportal_property_id/i);
  });

  it('rejects cross-property evidence even when the routing guard is copied correctly', () => {
    const otherUrl = makeSubjectUrl('36011', '053889 75.00-1-99', '89509999');
    expectRejected({
      ...subjectOutput(),
      subject_url: otherUrl,
      apn: '053889 75.00-1-99',
      canonical_property_identifier: '89509999',
      property_id: '89509999',
      landportal_property_id: '89509999',
    }, /APN mismatch|property identifier mismatch/i);
  });

  it('requires the assigned category and only that completed category', () => {
    const missing = subjectOutput();
    delete missing.specialist_category;
    expectRejected(missing, /specialist_category/i);
    const missingCompleted = subjectOutput();
    delete missingCompleted.completed_categories;
    expectRejected(missingCompleted, /completed_categories/i);
    expectRejected({ ...subjectOutput(), completed_categories: ['subject', 'comps'] }, /complete only its assigned category/i);
    expectRejected({ ...subjectOutput(), specialist_category: 'subject', comps: (compOutput().comps as unknown[]) }, /must return comps as an empty array/i);
  });

  it.each([
    [{ price: '337500', acres: 100, apn: '053289 47.00-1-6' }, /price.*number/i],
    [{ price: -1, acres: 100, apn: '053289 47.00-1-6' }, /price.*greater than 0/i],
    [{ price: 337_500, acres: 0, apn: '053289 47.00-1-6' }, /acres.*greater than 0/i],
    [{ price: 337_500, acres: 100 }, /requires APN or address/i],
    [{ price: 337_500, acres: 100, apn: '053289 47.00-1-6', price_per_acre: 9_999 }, /price_per_acre conflicts/i],
    [{ price: 337_500, acres: 100, apn: '053289 47.00-1-6', sale_date: '2026-02-30' }, /real calendar date/i],
    [{ price: 337_500, acres: 100, apn: '053289 47.00-1-6', source_url: 'https://example.com/comp' }, /wrong host/i],
  ])('rejects invalid comparable record %#', (comp, pattern) => {
    expectRejected({ ...compOutput(), comps: [comp] }, pattern);
  });

  it('rejects duplicate comparables deterministically', () => {
    const output = compOutput();
    output.comps = [structuredClone((output.comps as unknown[])[0]), structuredClone((output.comps as unknown[])[0])];
    expectRejected(output, /duplicate comparable/i);
  });

  it.each([
    ['source_path', '../outside.png', /safe relative image path/i],
    ['source_path', 'C:\\outside.png', /safe relative image path/i],
    ['kind', 'screenshot', /invalid option/i],
    ['active_view', 'wetlands', /active_view must match/i],
    ['boundary_visible', false, /boundary is not visible/i],
    ['tiles_loaded', false, /tiles must be loaded/i],
    ['camera_scale', 'unknown', /camera scale must be known/i],
    ['clipped', true, /clipped visual evidence/i],
    ['obstructions', 'none', /obstructions.*array/i],
  ])('rejects malformed visual metadata in %s', (field, value, pattern) => {
    const output = visualOutput();
    const visual = (output.visual_artifacts as Array<Record<string, unknown>>)[0];
    visual[field] = value;
    expectRejected(output, pattern);
  });

  it('rejects empty and duplicate visual claims', () => {
    expectRejected({ ...visualOutput(), visual_artifacts: [] }, /at least one verified visual/i);
    const output = visualOutput();
    output.visual_artifacts = [structuredClone((output.visual_artifacts as unknown[])[0]), structuredClone((output.visual_artifacts as unknown[])[0])];
    expectRejected(output, /duplicate visual artifact keys|duplicate visual artifact paths/i);
  });

  it.each([
    [{ ...subjectOutput(), evidence_type: 'valuation' }, /evidence_type/i],
    [{ ...compOutput(), comps: [{ ...(compOutput().comps as Array<Record<string, unknown>>)[0], evidence_type: 'offer' }] }, /evidence_type/i],
    [{ ...visualOutput(), visual_artifacts: [{ ...(visualOutput().visual_artifacts as Array<Record<string, unknown>>)[0], evidence_type: 'strategy' }] }, /evidence_type/i],
  ])('rejects unsupported evidence types', (output, pattern) => {
    expectRejected(output, pattern);
  });

  it('permits an identity-only failure handback but forbids evidence or completed-category claims', () => {
    const failed = {
      specialist_category: 'visuals',
      subject_verification_status: 'failed',
      subject_verification_note: 'Browser timed out before exact evidence could be retained.',
      address: 'ONEIL RD, PORT BYRON, NY 13140',
      apn: EXPECTED.apn,
      property_card_id: EXPECTED.propertyCardId,
      canonical_property_identifier: EXPECTED.propertyId,
      captured_at: '2026-08-02T14:00:00.000Z',
      completed_categories: [],
      comps: [],
      visual_artifacts: [],
    };
    expect(validateHermesWorkerOutput(failed, EXPECTED).output.subject_verification_status).toBe('failed');
    expectRejected({ ...failed, completed_categories: ['visuals'] }, /must not claim completed categories/i);
    expectRejected({ ...failed, subject_url: SUBJECT_URL }, /unrecognized key/i);
  });

  it('exports a strict Draft 2020-12 JSON schema for model-side constrained output', () => {
    expect(HERMES_WORKER_OUTPUT_JSON_SCHEMA).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
    expect(JSON.stringify(HERMES_WORKER_OUTPUT_JSON_SCHEMA)).toContain('specialist_category');
  });

  it('uses a typed boundary error with deterministic issue text', () => {
    try {
      validateHermesWorkerOutput({ ...subjectOutput(), comps: '[]' }, EXPECTED);
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(HermesWorkerBoundaryError);
      expect((error as HermesWorkerBoundaryError).issues).toEqual(expect.arrayContaining([expect.stringMatching(/comps.*array/i)]));
    }
  });
});

function makeSubjectUrl(fips: string, apn: string, propertyId: string): string {
  const decoded = `fips=${fips}&apn=${apn.replace(/ /g, '+')}&propertyid=${propertyId}`;
  const token = Buffer.from(decoded, 'utf8').toString('base64');
  return `https://landportal.com/?property=${encodeURIComponent(token)}`;
}
