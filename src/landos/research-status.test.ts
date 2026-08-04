// Research-status contract: the delivered count is recomputed from the
// current accepted research state, the exact incomplete area is named with a
// reason and next action, nothing is counted twice, and completion is never
// fabricated.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  rederiveSpecialistDelivery,
  researchStatusFrom,
  type SnapshotSpecialistRecord,
  type SnapshotEvidenceItem,
} from './property-intelligence-snapshot.js';

const specialist = (overrides: Partial<SnapshotSpecialistRecord>): SnapshotSpecialistRecord => ({
  id: 'parcel_identity' as SnapshotSpecialistRecord['id'],
  label: 'Parcel identity',
  role: 'required',
  status: 'completed',
  startedAt: null,
  completedAt: null,
  durationMs: null,
  summary: 'ok',
  failureCategory: null,
  failureMessage: null,
  retryable: false,
  evidenceCount: 0,
  ...overrides,
});

const DEAL81_STYLE: SnapshotSpecialistRecord[] = [
  specialist({ id: 'parcel_identity' as never, label: 'Parcel identity', status: 'completed' }),
  specialist({ id: 'government_records' as never, label: 'Government records', role: 'supporting', status: 'blocked' }),
  specialist({ id: 'zoning_land_use' as never, label: 'Zoning and land use', status: 'partial' }),
  specialist({ id: 'environmental_terrain' as never, label: 'Environmental and terrain', status: 'partial' }),
  specialist({ id: 'access_utilities' as never, label: 'Utilities and access', status: 'partial' }),
  specialist({ id: 'comparables' as never, label: 'Comparables', status: 'completed' }),
  specialist({ id: 'market_intelligence' as never, label: 'Market intelligence', role: 'supporting', status: 'completed' }),
  specialist({
    id: 'evidence_visuals' as never, label: 'Evidence and property screenshots', status: 'blocked',
    summary: 'No screenshots, documents or source links have been retained for this parcel yet.',
  }),
  specialist({ id: 'valuation' as never, label: 'Valuation', status: 'partial' }),
  specialist({ id: 'strategy' as never, label: 'Strategy', status: 'partial' }),
];

const evidence = (count: number): SnapshotEvidenceItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `inspection-${index}`, label: `Visual ${index}`, kind: 'screenshot',
  } as unknown as SnapshotEvidenceItem));

describe('specialist delivery re-derivation', () => {
  it('upgrades a stale blocked evidence_visuals row when accepted evidence exists', () => {
    const result = rederiveSpecialistDelivery(DEAL81_STYLE, evidence(10));
    const visuals = result.find((s) => s.id === ('evidence_visuals' as never))!;
    expect(visuals.status).toBe('completed');
    expect(visuals.summary).toMatch(/10 accepted evidence item\(s\)/);
  });

  it('never fabricates completion when no evidence is retained', () => {
    const result = rederiveSpecialistDelivery(DEAL81_STYLE, []);
    expect(result.find((s) => s.id === ('evidence_visuals' as never))!.status).toBe('blocked');
  });
});

describe('named research areas', () => {
  it('names the exact incomplete eighth area with reason and next action', () => {
    const status = researchStatusFrom(DEAL81_STYLE);
    expect(status.total).toBe(8);
    expect(status.delivered).toBe(7);
    expect(status.headline).toBe('7 of 8 research areas delivered');
    expect(status.incomplete).toHaveLength(1);
    expect(status.incomplete[0].label).toBe('Evidence and property screenshots');
    expect(status.incomplete[0].reason).toMatch(/No screenshots/);
    expect(status.incomplete[0].nextAction).toBeTruthy();
  });

  it('reports 8 of 8 once the stale visuals row is re-derived against real evidence', () => {
    const status = researchStatusFrom(rederiveSpecialistDelivery(DEAL81_STYLE, evidence(10)));
    expect(status.headline).toBe('8 of 8 research areas delivered');
    expect(status.incomplete).toHaveLength(0);
  });

  it('counts each required area exactly once and ignores supporting lanes', () => {
    const status = researchStatusFrom(DEAL81_STYLE);
    expect(new Set(status.areas.map((a) => a.id)).size).toBe(status.areas.length);
    expect(status.areas.some((a) => a.id === ('government_records' as never))).toBe(false);
  });
});

describe('projection wiring (source contract)', () => {
  it('routes re-derives specialists and serves researchStatus + access + soilsSeptic + narrative', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/landos/routes.ts'), 'utf8');
    expect(src).toMatch(/rederiveSpecialistDelivery\(storedSnapshot\.specialists, storedSnapshot\.evidence\)/);
    expect(src).toMatch(/researchStatus: snapshot \? researchStatusFrom\(snapshot\.specialists\) : null/);
    expect(src).toMatch(/access: accessPresentation/);
    expect(src).toMatch(/soilsSeptic,/);
    expect(src).toMatch(/visualBuyerNarrative,/);
  });

  it('the workspace header names the missing area instead of a bare count', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'web/src/pages/AcquisitionWorkspaceV2.tsx'), 'utf8');
    expect(src).toMatch(/researchStatus\s*\?\s*researchStatus\.headline/);
    expect(src).toMatch(/incompleteArea/);
    expect(src).toMatch(/Missing: <b>\{incompleteArea\.label\}<\/b>/);
  });
});
