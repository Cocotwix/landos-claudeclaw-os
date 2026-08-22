// Bounded acreage-dependent stale-product resolver (Slice 4C).
//
// Root cause this module fixes: a canonical-acreage adoption (Slice 4B) marks
// its dependent products stale, but the marker was advisory only — nothing
// could ever RESOLVE it, so an operator surface kept warning about products
// that the live read models had already recomputed on the canonical figure.
//
// This resolver deterministically classifies every stale product against the
// canonical current acreage and persists the classification INTO the retained
// acreage-extent record. It never clears a marker without a recorded basis,
// never rescales a provider metric onto a different acreage, never invents a
// number, and never launches research, providers, or model calls. The only
// writes are derived-snapshot updates of the acreage_extent_v1 record.
//
// Classifications:
//   recalculated_current      — the live read model provably recomputes from
//                               the canonical acreage at read time.
//   retained_compatible_basis — the retained figure's own source basis is
//                               compatible with the current parcel, so it is
//                               kept with provenance rather than rescaled.
//   requires_targeted_refresh — only an existing bounded capability re-run
//                               (e.g. the intelligence stack) can resolve it;
//                               it stays stale until that run postdates the
//                               adoption.
//   still_stale               — no deterministic resolution exists; honestly
//                               unresolved.

import { materiallyDifferentAcres } from './acreage-basis.js';
import { buildCompsValuationView } from './comps-valuation.js';
import { getLandosDb, landosAudit } from './db.js';
import { readDerivedSnapshot, readDerivedSnapshotHistory, writeDerivedSnapshot } from './derived-intelligence-store.js';
import {
  DEAL_INTELLIGENCE_PRODUCT_TYPE,
  MARKET_INTELLIGENCE_PRODUCT_TYPE,
  PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
} from './intelligence-stack-contract.js';
import { buildParcelFactSheet } from './landportal-facts.js';
import { readPropertySubdivisionRead } from './land-use-intelligence-store.js';
import { acreageBandForAcres } from './market-matrix-read.js';
import {
  ACREAGE_EXTENT_SNAPSHOT_TYPE,
  readAcreageExtentRecord,
  type AcreageExtentRunRecord,
} from './official-acreage-run.js';
import { loadPropertyInspection } from './property-card.js';
import { readResolverSubject } from './universal-property-resolution.js';

export const ACREAGE_DEPENDENT_REFRESH_VERSION = '1.0.0';

export type DependentProductStatus =
  | 'recalculated_current'
  | 'retained_compatible_basis'
  | 'requires_targeted_refresh'
  | 'still_stale';

export interface DependentProductOutcome {
  product: string;
  status: DependentProductStatus;
  /** The recorded reason this classification holds — never empty. */
  basis: string;
  /** Concrete figures the classification rests on. */
  evidence: string[];
}

export interface AcreageDependentRefreshRecord {
  contractVersion: string;
  dealCardId: number;
  runAt: string;
  canonicalAcres: number;
  /** The adoption moment the markers were raised at. Kept here durably so a
   *  re-audit after the markers cleared still compares product freshness
   *  against the adoption, not against nothing. */
  adoptionStaleSince: string | null;
  outcomes: DependentProductOutcome[];
  /** Products that remain stale after this pass (subset of the input set). */
  remainingStale: string[];
}

// ── Pure resolution engine ──────────────────────────────────────────────────

export interface DependentResolutionInput {
  canonicalAcres: number;
  staleProducts: string[];
  /** The subject Property Card's live acreage (the resolver-subject figure). */
  propertyCardAcres: number | null;
  /** Live comps/valuation read-model figures, already computed at read time. */
  valuation: {
    workingAcres: number | null;
    status: string | null;
    fmvCentral: number | null;
    medianPricePerAcre: number | null;
    acceptedCount: number | null;
    confidence: string | null;
    acreageBandLabel: string | null;
    compUniverseTotal: number | null;
  } | null;
  /** The acreage the stale products were computed on (pre-adoption figure). */
  previousAcres: number | null;
  /** Retained LandPortal physical metrics and the geometry they rest on. */
  physical: {
    buildablePct: number | null;
    buildableAcres: number | null;
    /** The provider's own geometry-calculated parcel area, when retained. */
    providerGeometryAcres: number | null;
  };
  subdivision: {
    minimumLotAcresKnown: boolean;
    priorInputAcres: number | null;
    theoreticalCountValue: number | null;
  } | null;
  /** When each intelligence-stack product was last generated, and when the
   *  stale markers were raised. A product regenerated after the adoption was
   *  necessarily formed on the canonical acreage (the dossier reads it). */
  intelligence: {
    propertyGeneratedAt: string | null;
    marketGeneratedAt: string | null;
    dealGeneratedAt: string | null;
    staleSince: string | null;
  };
  now: () => string;
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const after = (iso: string | null, sinceIso: string | null): boolean => {
  if (!iso || !sinceIso) return false;
  const a = Date.parse(iso);
  const b = Date.parse(sinceIso);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
};

/** PURE: classify every stale product. No I/O, fully unit-testable. */
export function resolveAcreageDependentProducts(input: DependentResolutionInput): AcreageDependentRefreshRecord {
  const outcomes: DependentProductOutcome[] = [];
  const canonical = input.canonicalAcres;

  const valuationCurrent = input.valuation != null
    && isNum(input.valuation.workingAcres)
    && !materiallyDifferentAcres(input.valuation.workingAcres, canonical, 0.001, 0.01);

  const push = (product: string, status: DependentProductStatus, basis: string, evidence: string[]) =>
    outcomes.push({ product, status, basis, evidence });

  for (const product of input.staleProducts) {
    switch (product) {
      case 'valuation':
      case 'per_acre_pricing':
      case 'comps_acreage_band':
      case 'strategy_economics': {
        if (valuationCurrent) {
          const v = input.valuation!;
          push(product, 'recalculated_current',
            `The comps/valuation read model recomputes from the canonical subject acreage at read time; its working acreage equals the canonical ${canonical} ac, so bands, per-acre math, and the economics derived from FMV are current. The retained comp universe was re-evaluated against the canonical subject; no new discovery ran.`,
            [
              `working acres ${v.workingAcres} = canonical ${canonical}`,
              v.acreageBandLabel ? `routed acreage band ${v.acreageBandLabel}` : 'routed acreage band derived from canonical acres',
              v.compUniverseTotal != null ? `retained comp universe ${v.compUniverseTotal} records` : 'retained comp universe reused',
              v.acceptedCount != null ? `${v.acceptedCount} qualifying closed sales` : 'qualifying set recomputed',
              v.medianPricePerAcre != null ? `median $${v.medianPricePerAcre}/ac` : 'per-acre set recomputed',
              v.fmvCentral != null ? `cleaned land FMV central $${v.fmvCentral}` : 'FMV recomputed',
              v.confidence ? `confidence ${v.confidence}` : 'confidence recomputed',
            ]);
        } else {
          push(product, 'still_stale',
            `The live comps/valuation read model does not carry the canonical acreage (working acres ${input.valuation?.workingAcres ?? 'absent'} vs canonical ${canonical}); the product cannot be declared current.`,
            []);
        }
        break;
      }
      case 'market_acreage_band': {
        const currentBand = acreageBandForAcres(canonical);
        const previousBand = isNum(input.previousAcres) ? acreageBandForAcres(input.previousAcres) : null;
        if (previousBand != null && previousBand === currentBand) {
          push(product, 'retained_compatible_basis',
            `The canonical ${canonical} ac maps to the same market acreage band (${currentBand}) as the superseded ${input.previousAcres} ac figure, so the retained band-level market evidence continues to apply to the current subject; no market recollection is required. Only the subject-size narrative changes.`,
            [`band before ${previousBand}`, `band after ${currentBand}`, 'retained market records reused']);
        } else {
          push(product, 'requires_targeted_refresh',
            `The canonical ${canonical} ac maps to band ${currentBand}${previousBand ? `, different from the prior ${previousBand}` : ''}; retained band evidence must be re-resolved for the new band before the product is current.`,
            [`band after ${currentBand}`, previousBand ? `band before ${previousBand}` : 'prior band unknown']);
        }
        break;
      }
      case 'buildable_metrics': {
        const { buildablePct, buildableAcres, providerGeometryAcres } = input.physical;
        const implied = isNum(buildableAcres) && isNum(buildablePct)
          ? Math.round((buildableAcres / (buildablePct / 100)) * 100) / 100
          : null;
        const basisAcres = providerGeometryAcres ?? implied;
        if (isNum(basisAcres) && !materiallyDifferentAcres(basisAcres, canonical)) {
          push(product, 'retained_compatible_basis',
            `The retained provider physical metrics were computed against the provider's own mapped parcel geometry (${basisAcres} ac), which is compatible with the current official ${canonical} ac parcel within tolerance. They are retained with that basis recorded — never rescaled onto a different acreage.`,
            [
              buildablePct != null ? `buildable ${buildablePct}%` : 'buildable % absent',
              buildableAcres != null ? `buildable ${buildableAcres} ac` : 'buildable acres absent',
              providerGeometryAcres != null ? `provider geometry ${providerGeometryAcres} ac` : 'provider geometry not retained',
              implied != null ? `implied basis ${implied} ac (acres ÷ pct)` : 'implied basis not derivable',
            ]);
        } else if (isNum(basisAcres)) {
          push(product, 'still_stale',
            `The retained physical metrics rest on a ${basisAcres} ac basis that is materially different from the canonical ${canonical} ac parcel. They are not rescaled — no supported current figure exists.`,
            [`basis ${basisAcres} ac vs canonical ${canonical} ac`]);
        } else {
          push(product, 'still_stale',
            'The acreage basis of the retained physical metrics cannot be established from retained evidence; they remain stale rather than being assumed current.',
            []);
        }
        break;
      }
      case 'subdivision_screening': {
        const sub = input.subdivision;
        if (sub == null) {
          push(product, 'still_stale', 'No property-specific subdivision read is retained; nothing to reconcile.', []);
        } else if (!sub.minimumLotAcresKnown) {
          push(product, 'retained_compatible_basis',
            `No minimum lot area is established, so the theoretical lot count is unknown at any acreage — the acreage correction changes no subdivision conclusion. The canonical ${canonical} ac governs any future run; unresolved constraints (frontage, access, wastewater, zoning) remain unresolved. The corrected acreage creates no legal yield.`,
            [
              `theoretical count ${sub.theoreticalCountValue ?? 'unknown'} (unchanged)`,
              `prior input echo ${sub.priorInputAcres ?? 'absent'} ac superseded by canonical ${canonical} ac for any future run`,
            ]);
        } else if (isNum(sub.priorInputAcres) && !materiallyDifferentAcres(sub.priorInputAcres, canonical, 0.001, 0.01)) {
          push(product, 'recalculated_current',
            `The retained subdivision read already computed on the canonical ${canonical} ac.`,
            [`input acres ${sub.priorInputAcres}`]);
        } else {
          push(product, 'requires_targeted_refresh',
            `A minimum lot area is established and the retained read computed on ${sub.priorInputAcres ?? 'an unknown'} ac; the deterministic screen must be re-run on the canonical ${canonical} ac by the existing zoning/subdivision capability.`,
            [`prior input ${sub.priorInputAcres ?? 'absent'} ac vs canonical ${canonical} ac`]);
        }
        break;
      }
      case 'deal_brain_guidance': {
        const { propertyGeneratedAt, marketGeneratedAt, dealGeneratedAt, staleSince } = input.intelligence;
        const dealFresh = after(dealGeneratedAt, staleSince);
        const inputsFresh = after(propertyGeneratedAt, staleSince) && after(marketGeneratedAt, staleSince);
        if (dealFresh && inputsFresh) {
          push(product, 'recalculated_current',
            'The Deal synthesis was regenerated after the canonical-acreage adoption, on Property and Market reads that were themselves regenerated after it — every layer reasoned from the canonical acreage.',
            [
              `deal read ${dealGeneratedAt}`,
              `property read ${propertyGeneratedAt}`,
              `market read ${marketGeneratedAt}`,
              `stale since ${staleSince}`,
            ]);
        } else {
          push(product, 'requires_targeted_refresh',
            'The Deal synthesis (and the Property/Market reads it depends on) predates the canonical-acreage adoption; one normal intelligence-stack refresh resolves it. Retained guidance authored on the superseded acreage stays retained as history.',
            [
              `deal read ${dealGeneratedAt ?? 'absent'}`,
              `property read ${propertyGeneratedAt ?? 'absent'}`,
              `market read ${marketGeneratedAt ?? 'absent'}`,
              `stale since ${staleSince ?? 'unknown'}`,
            ]);
        }
        break;
      }
      default:
        push(product, 'still_stale', `No deterministic resolution rule exists for "${product}"; it remains stale.`, []);
    }
  }

  const remainingStale = outcomes
    .filter((o) => o.status === 'still_stale' || o.status === 'requires_targeted_refresh')
    .map((o) => o.product);

  return {
    contractVersion: ACREAGE_DEPENDENT_REFRESH_VERSION,
    dealCardId: 0, // stamped by the orchestrator
    runAt: input.now(),
    canonicalAcres: canonical,
    adoptionStaleSince: input.intelligence.staleSince,
    outcomes,
    remainingStale,
  };
}

// ── Orchestrator: gather retained state, resolve, persist ───────────────────

const parseNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ''));
    if (m) {
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
};

/** The durable adoption moment: when the acreage reconciliation created the
 *  canonical identity version for this deal. Null when no adoption happened. */
function adoptionIdentityVersionAt(dealCardId: number): string | null {
  const row = getLandosDb()
    .prepare(`SELECT MAX(created_at) m FROM landos_property_identity_version
              WHERE deal_card_id = ? AND created_by = 'acreage-extent-reconciliation'`)
    .get(dealCardId) as { m: number | null } | undefined;
  return row?.m ? new Date(row.m * 1000).toISOString() : null;
}

export interface DependentRefreshRunResult {
  outcome: 'resolved' | 'nothing_stale' | 'refused';
  reason: string;
  record: AcreageDependentRefreshRecord | null;
  remainingStale: string[];
}

/**
 * ONE bounded pass. SELECTs over retained state plus one derived-snapshot
 * update of the acreage-extent record. No providers, no model calls, no
 * research, no rescaling.
 */
export function runAcreageDependentRefresh(
  dealCardId: number,
  opts: { now?: () => string; products?: string[] } = {},
): DependentRefreshRunResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const extent = readAcreageExtentRecord(dealCardId);
  if (!extent) {
    return { outcome: 'refused', reason: 'No acreage-extent reconciliation is retained for this deal.', record: null, remainingStale: [] };
  }
  const canonical = extent.decision.canonicalAcres;
  if (!isNum(canonical)) {
    return { outcome: 'refused', reason: 'The acreage-extent record carries no canonical acreage; nothing can be reconciled against it.', record: null, remainingStale: [] };
  }
  // The adoption moment the markers were raised at: the record's live
  // staleSince while markers stand, else the durable copy the last resolution
  // kept, else the identity version the adoption created — a re-audit still
  // compares product freshness against the adoption.
  const adoptionAt = extent.staleSince
    ?? extent.dependentRefresh?.adoptionStaleSince
    ?? adoptionIdentityVersionAt(dealCardId);

  // Normal pass: classify what is marked stale. Re-audit pass (explicit
  // product set, or nothing stale but a resolution record exists):
  // deterministically re-verify previously classified products — a regression
  // repopulates the stale set.
  let stale = opts.products?.length ? opts.products : (extent.decision.staleProducts ?? []);
  if (!stale.length) {
    const prior = [...new Set((extent.dependentRefresh?.outcomes ?? []).map((o) => o.product))];
    if (!prior.length) {
      return { outcome: 'nothing_stale', reason: 'No acreage-dependent product is marked stale.', record: extent.dependentRefresh ?? null, remainingStale: [] };
    }
    stale = prior;
  }

  const subject = readResolverSubject(dealCardId);

  // Live comps/valuation read model — recomputed from the canonical subject at
  // read time. A SELECT-driven computation, not a discovery run.
  const view = buildCompsValuationView(dealCardId) as unknown as {
    summary?: {
      workingAcres?: number | null; status?: string | null; confidence?: string | null;
      medianPricePerAcre?: number | null; fmv?: { central?: number | null } | null;
      acceptedCount?: number | null;
    } | null;
    counts?: { total?: number | null } | null;
    valuationWindow?: { acreageBand?: { label?: string | null } | null } | null;
  } | null;

  // Retained provider physical metrics + the provider's own geometry area.
  const inspection = subject?.propertyCardId != null ? loadPropertyInspection(subject.propertyCardId) : null;
  const factSheet = inspection?.parcelFacts ? buildParcelFactSheet(inspection.parcelFacts) : null;
  const providerGeometry = (extent.decision.retained ?? [])
    .find((r) => r.valueType === 'provider_calculated' && isNum(r.valueAcres ?? null));

  const subdivisionRead = readPropertySubdivisionRead(dealCardId);
  const productGeneratedAt = (type: string): string | null => {
    const p = readDerivedSnapshot<{ generatedAt?: string }>(dealCardId, type);
    return typeof p?.generatedAt === 'string' ? p.generatedAt : null;
  };

  const resolved = resolveAcreageDependentProducts({
    canonicalAcres: canonical,
    staleProducts: stale,
    propertyCardAcres: subject?.acres ?? null,
    valuation: view ? {
      workingAcres: view.summary?.workingAcres ?? null,
      status: view.summary?.status ?? null,
      fmvCentral: view.summary?.fmv?.central ?? null,
      medianPricePerAcre: view.summary?.medianPricePerAcre ?? null,
      acceptedCount: view.summary?.acceptedCount ?? null,
      confidence: view.summary?.confidence ?? null,
      acreageBandLabel: view.valuationWindow?.acreageBand?.label ?? null,
      compUniverseTotal: view.counts?.total ?? null,
    } : null,
    // The acreage the stale products were computed ON: the figure the ACTUAL
    // adoption replaced. The current record can be a later no-change rerun
    // whose own previousAcres is already the canonical figure, so the latest
    // genuinely adopting record (current or history) is the authority.
    previousAcres: [extent, ...readDerivedSnapshotHistory<AcreageExtentRunRecord>(dealCardId, ACREAGE_EXTENT_SNAPSHOT_TYPE).reverse()]
      .find((r) => r?.adoption?.adopted)?.adoption?.previousAcres
      ?? extent.adoption?.previousAcres
      ?? null,
    physical: {
      buildablePct: parseNum(factSheet?.buildability?.pct ?? null),
      buildableAcres: parseNum(factSheet?.buildability?.acres ?? null),
      providerGeometryAcres: providerGeometry?.valueAcres ?? null,
    },
    subdivision: subdivisionRead ? {
      minimumLotAcresKnown: subdivisionRead.theoreticalLotCount?.inputs?.minimumLotAcres != null,
      priorInputAcres: subdivisionRead.theoreticalLotCount?.inputs?.acres ?? null,
      theoreticalCountValue: subdivisionRead.theoreticalLotCount?.value ?? null,
    } : null,
    intelligence: {
      propertyGeneratedAt: productGeneratedAt(PROPERTY_INTELLIGENCE_PRODUCT_TYPE),
      marketGeneratedAt: productGeneratedAt(MARKET_INTELLIGENCE_PRODUCT_TYPE),
      dealGeneratedAt: productGeneratedAt(DEAL_INTELLIGENCE_PRODUCT_TYPE),
      staleSince: adoptionAt,
    },
    now,
  });
  // A later pass classifies only what is STILL stale; the recorded resolution
  // of every already-resolved product is carried forward, never dropped.
  const carried = (extent.dependentRefresh?.outcomes ?? [])
    .filter((prior) => !resolved.outcomes.some((o) => o.product === prior.product));
  const record: AcreageDependentRefreshRecord = {
    ...resolved,
    outcomes: [...carried, ...resolved.outcomes],
    dealCardId,
  };

  // Persist INTO the retained acreage-extent record: the stale set narrows to
  // what genuinely remains, and every narrowing carries its recorded basis.
  const updated: AcreageExtentRunRecord = {
    ...extent,
    decision: { ...extent.decision, staleProducts: record.remainingStale },
    staleSince: record.remainingStale.length ? adoptionAt : null,
    dependentRefresh: record,
  };
  writeDerivedSnapshot({
    dealCardId,
    snapshotType: ACREAGE_EXTENT_SNAPSHOT_TYPE,
    payload: updated,
    completeness: {
      status: extent.decision.status,
      confidence: extent.decision.confidence,
      unresolved: extent.decision.unresolvedQuestions.length,
      dependentRemainingStale: record.remainingStale.length,
    },
    changeReason: `Acreage-dependent product resolution: ${record.outcomes.length} classified, ${record.remainingStale.length} still stale.`,
    actor: 'acreage-dependent-refresh',
    auditEvent: 'acreage_dependent_refresh',
  });
  landosAudit('acreage-dependent-refresh', 'acreage_dependent_products_resolved',
    `deal ${dealCardId}: ${record.outcomes.map((o) => `${o.product}=${o.status}`).join(', ')}`, {
      refTable: 'landos_deal_intelligence_snapshot',
      refId: dealCardId,
    });

  return {
    outcome: 'resolved',
    reason: `${record.outcomes.length} product(s) classified; ${record.remainingStale.length} remain stale.`,
    record,
    remainingStale: record.remainingStale,
  };
}
