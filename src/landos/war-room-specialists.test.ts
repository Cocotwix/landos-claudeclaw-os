import { describe, expect, it } from 'vitest';

import {
  SEAT_TOOLSETS,
  WAR_ROOM_CHAIR_ID,
  WAR_ROOM_SPECIALIST_SEATS,
  buildChairSynthesisText,
  buildSpecialistSeatPrompt,
  getSpecialistSeat,
  runSeatModelCall,
} from './war-room-specialists.js';
import { SPECIALIST_PROFILES } from './specialist-intelligence-executor.js';
import { specialistContextEnvelopeForPhase } from './intelligence-stack-contract.js';
import { buildAcquisitionDossier, type AcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { DealWarRoomContext } from './war-room-deal-context.js';
import type { SettingsReader } from './acquisition-analyst.js';

// Slice 7: the deal-scoped War Room board IS the four persistent Hermes
// specialist profiles from production intelligence — no duplicate personas,
// bounded per-seat context, stateless one-shot turns (isolation by
// construction), honest failure handling for the chair.

function dossierFor(input: { address: string; apn: string; acres: number }): AcquisitionDossier {
  const source: PropertyFileSource = {
    dealCardId: 89,
    now: () => new Date('2026-08-21T00:00:00.000Z'),
    propertyIntelligence: {
      snapshot: {
        identity: { state: 'confirmed', displayAddress: input.address, apn: input.apn, county: 'Williamson', stateCode: 'TN', acres: input.acres },
      },
    },
  } as unknown as PropertyFileSource;
  return buildAcquisitionDossier(source);
}

const FAIRVIEW = { address: '0 Kingwood Blvd, Fairview, TN 37062', apn: '042-123.00-000', acres: 51.11 };

function dealCtxFor(marker: string): DealWarRoomContext {
  return {
    dealCardId: 89,
    dealLabel: '0 Kingwood Blvd, Fairview, TN 37062 · Deal 89',
    contextText: `context ${marker}`,
    seatContext: (seatId) => `SEAT CONTEXT ${marker} for ${seatId}`,
  };
}

function settings(values: Record<string, string> = {}): SettingsReader {
  const store = { ...values };
  return {
    getDashboardSetting: (key) => store[key] ?? null,
    setDashboardSetting: (key, value) => { store[key] = value; },
  };
}

describe('war room specialist seats', () => {
  it('maps the four seats onto exactly the production specialist profiles — no duplicate personas', () => {
    expect(WAR_ROOM_SPECIALIST_SEATS).toHaveLength(4);
    const byId = Object.fromEntries(WAR_ROOM_SPECIALIST_SEATS.map((seat) => [seat.id, seat.profile]));
    expect(byId).toEqual({
      'deal-brain': SPECIALIST_PROFILES.deal,
      property: SPECIALIST_PROFILES.property,
      market: SPECIALIST_PROFILES.market,
      seller: SPECIALIST_PROFILES.seller,
    });
  });

  it('Deal Brain is the chair and listed first for display', () => {
    expect(WAR_ROOM_SPECIALIST_SEATS[0].id).toBe(WAR_ROOM_CHAIR_ID);
    expect(WAR_ROOM_SPECIALIST_SEATS[0].chair).toBe(true);
    expect(WAR_ROOM_SPECIALIST_SEATS.filter((seat) => seat.chair)).toHaveLength(1);
  });

  it('operator-facing seat names are human labels, never profile ids', () => {
    for (const seat of WAR_ROOM_SPECIALIST_SEATS) {
      expect(seat.name).not.toMatch(/landos-/);
    }
    expect(getSpecialistSeat('market')?.name).toBe('Market + Area');
    expect(getSpecialistSeat('unknown-seat')).toBeNull();
  });
});

describe('buildSpecialistSeatPrompt', () => {
  const seat = getSpecialistSeat('property')!;

  it('embeds the seat-bounded deal context and the operator message', () => {
    const prompt = buildSpecialistSeatPrompt({
      seat,
      dealCtx: dealCtxFor('DEAL-A'),
      dealCardId: 89,
      dealLabel: 'Fairview · Deal 89',
      transcriptBlock: '[Meeting so far — most recent last.\nMark: hello]',
      userText: 'What worries you most?',
    });
    expect(prompt).toContain('SEAT CONTEXT DEAL-A for property');
    expect(prompt).toContain('Operator: What worries you most?');
    expect(prompt).toContain('Meeting so far');
    expect(prompt).toContain('the context wins');
    expect(prompt).toContain('name the single bounded check LandOS should run');
  });

  it('derives every deal fact from the provided context — a different deal produces a different prompt with no residue', () => {
    const promptA = buildSpecialistSeatPrompt({
      seat, dealCtx: dealCtxFor('DEAL-A'), dealCardId: 89, dealLabel: 'A', transcriptBlock: '', userText: 'q',
    });
    const promptB = buildSpecialistSeatPrompt({
      seat, dealCtx: dealCtxFor('DEAL-B'), dealCardId: 12, dealLabel: 'B', transcriptBlock: '', userText: 'q',
    });
    expect(promptA).toContain('DEAL-A');
    expect(promptA).not.toContain('DEAL-B');
    expect(promptB).toContain('DEAL-B');
    expect(promptB).not.toContain('DEAL-A');
  });

  it('says plainly when no bounded context loaded instead of inviting profile memory', () => {
    const prompt = buildSpecialistSeatPrompt({
      seat, dealCtx: null, dealCardId: 89, dealLabel: 'Fairview · Deal 89', transcriptBlock: '', userText: 'q',
    });
    expect(prompt).toContain('No bounded deal context is available');
    expect(prompt).toContain('never from profile memory');
  });

  it('gives the chair its synthesis rules, including honest handling of failed seats', () => {
    const chair = getSpecialistSeat(WAR_ROOM_CHAIR_ID)!;
    const prompt = buildSpecialistSeatPrompt({
      seat: chair, dealCtx: dealCtxFor('DEAL-A'), dealCardId: 89, dealLabel: 'Fairview · Deal 89', transcriptBlock: '', userText: 'q',
    });
    expect(prompt).toContain('You chair this board');
    expect(prompt).toContain('never manufacture consensus');
    expect(prompt).toContain('never invent its position');
  });
});

describe('buildChairSynthesisText', () => {
  it('carries each seat position and marks an absent seat explicitly so the chair cannot fabricate it', () => {
    const text = buildChairSynthesisText({
      operatorText: 'What am I missing?',
      positions: [
        { seatName: 'Property', text: 'Access is the open question.' },
        { seatName: 'Market + Area', text: null },
      ],
    });
    expect(text).toContain('Property: Access is the open question.');
    expect(text).toContain("Market + Area: (no response this turn — do not invent this seat's position)");
    expect(text).toContain('Preserve real disagreement');
    expect(text.startsWith('What am I missing?')).toBe(true);
  });
});

describe('runSeatModelCall', () => {
  it('invokes the seat profile through the least-privilege one-shot argv — clarify toolset, no session, no skills', async () => {
    let recorded: string[] = [];
    const result = await runSeatModelCall(
      { seat: getSpecialistSeat('market')!, prompt: 'PROMPT-BODY', timeoutMs: 1000 },
      {
        invoke: async (args) => { recorded = args; return '  Market position.  '; },
        settings: settings(),
      },
    );
    expect(recorded[recorded.indexOf('--profile') + 1]).toBe('landos-market');
    expect(recorded[recorded.indexOf('-t') + 1]).toBe(SEAT_TOOLSETS);
    expect(recorded[recorded.indexOf('--oneshot') + 1]).toBe('PROMPT-BODY');
    // Stateless by construction: no Bot Chat session flags anywhere.
    expect(recorded).not.toContain('chat');
    expect(recorded).not.toContain('-c');
    expect(recorded).not.toContain('--skills');
    expect(result.text).toBe('Market position.');
  });

  it('records honest provenance: profile, provider/model chain, transport', async () => {
    const { runtime } = await runSeatModelCall(
      { seat: getSpecialistSeat('seller')!, prompt: 'p', timeoutMs: 1000 },
      { invoke: async () => 'ok', settings: settings(), now: (() => { let t = 0; return () => (t += 500); })() },
    );
    expect(runtime.agentProfile).toBe('landos-seller');
    expect(runtime.engine).toBe('hermes');
    expect(runtime.transport).toBe('hermes-cli-oneshot');
    expect(runtime.durationMs).toBe(500);
  });

  it('propagates a failed invocation instead of fabricating a reply', async () => {
    await expect(runSeatModelCall(
      { seat: getSpecialistSeat('property')!, prompt: 'p', timeoutMs: 1000 },
      { invoke: async () => { throw new Error('runtime down'); }, settings: settings() },
    )).rejects.toThrow('runtime down');
  });
});

describe('specialistContextEnvelopeForPhase', () => {
  it('carries the same authoritative anti-contamination doctrine as production intelligence', () => {
    const dossier = dossierFor(FAIRVIEW);
    const envelope = specialistContextEnvelopeForPhase(dossier, 'pre_call', {
      dealCardId: 89,
      generatedAt: '2026-08-21T00:00:00.000Z',
      contextFingerprint: 'fp-x',
    });
    expect(envelope).toContain('LANDOS CURRENT DEAL CONTEXT (AUTHORITATIVE)');
    expect(envelope).toContain('0 Kingwood Blvd, Fairview, TN 37062');
    expect(envelope).toContain('never WHAT is currently true');
    expect(envelope).toContain('this context wins');
    expect(envelope).toContain('Evidence fingerprint: fp-x');
  });
});
