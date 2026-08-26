// LandOS — semantic outlook change state for the specialist intelligence layers.
//
// A specialist that reevaluates after new material evidence has NOT necessarily
// changed its mind. Text diff cannot tell the difference: the same senior
// judgment written a second time is almost never the same prose. So the
// decision is semantic and the specialist itself makes it — this module holds
// only the contract, the comparison prompt, the verdict parser, and the small
// state machine that turns a verdict into persisted metadata.
//
// The one doctrine this file exists to enforce: THE PASSAGE OF TIME IS NOT A
// CHANGE. Nothing here reads a clock to decide status; `changedAt` is stamped
// only as provenance for a change something else already established. Age never
// makes an outlook stale, never triggers a model call, and never triggers
// research.

/** INITIAL — first read ever. UNCHANGED — the outlook did not materially move.
 *  UPDATED — conclusion, emphasis, opportunity, risk, recommendation, priority,
 *  controlling unknown, or expected path forward materially moved. */
export type OutlookStatus = 'INITIAL' | 'UNCHANGED' | 'UPDATED';

/** The smallest contract that explains an outlook to the operator, to the
 *  Overview's visual signal, and to a future Mini Max narration. */
export interface IntelligenceOutlook {
  status: OutlookStatus;
  /** Monotonic per-layer read version. 1 on the first read. */
  readVersion: number;
  /** The version this read was compared against; null on INITIAL. */
  previousReadVersion: number | null;
  /** ISO stamp of the moment the outlook actually moved. Held from the prior
   *  outlook while UNCHANGED, so the operator sees when it last changed. */
  changedAt: string | null;
  /** One concise line: what changed about the opinion. Null unless UPDATED. */
  changeSummary: string | null;
  /** The material inputs that moved it. Empty unless UPDATED. */
  changeDrivers: string[];
}

export interface OutlookVerdict {
  materiallyChanged: boolean;
  changeSummary: string | null;
  changeDrivers: string[];
}

/** Shared doctrine for every layer that compares two of its own reads. */
export const OUTLOOK_COMPARISON_RULE = [
  'You are comparing YOUR OWN prior current read against YOUR OWN new current read for the same subject.',
  'Decide ONE thing: did your OUTLOOK materially change, or did you say the same thing differently?',
  'The outlook materially changed only if one of these moved: your conclusion, your emphasis, the opportunity you',
  'see, the risk that binds, your recommendation, your priority, the controlling unknown, or the expected path',
  'forward. Materially changed means an operator would DECIDE or ACT differently having read the new one.',
  'It is NOT a material change when: the wording, ordering, length, or style differs; new evidence arrived but',
  'confirmed what you already thought; a field, schema, or interface was reshaped; the read is simply newer.',
  'Time passing is never a change. Be conservative: when the judgment is genuinely the same, answer false.',
  'If it did change, say in ONE line what changed about the OPINION (not what evidence arrived), and list the',
  'material inputs that moved it.',
].join('\n');

const OUTLOOK_SCHEMA = '{"materially_changed":true,"change_summary":"","change_drivers":[]}';

/** The comparison prompt. Sent to the layer's own specialist profile, and only
 *  when a genuinely new read has already been produced by an evidence-driven
 *  refresh — never on a read, never on a timer. */
export function outlookComparisonPrompt(input: {
  layerLabel: string;
  priorRead: string;
  nextRead: string;
}): string {
  return [
    `=== ${input.layerLabel.toUpperCase()} OUTLOOK COMPARISON ===`,
    OUTLOOK_COMPARISON_RULE,
    '',
    '=== YOUR PRIOR CURRENT READ ===',
    input.priorRead.trim(),
    '=== END PRIOR ===',
    '',
    '=== YOUR NEW CURRENT READ ===',
    input.nextRead.trim(),
    '=== END NEW ===',
    '',
    'Reply with ONE JSON object and nothing else, in exactly this shape:',
    OUTLOOK_SCHEMA,
  ].join('\n');
}

const asText = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, limit) : null;
};

/** Parse a comparison reply. Returns null when the specialist did not answer
 *  the question — the caller then holds the prior outlook rather than
 *  inventing a change. */
export function parseOutlookVerdict(raw: string): OutlookVerdict | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const flag = record.materially_changed ?? record.materiallyChanged;
  const changed = typeof flag === 'boolean'
    ? flag
    : typeof flag === 'string'
      ? /^(true|yes|updated|changed)$/i.test(flag.trim())
      : null;
  if (changed === null) return null;
  const driversRaw = record.change_drivers ?? record.changeDrivers;
  return {
    materiallyChanged: changed,
    changeSummary: asText(record.change_summary ?? record.changeSummary, 400),
    changeDrivers: (Array.isArray(driversRaw) ? driversRaw : [])
      .map((item) => asText(item, 200))
      .filter((item): item is string => !!item)
      .slice(0, 6),
  };
}

/** True when two reads are the same prose. Used only to skip a pointless
 *  comparison call — never to CONCLUDE that an outlook changed. */
const sameProse = (a: string, b: string): boolean =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * The state machine.
 *
 *   no prior read                     → INITIAL
 *   identical prose                   → UNCHANGED (no verdict needed)
 *   verdict absent / not material     → UNCHANGED
 *   verdict material                  → UPDATED
 *
 * `now` is injected and used ONLY to stamp a change that already happened.
 */
export function resolveOutlook(input: {
  prior: IntelligenceOutlook | null | undefined;
  priorRead: string | null | undefined;
  nextRead: string;
  verdict?: OutlookVerdict | null;
  now: () => Date;
}): IntelligenceOutlook {
  const prior = input.prior ?? null;
  const priorRead = (input.priorRead ?? '').trim();
  const priorVersion = prior?.readVersion ?? (priorRead ? 1 : 0);

  if (!priorRead) {
    return {
      status: 'INITIAL',
      readVersion: priorVersion + 1,
      previousReadVersion: null,
      changedAt: null,
      changeSummary: null,
      changeDrivers: [],
    };
  }

  const unchanged: IntelligenceOutlook = {
    status: 'UNCHANGED',
    readVersion: priorVersion + 1,
    previousReadVersion: priorVersion,
    changedAt: prior?.changedAt ?? null,
    changeSummary: null,
    changeDrivers: [],
  };

  if (sameProse(priorRead, input.nextRead)) return unchanged;
  const verdict = input.verdict ?? null;
  if (!verdict || !verdict.materiallyChanged) return unchanged;

  return {
    status: 'UPDATED',
    readVersion: priorVersion + 1,
    previousReadVersion: priorVersion,
    changedAt: input.now().toISOString(),
    changeSummary: verdict.changeSummary,
    changeDrivers: verdict.changeDrivers,
  };
}

/** The deterministic pre-contact Seller position: an honest Pending read is a
 *  first read, never a changed outlook. */
export function pendingOutlook(): IntelligenceOutlook {
  return {
    status: 'INITIAL',
    readVersion: 1,
    previousReadVersion: null,
    changedAt: null,
    changeSummary: null,
    changeDrivers: [],
  };
}

/** Does this outlook earn the Overview's stronger visual treatment? */
export function outlookIsUpdated(outlook: { status?: string } | null | undefined): boolean {
  return outlook?.status === 'UPDATED';
}
