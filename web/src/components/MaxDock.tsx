import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronUp, Mic, Send, Sparkles, X } from 'lucide-preact';
import { apiPost } from '@/lib/api';
import { subscribeChatStream, chatStreamConnected } from '@/lib/chat-stream';

interface DockTurn { role: 'user' | 'assistant'; content: string }

/** Persistent chief-of-staff surface mounted above the global router. */
export function MaxDock() {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<DockTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<any>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

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

  return (
    <aside data-testid="max-dock" aria-label="Max chief of staff" class="fixed bottom-3 right-3 z-[70] w-[min(390px,calc(100vw-1.5rem))] rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
      <button data-testid="max-dock-header" type="button" onClick={() => setExpanded((value) => !value)} class="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span class="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-white"><Sparkles size={15} /></span>
        <span class="min-w-0 flex-1"><span class="block text-[12.5px] font-semibold text-[var(--color-text)]">Max</span><span class="block truncate text-[10px] text-[var(--color-text-muted)]">Chief of staff · {chatStreamConnected.value ? processing ? progress || 'Working…' : 'ready' : 'reconnecting…'}</span></span>
        {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>

      {expanded ? <div data-testid="max-dock-conversation" class="border-t border-[var(--color-border)]"><div ref={messagesRef} class="max-h-72 min-h-28 space-y-2 overflow-y-auto p-3">
        {!turns.length && !processing ? <p class="text-[11.5px] text-[var(--color-text-muted)]">Talk to me about the page you’re on, a lead, a department, or what needs your attention.</p> : null}
        {turns.map((turn, index) => <div key={index} class={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}><div class={`max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[11.5px] ${turn.role === 'user' ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--color-border)] bg-[var(--color-elevated)] text-[var(--color-text)]'}`}>{turn.content}</div></div>)}
        {processing ? <div data-testid="max-dock-processing" class="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]"><Sparkles size={12} class="animate-pulse" />{progress || 'Max is thinking…'}</div> : null}
        {error ? <div role="alert" class="flex items-start gap-2 text-[10.5px] text-red-500"><span class="flex-1">{error}</span><button type="button" onClick={() => setError('')}><X size={12} /></button></div> : null}
      </div></div> : null}

      <div class="flex items-end gap-1.5 border-t border-[var(--color-border)] p-2">
        <textarea data-testid="max-dock-input" aria-label="Talk to Max" rows={1} value={draft} onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Talk to Max…" class="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]" />
        <button data-testid="max-dock-microphone" type="button" onClick={toggleVoice} title={listening ? 'Stop listening' : 'Talk to Max'} class={`flex h-9 w-9 items-center justify-center rounded-lg border ${listening ? 'border-red-500 bg-red-500/15 text-red-500' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}><Mic size={14} /></button>
        <button data-testid="max-dock-send" type="button" onClick={() => void send()} disabled={!draft.trim() || sending} title="Send to Max" class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40"><Send size={14} /></button>
      </div>
    </aside>
  );
}
