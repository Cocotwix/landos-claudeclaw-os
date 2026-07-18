import { useEffect, useRef, useState } from 'preact/hooks';
import {
  GraduationCap, Monitor, Mic, MicOff, Volume2, VolumeX, Pause, Play, Square,
  ShieldAlert, BookOpen, RefreshCw, Check, X, Save, Trash2, FlaskConical,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost, dashboardToken } from '@/lib/api';

// ── Types (mirror the Browser Training API) ─────────────────────────────
type Surface = 'tab' | 'window' | 'desktop';
interface Session {
  id: number; title: string; website: string; surface: Surface; status: string;
  provider: string; model: string; approvalRequired: boolean; startedAt: number;
  durationMs: number; estCostUsd: number;
}
interface Playbook {
  id: number; slug: string; name: string; website: string; version: number; status: string;
  body: Record<string, any>; createdAt: number; updatedAt: number;
}
interface Knowledge { id: number; category: string; title: string; body: string; status: string }
interface Usage {
  provider: string; model: string; playbooksCreated: number;
  today: Win; week: Win; month: Win; lifetime: Win;
}
interface Win { sessions: number; durationMs: number; costUsd: number }
interface TranscriptTurn { role: 'operator' | 'ai'; text: string }
interface EventLine { seq: number; kind: string; text: string }
interface ExtractedField { field: string; value: string; selector: string; written: boolean }
interface BlockedAction { step: number; action: string; url: string; reason: string }
interface Execution {
  id: number; playbookId: number; mode: 'dry_run' | 'live'; status: string;
  approvalRequired: boolean; fieldsWritten: number; extractedFields: ExtractedField[];
  blockedActions: BlockedAction[]; errors: string[]; screenshots: string[]; qaNotes: string; createdAt: number;
}

const PLAYBOOK_SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'purpose', label: 'Purpose' },
  { key: 'fieldsToExtract', label: 'Fields to extract' },
  { key: 'screenshotsRequired', label: 'Screenshots required' },
  { key: 'decisionPoints', label: 'Decision points' },
  { key: 'businessRules', label: 'Business rules' },
  { key: 'operatorPreferences', label: 'Operator preferences' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'commonMistakes', label: 'Common mistakes' },
  { key: 'neverDo', label: 'Never do' },
  { key: 'paidActionBlockers', label: 'Paid-action blockers' },
  { key: 'failureHandling', label: 'Failure handling' },
  { key: 'qaChecklist', label: 'QA checklist' },
  { key: 'expectedOutputs', label: 'Expected outputs' },
];

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
function fmtCost(n: number): string { return `$${(n || 0).toFixed(4)}`; }

// ── PCM helpers for the Gemini Live audio path ──────────────────────────
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function BrowserTraining() {
  const [view, setView] = useState<'idle' | 'live' | 'review'>('idle');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // start form
  const [title, setTitle] = useState('LandPortal Map Search');
  const [website, setWebsite] = useState('https://landportal.com/');
  const [surface, setSurface] = useState<Surface>('tab');

  // live session
  const [session, setSession] = useState<Session | null>(null);
  const [connState, setConnState] = useState('idle'); // WebSocket lifecycle
  const [wsState, setWsState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [aiState, setAiState] = useState<'idle' | 'connecting' | 'live' | 'recording_only' | 'model_error' | 'model_closed'>('idle');
  const [aiReason, setAiReason] = useState('');
  const [screenOn, setScreenOn] = useState(false);
  const [micOn, setMicOn] = useState<'off' | 'on' | 'denied'>('off');
  const [audioLevel, setAudioLevel] = useState(0); // 0..1 live mic meter
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [heardInterim, setHeardInterim] = useState(''); // local STT partial
  const [framesSent, setFramesSent] = useState(0);
  const [shotsSaved, setShotsSaved] = useState(0);
  const [browserEvents, setBrowserEvents] = useState<{ connected: boolean; reason: string }>({ connected: false, reason: '' });
  const [latencyMs, setLatencyMs] = useState(0);
  const [partial, setPartial] = useState<{ role: 'operator' | 'ai'; text: string } | null>(null);
  const [connNote, setConnNote] = useState('');
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [events, setEvents] = useState<EventLine[]>([]);
  const [bindings, setBindings] = useState<Record<string, { selector: string; label: string; confidence: string; strategy: string }>>({});
  const [guard, setGuard] = useState<string | null>(null);
  const [liveCost, setLiveCost] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [aiMuted, setAiMuted] = useState(false);
  const [paused, setPaused] = useState(false);

  // review
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [replay, setReplay] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // library
  const [usage, setUsage] = useState<Usage | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);

  // refs (audio + ws + capture)
  const wsRef = useRef<WebSocket | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const outTimeRef = useRef(0);
  const frameTimerRef = useRef<number | null>(null);
  const micMutedRef = useRef(false);
  const aiMutedRef = useRef(false);
  const pausedRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const aiSpeakTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const aiStateRef = useRef<string>('idle');
  const lastSigRef = useRef<number[] | null>(null); // last frame signature (change detection)
  const lastFrameAtRef = useRef(0);
  const lastShotAtRef = useRef(0);
  const startShotDoneRef = useRef(false);
  const lastOpFinalTsRef = useRef(0); // for latency estimate
  const wantShotRef = useRef<string | null>(null); // voice-cued screenshot reason

  useEffect(() => { void loadLibrary(); return () => { teardownCapture(); }; }, []);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);
  useEffect(() => { aiMutedRef.current = aiMuted; }, [aiMuted]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { aiStateRef.current = aiState; }, [aiState]);

  // Attach the shared-screen stream to the visible preview element once live.
  useEffect(() => {
    if (view === 'live' && previewRef.current && screenRef.current) {
      previewRef.current.srcObject = screenRef.current;
      previewRef.current.play?.().catch(() => {});
    }
  }, [view, screenOn]);

  async function loadLibrary() {
    try {
      setLoading(true); setError(null);
      const [u, p] = await Promise.all([
        apiGet<{ usage: Usage }>('/api/landos/training/usage'),
        apiGet<{ playbooks: Playbook[] }>('/api/landos/training/playbooks'),
      ]);
      setUsage(u.usage); setPlaybooks(p.playbooks);
    } catch (e: any) { setError(e?.message || String(e)); } finally { setLoading(false); }
  }

  // ── Start / capture ───────────────────────────────────────────────────
  async function startSession() {
    setBusy('start');
    setError(null);
    // reset all live indicators
    setScreenOn(false); setMicOn('off'); setAiState('idle'); setAiReason('');
    setAudioLevel(0); setAiSpeaking(false); setHeardInterim(''); setFramesSent(0);
    setShotsSaved(0); setBrowserEvents({ connected: false, reason: '' }); setLatencyMs(0); setPartial(null);
    setTranscript([]); setEvents([]); setBindings({}); setGuard(null); setLiveCost(0);
    setMicMuted(false); setAiMuted(false); setPaused(false); pausedRef.current = false;
    lastSigRef.current = null; lastFrameAtRef.current = 0; lastShotAtRef.current = 0;
    startShotDoneRef.current = false; lastOpFinalTsRef.current = 0; wantShotRef.current = null;
    try {
      // 1) Screen share first — if denied, abort with a clear message.
      let screen: MediaStream;
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch (e: any) {
        setError('Screen share not started: ' + (e?.message || 'permission denied'));
        setBusy(null);
        return;
      }
      screenRef.current = screen;
      setScreenOn(true);

      // 2) Microphone — optional but its state is surfaced loudly.
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        setMicOn('on');
      } catch {
        setMicOn('denied');
      }
      micRef.current = mic;

      // 3) create the session row
      const { session: s } = await apiPost<{ session: Session }>('/api/landos/training/sessions', { title, website, surface });
      setSession(s); setAiState('connecting'); setView('live');

      // 4) open the realtime socket + start capture pipelines
      openSocket(s.id);
      startMicStream(mic);
      startLocalTranscript();
      startScreenFrames(screen);
    } catch (e: any) {
      setError(e?.message || String(e));
      teardownCapture();
    } finally { setBusy(null); }
  }

  function openSocket(sessionId: number) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws/landos/training?token=${encodeURIComponent(dashboardToken)}&session=${sessionId}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onopen = () => { setWsState('open'); setConnState('connecting'); };
    ws.onclose = () => { setWsState('closed'); setConnState('closed'); };
    ws.onerror = () => { setWsState('error'); setConnState('error'); };
    setWsState('connecting');
    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'status':
          setConnState(m.state);
          if (m.message) setConnNote(m.message);
          // Map backend AI states onto the operator-visible indicator.
          if (m.state === 'live') { setAiState('live'); setAiReason(''); }
          else if (m.state === 'recording_only') { setAiState('recording_only'); setAiReason(m.reason || m.message || ''); }
          else if (m.state === 'model_error') { setAiState('model_error'); setAiReason(m.reason || m.message || ''); }
          else if (m.state === 'model_closed') { setAiState('model_closed'); setAiReason(m.reason || m.message || ''); }
          else if (m.state === 'connecting') { setAiState('connecting'); }
          break;
        case 'transcript':
          // Final coalesced utterance. Clear partials.
          setHeardInterim(''); setPartial(null);
          setTranscript((t) => [...t.slice(-200), { role: m.role, text: m.text }]);
          if (m.role === 'operator') { lastOpFinalTsRef.current = Date.now(); maybeVoiceCueShot(m.text); }
          break;
        case 'transcript_partial':
          setPartial({ role: m.role, text: m.text }); break;
        case 'ai_audio':
          markAiSpeaking();
          // Latency: operator finished → first AI audio.
          if (lastOpFinalTsRef.current) { setLatencyMs(Date.now() - lastOpFinalTsRef.current); lastOpFinalTsRef.current = 0; }
          if (!aiMutedRef.current) playAiAudio(m.data); break;
        case 'usage':
          if (typeof m.estCostUsd === 'number') setLiveCost(m.estCostUsd); break;
        case 'guard':
          setGuard(m.reason); setPaused(true); break;
        case 'event_recorded':
          setEvents((e) => [...e.slice(-200), { seq: m.seq, kind: m.kind, text: m.kind }]); break;
        case 'screenshot_saved':
          setShotsSaved(m.count || 0); break;
        case 'browser_events':
          setBrowserEvents({ connected: !!m.connected, reason: m.reason || '' }); break;
        case 'field_binding_captured':
          setBindings((b) => ({ ...b, [m.field]: { selector: m.selector, label: m.label, confidence: m.confidence, strategy: m.strategy, note: m.note } })); break;
        default: break;
      }
    };
  }

  function markAiSpeaking() {
    setAiSpeaking(true);
    if (aiSpeakTimerRef.current) clearTimeout(aiSpeakTimerRef.current);
    aiSpeakTimerRef.current = window.setTimeout(() => setAiSpeaking(false), 900);
  }

  function startMicStream(mic: MediaStream | null) {
    if (!mic) return;
    const ctx = new AudioContext({ sampleRate: 16000 });
    inCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(mic);

    // Analyser drives the live "audio input detected" meter (always works,
    // independent of Gemini). Proves the mic is being heard.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
      setAudioLevel(micMutedRef.current ? 0 : peak);
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);

    // PCM16 stream → backend → Gemini. Muted GainNode keeps the processor
    // firing without routing the mic back to the speakers (no feedback).
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
    proc.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1 || micMutedRef.current || pausedRef.current) return;
      const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0));
      ws.send(JSON.stringify({ type: 'audio', data: bytesToBase64(new Uint8Array(pcm)) }));
    };
  }

  // Local browser speech-to-text: gives an immediate operator transcript /
  // "hearing…" indicator even before (or without) Gemini transcription.
  function startLocalTranscript() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
      rec.onresult = (ev: any) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) {
            const text = (r[0]?.transcript || '').trim();
            // When Gemini is live it owns the transcript; otherwise show ours.
            if (text && aiStateRef.current !== 'live') {
              setTranscript((t) => [...t.slice(-200), { role: 'operator', text }]);
            }
            setHeardInterim('');
          } else {
            interim += r[0]?.transcript || '';
          }
        }
        if (interim) setHeardInterim(interim.trim());
      };
      rec.onerror = () => {};
      rec.onend = () => { if (recognitionRef.current === rec && !pausedRef.current) { try { rec.start(); } catch {} } };
      rec.start();
      recognitionRef.current = rec;
    } catch { /* STT unavailable; the audio meter still proves input */ }
  }

  // Voice cues ("take screenshot", "this is important") queue a screenshot.
  function maybeVoiceCueShot(text: string) {
    if (/\b(take (a )?screenshot|screenshot this|capture this|this is important|mark this|important step)\b/i.test(text || '')) {
      wantShotRef.current = 'operator said to capture this';
    }
  }

  function startScreenFrames(screen: MediaStream) {
    const video = document.createElement('video');
    video.srcObject = screen; video.muted = true; void video.play();
    const canvas = document.createElement('canvas');
    const sig = document.createElement('canvas'); sig.width = 8; sig.height = 8;

    // Only SEND a frame to Gemini when the screen materially changes (or a slow
    // heartbeat) — constant 1fps streaming was flooding the model and causing the
    // ~20s lag. Change detection also drives automatic screenshots.
    const CHECK_MS = 1200, HEARTBEAT_MS = 6000, FRAME_DIFF = 10, SHOT_DIFF = 24, SHOT_MIN_GAP = 4000;

    function signature(): number[] {
      const sx = sig.getContext('2d'); if (!sx) return [];
      sx.drawImage(video, 0, 0, 8, 8);
      const d = sx.getImageData(0, 0, 8, 8).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      return out;
    }
    function diff(a: number[] | null, b: number[]): number {
      if (!a || a.length !== b.length) return 999;
      let s = 0; for (let i = 0; i < b.length; i++) s += Math.abs(a[i] - b[i]);
      return s / b.length;
    }
    function grabJpeg(): string {
      const w = video.videoWidth, h = video.videoHeight;
      const scale = Math.min(1, 1024 / w);
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      const cx = canvas.getContext('2d'); if (!cx) return '';
      cx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.55).split(',')[1] || '';
    }
    function sendShot(label: string, reason: string) {
      const ws = wsRef.current; if (!ws || ws.readyState !== 1) return;
      const b64 = grabJpeg(); if (!b64) return;
      ws.send(JSON.stringify({ type: 'screenshot', data: b64, label, reason }));
      lastShotAtRef.current = Date.now();
    }

    frameTimerRef.current = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1 || pausedRef.current) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      const now = Date.now();
      const s = signature();
      const d = diff(lastSigRef.current, s);

      // Send a frame on material change or heartbeat only.
      if (d > FRAME_DIFF || now - lastFrameAtRef.current > HEARTBEAT_MS) {
        const b64 = grabJpeg();
        if (b64) { ws.send(JSON.stringify({ type: 'video', data: b64 })); setFramesSent((n) => n + 1); lastFrameAtRef.current = now; lastSigRef.current = s; }
      }

      // Screenshots: start frame, voice cue, or material page change (rate-limited).
      if (!startShotDoneRef.current) { startShotDoneRef.current = true; sendShot('Start of session', 'start'); }
      else if (wantShotRef.current) { const r = wantShotRef.current; wantShotRef.current = null; sendShot('Important step', r); }
      else if (d > SHOT_DIFF && now - lastShotAtRef.current > SHOT_MIN_GAP) { sendShot('Page changed', 'material change'); }
    }, CHECK_MS);

    // When the operator stops sharing via the browser chrome, end the session.
    screen.getVideoTracks()[0].addEventListener('ended', () => { setScreenOn(false); void endSession(); });
  }

  function playAiAudio(b64: string) {
    try {
      const bytes = base64ToBytes(b64);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const ctx = outCtxRef.current ?? new AudioContext({ sampleRate: 24000 });
      outCtxRef.current = ctx;
      if (ctx.state === 'suspended') void ctx.resume();
      const f32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;
      const buf = ctx.createBuffer(1, f32.length, 24000);
      buf.copyToChannel(f32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination);
      const now = ctx.currentTime;
      const start = Math.max(now, outTimeRef.current);
      src.start(start);
      outTimeRef.current = start + buf.duration;
    } catch { /* ignore malformed chunk */ }
  }

  function sendControl(action: string) {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'control', action }));
  }

  function togglePause() {
    const next = !paused; setPaused(next); sendControl(next ? 'pause' : 'resume');
    if (next) setGuard(null);
  }

  function teardownCapture() {
    if (frameTimerRef.current) { clearInterval(frameTimerRef.current); frameTimerRef.current = null; }
    if (meterRafRef.current) { cancelAnimationFrame(meterRafRef.current); meterRafRef.current = null; }
    if (aiSpeakTimerRef.current) { clearTimeout(aiSpeakTimerRef.current); aiSpeakTimerRef.current = null; }
    try { const r = recognitionRef.current; recognitionRef.current = null; r?.stop?.(); } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    analyserRef.current = null;
    try { screenRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { inCtxRef.current?.close(); } catch {}
    screenRef.current = null; micRef.current = null; inCtxRef.current = null;
    outTimeRef.current = 0;
    setAudioLevel(0); setAiSpeaking(false); setHeardInterim('');
  }

  // ── End + synthesize ────────────────────────────────────────────────────
  async function endSession() {
    if (!session) return;
    setBusy('end');
    sendControl('stop');
    teardownCapture();
    try {
      const res = await apiPost<{ playbook: Playbook; knowledge: Knowledge[] }>(
        `/api/landos/training/sessions/${session.id}/end`, {});
      setPlaybook(res.playbook); setKnowledge(res.knowledge); setReplay(null); setView('review');
      void loadLibrary();
    } catch (e: any) { setError(e?.message || String(e)); setView('idle'); }
    finally { setBusy(null); }
  }

  // ── Review actions ──────────────────────────────────────────────────────
  async function decide(decision: 'approved' | 'rejected') {
    if (!playbook) return;
    setBusy('decide');
    try {
      const res = await apiPost<{ playbook: Playbook }>(`/api/landos/training/playbooks/${playbook.id}/decide`, { decision });
      setPlaybook(res.playbook); void loadLibrary();
    } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(null); }
  }
  async function doReplay() {
    if (!playbook) return;
    setBusy('replay');
    try {
      const res = await apiPost<{ result: any }>(`/api/landos/training/playbooks/${playbook.id}/replay`, { vars: {} });
      setReplay(res.result);
    } catch (e: any) { setReplay({ ok: false, summary: e?.message || String(e), steps: [] }); }
    finally { setBusy(null); }
  }
  async function decideKnowledge(id: number, save: boolean) {
    setBusy(`k${id}`);
    try {
      await apiPost(`/api/landos/training/knowledge/${id}/decide`, { decision: save ? 'save' : 'discard' });
      setKnowledge((k) => k.map((x) => (x.id === id ? { ...x, status: save ? 'saved' : 'discarded' } : x)));
    } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(null); }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) return <PageState kind="loading" />;

  return (
    <div class="h-full overflow-y-auto">
      <PageHeader
        icon={GraduationCap}
        title="Browser Training"
        subtitle="Teach browser agents by talking through a workflow while you share your screen."
      />
      <div class="px-4 md:px-6 pb-16 max-w-5xl mx-auto space-y-6">
        {error && (
          <div class="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 px-3 py-2 text-sm">{error}</div>
        )}

        {view === 'idle' && (
          <IdleView
            title={title} setTitle={setTitle} website={website} setWebsite={setWebsite}
            surface={surface} setSurface={setSurface} onStart={startSession} busy={busy}
            usage={usage} playbooks={playbooks}
          />
        )}

        {view === 'live' && session && (
          <LiveView
            session={session} transcript={transcript} events={events} bindings={bindings}
            guard={guard} liveCost={liveCost} micMuted={micMuted} aiMuted={aiMuted} paused={paused} busy={busy}
            wsState={wsState} aiState={aiState} aiReason={aiReason} screenOn={screenOn} micOn={micOn}
            audioLevel={audioLevel} aiSpeaking={aiSpeaking} heardInterim={heardInterim} framesSent={framesSent}
            shotsSaved={shotsSaved} browserEvents={browserEvents} latencyMs={latencyMs} partial={partial}
            previewRef={previewRef}
            onMic={() => setMicMuted((v) => !v)} onAi={() => setAiMuted((v) => !v)}
            onPause={togglePause} onStop={endSession}
          />
        )}

        {view === 'review' && playbook && (
          <ReviewView
            playbook={playbook} knowledge={knowledge} replay={replay} busy={busy}
            transcript={transcript} framesSent={framesSent}
            onDecide={decide} onReplay={doReplay} onKnowledge={decideKnowledge}
            onDone={() => { setView('idle'); setPlaybook(null); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Idle: start form + usage + library ────────────────────────────────────
function IdleView(props: any) {
  const { title, setTitle, website, setWebsite, surface, setSurface, onStart, busy, usage, playbooks } = props;
  return (
    <div class="space-y-6">
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
        <div class="flex items-center gap-2 text-[var(--color-text)] font-medium"><Monitor size={16} /> New training session</div>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm space-y-1">
            <span class="text-[var(--color-text-muted)]">Workflow name</span>
            <input value={title} onInput={(e: any) => setTitle(e.target.value)}
              class="w-full rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </label>
          <label class="text-sm space-y-1">
            <span class="text-[var(--color-text-muted)]">Website</span>
            <input value={website} onInput={(e: any) => setWebsite(e.target.value)}
              class="w-full rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] px-3 py-2 text-sm" />
          </label>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-[var(--color-text-muted)]">Share:</span>
          {(['tab', 'window', 'desktop'] as Surface[]).map((s) => (
            <button onClick={() => setSurface(s)}
              class={`px-3 py-1 rounded-full border text-xs ${surface === s ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>{s}</button>
          ))}
        </div>
        <div class="flex items-center gap-3">
          <button onClick={onStart} disabled={busy === 'start'}
            class="inline-flex items-center gap-2 rounded-md bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium">
            <Play size={15} /> {busy === 'start' ? 'Starting…' : 'Start training'}
          </button>
          <span class="text-xs text-[var(--color-text-muted)]">You will be asked to pick a screen/tab and allow the mic. Paid actions auto-stop.</span>
        </div>
      </div>

      {usage && <UsagePanel usage={usage} />}

      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div class="flex items-center gap-2 text-[var(--color-text)] font-medium mb-3"><BookOpen size={16} /> Playbooks</div>
        {playbooks.length === 0 ? (
          <p class="text-sm text-[var(--color-text-muted)]">No playbooks yet. Train one to get started.</p>
        ) : (
          <div class="space-y-2">
            {playbooks.map((p: Playbook) => <PlaybookRow key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// A playbook in the library. Approved playbooks can be dry-run or run live by the
// Browser Agent executor; the execution result renders inline.
function PlaybookRow({ p }: { p: Playbook }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [exec, setExec] = useState<Execution | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const approved = p.status === 'approved';

  async function run(mode: 'dry_run' | 'live') {
    setBusy(mode); setErr(null);
    try {
      const res = await apiPost<{ execution: Execution }>(`/api/landos/training/playbooks/${p.id}/execute`, { mode });
      setExec(res.execution);
    } catch (e: any) {
      setErr(e?.body?.error || e?.message || String(e));
    } finally { setBusy(null); }
  }

  return (
    <div class="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm">
      <div class="flex items-center justify-between gap-3">
        <div><span class="font-medium">{p.name}</span> <span class="text-[var(--color-text-muted)]">v{p.version} · {p.website}</span></div>
        <div class="flex items-center gap-2">
          {approved && (
            <>
              <button onClick={() => run('dry_run')} disabled={!!busy}
                class="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs disabled:opacity-50">
                <FlaskConical size={13} /> {busy === 'dry_run' ? 'Running…' : 'Dry run'}
              </button>
              <button onClick={() => run('live')} disabled={!!busy}
                class="inline-flex items-center gap-1 rounded-md border border-sky-500/40 text-sky-300 px-2 py-1 text-xs disabled:opacity-50">
                <Play size={13} /> {busy === 'live' ? 'Running…' : 'Run live'}
              </button>
            </>
          )}
          <StatusPill status={p.status} />
        </div>
      </div>
      {!approved && <div class="text-xs text-[var(--color-text-muted)] mt-1">Approve this playbook to make it executable by the Browser Agent.</div>}
      {err && <div class="text-xs text-red-400 mt-2">{err}</div>}
      {exec && <ExecutionResult exec={exec} />}
    </div>
  );
}

function ExecutionResult({ exec }: { exec: Execution }) {
  const tone: Record<string, string> = {
    succeeded: 'text-emerald-400', partial: 'text-amber-400', blocked: 'text-amber-400',
    failed: 'text-red-400', not_configured: 'text-[var(--color-text-muted)]', awaiting_authentication: 'text-amber-400',
  };
  return (
    <div class="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2 space-y-1.5">
      <div class="text-xs">
        <span class="uppercase tracking-wide text-[10px] text-[var(--color-text-muted)] mr-2">{exec.mode}</span>
        <span class={tone[exec.status] || ''}>{exec.status}</span>
        {exec.blockedActions.length > 0 && <span class="ml-2 text-amber-300">· Prohibited</span>}
      </div>
      {exec.blockedActions.length > 0 && (
        <div class="text-xs text-amber-300 flex items-start gap-1">
          <ShieldAlert size={13} class="mt-0.5 shrink-0" />
          <span>{exec.blockedActions.map((b) => b.reason).join(' ')}</span>
        </div>
      )}
      {exec.extractedFields.length > 0 && (
        <div class="text-xs">
          <span class="text-[var(--color-text-muted)]">Fields ({exec.fieldsWritten} written to Deal Card):</span>{' '}
          {exec.extractedFields.map((f) => `${f.field}=${f.value}`).join(', ')}
        </div>
      )}
      <div class="text-xs text-[var(--color-text-muted)]">
        {exec.screenshots.length} screenshot(s){exec.errors.length ? ` · ${exec.errors.length} error(s)` : ''}
      </div>
      {exec.qaNotes && <div class="text-[11px] text-[var(--color-text-muted)]">{exec.qaNotes}</div>}
    </div>
  );
}

function UsagePanel({ usage }: { usage: Usage }) {
  const rows: Array<[string, Win]> = [['Today', usage.today], ['This week', usage.week], ['This month', usage.month], ['Lifetime', usage.lifetime]];
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="text-[var(--color-text)] font-medium">Usage</div>
        <div class="text-xs text-[var(--color-text-muted)]">{usage.provider} · {usage.model} · {usage.playbooksCreated} playbooks · estimated, no caps</div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        {rows.map(([label, w]) => (
          <div class="rounded-md border border-[var(--color-border)] px-3 py-2">
            <div class="text-xs text-[var(--color-text-muted)]">{label}</div>
            <div class="text-sm">{w.sessions} sessions</div>
            <div class="text-sm">{fmtDur(w.durationMs)}</div>
            <div class="text-sm text-emerald-400">{fmtCost(w.costUsd)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Live: controls + transcript + events ─────────────────────────────────
function LiveView(props: any) {
  const {
    session, transcript, events, bindings, guard, liveCost, micMuted, aiMuted, paused, busy,
    wsState, aiState, aiReason, screenOn, micOn, audioLevel, aiSpeaking, heardInterim, framesSent,
    shotsSaved, browserEvents, latencyMs, partial,
    previewRef, onMic, onAi, onPause, onStop,
  } = props;
  const boundFields = Object.entries(bindings || {});
  const steps = (events || []).filter((e: EventLine) => ['nav', 'click', 'input', 'screenshot'].includes(e.kind));
  const stepsCount = shotsSaved + steps.length; // visual steps (screenshots) + any DOM events

  // Subsystem states → the operator-visible indicators.
  const aiLive = aiState === 'live';
  const aiFailed = aiState === 'recording_only' || aiState === 'model_error' || aiState === 'model_closed';
  const recording = screenOn && wsState === 'open';
  const latencyTxt = latencyMs ? `${(latencyMs / 1000).toFixed(1)}s` : '—';

  return (
    <div class="space-y-4">
      {/* Header + controls */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="font-medium">{session.title || 'Training session'}</div>
            <div class="text-xs text-[var(--color-text-muted)]">{session.website}</div>
          </div>
          <div class="text-xs text-[var(--color-text-muted)]">est {fmtCost(liveCost)} · {framesSent} frames sent</div>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <CtlBtn active={!micMuted} onClick={onMic} onIcon={<Mic size={15} />} offIcon={<MicOff size={15} />} label={micMuted ? 'Mic muted' : 'Mic live'} />
          <CtlBtn active={!aiMuted} onClick={onAi} onIcon={<Volume2 size={15} />} offIcon={<VolumeX size={15} />} label={aiMuted ? 'AI muted' : 'AI voice on'} />
          <button onClick={onPause} class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm">
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume' : 'Pause listening'}
          </button>
          <button onClick={onStop} disabled={busy === 'end'}
            class="inline-flex items-center gap-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 text-sm disabled:opacity-50">
            <Square size={15} /> {busy === 'end' ? 'Wrapping up…' : 'Stop & build playbook'}
          </button>
        </div>
      </div>

      {/* Loud failure banners — the session must never silently fail. */}
      {micOn === 'denied' && (
        <Banner tone="red">Microphone not connected. LandOS cannot hear you — allow mic access and restart the session.</Banner>
      )}
      {aiFailed && (
        <Banner tone="amber">
          Live AI not connected{aiReason ? `: ${aiReason}` : '.'} Screen + voice are still being recorded, and the playbook
          will still be built when you stop — but LandOS will not talk back this session.
        </Banner>
      )}
      {screenOn && micOn !== 'on' && micOn !== 'denied' && (
        <Banner tone="amber">Screen sharing is active but no microphone is connected, so audio is not being captured.</Banner>
      )}
      {guard && (
        <Banner tone="amber"><ShieldAlert size={16} class="inline mr-1 -mt-0.5" />{guard} Session paused — resume only after you have moved off the paid action.</Banner>
      )}

      {/* Browser-events reality: shared tab has no DOM — say so, never silent 0. */}
      {browserEvents.reason && !browserEvents.connected && (
        <Banner tone="amber">Browser events not connected. {browserEvents.reason}</Banner>
      )}

      {/* Subsystem status strip — all required operator-visible states. */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Stat label="Screen share" ok={screenOn} okText="Connected" badText="Not shared" />
          <Stat label="Microphone" ok={micOn === 'on'} okText="Connected" badText={micOn === 'denied' ? 'Not connected' : 'Off'} />
          <Stat label="Live AI" ok={aiLive} pending={aiState === 'connecting'} okText="Connected" badText={aiState === 'connecting' ? 'Connecting…' : 'Not connected'} />
          <Stat label="AI voice" ok={aiSpeaking} pending={aiLive && !aiSpeaking} okText="Speaking…" badText={aiLive ? 'Idle' : '—'} />
          <Stat label="Recording" ok={recording} okText="Active" badText="Inactive" />
          <Stat label="Browser events" ok={browserEvents.connected} okText="Connected" badText="Not connected" />
          <Stat label="Screenshots saved" ok={shotsSaved > 0} okText={`${shotsSaved} saved`} badText="0 saved" />
          <div>
            <div class="text-[var(--color-text-muted)]">Frames sent / Latency</div>
            <div class="text-[var(--color-text)]">{framesSent} · <span class={latencyMs && latencyMs < 4000 ? 'text-emerald-400' : latencyMs ? 'text-amber-400' : 'text-[var(--color-text-muted)]'}>{latencyTxt}</span></div>
          </div>
          <div>
            <div class="text-[var(--color-text-muted)]">Steps / Fields</div>
            <div class="text-[var(--color-text)]">{stepsCount} steps · {boundFields.length} fields</div>
          </div>
          <div class="col-span-2 md:col-span-2">
            <div class="text-[var(--color-text-muted)] mb-1">Audio input {micMuted ? '(muted)' : 'detected'}</div>
            <AudioMeter level={micMuted ? 0 : audioLevel} />
          </div>
        </div>
      </div>

      <div class="grid md:grid-cols-3 gap-4">
        {/* Screen preview + conversation */}
        <div class="md:col-span-2 space-y-4">
          <div class="rounded-xl border border-[var(--color-border)] bg-black/40 overflow-hidden">
            <div class="text-xs text-[var(--color-text-muted)] px-3 pt-2">What LandOS sees (live screen)</div>
            <video ref={previewRef} muted autoplay playsinline class="w-full max-h-[300px] object-contain bg-black" />
          </div>
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 min-h-[180px]">
            <div class="flex items-center justify-between mb-2">
              <div class="text-xs text-[var(--color-text-muted)]">Conversation</div>
              {aiSpeaking && <div class="text-xs text-sky-400 flex items-center gap-1"><Volume2 size={13} /> LandOS speaking…</div>}
            </div>
            <div class="space-y-2">
              {transcript.length === 0 && !heardInterim && (
                <p class="text-sm text-[var(--color-text-muted)]">
                  {aiLive ? 'Connected. LandOS should greet you now — start walking through the workflow.'
                          : 'Recording. Start talking; your words appear here as they are heard.'}
                </p>
              )}
              {transcript.map((t: TranscriptTurn, i: number) => (
                <div key={i} class="text-sm">
                  <span class={t.role === 'ai' ? 'text-sky-400 font-medium' : 'text-[var(--color-text)] font-medium'}>{t.role === 'ai' ? 'LandOS' : 'You'}:</span>{' '}
                  <span class="text-[var(--color-text)]">{t.text}</span>
                </div>
              ))}
              {partial && partial.text && (
                <div class="text-sm text-[var(--color-text-muted)] italic">{partial.role === 'ai' ? 'LandOS' : 'You'} (…): {partial.text}</div>
              )}
              {!partial && heardInterim && (
                <div class="text-sm text-[var(--color-text-muted)] italic">You (hearing…): {heardInterim}</div>
              )}
            </div>
          </div>
        </div>

        {/* Learned steps / fields / events */}
        <div class="space-y-4">
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="text-xs text-[var(--color-text-muted)] mb-2">Captured steps: {stepsCount} ({shotsSaved} screenshots)</div>
            <p class="text-xs text-[var(--color-text-muted)]">Screenshots are saved automatically on the start frame, when you say "take screenshot" / "this is important," and when the page changes. Narrated steps are built from what you say when the playbook is generated.</p>
          </div>
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="text-xs text-[var(--color-text-muted)] mb-2">Learned fields ({boundFields.length})</div>
            {boundFields.length === 0 ? (
              <p class="text-sm text-[var(--color-text-muted)]">Say "this is the road frontage" while pointing at a value to teach a field.</p>
            ) : (
              <div class="space-y-1.5">
                {boundFields.map(([field, b]: [string, any]) => (
                  <div key={field} class="text-xs">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-[var(--color-text)]">{field.replace(/_/g, ' ')}</span>
                      <span class="text-[var(--color-text-muted)] truncate">{b.selector || `label:"${b.label}"`}</span>
                      <span class={b.confidence === 'high' ? 'text-emerald-400' : b.confidence === 'low' ? 'text-amber-400' : 'text-sky-400'}>{b.confidence}</span>
                    </div>
                    {b.note && <div class="text-[10px] text-[var(--color-text-muted)]">{b.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: any) {
  const cls = tone === 'red'
    ? 'border-red-500/50 bg-red-500/10 text-red-200'
    : 'border-amber-500/50 bg-amber-500/10 text-amber-200';
  return <div class={`rounded-lg border ${cls} px-3 py-2 text-sm`}>{children}</div>;
}

function Stat({ label, ok, pending, okText, badText }: any) {
  const dot = ok ? 'bg-emerald-400' : pending ? 'bg-sky-400 animate-pulse' : 'bg-red-400';
  const txt = ok ? 'text-emerald-400' : pending ? 'text-sky-400' : 'text-red-300';
  return (
    <div>
      <div class="text-[var(--color-text-muted)]">{label}</div>
      <div class="flex items-center gap-1.5"><span class={`inline-block w-2 h-2 rounded-full ${dot}`} /><span class={txt}>{ok ? okText : badText}</span></div>
    </div>
  );
}

function AudioMeter({ level }: { level: number }) {
  const pct = Math.min(100, Math.round((level || 0) * 140));
  const tone = pct > 60 ? 'bg-emerald-400' : pct > 15 ? 'bg-sky-400' : 'bg-[var(--color-border)]';
  return (
    <div class="h-3 w-full rounded bg-[var(--color-elevated)] overflow-hidden border border-[var(--color-border)]">
      <div class={`h-full ${tone} transition-[width] duration-75`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CtlBtn({ active, onClick, onIcon, offIcon, label }: any) {
  return (
    <button onClick={onClick}
      class={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${active ? 'border-[var(--color-border)]' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
      {active ? onIcon : offIcon} {label}
    </button>
  );
}

// ── Review: playbook + knowledge + replay ────────────────────────────────
function ReviewView(props: any) {
  const { playbook, knowledge, replay, busy, transcript = [], framesSent = 0, onDecide, onReplay, onKnowledge, onDone } = props;
  const body = playbook.body || {};
  const steps: any[] = Array.isArray(body.steps) ? body.steps : [];
  const screenshots: string[] = Array.isArray(body.screenshotsRequired) ? body.screenshotsRequired : [];
  return (
    <div class="space-y-4">
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-lg font-medium">{playbook.name}</div>
            <div class="text-xs text-[var(--color-text-muted)]">{body.website || playbook.website} · v{playbook.version} · <StatusPill status={playbook.status} /></div>
          </div>
          <div class="flex items-center gap-2">
            <button onClick={() => onDecide('approved')} disabled={busy === 'decide' || playbook.status === 'approved'}
              class="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm disabled:opacity-50"><Check size={15} /> Approve</button>
            <button onClick={() => onDecide('rejected')} disabled={busy === 'decide'}
              class="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 text-red-300 px-3 py-1.5 text-sm"><X size={15} /> Reject</button>
            <button onClick={onReplay} disabled={busy === 'replay'}
              class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm"><RefreshCw size={15} /> {busy === 'replay' ? 'Replaying…' : 'Replay test'}</button>
          </div>
        </div>

        {/* What was learned + whether another pass is needed. */}
        {(body.learningSummary || body.captureMode) && (
          <div class={`mt-3 rounded-md border px-3 py-2 text-xs ${body.needsSelectorConfirmation ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
            <span class="font-medium">{body.captureMode === 'dom' ? 'DOM workflow' : 'Visual / narrated workflow'}:</span>{' '}
            {body.learningSummary || (body.needsSelectorConfirmation ? 'Selectors need a confirmation pass.' : 'Ready.')}
          </div>
        )}

        <div class="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-[var(--color-text-muted)] mb-1">Captured steps ({steps.length})</div>
            <ol class="space-y-1 text-sm list-decimal list-inside">
              {steps.map((s: any, i: number) => (
                <li key={i}>{s.action}{s.selector ? <span class="text-[var(--color-text-muted)]"> · {s.selector}</span> : null}</li>
              ))}
              {steps.length === 0 && <p class="text-sm text-[var(--color-text-muted)]">Nothing was captured this session (no narration, screenshots, or events).</p>}
            </ol>
          </div>
          <div>
            <div class="text-xs text-[var(--color-text-muted)] mb-1">Session transcript ({transcript.length} turns)</div>
            <div class="space-y-1 max-h-48 overflow-y-auto text-sm">
              {transcript.length === 0 ? <p class="text-[var(--color-text-muted)]">No transcript captured (Live AI may not have connected).</p> : transcript.map((t: TranscriptTurn, i: number) => (
                <div key={i}><span class={t.role === 'ai' ? 'text-sky-400' : 'text-[var(--color-text)]'}>{t.role === 'ai' ? 'LandOS' : 'You'}:</span> <span class="text-[var(--color-text-muted)]">{t.text}</span></div>
              ))}
            </div>
          </div>
        </div>

        <div class="mt-3 text-xs text-[var(--color-text-muted)]">
          Screenshots / frames: {screenshots.length} screenshot step(s) captured · {framesSent} screen frame(s) sent to LandOS during the session.
        </div>

        {body.fieldSelectors && Object.keys(body.fieldSelectors).length > 0 && (
          <div class="mt-4">
            <div class="text-xs text-[var(--color-text-muted)] mb-1">Learned fields ({Object.keys(body.fieldSelectors).length}) — extracted + written to the Deal Card on live runs</div>
            <div class="grid md:grid-cols-2 gap-1">
              {Object.entries(body.fieldSelectors).map(([field, b]: [string, any]) => (
                <div key={field} class="text-xs flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                  <span class="text-[var(--color-text)]">{field.replace(/_/g, ' ')}</span>
                  <span class="text-[var(--color-text-muted)] truncate">{b.selector || `label:"${b.label}"`}</span>
                  <span class={b.confidence === 'high' ? 'text-emerald-400' : b.confidence === 'low' ? 'text-amber-400' : 'text-sky-400'}>{b.confidence}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div class="mt-4 grid md:grid-cols-2 gap-3">
          {PLAYBOOK_SECTIONS.map((sec) => {
            const v = body[sec.key];
            const items = Array.isArray(v) ? v : v ? [String(v)] : [];
            if (items.length === 0) return null;
            return (
              <div class="rounded-md border border-[var(--color-border)] p-3">
                <div class="text-xs font-medium text-[var(--color-text)] mb-1">{sec.label}</div>
                <ul class="text-xs text-[var(--color-text-muted)] space-y-0.5 list-disc list-inside">
                  {items.map((it: string, i: number) => <li key={i}>{it}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {replay && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="text-sm font-medium mb-2">Replay result {replay.ok ? <span class="text-emerald-400">· passed</span> : <span class="text-amber-400">· needs attention</span>}</div>
          <div class="text-xs text-[var(--color-text-muted)] mb-2">{replay.summary}</div>
          <div class="space-y-1">
            {(replay.steps || []).map((s: any, i: number) => (
              <div key={i} class="text-xs">
                <span class={s.status === 'passed' ? 'text-emerald-400' : s.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>{s.status}</span>
                {' '}<span class="text-[var(--color-text-muted)]">{s.action} — {s.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="text-sm font-medium mb-1">Save as permanent LandOS knowledge?</div>
        <p class="text-xs text-[var(--color-text-muted)] mb-3">These are org rules extracted from the session, separate from the workflow steps.</p>
        {knowledge.length === 0 ? <p class="text-sm text-[var(--color-text-muted)]">No knowledge extracted from this session.</p> : (
          <div class="space-y-2">
            {knowledge.map((k: Knowledge) => (
              <div class="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2">
                <div>
                  <div class="text-sm"><span class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] mr-2">{k.category.replace(/_/g, ' ')}</span>{k.title}</div>
                  <div class="text-xs text-[var(--color-text-muted)]">{k.body}</div>
                </div>
                {k.status === 'proposed' ? (
                  <div class="flex items-center gap-1 shrink-0">
                    <button onClick={() => onKnowledge(k.id, true)} class="p-1.5 rounded-md border border-emerald-500/40 text-emerald-400"><Save size={14} /></button>
                    <button onClick={() => onKnowledge(k.id, false)} class="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)]"><Trash2 size={14} /></button>
                  </div>
                ) : <span class="text-xs shrink-0 text-[var(--color-text-muted)]">{k.status}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={onDone} class="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">Done</button>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    approved: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
    draft: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
    rejected: 'text-red-400 border-red-500/40 bg-red-500/10',
    superseded: 'text-[var(--color-text-muted)] border-[var(--color-border)]',
  };
  return <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${tone[status] || tone.superseded}`}>{status}</span>;
}
