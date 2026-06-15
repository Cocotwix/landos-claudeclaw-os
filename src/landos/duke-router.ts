// Duke Capability Router — pure, deterministic, dependency-free.
//
// Duke is the due-diligence and comping operator, not only a LandPortal report
// bot. This router classifies a free-text Duke request into one capability
// route so Duke behaves consistently whether the request comes from chat,
// Mission Control, a property card, a batch job, or a future scheduled
// workflow. Classification only: it runs nothing, calls nothing, and never
// relaxes parcel-identity rules.

export const DUKE_ROUTES = [
  'parcel_fast_default',
  'parcel_verification_recovery',
  'land_comps',
  'manufactured_home_comps',
  'improved_property_land_home_review',
  'zoning_research',
  'subdivision_by_right_research',
  'ordinance_research',
  'utility_access_buildability',
  'batch_lead_intake',
  'general_due_diligence',
  'discovery_questions',
  'property_memory_lookup',
] as const;
export type DukeRoute = (typeof DUKE_ROUTES)[number];

export interface DukeRouteResult {
  route: DukeRoute;
  matched: string[];
  /** Other routes that also matched, in priority order. */
  alternates: DukeRoute[];
  reason: string;
}

interface Rule {
  route: DukeRoute;
  patterns: RegExp[];
}

// Address-like signal: a street number followed by words (used for batch
// detection and fast-default routing).
const ADDRESS_LINE = /\b\d{1,6}\s+[A-Za-z][A-Za-z0-9.\- ]{2,}\b/;

// Ordered most-specific to least-specific. The first rule with the most matches
// wins; ties break by this order.
const RULES: Rule[] = [
  {
    route: 'parcel_verification_recovery',
    patterns: [/\bnot\s+verified\b/i, /\bunverified\b/i, /\bverify\s+(the\s+)?parcel\b/i, /\bparcel\s+verification\b/i, /\btimed?\s*out\b/i, /\bzero\s+candidates?\b/i, /\baddress\s+mismatch\b/i, /\brecover(y)?\b/i],
  },
  {
    route: 'manufactured_home_comps',
    patterns: [/\bmanufactured\b/i, /\bmobile\s+home\b/i, /\bmanufactured\s+home\b/i, /\bsingle[\s-]?wide\b/i, /\bdouble[\s-]?wide\b/i, /\bHUD\s+tag\b/i],
  },
  {
    route: 'improved_property_land_home_review',
    patterns: [/\bland[\s-]?home\b/i, /\bimproved\s+propert/i, /\bvalue[\s-]?add\b/i, /\bstructure\s+present\b/i, /\bhouse\s+on\b/i, /\bteardown\b/i],
  },
  {
    route: 'subdivision_by_right_research',
    patterns: [/\bsubdivi/i, /\bsplit\s+the\s+(lot|parcel)\b/i, /\bby[\s-]?right\b/i, /\blot\s+split\b/i, /\bminimum\s+lot\s+size\b/i],
  },
  {
    route: 'zoning_research',
    patterns: [/\bzoning\b/i, /\bzoned\b/i, /\bland\s+use\s+code\b/i, /\bsetback/i, /\ballowed\s+use/i, /\brezone\b/i],
  },
  {
    route: 'ordinance_research',
    patterns: [/\bordinance\b/i, /\btownship\s+(rule|code)/i, /\bcounty\s+code\b/i, /\bmunicipal\s+code\b/i, /\bpermit\s+requirement/i],
  },
  {
    route: 'utility_access_buildability',
    patterns: [/\butilit/i, /\bwater\s+(and|&)?\s*sewer\b/i, /\bseptic\b/i, /\bwell\b/i, /\baccess\b/i, /\beasement\b/i, /\blandlocked\b/i, /\bbuildab/i, /\bfrontage\b/i, /\bperc\b/i],
  },
  {
    route: 'land_comps',
    patterns: [/\bcomps?\b/i, /\bcomparable/i, /\bprice\s+per\s+acre\b/i, /\bppa\b/i, /\bwhat'?s?\s+land\s+(worth|selling)/i, /\bsold\s+land\b/i, /\bmarket\s+value\b/i],
  },
  {
    route: 'discovery_questions',
    patterns: [/\bdiscovery\s+question/i, /\bquestions?\s+to\s+ask\b/i, /\bchecklist\b/i, /\bcall\s+script\b/i, /\bseller\s+questions?\b/i],
  },
  {
    route: 'property_memory_lookup',
    patterns: [/\bwhat\s+do\s+we\s+(know|have)\b/i, /\bpull\s+up\b/i, /\bprior\s+(work|report|notes?)\b/i, /\bproperty\s+card\b/i, /\blead\s+card\b/i, /\bremind\s+me\b/i, /\bhistory\s+(on|for)\b/i, /\bopen\s+(the\s+)?property\b/i],
  },
  {
    route: 'parcel_fast_default',
    patterns: [/\bfast\s+default\b/i, /\bdue\s+diligence\b/i, /\bDD\b/, /\bscore\s+this\b/i, /\brun\s+(this|the)\s+(address|parcel|property)\b/i, /\breport\s+on\b/i, /\bAPN\b/, /\bparcel\s+id\b/i],
  },
];

function countMatches(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/** Detect a batch of leads: multiple address-like lines, or explicit batch
 *  wording. Batch detection takes priority because it changes execution shape
 *  (one isolated job per lead). */
function looksLikeBatch(text: string): { batch: boolean; matched: string[] } {
  const matched: string[] = [];
  if (/\bbatch\b/i.test(text)) matched.push('batch');
  if (/\bthese\s+leads?\b/i.test(text)) matched.push('these leads');
  if (/\bmultiple\s+(leads?|propert|address)/i.test(text)) matched.push('multiple leads');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const addressLines = lines.filter((l) => ADDRESS_LINE.test(l));
  if (addressLines.length >= 2) matched.push(`${addressLines.length} address lines`);
  return { batch: matched.length > 0, matched };
}

/**
 * Route a Duke request to one capability. Deterministic. Default route is
 * general_due_diligence when nothing more specific matches.
 */
export function routeDukeRequest(input: string): DukeRouteResult {
  const text = (input ?? '').trim();
  if (!text) {
    return { route: 'general_due_diligence', matched: [], alternates: [], reason: 'Empty input.' };
  }

  const batch = looksLikeBatch(text);
  if (batch.batch) {
    return {
      route: 'batch_lead_intake',
      matched: batch.matched,
      alternates: [],
      reason: 'Multiple leads / batch wording detected; route each lead as an isolated job.',
    };
  }

  const scored = RULES
    .map((r) => ({ route: r.route, matched: countMatches(text, r.patterns) }))
    .filter((s) => s.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);

  if (scored.length === 0) {
    // Bare address with no other signal -> a Fast Default run.
    if (ADDRESS_LINE.test(text)) {
      return {
        route: 'parcel_fast_default',
        matched: ['address-like input'],
        alternates: [],
        reason: 'Single address-like input with no other route signal; run Fast Default.',
      };
    }
    return {
      route: 'general_due_diligence',
      matched: [],
      alternates: [],
      reason: 'No specific capability signal; treat as a general due-diligence question.',
    };
  }

  const top = scored[0];
  return {
    route: top.route,
    matched: top.matched,
    alternates: scored.slice(1).map((s) => s.route),
    reason: `Matched ${top.matched.length} signal(s) for ${top.route}.`,
  };
}
