// LandOS — the Acquisition Intelligence RESULT contract.
//
// One structured acquisitions read per Deal Card. This module owns its shape,
// its normalization and its refusals, and it is deliberately the only place a
// model's output becomes LandOS data.
//
// Why normalization is a business rule and not plumbing:
//
//   • The reasoning engine is replaceable by design — Gemma 4 locally today, a
//     different local model or a frontier model tomorrow. Every one of them
//     will phrase, nest and mis-key JSON differently. The contract absorbs
//     that so the capability, the store, the API and the operator surface never
//     learn which engine produced a read.
//   • A model may return prose around its JSON, a fenced block, a wrapper key,
//     or a near-miss field name. Those are recoverable. What is NOT recoverable
//     is a read with no judgment in it, and that is rejected rather than shown.
//   • Anything the model asserts that the dossier did not carry is a fabricated
//     fact. The one place that is structurally preventable is visual citation:
//     an observation may only cite an image the dossier actually listed, so
//     unknown citations are dropped and counted.
//
// The result carries WHICH runtime produced it. That is not telemetry: an
// operator reading a judgment is entitled to know what made it.

export const ACQUISITION_INTELLIGENCE_CONTRACT_VERSION = '1.0.0';

export type EvidenceWeight = 'Confirmed' | 'Well supported' | 'Likely' | 'Unresolved';
export type StrategyFit = 'strong' | 'possible' | 'weak' | 'rejected';
export type ConstraintSeverity = 'high' | 'medium' | 'low';

export interface AcquisitionIntelligenceRuntime {
  /** The reasoning executor. `hermes` today; the field exists so a different
   *  executor never requires a schema change. */
  engine: string;
  /** The persistent analyst agent — persona, skills and memory. Survives every
   *  model swap, which is the entire point of naming it separately. */
  agentProfile: string;
  provider: string;
  model: string;
  /** Where the model selection came from: an operator setting or the default. */
  modelSource: 'setting' | 'default' | 'request';
  durationMs: number;
}

export interface AcquisitionStrategyRead {
  strategy: string;
  fit: StrategyFit;
  whyItFits: string | null;
  valueCreation: string | null;
  whatWeakensIt: string | null;
  whatToConfirm: string | null;
}

export interface AcquisitionVisualObservation {
  /** A visual key the dossier listed. Never a key the model invented. */
  visual: string;
  observation: string;
  basis: string | null;
}

export interface AcquisitionIntelligenceResult {
  contractVersion: typeof ACQUISITION_INTELLIGENCE_CONTRACT_VERSION;
  dealCardId: number;
  generatedAt: string;
  runtime: AcquisitionIntelligenceRuntime;
  /** Identifies the exact property file this read was formed from, so a stale
   *  read is recognisable after new evidence lands. */
  dossierFingerprint: string;
  dealRead: { headline: string; judgment: string; confidence: EvidenceWeight };
  propertyStory: string[];
  marketStory: string[];
  opportunities: Array<{ title: string; why: string | null; whatWouldConfirm: string | null }>;
  constraints: Array<{ title: string; why: string | null; severity: ConstraintSeverity }>;
  strategies: AcquisitionStrategyRead[];
  visualObservations: AcquisitionVisualObservation[];
  /** Every material conflict, LandOS-detected first. The analyst may add to
   *  this list; it may never remove from it. */
  conflicts: Array<{ subject: string; statement: string; resolution: string }>;
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  nextActions: Array<{ action: string; why: string | null }>;
  /** What the read was formed from, stated to the operator. */
  basis: { visualsAvailable: string[]; coveragePresent: string[]; coverageAbsent: string[] };
  warnings: string[];
}

// ── Reading a model's JSON without trusting its shape ─────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Pull one JSON object out of arbitrary model output.
 *
 * Handles a bare object, a fenced block, and prose wrapped around either. Scans
 * for the first balanced `{…}` span that parses, which is what survives a model
 * that narrates before answering.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed) return parsed;
  }
  for (let start = trimmed.indexOf('{'); start >= 0; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParse(trimmed.slice(start, index + 1));
          if (parsed) return parsed;
          break;
        }
      }
    }
  }
  return null;
}

function tryParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Read a field under any of several plausible names. Models rename keys; the
 *  contract does not get to be brittle about it. */
function field(source: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return source[name];
    const snake = name.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
    if (source[snake] !== undefined && source[snake] !== null) return source[snake];
  }
  return undefined;
}

function line(value: unknown, max = 600): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const joined = value.map((item) => line(item, max)).filter(Boolean).join(' ');
    return joined ? joined.slice(0, max) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function lines(value: unknown, limit: number, max = 600): string[] {
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    const rendered = isRecord(item)
      ? line(field(item, 'text', 'statement', 'point', 'observation', 'title', 'value'), max)
      : line(item, max);
    if (rendered && !out.includes(rendered)) out.push(rendered);
    if (out.length >= limit) break;
  }
  return out;
}

const WEIGHTS: EvidenceWeight[] = ['Confirmed', 'Well supported', 'Likely', 'Unresolved'];

function weight(value: unknown): EvidenceWeight {
  const raw = (line(value, 40) ?? '').toLowerCase();
  return WEIGHTS.find((candidate) => candidate.toLowerCase() === raw)
    ?? (raw.includes('confirm') ? 'Confirmed'
      : raw.includes('well') ? 'Well supported'
        : raw.includes('likely') || raw.includes('probable') ? 'Likely'
          : 'Unresolved');
}

function fit(value: unknown): StrategyFit {
  const raw = (line(value, 40) ?? '').toLowerCase();
  if (raw.includes('reject') || raw.includes('not applicable') || raw.includes('no')) {
    if (raw.includes('reject') || raw.includes('not applicable')) return 'rejected';
  }
  if (raw.includes('strong') || raw.includes('primary') || raw.includes('best')) return 'strong';
  if (raw.includes('weak') || raw.includes('unlikely') || raw.includes('poor')) return 'weak';
  if (raw.includes('possible') || raw.includes('conditional') || raw.includes('maybe')) return 'possible';
  return 'possible';
}

function severity(value: unknown): ConstraintSeverity {
  const raw = (line(value, 40) ?? '').toLowerCase();
  if (raw.includes('high') || raw.includes('critical') || raw.includes('sever')) return 'high';
  if (raw.includes('low') || raw.includes('minor')) return 'low';
  return 'medium';
}

/** LandOS-detected conflicts, in the shape the result carries them. */
export interface CarriedConflict { subject: string; statement: string; resolution: string }

export interface NormalizeInput {
  raw: string;
  dealCardId: number;
  runtime: AcquisitionIntelligenceRuntime;
  dossierFingerprint: string;
  /** Visual keys the dossier listed. An observation citing anything else is
   *  dropped: the model may only report on evidence it was actually given. */
  allowedVisualKeys: string[];
  /** Conflicts LandOS itself established. Always carried, never overwritten. */
  landosConflicts: CarriedConflict[];
  coveragePresent: string[];
  coverageAbsent: string[];
  now?: () => Date;
}

export type NormalizeOutcome =
  | { ok: true; result: AcquisitionIntelligenceResult }
  | { ok: false; reason: string };

/**
 * Turn one analyst response into a LandOS Acquisition Intelligence result.
 *
 * Rejects rather than degrades when the response carries no usable judgment: an
 * empty read shown as a read is worse than an honest failure the operator can
 * retry.
 */
export function normalizeAcquisitionIntelligence(input: NormalizeInput): NormalizeOutcome {
  const parsed = extractJsonObject(input.raw);
  if (!parsed) return { ok: false, reason: 'The analyst returned no parsable JSON result.' };

  const warnings: string[] = [];
  const dealReadSource = field(parsed, 'dealRead', 'deal_read', 'read', 'summary');
  const dealReadRecord = isRecord(dealReadSource) ? dealReadSource : {};
  const headline = line(field(dealReadRecord, 'headline', 'title', 'summary'), 300)
    ?? line(field(parsed, 'headline'), 300);
  const judgment = line(field(dealReadRecord, 'judgment', 'assessment', 'detail', 'body'), 2_000)
    ?? line(field(parsed, 'judgment'), 2_000);

  const propertyStory = lines(field(parsed, 'propertyStory', 'property_story'), 8, 800);
  const marketStory = lines(field(parsed, 'marketStory', 'market_story', 'localStory'), 8, 800);

  const strategiesRaw = Array.isArray(field(parsed, 'strategies', 'strategy_read', 'strategyRead'))
    ? field(parsed, 'strategies', 'strategy_read', 'strategyRead') as unknown[]
    : [];
  const strategies: AcquisitionStrategyRead[] = [];
  for (const item of strategiesRaw) {
    if (!isRecord(item)) continue;
    const strategy = line(field(item, 'strategy', 'name', 'title'), 160);
    if (!strategy) continue;
    strategies.push({
      strategy,
      fit: fit(field(item, 'fit', 'applicability', 'rating')),
      whyItFits: line(field(item, 'whyItFits', 'why_it_fits', 'why', 'rationale'), 800),
      valueCreation: line(field(item, 'valueCreation', 'value_creation', 'value'), 800),
      whatWeakensIt: line(field(item, 'whatWeakensIt', 'what_weakens_it', 'blockers', 'risks'), 800),
      whatToConfirm: line(field(item, 'whatToConfirm', 'what_to_confirm', 'confirm', 'nextVerification'), 800),
    });
    if (strategies.length >= 8) break;
  }

  // A read with no headline, no judgment and no strategy is not a read.
  if (!headline && !judgment && strategies.length === 0) {
    return { ok: false, reason: 'The analyst returned JSON with no deal read and no strategies.' };
  }

  const opportunities = (Array.isArray(field(parsed, 'opportunities', 'key_opportunities', 'keyOpportunities'))
    ? field(parsed, 'opportunities', 'key_opportunities', 'keyOpportunities') as unknown[]
    : [])
    .map((item) => {
      const record = isRecord(item) ? item : { title: item };
      const title = line(field(record, 'title', 'opportunity', 'name', 'text'), 240);
      return title
        ? {
          title,
          why: line(field(record, 'why', 'rationale', 'detail'), 800),
          whatWouldConfirm: line(field(record, 'whatWouldConfirm', 'what_would_confirm', 'confirm'), 600),
        }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, 8);

  const constraints = (Array.isArray(field(parsed, 'constraints', 'key_constraints', 'risks'))
    ? field(parsed, 'constraints', 'key_constraints', 'risks') as unknown[]
    : [])
    .map((item) => {
      const record = isRecord(item) ? item : { title: item };
      const title = line(field(record, 'title', 'constraint', 'risk', 'name', 'text'), 240);
      return title
        ? { title, why: line(field(record, 'why', 'rationale', 'detail'), 800), severity: severity(field(record, 'severity', 'impact')) }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, 8);

  const allowed = new Set(input.allowedVisualKeys);
  let droppedVisualCitations = 0;
  const visualObservations = (Array.isArray(field(parsed, 'visualObservations', 'visual_observations'))
    ? field(parsed, 'visualObservations', 'visual_observations') as unknown[]
    : [])
    .map((item) => {
      if (!isRecord(item)) return null;
      const visual = line(field(item, 'visual', 'image', 'key', 'capture'), 80);
      const observation = line(field(item, 'observation', 'detail', 'text'), 800);
      if (!visual || !observation) return null;
      const key = visual.replace(/\s+/g, '_').toLowerCase();
      const matched = allowed.has(visual) ? visual : allowed.has(key) ? key : null;
      if (!matched) { droppedVisualCitations += 1; return null; }
      return { visual: matched, observation, basis: line(field(item, 'basis', 'evidence', 'why'), 400) };
    })
    .filter((item): item is AcquisitionVisualObservation => !!item)
    .slice(0, 12);
  if (droppedVisualCitations > 0) {
    warnings.push(`${droppedVisualCitations} visual observation(s) cited an image that is not in this property's retained evidence and were dropped.`);
  }

  // LandOS conflicts are the floor. The analyst can add, never subtract.
  const conflicts: CarriedConflict[] = [...input.landosConflicts];
  const seen = new Set(conflicts.map((conflict) => conflict.statement.toLowerCase()));
  for (const item of (Array.isArray(field(parsed, 'conflicts')) ? field(parsed, 'conflicts') as unknown[] : [])) {
    const record = isRecord(item) ? item : { statement: item };
    const statement = line(field(record, 'statement', 'conflict', 'text', 'detail'), 800);
    if (!statement || seen.has(statement.toLowerCase())) continue;
    seen.add(statement.toLowerCase());
    conflicts.push({
      subject: line(field(record, 'subject', 'fact', 'topic'), 80) ?? 'other',
      statement,
      resolution: line(field(record, 'resolution', 'reason', 'note'), 600) ?? 'Unresolved.',
    });
  }

  const unknowns = (Array.isArray(field(parsed, 'unknowns', 'important_unknowns', 'importantUnknowns'))
    ? field(parsed, 'unknowns', 'important_unknowns', 'importantUnknowns') as unknown[]
    : [])
    .map((item) => {
      const record = isRecord(item) ? item : { question: item };
      const question = line(field(record, 'question', 'unknown', 'text', 'title'), 400);
      return question ? { question, whyItMatters: line(field(record, 'whyItMatters', 'why_it_matters', 'why'), 600) } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, 8);

  const nextActions = (Array.isArray(field(parsed, 'nextActions', 'next_actions', 'next_best_actions', 'nextBestActions'))
    ? field(parsed, 'nextActions', 'next_actions', 'next_best_actions', 'nextBestActions') as unknown[]
    : [])
    .map((item) => {
      const record = isRecord(item) ? item : { action: item };
      const action = line(field(record, 'action', 'text', 'title', 'step'), 400);
      return action ? { action, why: line(field(record, 'why', 'rationale', 'detail'), 600) } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, 6);

  if (!strategies.length) warnings.push('The analyst returned no ranked strategies for this property.');
  if (!visualObservations.length && input.allowedVisualKeys.length > 0) {
    warnings.push('Retained imagery was available but the analyst reported no visual observation.');
  }

  return {
    ok: true,
    result: {
      contractVersion: ACQUISITION_INTELLIGENCE_CONTRACT_VERSION,
      dealCardId: input.dealCardId,
      generatedAt: (input.now?.() ?? new Date()).toISOString(),
      runtime: input.runtime,
      dossierFingerprint: input.dossierFingerprint,
      dealRead: {
        headline: headline ?? 'Acquisition read produced without a headline.',
        judgment: judgment ?? '',
        confidence: weight(field(dealReadRecord, 'confidence', 'weight', 'certainty')),
      },
      propertyStory,
      marketStory,
      opportunities,
      constraints,
      // Ranked strongest-first, with rejections last: the model's ordering is
      // respected within each band, but a rejection never outranks a fit.
      strategies: [...strategies].sort((a, b) => FIT_RANK[a.fit] - FIT_RANK[b.fit]),
      visualObservations,
      conflicts,
      unknowns,
      nextActions,
      basis: {
        visualsAvailable: input.allowedVisualKeys,
        coveragePresent: input.coveragePresent,
        coverageAbsent: input.coverageAbsent,
      },
      warnings,
    },
  };
}

const FIT_RANK: Record<StrategyFit, number> = { strong: 0, possible: 1, weak: 2, rejected: 3 };
