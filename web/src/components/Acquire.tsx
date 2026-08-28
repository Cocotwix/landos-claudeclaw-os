import { useRef, useState } from 'preact/hooks';
import { Mic, Paperclip, Square, X } from 'lucide-preact';
import { apiPost, apiPostForm } from '@/lib/api';
import { foldSpeechResults, joinDictation } from '@/lib/dictation';

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

interface ManualLeadResponse {
  dealCardId: number;
  opportunity?: { id: number; researchStatus?: string };
}

const EXAMPLE = `Tell me about the lead. Paste anything — for example:

Seller is Maria Hernandez, 704-555-0182. She inherited about 7 acres near 1180 Old Mill Road in Rowan County, NC and wants to sell because she lives out of state. APN may be 123-45-678. She mentioned there may be an old easement and asked around $48,000. Lead source: Google PPC.

https://qpublic.schneidercorp.com/Application.aspx?AppID=907

Drop the survey, the deed, a screenshot, or the email too.`;

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `intake-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/**
 * The operator's conversational front door.
 *
 * You give LandOS whatever you have, in whatever shape you have it: prose, an
 * address, a parcel number, links, files, a screenshot, a dictated note. The
 * source paste is preserved exactly, every link and file is retained as intake
 * evidence associated with the deal, and extraction happens afterwards. Nothing
 * is refused for arriving in the wrong shape — organizing it is the computer's
 * job, not yours.
 */
export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [rawInput, setRawInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const [listening, setListening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<any>(null);
  // Dictation state is kept in refs, not state: the recognizer fires several
  // times per spoken word, and every one of those events has to see the value
  // the previous event wrote, not a render-old copy.
  const dictationBaseRef = useRef('');       // composer text before the mic opened
  const dictationCommittedRef = useRef('');  // finalized speech, appended once each
  const dictationCountRef = useRef(0);       // results already folded in, high-water mark
  const dictationDraftRef = useRef('');      // the replaceable live interim

  const attach = (files: File[]) => {
    if (!files.length) return;
    setAttachments((current) => [...current, ...files].slice(0, 10));
    setError('');
  };

  const onPaste = (event: ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);
    // Text paste stays native so selection, undo and line breaks behave.
    if (!pasted.length) return;
    event.preventDefault();
    attach(pasted);
  };

  async function createLead(event: Event) {
    event.preventDefault();
    if ((!rawInput.trim() && attachments.length === 0) || saving) return;
    setSaving(true); setError(''); setProgress('Creating the Lead Card…');
    try {
      const result = await apiPost<ManualLeadResponse>('/api/landos/leads/manual', {
        // A lead that is only attachments still needs its raw line; the file
        // names are the operator's own words about what they sent.
        rawInput: rawInput.trim() || attachments.map((file) => file.name).join('\n'),
        entity: entity === 'all' ? undefined : entity,
      });
      if (!Number.isInteger(result.dealCardId) || result.dealCardId <= 0) throw new Error('The lead was saved without a workspace identifier.');

      // Attachments land on the Deal Card that was just created, through the
      // intake endpoint that already retains originals immutably. A file that
      // fails to attach never discards the lead — the lead is the point, and
      // the failure is reported rather than swallowed.
      const failed: string[] = [];
      for (const [index, file] of attachments.entries()) {
        setProgress(`Attaching ${file.name} (${index + 1} of ${attachments.length})…`);
        const body = new FormData();
        body.append('files', file);
        body.append('sourceMethods', JSON.stringify(['upload']));
        body.append('note', rawInput);
        body.append('source', 'New Lead');
        body.append('submissionKey', uuid());
        try {
          await apiPostForm(`/api/landos/deal-cards/${result.dealCardId}/intake/upload`, body);
        } catch (err) {
          failed.push(`${file.name}: ${(err as Error).message}`);
        }
      }
      setRawInput('');
      setAttachments([]);
      setProgress('');
      if (failed.length) {
        // The lead exists; say plainly what did not attach instead of
        // navigating away as though everything landed.
        setError(`The Lead Card was created, but ${failed.length} attachment(s) could not be saved — ${failed.join('; ')}. Open the deal and attach them in Smart Intake.`);
      }
      onOpenDealCard?.(result.dealCardId);
    } catch (err) {
      setError((err as Error).message || 'The lead could not be created.');
    } finally { setSaving(false); setProgress(''); }
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
    // Interim results ON, so the operator watches the sentence appear instead
    // of waiting in silence. They are a DRAFT: replaced on every event, and
    // never the thing that gets committed. See `foldSpeechResults`.
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    // What the composer already held when the microphone opened. Preserved
    // verbatim, so dictation adds to typing rather than replacing it, and a
    // second dictation session appends after the first one's committed text.
    dictationBaseRef.current = rawInput;
    dictationCommittedRef.current = '';
    dictationCountRef.current = 0;
    dictationDraftRef.current = '';

    recognition.onresult = (event: any) => {
      const folded = foldSpeechResults(event, dictationCountRef.current);
      dictationCountRef.current = folded.consumed;
      dictationCommittedRef.current = joinDictation(dictationCommittedRef.current, folded.finalized);
      dictationDraftRef.current = folded.draft;
      setRawInput(joinDictation(
        dictationBaseRef.current,
        joinDictation(dictationCommittedRef.current, folded.draft),
      ));
    };
    const settle = () => {
      // Whatever is still only a draft becomes real. It cannot duplicate a
      // final: a finalized result advances `consumed` past itself for good and
      // clears the draft, so a draft surviving to here was never committed.
      dictationCommittedRef.current = joinDictation(dictationCommittedRef.current, dictationDraftRef.current);
      dictationDraftRef.current = '';
      setRawInput(joinDictation(dictationBaseRef.current, dictationCommittedRef.current));
    };
    recognition.onerror = () => {
      settle();
      setListening(false);
      setError('Voice dictation stopped. You can continue by typing or try the microphone again.');
    };
    recognition.onend = () => { settle(); setListening(false); };
    recognitionRef.current = recognition;
    recognition.start();
    setError(''); setListening(true);
  }

  return (
    <form
      data-testid="manual-lead-form"
      onSubmit={(event) => void createLead(event)}
      onPaste={onPaste}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        attach(Array.from(event.dataTransfer?.files ?? []));
      }}
      class="mx-auto max-w-5xl space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
    >
      <div>
        <h2 class="text-[18px] font-semibold text-[var(--color-text)]">Tell LandOS what you know</h2>
        <p class="mt-1 text-[12px] text-[var(--color-text-muted)]">
          Type, paste, dictate, or drop files. Names, phone numbers, parcel clues, seller situation, links, emails,
          deeds, surveys, screenshots, spreadsheets — any order is fine. If you have it, send it.
        </p>
      </div>

      <div class={`relative rounded-xl border ${dragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] bg-[var(--color-elevated)]'}`}>
        <textarea
          data-testid="manual-lead-raw-input"
          aria-label="Lead information"
          class="min-h-[300px] w-full resize-y rounded-xl bg-transparent px-4 py-4 pr-16 text-[14px] leading-6 text-[var(--color-text)] outline-none"
          value={rawInput}
          placeholder={EXAMPLE}
          onInput={(event) => setRawInput((event.target as HTMLTextAreaElement).value)}
        />
        <div class="absolute right-3 top-3 flex flex-col gap-2">
          <label
            data-testid="manual-lead-attach-label"
            title="Attach files"
            class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-muted)]"
          >
            <Paperclip size={16} />
            <input
              type="file"
              multiple
              class="sr-only"
              data-testid="manual-lead-attach"
              aria-label="Attach files to this lead"
              onChange={(event) => {
                const input = event.target as HTMLInputElement;
                attach(Array.from(input.files ?? []));
                input.value = '';
              }}
            />
          </label>
          <button
            data-testid="manual-lead-microphone"
            type="button"
            onClick={toggleVoice}
            title={listening ? 'Stop dictation' : 'Dictate lead information'}
            class={`flex h-10 w-10 items-center justify-center rounded-full border ${listening ? 'border-red-500 bg-red-500/15 text-red-500' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-muted)]'}`}
          >
            {listening ? <Square size={15} /> : <Mic size={16} />}
          </button>
        </div>
      </div>

      {attachments.length > 0 && (
        <div data-testid="manual-lead-attachments" class="flex flex-wrap gap-2">
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} class="inline-flex items-center gap-2 rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1 text-[11.5px] text-[var(--color-text)]">
              <Paperclip size={12} />
              {file.name}
              <span class="text-[var(--color-text-faint)]">{(file.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                class="text-[var(--color-text-faint)]"
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div data-testid="manual-lead-intake-rule" class="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[11px] text-[var(--color-text)]">
        LandOS keeps your original words and every link and file exactly as supplied, creates the Lead Card immediately,
        and starts research. A file it has no reader for is still kept and says so. Anything uncertain stays marked for verification.
      </div>
      {error ? <div role="alert" data-testid="manual-lead-error" class="text-[11px] text-red-600">{error}</div> : null}
      <div class="flex flex-wrap items-center gap-3">
        <button
          data-testid="manual-lead-create"
          type="submit"
          disabled={saving || (!rawInput.trim() && attachments.length === 0)}
          class="rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? (progress || 'Creating Lead Card…') : 'Create Lead Card & start research'}
        </button>
        <span class="text-[10.5px] text-[var(--color-text-faint)]">No paid action, seller contact, offer, or contract is sent.</span>
      </div>
    </form>
  );
}
