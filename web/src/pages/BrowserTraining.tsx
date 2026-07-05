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
  const [connState, setConnState] = useState('idle');
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
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => { void loadLibrary(); return () => { teardownCapture(); }; }, []);
  useEffect(() => { micMutedRef.current = micMuted; }, [micMuted]);
  useEffect(() => { aiMutedRef.current = aiMuted; }, [aiMuted]);

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
    try {
      // 1) get screen + mic BEFORE opening the socket so a denied prompt aborts cleanly.
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenRef.current = screen;
      let mic: MediaStream | null = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { /* mic optional; recording-only still works */ }
      micRef.current = mic;

      // 2) create the session row
      const { session: s } = await apiPost<{ session: Session }>('/api/landos/training/sessions', { title, website, surface });
      setSession(s); setTranscript([]); setEvents([]); setBindings({}); setGuard(null); setLiveCost(0);
      setMicMuted(false); setAiMuted(false); setPaused(false); setView('live');

      // 3) open the realtime socket
      openSocket(s.id);
      // 4) start streaming audio + video frames
      startMicStream(mic);
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
    ws.onopen = () => setConnState('connecting');
    ws.onclose = () => setConnState('closed');
    ws.onerror = () => setConnState('error');
    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'status':
          setConnState(m.state); if (m.message) setConnNote(m.message); break;
        case 'transcript':
          setTranscript((t) => [...t.slice(-200), { role: m.role, text: m.text }]); break;
        case 'ai_audio':
          if (!aiMutedRef.current) playAiAudio(m.data); break;
        case 'usage':
          if (typeof m.estCostUsd === 'number') setLiveCost(m.estCostUsd); break;
        case 'guard':
          setGuard(m.reason); setPaused(true); break;
        case 'event_recorded':
          setEvents((e) => [...e.slice(-200), { seq: m.seq, kind: m.kind, text: m.kind }]); break;
        case 'field_binding_captured':
          setBindings((b) => ({ ...b, [m.field]: { selector: m.selector, label: m.label, confidence: m.confidence, strategy: m.strategy } })); break;
        default: break;
      }
    };
  }

  function startMicStream(mic: MediaStream | null) {
    if (!mic) return;
    const ctx = new AudioContext({ sampleRate: 16000 });
    inCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(mic);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    src.connect(proc); proc.connect(ctx.destination);
    proc.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1 || micMutedRef.current || paused) return;
      const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0));
      ws.send(JSON.stringify({ type: 'audio', data: bytesToBase64(new Uint8Array(pcm)) }));
    };
  }

  function startScreenFrames(screen: MediaStream) {
    const video = document.createElement('video');
    video.srcObject = screen; video.muted = true; void video.play();
    videoElRef.current = video;
    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;
    // 1 frame/sec is plenty for workflow understanding and keeps cost sane.
    frameTimerRef.current = window.setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1 || paused) return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      const scale = Math.min(1, 1024 / w);
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      const cx = canvas.getContext('2d'); if (!cx) return;
      cx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      if (b64) ws.send(JSON.stringify({ type: 'video', data: b64 }));
    }, 1000);
    // When the operator stops sharing via the browser chrome, end the session.
    screen.getVideoTracks()[0].addEventListener('ended', () => { void endSession(); });
  }

  function playAiAudio(b64: string) {
    try {
      const bytes = base64ToBytes(b64);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const ctx = outCtxRef.current ?? new AudioContext({ sampleRate: 24000 });
      outCtxRef.current = ctx;
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
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try { screenRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { inCtxRef.current?.close(); } catch {}
    screenRef.current = null; micRef.current = null; inCtxRef.current = null;
    outTimeRef.current = 0;
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
            session={session} connState={connState} connNote={connNote} transcript={transcript}
            events={events} bindings={bindings} guard={guard} liveCost={liveCost} micMuted={micMuted} aiMuted={aiMuted}
            paused={paused} busy={busy}
            onMic={() => setMicMuted((v) => !v)} onAi={() => setAiMuted((v) => !v)}
            onPause={togglePause} onStop={endSession}
          />
        )}

        {view === 'review' && playbook && (
          <ReviewView
            playbook={playbook} knowledge={knowledge} replay={replay} busy={busy}
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
        {exec.approvalRequired && <span class="ml-2 text-amber-300">· Approval Required</span>}
      </div>
      {exec.approvalRequired && exec.blockedActions.length > 0 && (
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
  const { session, connState, connNote, transcript, events, bindings, guard, liveCost, micMuted, aiMuted, paused, busy, onMic, onAi, onPause, onStop } = props;
  const boundFields = Object.entries(bindings || {});
  const stateTone = connState === 'live' ? 'text-emerald-400' : connState === 'recording_only' ? 'text-amber-400' : 'text-sky-400';
  return (
    <div class="space-y-4">
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="font-medium">{session.title || 'Training session'}</div>
            <div class="text-xs text-[var(--color-text-muted)]">{session.website} · <span class={stateTone}>{connState}</span></div>
          </div>
          <div class="text-xs text-[var(--color-text-muted)]">est {fmtCost(liveCost)}</div>
        </div>
        {connNote && <div class="mt-2 text-xs text-amber-300">{connNote}</div>}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <CtlBtn active={!micMuted} onClick={onMic} onIcon={<Mic size={15} />} offIcon={<MicOff size={15} />} label={micMuted ? 'Mic off' : 'Mic on'} />
          <CtlBtn active={!aiMuted} onClick={onAi} onIcon={<Volume2 size={15} />} offIcon={<VolumeX size={15} />} label={aiMuted ? 'AI muted' : 'AI voice'} />
          <button onClick={onPause} class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm">
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={onStop} disabled={busy === 'end'}
            class="inline-flex items-center gap-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 text-sm disabled:opacity-50">
            <Square size={15} /> {busy === 'end' ? 'Wrapping up…' : 'Stop & build playbook'}
          </button>
        </div>
      </div>

      {guard && (
        <div class="rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-200 px-3 py-2 text-sm flex items-start gap-2">
          <ShieldAlert size={16} class="mt-0.5 shrink-0" /> <span>{guard} Session paused — resume only after you have moved off the paid action.</span>
        </div>
      )}

      <div class="grid md:grid-cols-3 gap-4">
        <div class="md:col-span-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 min-h-[240px]">
          <div class="text-xs text-[var(--color-text-muted)] mb-2">Conversation</div>
          <div class="space-y-2">
            {transcript.length === 0 && <p class="text-sm text-[var(--color-text-muted)]">Start talking. LandOS is watching your screen and listening.</p>}
            {transcript.map((t: TranscriptTurn, i: number) => (
              <div key={i} class="text-sm">
                <span class={t.role === 'ai' ? 'text-sky-400 font-medium' : 'text-[var(--color-text)] font-medium'}>{t.role === 'ai' ? 'LandOS' : 'You'}:</span>{' '}
                <span class="text-[var(--color-text)]">{t.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div class="space-y-4">
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="text-xs text-[var(--color-text-muted)] mb-2">Learned fields</div>
            {boundFields.length === 0 ? (
              <p class="text-sm text-[var(--color-text-muted)]">Say "this is the road frontage" while pointing at a value to teach a field.</p>
            ) : (
              <div class="space-y-1">
                {boundFields.map(([field, b]: [string, any]) => (
                  <div key={field} class="text-xs flex items-center justify-between gap-2">
                    <span class="text-[var(--color-text)]">{field.replace(/_/g, ' ')}</span>
                    <span class="text-[var(--color-text-muted)] truncate">{b.selector || `label:"${b.label}"`}</span>
                    <span class={b.confidence === 'high' ? 'text-emerald-400' : b.confidence === 'low' ? 'text-amber-400' : 'text-sky-400'}>{b.confidence}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="text-xs text-[var(--color-text-muted)] mb-2">Captured steps</div>
            {events.length === 0 ? <p class="text-sm text-[var(--color-text-muted)]">No browser events yet.</p> : (
              <div class="space-y-1">
                {events.map((e: EventLine, i: number) => (
                  <div key={i} class="text-xs text-[var(--color-text-muted)]">#{e.seq} {e.kind} {e.text}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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
  const { playbook, knowledge, replay, busy, onDecide, onReplay, onKnowledge, onDone } = props;
  const body = playbook.body || {};
  const steps: any[] = Array.isArray(body.steps) ? body.steps : [];
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

        <div class="mt-4">
          <div class="text-xs text-[var(--color-text-muted)] mb-1">Steps ({steps.length})</div>
          <ol class="space-y-1 text-sm list-decimal list-inside">
            {steps.map((s: any, i: number) => (
              <li key={i}>{s.action}{s.selector ? <span class="text-[var(--color-text-muted)]"> · {s.selector}</span> : null}</li>
            ))}
            {steps.length === 0 && <p class="text-sm text-[var(--color-text-muted)]">No browser steps captured (voice-only session).</p>}
          </ol>
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
