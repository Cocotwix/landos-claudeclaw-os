import { describe, it, expect } from 'vitest';
import { buildIntakeConversation, type IntakeMessage } from './intake-conversation.js';

const op = (text: string): IntakeMessage => ({ role: 'operator', text });
const bot = (text: string): IntakeMessage => ({ role: 'landos', text });

describe('buildIntakeConversation — New Lead as a conversation', () => {
  it('greets on an empty conversation without fabricating anything', () => {
    const r = buildIntakeConversation([]);
    expect(r.reply).toMatch(/tell me about the lead/i);
    expect(r.readyToRun).toBe(false);
    expect(r.combinedText).toBe('');
  });

  it('acknowledges seller-stated claims as needing verification', () => {
    const r = buildIntakeConversation([op('Seller says utilities are available.')]);
    expect(r.reply).toMatch(/seller-stated/i);
    expect(r.reply).toMatch(/needs verification/i);
  });

  it('accumulates identity across turns — later messages enrich earlier ones', () => {
    const turns: IntakeMessage[] = [
      op('New lead came in from PPC.'),
      bot('Which county and state is this in?'),
      op('Parcel ID: 094-020.08, Sevier County, Arkansas'),
    ];
    const r = buildIntakeConversation(turns);
    const labels = Object.fromEntries(r.understood.map((c) => [c.label, c.value]));
    expect(labels['APN']).toBe('094-020.08');
    expect(labels['County']).toMatch(/Sevier/);
    expect(labels['State']).toMatch(/AR|Arkansas/);
    // Raw conversation preserved — operator turns only, verbatim.
    expect(r.combinedText).toBe('New lead came in from PPC.\nParcel ID: 094-020.08, Sevier County, Arkansas');
    expect(r.readyToRun).toBe(true);
    expect(r.reply).toMatch(/enough to identify|run property intelligence/i);
  });

  it('recognizes a multi-parcel lead and says each parcel resolves on its own', () => {
    const r = buildIntakeConversation([
      op('I have two parcels from one seller: APN 111-222.33 and APN 444-555.66, Polk County, AR'),
    ]);
    expect(r.reply).toMatch(/2 distinct parcels/i);
  });

  it('asks for the single most valuable missing identifier', () => {
    const r = buildIntakeConversation([op('Seller is motivated, wants to close fast.')]);
    expect(r.readyToRun).toBe(false);
    expect(r.reply).toMatch(/county and state|parcel number|address|owner/i);
  });

  it('never rewrites the operator input (raw intake doctrine)', () => {
    const messy = 'sevier cnty AR — seller sez maybe 17 acres??  apn 123-456.78';
    const r = buildIntakeConversation([op(messy)]);
    expect(r.combinedText).toBe(messy);
  });
});
