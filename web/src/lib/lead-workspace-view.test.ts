import { describe, it, expect } from 'vitest';
import {
  acreageEntries,
  compCountsLine,
  dedupeLines,
  fmtAcres,
  fmtMoney,
  fmtPpa,
  readinessRows,
  resolutionChip,
  strategyRows,
  topComps,
} from './lead-workspace-view.js';

describe('Lead Workspace view model', () => {
  it('formats money, price-per-acre, and acres — and stays honestly null when unavailable', () => {
    expect(fmtMoney(99000)).toBe('$99,000');
    expect(fmtPpa(29494)).toBe('$29,494/ac');
    expect(fmtAcres(1.32)).toBe('1.32 ac');
    for (const bad of [null, undefined, 'x', NaN]) {
      expect(fmtMoney(bad)).toBeNull();
      expect(fmtPpa(bad)).toBeNull();
      expect(fmtAcres(bad)).toBeNull();
    }
  });

  it('resolution chip: a genuine identity conflict outranks everything and states both APNs', () => {
    const chip = resolutionChip({
      resolutionState: 'Parcel verified',
      resolution: { identityConflict: { requestedApn: '111-22', resolvedApn: '999-88', source: 'county records' } },
    });
    expect(chip.label).toBe('BLOCKED - WRONG PARCEL');
    expect(chip.tone).toBe('risk');
    expect(chip.detail).toContain('111-22');
    expect(chip.detail).toContain('999-88');
  });

  it('resolution chip: verified / candidate / unresolved / not-run precedence', () => {
    expect(resolutionChip({ resolutionState: 'Parcel verified (county)', resolution: {} }).label).toBe('Verified parcel');
    expect(resolutionChip({ resolutionState: 'x', resolution: { attempted: true, state: 'candidate', basis: 'one source' } }).label)
      .toBe('Candidate - not confirmed');
    expect(resolutionChip({ resolutionState: 'x', resolution: { attempted: true, state: 'unresolved' } }).label).toBe('Unresolved');
    expect(resolutionChip({ resolutionState: 'Not run', resolution: { attempted: false, state: 'not_run' } }).label)
      .toBe('Resolution not run');
  });

  it('comp rows keep normalized price-per-acre when available and stay null when honestly missing', () => {
    const comparables = {
      validatedSold: [
        {
          address: '245 Railroad St, Pickens, SC',
          acresDisplay: 0.53,
          primary: { kind: 'sold', price: 99000, pricePerAcre: 186792 },
          providersDisplay: ['Realtor.com (HomeHarvest)'],
          sourceConfidence: 'medium',
          comparabilityWhy: 'Adjacent acreage band.',
        },
        { address: 'No-PPA Rd', primary: { kind: 'sold', price: 50000, pricePerAcre: null } },
      ],
      validatedActive: [{ address: 'Active Ln', primary: { kind: 'active', price: 20000, pricePerAcre: 10000 } }],
    };
    const rows = topComps(comparables, 10);
    expect(rows).toHaveLength(3);
    expect(rows[0].ppa).toBe('$186,792/ac');
    expect(rows[0].providers).toContain('Realtor.com');
    expect(rows[1].ppa).toBeNull();
    expect(rows[2].kind).toBe('active');
    // the cap is per lane: 1 sold (capped from 2) + 1 active
    expect(topComps(comparables, 1)).toHaveLength(2);
    expect(topComps({}, 5)).toEqual([]);
  });

  it('comp counts line is honest about zero', () => {
    expect(compCountsLine({})).toBe('No validated comparable records.');
    expect(compCountsLine({ counts: { validatedSold: 55, validatedActive: 51 } }))
      .toBe('55 validated sold, 51 validated active (unique registry).');
  });

  it('readiness rows flatten the unified record and keep blockers', () => {
    const rows = readinessRows({
      value: { label: 'Value readiness', state: 'conflicted', stateLabel: 'Conflicted', tone: 'risk', why: 'Acreage conflicted', blockers: ['Acreage is conflicted'] },
      offer: { label: 'Offer readiness', state: 'researching', stateLabel: 'Researching', tone: 'unknown', blockers: [] },
      notARecord: 'skip me',
    });
    expect(rows.map((r) => r.key)).toEqual(['value', 'offer']);
    expect(rows[0].tone).toBe('risk');
    expect(rows[0].blockers).toEqual(['Acreage is conflicted']);
  });

  it('dedupes repeated blocker lines while preserving order', () => {
    expect(dedupeLines(['a', 'b', 'a', '', null, 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('acreage entries preserve source, dispute, and limitation language', () => {
    const rows = acreageEntries({
      entries: [
        { kind: 'assessed', value: 1.32, source: 'Assessor roll', confidence: 'official', disputed: true, limitation: 'Lags surveys.' },
        { kind: 'gis_geometry', value: 1.15, source: 'GIS geometry', confidence: 'official', disputed: true },
        { notAKind: true },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'assessed', value: '1.32 ac', disputed: true, limitation: 'Lags surveys.' });
    expect(rows[1].limitation).toBeNull();
  });

  it('strategy rows carry status tone, why, blockers, and required evidence', () => {
    const rows = strategyRows([
      { strategy: 'Cash Flip', status: 'blocked', why: 'No value basis', blockers: ['No comps', 'No comps'], requiredEvidence: ['Sold comps'] },
      { strategy: 'Novation or Double Close', status: 'viable' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].tone).toBe('caution');
    expect(rows[0].blockers).toEqual(['No comps']);
    expect(rows[1].tone).toBe('good');
  });
});

// Regression: comps-table-hides-validated-actives (W2-F4). The cap is PER
// LANE so validated actives always render beside the sold value basis, and
// the visibility line states exactly how many records are shown.
import { compsShowingLine } from './lead-workspace-view.js';

describe('per-lane comp visibility', () => {
  const comparables = {
    counts: { validatedSold: 55, validatedActive: 51 },
    validatedSold: Array.from({ length: 10 }, (_, i) => ({ address: `Sold ${i}`, primary: { kind: 'sold', price: 1000 + i, pricePerAcre: 500 + i } })),
    validatedActive: Array.from({ length: 10 }, (_, i) => ({ address: `Active ${i}`, primary: { kind: 'active', price: 2000 + i, pricePerAcre: 700 + i } })),
  };

  it('always includes validated actives alongside sold rows', () => {
    const rows = topComps(comparables, 6);
    expect(rows.filter((r) => r.kind === 'sold')).toHaveLength(6);
    expect(rows.filter((r) => r.kind === 'active')).toHaveLength(6);
  });

  it('states honest visibility including the total validated count', () => {
    expect(compsShowingLine(comparables, 12)).toContain('12 of 106');
    expect(compsShowingLine({ counts: { validatedSold: 2, validatedActive: 1 }, validatedSold: [], validatedActive: [] }, 3)).toBe('Showing all 3 validated records.');
  });
});
