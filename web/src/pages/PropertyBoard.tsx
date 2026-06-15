import { useEffect, useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { apiGet, apiPatch } from '@/lib/api';

// Property/Lead Kanban board. Property-centered, not chat-centered: each card is
// a lead/property with all its memory behind it. Display + status moves only;
// no scoring/valuation/offer happens here and parcel identity is never inferred.

interface Card {
  id: number;
  entity: string;
  verification_status: string;
  kanban_status: string;
  active_input_address: string;
  county: string;
  state: string;
  apn: string;
  owner: string;
  lp_url: string;
  summary: string;
  updated_at: number;
}

interface CardDetail extends Card {
  priorInputs: string[];
  sourceEvidence: any[];
  activity: any[];
  nextActions: any[];
  facts: any[];
}

interface BoardResponse { columns: Record<string, Card[]>; statuses: string[]; }

const ENTITIES = [
  { id: 'all', label: 'All' },
  { id: 'TY_LAND_BIZ', label: "Ty's Land Biz" },
  { id: 'LAND_ALLY', label: 'Land Ally' },
];

export function PropertyBoard() {
  const [entity, setEntity] = useState('all');
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CardDetail | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<BoardResponse>(`/api/landos/board?entity=${encodeURIComponent(entity)}`);
      setBoard(res);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [entity]);

  async function openCard(id: number) {
    try {
      const res = await apiGet<{ card: CardDetail }>(`/api/landos/property-cards/${id}`);
      setSelected(res.card);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function moveCard(id: number, status: string) {
    setBusy(true);
    try {
      await apiPatch(`/api/landos/property-cards/${id}`, { kanbanStatus: status });
      await load();
      if (selected?.id === id) await openCard(id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const statuses = board?.statuses ?? [];
  const nonEmpty = statuses.filter((s) => (board?.columns[s]?.length ?? 0) > 0);
  const columnsToShow = nonEmpty.length ? nonEmpty : statuses.slice(0, 6);

  return (
    <div class="h-full flex flex-col">
      <PageHeader
        title="Property Board"
        breadcrumb="Workspace"
        tabs={ENTITIES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEntity(e.id)}
            class={[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors',
              entity === e.id ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
            ].join(' ')}
          >
            {e.label}
          </button>
        ))}
        actions={
          <button type="button" onClick={() => void load()} class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <RefreshCw size={12} /> Refresh
          </button>
        }
      />

      <div class="flex-1 overflow-auto p-4">
        {error && <div class="text-[12px] text-[var(--color-status-failed)] mb-3">{error}</div>}
        {loading && <PageState loading />}
        {!loading && columnsToShow.every((s) => (board?.columns[s]?.length ?? 0) === 0) && (
          <PageState empty emptyTitle="No property cards yet" emptyDescription="Run Duke on a property address (chat, Mission Control, or batch intake) to create the first Property Card." />
        )}
        {!loading && (
          <div class="flex gap-3 min-w-max">
            {columnsToShow.map((status) => (
              <div key={status} class="w-64 flex-shrink-0">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2 flex items-center justify-between">
                  <span>{status.replace(/_/g, ' ')}</span>
                  <span>{board?.columns[status]?.length ?? 0}</span>
                </div>
                <div class="space-y-2">
                  {(board?.columns[status] ?? []).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => void openCard(card.id)}
                      class="w-full text-left bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-2.5 hover:border-[var(--color-accent)] transition-colors"
                    >
                      <div class="flex items-center gap-1.5 mb-1">
                        <Pill tone={card.verification_status === 'verified_property' ? 'done' : card.verification_status === 'rejected_mismatch' ? 'failed' : 'neutral'}>
                          {card.verification_status === 'verified_property' ? 'verified' : card.verification_status === 'unverified_lead' ? 'unverified' : card.verification_status}
                        </Pill>
                      </div>
                      <div class="text-[12px] text-[var(--color-text)] truncate">{card.active_input_address || '(no address)'}</div>
                      <div class="text-[10px] text-[var(--color-text-faint)] truncate">
                        {[card.county, card.state].filter(Boolean).join(', ')}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone={selected.verification_status === 'verified_property' ? 'done' : 'neutral'}>{selected.verification_status}</Pill>
              <span class="text-[14px] font-semibold text-[var(--color-text)]">{selected.active_input_address}</span>
              <span class="text-[10px] text-[var(--color-text-faint)]">card {selected.id}</span>
            </div>
            {selected.summary && <p class="text-[12px] text-[var(--color-text-muted)]">{selected.summary}</p>}

            <div class="flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
              {selected.apn && <span>APN <span class="text-[var(--color-text)]">{selected.apn}</span></span>}
              {selected.owner && <span>Record Owner <span class="text-[var(--color-text)]">{selected.owner}</span></span>}
              {selected.lp_url && (
                <a
                  href={selected.lp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[var(--color-accent)] hover:underline"
                >
                  Open in LandPortal ↗
                </a>
              )}
            </div>

            <label class="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
              Move to
              <select
                value={selected.kanban_status}
                disabled={busy}
                onChange={(e) => void moveCard(selected.id, (e.target as HTMLSelectElement).value)}
                class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
              >
                {statuses.map((s) => <option value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </label>

            {selected.priorInputs.length > 0 && (
              <div class="text-[11px] text-[var(--color-text-muted)]">
                <span class="uppercase tracking-wider text-[10px] text-[var(--color-text-faint)]">Prior inputs</span>
                <div>{selected.priorInputs.join(' · ')}</div>
              </div>
            )}

            <DetailList title="Next actions" items={selected.nextActions.map((n: any) => `${n.action} (${n.status})`)} />
            <DetailList title="Source evidence" items={selected.sourceEvidence.map((s: any) => `${s.fact} — ${s.source_type}${s.usable_for_offer_logic ? ' (offer-usable)' : ''}`)} />
            <DetailList title="Facts" items={selected.facts.map((f: any) => `${f.fact}: ${f.value} [${f.label}]`)} />
            <DetailList title="Activity" items={selected.activity.map((a: any) => `${a.agent_id}: ${a.summary}`)} />

            <button type="button" onClick={() => setSelected(null)} class="text-[12px] px-3 py-1.5 rounded-md bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{title}</div>
      <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
        {items.map((i, idx) => <li key={idx}>{i}</li>)}
      </ul>
    </div>
  );
}
