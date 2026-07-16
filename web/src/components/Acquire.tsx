import { useRef, useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { ModelControl } from '@/components/ModelControl';
import { SmartIntake } from '@/components/SmartIntake';

// Acquire — conversational New Lead. Talking to LandOS IS the intake: the
// operator types or dictates natural language ("I have two parcels from one
// seller", "Seller says utilities are available", "This came from PPC") and
// LandOS extracts structured identity + deal intelligence over the FULL
// conversation while preserving every raw operator turn verbatim. When identity
// is strong enough, one action runs Property Resolution → Property Intelligence
// server-side and OPENS the Deal Card. Raw input is never rewritten; parcel
// identity is still verified only from named sources downstream.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

const PROGRESS_STAGES = [
  'Understanding the property you entered', 'Checking public parcel records',
  'Confirming parcel identity and conflicts', 'Screening public property intelligence',
  'Checking market context when identity is confirmed', 'Writing findings to the Deal Card',
  'Opening Deal Card', 'Complete',
];

function entityLabel(e: EntityFilter): string {
  if (e === 'LAND_ALLY') return 'Land Ally';
  if (e === 'TY_LAND_BIZ') return 'Solo Biz';
  return 'all entities';
}

interface AcquireResponse {
  ok: boolean; matched?: boolean; researchCardCreated?: boolean; parcelVerified?: boolean; dealCardId: number | null;
  pipeline?: string; status?: string; message?: string; guidance?: string;
  confidence?: number; matchedReason?: string; confirmBeforeOffer?: string[]; sources?: string[];
}

interface ChatMessage { role: 'operator' | 'landos'; text: string }
interface ConversationResponse {
  conversation: {
    reply: string;
    understood: Array<{ label: string; value: string }>;
    readyToRun: boolean;
    combinedText: string;
  };
}

export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [understood, setUnderstood] = useState<Array<{ label: string; value: string }>>([]);
  const [readyToRun, setReadyToRun] = useState(false);
  const [combinedText, setCombinedText] = useState('');
  const [sending, setSending] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsClarification, setNeedsClarification] = useState<string | null>(null);
  // Browser voice dictation (Web Speech). Dictation inserts into the SAME
  // conversational intake — speaking and typing are the same lead.
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const dictationBaseRef = useRef('');

  // ── Conversational turn — LandOS extracts + replies (raw text preserved) ──
  async function sendMessage() {
    const t = text.trim();
    if (!t || sending) return;
    const next: ChatMessage[] = [...messages, { role: 'operator', text: t }];
    setMessages(next);
    setText('');
    setSending(true);
    setError(null);
    try {
      const res = await apiPost<ConversationResponse>('/api/landos/intake/conversation', { messages: next });
      const conv = res.conversation;
      setMessages([...next, { role: 'landos', text: conv.reply }]);
      setUnderstood(conv.understood);
      setReadyToRun(conv.readyToRun);
      setCombinedText(conv.combinedText);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSending(false);
    }
  }

  // ── Voice dictation — inserts the transcript into the same intake input ────
  function toggleVoice() {
    const w = window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setVoiceNote('Voice dictation is not supported in this browser (Chrome supports it).');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    dictationBaseRef.current = text ? `${text.trim()} ` : '';
    rec.onresult = (e: any) => {
      let finals = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(`${dictationBaseRef.current}${finals}${interim}`.trimStart());
    };
    rec.onerror = (e: any) => { setVoiceNote(`Voice dictation error: ${e?.error ?? 'unknown'}.`); setListening(false); };
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
    setVoiceNote(null);
  }

  // ── The single run action — Property Resolution → DD, then open the card ──
  // Submits the FULL raw conversation (operator turns verbatim); unknown fields
  // ride along as Confirm Before Offer. Opens on a credible match or a research
  // card; on no practical match it shows guidance and opens nothing.
  async function runPropertyAnalysis() {
    const rawInput = (combinedText || text).trim();
    if (!rawInput) return;
    setRunning(true);
    setError(null);
    setNeedsClarification(null);
    try {
      const body: Record<string, unknown> = { text: rawInput, rawInput };
      if (entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ') body.entity = entity;
      const res = await apiPost<AcquireResponse>('/api/landos/acquire/run', body);
      if (res.ok && res.matched === true && res.dealCardId) {
        if (onOpenDealCard) onOpenDealCard(res.dealCardId);
      } else if (res.dealCardId && res.researchCardCreated === true) {
        if (onOpenDealCard) onOpenDealCard(res.dealCardId);
        setNeedsClarification(res.message || res.guidance || 'Opened a research Deal Card — providers could not verify the parcel yet.');
      } else {
        setNeedsClarification(res.guidance || res.message || 'No practical match could be established. Provide APN + county, owner + city/state, or a corrected address.');
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  const hasConversation = messages.length > 0;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Browser Intelligence operator control — start/connect the persistent
          Chrome session used for LandPortal/County browser work. */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">New Lead — talk to LandOS</div>
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="routing" orientation="task_oriented" label="Intake model" size="sm" />
        </div>

        {/* The conversation — every operator turn preserved verbatim, every
            LandOS turn explaining what it understood + the next question. */}
        {hasConversation && (
          <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div key={i} class={`flex ${m.role === 'operator' ? 'justify-end' : 'justify-start'}`}>
                <div class={`max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap ${
                  m.role === 'operator'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-elevated)] text-[var(--color-text)] border border-[var(--color-border)]'
                }`}>{m.text}</div>
              </div>
            ))}
            {sending && <div class="text-[11px] text-[var(--color-text-faint)]">LandOS is reading…</div>}
          </div>
        )}

        {/* What LandOS understood so far — structured extraction chips. */}
        {understood.length > 0 && (
          <div class="flex flex-wrap gap-1.5">
            {understood.map((c, i) => (
              <span key={i} class="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {c.label}: <span class="text-[var(--color-text)]">{c.value}</span>
              </span>
            ))}
          </div>
        )}

        <SmartIntake
          value={text}
          onInput={setText}
          onSubmit={() => void sendMessage()}
          disabled={sending || running}
          placeholder={hasConversation
            ? 'Keep going — add the APN, what the seller said, where the lead came from… (Enter sends)'
            : 'Tell LandOS about the lead in plain language: "I have two parcels from one seller in Sevier County AR, APN 094-020.08, seller says county water is available, came from PPC." (Enter sends)'}
        />

        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending || running || !text.trim()}
            class="px-3 py-2 rounded-md text-[13px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button
            type="button"
            onClick={toggleVoice}
            disabled={running}
            title="Dictate the lead by voice — inserts into the same conversation"
            class={`px-3 py-2 rounded-md text-[13px] font-medium border disabled:opacity-40 ${listening ? 'border-red-500 text-red-500 animate-pulse' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]'}`}
          >
            {listening ? '● Listening… (tap to stop)' : '🎙 Dictate'}
          </button>
          <button
            type="button"
            onClick={() => void runPropertyAnalysis()}
            disabled={running || (!combinedText.trim() && !text.trim())}
            class={`px-4 py-2 rounded-md text-[13px] font-semibold border text-white disabled:opacity-40 ${readyToRun ? 'border-[var(--color-accent)] bg-[var(--color-accent)] hover:opacity-90' : 'border-[var(--color-border)] bg-[var(--color-text-faint)]'}`}
          >
            {running ? 'Running Property Intelligence...' : 'Run Property Intelligence'}
          </button>
          {readyToRun && !running && <span class="text-[10px] text-[var(--color-status-done)]">Identity looks strong enough to run.</span>}
        </div>
        {voiceNote && <div class="text-[10px] text-[var(--color-text-muted)]">{voiceNote}</div>}
        <div class="text-[10px] text-[var(--color-text-faint)]">
          Tagging: <span class="text-[var(--color-text-muted)]">{entityLabel(entity)}</span>. Raw input always submits exactly as typed or spoken — LandOS organizes, it never rewrites. Address matching and parcel identity are handled downstream by Property Resolution. A Deal Card opens on a credible match; unknown fields ride along as Confirm Before Offer.
        </div>
      </div>

      {needsClarification && (
        <div class="rounded-lg border border-[var(--color-status-warn,var(--color-border))] bg-[var(--color-card)] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Needs clarification</div>
          <div class="text-[12px] text-[var(--color-text-muted)]">{needsClarification}</div>
        </div>
      )}

      {running && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Working…</div>
          <ul class="space-y-1">
            {PROGRESS_STAGES.slice(0, -1).map((s) => (
              <li key={s} class="text-[12px] text-[var(--color-text-muted)] flex items-center gap-2">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-pulse" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">{error}</div>}
    </div>
  );
}
