// Comparable transaction price: what LandOS is allowed to call a sale price.
//
// The normal rule is absolute. When a verified closed sale price exists, it is
// the ONLY figure used for sold-price math and the only one displayed as a sale
// price. The final asking price before closing is never substituted for it and
// never emphasised; it stays inside the listing timeline where it belongs.
//
// The single exception is a genuine non-disclosure state, where the closed price
// is not a public record at all. There — and only there — the last verified
// asking price at the moment the listing went pending may stand in as an
// ESTIMATED proxy. A proxy is labeled as a proxy everywhere, carries reduced
// transaction-price confidence, and is never called a sold price, a verified
// sale price, a closed price, or a confirmed price per acre.
//
// Two guards keep the exception honest:
//
//   1. The state's disclosure status must be VERIFIED against the regulatory
//      registry below, which records the authority for each entry. A state that
//      is not in the registry is 'unverified' and the proxy is refused. LandOS
//      never assumes a state is non-disclosure.
//   2. The source must actually be missing a closed price. A proxy may never
//      displace a price the record already has.
//
// When neither a verified closed price nor a permitted proxy exists, the record
// is retained as market context and blocked from the cleaned sold-price
// valuation, with the missing evidence stated plainly.

export type StateDisclosureStatus = 'disclosure' | 'nondisclosure' | 'unverified';

export interface StateDisclosureRule {
  state: string;
  status: 'disclosure' | 'nondisclosure';
  /** The regulatory authority this classification rests on. Never a guess. */
  authority: string;
}

/**
 * Regulatory registry of state sale-price disclosure rules.
 *
 * Each entry names the statutory or agency authority that establishes whether
 * consideration is a public record. Only the twelve widely-recognised
 * non-disclosure states are asserted; disclosure states are asserted only where
 * the recording authority is recorded here. Anything absent resolves to
 * 'unverified', which BLOCKS the proxy.
 */
export const STATE_PRICE_DISCLOSURE_RULES: readonly StateDisclosureRule[] = [
  { state: 'AK', status: 'nondisclosure', authority: 'Alaska recording statutes require no statement of consideration; sale price is not a public record.' },
  { state: 'ID', status: 'nondisclosure', authority: 'Idaho Code §63-301A — sale prices are not disclosed to assessors or the public.' },
  { state: 'KS', status: 'nondisclosure', authority: 'Kansas sales-validation questionnaires are confidential under K.S.A. 79-1437e.' },
  { state: 'LA', status: 'nondisclosure', authority: 'Louisiana records the act of sale; consideration disclosure is not uniformly required statewide.' },
  { state: 'MS', status: 'nondisclosure', authority: 'Mississippi deeds are recorded without a required statement of consideration.' },
  { state: 'MO', status: 'nondisclosure', authority: 'Missouri has no statutory sale-price disclosure requirement on recorded deeds.' },
  { state: 'MT', status: 'nondisclosure', authority: 'Montana realty transfer certificates are confidential under Mont. Code Ann. §15-7-308.' },
  { state: 'NM', status: 'nondisclosure', authority: 'New Mexico affidavits of value are confidential under NMSA §7-38-12.1.' },
  { state: 'ND', status: 'nondisclosure', authority: 'North Dakota does not require consideration on recorded deeds.' },
  { state: 'TX', status: 'nondisclosure', authority: 'Texas has no sale-price disclosure requirement; consideration is not recorded.' },
  { state: 'UT', status: 'nondisclosure', authority: 'Utah sale prices collected by assessors are not public under Utah Code §59-2-1303.' },
  { state: 'WY', status: 'nondisclosure', authority: 'Wyoming statements of consideration are confidential under W.S. §34-1-142.' },
  { state: 'NY', status: 'disclosure', authority: 'New York RP-5217 real property transfer reports state consideration and are public record.' },
  { state: 'CA', status: 'disclosure', authority: 'California documentary transfer tax is recorded on the deed and is public record.' },
  { state: 'FL', status: 'disclosure', authority: 'Florida documentary stamp tax is recorded on the deed and is public record.' },
  { state: 'PA', status: 'disclosure', authority: 'Pennsylvania realty transfer tax statements of value are public record.' },
  { state: 'OH', status: 'disclosure', authority: 'Ohio conveyance fee statements (DTE 100) state consideration and are public record.' },
  { state: 'MI', status: 'disclosure', authority: 'Michigan property transfer affidavits state the sale price and are public record.' },
  { state: 'NC', status: 'disclosure', authority: 'North Carolina excise tax stamps on recorded deeds disclose consideration.' },
  { state: 'GA', status: 'disclosure', authority: 'Georgia PT-61 real estate transfer tax forms state consideration and are public record.' },
  { state: 'TN', status: 'disclosure', authority: 'Tennessee recording tax is assessed on stated consideration, which is public record.' },
  { state: 'AZ', status: 'disclosure', authority: 'Arizona affidavits of property value are recorded and publicly available.' },
];

const RULE_BY_STATE = new Map(STATE_PRICE_DISCLOSURE_RULES.map((r) => [r.state, r]));

export interface StateDisclosureVerdict {
  state: string | null;
  status: StateDisclosureStatus;
  authority: string | null;
  note: string;
}

/** Look the state up in the regulatory registry. Unlisted states stay unverified. */
export function verifyStateDisclosure(stateRaw: string | null | undefined): StateDisclosureVerdict {
  const state = (stateRaw ?? '').trim().toUpperCase();
  if (!state) {
    return { state: null, status: 'unverified', authority: null, note: 'No state is recorded for this comparable, so its sale-price disclosure rule cannot be verified.' };
  }
  const rule = RULE_BY_STATE.get(state);
  if (!rule) {
    return {
      state,
      status: 'unverified',
      authority: null,
      note: `${state} is not in the verified sale-price disclosure registry, so LandOS will not assume its disclosure status. A pending-price proxy is not permitted.`,
    };
  }
  return {
    state,
    status: rule.status,
    authority: rule.authority,
    note: rule.status === 'nondisclosure'
      ? `${state} is a verified non-disclosure state: ${rule.authority}`
      : `${state} is a verified disclosure state: ${rule.authority}`,
  };
}

export type CompPriceBasis = 'verified_sale' | 'pending_proxy' | 'none';
export type CompPriceConfidence = 'verified' | 'estimated_proxy' | 'unavailable';

export interface CompTransactionPriceInput {
  /** The closed price the source actually documented. Wins whenever present. */
  verifiedSoldPrice: number | null;
  soldDateIso: string | null;
  /** Last verified ASKING price at the moment the listing changed to pending. */
  lastAskingPriceAtPending?: number | null;
  pendingDateIso?: string | null;
  /** Two-letter state of the comparable. */
  state: string | null;
  acres: number | null;
  /** Evidence that the source genuinely does not publish a closed price. */
  sourceProvidesClosedPrice?: boolean;
}

export interface CompTransactionPrice {
  basis: CompPriceBasis;
  price: number | null;
  pricePerAcre: number | null;
  /** What the figure must be CALLED on screen. Never "sold price" for a proxy. */
  priceLabel: string;
  ppaLabel: string;
  confidence: CompPriceConfidence;
  /** May this price enter the cleaned sold-price valuation? */
  usableForValuation: boolean;
  disclosure: StateDisclosureVerdict;
  /** Operator-facing sentences, every one backed by the inputs above. */
  lines: string[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Decide which price — if any — may represent this comparable's transaction.
 *
 * Priority is fixed: a verified closed price always wins; a pending proxy is
 * reachable only through a verified non-disclosure state with no closed price
 * available; otherwise there is no transaction price and the record cannot
 * price the subject.
 */
export function resolveCompTransactionPrice(input: CompTransactionPriceInput): CompTransactionPrice {
  const disclosure = verifyStateDisclosure(input.state);
  const acres = typeof input.acres === 'number' && input.acres > 0 ? input.acres : null;
  const ppa = (price: number) => (acres != null ? Math.round((price / acres) * 100) / 100 : null);

  const sold = typeof input.verifiedSoldPrice === 'number' && input.verifiedSoldPrice > 0
    ? input.verifiedSoldPrice
    : null;

  if (sold != null) {
    return {
      basis: 'verified_sale',
      price: sold,
      pricePerAcre: ppa(sold),
      priceLabel: 'Verified sold price',
      ppaLabel: 'Verified sold price per acre',
      confidence: 'verified',
      usableForValuation: true,
      disclosure,
      lines: [
        `Verified closed sale price of ${money(sold)}${input.soldDateIso ? ` recorded ${input.soldDateIso}` : ''}. The final asking price before closing is not substituted for it and is shown only inside the listing timeline.`,
      ],
    };
  }

  const pending = typeof input.lastAskingPriceAtPending === 'number' && input.lastAskingPriceAtPending > 0
    ? input.lastAskingPriceAtPending
    : null;

  // The proxy is gated on all three conditions, in order.
  if (disclosure.status === 'nondisclosure' && input.sourceProvidesClosedPrice !== true && pending != null) {
    return {
      basis: 'pending_proxy',
      price: pending,
      pricePerAcre: ppa(pending),
      priceLabel: 'Estimated sale price proxy',
      ppaLabel: 'Estimated price per acre based on pending price proxy',
      confidence: 'estimated_proxy',
      usableForValuation: true,
      disclosure,
      lines: [
        `Estimated sale price proxy: ${money(pending)}.`,
        `Last verified asking price when the property changed to pending${input.pendingDateIso ? ` on ${input.pendingDateIso}` : ''}.`,
        'Closed sale price was not publicly disclosed.',
        disclosure.note,
        'This is an estimate, not a verified sale. Its transaction price confidence is reduced below that of a verified closed sale.',
      ],
    };
  }

  const why: string[] = ['No verified closed sale price is available for this record.'];
  if (pending != null && disclosure.status !== 'nondisclosure') {
    why.push(`A pending asking price of ${money(pending)} exists, but ${disclosure.status === 'unverified'
      ? 'the state disclosure rule is not verified'
      : `${disclosure.state} is a verified disclosure state`}, so it may not stand in as a sale price proxy.`);
    why.push(disclosure.note);
  } else if (pending == null && disclosure.status === 'nondisclosure') {
    why.push('No last verified asking price at pending is available either, so the non-disclosure proxy cannot be applied.');
  }
  why.push('The record is retained as market context and is blocked from the cleaned sold-price valuation.');

  return {
    basis: 'none',
    price: null,
    pricePerAcre: null,
    priceLabel: 'Transaction price unavailable',
    ppaLabel: 'Price per acre unavailable',
    confidence: 'unavailable',
    usableForValuation: false,
    disclosure,
    lines: why,
  };
}

/** Short chip text for the card / popup, e.g. "Verified sale" or "Estimated proxy". */
export const TRANSACTION_CONFIDENCE_LABEL: Readonly<Record<CompPriceConfidence, string>> = {
  verified: 'Verified sale price',
  estimated_proxy: 'Estimated price proxy — reduced confidence',
  unavailable: 'No verified transaction price',
};
