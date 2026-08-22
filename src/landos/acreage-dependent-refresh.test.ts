import { describe, expect, it } from 'vitest';
import {
  resolveAcreageDependentProducts,
  type DependentResolutionInput,
} from './acreage-dependent-refresh.js';
import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';

const NOW = '2026-08-21T23:00:00.000Z';

function baseInput(overrides: Partial<DependentResolutionInput> = {}): DependentResolutionInput {
  return {
    canonicalAcres: 51.11,
    staleProducts: [
      'valuation', 'comps_acreage_band', 'market_acreage_band', 'per_acre_pricing',
      'buildable_metrics', 'subdivision_screening', 'strategy_economics', 'deal_brain_guidance',
    ],
    propertyCardAcres: 51.11,
    valuation: {
      workingAcres: 51.11,
      status: 'supported',
      fmvCentral: 3_084_000,
      medianPricePerAcre: 42_066,
      acceptedCount: 3,
      confidence: 'moderate',
      acreageBandLabel: '17.8885–127.775 acres',
      compUniverseTotal: 97,
    },
    previousAcres: 75.91,
    physical: { buildablePct: 30.52, buildableAcres: 15.49, providerGeometryAcres: 50.69 },
    subdivision: { minimumLotAcresKnown: false, priorInputAcres: 75.91, theoreticalCountValue: null },
    intelligence: {
      propertyGeneratedAt: null,
      marketGeneratedAt: null,
      dealGeneratedAt: null,
      staleSince: '2026-08-21T22:13:04.198Z',
    },
    now: () => NOW,
    ...overrides,
  };
}

const outcome = (record: ReturnType<typeof resolveAcreageDependentProducts>, product: string) =>
  record.outcomes.find((o) => o.product === product)!;

describe('resolveAcreageDependentProducts', () => {
  it('resolves valuation, bands, per-acre pricing and strategy economics when the live read model carries the canonical acreage', () => {
    const record = resolveAcreageDependentProducts(baseInput());
    for (const product of ['valuation', 'comps_acreage_band', 'per_acre_pricing', 'strategy_economics']) {
      const o = outcome(record, product);
      expect(o.status).toBe('recalculated_current');
      // The retained universe is re-evaluated; discovery is never triggered.
      expect(o.basis).toContain('no new discovery');
      expect(o.evidence.join(' ')).toContain('51.11');
    }
    expect(outcome(record, 'valuation').evidence.join(' ')).toContain('3084000');
  });

  it('refuses to declare valuation current when the read model does not carry the canonical acreage', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      valuation: { ...baseInput().valuation!, workingAcres: 75.91 },
    }));
    expect(outcome(record, 'valuation').status).toBe('still_stale');
    expect(record.remainingStale).toContain('valuation');
  });

  it('keeps the market band product on the retained evidence when the canonical acreage stays in the same band', () => {
    const record = resolveAcreageDependentProducts(baseInput());
    const o = outcome(record, 'market_acreage_band');
    // 51.11 and 75.91 both map to the 50+ market band.
    expect(o.status).toBe('retained_compatible_basis');
    expect(o.basis).toContain('no market recollection');
  });

  it('demands a targeted refresh when the canonical acreage moves the market band', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      canonicalAcres: 30,
      valuation: { ...baseInput().valuation!, workingAcres: 30 },
    }));
    const o = outcome(record, 'market_acreage_band');
    expect(o.status).toBe('requires_targeted_refresh');
    expect(record.remainingStale).toContain('market_acreage_band');
  });

  it('retains provider physical metrics whose own geometry basis is compatible with the canonical parcel, with the basis recorded', () => {
    const record = resolveAcreageDependentProducts(baseInput());
    const o = outcome(record, 'buildable_metrics');
    expect(o.status).toBe('retained_compatible_basis');
    expect(o.basis).toContain('50.69');
    expect(o.basis).toContain('never rescaled');
    expect(o.evidence.join(' ')).toContain('15.49');
  });

  it('never lets an absolute physical-acre metric survive an incompatible acreage basis, and never rescales it', () => {
    // Metrics computed against the pre-split 75.91-ac extent: incompatible.
    const record = resolveAcreageDependentProducts(baseInput({
      physical: { buildablePct: 30.52, buildableAcres: 23.17, providerGeometryAcres: 75.91 },
    }));
    const o = outcome(record, 'buildable_metrics');
    expect(o.status).toBe('still_stale');
    expect(o.basis).toContain('not rescaled');
    expect(record.remainingStale).toContain('buildable_metrics');
  });

  it('leaves physical metrics stale when their basis cannot be established', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      physical: { buildablePct: null, buildableAcres: null, providerGeometryAcres: null },
    }));
    expect(outcome(record, 'buildable_metrics').status).toBe('still_stale');
  });

  it('derives the physical basis from acres ÷ pct when the provider geometry itself is not retained', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      physical: { buildablePct: 30.52, buildableAcres: 15.49, providerGeometryAcres: null },
    }));
    const o = outcome(record, 'buildable_metrics');
    expect(o.status).toBe('retained_compatible_basis');
    expect(o.evidence.join(' ')).toContain('implied basis 50.75');
  });

  it('reconciles subdivision screening without inventing legal yield when no minimum lot area is established', () => {
    const record = resolveAcreageDependentProducts(baseInput());
    const o = outcome(record, 'subdivision_screening');
    expect(o.status).toBe('retained_compatible_basis');
    expect(o.basis).toContain('unknown at any acreage');
    expect(o.basis).toContain('no legal yield');
  });

  it('requires the existing capability to re-run subdivision screening when a minimum lot area exists and the retained read used the old acreage', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      subdivision: { minimumLotAcresKnown: true, priorInputAcres: 75.91, theoreticalCountValue: 37 },
    }));
    const o = outcome(record, 'subdivision_screening');
    expect(o.status).toBe('requires_targeted_refresh');
    expect(record.remainingStale).toContain('subdivision_screening');
  });

  it('keeps Deal Brain stale while the intelligence reads predate the adoption', () => {
    const record = resolveAcreageDependentProducts(baseInput());
    const o = outcome(record, 'deal_brain_guidance');
    expect(o.status).toBe('requires_targeted_refresh');
    expect(record.remainingStale).toContain('deal_brain_guidance');
  });

  it('refuses to resolve Deal Brain on a fresh deal read alone when its Property/Market inputs are still pre-adoption', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      intelligence: {
        propertyGeneratedAt: '2026-08-21T20:00:00.000Z', // before staleSince
        marketGeneratedAt: '2026-08-21T23:00:00.000Z',
        dealGeneratedAt: '2026-08-21T23:00:00.000Z',
        staleSince: '2026-08-21T22:13:04.198Z',
      },
    }));
    expect(outcome(record, 'deal_brain_guidance').status).toBe('requires_targeted_refresh');
  });

  it('resolves Deal Brain once the deal read and both its inputs postdate the adoption', () => {
    const record = resolveAcreageDependentProducts(baseInput({
      intelligence: {
        propertyGeneratedAt: '2026-08-21T23:00:00.000Z',
        marketGeneratedAt: '2026-08-21T23:00:00.000Z',
        dealGeneratedAt: '2026-08-21T23:05:00.000Z',
        staleSince: '2026-08-21T22:13:04.198Z',
      },
    }));
    expect(outcome(record, 'deal_brain_guidance').status).toBe('recalculated_current');
  });

  it('classifies every stale product, narrows the remaining set to what is genuinely unresolved, and records a basis for each', () => {
    const record = resolveAcreageDependentProducts(baseInput());
    expect(record.outcomes).toHaveLength(8);
    for (const o of record.outcomes) expect(o.basis.length).toBeGreaterThan(0);
    expect(record.remainingStale).toEqual(['deal_brain_guidance']);
    expect(record.canonicalAcres).toBe(51.11);
  });

  it('only touches products that were actually marked stale', () => {
    const record = resolveAcreageDependentProducts(baseInput({ staleProducts: ['valuation'] }));
    expect(record.outcomes).toHaveLength(1);
    expect(record.outcomes[0].product).toBe('valuation');
  });

  it('is deterministic for the same inputs, so a re-audit pass reproduces the same classification', () => {
    const a = resolveAcreageDependentProducts(baseInput());
    const b = resolveAcreageDependentProducts(baseInput());
    expect(a.outcomes).toEqual(b.outcomes);
    expect(a.remainingStale).toEqual(b.remainingStale);
  });
});

describe('buildAcquisitionDossier canonical acreage', () => {
  const extentSource = {
    decision: {
      canonicalAcres: 51.11,
      canonicalSource: 'Williamson County Property Assessment Database',
      confidence: 'confirmed',
      parcelExtent: 'One tax parcel of 51.11 ac; 24.8 ac separately assessed.',
      extentExplanation: 'The 75.91 ac figure describes the PRIOR extent; 24.8 ac was split off: 51.11 + 24.8 = 75.91.',
      retained: [
        { valueAcres: 51.11, valueType: 'official_reported', source: 'County assessment database', vintage: 'current' },
        { valueAcres: 75.91, valueType: 'provider_reported', source: 'LandPortal parcel record', vintage: 'unknown' },
      ],
      staleProducts: ['deal_brain_guidance'],
    },
    dependentRefresh: {
      outcomes: [
        { product: 'buildable_metrics', status: 'retained_compatible_basis', basis: 'Provider geometry 50.69 ac is compatible with the current parcel.' },
      ],
    },
  };

  function sourceWith(extent: unknown): PropertyFileSource {
    return {
      dealCardId: 89,
      propertyCardId: 79,
      propertyIntelligence: {
        snapshot: { identity: { acres: 75.91, acreageBasis: 'assessed', apn: '042-123.00-000', county: 'Williamson' } },
        landPortalFacts: { acres: 75.91 },
      },
      acreageExtent: extent,
    };
  }

  it('lets the canonical current acreage outrank the stale mission-snapshot figure for identity and physical reasoning', () => {
    const dossier = buildAcquisitionDossier(sourceWith(extentSource));
    expect(dossier.identity.acres).toBe(51.11);
    expect(dossier.physical.acres).toBe(51.11);
    expect(dossier.identity.acreageBasis).toContain('canonical');
  });

  it('carries the extent reconciliation, retained historical figures and dependent-product resolution to the analyst', () => {
    const dossier = buildAcquisitionDossier(sourceWith(extentSource));
    expect(dossier.acreage).not.toBeNull();
    expect(dossier.acreage!.canonicalAcres).toBe(51.11);
    expect(dossier.acreage!.extentExplanation).toContain('75.91');
    expect(dossier.acreage!.retainedFigures.map((f) => f.acres)).toContain(75.91);
    expect(dossier.acreage!.staleProducts).toEqual(['deal_brain_guidance']);
    expect(dossier.acreage!.dependentResolution[0]).toMatchObject({ product: 'buildable_metrics', status: 'retained_compatible_basis' });
  });

  it('projects the adopted central FMV from the valuation band object', () => {
    const source = sourceWith(extentSource);
    (source.propertyIntelligence as Record<string, unknown>).compsValuation = {
      summary: { statusLabel: 'Supported valuation', workingAcres: 51.11, acceptedCount: 3, medianPricePerAcre: 42_066, fmv: { low: 1_144_500, central: 3_084_000, high: 7_082_500 } },
    };
    const dossier = buildAcquisitionDossier(source);
    expect(dossier.valuation.fairMarketValue).toBe(3_084_000);
    expect(dossier.valuation.workingAcres).toBe(51.11);
  });

  it('falls back to the snapshot figure when no reconciliation is retained', () => {
    const dossier = buildAcquisitionDossier(sourceWith(undefined));
    expect(dossier.identity.acres).toBe(75.91);
    expect(dossier.acreage).toBeNull();
  });
});
