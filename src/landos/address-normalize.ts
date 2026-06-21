// LandOS address normalization + typo-aware correction candidates.
//
// Deterministic, dictionary-free text logic that (a) normalizes an address to a
// canonical form for matching, and (b) generates a BOUNDED, ranked set of likely
// lookup candidates for human typos. Correction is ONLY a search aid — it never
// verifies a parcel; a candidate is "validated" only when a returned named-source
// record uniquely supports it (set by the resolver). Pure + deterministic.

export interface AddressCorrectionCandidate {
  /** The exact original submitted text (preserved). */
  original: string;
  /** The corrected lookup candidate to try against LandPortal. */
  corrected: string;
  /** Human reason for the correction. */
  reason: string;
  /** 0..1 confidence; higher = more likely a real typo fix. */
  confidence: number;
  /** Set by the resolver when a named-source record uniquely supported it. */
  validatedBySource?: boolean;
}

// Street-suffix + directional normalization tables.
const SUFFIX: Record<string, string> = {
  STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', ROAD: 'RD', RD: 'RD', DRIVE: 'DR', DR: 'DR',
  LANE: 'LN', LN: 'LN', COURT: 'CT', CT: 'CT', BOULEVARD: 'BLVD', BLVD: 'BLVD', HIGHWAY: 'HWY', HWY: 'HWY',
  CIRCLE: 'CIR', CIR: 'CIR', PLACE: 'PL', PL: 'PL', TERRACE: 'TER', TER: 'TER', TRAIL: 'TRL', TRL: 'TRL',
  PARKWAY: 'PKWY', PKWY: 'PKWY', WAY: 'WAY',
};
const DIRECTIONAL: Record<string, string> = {
  NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S', EAST: 'E', E: 'E', WEST: 'W', W: 'W',
  NORTHEAST: 'NE', NE: 'NE', NORTHWEST: 'NW', NW: 'NW', SOUTHEAST: 'SE', SE: 'SE', SOUTHWEST: 'SW', SW: 'SW',
};
// QWERTY adjacency for keyboard-typo scoring.
const KEYBOARD: Record<string, string> = {
  q: 'wa', w: 'qeas', e: 'wrd', r: 'etf', t: 'ryg', y: 'tuh', u: 'yij', i: 'uok', o: 'ipl', p: 'o',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm',
  l: 'kop', z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

function isKeyboardAdjacent(a: string, b: string): boolean {
  return (KEYBOARD[a.toLowerCase()] ?? '').includes(b.toLowerCase());
}

/** Canonical address form for matching: uppercase, single-spaced, no stray
 *  punctuation, normalized directional + suffix tokens. Pure. */
export function normalizeAddress(raw: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  const out = words.map((w, i) => {
    // Suffix normalization only past the first word (never the house number).
    if (i > 0 && SUFFIX[w]) return SUFFIX[w];
    // Directional normalization ONLY in a true directional position: a PREFIX
    // (followed by another non-suffix street word, e.g. "NORTH MAIN ST") or a
    // trailing directional (last word, preceded by street words, e.g. "MAIN ST NW").
    // A directional word that is itself the street name ("WEST RD") is preserved.
    if (DIRECTIONAL[w]) {
      const next = words[i + 1];
      const isPrefixDir = i > 0 && next != null && !SUFFIX[next];
      const isTrailingDir = i === words.length - 1 && i >= 2;
      if (isPrefixDir || isTrailingDir) return DIRECTIONAL[w];
    }
    return w;
  });
  return out.join(' ');
}

/** Clean a ZIP to a 5-digit form (or '' when not derivable). */
export function normalizeZip(raw?: string): string {
  const m = (raw ?? '').match(/\d{5}/);
  return m ? m[0] : '';
}

function isStructural(token: string): boolean {
  return /^\d/.test(token) || !!SUFFIX[token] || !!DIRECTIONAL[token] || token.length < 3;
}

/** Generate edit-1 (+doubled-letter) variants of a single alphabetic token with
 *  a confidence per operation. Bounded by token length. */
function tokenVariants(token: string): Array<{ variant: string; reason: string; confidence: number }> {
  const t = token.toUpperCase();
  const out: Array<{ variant: string; reason: string; confidence: number }> = [];
  const seen = new Set<string>();
  const push = (variant: string, reason: string, confidence: number) => {
    if (variant === t || variant.length < 2 || seen.has(variant)) return;
    seen.add(variant); out.push({ variant, reason, confidence });
  };
  // Deletion (a dropped/extra char). Boost when the removed char is keyboard-
  // adjacent to a neighbor (a stray fat-finger key).
  for (let i = 0; i < t.length; i++) {
    const removed = t[i];
    const neighbor = t[i - 1] ?? t[i + 1] ?? '';
    const adj = neighbor && isKeyboardAdjacent(removed, neighbor);
    push(t.slice(0, i) + t.slice(i + 1), `removed likely stray '${removed}'`, adj ? 0.82 : 0.6);
  }
  // Transposition.
  for (let i = 0; i < t.length - 1; i++) {
    push(t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2), `transposed '${t[i]}${t[i + 1]}'`, 0.78);
  }
  // Keyboard-adjacent substitution (most likely real typo).
  for (let i = 0; i < t.length; i++) {
    for (const r of (KEYBOARD[t[i].toLowerCase()] ?? '')) {
      push(t.slice(0, i) + r.toUpperCase() + t.slice(i + 1), `keyboard-adjacent '${t[i]}'->'${r.toUpperCase()}'`, 0.8);
    }
  }
  // Doubled-letter insertion (a missing doubled letter — common, meaningful edit).
  for (let i = 0; i < t.length; i++) {
    push(t.slice(0, i + 1) + t[i] + t.slice(i + 1), `doubled '${t[i]}'`, 0.7);
  }
  return out;
}

export interface CorrectionOptions {
  /** Max candidates returned (including the normalized form). Default 5. */
  cap?: number;
}

/**
 * Produce a BOUNDED, ranked set of lookup candidates for a raw address. The first
 * is always the normalized form (a safe canonicalization, confidence 1.0). The
 * rest are single-token typo corrections, ranked by confidence and capped to the
 * top-N. Each candidate preserves the original, the corrected string, a reason,
 * and a confidence. Correction never verifies — only a named-source match does.
 */
export function correctionCandidates(raw: string, opts: CorrectionOptions = {}): AddressCorrectionCandidate[] {
  const cap = Math.max(1, opts.cap ?? 5);
  const original = raw ?? '';
  const normalized = normalizeAddress(original);
  const candidates: AddressCorrectionCandidate[] = [];
  const seen = new Set<string>();
  const add = (corrected: string, reason: string, confidence: number) => {
    const key = corrected.toUpperCase();
    if (!corrected || seen.has(key)) return;
    seen.add(key);
    candidates.push({ original, corrected, reason, confidence });
  };

  // 1. Normalized canonical form (always first).
  if (normalized) add(normalized, 'normalized whitespace/case/suffix/directional', 1.0);

  // 2. Single-token typo corrections over the normalized tokens.
  const tokens = normalized.split(' ').filter(Boolean);
  const typo: AddressCorrectionCandidate[] = [];
  for (let ti = 0; ti < tokens.length; ti++) {
    if (isStructural(tokens[ti])) continue;
    for (const v of tokenVariants(tokens[ti])) {
      const rebuilt = [...tokens.slice(0, ti), v.variant, ...tokens.slice(ti + 1)].join(' ');
      const key = rebuilt.toUpperCase();
      if (rebuilt === normalized || seen.has(key) || typo.some((c) => c.corrected.toUpperCase() === key)) continue;
      typo.push({ original, corrected: rebuilt, reason: `${v.reason} in "${tokens[ti]}"`, confidence: v.confidence });
    }
  }
  typo.sort((a, b) => b.confidence - a.confidence);
  for (const c of typo) {
    if (candidates.length >= cap) break;
    add(c.corrected, c.reason, c.confidence);
  }

  return candidates.slice(0, cap);
}
