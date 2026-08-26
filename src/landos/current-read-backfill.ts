// LandOS — CURRENT READ backfill for already-persisted intelligence products.
//
// Every product produced from now on carries its own CURRENT EXPERT READ,
// because the specialist writes it in the same pass that produced the product.
// Products persisted BEFORE that upgrade have complete intelligence and no
// operator brief. Rerunning research to obtain one would be absurd: the
// evidence has not moved, and the specialist already reasoned over all of it.
//
// So this module does exactly one thing: hand the layer's own specialist its
// OWN persisted product back — the full expert review plus the structured
// conclusions — and ask it for the brief it would have written then. One model
// call per missing read. No research, no web search, no Stage A rerun, no
// dossier rebuild, and no change to any existing field: the full expert reviews
// are preserved verbatim and only the read (and its outlook state) is added.

import {
  resolveOutlook,
  type IntelligenceOutlook,
} from './intelligence-outlook.js';

export type CurrentReadLayer = 'property' | 'market' | 'deal';

/** The doctrine the synthesis obeys. Deliberately the SAME product definition
 *  the in-pass rule states, so a backfilled read and a natively produced read
 *  are the same kind of object. */
const HUMAN_READ_RULE = [
  'This is the CURRENT READ — the intelligence product the operator sees first on the deal Overview.',
  'It is NOT a summary of fields, NOT an excerpt or truncation of the expert review, NOT a shorter list of the',
  'same facts, and NOT a metric recap. Having weighed the COMPLETE evidence and your full expert reasoning',
  'below, brief the operator the way a very good senior specialist in your domain would after reviewing the',
  'entire file: what actually matters right now, why it matters, what the evidence means for this deal, and the',
  'single most decision-changing opportunity, problem, or unknown. Connect the evidence rather than enumerating',
  'it; leave immaterial detail out.',
  'Write 2-4 short paragraphs separated by blank lines. There is no word limit and no character limit, and',
  'conciseness is subordinate to material completeness: include everything genuinely decision-changing and',
  'nothing else. Never open with a specification line such as "51.11 acres. Slope 18.65%." — write prose.',
  'Keep FACT, SELLER-REPORTED, OBSERVATION, INTERPRETATION, HYPOTHESIS and UNKNOWN distinctions honest: an',
  'unresolved matter or an unproven configuration must read as a hypothesis, never as fact.',
  'Add NO new fact, NO new source, and NO conclusion your review below does not already support. You are not',
  'researching and not reconsidering — you are writing the brief for the intelligence you already produced.',
].join('\n');

const LAYER_QUESTION: Record<CurrentReadLayer, string> = {
  property: 'What should the operator understand about this land itself right now?',
  market: 'What should the operator understand about this market, and this property\'s fit inside it, right now?',
  deal: 'What should the operator think about this deal right now?',
};

const LAYER_EXTRA: Record<CurrentReadLayer, string> = {
  property: 'Explain what matters about the tract and why. Do not enumerate acreage, slope, zoning and access as a specification list.',
  market: 'Tell the story of this market and this deal\'s fit inside it. Do not merely enumerate days-on-market, absorption and growth metrics.',
  deal: [
    'Synthesize: what this deal currently looks like, the best current executable strategy, the highest-upside',
    'hypothesis and why it may work, what could kill it, what matters most now, and what should happen next —',
    'only the parts that are material and supported. Do NOT repeat the Property and Market reads',
    'paragraph-for-paragraph.',
  ].join(' '),
};

const RESPONSE_KEY: Record<CurrentReadLayer, string> = {
  property: 'current_expert_read',
  market: 'current_expert_read',
  deal: 'current_deal_read',
};

const LAYER_LABEL: Record<CurrentReadLayer, string> = {
  property: 'Property Intelligence',
  market: 'Market Intelligence',
  deal: 'Deal Brain',
};

/** Serialize the persisted product as the specialist's own prior work. The
 *  full expert review is passed WHOLE — truncating it here would produce
 *  exactly the field-recap the read must not be. */
export function currentReadSynthesisPrompt(input: {
  layer: CurrentReadLayer;
  /** The persisted product, verbatim. */
  product: unknown;
  /** Stage A prose, when the product carries one. */
  expertReview?: string | null;
}): string {
  const { layer } = input;
  return [
    `=== ${LAYER_LABEL[layer].toUpperCase()} — CURRENT READ ===`,
    `You already produced the ${LAYER_LABEL[layer]} product below for this deal. It is YOUR work and it stands.`,
    'You are not being asked to redo it, research anything, or change any conclusion.',
    `Answer only this: ${LAYER_QUESTION[layer]}`,
    '',
    HUMAN_READ_RULE,
    LAYER_EXTRA[layer],
    '',
    ...(input.expertReview?.trim()
      ? ['=== YOUR FULL EXPERT REVIEW (verbatim) ===', input.expertReview.trim(), '=== END EXPERT REVIEW ===', '']
      : []),
    '=== YOUR PERSISTED STRUCTURED PRODUCT (JSON) ===',
    JSON.stringify(input.product),
    '=== END PRODUCT ===',
    '',
    'Reply with ONE JSON object and nothing else, in exactly this shape:',
    `{"${RESPONSE_KEY[layer]}":""}`,
  ].join('\n');
}

/** Pull the read out of a synthesis reply. Tolerates the specialist replying
 *  with bare prose, which is a correct answer in the wrong envelope. */
export function parseCurrentRead(raw: string, layer: CurrentReadLayer): string | null {
  const key = RESPONSE_KEY[layer];
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const value = parsed[key] ?? parsed.current_read ?? parsed.currentRead
        ?? parsed.current_expert_read ?? parsed.current_deal_read;
      if (typeof value === 'string' && value.trim()) return normalizeRead(value);
    } catch { /* fall through to prose */ }
  }
  const prose = raw.trim();
  // A bare-prose reply is accepted only when it is actually a brief, not a
  // refusal, an error line, or a stray JSON fragment.
  if (prose.length >= 200 && !prose.startsWith('{') && !prose.startsWith('[')) return normalizeRead(prose);
  return null;
}

/** Paragraph shape only. The read is NEVER truncated: no word cap, no
 *  character cap, no first-N-sentences. */
function normalizeRead(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export interface BackfillLayerResult {
  layer: CurrentReadLayer;
  /** 'generated' — a read was produced and persisted. 'present' — the product
   *  already carried one and no model ran. 'absent' — no persisted product.
   *  'failed' — the specialist did not return a usable read. */
  status: 'generated' | 'present' | 'absent' | 'failed';
  read: string | null;
  outlook: IntelligenceOutlook | null;
  modelCalls: number;
  detail?: string;
}

export interface BackfillDeps {
  /** The persisted product for a layer, or null. A pure read. */
  readProduct: (layer: CurrentReadLayer) => Record<string, unknown> | null;
  /** Persist the product carrying its new read + outlook. */
  writeProduct: (layer: CurrentReadLayer, product: Record<string, unknown>) => void;
  /** One specialist call on that layer's own profile. */
  invoke: (layer: CurrentReadLayer, prompt: string) => Promise<string>;
  now?: () => Date;
}

const readFieldFor = (layer: CurrentReadLayer): string =>
  layer === 'deal' ? 'currentDealRead' : 'currentExpertRead';

/**
 * Backfill the missing current reads for one deal.
 *
 * A layer that already carries a read costs ZERO model calls — this is a
 * repair, not a refresh. The first read a layer ever gets is INITIAL by
 * definition, so no comparison call is made either.
 */
export async function backfillCurrentReads(input: {
  layers: readonly CurrentReadLayer[];
  deps: BackfillDeps;
}): Promise<BackfillLayerResult[]> {
  const now = input.deps.now ?? (() => new Date());
  const results: BackfillLayerResult[] = [];

  for (const layer of input.layers) {
    const product = input.deps.readProduct(layer);
    if (!product) {
      results.push({ layer, status: 'absent', read: null, outlook: null, modelCalls: 0, detail: 'No persisted product exists for this layer.' });
      continue;
    }
    const field = readFieldFor(layer);
    const existing = product[field];
    if (typeof existing === 'string' && existing.trim()) {
      results.push({
        layer,
        status: 'present',
        read: existing,
        outlook: (product.outlook as IntelligenceOutlook | undefined) ?? null,
        modelCalls: 0,
      });
      continue;
    }

    const expertReview = typeof product.expertReview === 'string' ? product.expertReview : null;
    const prompt = currentReadSynthesisPrompt({ layer, product, expertReview });
    let raw: string;
    try {
      raw = await input.deps.invoke(layer, prompt);
    } catch (error) {
      results.push({
        layer, status: 'failed', read: null, outlook: null, modelCalls: 1,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const read = parseCurrentRead(raw, layer);
    if (!read) {
      results.push({ layer, status: 'failed', read: null, outlook: null, modelCalls: 1, detail: 'The specialist returned no usable current read.' });
      continue;
    }

    // A first read is INITIAL: there is no prior opinion to have moved, so no
    // comparison call runs and the card must not glow.
    const outlook = resolveOutlook({
      prior: (product.outlook as IntelligenceOutlook | undefined) ?? null,
      priorRead: null,
      nextRead: read,
      now,
    });

    input.deps.writeProduct(layer, { ...product, [field]: read, outlook });
    results.push({ layer, status: 'generated', read, outlook, modelCalls: 1 });
  }

  return results;
}
