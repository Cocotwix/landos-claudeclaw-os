// Area and market intelligence read out of comparable listing descriptions.
//
// A provider write-up is the one place a human who stood on the ground says
// something about the AREA: that sewer is being extended, that the road is
// seasonal, that a subdivision went in next door, that lots are moving. None of
// it is retrievable from an assessor roll, and LandOS was discarding all of it
// with the marketing copy.
//
// The hard rule this module exists to enforce: a lead is a statement about the
// area made BY a named source about ANOTHER property, and it is never promoted
// into a fact about the subject. `comp-listing-summary.ts` already handles
// claims about the comp itself (well, septic, buildable); this handles claims
// about the surroundings, which apply to the subject only if something else
// independently establishes them.
//
// Every lead is verbatim. Nothing is paraphrased, inferred, or aggregated into
// a conclusion.

export type MarketLeadTopic =
  | 'utilities_expansion'
  | 'utilities_available'
  | 'restrictions'
  | 'nearby_development'
  | 'road_access'
  | 'buyer_demand'
  | 'planned_infrastructure';

export const MARKET_LEAD_TOPIC_LABELS: Readonly<Record<MarketLeadTopic, string>> = {
  utilities_expansion: 'Utility expansion',
  utilities_available: 'Utilities at the area',
  restrictions: 'Restrictions and covenants',
  nearby_development: 'Nearby development',
  road_access: 'Roads and access',
  buyer_demand: 'Buyer demand and market pace',
  planned_infrastructure: 'Planned infrastructure',
};

export interface CompMarketLead {
  topic: MarketLeadTopic;
  topicLabel: string;
  /** The provider's own sentence, verbatim and untrimmed of meaning. */
  excerpt: string;
  /** Which provider published it. */
  provider: string;
  /** The listing page it was published on, when the record retained one. */
  sourceUrl: string | null;
  /** The comparable whose write-up it came from — never the subject. */
  compKey: string;
  compLabel: string;
  /**
   * Always this value. A lead is an area signal from another property's
   * listing; treating it as established for the subject requires independent
   * support that this module does not and cannot provide.
   */
  status: 'unverified_area_lead';
  /** Operator-facing statement of what this is and is not. */
  note: string;
}

interface LeadPattern {
  topic: MarketLeadTopic;
  rx: RegExp;
}

// Deliberately narrow. A pattern earns its place by naming something an
// operator would act on; a generic adjective ("beautiful", "peaceful") is
// marketing noise and is not a lead.
const LEAD_PATTERNS: LeadPattern[] = [
  // Utilities being extended or brought in — the highest-value signal here,
  // because it changes what the area supports rather than what one lot has.
  {
    topic: 'utilities_expansion',
    rx: /\b(?:sewer|water|natural gas|electric(?:ity)?|fiber|broadband|internet)\b[^.!?]{0,80}\b(?:expansion|expanding|extension|extend(?:ed|ing)?|coming|being (?:run|brought|installed)|scheduled|planned|under construction|in progress)\b/i,
  },
  {
    topic: 'utilities_expansion',
    rx: /\b(?:expansion|extension|extend(?:ed|ing)?|coming soon|planned)\b[^.!?]{0,60}\b(?:sewer|water main|natural gas|public utilities|city services)\b/i,
  },
  // Utilities present in the area (weaker, still actionable).
  {
    topic: 'utilities_available',
    rx: /\b(?:public|city|county|municipal|community)\s+(?:sewer|water|utilities)\b|\butilities?\s+(?:are\s+)?(?:available|at the (?:road|street|lot line)|on site|nearby)\b/i,
  },
  // Restrictions, covenants, HOA, zoning limits on the area.
  {
    topic: 'restrictions',
    rx: /\b(?:deed[- ]restrict(?:ed|ions?)|restrictive covenants?|covenants?|HOA|homeowners?\s+association|POA|no mobile homes?|no manufactured|site[- ]built only|minimum (?:square footage|sq\s?ft|home size)|building restrictions?|architectural (?:review|control))\b/i,
  },
  // Development happening around the parcel.
  {
    topic: 'nearby_development',
    rx: /\b(?:new (?:subdivision|development|construction|homes?|community)|being developed|under development|recently developed|new neighborhood|lots? (?:are )?selling|adjacent (?:subdivision|development)|growth (?:area|corridor))\b/i,
  },
  // Road surface, maintenance, seasonal access — a real diligence driver.
  {
    topic: 'road_access',
    rx: /\b(?:gravel|dirt|paved|county[- ]maintained|state[- ]maintained|private (?:road|drive)|seasonal (?:road|access)|easement|right[- ]of[- ]way|road frontage|deeded access|unmaintained)\b/i,
  },
  // Explicit market-pace / demand statements.
  {
    topic: 'buyer_demand',
    rx: /\b(?:high demand|strong demand|selling (?:fast|quickly)|won'?t last|multiple offers|fast[- ]growing|rapidly growing|hot market|limited inventory|few remaining|last (?:lot|parcel)s? (?:available|left))\b/i,
  },
  // Roads, interchanges, schools, commercial anchors on the way.
  {
    topic: 'planned_infrastructure',
    rx: /\b(?:new|planned|proposed|upcoming)\b[^.!?]{0,60}\b(?:highway|interchange|bypass|school|hospital|shopping|retail center|industrial park|airport|bridge)\b/i,
  },
];

const NOTE = 'Stated in another property’s listing description. It is an area lead about the surrounding market, not an established fact about the subject, and nothing downstream treats it as one.';

/** Split into sentences without losing the terminator that ends each one. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);
}

export interface MarketLeadSource {
  compKey: string;
  compLabel: string;
  provider: string;
  sourceUrl: string | null;
  description: string | null | undefined;
}

/**
 * Read every area/market lead one comparable's description states.
 *
 * One lead per topic per comparable: a write-up that says "gravel road" three
 * times has made one point, and repeating it would inflate the operator's sense
 * of how much independent signal there is.
 */
export function extractCompMarketLeads(source: MarketLeadSource): CompMarketLead[] {
  const text = (source.description ?? '').trim();
  if (!text) return [];
  const lines = sentences(text);
  if (!lines.length) return [];

  const out: CompMarketLead[] = [];
  const claimedTopics = new Set<MarketLeadTopic>();
  // One sentence makes ONE point. "County sewer expansion is scheduled for this
  // road" reads as utility expansion, utilities present, and a road remark all
  // at once; listing it three times would triple the apparent amount of
  // independent area signal. Patterns are ordered strongest-first, so the
  // sentence is claimed by the most specific topic that matches it.
  const claimedSentences = new Set<string>();
  for (const { topic, rx } of LEAD_PATTERNS) {
    if (claimedTopics.has(topic)) continue;
    const hit = lines.find((sentence) => !claimedSentences.has(sentence) && rx.test(sentence));
    if (!hit) continue;
    claimedTopics.add(topic);
    claimedSentences.add(hit);
    out.push({
      topic,
      topicLabel: MARKET_LEAD_TOPIC_LABELS[topic],
      excerpt: hit,
      provider: source.provider,
      sourceUrl: source.sourceUrl,
      compKey: source.compKey,
      compLabel: source.compLabel,
      status: 'unverified_area_lead',
      note: NOTE,
    });
  }
  return out;
}

/**
 * Collect leads across every retained comparable, strongest topics first.
 *
 * Identical wording from two providers is ONE lead with both sources named,
 * because a syndicated description republished twice is one observation, not
 * two corroborating ones. Different wording on the same topic stays separate:
 * two write-ups independently mentioning sewer expansion is exactly the signal
 * an operator wants to see twice.
 */
export function collectMarketLeads(sources: MarketLeadSource[]): CompMarketLead[] {
  const byExcerpt = new Map<string, CompMarketLead>();
  for (const source of sources) {
    for (const lead of extractCompMarketLeads(source)) {
      const key = `${lead.topic}|${lead.excerpt.toLowerCase()}`;
      const existing = byExcerpt.get(key);
      if (!existing) { byExcerpt.set(key, lead); continue; }
      if (!existing.provider.split(' + ').includes(lead.provider)) {
        existing.provider = `${existing.provider} + ${lead.provider}`;
      }
    }
  }
  const order: MarketLeadTopic[] = [
    'utilities_expansion', 'planned_infrastructure', 'nearby_development',
    'restrictions', 'road_access', 'utilities_available', 'buyer_demand',
  ];
  return [...byExcerpt.values()].sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic));
}
