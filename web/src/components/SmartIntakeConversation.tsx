// Smart Intake — the conversation, on an existing Deal Card.
//
// This is the operator's way back into a run. Before it existed, an UNRESOLVED
// read was terminal in the UI: the only controls were "refresh resolution" and
// "re-run research", both of which repeat the work that already failed, with no
// way to tell LandOS the one thing that would unblock it ("they own three
// adjoining parcels, we are buying the vacant one, use the link I gave you").
//
// It is a conversation, not a form. You type in your own words, drop a file,
// paste a screenshot, paste a link. Everything you supply is retained as intake
// evidence and shown back to you, so the answer to "did it get what I sent?" is
// on screen instead of a guess. The reply is written by the model from the REAL
// persisted run state, and the steps it may name are a closed set of
// already-registered capabilities — this surface can ask for work, it cannot
// invent work.
//
// Nothing here starts a capability. Acting on the plan stays an explicit click
// on the controls that already exist, so typing never fires an expensive run.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Link2, MessagesSquare, Paperclip, Send, X } from 'lucide-preact';
import { apiGet, apiPost, apiPostForm } from '@/lib/api';

interface GuidanceTurn {
  id: number;
  role: 'operator' | 'deal_brain';
  text: string;
}

interface SmartIntakePlan {
  explanation: string;
  needFromOperator: string[];
  steps: string[];
  reasoning: string;
}

interface IntakeLink {
  id: number;
  url: string;
  classification: string;
  capability: string;
  note: string;
}

interface IntakeFile {
  name: string;
  mimeType: string;
  extractionStatus: string;
  note: string;
}

interface SmartIntakeState {
  artifacts?: { links?: IntakeLink[]; files?: IntakeFile[] };
  resolution?: { status?: string } | null;
}

interface SmartIntakeResponse {
  plan?: SmartIntakePlan;
  thread?: GuidanceTurn[];
  state?: SmartIntakeState;
}

/** How a supplied link reads on screen. Routing, never a property fact. */
const LINK_LABEL: Record<string, string> = {
  landportal_parcel: 'LandPortal parcel',
  landportal_map: 'LandPortal map',
  landportal_other: 'LandPortal page',
  assessor_gis: 'Assessor / GIS',
  county_official: 'Official source',
  listing: 'Listing',
  document: 'Document',
  web: 'Web page',
};

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `intake-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function SmartIntakeConversation({ dealId }: { dealId: number }) {
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<GuidanceTurn[]>([]);
  const [plan, setPlan] = useState<SmartIntakePlan | null>(null);
  const [links, setLinks] = useState<IntakeLink[]>([]);
  const [files, setFiles] = useState<IntakeFile[]>([]);
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const applyState = (state?: SmartIntakeState) => {
    if (!state?.artifacts) return;
    setLinks(state.artifacts.links ?? []);
    setFiles(state.artifacts.files ?? []);
  };

  // The conversation and everything attached, loaded from the server. Without
  // this the thread lived only in component state, so a refresh showed an empty
  // conversation on a deal that had one — which reads exactly like "it forgot".
  const load = () => apiGet<SmartIntakeResponse>(`/api/landos/deal-cards/${dealId}/smart-intake`)
    .then((res) => {
      if (Array.isArray(res.thread)) setThread(res.thread);
      applyState(res.state);
      setError(null);
    })
    .catch((err: Error) => setError(`The Smart Intake conversation could not be loaded (${err.message}). Nothing was lost; reload to try again.`));

  useEffect(() => { void load(); }, [dealId]);
  useEffect(() => {
    // Keep the newest turn in view without yanking the whole page around.
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, sending]);

  const attach = (incoming: File[]) => {
    if (!incoming.length) return;
    setPending((current) => [...current, ...incoming].slice(0, 10));
    setNotice(`${incoming.length} attachment${incoming.length === 1 ? '' : 's'} ready. Add a note if it helps, then send.`);
  };

  const onPaste = (event: ClipboardEvent) => {
    const dropped = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);
    // Text paste stays native so selection, undo and line breaks behave.
    if (!dropped.length) return;
    event.preventDefault();
    attach(dropped);
  };

  /**
   * Upload what is attached, then send the message.
   *
   * The attachments go through the intake endpoint that already retains
   * originals immutably with their provenance, so this adds no second storage
   * path. Images are read by the existing vision pass; a format LandOS has no
   * reader for is kept and the limitation is said out loud rather than the file
   * being refused.
   */
  const send = async (event: Event) => {
    event.preventDefault();
    const message = draft.trim();
    if ((!message && pending.length === 0) || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);

    const attachments = pending;
    // Show the operator's own turn immediately. The server stores it before the
    // model runs, so this optimistic turn is never a lie about what was saved.
    const optimistic = [message, attachments.length ? `(${attachments.length} attachment${attachments.length === 1 ? '' : 's'})` : '']
      .filter(Boolean).join(' ');
    setThread((prior) => [...prior, { id: -Date.now(), role: 'operator', text: optimistic }]);
    setDraft('');
    setPending([]);

    try {
      if (attachments.length) {
        // One submission per file: the intake endpoint reads a batch only when
        // every file is an image, and refusing a mixed drop would lose the rest.
        for (const file of attachments) {
          const body = new FormData();
          body.append('files', file);
          body.append('sourceMethods', JSON.stringify(['drop']));
          body.append('note', message);
          body.append('source', 'Smart Intake conversation');
          body.append('submissionKey', uuid());
          await apiPostForm(`/api/landos/deal-cards/${dealId}/intake/upload`, body);
        }
      }
      if (message) {
        const res = await apiPost<SmartIntakeResponse>(`/api/landos/deal-cards/${dealId}/smart-intake`, { message });
        setPlan(res.plan ?? null);
        applyState(res.state);
        if (Array.isArray(res.thread) && res.thread.length) setThread(res.thread);
        else if (res.plan?.explanation) {
          setThread((prior) => [...prior, { id: -Date.now(), role: 'deal_brain', text: res.plan!.explanation }]);
        }
      } else {
        await load();
        setNotice('Attachment saved on this deal. Tell me what it is and I will use it.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      // Refresh what is attached so the evidence list reflects the upload.
      void load();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Enter sends, Shift+Enter is a newline — the convention for a composer.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(event);
    }
  };

  const canSend = !sending && (draft.trim().length > 0 || pending.length > 0);

  return (
    <section
      class="awv2-dealbrain"
      data-domain="action"
      aria-label="Smart Intake"
      data-testid="smart-intake-conversation"
      onPaste={onPaste}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        attach(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      <div class="awv2-dom-eyebrow" data-dom="action"><MessagesSquare size={13} /> Smart Intake</div>

      {thread.length > 0 && (
        <div class="awv2-dealbrain-thread" ref={scroller} data-testid="smart-intake-thread">
          {thread.slice(-12).map((entry) => (
            <div key={entry.id} class={`awv2-dealbrain-turn t-${entry.role === 'operator' ? 'operator' : 'brain'}`}>
              <small>{entry.role === 'operator' ? 'You (guidance)' : 'Smart Intake'}</small>
              <p>{entry.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* What you have given it. Shown because "did it get what I sent?" should
          never be a guess, and because a link nothing has opened yet is still a
          thing you supplied. */}
      {(links.length > 0 || files.length > 0) && (
        <div class="awv2-intake-evidence" data-testid="smart-intake-evidence">
          <small>What you have given me</small>
          <ul>
            {links.map((link) => (
              <li key={`link-${link.id}`} data-testid="smart-intake-evidence-link">
                <Link2 size={12} />
                <a href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
                <em>{LINK_LABEL[link.classification] ?? link.classification}{link.capability ? ` → ${link.capability}` : ' → general browser'}</em>
              </li>
            ))}
            {files.map((file, index) => (
              <li key={`file-${index}`} data-testid="smart-intake-evidence-file">
                <Paperclip size={12} />
                <span>{file.name}</span>
                <em>{file.mimeType} · read: {file.extractionStatus}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What it decided. Shown only when there is something to show, so a plain
          answer stays a plain answer instead of growing a status block. */}
      {plan && (plan.needFromOperator.length > 0 || plan.steps.length > 0) && (
        <div class="awv2-dealbrain-thread" data-testid="smart-intake-plan">
          {plan.needFromOperator.length > 0 && (
            <div class="awv2-dealbrain-turn t-brain">
              <small>What would unblock this</small>
              <p>{plan.needFromOperator.join(' · ')}</p>
            </div>
          )}
          {plan.steps.length > 0 && (
            <div class="awv2-dealbrain-turn t-brain">
              <small>Steps it wants to run</small>
              <p>
                {plan.steps.join(' → ')}
                {plan.reasoning ? ` — ${plan.reasoning}` : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div class="awv2-intake-pending" data-testid="smart-intake-pending">
          {pending.map((file, index) => (
            <span key={`${file.name}-${index}`}>
              <Paperclip size={11} /> {file.name}
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setPending((current) => current.filter((_, i) => i !== index))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {sending && <p class="awv2-dealbrain-note">Smart Intake is reading the current run state…</p>}
      {notice && <p class="awv2-dealbrain-note" data-testid="smart-intake-notice">{notice}</p>}
      {error && <p class="awv2-dealbrain-note bad" data-testid="smart-intake-error">{error}</p>}

      <form class={`awv2-intake-composer${dragging ? ' is-dragging' : ''}`} onSubmit={send}>
        <textarea
          ref={composer}
          value={draft}
          rows={3}
          data-testid="smart-intake-input"
          placeholder="Tell me about this deal in your own words. Paste a link, a deed, an email, a screenshot — drop files here."
          onInput={(event) => setDraft((event.target as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <div class="awv2-intake-composer-actions">
          <label class="awv2-intake-attach" title="Attach a file">
            <Paperclip size={14} />
            <input
              type="file"
              multiple
              data-testid="smart-intake-attach"
              aria-label="Attach files to Smart Intake"
              onChange={(event) => {
                const input = event.target as HTMLInputElement;
                attach(Array.from(input.files ?? []));
                input.value = '';
              }}
            />
          </label>
          <button type="submit" data-testid="smart-intake-send" disabled={!canSend} aria-label="Send">
            <Send size={14} />
          </button>
        </div>
      </form>
      <p class="awv2-dealbrain-caveat">
        Everything you send is kept on this deal exactly as supplied. What you type is operator guidance:
        it is never promoted to a canonical property fact, and nothing runs until you start it.
      </p>
    </section>
  );
}
