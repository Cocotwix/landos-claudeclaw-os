import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { startSession } from './browser-training.js';
import {
  attachTrainingLiveSession,
  errText,
  makeTranscriptCoalescer,
  type ClientSocket,
  type LiveModelConnector,
  type LiveModelSession,
} from './browser-training-live.js';
import { listTrainingEvents } from './browser-training-db.js';

beforeEach(() => { _initTestLandosDb(); });
afterEach(() => { vi.useRealTimers(); });

// A fake client socket that records everything the bridge sends downstream.
function fakeSocket() {
  const sent: any[] = [];
  const handlers: Record<string, (d: unknown) => void> = {};
  const ws: ClientSocket = {
    send: (d: string) => sent.push(JSON.parse(d)),
    close: () => {},
    on: (evt: string, cb: any) => { handlers[evt] = cb; },
    readyState: 1,
  };
  return { ws, sent, emit: (evt: string, d?: unknown) => handlers[evt]?.(d) };
}

function statuses(sent: any[]) { return sent.filter((m) => m.type === 'status'); }

describe('transcript coalescing', () => {
  it('merges word fragments into one utterance per turn, not one per word', () => {
    const s = startSession({ title: 't' });
    const { ws, sent } = fakeSocket();
    const co = makeTranscriptCoalescer(s.id, ws);
    // Gemini streams tiny fragments; a turnComplete ends the utterance.
    co.feed('operator', 'this');
    co.feed('operator', ' is the');
    co.feed('operator', ' road frontage');
    co.flush(); // turnComplete

    const speech = listTrainingEvents(s.id).filter((e) => e.kind === 'operator_speech');
    expect(speech).toHaveLength(1);
    expect(speech[0].text).toBe('this is the road frontage');
    // client got live partials + one final
    expect(sent.filter((m) => m.type === 'transcript_partial').length).toBeGreaterThan(0);
    const finals = sent.filter((m) => m.type === 'transcript' && m.final);
    expect(finals).toHaveLength(1);
    expect(finals[0].text).toBe('this is the road frontage');
  });

  it('flushes the previous utterance when the speaker changes', () => {
    const s = startSession({ title: 't' });
    const { ws } = fakeSocket();
    const co = makeTranscriptCoalescer(s.id, ws);
    co.feed('operator', 'open the map');
    co.feed('ai', 'got it');
    co.flush();
    const kinds = listTrainingEvents(s.id).filter((e) => e.kind.endsWith('_speech'));
    expect(kinds.map((e) => `${e.kind}:${e.text}`)).toEqual(['operator_speech:open the map', 'ai_speech:got it']);
  });
});

describe('errText', () => {
  it('extracts a short, safe reason from various error shapes', () => {
    expect(errText(new Error('boom'))).toBe('boom');
    expect(errText('quota exceeded')).toBe('quota exceeded');
    expect(errText({ reason: 'closed by server', code: 1011 })).toBe('closed by server');
    expect(errText({ code: 1006 })).toBe('1006');
    expect(errText(null)).toBe('');
  });
});

describe('training live bridge — connection visibility', () => {
  it('surfaces the exact reason when the model fails to connect (recording-only)', async () => {
    const s = startSession({ title: 't', website: 'https://landportal.com/' });
    const { ws, sent } = fakeSocket();
    const connector: LiveModelConnector = {
      connect: async () => { throw new Error('API key invalid'); },
    };
    await attachTrainingLiveSession(s.id, ws, { connector });
    const rec = statuses(sent).find((m) => m.state === 'recording_only');
    expect(rec).toBeTruthy();
    expect(rec.reason).toBe('API key invalid');
    expect(rec.message).toContain('Live AI not connected');
  });

  it('reports recording-only with a clear reason when no connector is available', async () => {
    const s = startSession({ title: 't' });
    const { ws, sent } = fakeSocket();
    await attachTrainingLiveSession(s.id, ws, { connector: null });
    const rec = statuses(sent).find((m) => m.state === 'recording_only');
    expect(rec.reason).toMatch(/GOOGLE_API_KEY/);
  });

  it('goes live and fires a spoken greeting so the operator hears LandOS', async () => {
    vi.useFakeTimers();
    const s = startSession({ title: 't', website: 'https://landportal.com/' });
    const { ws, sent } = fakeSocket();
    const contentCalls: any[] = [];
    const model: LiveModelSession = {
      sendRealtimeInput: () => {},
      sendClientContent: (x) => contentCalls.push(x),
      close: () => {},
    };
    const connector: LiveModelConnector = {
      connect: async (args) => { args.onopen(); return model; },
    };
    await attachTrainingLiveSession(s.id, ws, { connector });
    // greeting is scheduled 500ms after connect
    vi.advanceTimersByTime(600);

    expect(statuses(sent).some((m) => m.state === 'live')).toBe(true);
    expect(statuses(sent).some((m) => m.state === 'greeting_sent')).toBe(true);
    expect(contentCalls.length).toBe(1);
    const greetingText = JSON.stringify(contentCalls[0]);
    expect(greetingText).toMatch(/see your screen|see his screen|listening/i);
  });
});
