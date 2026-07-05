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
  recordSpeech,
  recordUsage,
  trainingSystemInstruction,
  captureFieldBinding,
} from './browser-training.js';
import { getTrainingSession, updateTrainingSessionStatus } from './browser-training-db.js';
import { matchFieldPhrase, type CanonicalField } from './field-binding.js';
import { withWorkingPage, type PageLike } from './browser-session.js';

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
    onclose: () => void;
  }): Promise<LiveModelSession>;
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
}

/** Best-effort live CDP page for DOM-based field binding; null when unavailable. */
async function bestEffortPage(): Promise<PageLike | null> {
  try {
    const held = await withWorkingPage(async (page) => page);
    return held.ok && held.value ? held.value : null;
  } catch {
    return null;
  }
}

/** Capture a field binding triggered by an operator utterance (best-effort page). */
async function captureFromSpeech(sessionId: number, ws: ClientSocket, phrase: string): Promise<void> {
  try {
    const page = await bestEffortPage();
    const res = await captureFieldBinding(sessionId, { phrase, page });
    if (res) {
      sendJson(ws, {
        type: 'field_binding_captured',
        field: res.field, selector: res.entry.selector, label: res.entry.label,
        confidence: res.entry.confidence, strategy: res.entry.strategy,
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

/** Pull audio/transcript/usage out of a Gemini Live server message (defensively). */
function handleServerMessage(sessionId: number, ws: ClientSocket, msg: unknown): void {
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

  // Transcriptions.
  const inTx = sc?.inputTranscription?.text;
  if (typeof inTx === 'string' && inTx.trim()) {
    recordSpeech(sessionId, 'operator', inTx);
    sendJson(ws, { type: 'transcript', role: 'operator', text: inTx });
    // Auto-capture a field binding when Tyler names a field on screen.
    if (matchFieldPhrase(inTx)) void captureFromSpeech(sessionId, ws, inTx);
  }
  const outTx = sc?.outputTranscription?.text;
  if (typeof outTx === 'string' && outTx.trim()) {
    recordSpeech(sessionId, 'ai', outTx);
    sendJson(ws, { type: 'transcript', role: 'ai', text: outTx });
  }

  if (sc?.turnComplete) sendJson(ws, { type: 'turn_complete' });

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

  sendJson(ws, {
    type: 'status',
    state: 'connecting',
    provider: 'gemini',
    model: GEMINI_LIVE_MODEL,
    liveAvailable: !!connector,
  });

  if (connector) {
    try {
      model = await connector.connect({
        model: GEMINI_LIVE_MODEL,
        systemInstruction: trainingSystemInstruction({ website: session.website, title: session.title }),
        onopen: () => {
          liveReady = true;
          sendJson(ws, { type: 'status', state: 'live' });
        },
        onmessage: (msg) => handleServerMessage(sessionId, ws, msg),
        onerror: (err) => {
          logger.warn({ err }, 'training-live: model error');
          sendJson(ws, { type: 'status', state: 'model_error', message: 'realtime model error; recording continues' });
        },
        onclose: () => {
          liveReady = false;
          sendJson(ws, { type: 'status', state: 'model_closed' });
        },
      });
    } catch (err) {
      logger.warn({ err }, 'training-live: connect failed, recording-only mode');
      sendJson(ws, {
        type: 'status',
        state: 'recording_only',
        message: 'Realtime voice unavailable; recording browser events + transcript still works.',
      });
    }
  } else {
    sendJson(ws, {
      type: 'status',
      state: 'recording_only',
      message: 'No Google API key configured; recording browser events + manual notes only.',
    });
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
      case 'field_binding': {
        // Explicit bind from the UI: field name (+ optional clicked selector /
        // phrase). Read-only DOM probe; never mutates the page.
        void (async () => {
          try {
            const page = await bestEffortPage();
            const res = await captureFieldBinding(sessionId, {
              field: m.bindField,
              phrase: m.bindPhrase,
              clickSelector: m.bindSelector,
              page,
            });
            if (res) {
              sendJson(ws, {
                type: 'field_binding_captured',
                field: res.field, selector: res.entry.selector, label: res.entry.label,
                confidence: res.entry.confidence, strategy: res.entry.strategy, sampleValue: res.sampleValue,
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
    try { model?.close(); } catch { /* ok */ }
  });
}
