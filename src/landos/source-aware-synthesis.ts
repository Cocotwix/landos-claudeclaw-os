// LandOS — SOURCE-AWARE KNOWLEDGE SYNTHESIS.
//
// Property Intelligence and Market Intelligence both face the same problem:
// LandOS has already retained many statements about one subject, from sources
// of very different authority, freshness and scope, and some of them disagree.
//
// The failure modes are equally symmetrical. A synthesis that concatenates
// repeats itself; one that "cleans up" deletes the county's own record because a
// provider echoed it; one that averages invents a number nobody said; one that
// quietly picks a winner hides the fact that the operator's decision rests on an
// unsettled question.
//
// So this module does exactly four things, and nothing else:
//
//   PRESERVE     every admitted claim survives with its own source, locator,
//                date and standing. Nothing is rewritten or merged into prose.
//   DEDUPLICATE  only GENUINE duplicates collapse — the same topic, the same
//                normalized value, from the same source and locator. Two
//                sources saying the same thing is corroboration, which is
//                recorded as strength, never as a duplicate.
//   RANK         authority, then freshness, then relevance, then agreement.
//   SURFACE      a topic whose sources disagree returns a conflict naming both
//                sides. It is resolved only when LandOS's own provenance rule
//                genuinely settles it, and `unresolved` otherwise.
//
// It decides nothing about parcels. PERMANENT_MEMORY invariants 2-4 are held
// upstream, by the identity path; this file ranks statements ABOUT an already
// identified subject and never promotes one into an identity claim.

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * How strongly a source speaks. This is AUTHORITY, not correctness: an official
 * record can be out of date, which is why freshness ranks separately below.
 */
export type SourceTier =
  | 'official_primary'
  | 'officially_linked'
  | 'provider_record'
  | 'reputable_secondary'
  | 'operator_statement'
  | 'seller_statement'
  | 'visual_capture'
  | 'landos_derivation';

const TIER_AUTHORITY: Record<SourceTier, number> = {
  official_primary: 7,
  officially_linked: 6,
  provider_record: 5,
  reputable_secondary: 4,
  operator_statement: 3,
  visual_capture: 2,
  seller_statement: 1,
  landos_derivation: 0,
};

export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  official_primary: 'Official / primary record',
  officially_linked: 'Officially linked record',
  provider_record: 'Provider record',
  reputable_secondary: 'Reputable secondary source',
  operator_statement: 'Operator statement',
  seller_statement: 'Seller statement',
  visual_capture: 'Retained imagery',
  landos_derivation: 'LandOS derivation',
};

/**
 * What KIND of statement this is. Stage 3 requires these four to stay visibly
 * apart, because collapsing them is how "the aerial shows a cleared lane"
 * becomes "the parcel has legal access".
 */
export type ClaimStanding =
  | 'official_legal_fact'
  | 'record_fact'
  | 'visual_observation'
  | 'analytical_hypothesis'
  | 'verification_need';

export const CLAIM_STANDING_LABEL: Record<ClaimStanding, string> = {
  official_legal_fact: 'Official / legal fact',
  record_fact: 'Record fact',
  visual_observation: 'Visual observation',
  analytical_hypothesis: 'Analytical hypothesis',
  verification_need: 'Verification needed',
};

/** Contract section 9 weights, unchanged. */
export type ClaimWeight = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';

const WEIGHT_RANK: Record<ClaimWeight, number> = {
  confirmed: 3,
  well_supported: 2,
  likely: 1,
  unresolved: 0,
};

export interface ClaimSource {
  name: string;
  url: string | null;
  tier: SourceTier;
  /** When LandOS retrieved it. Null means the retrieval time was not retained. */
  retrievedAt: string | null;
  /**
   * The geography this source speaks about, as precisely as it speaks — a
   * parcel, a county, a ZIP, a state. A county figure is not wrong when it is
   * the only figure; it is simply about a wider population than the subject,
   * and the operator has to be able to see that.
   */
  geography: string | null;
  /** Where inside the source, precisely enough to reopen it. */
  locator: string | null;
}

export interface SourcedClaim {
  claimId: string;
  /** Stable grouping key, e.g. `access.frontage`. Claims compare within it. */
  topic: string;
  label: string;
  /** One operator-readable sentence. */
  statement: string;
  /**
   * The comparable normalized value, when the claim has one. Null means the
   * claim is narrative: it is preserved and ranked, but it never produces a
   * conflict, because two sentences are not two answers to one question.
   */
  value: string | null;
  standing: ClaimStanding;
  weight: ClaimWeight;
  source: ClaimSource;
  /** As-of date of the FACT itself, when the source states one. */
  asOf: string | null;
  /** Claim ids from other sources that independently said the same thing. */
  corroboratedBy?: string[];
}

export interface SynthesisConflictSide {
  value: string;
  claimIds: string[];
  sources: string[];
  tier: SourceTier;
  weight: ClaimWeight;
  asOf: string | null;
}

export interface SynthesisConflict {
  topic: string;
  label: string;
  /** One sentence naming the disagreement and both values. */
  statement: string;
  sides: SynthesisConflictSide[];
  resolution: 'resolved' | 'unresolved';
  /** The provenance rule that resolved it, or why nothing could. */
  reason: string;
  /** False for a difference too small to change a decision. */
  material: boolean;
}

export interface CollapsedDuplicate {
  keptClaimId: string;
  collapsed: string[];
  reason: string;
}

export interface KnowledgeSynthesis {
  /** Every admitted claim, ranked strongest first within each topic. */
  claims: SourcedClaim[];
  /** Topic -> its claims, ranked. The drill-down the operator opens. */
  byTopic: Array<{ topic: string; label: string; claims: SourcedClaim[]; leading: SourcedClaim }>;
  duplicatesCollapsed: CollapsedDuplicate[];
  conflicts: SynthesisConflict[];
}

// ── Comparison primitives ───────────────────────────────────────────────────

/** Values compare case- and punctuation-insensitively; "1.50" equals "1.5". */
export function normalizeClaimValue(value: string | null): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number(text.replace(/[$,\s]/g, '').replace(/%$/, ''));
  if (Number.isFinite(numeric) && /^[-$\d.,\s%]+$/.test(text)) {
    // Trailing-zero-insensitive, so a re-formatted figure is not a new answer.
    return String(Number(numeric.toFixed(6)));
  }
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A difference too small to change a decision is not a conflict.
 *
 * Numbers use the same 2% relative tolerance the acquisition reconciliation
 * already applies, so one rule governs "materially different" across LandOS.
 */
export function claimValuesMateriallyDiffer(a: string, b: string): boolean {
  if (a === b) return false;
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    const high = Math.max(Math.abs(left), Math.abs(right));
    if (high === 0) return false;
    return Math.abs(left - right) / high > 0.02;
  }
  return true;
}

/** Freshness: the fact's own as-of date when stated, else its retrieval. */
function freshnessOf(claim: SourcedClaim): number {
  return Date.parse(claim.asOf ?? claim.source.retrievedAt ?? '') || 0;
}

/**
 * Relevance: how tightly the source's geography matches the subject.
 *
 * A parcel-level source outranks a county one on the same question. This is the
 * rung that stops a county median from reading as a statement about the parcel.
 */
function relevanceOf(claim: SourcedClaim): number {
  const geography = (claim.source.geography ?? '').toLowerCase();
  if (!geography) return 1;
  if (/parcel|apn|subject|lot\b/.test(geography)) return 4;
  if (/\bzip\b|\b\d{5}\b/.test(geography)) return 3;
  if (/county/.test(geography)) return 2;
  return 1;
}

function dedupeKey(claim: SourcedClaim): string {
  return [
    claim.topic,
    normalizeClaimValue(claim.value) ?? normalizeClaimValue(claim.statement) ?? claim.claimId,
    claim.source.name.trim().toLowerCase(),
    (claim.source.locator ?? '').trim().toLowerCase(),
    (claim.source.url ?? '').trim().toLowerCase(),
  ].join('|');
}

/**
 * Rank one topic's claims: authority, then freshness, then relevance, then
 * agreement. Ties break on claimId so a synthesis is byte-stable across runs —
 * which is what lets the persisted snapshot dedupe on its input hash instead of
 * writing a new version every time the same evidence is read again.
 */
export function compareClaims(a: SourcedClaim, b: SourcedClaim): number {
  const authority = TIER_AUTHORITY[b.source.tier] - TIER_AUTHORITY[a.source.tier];
  if (authority !== 0) return authority;
  const weight = WEIGHT_RANK[b.weight] - WEIGHT_RANK[a.weight];
  if (weight !== 0) return weight;
  const freshness = freshnessOf(b) - freshnessOf(a);
  if (freshness !== 0) return freshness;
  const relevance = relevanceOf(b) - relevanceOf(a);
  if (relevance !== 0) return relevance;
  const agreement = (b.corroboratedBy?.length ?? 0) - (a.corroboratedBy?.length ?? 0);
  if (agreement !== 0) return agreement;
  return a.claimId.localeCompare(b.claimId);
}

// ── The synthesis ───────────────────────────────────────────────────────────

export interface SynthesisInput {
  claims: readonly SourcedClaim[];
  /** Operator label per topic key. A topic with no label uses its key. */
  topicLabels?: Record<string, string>;
}

/**
 * Synthesize retained claims into one ranked, conflict-honest reading.
 *
 * Nothing is invented and nothing is averaged: the output is a permutation of
 * the input plus the disagreements the input already contained.
 */
export function synthesizeClaims(input: SynthesisInput): KnowledgeSynthesis {
  const labelFor = (topic: string): string => input.topicLabels?.[topic] ?? topic;

  // 1. Collapse genuine duplicates only — same topic, same value, same source
  //    AND same locator. A second source repeating a value is corroboration.
  const kept = new Map<string, SourcedClaim>();
  const duplicatesCollapsed: CollapsedDuplicate[] = [];
  for (const claim of input.claims) {
    const key = dedupeKey(claim);
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, { ...claim, corroboratedBy: [...(claim.corroboratedBy ?? [])] });
      continue;
    }
    const record = duplicatesCollapsed.find((entry) => entry.keptClaimId === existing.claimId);
    if (record) record.collapsed.push(claim.claimId);
    else duplicatesCollapsed.push({
      keptClaimId: existing.claimId,
      collapsed: [claim.claimId],
      reason: 'Same value for the same topic from the same source and locator.',
    });
  }

  const claims = [...kept.values()];

  // 2. Record agreement across DIFFERENT sources. This is the "agreement" rung
  //    of the ranking and, separately, what stops a corroborated claim from
  //    being read as a lone assertion.
  const byTopicValue = new Map<string, SourcedClaim[]>();
  for (const claim of claims) {
    const value = normalizeClaimValue(claim.value);
    if (value == null) continue;
    const key = `${claim.topic}|${value}`;
    const bucket = byTopicValue.get(key);
    if (bucket) bucket.push(claim);
    else byTopicValue.set(key, [claim]);
  }
  for (const bucket of byTopicValue.values()) {
    if (bucket.length < 2) continue;
    for (const claim of bucket) {
      claim.corroboratedBy = bucket
        .filter((other) => other.claimId !== claim.claimId && other.source.name !== claim.source.name)
        .map((other) => other.claimId);
    }
  }

  // 3. Rank within each topic.
  const topics = new Map<string, SourcedClaim[]>();
  for (const claim of claims) {
    const bucket = topics.get(claim.topic);
    if (bucket) bucket.push(claim);
    else topics.set(claim.topic, [claim]);
  }
  const byTopic = [...topics.entries()]
    .map(([topic, bucket]) => {
      const ranked = [...bucket].sort(compareClaims);
      return { topic, label: labelFor(topic), claims: ranked, leading: ranked[0] };
    })
    .sort((a, b) => a.topic.localeCompare(b.topic));

  // 4. Surface disagreements. A topic conflicts when two sources give
  //    materially different VALUES for it; narrative claims never conflict.
  const conflicts: SynthesisConflict[] = [];
  for (const entry of byTopic) {
    const valued = entry.claims.filter((claim) => normalizeClaimValue(claim.value) != null);
    if (valued.length < 2) continue;
    const groups = new Map<string, SourcedClaim[]>();
    for (const claim of valued) {
      const value = normalizeClaimValue(claim.value) as string;
      const bucket = groups.get(value);
      if (bucket) bucket.push(claim);
      else groups.set(value, [claim]);
    }
    if (groups.size < 2) continue;

    const sides: SynthesisConflictSide[] = [...groups.entries()]
      .map(([value, bucket]) => {
        const ranked = [...bucket].sort(compareClaims);
        return {
          value: ranked[0].value as string,
          claimIds: ranked.map((claim) => claim.claimId),
          sources: [...new Set(ranked.map((claim) => claim.source.name))],
          tier: ranked[0].source.tier,
          weight: ranked[0].weight,
          asOf: ranked[0].asOf ?? ranked[0].source.retrievedAt,
          normalized: value,
        };
      })
      .sort((a, b) => {
        const authority = TIER_AUTHORITY[b.tier] - TIER_AUTHORITY[a.tier];
        if (authority !== 0) return authority;
        const weight = WEIGHT_RANK[b.weight] - WEIGHT_RANK[a.weight];
        if (weight !== 0) return weight;
        return a.value.localeCompare(b.value);
      })
      .map(({ normalized: _normalized, ...side }) => side);

    const [top, next] = sides;
    const material = claimValuesMateriallyDiffer(
      normalizeClaimValue(top.value) as string,
      normalizeClaimValue(next.value) as string,
    );
    // Resolved ONLY when LandOS's own provenance rule genuinely settles it:
    // a strictly higher-authority source carrying at least well-supported
    // weight. Equal authority is an open question, and it is reported as one.
    const outranks = TIER_AUTHORITY[top.tier] > TIER_AUTHORITY[next.tier];
    const strongEnough = WEIGHT_RANK[top.weight] >= WEIGHT_RANK.well_supported;
    const resolved = !material || (outranks && strongEnough);
    conflicts.push({
      topic: entry.topic,
      label: entry.label,
      statement: `${entry.label}: ${sides.map((side) => `${side.value} (${side.sources.join(', ')})`).join(' vs ')}.`,
      sides,
      resolution: resolved ? 'resolved' : 'unresolved',
      reason: !material
        ? 'The figures differ by less than the 2% tolerance, which is not a decision-changing disagreement.'
        : outranks && strongEnough
          ? `${SOURCE_TIER_LABEL[top.tier]} (${top.sources.join(', ')}) outranks ${SOURCE_TIER_LABEL[next.tier]} on this question.`
          : 'No retained source outranks the other on this question, so LandOS carries both values rather than choosing one.',
      material,
    });
  }

  return {
    claims: byTopic.flatMap((entry) => entry.claims),
    byTopic,
    duplicatesCollapsed,
    conflicts: conflicts.sort((a, b) => a.topic.localeCompare(b.topic)),
  };
}

// ── Building claims ─────────────────────────────────────────────────────────

export interface ClaimSeed {
  topic: string;
  label: string;
  statement: string;
  value?: string | number | null;
  standing: ClaimStanding;
  weight?: ClaimWeight;
  sourceName: string;
  tier: SourceTier;
  url?: string | null;
  geography?: string | null;
  locator?: string | null;
  retrievedAt?: string | null;
  asOf?: string | null;
}

/**
 * Build one claim, or null when the seed carries nothing to say.
 *
 * A seed with no statement and no value is dropped here rather than becoming an
 * empty row in a report — an absent fact is reported as a gap by the caller,
 * never as a blank claim with a source attached to it.
 */
export function claim(prefix: string, index: number, seed: ClaimSeed): SourcedClaim | null {
  const statement = seed.statement.trim();
  const rawValue = seed.value == null ? null : String(seed.value).trim();
  const value = rawValue && rawValue !== '-' && rawValue.toLowerCase() !== 'unknown' ? rawValue : null;
  if (!statement && !value) return null;
  return {
    claimId: `${prefix}:${index}:${seed.topic}`,
    topic: seed.topic,
    label: seed.label,
    statement: statement || `${seed.label}: ${value}`,
    value,
    standing: seed.standing,
    weight: seed.weight ?? 'likely',
    source: {
      name: seed.sourceName,
      url: seed.url ?? null,
      tier: seed.tier,
      retrievedAt: seed.retrievedAt ?? null,
      geography: seed.geography ?? null,
      locator: seed.locator ?? null,
    },
    asOf: seed.asOf ?? null,
  };
}

/** Counts per standing, so a surface can show the separation without walking
 *  the whole claim list. */
export function standingBreakdown(claims: readonly SourcedClaim[]): Record<ClaimStanding, number> {
  const counts: Record<ClaimStanding, number> = {
    official_legal_fact: 0,
    record_fact: 0,
    visual_observation: 0,
    analytical_hypothesis: 0,
    verification_need: 0,
  };
  for (const entry of claims) counts[entry.standing] += 1;
  return counts;
}
