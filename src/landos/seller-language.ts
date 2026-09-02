// LandOS — seller language, read deterministically.
//
// `landos-seller-discovery` may turn a retained communication into a seller
// claim only when it can say WHO spoke, WHAT they asserted, and HOW firmly.
// This module is that reading. It is pure text handling: no model, no
// network, no clock. Where the text does not settle a question, it refuses
// rather than guesses, and the refusal is returned so the surface can count it.
//
// Three things are decided here, in order:
//
//   SPEAKER     a transcript labels its speakers; an inbound message is the
//               seller's own words; an operator summary is the operator's
//               record, in which "he said $45,000" is a record of seller speech
//               and "I offered $20,000" is the operator's own. Operator
//               inference ("probably motivated by the taxes") is neither.
//   POLARITY    "I am not asking $28,000" is a negation, "forget the $45,000"
//               a withdrawal; only an assertion can become the seller's
//               current position.
//   MODALITY    "I could close next month if the survey is done" is
//               conditional; "I think my brother may need to sign" is
//               uncertain; "I could send it if you want" is a proposal, not a
//               commitment. Each lowers confidence rather than being dropped.
//
// Everything is lexicon-driven and every lexicon is broad on purpose: the
// point is to read realistic seller language, not one fixture's phrasing.

import type { CommLogEntry } from './acquisitions.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type SellerClaimDimension =
  | 'motivation'
  | 'price'
  | 'timeline'
  | 'decision_maker'
  | 'constraint'
  | 'commitment'
  /** Something the seller said ABOUT THE PROPERTY. Seller-reported, never a
   *  verified property fact; carried so diligence can go and check it. */
  | 'property_claim';

export const SELLER_CLAIM_DIMENSIONS: SellerClaimDimension[] = [
  'motivation', 'price', 'timeline', 'decision_maker', 'constraint', 'commitment', 'property_claim',
];

/** Who an utterance is attributed to. Only the first three may carry a claim. */
export type SpeakerRole =
  /** The seller, verbatim: a labelled transcript turn or an inbound message. */
  | 'seller'
  /** Another non-operator party in the conversation (a spouse, an heir). */
  | 'seller_party'
  /** The operator's own record of what the seller said ("she said …"). */
  | 'operator_record'
  /** The operator's own words or inference. Refused. */
  | 'operator'
  /** Speech nobody can be sure of, e.g. first person in an unlabelled
   *  transcript. Refused. */
  | 'unattributed';

export type ClaimPolarity = 'asserted' | 'negated' | 'withdrawn';
export type ClaimModality = 'firm' | 'conditional' | 'uncertain' | 'proposed';
export type ClaimConfidence = 'high' | 'medium' | 'low';

export interface Utterance {
  text: string;
  speaker: SpeakerRole;
  /** The transcript label, or how the record identifies the speaker. */
  label: string;
  /** Which field of the record it was read from. */
  field: 'body' | 'summary' | 'notes';
  /** Why it cannot carry a claim, when it cannot. */
  refusal: string | null;
  /** Operator shorthand in a summary whose subject is implicit ("Wants $45k").
   *  Readable, but confidence is lowered for it. */
  implicitSubject: boolean;
}

export interface Finding {
  dimension: SellerClaimDimension;
  /** The parsed position, when the sentence carries one: an amount, a date
   *  phrase, a person, a keyword. Null when only the sentence itself says it. */
  value: string | null;
  polarity: ClaimPolarity;
  modality: ClaimModality;
  /** The condition, when the modality is conditional. */
  condition: string | null;
  /** Values the same sentence withdrew ("forget the $45,000, I'd take $38,000"). */
  withdraws: string[];
  /** Amounts in the sentence that belong to the operator, not the seller. */
  operatorValues: string[];
}

// ── Text helpers ────────────────────────────────────────────────────────────

export const clean = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== '-' && text.toLowerCase() !== 'unknown' ? text : null;
};

export function sentencesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
}

/** Drop quoted prior messages from an inbound reply so the operator's earlier
 *  words are never read as the seller's. */
export function stripQuotedText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*(On .{5,160} wrote:|-{2,}\s*(Original|Forwarded) Message|From:\s|Sent from my|Begin forwarded message)/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

// ── Speaker attribution ─────────────────────────────────────────────────────

const OPERATOR_LABEL = /^(operator|tyler|me|us|buyer|landos|agent|land ?ally|ty ?land( biz)?|tlb|interviewer|caller|q|question)$/i;
const SELLER_LABEL = /^(seller|owner|landowner|property owner|mr|mrs|ms|miss|dr|a|answer)\b/i;
const LABELLED_LINE = /^\s*([A-Za-z][A-Za-z .'-]{0,40}?)(?:\s*\(([^)]{1,40})\))?\s*:\s+(.+)$/;
const NOT_A_SPEAKER = /^(note|notes|re|subject|summary|date|time|to|from|cc|http|https|tel|phone|email|outcome|follow ?up|next step|next steps|action items?|key facts?|objections?|commitments?)$/i;

const nameTokens = (name: string | null): string[] =>
  (name ?? '').toLowerCase().split(/[^a-z']+/).filter((token) => token.length >= 2 && !/^(mr|mrs|ms|miss|dr|jr|sr|ii|iii)$/.test(token));

function labelRole(label: string, parenthetical: string | null, contactName: string | null, seen: Map<string, SpeakerRole>): SpeakerRole {
  const key = label.trim().toLowerCase();
  const known = seen.get(key);
  if (known) return known;
  let role: SpeakerRole;
  if (OPERATOR_LABEL.test(key)) role = 'operator';
  else if (parenthetical && /\b(operator|buyer|agent|landos)\b/i.test(parenthetical)) role = 'operator';
  else if (parenthetical && /\b(wife|husband|spouse|brother|sister|son|daughter|mother|father|partner|heir|attorney|lawyer|trustee|executor|family|co-?owner)\b/i.test(parenthetical)) role = 'seller_party';
  else if (SELLER_LABEL.test(key)) role = 'seller';
  else {
    const tokens = nameTokens(contactName);
    const labelTokens = nameTokens(label);
    const matchesContact = tokens.length > 0 && labelTokens.some((token) => tokens.includes(token));
    const sellerTaken = [...seen.values()].includes('seller');
    role = matchesContact ? 'seller' : tokens.length > 0 ? 'seller_party' : sellerTaken ? 'seller_party' : 'seller';
  }
  seen.set(key, role);
  return role;
}

/** Parse a labelled dialogue ("Seller: …", "Tom (brother): …"). Null when the
 *  body is not a dialogue. */
export function dialogueTurns(body: string, contactName: string | null): Array<{ label: string; speaker: SpeakerRole; text: string }> | null {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const labelled = lines.filter((line) => {
    const match = LABELLED_LINE.exec(line);
    return !!match && !NOT_A_SPEAKER.test(match[1].trim());
  });
  if (!labelled.length) return null;
  const distinct = new Set(labelled.map((line) => LABELLED_LINE.exec(line)![1].trim().toLowerCase()));
  const anyRoleLabel = labelled.some((line) => {
    const label = LABELLED_LINE.exec(line)![1].trim();
    return OPERATOR_LABEL.test(label) || SELLER_LABEL.test(label);
  });
  if (distinct.size < 2 && !anyRoleLabel) return null;

  const seen = new Map<string, SpeakerRole>();
  const turns: Array<{ label: string; speaker: SpeakerRole; text: string }> = [];
  for (const line of lines) {
    const match = LABELLED_LINE.exec(line);
    if (match && !NOT_A_SPEAKER.test(match[1].trim())) {
      const label = match[1].trim();
      turns.push({ label, speaker: labelRole(label, match[2] ?? null, contactName, seen), text: match[3].trim() });
    } else if (line.trim()) {
      if (turns.length) turns[turns.length - 1].text += ` ${line.trim()}`;
      else turns.push({ label: 'unlabelled', speaker: 'unattributed', text: line.trim() });
    }
  }
  return turns;
}

const FIRST_PERSON = /\b(i|i'm|i've|i'll|i'd|we|we're|we've|we'll|we'd|my|our|me|us|myself|ourselves)\b/i;
const IMPLICIT_OPERATOR_START = /^(offered|told|asked|mentioned|explained|proposed|quoted|suggested|sent|left|called|texted|emailed|reached|pitched|floated|followed up|following up|discussed|walked (him|her|them) through|tried|attempted|spoke with|spoke to|talked (to|with)|met with|introduced)\b/i;
const THIRD_PERSON_SELLER = /\b(seller|owner|landowner|he|she|they|him|her|them|his|hers|their|theirs|the (wife|husband|brother|sister|son|daughter|family|heirs?|estate|trustee|executor|attorney|widow|widower)|mr\.?|mrs\.?|ms\.?)\b/i;
const SPEECH_OR_STANCE = /\b(said|says|saying|told|tells|mentioned|mentions|wants?|wanted|needs?|needed|is asking|asking|asked|asks|would|will|won'?t|can'?t|cannot|could|expects?|thinks?|hopes?|plans?|planning|prefers?|insists?|indicated|confirmed|admitted|explained|claims?|claimed|looking|hoping|open to|interested|agreed|offered|countered|declined|refused|has to|have to|needs to|need to|must|inherited|owes?|owned|owns|is|are|was|were|isn'?t|aren'?t|does|doesn'?t|did|didn'?t|mentioned|considers?|figures?|feels|felt)\b/i;
const INFERENCE = /\b(probably|seems?|seemed|appears?|appeared|i think|i suspect|i bet|i guess|i figure|my (read|guess|sense|take|impression|hunch)|likely|feels like|sounds like|sounded like|i believe|i assume|assuming|presumably|apparently|reading between|gut (says|feeling)|my guess is|i'd say|if i had to guess|looks like|strikes me)\b/i;
const EXPLICIT_QUOTE = /\b(said|says|told|mentioned|stated|confirmed|indicated|admitted|explained|claimed|insisted|quote|(his|her|their) (words|exact words)|verbatim|in (his|her|their) words)\b|["“”]/i;

/**
 * Attribute one sentence of operator-authored text (a call summary, a note on
 * a message). The operator wrote it, so "I" is the operator; the seller's
 * speech appears in the third person, and only with a speech or stance verb.
 */
export function attributeParaphrase(sentence: string, contactName: string | null, unlabelledTranscript = false): Pick<Utterance, 'speaker' | 'label' | 'refusal' | 'implicitSubject'> {
  const contact = nameTokens(contactName);
  const mentionsContact = contact.length > 0 && contact.some((token) => new RegExp(`\\b${token}\\b`, 'i').test(sentence));
  if (INFERENCE.test(sentence) && !EXPLICIT_QUOTE.test(sentence)) {
    return { speaker: 'operator', label: 'operator inference', refusal: 'Operator inference about the seller, not seller speech; a claim needs what the seller actually said.', implicitSubject: false };
  }
  if ((THIRD_PERSON_SELLER.test(sentence) || mentionsContact) && SPEECH_OR_STANCE.test(sentence)) {
    return { speaker: 'operator_record', label: contactName ? `operator's record of ${contactName}` : "operator's record of the seller", refusal: null, implicitSubject: false };
  }
  if (FIRST_PERSON.test(sentence) || IMPLICIT_OPERATOR_START.test(sentence)) {
    return unlabelledTranscript
      ? { speaker: 'unattributed', label: 'unlabelled transcript', refusal: 'First-person speech in an unlabelled transcript cannot be attributed; label the speakers to extract claims.', implicitSubject: false }
      : { speaker: 'operator', label: 'operator', refusal: "The operator's own words; a seller claim needs the seller's statement.", implicitSubject: false };
  }
  return { speaker: 'operator_record', label: 'operator shorthand (subject implicit)', refusal: null, implicitSubject: true };
}

/**
 * Read a retained communication into attributed utterances.
 *
 * `sellerVerbatim` says whether the body is the seller's own words (an inbound
 * message). A conversation record's body is read as a dialogue when it has
 * speaker labels, and as an unlabelled transcript otherwise. Summary and notes
 * are always the operator's record.
 */
export function utterancesOf(entry: CommLogEntry, sellerVerbatim: boolean, contactName: string | null): Utterance[] {
  const out: Utterance[] = [];
  const body = clean(entry.body) ? stripQuotedText(entry.body!) : null;

  if (body) {
    if (sellerVerbatim) {
      for (const text of sentencesOf(body)) out.push({ text, speaker: 'seller', label: `seller (inbound ${entry.type ?? entry.channel})`, field: 'body', refusal: null, implicitSubject: false });
    } else {
      const turns = dialogueTurns(body, contactName);
      if (turns) {
        for (const turn of turns) {
          for (const text of sentencesOf(turn.text)) {
            if (turn.speaker === 'operator') {
              out.push({ text, speaker: 'operator', label: turn.label, field: 'body', refusal: "The operator's own turn in the transcript.", implicitSubject: false });
            } else if (turn.speaker === 'unattributed') {
              out.push({ text, speaker: 'unattributed', label: turn.label, field: 'body', refusal: 'Unlabelled speech before the first speaker label.', implicitSubject: false });
            } else {
              out.push({ text, speaker: turn.speaker, label: turn.label, field: 'body', refusal: null, implicitSubject: false });
            }
          }
        }
      } else {
        for (const text of sentencesOf(body)) out.push({ text, field: 'body', ...attributeParaphrase(text, contactName, true) });
      }
    }
  }

  const seenText = new Set(out.map((utterance) => utterance.text.toLowerCase()));
  for (const field of ['summary', 'notes'] as const) {
    const value = clean(entry[field]);
    if (!value) continue;
    if (body && (body.includes(value) || value.length < 12)) continue;
    for (const text of sentencesOf(value)) {
      if (seenText.has(text.toLowerCase())) continue;
      seenText.add(text.toLowerCase());
      out.push({ text, field, ...attributeParaphrase(text, contactName, false) });
    }
  }
  return out;
}

// ── Values ──────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const WORD_NUMBER = /\b((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a)[- ]?)+)\s*(thousand|grand|k)\b/gi;
const DIGIT_MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|mm|thousand|million|grand)?\b|\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|grand|thousand)\b(?:\s*(?:dollars|bucks))?|\b(\d{1,3}(?:,\d{3})+)\s*(?:dollars|bucks)\b/gi;

function wordsToNumber(words: string): number | null {
  let total = 0;
  let current = 0;
  for (const raw of words.toLowerCase().split(/[- ]+/).filter(Boolean)) {
    if (raw === 'a') { current = current || 1; continue; }
    if (raw === 'hundred') { current = (current || 1) * 100; continue; }
    const value = NUMBER_WORDS[raw];
    if (value == null) return null;
    current += value;
  }
  total += current;
  return total > 0 ? total : null;
}

export interface Amount { start: number; end: number; value: number; text: string }

/** Every money amount in a sentence, in order, with its position. */
export function amountsIn(sentence: string): Amount[] {
  const found: Amount[] = [];
  for (const match of sentence.matchAll(DIGIT_MONEY)) {
    const whole = match[1] ?? match[4] ?? match[7];
    if (!whole) continue;
    const fraction = match[2] ?? match[5] ?? null;
    const unit = (match[3] ?? match[6] ?? '').toLowerCase();
    let value = Number(`${whole.replace(/,/g, '')}${fraction ? `.${fraction}` : ''}`);
    if (!Number.isFinite(value)) continue;
    if (unit === 'k' || unit === 'thousand' || unit === 'grand') value *= 1_000;
    if (unit === 'm' || unit === 'mm' || unit === 'million') value *= 1_000_000;
    // A bare "1.5" or "40" without a dollar sign or unit is acreage or a
    // count, not money; only a formatted thousands group qualifies.
    if (!match[0].includes('$') && !unit && !/,/.test(whole) && !/dollars|bucks/i.test(match[0])) continue;
    if (value < 100) continue;
    found.push({ start: match.index!, end: match.index! + match[0].length, value, text: match[0].trim() });
  }
  for (const match of sentence.matchAll(WORD_NUMBER)) {
    const base = wordsToNumber(match[1]);
    if (base == null) continue;
    found.push({ start: match.index!, end: match.index! + match[0].length, value: base * 1_000, text: match[0].trim() });
  }
  return found.sort((a, b) => a.start - b.start);
}

export const usd = (value: number): string => `$${Math.round(value).toLocaleString('en-US')}`;

const OPERATOR_NUMBER = /\b(you|y'all|you guys|you all|you folks)\s+(mentioned|offered|said|proposed|quoted|suggested|threw out|came in (at|with)|talked about|floated|wrote|texted|put out|are offering|were offering|had offered|have offered|sent|gave|named)\b|\byour\s+(offer|number|figure|price|bid|proposal)\b|\b(the|your|that|an) offer (of|at|for)\b|\b(you|your) (last|first|initial|original|opening) (offer|number)\b/i;
const WITHDRAWN_BEFORE = /\b(forget|scratch|never ?mind|disregard|ignore|instead of|rather than|no longer|was asking|were asking|had (said|asked|wanted|mentioned)|originally|at first|earlier i|earlier we|used to|started at|came down from|down from|previously|my old number|the old number|off the table|no more)\b/i;
const WITHDRAWN_AFTER = /^\s*(is|was|'s)?\s*(off the table|out the window|out|gone|no longer|dead|history|not going to work|doesn'?t (work|stand|hold)|won'?t (work|do)|anymore|any ?more)\b|^\s*any ?more\b|^\s*anymore\b/i;
const NEGATED_BEFORE = /\b(not|n't|never|no way|isn'?t|wasn'?t|won'?t|don'?t|didn'?t|haven'?t|hasn'?t|ain'?t|can'?t|cannot|couldn'?t|wouldn'?t|refuse to)\b/i;
const FLOOR = /\b(at least|minimum|min|no less than|not less than|less than|under|below|lower than|a penny under|a dime under|bottom line|floor|go below|drop below|come down (to|below)|drop to|need at least|nothing less|anything less|rock bottom|lowest)\b/i;
const CEILING = /\b(at most|no more than|max|maximum|top out|up to|ceiling|not a penny over|cap)\b/i;
const APPROX = /\b(around|about|roughly|approximately|ballpark|somewhere (near|around)|ish|or so|give or take|in the neighborhood of|close to|near)\b/i;
const REJECTS = /\b(too low|not enough|no way|won'?t work|can'?t (do|take|accept)|couldn'?t (do|take|accept)|insult|lowball|low-?ball|not (going to|gonna) (work|happen|cut it)|doesn'?t work|not even close|laughable|not interested at|won'?t take|not taking|no thanks|out of the question|non-?starter)\b/i;
const CLAUSE_BOUNDARY = /\b(but|however|though|although|instead|whereas|and|so|because|since|while|then|now)\b|[;,]/gi;

interface AmountRead { amount: Amount; owner: 'seller' | 'operator'; polarity: ClaimPolarity; qualifier: string | null }

function readAmounts(sentence: string): AmountRead[] {
  const amounts = amountsIn(sentence);
  const reads: AmountRead[] = [];
  let previousEnd = 0;
  for (const amount of amounts) {
    let window = sentence.slice(previousEnd, amount.start);
    // A clause boundary resets the window, so "you mentioned $20,000 but I'm
    // looking for $45,000" reads each number by its own clause.
    let lastBoundary = -1;
    for (const match of window.matchAll(CLAUSE_BOUNDARY)) lastBoundary = match.index! + match[0].length;
    if (lastBoundary >= 0) window = window.slice(lastBoundary);
    const after = sentence.slice(amount.end, amount.end + 40);
    const owner: AmountRead['owner'] = OPERATOR_NUMBER.test(window) || /^\s*(you|your)\b.{0,12}\b(offer|mention|said|propos|quot)/i.test(after) ? 'operator' : 'seller';
    let polarity: ClaimPolarity = 'asserted';
    if (WITHDRAWN_BEFORE.test(window) || WITHDRAWN_AFTER.test(after) || (NEGATED_BEFORE.test(window) && /\b(any ?more|anymore|no longer)\b/i.test(after))) polarity = 'withdrawn';
    else if (NEGATED_BEFORE.test(window) && !FLOOR.test(window) && !FLOOR.test(after.slice(0, 12))) polarity = 'negated';
    const qualifier = FLOOR.test(window) || /^\s*(or (more|better|higher|up)|minimum|and up|plus)\b/i.test(after)
      ? 'floor'
      : CEILING.test(window) || /^\s*(or less|max|tops|at most)\b/i.test(after)
        ? 'ceiling'
        : APPROX.test(window) || /^\s*(ish|or so|give or take|range)\b/i.test(after)
          ? 'approx'
          : /^\s*(an|per|a|\/)\s*acre/i.test(after) ? 'per acre' : null;
    reads.push({ amount, owner, polarity, qualifier });
    previousEnd = amount.end;
  }
  return reads;
}

const formatAmount = (read: AmountRead): string =>
  read.qualifier === 'floor' ? `${usd(read.amount.value)} or more`
    : read.qualifier === 'ceiling' ? `${usd(read.amount.value)} at most`
      : read.qualifier === 'approx' ? `about ${usd(read.amount.value)}`
        : read.qualifier === 'per acre' ? `${usd(read.amount.value)} per acre`
          : usd(read.amount.value);

// ── Dimensions ──────────────────────────────────────────────────────────────

const PRICE_WORDS = /\b(asking|ask(ing)? price|price|number in mind|per acre|an acre|top dollar|my number|our number|figure|worth|appraised|appraisal|offer|bid|dollar|value it|counter|bottom line|lowest|highest|take for it|get for it|sell it for|let it go for|cash out|net)\b/i;
const TIMELINE = /\b((?:by|before|after|until|around) (?:the )?(?:end|start|beginning|middle|first|last) of (?:the |this |next )?(?:year|month|quarter|week|summer|winter|spring|fall|autumn|season|school year)|asap|a\.s\.a\.p\.|right away|immediately|within (a|\d+|two|three|four|five|six|ten|thirty|sixty|ninety) ?(days?|weeks?|months?|year)|by (next|end of|the end of|the end|spring|summer|fall|autumn|winter|christmas|thanksgiving|easter|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tax time|the first|year'?s end|year end|the holidays)|this (month|week|year|spring|summer|fall|winter)|next (month|week|year|spring|summer|fall|winter|quarter)|in a hurry|no hurry|no rush|not in a (hurry|rush)|whenever|take (my|our) time|flexible on (timing|time|the date|dates)|before (the )?(end|year|winter|spring|summer|fall|taxes|christmas|holidays|school)|(spring|summer|fall|autumn|winter)\b|(january|february|march|april|june|july|august|september|october|november|december)\b|\d+ ?(days?|weeks?|months?)\b|close (quickly|fast|soon|right away)|as soon as|sooner the better|first of the year|tax time|after (the )?(holidays|new year|harvest|probate|closing|the survey)|end of (the )?(month|year|quarter|summer|season)|(30|45|60|90|120)[- ]day|timeline|time ?frame|deadline|no deadline|open-?ended|not in any rush|at some point|down the road|eventually|soon)\b/i;
const DECISION_PERSON = /\b(wife|husband|spouse|partner|brother|sister|brothers|sisters|son|daughter|kids|children|mother|father|mom|dad|parents|family|siblings?|heirs?|executor|executrix|trustee|trust|estate|attorney|lawyer|power of attorney|poa|co-?owners?)\b/i;
const DECISION_CONTEXT = /\b(has to|have to|had to|needs? to|need to|must|sign|signs|signed|signing|agree|agrees|approve|approves|decide|decides|decision|on the (title|deed)|involved|say in|say-so|okay with|ok with|on board|co-?own|both of us|all of us|we (both|all)|up to|(his|her|their) call|consult|run it by|check with|ask (my|the|his|her)|talk (to|with) (my|the|his|her)|part of the decision|in on (this|it)|final say|blessing|permission|wants? to (keep|sell)|doesn'?t want|handles|handling|manages|in charge)\b/i;
const DECISION_STRONG = /\b(heirs?|executor|executrix|trustee|power of attorney|poa|co-?owners?|on the (title|deed)|sole owner|only one on|only name on|just my name|nobody else|no one else|in my name|my call|up to me|i decide|my decision|i'?m the only)\b/i;
const DECISION_MAKER = { test: (text: string): boolean => DECISION_STRONG.test(text) || (DECISION_PERSON.test(text) && DECISION_CONTEXT.test(text)), source: DECISION_PERSON.source, flags: 'i' } as unknown as RegExp;
const MOTIVATION = /\b(motivat|why .{0,12}sell|reason .{0,12}sell|behind on|inherit|relocat|divorc|retir|tired of|moving|estate|burden|don'?t need|never use|no use for|too far|medical|paying taxes on|taxes (are|keep|just) |health|passed away|passed on|died|nursing home|downsiz|need the (money|cash)|need cash|bills|debt|liquidat|never going to (build|use|do)|kids don'?t want|can'?t (keep|maintain|afford)|maintenance|upkeep|headache|free up|college|wedding|simplify|get rid of|off (my|our) hands|off (my|our) plate|don'?t want (it|the land|to deal)|no plans for|sitting there|doing nothing with|not using|dream (died|changed)|circumstances)/i;
const COMMITMENT = /\b(will send|will call|will get|will email|will text|will check|will look|will ask|will talk|will let|will have|will forward|will scan|will mail|will drop|will bring|will find|will dig|i'?ll (send|call|get|email|text|check|ask|look|talk|let|have|forward|scan|mail|drop|bring|find|dig|pull|grab|shoot|see)|we'?ll (send|call|get|email|text|check|ask|look|talk|let|have|forward|scan|mail|drop|bring|find|dig|pull|grab|shoot|see)|going to (send|call|get|email|text|check|ask|look|talk|forward|scan|find|dig)|gonna (send|call|get|email|text|check|ask|look|talk)|agreed to|promise|send (me|you|it|over|the|that|those|them|a copy|copies|pictures|photos)|get back to (me|you)|follow up|call (me|you) back|let (me|you) know|forward (it|the|that|you)|scan (it|the|that)|dig (it|them|that) (up|out)|find the|track down|talk to (my|the|his|her)|ask (my|the|his|her)|run it by|check with|get (it|them|that|those) to you|drop (it|them) off|put (it|them) in the mail|text (it|them|you)|email (it|them|you)|can send|could send|happy to send|glad to send|willing to send|could (call|email|text|forward|scan|check|ask|look|get)|can (call|email|text|forward|scan|check|ask|look|get))\b/i;
const CONSTRAINT = /\b(lien|back tax|delinquent|probate|mortgage|landlock|no access|dispute|title (issue|problem|is)|cloud on|won'?t (sell|take|go|accept|do|split|part with)|can'?t (sell|close|split)|only if|must (keep|retain|have)|need to keep|retain(ing)? the|not (interested|selling|ready|looking to sell|going to sell)|no longer (want|interested)|other (offer|buyer|party)|someone else|another (buyer|offer|party)|listed with|realtor|agent|under contract|life estate|right of first refusal|hunting lease|lease|tenant|mineral rights|timber (contract|rights)|owe|owed|payoff|judgment|hoa|deed restriction|changed (my|our) mind|off the market|keep it in the family|sentimental|hold off|holding off|not right now|not at this time|reconsider|open to (selling|an offer|offers|talking)|willing to sell|ready to sell|let'?s talk|would consider|do want to sell|want to move forward|thought about it|talked it over|need (a|the) (survey|appraisal|attorney) first|contingent|subject to|1031|exchange|owner financ|seller financ|terms)\b/i;
const PROPERTY_CLAIM = /\b(acres?|acreage|road|access|easement|right of way|well|septic|perc|power|electric|water|utilit|zon|flood|wetland|survey|boundar|fence|clear|wood|creek|pond|build|structure|mobile|house|barn|driveway|gate|culvert|deed|plat|county|permit|drain|dry|high ground|timber|pasture|farm|hunting|neighbor|corner|pins?|stakes?|sold|sale|went for|listed|appraisal|appraised|frontage|paved|gravel|dirt road|soil|rock|slope|hill|bottom ?land|swamp|lake|river|pole|meter|gas line|sewer|city water|lot|parcel|tract)\b/i;
const OPERATOR_QUESTION = /\?\s*$/;

const NOT_SELLING = /\b(not (interested|selling|ready|looking to sell|going to sell)|no longer (want|interested)|off the market|hold(ing)? off|not right now|not at this time|keep it in the family|won'?t (sell|part with)|can'?t sell|decided (not to|against)|changed (my|our) mind about selling|no thanks)\b/i;
const REOPEN = /\b(changed (my|our) mind|reconsider(ed)?|thought about it|talked it over|open to (selling|an offer|offers|talking)|willing to sell|ready to sell|let'?s talk|would consider|i'?ll sell|we'?ll sell|do want to sell|want to move forward|go ahead|back on|interested after all|make (me|us) an offer|send (me|us) an offer)\b/i;
const NOBODY_ELSE = /\b(only one on|only name on|sole owner|just me|just my name|nobody else|no one else|in my name|it'?s my call|up to me|i decide|my decision|i'?m the only)\b/i;

const CONDITIONAL = /\b(if|as long as|provided (that )?|assuming|unless|depending on|depends on|contingent on|once (the|we|i|you|my)|after (the|we|i|you|my)|when (the|we|i|you|my)|only if|so long as|subject to)\b/i;
const PROPOSAL_TAIL = /\b(if you (want|like|need|'d like|would like|think)|if that helps|if that'?s (helpful|useful|easier)|if needed|if necessary|if you'?d rather|if it helps)\b/i;
const UNCERTAIN = /\b(i think|i believe|maybe|may (need|have|be|want|end up)|might|possibly|probably|not sure|i guess|perhaps|could be|i'?d have to (check|ask|see|look)|not certain|unsure|we'?ll see|it depends|hard to say|i suppose|can'?t say for sure|don'?t know (if|whether|yet)|not positive|i'?m not (sure|certain))\b/i;
const FIRM_COMMITMENT = /\b(i will|i'll|we will|we'll|going to|gonna|i promise|for sure|definitely|absolutely|tomorrow|tonight|today|this (afternoon|evening|week)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|end of|the end|friday)|first thing|right after|as soon as i)\b/i;
const PROPOSED = /\b(i could|i can|i might|we could|we can|happy to|i'?d be (happy|willing|glad)|let me know if|would you like|do you want me to|i'?m willing|if you want|if you'd like|could send|can send|could get|can get)\b/i;

function modalityOf(text: string, dimension: SellerClaimDimension): { modality: ClaimModality; condition: string | null } {
  if (UNCERTAIN.test(text)) return { modality: 'uncertain', condition: conditionOf(text) };
  if (dimension === 'commitment' && PROPOSAL_TAIL.test(text)) return { modality: 'proposed', condition: null };
  const condition = conditionOf(text);
  if (condition) return { modality: 'conditional', condition };
  if (dimension === 'commitment' && PROPOSED.test(text) && !FIRM_COMMITMENT.test(text)) return { modality: 'proposed', condition: null };
  return { modality: 'firm', condition: null };
}

function conditionOf(text: string): string | null {
  const match = CONDITIONAL.exec(text);
  if (!match) return null;
  // "if you want" is a proposal marker, not a condition on the seller's position.
  if (PROPOSAL_TAIL.test(text.slice(match.index))) return null;
  const rest = text.slice(match.index + match[0].length).replace(/^\s*(that|the fact that)\s+/i, '');
  const clause = rest.split(/[,.;]| then | so /i)[0]?.trim();
  return clause && clause.length >= 3 ? clause.replace(/[.!?]+$/, '') : null;
}

function valueFor(dimension: SellerClaimDimension, text: string): string | null {
  const pick = (rx: RegExp): string | null => {
    const match = new RegExp(rx.source, rx.flags.replace('g', '')).exec(text);
    return match ? match[0].toLowerCase().replace(/\s+/g, ' ').trim() : null;
  };
  switch (dimension) {
    case 'timeline': return pick(TIMELINE);
    case 'decision_maker': {
      if (NOBODY_ELSE.test(text)) return 'seller decides alone';
      const people = [...text.matchAll(/\b(wife|husband|spouse|partner|brother|sister|brothers|sisters|son|daughter|kids|children|mother|father|mom|dad|parents|family|siblings?|heirs?|executor|executrix|trustee|trust|estate|attorney|lawyer|power of attorney|co-?owners?)\b/gi)].map((match) => match[0].toLowerCase());
      return people.length ? [...new Set(people)].join(', ') : pick(DECISION_MAKER);
    }
    case 'motivation': return pick(MOTIVATION);
    case 'constraint': return NOT_SELLING.test(text) && !REOPEN.test(text) ? 'not selling' : REOPEN.test(text) ? 'not selling' : pick(CONSTRAINT);
    case 'commitment': return pick(COMMITMENT);
    default: return null;
  }
}

/**
 * The findings one attributed utterance carries. At most two seller
 * dimensions, in order of specificity, plus `property_claim` whenever the
 * sentence describes the land.
 */
export function findingsIn(text: string, speaker: SpeakerRole): Finding[] {
  const findings: Finding[] = [];
  const isSellerVoice = speaker === 'seller' || speaker === 'seller_party';
  // In the operator's record a trailing question is the operator's question;
  // in the seller's own words a question can carry a position ("would you do
  // $45,000?").
  if (!isSellerVoice && OPERATOR_QUESTION.test(text)) return findings;

  const amounts = readAmounts(text);
  const sellerAmounts = amounts.filter((read) => read.owner === 'seller');
  const operatorValues = amounts.filter((read) => read.owner === 'operator').map((read) => usd(read.amount.value));
  const hasPriceWords = PRICE_WORDS.test(text);

  if (sellerAmounts.length || (hasPriceWords && (!amounts.length || operatorValues.length))) {
    const asserted = sellerAmounts.filter((read) => read.polarity === 'asserted');
    const withdrawn = sellerAmounts.filter((read) => read.polarity === 'withdrawn');
    const negated = sellerAmounts.filter((read) => read.polarity === 'negated');
    const { modality, condition } = modalityOf(text, 'price');
    if (asserted.length) {
      findings.push({ dimension: 'price', value: formatAmount(asserted[0]), polarity: 'asserted', modality, condition, withdraws: withdrawn.map((read) => usd(read.amount.value)), operatorValues });
    } else if (withdrawn.length) {
      findings.push({ dimension: 'price', value: usd(withdrawn[0].amount.value), polarity: 'withdrawn', modality, condition, withdraws: withdrawn.map((read) => usd(read.amount.value)), operatorValues });
    } else if (negated.length) {
      findings.push({ dimension: 'price', value: usd(negated[0].amount.value), polarity: 'negated', modality, condition, withdraws: [], operatorValues });
    } else if (operatorValues.length && REJECTS.test(text)) {
      // The seller rejected the operator's number without naming their own.
      findings.push({ dimension: 'price', value: operatorValues[0], polarity: 'negated', modality, condition, withdraws: [], operatorValues });
    } else if (!operatorValues.length && hasPriceWords) {
      // A price position without an amount ("I don't have a number in mind",
      // "I want top dollar"). Kept as the seller's stance on price.
      findings.push({ dimension: 'price', value: null, polarity: 'asserted', modality, condition, withdraws: [], operatorValues });
    }
  }

  const rest: Array<{ dimension: SellerClaimDimension; rx: RegExp }> = [
    { dimension: 'timeline', rx: TIMELINE },
    { dimension: 'decision_maker', rx: DECISION_MAKER },
    { dimension: 'motivation', rx: MOTIVATION },
    { dimension: 'commitment', rx: COMMITMENT },
    { dimension: 'constraint', rx: CONSTRAINT },
  ];
  for (const detector of rest) {
    if (findings.length >= 2) break;
    if (!detector.rx.test(text)) continue;
    // "in a hurry to sell because …" is motivation and timeline; "my sister has
    // to sign" must not also read as a commitment because of "has to".
    if (detector.dimension === 'commitment' && findings.some((finding) => finding.dimension === 'decision_maker')) continue;
    const { modality, condition } = modalityOf(text, detector.dimension);
    let polarity: ClaimPolarity = 'asserted';
    let value = valueFor(detector.dimension, text);
    if (detector.dimension === 'constraint' && REOPEN.test(text) && !(NOT_SELLING.test(text) && !/\bnot\b.{0,20}\banymore\b/i.test(text))) {
      polarity = 'withdrawn';
      value = 'not selling';
    }
    if (detector.dimension === 'decision_maker' && /\b(doesn'?t|does not|won'?t|no longer|don'?t|do not) (need|have) to (sign|agree|approve|be involved|be on board)\b/i.test(text) && value !== 'seller decides alone') {
      polarity = 'negated';
    }
    if (detector.dimension === 'timeline' && /\b(forget|scratch|never ?mind|no longer|not going to work|won'?t work|off the table|doesn'?t work) (about |for |with )?(the )?(spring|summer|fall|winter|next month|this month|next week|this year|next year|[a-z]+ (month|week))\b/i.test(text)) {
      polarity = 'withdrawn';
    }
    findings.push({ dimension: detector.dimension, value, polarity, modality, condition, withdraws: [], operatorValues: [] });
  }

  if (PROPERTY_CLAIM.test(text)) {
    const { modality, condition } = modalityOf(text, 'property_claim');
    findings.push({ dimension: 'property_claim', value: null, polarity: 'asserted', modality, condition, withdraws: [], operatorValues: [] });
  }
  return findings;
}

// ── Confidence ──────────────────────────────────────────────────────────────

const step = (confidence: ClaimConfidence): ClaimConfidence => (confidence === 'high' ? 'medium' : 'low');

/** How much a claim may be leaned on: who spoke it, how directly, how firmly. */
export function confidenceFor(input: {
  speaker: SpeakerRole;
  method: 'recorded_field' | 'text_match';
  implicitSubject: boolean;
  modality: ClaimModality;
  /** A seller-stated-fact row: the operator's after-the-fact record. */
  afterTheFact?: boolean;
}): ClaimConfidence {
  let confidence: ClaimConfidence = input.speaker === 'seller' || input.speaker === 'seller_party'
    ? 'high'
    : input.implicitSubject || input.afterTheFact ? 'low' : 'medium';
  if (input.method === 'recorded_field' && confidence === 'high') confidence = 'medium';
  if (input.modality === 'uncertain') confidence = 'low';
  else if (input.modality === 'conditional' || input.modality === 'proposed') confidence = step(confidence);
  return confidence;
}
