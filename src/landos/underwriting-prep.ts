// LandOS — post-discovery underwriting PREP foundation.
//
// NOT final underwriting and NOT an offer. This derives the post-discovery
// readiness toward offer prep: cost placeholders (not amounts), what must be
// verified before any offer, the tighter comp requirement, strategy viability,
// deal killers, minimum-profit rules, and an offer-readiness state. Pure +
// deterministic over the persisted report + seller-fact summary. Never computes
// a binding offer; pre-discovery guidance stays preliminary.

import type { DealCardReportView } from './deal-card-report.js';
import type { SellerFactsSummary } from './seller-stated-facts.js';
import { GLOBAL_MIN_NET_PROFIT_USD, SUBDIVISION_MIN_NET_PROFIT_USD } from './offer-engine.js';

export type UnderwritingPrepState =
  | 'blocked'              // parcel not verified
  | 'needs_comps'         // verified but no source-backed valuation/comps
  | 'needs_verification'  // comps exist but facts still need official verification
  | 'ready_for_offer_prep'; // tightened DD satisfied -> offer prep can proceed

export interface UnderwritingPrep {
  state: UnderwritingPrepState;
  costPlaceholders: { hard: string[]; soft: string[] };
  verificationRequiredBeforeOffer: string[];
  tighterCompRequirement: string;
  strategyViability: { mostViable: string; note: string };
  dealKillers: string[];
  minimumProfitRules: string[];
  offerReadinessNote: string;
}

const HARD_COST_PLACEHOLDERS = ['Survey', 'Clearing / access improvement', 'Perc / septic', 'Driveway / culvert', 'Closing costs'];
const SOFT_COST_PLACEHOLDERS = ['Holding (taxes / insurance)', 'Title / legal', 'Marketing / resale', 'Financing / interest'];

const TIGHTER_COMP_REQUIREMENT =
  'Post-discovery requires source-backed SOLD comps (radius-based) before any binding offer. ' +
  'Pre-call preliminary ranges (40–60% formula) are not sufficient for an approved offer.';

/** Build the post-discovery underwriting prep. Placeholders only; no amounts are
 *  invented and no offer is computed. */
export function buildUnderwritingPrep(report: DealCardReportView, seller: SellerFactsSummary): UnderwritingPrep {
  const verificationRequiredBeforeOffer: string[] = [];
  // County items still outstanding must be confirmed before an offer.
  for (const c of report.countyVerificationChecklist) verificationRequiredBeforeOffer.push(c);
  // Seller-stated facts are negotiation context — each must be officially confirmed.
  for (const f of seller.riskFlags) verificationRequiredBeforeOffer.push(f);

  const dealKillers: string[] = report.riskFlags.filter((r) =>
    /landlock|no legal access|≥?\s*\d+%\s*wetlands|significant wetlands|significant fema|flood/i.test(r),
  );

  let state: UnderwritingPrepState;
  if (!report.parcelVerified) {
    state = 'blocked';
  } else if (/not ready|needs_verified_valuation|no comps|sparse/i.test(`${report.strategySummary} ${report.offerReadiness}`)) {
    state = 'needs_comps';
  } else if (verificationRequiredBeforeOffer.length > 0) {
    state = 'needs_verification';
  } else {
    state = 'ready_for_offer_prep';
  }

  const offerReadinessNote =
    state === 'blocked' ? 'Parcel not verified — no underwriting or offer until identity is confirmed.'
      : state === 'needs_comps' ? 'Establish source-backed sold comps and a verified valuation before offer math.'
        : state === 'needs_verification' ? 'Comps in hand, but official verification (county/title) is required before an offer.'
          : 'Tightened DD satisfied — proceed to offer prep (numbers still subject to final review).';

  return {
    state,
    costPlaceholders: { hard: [...HARD_COST_PLACEHOLDERS], soft: [...SOFT_COST_PLACEHOLDERS] },
    verificationRequiredBeforeOffer,
    tighterCompRequirement: TIGHTER_COMP_REQUIREMENT,
    strategyViability: {
      mostViable: report.mostViableStrategy || '(pending verified data)',
      note: report.parcelVerified ? 'Preliminary; confirm with verified comps + costs.' : 'Blocked until parcel verified.',
    },
    dealKillers,
    minimumProfitRules: [
      `Global minimum net profit: $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString()}.`,
      `Subdivision minimum net profit: $${SUBDIVISION_MIN_NET_PROFIT_USD.toLocaleString()}+ per project.`,
    ],
    offerReadinessNote,
  };
}
