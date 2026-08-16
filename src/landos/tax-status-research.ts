// LandOS — property-tax payment status: one rule, one authority resolver.
//
// Whether the taxes are current or delinquent is an acquisition signal in both
// directions: delinquency is motivation and a closing cost, and "current" is a
// clean file. It is also the one tax fact an assessor usually does NOT publish —
// assessors carry the levy, collectors carry the payment. So the answer needs a
// SECOND office, and the jurisdiction decides which one that is.
//
// Hard rules:
//   - Never infer a standing. Only a labeled public field decides it.
//   - An office that was not reached is reported as the exact source attempted
//     plus its blocker, never as "not screened", which reads as "nobody looked".
//   - Pure and deterministic. No network here; callers do the retrieval.

import { officialSearchQuery } from './netr-routing.js';

/** How the retained public record answers the payment question. */
export type TaxStandingCode = 'current' | 'delinquent' | 'unresolved';

export interface TaxAuthority {
  /** The office this state's counties use to COLLECT property tax. */
  officeName: string;
  /** Operator-facing label naming the jurisdiction and the office. */
  label: string;
  /** An official-source search for that office, built by the shared rule. */
  searchUrl: string;
}

/**
 * The collecting office by state. Assessors levy; these offices take payment and
 * are therefore the ones that publish standing, unpaid years and tax-sale status.
 * Anything unlisted falls back to the generic pair, which is accurate everywhere
 * and still produces a usable official search.
 */
const STATE_TAX_OFFICE: Record<string, string> = {
  TN: 'County Trustee',
  TX: 'County Tax Assessor-Collector',
  GA: 'County Tax Commissioner',
  AL: 'County Revenue Commissioner',
  LA: 'Parish Sheriff and Ex-Officio Tax Collector',
  KY: 'County Sheriff (property tax)',
  AR: 'County Collector',
  MS: 'County Tax Collector',
  NC: 'County Tax Collector',
  FL: 'County Tax Collector',
  HI: 'County Real Property Tax Office',
};

const GENERIC_TAX_OFFICE = 'County Treasurer / Tax Collector';

const cleanCounty = (county?: string | null): string =>
  (county ?? '').trim().replace(/\s+county$/i, '').trim();

/**
 * Name the office that holds payment status for this jurisdiction, and the
 * official search that reaches it. Returns null with no state or county: an
 * unplaced subject has no collecting office to name, and inventing one would be
 * a fabricated source.
 */
export function taxAuthorityFor(input: {
  county?: string | null;
  state?: string | null;
}): TaxAuthority | null {
  const county = cleanCounty(input.county);
  const state = (input.state ?? '').trim().toUpperCase();
  if (!county && !state) return null;
  const officeName = (state.length === 2 ? STATE_TAX_OFFICE[state] : undefined) ?? GENERIC_TAX_OFFICE;
  // The office name already carries "County"; repeating it gives the operator
  // "Williamson County, TN County Trustee".
  const place = county && state ? `${county}, ${state}` : county || state;
  return {
    officeName,
    label: place ? `${officeName} (${place}) — property-tax payment status` : `${officeName} — property-tax payment status`,
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(officialSearchQuery('tax', county || undefined, state || undefined))}`,
  };
}

/** The exact tax fields a payment-status source is read for. */
export const TAX_STATUS_FIELDS = [
  'Property-tax standing',
  'Property-tax payment status',
  'Tax delinquency status',
  'Delinquent tax amount owed',
  'Unpaid property-tax years',
  'Tax delinquency began',
  'Tax penalties and interest',
  'Tax-sale status',
] as const;

function positiveMoney(value: string): boolean {
  const amount = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) && amount > 0;
}

/**
 * Decide standing from labeled public fields, and ONLY from them.
 *
 * `paymentStatus` is whatever the source labeled as tax/delinquency status;
 * `delinquentAmount` is the labeled amount owed. A zero owed balance is an
 * affirmative "current" — the source stated the number. Silence stays
 * unresolved: no standing is ever inferred from a levy amount, a tax year, or
 * the absence of a delinquency field.
 */
export function deriveTaxStanding(input: {
  paymentStatus?: string | null;
  delinquentAmount?: string | null;
}): TaxStandingCode {
  const status = (input.paymentStatus ?? '').trim();
  const amount = (input.delinquentAmount ?? '').trim();
  if (!status && !amount) return 'unresolved';
  const combined = `${status} ${amount}`.trim();
  const owedIsPositive = !!amount && positiveMoney(amount);
  const owedIsZero = !!amount && !positiveMoney(amount);
  // A NEGATED delinquency ("no delinquency", "not delinquent") is an
  // affirmative "current" and must be read before the delinquency match, or the
  // word "delinquency" inside the negation flips the answer.
  const negated = /\b(?:no|not|none|without|zero)\b[^.;]{0,20}?\b(?:delinquen\w*|past[- ]due|unpaid|back\s+tax(?:es)?|amount\s+owed)/i.test(combined);
  if (negated || owedIsZero) return 'current';
  if (/\b(?:delinquen\w*|unpaid|past[- ]due|back\s+tax|tax\s+sale)\b/i.test(combined) || owedIsPositive) return 'delinquent';
  if (/\b(?:current|paid(?:\s+in\s+full)?|cleared|satisfied)\b/i.test(combined)) return 'current';
  return 'unresolved';
}

export const TAX_STANDING_LABEL: Record<TaxStandingCode, string> = {
  current: 'Current — no delinquency shown by the public tax record',
  delinquent: 'Delinquent',
  unresolved: 'Not established by a public source',
};

/** One attempted payment-status source and what it actually returned. */
export interface TaxStatusSourceAttempt {
  source: string;
  url: string | null;
  /** What happened, in the source's own terms. */
  outcome: string;
  reached: boolean;
}

/** A retained source row, in the shape the inspection record keeps them. */
export interface RetainedSourceRow {
  provider: string;
  stage: string;
  status: string;
  note?: string | null;
  url?: string | null;
}

const TAX_SOURCE_RX = /tax|treasur|trustee|collector|revenue/i;
/** The county lane routes every office at once, so its failure blocks the tax office too. */
const COUNTY_LANE_RX = /county records browser/i;

/**
 * A source note is written for diagnostics and carries session housekeeping the
 * operator has no use for. The BLOCKER is the part that explains why the office
 * was not reached; the browser-cleanup tail is not part of it.
 */
function blockerText(note: string | null | undefined): string {
  return (note ?? '')
    .replace(/\[[^\]]*browser cleanup[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
}

/**
 * The payment-status sources this run actually touched, read from what it
 * retained. A source the run SCHEDULED and never reached is reported with its
 * blocker rather than dropped: "the tax office was never reached because county
 * routing failed" is an answer an operator can act on; silence is not.
 */
export function taxStatusAttemptsFromSources(sources: RetainedSourceRow[]): TaxStatusSourceAttempt[] {
  const attempts: TaxStatusSourceAttempt[] = [];
  // The blocker that stopped the whole county lane, when there was one. It is
  // the reason a scheduled tax office went unreached, so it travels with it.
  // ANY non-completing lane row carries a blocker: a lane starved of time is as
  // real an obstacle as a routing failure, and reporting only hard errors left
  // "scheduled but not reached" with no reason attached at all.
  const laneFailure = sources.find((source) =>
    COUNTY_LANE_RX.test(`${source.provider} ${source.stage}`)
    && !/used|retrieved/i.test(source.status)
    && !!blockerText(source.note));
  for (const source of sources) {
    const hay = `${source.provider} ${source.stage}`;
    if (!TAX_SOURCE_RX.test(hay)) continue;
    const reached = /used|retrieved|partial|fallback/i.test(source.status);
    const outcome = reached
      ? (blockerText(source.note) || `reached (${source.status})`)
      : source.status === 'not_attempted'
        ? `scheduled but not reached${blockerText(laneFailure?.note) ? `: ${blockerText(laneFailure?.note)}` : ''}`
        : (blockerText(source.note) || source.status.replace(/_/g, ' '));
    attempts.push({ source: source.provider, url: source.url ?? null, outcome, reached });
  }
  // A county lane that failed outright, with no tax row of its own to carry it.
  if (!attempts.length && laneFailure) {
    attempts.push({
      source: laneFailure.provider,
      url: laneFailure.url ?? null,
      outcome: blockerText(laneFailure.note) || laneFailure.status.replace(/_/g, ' '),
      reached: false,
    });
  }
  return attempts;
}

/** The operator-facing payment-status read. */
export interface TaxStatusRead {
  standing: TaxStandingCode;
  standingLabel: string;
  /** Populated only from labeled public fields. */
  paymentStatus: string | null;
  amountOwed: string | null;
  unpaidYears: string | null;
  delinquencySince: string | null;
  penaltiesInterest: string | null;
  taxSaleStatus: string | null;
  /** Every payment-status source this run actually tried. */
  attempts: TaxStatusSourceAttempt[];
  /** Where the answer came from, when there is one. */
  sourceLabel: string | null;
  sourceUrl: string | null;
  /** The collecting office for this jurisdiction, named even when unreached. */
  authorityOffice: string | null;
  authoritySearchUrl: string | null;
  /**
   * The one line the operator reads. When nothing resolved it names the exact
   * office attempted and the blocker — never a bare "not screened".
   */
  statement: string;
}

const text = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return raw && !/^(?:-|--|n\/?a|none|unknown)$/i.test(raw) ? raw : null;
};

/**
 * Build the payment-status read from whatever labeled fields the run retained,
 * plus the sources it actually attempted.
 */
export function buildTaxStatusRead(input: {
  /** Labeled public fields, keyed by their operator-facing label. */
  fields: Record<string, string | number | null | undefined>;
  attempts: TaxStatusSourceAttempt[];
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  /** Named so an unreached office can still be stated by name. */
  authority?: TaxAuthority | null;
}): TaxStatusRead {
  const field = (...labels: string[]): string | null => {
    for (const label of labels) {
      const value = text(input.fields[label]);
      if (value) return value;
    }
    return null;
  };
  const standingField = field('Property-tax standing');
  const paymentStatus = field('Property-tax payment status', 'Tax delinquency status');
  const amountOwed = field('Delinquent tax amount owed');
  const unpaidYears = field('Unpaid property-tax years');
  const delinquencySince = field('Tax delinquency began');
  const penaltiesInterest = field('Tax penalties and interest');
  const taxSaleStatus = field('Tax-sale status');

  // A already-derived standing wins; otherwise derive from the labeled fields.
  const standing: TaxStandingCode = standingField
    ? (/delinquent/i.test(standingField) ? 'delinquent' : /current|paid|no delinquen/i.test(standingField) ? 'current' : 'unresolved')
    : deriveTaxStanding({ paymentStatus, delinquentAmount: amountOwed });

  const attempts = input.attempts.filter((attempt, index, all) =>
    all.findIndex((candidate) => candidate.source === attempt.source && candidate.outcome === attempt.outcome) === index);

  let statement: string;
  if (standing === 'delinquent') {
    statement = [
      'Property taxes are DELINQUENT on the public tax record.',
      amountOwed ? `Amount owed ${amountOwed}.` : null,
      unpaidYears ? `Unpaid year(s): ${unpaidYears}.` : null,
      delinquencySince ? `Delinquent since ${delinquencySince}.` : null,
      penaltiesInterest ? `Penalties/interest ${penaltiesInterest}.` : null,
      taxSaleStatus ? `Tax-sale status: ${taxSaleStatus}.` : null,
    ].filter(Boolean).join(' ');
  } else if (standing === 'current') {
    statement = [
      'Property taxes are CURRENT: the public tax record shows no delinquency.',
      amountOwed ? `Amount owed ${amountOwed}.` : null,
      taxSaleStatus ? `Tax-sale status: ${taxSaleStatus}.` : null,
    ].filter(Boolean).join(' ');
  } else if (attempts.length) {
    // The honest unresolved case, and the two halves of it are different
    // answers. A source that was REACHED and published no payment field says
    // this jurisdiction does not put standing online — the operator should
    // call. A source that was never reached says the lookup still has to
    // happen. Collapsing them into one line hides which. "Not screened" is the
    // one thing this must never say when sources were in fact attempted.
    const reached = attempts.filter((attempt) => attempt.reached);
    const blocked = attempts.filter((attempt) => !attempt.reached);
    const detail = attempts.map((attempt) => `${attempt.source} — ${attempt.outcome}`).join('; ');
    const office = input.authority ? `the ${input.authority.officeName}` : 'the collecting office';
    statement = reached.length && !blocked.length
      ? `Payment status is not established: ${reached.length} official source(s) were reached and none published a payment status, unpaid year, or tax-sale field (${detail}). This jurisdiction may not publish standing online; ${office} holds it and can confirm it directly.`
      : `Payment status is not established. ${attempts.length} official source(s) attempted: ${detail}. The office that holds it is ${office}; reading its record directly is what settles this.`;
  } else if (input.authority) {
    statement = `Payment status is not established: no payment-status source has been reached for this parcel. The office that holds it is the ${input.authority.officeName}.`;
  } else {
    statement = 'Payment status is not established: the subject has no confirmed county and state, so no collecting office can be named.';
  }

  return {
    standing,
    standingLabel: TAX_STANDING_LABEL[standing],
    paymentStatus,
    amountOwed,
    unpaidYears,
    delinquencySince,
    penaltiesInterest,
    taxSaleStatus,
    attempts,
    sourceLabel: standing === 'unresolved' ? null : input.sourceLabel ?? null,
    sourceUrl: standing === 'unresolved' ? null : input.sourceUrl ?? null,
    authorityOffice: input.authority?.officeName ?? null,
    authoritySearchUrl: input.authority?.searchUrl ?? null,
    statement,
  };
}
