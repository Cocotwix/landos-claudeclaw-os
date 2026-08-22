import { describe, expect, it } from 'vitest';

import { getRoster, getRosterForMeeting } from './warroom-text-orchestrator.js';
import { boardRouterFallback, _internal, type BoardRouterContext } from './warroom-text-router.js';
import { WAR_ROOM_CHAIR_ID } from './landos/war-room-specialists.js';

// Slice 7: deal-scoped meetings seat exactly the four persistent specialist
// seats; generic meetings keep the department roster; board routing is
// bounded (≤3 specialist speakers + at most one chair synthesis) and fails
// closed to the chair alone.

function boardCtx(userText = 'What am I missing?'): BoardRouterContext {
  return {
    userText,
    roster: getRosterForMeeting(89),
    recentTurns: [],
    pinnedAgent: null,
    chairId: WAR_ROOM_CHAIR_ID,
  };
}

describe('getRosterForMeeting', () => {
  it('a deal-scoped meeting seats exactly the four Hermes specialist seats, chair first', () => {
    const roster = getRosterForMeeting(89);
    expect(roster.map((a) => a.id)).toEqual(['deal-brain', 'property', 'market', 'seller']);
    expect(roster.every((a) => a.kind === 'hermes')).toBe(true);
    expect(roster[0].chair).toBe(true);
    expect(roster[0].name).toBe('Deal Brain');
  });

  it('no generic department agent appears in a deal-scoped roster', () => {
    const ids = new Set(getRosterForMeeting(89).map((a) => a.id));
    expect(ids.has('main')).toBe(false);
    expect(ids.has('research')).toBe(false);
  });

  it('a generic meeting keeps the existing full department roster unchanged', () => {
    const generic = getRosterForMeeting(null);
    expect(generic).toEqual(getRoster());
    expect(generic[0].id).toBe('main');
    expect(generic.some((a) => a.kind === 'hermes')).toBe(false);
  });
});

describe('board router decision sanitization', () => {
  const sanitize = _internal.sanitizeBoardDecision as (
    raw: unknown, ctx: BoardRouterContext,
  ) => { speakers: string[]; synthesize: boolean; reason: string } | null;

  it('keeps a single directly-addressed seat without synthesis', () => {
    const clean = sanitize({ speakers: ['market'], synthesize: false, reason: 'direct' }, boardCtx());
    expect(clean).toEqual({ speakers: ['market'], synthesize: false, reason: 'direct' });
  });

  it('keeps a bounded multi-seat board round with chair synthesis', () => {
    const clean = sanitize({ speakers: ['property', 'market', 'seller'], synthesize: true, reason: 'broad' }, boardCtx());
    expect(clean?.speakers).toEqual(['property', 'market', 'seller']);
    expect(clean?.synthesize).toBe(true);
  });

  it('the chair never speaks in round 1 — a chair id in speakers becomes synthesis', () => {
    const clean = sanitize({ speakers: ['deal-brain', 'market'], synthesize: false, reason: 'r' }, boardCtx());
    expect(clean?.speakers).toEqual(['market']);
    expect(clean?.synthesize).toBe(true);
  });

  it('drops unknown seats, dedupes, and caps speakers at 3', () => {
    const clean = sanitize({
      speakers: ['market', 'market', 'nonsense', 'property', 'seller', 'property'],
      synthesize: true,
      reason: 'r',
    }, boardCtx());
    expect(clean?.speakers).toEqual(['market', 'property', 'seller']);
  });

  it('an empty round forces the chair to answer (someone must speak)', () => {
    const clean = sanitize({ speakers: [], synthesize: false, reason: 'r' }, boardCtx());
    expect(clean?.speakers).toEqual([]);
    expect(clean?.synthesize).toBe(true);
  });

  it('rejects malformed output so the caller falls back deterministically', () => {
    expect(sanitize({ speakers: 'market' }, boardCtx())).toBeNull();
    expect(sanitize(null, boardCtx())).toBeNull();
  });

  it('fallback is chair-alone and flagged degraded — never a fabricated board round', () => {
    const fallback = boardRouterFallback();
    expect(fallback.speakers).toEqual([]);
    expect(fallback.synthesize).toBe(true);
    expect(fallback.routerDegraded).toBe(true);
  });
});

describe('board router prompt', () => {
  it('names the seats, the chair rule, and the three routing shapes', () => {
    const prompt = (_internal.buildBoardRouterPrompt as (ctx: BoardRouterContext) => string)(boardCtx());
    expect(prompt).toContain('deal-brain');
    expect(prompt).toContain('property');
    expect(prompt).toContain('market');
    expect(prompt).toContain('seller');
    expect(prompt).toContain(`Never include "${WAR_ROOM_CHAIR_ID}" in speakers`);
    expect(prompt).toContain('synthesize = false');
    expect(prompt).toContain('synthesize = true');
  });
});
