import { useRef, useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

interface ManualLeadResponse {
  dealCardId: number;
  opportunity?: { id: number; researchStatus?: string };
}

const EXAMPLE = `Paste whatever you have. For example:\n\nSeller is Maria Hernandez, 704-555-0182. She inherited about 7 acres near 1180 Old Mill Road in Rowan County, NC and wants to sell because she lives out of state. APN may be 123-45-678. She mentioned there may be an old easement and asked around $48,000. Lead source: Google PPC.`;

/** The operator's conversational front door. The source paste is preserved
 * exactly; cautious extraction happens after save and missing clues become work. */
export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [rawInput, setRawInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<any>(null);

  async function createLead(event: Event) {
    event.preventDefault();
    if (!rawInput.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const result = await apiPost<ManualLeadResponse>('/api/landos/leads/manual', {
        rawInput,
        entity: entity === 'all' ? undefined : entity,
      });
      if (!Number.isInteger(result.dealCardId) || result.dealCardId <= 0) throw new Error('The lead was saved without a workspace identifier.');
      setRawInput('');
      onOpenDealCard?.(result.dealCardId);
    } catch (err) {
      setError((err as Error).message || 'The lead could not be created.');
    } finally { setSaving(false); }
  }

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop?.();
      setListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Voice dictation is not available in this browser. You can still paste or type the lead.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map((result: any) => result[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) setRawInput((current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = () => { setListening(false); setError('Voice dictation stopped. You can continue by typing or try the microphone again.'); };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setError(''); setListening(true);
  }

  return (
    <form data-testid="manual-lead-form" onSubmit={(event) => void createLead(event)} class="mx-auto max-w-5xl space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
      <div>
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Tell LandOS what you know</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">Paste, type, or dictate the lead exactly as you received it. Names, phone numbers, parcel clues, seller situation, links, notes—any order is fine.</p>
      </div>

      <div class="relative">
        <textarea
          data-testid="manual-lead-raw-input"
          aria-label="Lead information"
          class="min-h-[330px] w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] px-4 py-4 pr-16 text-[14px] leading-6 text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          value={rawInput}
          placeholder={EXAMPLE}
          onInput={(event) => setRawInput((event.target as HTMLTextAreaElement).value)}
        />
        <button data-testid="manual-lead-microphone" type="button" onClick={toggleVoice} title={listening ? 'Stop dictation' : 'Dictate lead information'} class={`absolute right-3 top-3 rounded-full border px-3 py-2 text-[16px] ${listening ? 'border-red-500 bg-red-500/15 text-red-500' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-muted)]'}`}>
          {listening ? '■' : '🎙'}
        </button>
      </div>

      <div data-testid="manual-lead-intake-rule" class="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[11px] text-[var(--color-text)]">
        LandOS saves your original words, extracts only defensible clues, creates the Lead Card immediately, and starts research. Anything missing or uncertain stays marked for verification.
      </div>
      {error ? <div role="alert" class="text-[11px] text-red-600">{error}</div> : null}
      <div class="flex flex-wrap items-center gap-3">
        <button data-testid="manual-lead-create" type="submit" disabled={saving || !rawInput.trim()} class="rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {saving ? 'Creating Lead Card…' : 'Create Lead Card & start research'}
        </button>
        <span class="text-[10.5px] text-[var(--color-text-faint)]">No paid action, seller contact, offer, or contract is sent.</span>
      </div>
    </form>
  );
}
