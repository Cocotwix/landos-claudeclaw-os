// LandOS — Discovery Call Preparation briefing.
//
// Turns the persisted Deal Card report + readiness + seller-stated facts into a
// real operator briefing for a seller discovery call: known facts, biggest
// unknowns, questions to ask, warnings, risks, and follow-up priorities. Pure +
// deterministic; never fabricates — it only organizes what is already known and
// names what is not. Reads like an acquisition manager prepared it.

import type { DealCardReportView } from './deal-card-report.js';
import type { DealCardReadiness } from './deal-card-readiness.js';
import type { SellerFactsSummary, SellerFactKind } from './seller-stated-facts.js';

export interface DiscoveryBriefing {
  knownFacts: string[];
  biggestUnknowns: string[];
  questionsToAsk: string[];
  warnings: string[];
  risks: string[];
  followUpPriorities: string[];
}

/** Standard discovery questions per seller-fact area (asked when not yet captured). */
const SELLER_QUESTIONS: Record<SellerFactKind, string> = {
  access: 'How do you get to the property — is there a recorded easement or road frontage?',
  easement: 'Are there any easements (utility, access, or otherwise) on the property?',
  utilities: 'Are utilities available at the property — power, water, sewer, or is it septic/well?',
  road_maintenance: 'Is the road maintained by the county, or privately?',
  survey: 'Has the property ever been surveyed?',
  perc_septic: 'Has a perc test ever been done, or is there a septic system?',
  liens: 'Are there any liens, back taxes, or a mortgage on the property?',
  taxes_owed: 'Are the property taxes current, or is anything owed?',
  family_decision_makers: 'Is anyone else involved in the decision to sell?',
  price_expectation: 'Do you have a price in mind for the property?',
  timeline: 'What is your timeline — how soon are you looking to sell?',
  property_history: 'How long have you owned it, and how did you come to own it?',
  known_restrictions: 'Are there any deed restrictions, covenants, or HOA you are aware of?',
  improvements: 'Have any improvements been made — clearing, driveway, well, etc.?',
  structures_mobile_homes: 'Are there any structures, mobile homes, or debris on the land?',
};

const CORE_KINDS: SellerFactKind[] = ['timeline', 'price_expectation', 'family_decision_makers', 'access', 'utilities', 'liens'];

/** Build the operator briefing. Pure over the report + readiness + seller facts. */
export function buildDiscoveryBriefing(
  report: DealCardReportView,
  readiness: DealCardReadiness,
  seller: SellerFactsSummary,
): DiscoveryBriefing {
  // Known facts: verified DD facts (with source) + verified parcel identity.
  const knownFacts: string[] = [];
  if (report.parcelVerified) knownFacts.push(`Parcel verified — ${report.parcelVerificationStatus}.`);
  for (const row of report.ddFactChecklist) {
    if (row.status === 'verified' && row.value) knownFacts.push(`${row.label}: ${row.value} (Verified${row.source ? ` · ${row.source}` : ''}).`);
  }
  for (const k of seller.kinds) knownFacts.push(`Seller-stated ${k.replace(/_/g, ' ')} (not verified).`);
  if (knownFacts.length === 0) knownFacts.push('No verified facts yet — treat as Local Area Context until parcel identity is confirmed.');

  // Biggest unknowns: missing DD facts (provider-fillable) first.
  const biggestUnknowns: string[] = [...readiness.topMissingDdFacts.map((f) => `${f}: Unknown / Needs Verification.`)];
  if (!report.parcelVerified) biggestUnknowns.unshift('Parcel identity is not verified yet.');

  // Questions to ask: standard discovery questions for areas NOT yet seller-stated.
  const captured = new Set(seller.kinds);
  const questionsToAsk: string[] = [];
  questionsToAsk.push('What has you thinking about selling? (motivation)');
  for (const k of CORE_KINDS) if (!captured.has(k)) questionsToAsk.push(SELLER_QUESTIONS[k]);
  for (const k of Object.keys(SELLER_QUESTIONS) as SellerFactKind[]) {
    if (!CORE_KINDS.includes(k) && !captured.has(k)) questionsToAsk.push(SELLER_QUESTIONS[k]);
  }

  // Warnings + risks.
  const warnings: string[] = [];
  if (!report.parcelVerified) warnings.push('Do NOT present any number — parcel is not verified; this is local-area context only.');
  warnings.push('All seller answers are Seller-stated until officially verified. Never treat them as confirmed facts.');
  const risks: string[] = [...readiness.topRiskFlags];
  if (risks.length === 0) risks.push('No risk flags recorded yet (absence of data, not a clean bill — verify the unknowns).');

  // Follow-up priorities: the next-best action + outstanding county verification.
  const followUpPriorities: string[] = [`Next best action: ${readiness.nextBestAction.label} — ${readiness.nextBestAction.reason}`];
  for (const c of report.countyVerificationChecklist.slice(0, 4)) followUpPriorities.push(c);

  return { knownFacts, biggestUnknowns, questionsToAsk, warnings, risks, followUpPriorities };
}

/** Render the briefing as a polished Markdown section (operator report). */
export function renderDiscoveryBriefingMarkdown(b: DiscoveryBriefing): string[] {
  const L: string[] = [];
  const block = (title: string, items: string[]) => {
    L.push(`\n### ${title}`);
    L.push(items.length ? items.map((x) => `- ${x}`).join('\n') : '- (none)');
  };
  block('What we already know', b.knownFacts);
  block('Biggest unknowns', b.biggestUnknowns);
  block('Questions to ask the seller', b.questionsToAsk);
  block('Warnings', b.warnings);
  block('Risks', b.risks);
  block('Follow-up priorities', b.followUpPriorities);
  return L;
}
