// Stage 4 seller-language behaviour: realistic seller communications, read
// deterministically. Every fixture is source-bound — the claim must carry the
// communication it came from, who spoke, the exact excerpt, its confidence and
// whether a later communication superseded it — and every refusal must be a
// refusal, not a silent drop.

import { describe, expect, it } from 'vitest';

import type { AcquisitionState, CommLogEntry } from './acquisitions.js';
import { buildSellerDiscovery, type SellerClaim } from './seller-discovery.js';

const comm = (entry: Partial<CommLogEntry> & Pick<CommLogEntry, 'id' | 'at' | 'channel' | 'direction' | 'summary'>): CommLogEntry => ({
  createdAt: entry.at, ...entry,
});

const inbound = (id: string, at: string, body: string): CommLogEntry =>
  comm({ id, at, type: 'text', channel: 'text', direction: 'inbound', summary: 'Seller replied by text.', body });

const outbound = (id: string, at: string, body: string): CommLogEntry =>
  comm({ id, at, type: 'text', channel: 'text', direction: 'outbound', summary: 'Operator texted the seller.', body });

const transcript = (id: string, at: string, body: string): CommLogEntry =>
  comm({ id, at, type: 'transcript', channel: 'call', direction: 'outbound', summary: 'Call transcript.', body });

const callSummary = (id: string, at: string, summary: string, notes?: string): CommLogEntry =>
  comm({ id, at, type: 'call', channel: 'call', direction: 'outbound', summary, notes });

const note = (id: string, at: string, body: string): CommLogEntry =>
  comm({ id, at, type: 'note', channel: 'other', direction: 'outbound', summary: body, body });

function discoveryOf(commLog: CommLogEntry[], profile: AcquisitionState['profile'] = { name: 'Mary Alvarez' }) {
  return buildSellerDiscovery({
    dealCardId: 900,
    acquisition: { stage: 'needs_discovery', profile, commLog, discovery: [] },
    property: null,
    market: null,
  });
}

const claimsOf = (commLog: CommLogEntry[], dimension: SellerClaim['dimension']): SellerClaim[] =>
  discoveryOf(commLog).claims.filter((claim) => claim.dimension === dimension);

// ── 1. Whose number it is ───────────────────────────────────────────────────

describe('1. the seller\'s asking price versus a price the operator mentioned', () => {
  it('reads the seller\'s number from a labelled transcript and refuses the operator\'s turn', () => {
    const d = discoveryOf([transcript('t1', '2026-09-02T15:00:00.000Z', [
      'Operator: Thanks for calling back. Would you consider something around $20,000 for the piece?',
      'Mary: No, that is too low for us. We are asking $45,000 and that is already less than what the neighbor got.',
      'Operator: Understood, let me take that back to my partner.',
    ].join('\n'))]);
    expect(d.extraction.price.latest?.value).toBe('$45,000');
    expect(d.extraction.price.latest?.speaker).toEqual({ role: 'seller', label: 'Mary' });
    expect(d.extraction.price.latest?.confidence).toBe('high');
    expect(d.claims.some((claim) => claim.value === '$20,000' && claim.polarity === 'asserted')).toBe(false);
    const refused = d.refusals.find((refusal) => /\$20,000/.test(refusal.excerpt ?? ''));
    expect(refused?.reason).toMatch(/operator's own turn/i);
  });

  it('inside one seller sentence, "you mentioned $20,000" stays the operator\'s number', () => {
    const [price] = claimsOf([inbound('m1', '2026-09-02T15:00:00.000Z', 'You mentioned $20,000 but honestly I am looking for $45,000.')], 'price');
    expect(price.value).toBe('$45,000');
    expect(price.polarity).toBe('asserted');
  });

  it('a rejection of the operator\'s number without a counter is a negated price, not a position', () => {
    const d = discoveryOf([
      outbound('o1', '2026-09-02T14:00:00.000Z', 'Would you take $20,000 for the land?'),
      inbound('m1', '2026-09-02T15:00:00.000Z', 'Your offer of $20,000 is way too low, not even close.'),
    ]);
    expect(d.extraction.price.latest).toBeNull();
    const negated = d.claims.find((claim) => claim.dimension === 'price');
    expect(negated?.polarity).toBe('negated');
    expect(negated?.value).toBe('$20,000');
    expect(d.unanswered).toContain('price');
  });
});

// ── 2. Corrections and withdrawals ──────────────────────────────────────────

describe('2. the seller rejecting, correcting or withdrawing an earlier price', () => {
  it('a later "forget the $45,000, I\'d take $38,000" supersedes the earlier price and keeps it as history', () => {
    const d = discoveryOf([
      inbound('m1', '2026-09-02T15:00:00.000Z', 'We were hoping to get $45,000 for it.'),
      inbound('m2', '2026-09-09T10:00:00.000Z', 'Forget the $45,000, I would take $38,000 if we can close quickly.'),
    ]);
    const latest = d.extraction.price.latest!;
    expect(latest.value).toBe('$38,000');
    expect(latest.modality).toBe('conditional');
    expect(latest.condition).toMatch(/close quickly/);
    const earlier = d.claims.find((claim) => claim.value === '$45,000')!;
    expect(earlier.status).toBe('historical');
    expect(earlier.supersededBy).toBe(latest.claimId);
    expect(earlier.supersessionReason).toMatch(/withdrew|replaced/);
    expect(d.conflicts).toEqual([expect.objectContaining({ dimension: 'price', earlier: expect.objectContaining({ value: '$45,000' }), later: expect.objectContaining({ value: '$38,000' }) })]);
    expect(d.extraction.price.historical).toBe(1);
  });

  it('a floor is an assertion: "I won\'t take less than $40,000" is $40,000 or more', () => {
    const [price] = claimsOf([inbound('m1', '2026-09-02T15:00:00.000Z', "I won't take less than $40,000 for it, that is my bottom line.")], 'price');
    expect(price.polarity).toBe('asserted');
    expect(price.value).toBe('$40,000 or more');
  });
});

// ── 3. Negation ─────────────────────────────────────────────────────────────

describe('3. negation', () => {
  it('"I am not asking $28,000" is recorded as a negation and never becomes the price position', () => {
    const d = discoveryOf([inbound('m1', '2026-09-02T15:00:00.000Z', 'I am not asking $28,000, I never said that number.')]);
    const [price] = d.claims.filter((claim) => claim.dimension === 'price');
    expect(price.polarity).toBe('negated');
    expect(price.value).toBe('$28,000');
    expect(d.extraction.price.latest).toBeNull();
    expect(d.unanswered).toContain('price');
    expect(d.brief.questions.find((question) => question.key === 'price')?.answeredBy).toEqual([]);
  });

  it('a later denial supersedes the operator\'s earlier record of that number', () => {
    const d = discoveryOf([
      callSummary('c1', '2026-09-02T15:00:00.000Z', 'Mary said she wants $28,000 for the land.'),
      inbound('m2', '2026-09-05T15:00:00.000Z', 'I am not asking $28,000. I do not know where you got that.'),
    ]);
    const recorded = d.claims.find((claim) => claim.source.id === 'c1' && claim.dimension === 'price')!;
    expect(recorded.speaker.role).toBe('operator_record');
    expect(recorded.status).toBe('historical');
    expect(recorded.supersessionReason).toMatch(/denied/);
    expect(d.extraction.price.latest).toBeNull();
  });
});

// ── 4. Conditional language ─────────────────────────────────────────────────

describe('4. conditional language', () => {
  it('"I could close next month if the survey comes back clean" is a conditional timeline at lowered confidence', () => {
    const [timeline] = claimsOf([inbound('m1', '2026-09-02T15:00:00.000Z', 'I could close next month if the survey comes back clean.')], 'timeline');
    expect(timeline.value).toBe('next month');
    expect(timeline.modality).toBe('conditional');
    expect(timeline.condition).toMatch(/survey comes back clean/);
    expect(timeline.confidence).toBe('medium');
    expect(timeline.polarity).toBe('asserted');
  });
});

// ── 5. Uncertain language ───────────────────────────────────────────────────

describe('5. uncertain language', () => {
  it('"I think my brother may need to sign" is an uncertain decision-maker claim at low confidence', () => {
    const [who] = claimsOf([inbound('m1', '2026-09-02T15:00:00.000Z', 'I think my brother may need to sign too, I would have to check.')], 'decision_maker');
    expect(who.value).toBe('brother');
    expect(who.modality).toBe('uncertain');
    expect(who.confidence).toBe('low');
    expect(who.weight).toBe('likely');
    expect(who.status).toBe('current');
  });
});

// ── 6. Multiple speakers ────────────────────────────────────────────────────

describe('6. multiple speakers and decision makers', () => {
  const call = transcript('t1', '2026-09-02T15:00:00.000Z', [
    'Operator: Who all needs to be part of this decision?',
    'Mary: It is really up to my brother Tom and me, we are both on the deed.',
    'Tom (brother): I am fine selling, but I want it done before winter.',
    'Operator: That works.',
  ].join('\n'));

  it('attributes each turn to its speaker and keeps the second party distinct from the seller', () => {
    const d = discoveryOf([call]);
    const mary = d.claims.find((claim) => claim.dimension === 'decision_maker' && claim.speaker.role === 'seller')!;
    expect(mary.speaker.label).toBe('Mary');
    expect(mary.value).toBe('brother');
    const tom = d.claims.find((claim) => claim.speaker.role === 'seller_party')!;
    expect(tom.speaker.label).toBe('Tom');
    expect(tom.dimension).toBe('timeline');
    expect(tom.value).toBe('before winter');
    expect(d.claims.every((claim) => ['seller', 'seller_party'].includes(claim.speaker.role))).toBe(true);
  });

  it('an unlabelled transcript refuses first-person speech rather than guessing who said it', () => {
    const d = discoveryOf([transcript('t2', '2026-09-02T15:00:00.000Z', 'I am asking $45,000. I could go a little lower for a quick close.')]);
    expect(d.claims).toHaveLength(0);
    expect(d.refusals.map((refusal) => refusal.reason).join(' ')).toMatch(/cannot be attributed; label the speakers/);
  });
});

// ── 7. Motivation: stated versus inferred ───────────────────────────────────

describe('7. motivation stated by the seller versus inferred by the operator', () => {
  it('keeps the seller\'s stated motivation and refuses the operator\'s inference and note', () => {
    const d = discoveryOf([
      inbound('m1', '2026-09-02T15:00:00.000Z', 'Honestly we are tired of paying taxes on land we never use.'),
      callSummary('c2', '2026-09-04T15:00:00.000Z', 'Spoke with Mary about timing. She is probably motivated by the back taxes, my guess is she would take less.'),
      note('n3', '2026-09-05T15:00:00.000Z', 'I think she is motivated by the delinquent taxes; the county shows two years owed.'),
    ]);
    const motivations = d.claims.filter((claim) => claim.dimension === 'motivation');
    expect(motivations).toHaveLength(1);
    expect(motivations[0].source.id).toBe('m1');
    expect(motivations[0].speaker.role).toBe('seller');
    expect(d.refusals.some((refusal) => /inference/.test(refusal.reason) && /probably motivated/.test(refusal.excerpt ?? ''))).toBe(true);
    expect(d.refusals.some((refusal) => /Operator note/.test(refusal.record))).toBe(true);
    expect(d.claims.some((claim) => claim.source.id === 'n3')).toBe(false);
  });

  it('the operator\'s explicit record of seller speech is carried, at lower confidence than the seller\'s words', () => {
    const d = discoveryOf([callSummary('c1', '2026-09-02T15:00:00.000Z', 'She said her husband passed away last year and the land is a burden now.')]);
    const [motivation] = d.claims.filter((claim) => claim.dimension === 'motivation');
    expect(motivation.speaker.role).toBe('operator_record');
    expect(motivation.confidence).toBe('medium');
    expect(motivation.status).toBe('current');
  });
});

// ── 8. Proposal versus commitment ───────────────────────────────────────────

describe('8. a proposed action versus a firm seller commitment', () => {
  it('"I could send you the old survey if you want" is a proposal; "I\'ll scan the deed and email it tomorrow" is firm', () => {
    const d = discoveryOf([
      inbound('m1', '2026-09-02T15:00:00.000Z', 'I could send you the old survey if you want.'),
      inbound('m2', '2026-09-03T15:00:00.000Z', 'I will scan the deed and email it tomorrow.'),
    ]);
    const proposed = d.claims.find((claim) => claim.source.id === 'm1' && claim.dimension === 'commitment')!;
    const firm = d.claims.find((claim) => claim.source.id === 'm2' && claim.dimension === 'commitment')!;
    expect(proposed.modality).toBe('proposed');
    expect(proposed.confidence).toBe('medium');
    expect(firm.modality).toBe('firm');
    expect(firm.confidence).toBe('high');
    expect(d.extraction.commitment.latest?.claimId).toBe(firm.claimId);
  });
});

// ── 9. Conflicts across communications ──────────────────────────────────────

describe('9. conflicting statements across two dated communications', () => {
  it('the later timeline governs, the earlier one is retained as history with its date, and the conflict is listed', () => {
    const d = discoveryOf([
      inbound('m1', '2026-09-02T15:00:00.000Z', 'We need this closed by spring.'),
      inbound('m2', '2026-09-10T15:00:00.000Z', 'Actually we are in no rush now that the estate is settled.'),
    ]);
    const timelines = d.claims.filter((claim) => claim.dimension === 'timeline');
    expect(timelines).toHaveLength(2);
    const later = d.extraction.timeline.latest!;
    expect(later.source.id).toBe('m2');
    expect(later.value).toBe('no rush');
    const earlier = timelines.find((claim) => claim.source.id === 'm1')!;
    expect(earlier.status).toBe('historical');
    expect(earlier.source.at).toBe('2026-09-02T15:00:00.000Z');
    expect(earlier.supersededBy).toBe(later.claimId);
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0]).toMatchObject({ dimension: 'timeline', earlier: { value: 'by spring', at: '2026-09-02T15:00:00.000Z' }, later: { value: 'no rush' } });
    expect(d.extraction.timeline.current).toBe(1);
    expect(d.extraction.timeline.historical).toBe(1);
  });

  it('"talked it over with my sister" without an earlier refusal is not a withdrawn refusal, and a full date phrase is kept whole', () => {
    const d = discoveryOf([inbound('m1', '2026-09-03T09:30:00.000Z', 'Talked it over with my sister. We would take $82,000 if you can close before the end of the year.')]);
    expect(d.claims.some((claim) => claim.dimension === 'constraint')).toBe(false);
    expect(d.extraction.price.latest?.value).toBe('$82,000');
    expect(d.extraction.timeline.latest?.value).toBe('before the end of the year');
    expect(d.extraction.timeline.latest?.modality).toBe('conditional');
  });

  it('a withdrawn refusal to sell reopens the deal and the refusal becomes history', () => {
    const d = discoveryOf([
      inbound('m1', '2026-09-02T15:00:00.000Z', 'I am not interested in selling right now.'),
      inbound('m2', '2026-09-20T15:00:00.000Z', 'I have thought about it and talked it over with my wife, we are open to an offer.'),
    ]);
    const refusal = d.claims.find((claim) => claim.source.id === 'm1' && claim.dimension === 'constraint')!;
    expect(refusal.value).toBe('not selling');
    expect(refusal.status).toBe('historical');
    expect(d.extraction.constraint.latest?.value ?? null).not.toBe('not selling');
  });
});

// ── 10. Refused sources ─────────────────────────────────────────────────────

describe('10. sources that can never carry a seller claim', () => {
  it('outbound operator messages, operator notes, quoted operator text and CRM profile fields are refused', () => {
    const d = buildSellerDiscovery({
      dealCardId: 900,
      acquisition: {
        stage: 'needs_discovery',
        profile: { name: 'Mary Alvarez', motivation: 'Seems motivated (typed by operator)', askingPrice: '$50,000', decisionMakers: 'Husband' },
        commLog: [
          outbound('o1', '2026-09-01T15:00:00.000Z', 'Hi Mary, would you take $20,000? We could close by spring.'),
          note('n1', '2026-09-01T16:00:00.000Z', 'County record shows a $4,200 tax lien; she probably needs to sell before the certificate sale.'),
          inbound('m1', '2026-09-02T15:00:00.000Z', 'Let me think about it.\n> Hi Mary, would you take $20,000? We could close by spring.'),
        ],
        discovery: [],
      },
      property: null,
      market: null,
      askingPrice: 50_000,
    });
    expect(d.claims).toHaveLength(0);
    expect(d.unanswered).toEqual(['motivation', 'price', 'timeline', 'decision_maker', 'constraint', 'commitment']);
    expect(d.refusals.map((refusal) => refusal.record).join(' | ')).toMatch(/Outbound text/);
    expect(d.refusals.map((refusal) => refusal.record).join(' | ')).toMatch(/Operator note/);
    expect(d.operatorProfileNotes.map((entry) => entry.field)).toEqual(['motivation', 'askingPrice', 'decisionMakers']);
    expect(d.limitations.join(' ')).toMatch(/carry no claim weight/);
  });
});

// ── 11. Seller-reported property facts ──────────────────────────────────────

describe('11. seller-reported property facts stay seller claims', () => {
  it('an easement the seller describes is a seller-reported property claim, never a property fact', () => {
    const d = discoveryOf([inbound('m1', '2026-09-02T15:00:00.000Z', 'There is a recorded easement across the neighbor to the road, and power is at the pole.')]);
    const [claim] = d.claims.filter((entry) => entry.dimension === 'property_claim');
    expect(claim.standing).toBe('seller_reported');
    expect(claim.speaker.role).toBe('seller');
    expect(d.limitations.join(' ')).toMatch(/never change the Property Story/);
    expect(d.brief.doNotAssume.join(' ')).toMatch(/seller-reported facts are leads for diligence/);
  });
});

// ── 12. Source binding on every claim ───────────────────────────────────────

describe('12. every extracted claim is source-bound', () => {
  it('carries communication id, date, speaker, excerpt, confidence and current-versus-historical status', () => {
    const d = discoveryOf([
      inbound('m1', '2026-09-02T15:00:00.000Z', 'We inherited it from my dad. We were hoping to get $45,000. My sister has to agree too.'),
      transcript('t2', '2026-09-06T15:00:00.000Z', 'Operator: Any movement on price?\nMary: Forget the $45,000, I would take $40,000 and I will send the survey tonight.'),
    ]);
    expect(d.claims.length).toBeGreaterThanOrEqual(5);
    for (const claim of d.claims) {
      expect(claim.source.id).toMatch(/^(m1|t2)$/);
      expect(claim.source.at).toMatch(/^2026-09-0[26]T15:00:00\.000Z$/);
      expect(['seller', 'seller_party', 'operator_record']).toContain(claim.speaker.role);
      expect(claim.speaker.label.length).toBeGreaterThan(0);
      expect(claim.excerpt.length).toBeGreaterThan(8);
      expect(['high', 'medium', 'low']).toContain(claim.confidence);
      expect(['current', 'historical']).toContain(claim.status);
      expect(claim.standing).toBe('seller_reported');
    }
    // "inherited from my dad" is a motivation, not a decision maker.
    expect(d.claims.some((claim) => claim.dimension === 'decision_maker' && /dad/.test(claim.value ?? ''))).toBe(false);
    expect(d.extraction.decision_maker.latest?.value).toBe('sister');
    expect(d.extraction.price.latest?.value).toBe('$40,000');
    expect(d.claims.find((claim) => claim.value === '$45,000')?.status).toBe('historical');
    expect(d.extraction.commitment.latest?.modality).toBe('firm');
    // Newest first for the reader.
    expect(d.claims[0].source.id).toBe('t2');
  });
});
