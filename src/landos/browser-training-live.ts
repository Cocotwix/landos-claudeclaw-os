// Browser Training Department — realtime bridge (Gemini Live).
//
// Connects a browser client WebSocket to a Gemini Live session: audio + video
// frames flow up, model audio + transcripts flow down. Everything is recorded to
// the training store, and the security guard runs on every browser event before
// it is stored or forwarded. The provider is isolated here — nothing else in the
// codebase names Gemini Live.
//
// Fails safe: if the Live API is unavailable (no key, SDK shape mismatch,
// network), the bridge still records browser events + manual transcript and
// tells the client, so recording + playbook synthesis keep working.

import { GOOGLE_API_KEY } from '../config.js';
import { logger } from '../logger.js';
import {
  GEMINI_LIVE_FALLBACK_MODEL,
  GEMINI_LIVE_MODEL,
  recordBrowserEvent,
  recordScreenshot,
  recordSpeech,
  recordUsage,
  trainingSystemInstruction,
  captureFieldBinding,
} from './browser-training.js';
import { getTrainingSession, updateTrainingSessionStatus } from './browser-training-db.js';
import { matchFieldPhrase, type CanonicalField } from './field-binding.js';

/** Minimal duplex-socket shape (satisfied by `ws` and by test fakes). */
export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  readyState?: number;
}

/** Injectable Gemini Live client, so the bridge is testable without network. */
export interface LiveModelSession {
  sendRealtimeInput(input: Record<string, unknown>): void;
  sendClientContent?(input: Record<string, unknown>): void;
  close(): void;
}
export interface LiveModelConnector {
  connect(args: {
    model: string;
    systemInstruction: string;
    onopen: () => void;
    onmessage: (msg: unknown) => void;
    onerror: (err: unknown) => void;
    onclose: (info?: unknown) => void;
  }): Promise<LiveModelSession>;
}

/** Extract a short, secret-free reason string from an error/close event. */
export function errText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err.slice(0, 200);
  const e = err as Record<string, unknown>;
  const msg = (e.message ?? e.reason ?? e.code ?? '') as string | number;
  const s = typeof msg === 'string' ? msg : String(msg);
  return s ? s.slice(0, 200) : '';
}

export interface BridgeDeps {
  connector?: LiveModelConnector | null;
}

interface ClientMessage {
  type: string;
  data?: string; // base64 audio/video
  text?: string;
  role?: 'operator' | 'ai';
  // browser event fields
  kind?: 'nav' | 'click' | 'input' | 'screenshot';
  url?: string;
  selector?: string;
  controlText?: string;
  field?: { name?: string; type?: string; value?: string };
  action?: string; // control action
  // field_binding message fields
  bindField?: CanonicalField;
  bindPhrase?: string;
  bindSelector?: string;
  // screenshot message fields
  label?: string;
  reason?: string;
}

/** Capture a field binding triggered by an operator utterance. Label-only: the
 *  shared tab has no DOM, so we bind by name and confirm the selector later. */
async function captureFromSpeech(sessionId: number, ws: ClientSocket, phrase: string): Promise<void> {
  try {
    const res = await captureFieldBinding(sessionId, { phrase, page: null });
    if (res) {
      sendJson(ws, {
        type: 'field_binding_captured',
        field: res.field, selector: res.entry.selector, label: res.entry.label,
        confidence: res.entry.confidence, strategy: res.entry.strategy,
        note: 'Learned by name; selector needs confirmation (no DOM access to the shared tab).',
      });
    }
  } catch (err) {
    logger.warn({ err }, 'training-live: field binding from speech failed');
  }
}

function sendJson(ws: ClientSocket, obj: Record<string, unknown>): void {
  try {
    if (ws.readyState === undefined || ws.readyState === 1) ws.send(JSON.stringify(obj));
  } catch (err) {
    logger.warn({ err }, 'training-live: failed to send to client');
  }
}

/**
 * The default connector using @google/genai's Live API. Isolated so a shape
 * change or missing key degrades gracefully to "recording only".
 */
export function defaultLiveConnector(): LiveModelConnector | null {
  if (!GOOGLE_API_KEY) return null;
  return {
    async connect(args) {
      const genai = (await import('@google/genai')) as unknown as {
        GoogleGenAI: new (o: { apiKey: string }) => {
          live?: { connect(o: Record<string, unknown>): Promise<LiveModelSession> };
        };
        Modality?: { AUDIO?: unknown };
      };
      const ai = new genai.GoogleGenAI({ apiKey: GOOGLE_API_KEY });
      if (!ai.live || typeof ai.live.connect !== 'function') {
        throw new Error('Gemini Live API not available in this @google/genai version');
      }
      const audioModality = genai.Modality?.AUDIO ?? 'AUDIO';
      try {
        return await ai.live.connect({
          model: args.model,
          config: {
            responseModalities: [audioModality],
            systemInstruction: args.systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          callbacks: {
            onopen: args.onopen,
            onmessage: args.onmessage,
            onerror: args.onerror,
            onclose: args.onclose,
          },
        });
      } catch (err) {
        // Retry once on the more broadly available fallback model.
        if (args.model !== GEMINI_LIVE_FALLBACK_MODEL) {
          return ai.live.connect({
            model: GEMINI_LIVE_FALLBACK_MODEL,
            config: {
              responseModalities: [audioModality],
              systemInstruction: args.systemInstruction,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
            callbacks: {
              onopen: args.onopen,
              onmessage: args.onmessage,
              onerror: args.onerror,
              onclose: args.onclose,
            },
          });
        }
        throw err;
      }
    },
  };
}

/**
 * Coalesces the tiny transcript fragments Gemini streams ("I", " can", " see")
 * into readable utterances. It records ONE speech event per utterance (so the
 * playbook synthesis sees full sentences, not word-shards) and runs field-phrase
 * detection on the whole utterance. The client gets live `transcript_partial`
 * updates plus a final `transcript` per utterance.
 */
export interface TranscriptCoalescer {
  feed(role: 'operator' | 'ai', frag: string): void;
  flush(): void;
  dispose(): void;
}

export function makeTranscriptCoalescer(sessionId: number, ws: ClientSocket): TranscriptCoalescer {
  let role: 'operator' | 'ai' | null = null;
  let text = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  function flush(): void {
    clearTimer();
    const t = text.replace(/\s+/g, ' ').trim();
    const r = role;
    text = ''; role = null;
    if (!t || !r) return;
    recordSpeech(sessionId, r, t);
    sendJson(ws, { type: 'transcript', role: r, text: t, final: true });
    if (r === 'operator' && matchFieldPhrase(t)) void captureFromSpeech(sessionId, ws, t);
  }

  function feed(r: 'operator' | 'ai', frag: string): void {
    if (role && role !== r) flush();
    role = r;
    text += frag;
    sendJson(ws, { type: 'transcript_partial', role: r, text: text.replace(/\s+/g, ' ').trim() });
    clearTimer();
    // Flush after a natural pause so utterances don't wait for the next speaker.
    timer = setTimeout(flush, 1400);
  }

  return { feed, flush, dispose: clearTimer };
}

/** Pull audio/transcript/usage out of a Gemini Live server message (defensively). */
function handleServerMessage(sessionId: number, ws: ClientSocket, msg: unknown, co: TranscriptCoalescer): void {
  const m = (msg && typeof msg === 'object' ? msg : {}) as Record<string, any>;
  const sc = m.serverContent as Record<string, any> | undefined;

  // Model audio out.
  const parts = sc?.modelTurn?.parts as any[] | undefined;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const inline = p?.inlineData;
      if (inline?.data) {
        sendJson(ws, { type: 'ai_audio', data: inline.data, mimeType: inline.mimeType ?? 'audio/pcm;rate=24000' });
      }
    }
  }

  // Transcriptions → coalesced into utterances.
  const inTx = sc?.inputTranscription?.text;
  if (typeof inTx === 'string' && inTx.trim()) co.feed('operator', inTx);
  const outTx = sc?.outputTranscription?.text;
  if (typeof outTx === 'string' && outTx.trim()) co.feed('ai', outTx);

  if (sc?.turnComplete) { co.flush(); sendJson(ws, { type: 'turn_complete' }); }

  // Usage metadata → cost accounting.
  const um = m.usageMetadata as Record<string, any> | undefined;
  if (um) {
    const audioIn = num(um.promptTokenCount) - num(um.textTokenCount);
    recordUsage(sessionId, {
      audioIn: Math.max(0, audioIn),
      audioOut: num(um.responseTokenCount ?? um.candidatesTokenCount),
      textIn: num(um.textTokenCount),
    });
    const s = getTrainingSession(sessionId);
    if (s) sendJson(ws, { type: 'usage', estCostUsd: s.estCostUsd, durationMs: Date.now() - s.startedAt * 1000 });
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/**
 * Wire a client socket for a training session. Returns immediately; the socket
 * lives until the client disconnects or the session ends.
 */
export async function attachTrainingLiveSession(
  sessionId: number,
  ws: ClientSocket,
  deps: BridgeDeps = {},
): Promise<void> {
  const session = getTrainingSession(sessionId);
  if (!session) {
    sendJson(ws, { type: 'error', message: 'session not found' });
    ws.close(1008, 'session not found');
    return;
  }

  const connector = deps.connector === undefined ? defaultLiveConnector() : deps.connector;
  let model: LiveModelSession | null = null;
  let liveReady = false;
  const co = makeTranscriptCoalescer(sessionId, ws);
  let shotCount = 0;

  sendJson(ws, {
    type: 'status',
    state: 'connecting',
    provider: 'gemini',
    model: GEMINI_LIVE_MODEL,
    liveAvailable: !!connector,
  });

  // Screen-shared tabs expose pixels, not DOM — there is no CDP/browser-event
  // access to Tyler's own tab. Say so explicitly so 0 DOM steps is never silent;
  // steps are captured visually (screenshots + narration) instead.
  sendJson(ws, {
    type: 'browser_events',
    connected: false,
    reason: 'Screen-shared tab has no DOM access. Steps are captured visually from frames + your narration; selectors are confirmed on a later pass.',
  });

  // The spoken greeting the operator must hear within a few seconds of Start.
  const GREETING_PROMPT =
    'The training session just started and Tyler can see and hear you now. In ONE short spoken ' +
    'sentence, tell him you can see his screen and are listening, and ask him to walk you through ' +
    'the workflow. Then stay quiet and wait for him to speak.';

  function triggerGreeting(): void {
    if (!model) return;
    try {
      if (model.sendClientContent) {
        model.sendClientContent({ turns: [{ role: 'user', parts: [{ text: GREETING_PROMPT }]}], turnComplete: true });
        sendJson(ws, { type: 'status', state: 'greeting_sent' });
      }
    } catch (err) {
      logger.warn({ err }, 'training-live: greeting failed');
    }
  }

  if (connector) {
    try {
      model = await connector.connect({
        model: GEMINI_LIVE_MODEL,
        systemInstruction: trainingSystemInstruction({ website: session.website, title: session.title }),
        onopen: () => {
          liveReady = true;
          sendJson(ws, { type: 'status', state: 'live', message: 'Live AI connected.' });
        },
        onmessage: (msg) => handleServerMessage(sessionId, ws, msg, co),
        onerror: (err) => {
          const reason = errText(err);
          logger.warn({ err }, 'training-live: model error');
          sendJson(ws, { type: 'status', state: 'model_error', message: `Live AI error: ${reason}`, reason });
        },
        onclose: (info?: unknown) => {
          liveReady = false;
          const reason = errText(info);
          sendJson(ws, { type: 'status', state: 'model_closed', message: reason ? `Live AI disconnected: ${reason}` : 'Live AI disconnected.', reason });
        },
      });
      // Kick off the greeting so the operator immediately hears LandOS.
      setTimeout(triggerGreeting, 500);
    } catch (err) {
      const reason = errText(err);
      logger.warn({ err }, 'training-live: connect failed, recording-only mode');
      sendJson(ws, {
        type: 'status',
        state: 'recording_only',
        message: `Live AI not connected: ${reason}`,
        reason,
      });
    }
  } else {
    const reason = 'No Google API key configured (GOOGLE_API_KEY missing).';
    sendJson(ws, { type: 'status', state: 'recording_only', message: `Live AI not connected: ${reason}`, reason });
  }

  ws.on('message', (raw: unknown) => {
    let m: ClientMessage;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as ClientMessage;
    } catch {
      return;
    }
    switch (m.type) {
      case 'audio':
        if (model && liveReady && m.data) {
          model.sendRealtimeInput({ audio: { data: m.data, mimeType: 'audio/pcm;rate=16000' } });
        }
        break;
      case 'video':
        if (model && liveReady && m.data) {
          model.sendRealtimeInput({ video: { data: m.data, mimeType: 'image/jpeg' } });
        }
        break;
      case 'text':
        if (m.text) {
          recordSpeech(sessionId, m.role === 'ai' ? 'ai' : 'operator', m.text);
          if (model && liveReady && model.sendClientContent) {
            model.sendClientContent({ turns: [{ role: 'user', parts: [{ text: m.text }] }], turnComplete: true });
          }
        }
        break;
      case 'browser_event': {
        if (!m.kind) break;
        const res = recordBrowserEvent({
          sessionId,
          kind: m.kind,
          url: m.url,
          selector: m.selector,
          controlText: m.controlText,
          field: m.field,
        });
        if (res.approvalRequired) {
          sendJson(ws, { type: 'guard', approvalRequired: true, reason: res.reason });
          // Tell the model to stop and warn (if live).
          if (model && liveReady && model.sendClientContent) {
            model.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: `SYSTEM: ${res.reason} Do not proceed.` }] }],
              turnComplete: true,
            });
          }
        } else {
          sendJson(ws, { type: 'event_recorded', kind: m.kind, seq: res.stored.seq });
        }
        break;
      }
      case 'screenshot': {
        // A frame the client chose to keep (start / voice cue / material change).
        if (!m.data) break;
        try {
          const shot = recordScreenshot(sessionId, { dataBase64: m.data, label: m.label, reason: m.reason });
          shotCount += 1;
          sendJson(ws, { type: 'screenshot_saved', count: shotCount, seq: shot.seq, label: m.label || m.reason || 'screenshot' });
        } catch (err) {
          logger.warn({ err }, 'training-live: screenshot save failed');
          sendJson(ws, { type: 'screenshot_failed', reason: errText(err) });
        }
        break;
      }
      case 'field_binding': {
        // Screen-shared tab has no DOM, so bind by NAME (label-only) — never probe
        // the LandOS-controlled Chrome, which is a different page. Confirmation of
        // the exact selector happens on a later CDP pass.
        void (async () => {
          try {
            const res = await captureFieldBinding(sessionId, {
              field: m.bindField,
              phrase: m.bindPhrase,
              page: null,
            });
            if (res) {
              sendJson(ws, {
                type: 'field_binding_captured',
                field: res.field, selector: res.entry.selector, label: res.entry.label,
                confidence: res.entry.confidence, strategy: res.entry.strategy, sampleValue: res.sampleValue,
                note: 'Learned by name; selector needs confirmation (no DOM access to the shared tab).',
              });
            } else {
              sendJson(ws, { type: 'field_binding_failed', reason: 'no field recognized' });
            }
          } catch (err) {
            logger.warn({ err }, 'training-live: field_binding failed');
          }
        })();
        break;
      }
      case 'control':
        if (m.action === 'pause') updateTrainingSessionStatus(sessionId, 'paused');
        else if (m.action === 'resume') updateTrainingSessionStatus(sessionId, 'active');
        else if (m.action === 'stop') {
          co.flush(); co.dispose();
          try { model?.close(); } catch { /* ok */ }
          sendJson(ws, { type: 'status', state: 'ended' });
          ws.close(1000, 'stopped');
        }
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    co.flush(); co.dispose();
    try { model?.close(); } catch { /* ok */ }
  });
}
