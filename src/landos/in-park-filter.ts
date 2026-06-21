// LandOS in-park exclusion filter (manufactured-home comps).
//
// Manufactured-home sales only support land valuation when the home sits on
// OWNED land. Homes in a manufactured-home community (lot rent / HOA / land
// lease) are NOT land comps and must be EXCLUDED.
//
// HARD RULES:
//   - HOA / lot-rent / land-lease  -> EXCLUDE (it is not owned land).
//   - Text affirms owned land       -> KEEP.
//   - Ambiguous                     -> EXCLUDE (conservative; never assume owned).
//   - lotSize is a WEAK signal only — it can support, never decide.
//   - The manufactured propertyType int is NOT in the validated fixture. We do
//     NOT guess it. When a comp's manufactured status cannot be confirmed from a
//     verified property-type code, the gate FAILS LOUD instead of mis-classifying.
//   - Gemma is NORMALIZER ONLY: it reads description text into a structured
//     classification. It never invents a price and never blocks (degrades to the
//     deterministic keyword scan). Every real Gemma call is logged to
//     landos_model_call (the actual model), never with credentials.

import {
  REDFIN_PROPERTY_TYPE,
  REDFIN_MANUFACTURED_PROPERTY_TYPE,
  type DetailComp,
} from './providers/apify-comp-provider.js';

export type InParkDecision = 'keep_owned_land' | 'exclude_in_park' | 'exclude_ambiguous' | 'fail_loud_unverified_type';

export interface InParkResult {
  decision: InParkDecision;
  /** True only for keep_owned_land — safe to use as a land-supporting comp. */
  keep: boolean;
  /** True when the manufactured-type gate could not be confirmed (fail loud). */
  failLoud: boolean;
  reason: string;
  signals: {
    hoaOrLotRent: boolean;
    ownedLandAffirmed: boolean;
    lotSizeAcres: number | null;
    usedGemma: boolean;
  };
}

/** Structured classification a normalizer (Gemma or the deterministic scan)
 *  produces from description text. NEVER contains a price. */
export interface InParkClassification {
  hoaOrLotRent: boolean;
  ownedLandAffirmed: boolean;
  /** 0..1; deterministic scan reports modest confidence. */
  confidence: number;
}

/** Gemma normalizer boundary (injected). Returns null to DEGRADE to the
 *  deterministic scan (deterministic_only mode / unreachable). Never throws out;
 *  the caller treats a throw as a degrade. */
export interface InParkNormalizer {
  classify(text: string): Promise<InParkClassification | null>;
}

/** Model-call logger boundary (injected). Records the FACT of a Gemma call with
 *  the actual model — never credentials. */
export interface ModelCallLogger {
  log(opts: { provider: string; model: string; taskClass: string; workflow?: string }): void;
}

// Deterministic keyword signals. Lower-cased substring scan — no LLM, no network.
const HOA_LOT_RENT_TERMS = [
  'lot rent', 'lot-rent', 'land lease', 'land-lease', 'leased land', 'lease land',
  'hoa', 'lot fee', 'space rent', 'pad rent', 'mobile home park', 'manufactured home community',
  'community fee', 'monthly lot', 'rent the land', 'land not included', 'leasehold',
];
const OWNED_LAND_TERMS = [
  'owned land', 'land owned', 'you own the land', 'own the land', 'land included',
  'deeded lot', 'deeded land', 'on its own land', 'real property', 'fee simple',
  'land and home', 'home and land', 'permanent foundation on owned',
];

const WEAK_OWNED_LOT_ACRE_HINT = 1; // a >=1ac lot weakly leans owned, never decides

/** Pure deterministic text scan -> classification. The always-available baseline. */
export function deterministicInParkScan(text: string): InParkClassification {
  const t = (text || '').toLowerCase();
  const hoaOrLotRent = HOA_LOT_RENT_TERMS.some((k) => t.includes(k));
  const ownedLandAffirmed = OWNED_LAND_TERMS.some((k) => t.includes(k));
  // Confidence is modest: keyword presence, not understanding.
  const confidence = hoaOrLotRent || ownedLandAffirmed ? 0.6 : 0.2;
  return { hoaOrLotRent, ownedLandAffirmed, confidence };
}

/**
 * Classify whether a comp is a manufactured-home record we can reason about.
 *   land           -> propertyType 8 (Land/Vacant)
 *   residential    -> propertyType 6 (single-family house)
 *   manufactured?  -> the manufactured code is UNVERIFIED (null) -> we cannot
 *                     confirm it, so manufactured handling FAILS LOUD.
 * Pure. Never guesses the manufactured code.
 */
export function manufacturedTypeGate(propertyTypeCode: number | null): 'land' | 'residential' | 'unverified_manufactured' {
  if (propertyTypeCode === REDFIN_PROPERTY_TYPE.LAND) return 'land';
  if (propertyTypeCode === REDFIN_PROPERTY_TYPE.SINGLE_FAMILY) return 'residential';
  if (REDFIN_MANUFACTURED_PROPERTY_TYPE !== null && propertyTypeCode === REDFIN_MANUFACTURED_PROPERTY_TYPE) {
    // Only reachable once the manufactured code is verified and wired in.
    return 'unverified_manufactured';
  }
  // Any other / unknown code: we cannot assert manufactured status. Fail loud.
  return 'unverified_manufactured';
}

export interface EvaluateInParkDeps {
  normalizer?: InParkNormalizer;
  logger?: ModelCallLogger;
  /** Gemma model id for the log line (from preflight). Default labels deterministic. */
  gemmaModel?: string;
}

/**
 * Evaluate a single manufactured-home comp for the in-park exclusion. Async only
 * because the optional Gemma normalizer is async; with no normalizer it is a pure
 * deterministic decision. FAILS LOUD when the comp's manufactured status cannot
 * be confirmed from a verified property-type code (never mis-classifies).
 */
export async function evaluateInPark(comp: DetailComp, deps: EvaluateInParkDeps = {}): Promise<InParkResult> {
  const gate = manufacturedTypeGate(comp.propertyTypeCode);
  const lotSizeAcres = comp.acres;

  if (gate === 'unverified_manufactured') {
    return {
      decision: 'fail_loud_unverified_type',
      keep: false,
      failLoud: true,
      reason:
        `Cannot confirm manufactured-home status: propertyType code ${comp.propertyTypeCode ?? 'absent'} is not a verified type ` +
        `(manufactured code is UNVERIFIED and never guessed). Manual underwriting required — not auto-classified as in-park or owned.`,
      signals: { hoaOrLotRent: false, ownedLandAffirmed: false, lotSizeAcres, usedGemma: false },
    };
  }

  // Run the normalizer (Gemma) if injected; otherwise the deterministic scan.
  let cls: InParkClassification;
  let usedGemma = false;
  if (deps.normalizer) {
    let gemmaOut: InParkClassification | null = null;
    try {
      gemmaOut = await deps.normalizer.classify(comp.descriptionText);
    } catch {
      gemmaOut = null; // degrade, never block
    }
    if (gemmaOut) {
      cls = gemmaOut;
      usedGemma = true;
      deps.logger?.log({
        provider: 'ollama',
        model: deps.gemmaModel ?? 'gemma',
        taskClass: 'in_park_normalize',
        workflow: 'comp_in_park_filter',
      });
    } else {
      cls = deterministicInParkScan(comp.descriptionText);
    }
  } else {
    cls = deterministicInParkScan(comp.descriptionText);
  }

  // Weak-signal note: a large owned-style lot can only SUPPORT an owned read.
  const weakOwnedHint = typeof lotSizeAcres === 'number' && lotSizeAcres >= WEAK_OWNED_LOT_ACRE_HINT;

  if (cls.hoaOrLotRent) {
    return {
      decision: 'exclude_in_park',
      keep: false,
      failLoud: false,
      reason: 'In-park / lot-rent / land-lease language present: not owned land. Excluded as a land comp.',
      signals: { hoaOrLotRent: true, ownedLandAffirmed: cls.ownedLandAffirmed, lotSizeAcres, usedGemma },
    };
  }

  if (cls.ownedLandAffirmed) {
    return {
      decision: 'keep_owned_land',
      keep: true,
      failLoud: false,
      reason: `Owned-land language affirmed${weakOwnedHint ? ` (lot ${lotSizeAcres}ac weakly supports)` : ''}: kept as an owned-land manufactured comp.`,
      signals: { hoaOrLotRent: false, ownedLandAffirmed: true, lotSizeAcres, usedGemma },
    };
  }

  // Ambiguous: neither clearly owned nor clearly in-park. Conservative exclude.
  return {
    decision: 'exclude_ambiguous',
    keep: false,
    failLoud: false,
    reason: `Ambiguous ownership: no clear owned-land or in-park language${weakOwnedHint ? ` (lot ${lotSizeAcres}ac is only a weak hint, not decisive)` : ''}. Excluded conservatively (never assume owned).`,
    signals: { hoaOrLotRent: false, ownedLandAffirmed: false, lotSizeAcres, usedGemma },
  };
}

export interface InParkFilterResult {
  kept: DetailComp[];
  excluded: Array<{ comp: DetailComp; result: InParkResult }>;
  failLoud: Array<{ comp: DetailComp; result: InParkResult }>;
}

/** Apply the in-park filter across a set of manufactured-home comps. Owned-land
 *  comps are kept; in-park/ambiguous are excluded; unverified-type comps are
 *  surfaced separately for manual underwriting (fail loud). */
export async function filterInParkComps(comps: DetailComp[], deps: EvaluateInParkDeps = {}): Promise<InParkFilterResult> {
  const kept: DetailComp[] = [];
  const excluded: Array<{ comp: DetailComp; result: InParkResult }> = [];
  const failLoud: Array<{ comp: DetailComp; result: InParkResult }> = [];
  for (const comp of comps) {
    const result = await evaluateInPark(comp, deps);
    if (result.failLoud) failLoud.push({ comp, result });
    else if (result.keep) kept.push(comp);
    else excluded.push({ comp, result });
  }
  return { kept, excluded, failLoud };
}
