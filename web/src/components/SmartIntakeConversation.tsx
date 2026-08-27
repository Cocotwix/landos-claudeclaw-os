// Smart Intake conversation — the operator's way back into a stuck run.
//
// This sits directly under the Property Resolution line because that is where
// the operator finds out the run could not identify the subject. Before this
// existed, an UNRESOLVED read was terminal in the UI: the only controls were
// "refresh resolution" and "re-run research", both of which repeat the same
// work that already failed, with no way to tell LandOS the one thing that would
// actually unblock it ("they own three adjoining parcels, we are buying the
// vacant one, use the link I gave you").
//
// It is deliberately small. It is not a second Deal Brain and not a report: one
// thread, one input, and whatever the supervisor decided. The reply is written
// by the model from the REAL persisted resolution facts, and the steps it names
// are a closed set of already-registered capabilities — so this surface can ask
// for work, but it cannot invent work.
//
// Nothing here runs a capability. Choosing to act on the plan stays an explicit
// operator click on the controls that already exist, so typing never fires an
// expensive workflow.

import { useState } from 'preact/hooks';
import { MessagesSquare, Send } from 'lucide-preact';
import { apiPost } from '@/lib/api';

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

interface SmartIntakeResponse {
  plan: SmartIntakePlan;
  thread: GuidanceTurn[];
}

export function SmartIntakeConversation({ dealId }: { dealId: number }) {
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<GuidanceTurn[]>([]);
  const [plan, setPlan] = useState<SmartIntakePlan | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: Event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    // Show the operator's own turn immediately. The server stores it before the
    // model runs, so this optimistic turn is never a lie about what was saved.
    setThread((prior) => [...prior, { id: -Date.now(), role: 'operator', text: message }]);
    setDraft('');
    try {
      const res = await apiPost<SmartIntakeResponse>(`/api/landos/deal-cards/${dealId}/smart-intake`, { message });
      setPlan(res.plan ?? null);
      if (Array.isArray(res.thread) && res.thread.length) setThread(res.thread);
      else if (res.plan?.explanation) {
        setThread((prior) => [...prior, { id: -Date.now(), role: 'deal_brain', text: res.plan.explanation }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <section class="awv2-dealbrain" data-domain="action" aria-label="Smart Intake" data-testid="smart-intake-conversation">
      <div class="awv2-dom-eyebrow" data-dom="action"><MessagesSquare size={13} /> Smart Intake</div>

      {thread.length > 0 && (
        <div class="awv2-dealbrain-thread" data-testid="smart-intake-thread">
          {thread.slice(-8).map((entry) => (
            <div key={entry.id} class={`awv2-dealbrain-turn t-${entry.role === 'operator' ? 'operator' : 'brain'}`}>
              <small>{entry.role === 'operator' ? 'You (guidance)' : 'Smart Intake'}</small>
              <p>{entry.text}</p>
            </div>
          ))}
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

      {sending && <p class="awv2-dealbrain-note">Smart Intake is reading the current run state…</p>}
      {error && <p class="awv2-dealbrain-note bad" data-testid="smart-intake-error">{error}</p>}

      <form class="awv2-dealbrain-input" onSubmit={send}>
        <input
          type="text"
          value={draft}
          data-testid="smart-intake-input"
          placeholder="Tell Smart Intake what it is missing…"
          onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
          disabled={sending}
        />
        <button type="submit" data-testid="smart-intake-send" disabled={sending || !draft.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </form>
      <p class="awv2-dealbrain-caveat">
        What you type is operator guidance for this deal. It is never promoted to a canonical property fact,
        and nothing runs until you start it.
      </p>
    </section>
  );
}
