// Concise Visual Buyer narrative (projection layer).
//
// The retained multi-view Visual Buyer Analysis stays the internal record;
// this module composes the DEFAULT operator presentation from it: five
// compact buyer-oriented sections of one or two sentences each, with the
// detailed A–E material left to the collapsed supporting view. Satellite
// imagery drives the property narrative, Street View corrects and confirms
// it, and market commentary is limited to one closing sentence from LandOS
// Market Research. Nothing here rewrites the persisted analysis.
//
// Access terminology follows the discovery-stage operator rule: once road
// abutment evidence establishes legal access, unresolved-access phrasing is
// filtered out of the buyer-facing lines and the approved display form
// ("Legal access: Yes, via <road>") is used instead.

import type { VisualBuyerAnalysis } from './visual-buyer-analysis.js';
import { filterResolvedAccessLanguage } from './discovery-access-presentation.js';

export interface VisualBuyerNarrativeSection { title: string; body: string }

export interface VisualBuyerNarrativeView {
  sections: VisualBuyerNarrativeSection[];
  /** One-sentence market conclusion for the Overview summary panel. */
  overviewMarketLine: string | null;
}

export interface VisualBuyerNarrativeContext {
  /** "Yes, via Onionville Road" when discovery-stage legal access is present. */
  legalAccessDisplay: string | null;
  /** "Cleared grass path visible from …" or "Not confirmed from retained imagery". */
  apparentEntranceDisplay: string | null;
  /** LandOS Market Research interpretation (never LandPortal panels). */
  marketInterpretation: string | null;
}

const sentence = (value: string | null | undefined): string | null => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const firstSentence = (value: string | null | undefined): string | null => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : sentence(text);
};

export function buildVisualBuyerNarrative(
  analysis: VisualBuyerAnalysis | null,
  context: VisualBuyerNarrativeContext,
): VisualBuyerNarrativeView | null {
  if (!analysis) return null;
  const accessEstablished = !!context.legalAccessDisplay;
  const perspective = analysis.buyerPerspective;

  // 1 · Property appearance — the satellite-driven physical read.
  const structures = analysis.observedFeatures.find((item) => /structure/i.test(item.label));
  const appearance = [
    sentence(analysis.overviewSummary.physicalCharacter),
    structures ? firstSentence(structures.detail) : null,
  ].filter(Boolean).join(' ');

  // 2 · Buyer reaction — one practical first impression.
  const reaction = sentence(perspective.preliminaryImpression)
    ?? sentence(analysis.overviewSummary.mainBuyerAppeal)
    ?? '';

  // 3 · Strengths and concerns — corrected access terminology throughout.
  const advantages = filterResolvedAccessLanguage(perspective.strongestAdvantages, accessEstablished).slice(0, 3);
  const concerns = filterResolvedAccessLanguage(perspective.importantConcerns, accessEstablished)
    .filter((entry) => !accessEstablished || !/legal access|recorded instrument/i.test(entry));
  const accessLine = [
    context.legalAccessDisplay ? `Legal access: ${context.legalAccessDisplay}` : null,
    context.apparentEntranceDisplay ? `apparent entrance: ${context.apparentEntranceDisplay.charAt(0).toLowerCase()}${context.apparentEntranceDisplay.slice(1)}` : null,
  ].filter(Boolean).join('; ');
  const strengths = [
    advantages.length ? `Strongest: ${advantages.join('; ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}.` : null,
    concerns.length ? `Main concern: ${concerns[0].replace(/\.$/, '')}.` : null,
    accessLine ? `${accessLine}.` : null,
  ].filter(Boolean).join(' ');

  // 4 · Buyer fit.
  const weakerFit = filterResolvedAccessLanguage(perspective.weakerFitBuyers, accessEstablished)
    .filter((entry) => !accessEstablished || !/legal access/i.test(entry));
  const fit = [
    perspective.bestFitBuyers.length ? `Best fit: ${perspective.bestFitBuyers.join(', ').toLowerCase()}.` : null,
    weakerFit.length ? `Weaker fit: ${weakerFit.join(', ').toLowerCase()}.` : null,
  ].filter(Boolean).join(' ');

  // 5 · Property and market conclusion — property first, ONE market sentence.
  const marketLine = firstSentence(context.marketInterpretation);
  const conclusionProperty = sentence(analysis.overviewSummary.mainBuyerAppeal) ?? '';
  const conclusion = [conclusionProperty, marketLine].filter(Boolean).join(' ');

  return {
    sections: [
      { title: 'Property appearance', body: appearance },
      { title: 'Buyer reaction', body: reaction },
      { title: 'Strengths and concerns', body: strengths },
      { title: 'Buyer fit', body: fit },
      { title: 'Property and market conclusion', body: conclusion },
    ].filter((section) => section.body.trim().length > 0),
    overviewMarketLine: marketLine,
  };
}
