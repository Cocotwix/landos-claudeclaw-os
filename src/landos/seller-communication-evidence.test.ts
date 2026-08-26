import { describe, expect, it } from 'vitest';

import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import { sellerLayerFingerprint } from './intelligence-stack.js';

// Seller communication evidence plumbing: the Seller specialist must receive
// the actual authorized communication record — full transcripts, message and
// email bodies, labeled operator notes — chronologically, never a pile of
// 500-char CRM chops. These tests prove the plumbing with fixtures; no
// production deal data is involved.

const now = () => new Date('2026-08-26T00:00:00.000Z');

const TRANSCRIPT = [
  'OPERATOR: Thanks for taking the time today. Tell me about the land.',
  'SELLER: We inherited it from my father in 2019. It has sat empty since.',
  'OPERATOR: Is there anything on the property?',
  'SELLER: Just an old pole barn on the north corner. No well, no septic.',
  'SELLER: We were hoping to get somewhere around one forty for it.',
  'OPERATOR: Understood. Who besides you would need to sign off?',
  'SELLER: My sister is on the deed too. She lives in Ohio.',
].join('\n');
const LONG_FILLER = ' The conversation continued in detail about access, timing, and family history.'.repeat(30);
const FULL_TRANSCRIPT = `${TRANSCRIPT}${LONG_FILLER}\nSELLER: Anyway, call my sister before you send anything in writing.`;

function file(commLog: unknown[], extra: Record<string, unknown> = {}): PropertyFileSource {
  return {
    dealCardId: 4242,
    propertyCardId: null,
    now,
    dealCard: { people: [{ name: 'Sam Seller', role: 'seller', primary_contact: true }], asking_price: 140_000 },
    acquisition: {
      stage: 'needs_follow_up',
      profile: { name: 'Sam Seller', motivation: 'Inherited, unused' },
      commLog,
      discovery: [],
      ...extra,
    },
  } as unknown as PropertyFileSource;
}

describe('A. full call transcripts', () => {
  it('carries the verbatim transcript without a 500-char chop, preserving speaker lines and chronology', () => {
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-20T17:00:00.000Z', type: 'transcript', channel: 'call', direction: 'inbound', summary: FULL_TRANSCRIPT.replace(/\s+/g, ' ').slice(0, 500), body: FULL_TRANSCRIPT, createdAt: '2026-08-20T17:30:00.000Z' },
      { at: '2026-08-01T12:00:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Seller replied asking who we are', createdAt: '2026-08-01T12:01:00.000Z' },
    ])).seller;
    expect(seller.communications).toHaveLength(2);
    // Chronology oldest → newest.
    expect(seller.communications.map((entry) => entry.type)).toEqual(['text', 'transcript']);
    const transcript = seller.communications[1];
    expect(transcript.body).not.toBeNull();
    expect(transcript.body!.length).toBeGreaterThan(500);
    // Speaker attribution lines survive verbatim (no whitespace collapse).
    expect(transcript.body).toContain('SELLER: My sister is on the deed too. She lives in Ohio.');
    expect(transcript.body).toContain('\nOPERATOR: Is there anything on the property?');
    // The final material line is not truncated away.
    expect(transcript.body).toContain('call my sister before you send anything in writing');
    expect(transcript.attribution).toMatch(/CALL TRANSCRIPT/);
  });

  it('treats legacy full content stored in `notes` as the primary body (backfill compatibility)', () => {
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-20T17:00:00.000Z', channel: 'call', direction: 'inbound', summary: FULL_TRANSCRIPT.replace(/\s+/g, ' ').slice(0, 500), notes: FULL_TRANSCRIPT, createdAt: '2026-08-20T17:30:00.000Z' },
    ])).seller;
    expect(seller.communications[0].body).toContain('SELLER: My sister is on the deed too.');
    expect(seller.communications[0].attribution).toMatch(/CALL TRANSCRIPT/);
  });
});

describe('B. text messages', () => {
  it('preserves full individual bodies, order, and direction labels', () => {
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-02T10:00:00.000Z', type: 'text', channel: 'text', direction: 'outbound', summary: 'Intro text', body: 'Hi Sam, this is Tyler. I buy land in Williamson County and wanted to ask about your parcel on Fairview Blvd.', createdAt: '2026-08-02T10:00:00.000Z' },
      { at: '2026-08-02T10:12:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Reply', body: 'Who is this? How did you get this number? We might sell but not for cheap.', createdAt: '2026-08-02T10:12:00.000Z' },
    ])).seller;
    expect(seller.communications.map((entry) => entry.direction)).toEqual(['outbound', 'inbound']);
    expect(seller.communications[0].attribution).toMatch(/^OPERATOR STATEMENT/);
    expect(seller.communications[1].attribution).toMatch(/^SELLER STATEMENT/);
    expect(seller.communications[1].body).toBe('Who is this? How did you get this number? We might sell but not for cheap.');
  });
});

describe('C. email', () => {
  it('carries subject, full body, direction, and timestamp; the summary never replaces the body', () => {
    const emailBody = `Sam,\n\nFollowing up on our call. As discussed, we would structure the purchase as cash with a 30-day close.${' Additional terms detail follows in this paragraph.'.repeat(20)}\n\nBest,\nTyler`;
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-21T09:00:00.000Z', type: 'email', channel: 'email', direction: 'outbound', subject: 'Offer structure for the Fairview parcel', summary: 'Sent offer-structure email', body: emailBody, createdAt: '2026-08-21T09:00:00.000Z' },
    ])).seller;
    const email = seller.communications[0];
    expect(email.subject).toBe('Offer structure for the Fairview parcel');
    expect(email.body).toContain('cash with a 30-day close');
    expect(email.body!.length).toBeGreaterThan(500);
    // Distinct summary is retained alongside the body, not instead of it.
    expect(email.summary).toBe('Sent offer-structure email');
    expect(email.at).toBe('2026-08-21T09:00:00.000Z');
  });

  it('suppresses a summary that is merely the truncated opening of the body', () => {
    const body = `A long email body. ${'More detail. '.repeat(80)}`;
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-21T09:00:00.000Z', type: 'email', channel: 'email', direction: 'inbound', summary: body.slice(0, 500), body, createdAt: '2026-08-21T09:00:00.000Z' },
    ])).seller;
    expect(seller.communications[0].body).toContain('More detail.');
    expect(seller.communications[0].summary).toBeNull();
  });
});

describe('D. operator notes', () => {
  it('labels notes OPERATOR NOTE, never seller speech, with the full note body', () => {
    const note = `Drove past the property today. The pole barn is visible from the road and looks structurally rough.${' Additional observation detail.'.repeat(25)}`;
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-22T15:00:00.000Z', type: 'note', channel: 'other', direction: 'outbound', summary: note.slice(0, 500), body: note, createdAt: '2026-08-22T15:00:00.000Z' },
    ])).seller;
    expect(seller.communications[0].attribution).toBe('OPERATOR NOTE (operator-authored; not seller speech)');
    expect(seller.communications[0].body).toContain('Additional observation detail.');
    expect(seller.communications[0].attribution).not.toMatch(/SELLER/);
  });
});

describe('E. offers and counters (current schema: comm-log events)', () => {
  it('keeps offer/counter communications in strict chronological position with outcome and actor labels', () => {
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-23T10:00:00.000Z', type: 'call', channel: 'call', direction: 'outbound', summary: 'Offered $118,000 cash, 30-day close', outcome: 'Seller said the number felt low', createdAt: '2026-08-23T10:00:00.000Z' },
      { at: '2026-08-24T14:00:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Counter', body: 'We talked it over. We could do 132 if you cover closing costs.', createdAt: '2026-08-24T14:00:00.000Z' },
    ])).seller;
    expect(seller.communications[0].summary).toContain('$118,000');
    expect(seller.communications[0].outcome).toContain('felt low');
    expect(seller.communications[0].attribution).toMatch(/^OPERATOR STATEMENT/);
    expect(seller.communications[1].attribution).toMatch(/^SELLER STATEMENT/);
    expect(seller.communications[1].body).toContain('132 if you cover closing costs');
  });
});

describe('F. seller fingerprint includes primary content', () => {
  it('a material edit to a transcript body stales the Seller Read; an identical rebuild does not', () => {
    const base = () => file([
      { at: '2026-08-20T17:00:00.000Z', type: 'transcript', channel: 'call', direction: 'inbound', summary: 'Discovery call', body: FULL_TRANSCRIPT, createdAt: '2026-08-20T17:30:00.000Z' },
    ]);
    const a = sellerLayerFingerprint(buildAcquisitionDossier(base()), true, 'pre_offer' as never);
    const b = sellerLayerFingerprint(buildAcquisitionDossier(base()), true, 'pre_offer' as never);
    expect(a).toBe(b); // deterministic: normal reads stale nothing

    const edited = file([
      { at: '2026-08-20T17:00:00.000Z', type: 'transcript', channel: 'call', direction: 'inbound', summary: 'Discovery call', body: `${FULL_TRANSCRIPT}\nSELLER: Actually, we would take 125 if it closes this month.`, createdAt: '2026-08-20T17:30:00.000Z' },
    ]);
    expect(sellerLayerFingerprint(buildAcquisitionDossier(edited), true, 'pre_offer' as never)).not.toBe(a);
  });

  it('a new message stales the Seller Read', () => {
    const one = sellerLayerFingerprint(buildAcquisitionDossier(file([
      { at: '2026-08-02T10:00:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Reply', body: 'We might sell.', createdAt: '2026-08-02T10:00:00.000Z' },
    ])), true, 'pre_offer' as never);
    const two = sellerLayerFingerprint(buildAcquisitionDossier(file([
      { at: '2026-08-02T10:00:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Reply', body: 'We might sell.', createdAt: '2026-08-02T10:00:00.000Z' },
      { at: '2026-08-03T09:00:00.000Z', type: 'text', channel: 'text', direction: 'inbound', summary: 'Follow-up', body: 'My sister agreed to talk.', createdAt: '2026-08-03T09:00:00.000Z' },
    ])), true, 'pre_offer' as never);
    expect(two).not.toBe(one);
  });
});

describe('G. summary-only backward compatibility', () => {
  it('records with only a summary still flow, clearly represented as summaries', () => {
    const seller = buildAcquisitionDossier(file([
      { at: '2026-08-15T17:00:00.000Z', type: 'call', channel: 'call', direction: 'outbound', summary: 'Discovery call: motivation and price discussed', outcome: 'Positive', createdAt: '2026-08-15T17:30:00.000Z' },
    ])).seller;
    expect(seller.communications).toHaveLength(1);
    expect(seller.communications[0].body).toBeNull();
    expect(seller.communications[0].summary).toBe('Discovery call: motivation and price discussed');
    expect(seller.communications[0].attribution).toMatch(/^OPERATOR STATEMENT/);
  });
});

describe('bounding stays coherent, never a silent chop', () => {
  it('an oversized single body keeps both ends with an explicit inline omission marker', () => {
    const huge = `OPENING MATERIAL POSITION: seller wants $150,000.\n${'Filler paragraph about the parcel and family history. '.repeat(600)}\nCLOSING: seller would take $120,000 for a fast close.`;
    const dossier = buildAcquisitionDossier(file([
      { at: '2026-08-20T17:00:00.000Z', type: 'transcript', channel: 'call', direction: 'inbound', summary: 'Long call', body: huge, createdAt: '2026-08-20T17:30:00.000Z' },
    ]));
    const body = dossier.seller.communications[0].body!;
    expect(body).toContain('OPENING MATERIAL POSITION');
    expect(body).toContain('CLOSING: seller would take $120,000');
    expect(body).toContain('characters omitted from the middle');
    expect(dossier.truncation.join(' ')).toMatch(/verbatim content/);
  });

  it('over the total budget, earliest and latest bodies stay verbatim and middle bodies fall back to summaries with the omission recorded', () => {
    const big = (label: string) => `${label}: ${'x '.repeat(7000)}end of ${label}`;
    const commLog = Array.from({ length: 12 }, (_, index) => ({
      at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      type: 'text', channel: 'text', direction: 'inbound',
      summary: `Message ${index + 1}`,
      body: big(`message-${index + 1}`),
      createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    const dossier = buildAcquisitionDossier(file(commLog));
    const comms = dossier.seller.communications;
    expect(comms).toHaveLength(12);
    // Earliest bodies funded first, then the most recent.
    expect(comms[0].body).toContain('message-1');
    expect(comms[11].body).toContain('message-12');
    // Some middle entry fell back to its summary, and the omission is recorded.
    const dropped = comms.filter((entry) => entry.body == null);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((entry) => entry.summary)).toBe(true);
    expect(dossier.truncation.join(' ')).toMatch(/total primary-content budget/);
  });
});
