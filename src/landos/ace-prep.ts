// Ace seller discovery prep. Generates dashboard-ready seller discovery
// QUESTIONS (never facts) from Duke's facts and gaps. Pure + deterministic.
// Seller-facing drafts only — nothing is sent; Tyler asks/sends.

export interface AceQuestion {
  category: string;
  question: string;
}

export interface AcePrep {
  status: 'ready' | 'preliminary';
  questions: AceQuestion[];
  note: string;
}

// Always-useful base seller discovery bank.
const BASE: AceQuestion[] = [
  { category: 'Access', question: 'Is there recorded, legal access to the property (deeded easement or public road frontage)?' },
  { category: 'Road maintenance', question: 'Is the access road public/state-maintained or private? Any road maintenance agreement?' },
  { category: 'Utilities', question: 'What utilities are available at the property (power, water/well, sewer/septic, gas, internet)?' },
  { category: 'Easements', question: 'Are there any easements, right-of-ways, or encroachments you are aware of?' },
  { category: 'Title / liens / taxes', question: 'Are property taxes current, and are there any liens, judgments, or back taxes?' },
  { category: 'Survey / boundaries', question: 'Is there a recent survey, and are the boundaries clearly marked/agreed with neighbors?' },
  { category: 'Structures / improvements', question: 'Are there any structures, improvements, wells, septic, or mobile homes on the property?' },
  { category: 'Reason for selling', question: 'What is prompting the decision to sell?' },
  { category: 'Timeline', question: 'How soon are you looking to sell, and is timing flexible?' },
  { category: 'Price expectations', question: 'Do you have a price in mind? (Seller-stated only — never a valuation basis.)' },
];

/**
 * Build Ace seller-discovery questions. Always returns the base bank plus
 * deal-specific questions derived from Duke red/anomaly flags and data gaps.
 * Verified parcel -> 'ready'; otherwise 'preliminary' (questions still useful).
 */
export function buildAcePrep(input: {
  parcelVerified: boolean;
  redFlags?: string[];
  anomalyFlags?: string[];
  dataGaps?: string[];
}): AcePrep {
  const questions: AceQuestion[] = [...BASE];
  const flags = [...(input.redFlags ?? []), ...(input.anomalyFlags ?? [])].join(' ').toLowerCase();
  const gaps = (input.dataGaps ?? []).join(' ').toLowerCase();

  if (flags.includes('landlocked') || flags.includes('access')) {
    questions.push({ category: 'Risk: access', question: 'Source flagged possible access concerns — can you confirm exactly how the property is reached and whether access is recorded?' });
  }
  if (flags.includes('wetland')) {
    questions.push({ category: 'Risk: wetlands', question: 'Are you aware of wetlands or any Army Corps / environmental determinations on the property?' });
  }
  if (flags.includes('fema') || flags.includes('flood')) {
    questions.push({ category: 'Risk: flood', question: 'Is any portion in a FEMA flood zone, and is there any flood history?' });
  }
  if (flags.includes('slope')) {
    questions.push({ category: 'Risk: terrain', question: 'How is the terrain — any steep areas, drainage, or grading issues?' });
  }
  if (flags.includes('structure') || flags.includes('improvement')) {
    questions.push({ category: 'Improvements', question: 'For any structures/mobile homes: age, condition, permits, and are they included in the sale?' });
  }
  if (gaps.includes('owner')) {
    questions.push({ category: 'Authority', question: 'Are you the sole owner of record, or are there other owners/heirs who must sign?' });
  }

  return {
    status: input.parcelVerified ? 'ready' : 'preliminary',
    questions,
    note: 'Seller discovery questions only — these are prompts to ask, not verified facts. Nothing is sent automatically.',
  };
}
