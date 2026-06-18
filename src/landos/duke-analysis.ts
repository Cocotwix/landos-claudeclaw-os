// Duke first-pass analysis: green/red/anomaly flags, strategy candidates, and
// strategy readiness from verified property data. Pure + deterministic.
//
// Hard rules:
//   - No property-specific OFFER numbers are invented here. The offer-formula
//     source is offer-engine.ts (present); we surface readiness + the $10,000
//     minimum-net-profit baseline, never a fabricated offer.
//   - Unverified parcel -> strategy/underwriting blocked.

import type { DukePropertyData } from './duke-property-data.js';
import { GLOBAL_MIN_NET_PROFIT_USD } from './offer-engine.js';

export type StrategyStatus =
  | 'ready_for_preliminary_review'
  | 'blocked_needs_more_data'
  | 'blocked_unverified_parcel';

export type OfferReadinessStatus =
  | 'offer_formula_source_missing'
  | 'needs_verified_valuation'
  | 'available_not_computed';

export interface DukeStrategyCandidate {
  strategy: string;
  rationale: string;
}

export interface DukeAnalysis {
  parcelVerified: boolean;
  strategyStatus: StrategyStatus;
  greenFlags: string[];
  redFlags: string[];
  anomalyFlags: string[];
  dataGaps: string[];
  strategyCandidates: DukeStrategyCandidate[];
  offerReadiness: {
    status: OfferReadinessStatus;
    formulaSource: string;
    minNetProfitBaselineUsd: number;
    note: string;
  };
  note: string;
}

const TRUTHY = /^(1|y|yes|true|t)$/i;
function isTrue(v: string | undefined): boolean {
  return !!v && TRUTHY.test(v.trim());
}

/**
 * Build Duke's first-pass analysis. Verified property data unlocks flags +
 * strategy candidates; an unverified parcel is blocked. Never invents offers.
 */
export function buildDukeAnalysis(input: {
  parcelVerified: boolean;
  propertyData?: DukePropertyData;
  dataGaps?: string[];
}): DukeAnalysis {
  const baseGaps = input.dataGaps ?? [];

  if (!input.parcelVerified || !input.propertyData) {
    return {
      parcelVerified: false,
      strategyStatus: 'blocked_unverified_parcel',
      greenFlags: [],
      redFlags: [],
      anomalyFlags: [],
      dataGaps: baseGaps,
      strategyCandidates: [],
      offerReadiness: {
        status: 'needs_verified_valuation',
        formulaSource: 'offer-engine',
        minNetProfitBaselineUsd: GLOBAL_MIN_NET_PROFIT_USD,
        note: 'Parcel unverified: no property-specific strategy, underwriting, valuation, or offer guidance.',
      },
      note: 'Strategy and underwriting are blocked until parcel identity is verified by a named source.',
    };
  }

  const f = input.propertyData.landFacts;
  const v = input.propertyData.valuation;
  const green: string[] = [];
  const red: string[] = [];
  const anomaly: string[] = [];

  // Access
  if (isTrue(f.landLocked)) red.push('Landlocked per source — confirm legal/recorded access.');
  else if (f.landLocked !== undefined) green.push('Not flagged landlocked by source (still confirm access).');

  // Road frontage
  if (typeof f.roadFrontageFt === 'number' && f.roadFrontageFt > 0) green.push(`Road frontage ~${f.roadFrontageFt} ft.`);

  // Buildability
  if (typeof f.buildabilityPct === 'number') {
    if (f.buildabilityPct >= 70) green.push(`High buildability (~${f.buildabilityPct}%).`);
    else if (f.buildabilityPct < 30) red.push(`Low buildability (~${f.buildabilityPct}%).`);
    else anomaly.push(`Moderate buildability (~${f.buildabilityPct}%) — verify usable area.`);
  }

  // Environmental
  if (typeof f.wetlandsPct === 'number' && f.wetlandsPct >= 25) red.push(`Significant wetlands (~${f.wetlandsPct}%).`);
  else if (typeof f.wetlandsPct === 'number' && f.wetlandsPct > 0) anomaly.push(`Some wetlands (~${f.wetlandsPct}%).`);
  if (typeof f.femaPct === 'number' && f.femaPct >= 25) red.push(`Significant FEMA floodplain (~${f.femaPct}%).`);
  else if (typeof f.femaPct === 'number' && f.femaPct > 0) anomaly.push(`Partial FEMA floodplain (~${f.femaPct}%).`);

  // Slope
  if (typeof f.slopeAvgDeg === 'number' && f.slopeAvgDeg >= 15) red.push(`Steep average slope (~${f.slopeAvgDeg}°).`);

  // Size
  if (typeof f.acres === 'number' && f.acres > 0) green.push(`Acreage ~${f.acres} ac.`);

  // Structures
  const hasStructures = typeof f.buildingAreaSqft === 'number' && f.buildingAreaSqft > 0;
  if (hasStructures) anomaly.push(`Structure/improvement present (~${f.buildingAreaSqft} sqft) — improved-property path.`);

  // Strategy candidates (deterministic; pass/no offer always available).
  const candidates: DukeStrategyCandidate[] = [];
  candidates.push({ strategy: 'quick_flip', rationale: 'Default land flip if basis supports it.' });
  if (typeof f.acres === 'number' && f.acres >= 5 && (f.buildabilityPct ?? 0) >= 30) {
    candidates.push({ strategy: 'subdivide', rationale: 'Acreage + buildability may support a split (verify lot rules).' });
  }
  if (!isTrue(f.landLocked) && (f.buildabilityPct ?? 0) >= 40) {
    candidates.push({ strategy: 'land_home_package', rationale: 'Buildable with access — possible land-home package (gate on local MH sales).' });
  }
  if (hasStructures) {
    candidates.push({ strategy: 'improved_property_value_add', rationale: 'Existing structure — value-add / mobile-home angle.' });
    candidates.push({ strategy: 'teardown_land_only', rationale: 'Fallback: value as land only if structure is non-contributory.' });
  }
  candidates.push({ strategy: 'pass_no_offer', rationale: 'Always available if numbers/risk do not work.' });

  // Readiness: need core land facts to move to preliminary review.
  const haveCore = typeof f.acres === 'number' && (f.buildabilityPct !== undefined || f.roadFrontageFt !== undefined);
  const strategyStatus: StrategyStatus = haveCore ? 'ready_for_preliminary_review' : 'blocked_needs_more_data';

  // Offer readiness: formula source exists (offer-engine). We never compute a
  // property-specific offer here — that needs a chosen strategy + verified
  // valuation + costs/risk. Surface the baseline only.
  const haveValuation = v.marketTotal !== undefined || v.tlpEstimate !== undefined || v.assessedTotal !== undefined;
  const offerStatus: OfferReadinessStatus = haveValuation ? 'available_not_computed' : 'needs_verified_valuation';

  return {
    parcelVerified: true,
    strategyStatus,
    greenFlags: green,
    redFlags: red,
    anomalyFlags: anomaly,
    dataGaps: [...new Set([...baseGaps, ...input.propertyData.dataGaps])],
    strategyCandidates: candidates,
    offerReadiness: {
      status: offerStatus,
      formulaSource: 'offer-engine',
      minNetProfitBaselineUsd: GLOBAL_MIN_NET_PROFIT_USD,
      note:
        offerStatus === 'available_not_computed'
          ? 'Offer formula source present (offer-engine). No property-specific offer is computed until a strategy is selected and costs/risk are set. $10,000 minimum net profit baseline applies.'
          : 'Need verified valuation data before any offer math. $10,000 minimum net profit baseline applies.',
    },
    note:
      strategyStatus === 'ready_for_preliminary_review'
        ? 'Verified facts support a preliminary strategy review. Confirm access/title/utilities before any offer.'
        : 'Verified parcel, but core land facts are incomplete — gather more data before strategy/underwriting.',
  };
}
