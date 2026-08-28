import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, Mic, Send, Sparkles, X } from 'lucide-preact';
import { apiPost } from '@/lib/api';
import { subscribeChatStream, chatStreamConnected } from '@/lib/chat-stream';

interface DockTurn { role: 'user' | 'assistant'; content: string }

/**
 * Where Max sits, and whether it is open. Persisted so the shell does not jump
 * back over the page's own controls on every Deal navigation or refresh.
 */
interface DockPlacement { x: number; y: number; expanded: boolean }

const PLACEMENT_KEY = 'landos.max-dock.placement.v1';
const EDGE = 12;

function readPlacement(): DockPlacement | null {
  try {
    const raw = window.localStorage.getItem(PLACEMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DockPlacement>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x as number, y: parsed.y as number, expanded: parsed.expanded === true };
  } catch {
    return null;
  }
}

/**
 * Keep the shell on screen.
 *
 * A saved position is only valid for the viewport it was saved in: a narrower
 * window, or collapsing a 390px panel into a 52px orb, can both put it out of
 * reach. Every placement goes through here, so a stale coordinate is corrected
 * rather than stranding Max off the edge.
 */
function clampToViewport(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const maxX = Math.max(EDGE, window.innerWidth - width - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - height - EDGE);
  return {
    x: Math.min(Math.max(EDGE, x), maxX),
    y: Math.min(Math.max(EDGE, y), maxY),
  };
}

/** Persistent chief-of-staff surface mounted above the global router. */
export function MaxDock() {
  const stored = useRef<DockPlacement | null>(readPlacement()).current;
  const [expanded, setExpanded] = useState(stored?.expanded ?? false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    stored ? { x: stored.x, y: stored.y } : null,
  );
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<DockTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<any>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  // Set while a pointer drag actually moved, so releasing the orb after a drag
  // does not also count as the click that expands it.
  const draggedRef = useRef(false);
  const dragStateRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null);

  useEffect(() => subscribeChatStream((eventName, data) => {
    if (eventName === 'user_message' && data.content) {
      setTurns((current) => [...current, { role: 'user', content: data.content }].slice(-12));
    } else if (eventName === 'assistant_message' && data.content) {
      setTurns((current) => [...current, { role: 'assistant', content: data.content }].slice(-12));
      setProcessing(false); setProgress(''); setExpanded(true);
    } else if (eventName === 'processing') {
      setProcessing(Boolean(data.processing));
      if (!data.processing) setProgress('');
    } else if (eventName === 'progress') {
      setProgress(data.description || 'Working…');
    } else if (eventName === 'error') {
      setError(data.content || 'Max could not complete that turn.');
      setProcessing(false);
    }
  }), []);

  useEffect(() => {
    if (expanded && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [turns, processing, expanded]);

  // Re-clamp against the shell's CURRENT size. Runs on first paint (no saved
  // placement means the historical bottom-right corner), and again whenever
  // expanding or collapsing changes how much room the shell needs.
  useLayoutEffect(() => {
    const element = shellRef.current;
    if (!element) return;
    const { offsetWidth: width, offsetHeight: height } = element;
    setPosition((current) => {
      const base = current ?? {
        x: window.innerWidth - width - EDGE,
        y: window.innerHeight - height - EDGE,
      };
      const next = clampToViewport(base.x, base.y, width, height);
      return current && next.x === current.x && next.y === current.y ? current : next;
    });
  }, [expanded]);

  useEffect(() => {
    const onResize = () => {
      const element = shellRef.current;
      if (!element) return;
      setPosition((current) => {
        if (!current) return current;
        const next = clampToViewport(current.x, current.y, element.offsetWidth, element.offsetHeight);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!position) return;
    try {
      window.localStorage.setItem(PLACEMENT_KEY, JSON.stringify({ ...position, expanded }));
    } catch { /* a browser refusing storage must not break the shell */ }
  }, [position, expanded]);

  const onDragPointerDown = useCallback((event: PointerEvent) => {
    const element = shellRef.current;
    if (!element || event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
    };
    draggedRef.current = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const onDragPointerMove = useCallback((event: PointerEvent) => {
    const state = dragStateRef.current;
    const element = shellRef.current;
    if (!state || !element || state.pointerId !== event.pointerId) return;
    // A press is not a drag until it actually travels. Treating any pointermove
    // as a drag makes the orb unclickable, because a plain click emits one.
    if (!draggedRef.current
      && Math.abs(event.clientX - state.startX) < 4
      && Math.abs(event.clientY - state.startY) < 4) return;
    event.preventDefault();
    draggedRef.current = true;
    setPosition(clampToViewport(
      event.clientX - state.offsetX,
      event.clientY - state.offsetY,
      element.offsetWidth,
      element.offsetHeight,
    ));
  }, []);

  const endDrag = useCallback((event: PointerEvent) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setDragging(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }, []);

  const dragHandlers = {
    onPointerDown: onDragPointerDown,
    onPointerMove: onDragPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true); setError(''); setExpanded(true);
    try {
      const response = await apiPost<{ ok?: boolean; error?: string }>('/api/chat/send', { message });
      if (!response.ok && response.error) throw new Error(response.error === 'busy' ? 'Max is finishing another turn.' : response.error);
      setDraft('');
    } catch (err) {
      setError((err as Error).message || 'Max could not receive that message.');
    } finally { setSending(false); }
  }

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop?.(); return; }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('Voice input is not available in this browser.'); setExpanded(true); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    let transcript = '';
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => { transcript = event.results[event.results.length - 1][0]?.transcript || ''; };
    recognition.onerror = () => setError('Voice input stopped. You can type or try again.');
    recognition.onend = () => { setListening(false); if (transcript) setDraft((current) => `${current}${current ? ' ' : ''}${transcript}`); };
    recognitionRef.current = recognition; recognition.start();
  }

  // Positioned from the top-left in both states so one coordinate pair, one
  // clamp and one drag serve the panel and the orb alike.
  const placement = {
    left: `${position?.x ?? 0}px`,
    top: `${position?.y ?? 0}px`,
    visibility: position ? 'visible' : 'hidden',
    touchAction: 'none',
  } as const;

  // ── Collapsed: a small draggable launcher, nothing more ────────────────────
  // Deliberately 52px and nothing else: the whole point is that Max stops
  // covering the Smart Intake attach/send controls it used to sit on top of.
  if (!expanded) {
    return (
      <aside
        ref={shellRef as any}
        data-testid="max-dock"
        data-max-dock-state="collapsed"
        aria-label="Max chief of staff"
        class="fixed z-[70]"
        style={placement}
      >
        <button
          data-testid="max-dock-orb"
          type="button"
          title="Open Max · drag to move"
          aria-label="Open Max"
          onClick={() => { if (!draggedRef.current) setExpanded(true); }}
          {...dragHandlers}
          class={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl transition-shadow ${dragging ? 'cursor-grabbing' : 'cursor-grab hover:shadow-xl'}`}
        >
          <span class={`flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-white ${processing ? 'animate-pulse' : ''}`}>
            <Sparkles size={16} />
          </span>
          {processing ? <span data-testid="max-dock-orb-busy" class="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--color-accent)]" /> : null}
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={shellRef as any}
      data-testid="max-dock"
      data-max-dock-state="expanded"
      aria-label="Max chief of staff"
      class="fixed z-[70] w-[min(390px,calc(100vw-1.5rem))] rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl"
      style={placement}
    >
      <div
        data-testid="max-dock-header"
        {...dragHandlers}
        class={`flex w-full items-center gap-2 px-3 py-2 text-left ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <span class="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-white"><Sparkles size={15} /></span>
        <span class="min-w-0 flex-1"><span class="block text-[12.5px] font-semibold text-[var(--color-text)]">Max</span><span class="block truncate text-[10px] text-[var(--color-text-muted)]">Chief of staff · {chatStreamConnected.value ? processing ? progress || 'Working…' : 'ready' : 'reconnecting…'}</span></span>
        <button
          data-testid="max-dock-minimize"
          type="button"
          title="Minimize Max"
          aria-label="Minimize Max"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setExpanded(false)}
          class="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
        >
          <ChevronDown size={15} />
        </button>
      </div>

      <div data-testid="max-dock-conversation" class="border-t border-[var(--color-border)]"><div ref={messagesRef} class="max-h-72 min-h-28 space-y-2 overflow-y-auto p-3">
        {!turns.length && !processing ? <p class="text-[11.5px] text-[var(--color-text-muted)]">Talk to me about the page you’re on, a lead, a department, or what needs your attention.</p> : null}
        {turns.map((turn, index) => <div key={index} class={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}><div class={`max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[11.5px] ${turn.role === 'user' ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-border)] bg-[var(--color-elevated)] text-[var(--color-text)]'}`}>{turn.content}</div></div>)}
        {processing ? <div data-testid="max-dock-processing" class="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]"><Sparkles size={12} class="animate-pulse" />{progress || 'Max is thinking…'}</div> : null}
        {error ? <div role="alert" class="flex items-start gap-2 text-[10.5px] text-red-500"><span class="flex-1">{error}</span><button type="button" onClick={() => setError('')}><X size={12} /></button></div> : null}
      </div></div>

      <div class="flex items-end gap-1.5 border-t border-[var(--color-border)] p-2">
        <textarea data-testid="max-dock-input" aria-label="Talk to Max" rows={1} value={draft} onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Talk to Max…" class="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]" />
        <button data-testid="max-dock-microphone" type="button" onClick={toggleVoice} title={listening ? 'Stop listening' : 'Talk to Max'} class={`flex h-9 w-9 items-center justify-center rounded-lg border ${listening ? 'border-red-500 bg-red-500/15 text-red-500' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}><Mic size={14} /></button>
        <button data-testid="max-dock-send" type="button" onClick={() => void send()} disabled={!draft.trim() || sending} title="Send to Max" class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40"><Send size={14} /></button>
      </div>
    </aside>
  );
}
