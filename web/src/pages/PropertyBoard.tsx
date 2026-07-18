import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { ArrowRight, MapPin, RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { apiGet, apiPatch } from '@/lib/api';

interface OpportunityCard {
  id: number;
  dealCardId: number;
  entity: string;
  title: string;
  lifecycle: 'lead' | 'deal';
  pipelineStage: string;
  researchStatus: string;
  discoveryStatus: string;
  address: string;
  apn: string;
  city: string;
  county: string;
  state: string;
  owner: string;
  acres: number | null;
  duplicateCandidates: Array<{ opportunityId: number; dealCardId: number; title: string }>;
}

interface BoardResponse { columns: Record<string, OpportunityCard[]>; statuses: string[]; }

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New Leads',
  researching: 'Researching',
  discovery_ready: 'Ready for Discovery Call',
  discovery_complete: 'Discovery Complete',
  pursuing: 'Pursuing',
  follow_up: 'Follow-up',
  under_contract: 'Under Contract',
  closed: 'Closed',
};

const ENTITIES = [
  { id: 'all', label: 'All' },
  { id: 'TY_LAND_BIZ', label: "Ty's Land Biz" },
  { id: 'LAND_ALLY', label: 'Land Ally' },
];

/** Acquisitions pipeline: one card per canonical opportunity. Research and
 * parcel status are card-level context, never duplicate technical lanes. */
export function PropertyBoard({ onOpenDeal, embedded = false }: { onOpenDeal?: (dealCardId: number) => void; embedded?: boolean } = {}) {
  const [, navigate] = useLocation();
  const [entity, setEntity] = useState('all');
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingCardId, setMovingCardId] = useState<number | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setBoard(await apiGet<BoardResponse>(`/api/landos/board?entity=${encodeURIComponent(entity)}`)); }
    catch (err: any) { setError(err?.message || String(err)); setBoard({ columns: {}, statuses: [] }); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [entity]);

  function open(card: OpportunityCard) {
    if (onOpenDeal) onOpenDeal(card.dealCardId);
    else navigate(`/landos?deal=${card.dealCardId}`);
  }

  async function move(id: number, stage: string) {
    setError(null);
    try {
      await apiPatch(`/api/landos/opportunities/${id}/pipeline-stage`, { stage });
      await load();
    } catch (err: any) { setError(err?.message || String(err)); }
    finally { setMovingCardId(null); }
  }

  const statuses = board?.statuses ?? [];
  const visible = statuses.filter((stage) => (board?.columns[stage]?.length ?? 0) > 0);
  const columns = visible.length ? visible : statuses.slice(0, 4);
  const tabs = ENTITIES.map((entry) => (
    <button key={entry.id} type="button" onClick={() => setEntity(entry.id)} class={`rounded-md px-3 py-1 text-[12px] ${entity === entry.id ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>{entry.label}</button>
  ));
  const refresh = <button type="button" onClick={() => void load()} class="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-muted)]"><RefreshCw size={12} /> Refresh</button>;

  return <div data-testid="opportunity-board" class="flex h-full flex-col">
    {embedded ? <div class="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">{tabs}<div class="ml-auto">{refresh}</div></div> : <PageHeader title="Acquisitions Pipeline" breadcrumb="Pipeline" tabs={tabs} actions={refresh} />}
    <div class="flex-1 overflow-auto p-4">
      {error && <div class="mb-3 text-[12px] text-[var(--color-status-failed)]">{error}</div>}
      {loading && <PageState loading />}
      {!loading && columns.length === 0 && <PageState empty emptyTitle="No active opportunities" emptyDescription="Create a lead to add one card to the pipeline." />}
      {!loading && <div class="flex min-w-max gap-3">{columns.map((stage) => <div key={stage} data-testid={`opportunity-lane-${stage}`} class="w-72 shrink-0">
        <div class="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]"><span>{STAGE_LABEL[stage] ?? stage}</span><span>{board?.columns[stage]?.length ?? 0}</span></div>
        <div class="space-y-2">{(board?.columns[stage] ?? []).map((card) => <OpportunityPipelineCard key={card.id} card={card} statuses={statuses} moving={movingCardId === card.id} onOpen={() => open(card)} onMoveStart={() => setMovingCardId(card.id)} onMoveCancel={() => setMovingCardId(null)} onMove={(next) => void move(card.id, next)} />)}</div>
      </div>)}</div>}
    </div>
  </div>;
}

function OpportunityPipelineCard({ card, statuses, moving, onOpen, onMoveStart, onMoveCancel, onMove }: { card: OpportunityCard; statuses: string[]; moving: boolean; onOpen: () => void; onMoveStart: () => void; onMoveCancel: () => void; onMove: (stage: string) => void }) {
  const place = [card.city, card.county, card.state].filter(Boolean).join(', ');
  const identity = card.address || (card.apn ? `APN ${card.apn}` : 'Parcel identity unresolved');
  return <article data-testid="opportunity-card" data-opportunity-id={card.id} class={`rounded-lg border bg-[var(--color-card)] ${card.lifecycle === 'deal' ? 'border-sky-500/70 shadow-[0_0_12px_rgba(14,165,233,0.18)]' : 'border-[var(--color-border)]'}`}>
    <button type="button" onClick={onOpen} class="w-full p-3 text-left">
      <div class="mb-1 flex flex-wrap items-center gap-1.5"><Pill tone={card.lifecycle === 'deal' ? 'done' : 'neutral'}>{card.lifecycle === 'deal' ? 'Deal — pursuing' : 'Lead'}</Pill><Pill tone="neutral">Research: {card.researchStatus.replace(/_/g, ' ')}</Pill></div>
      <div class="truncate text-[12.5px] font-semibold text-[var(--color-text)]">{card.title}</div>
      <div class="truncate text-[11px] text-[var(--color-text-muted)]">{identity}</div>
      {place && <div class="flex items-center gap-1 truncate text-[10px] text-[var(--color-text-faint)]"><MapPin size={9} />{place}</div>}
      <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">{card.owner || 'Seller/owner not identified'}{card.acres ? ` · ${card.acres} ac` : ''}</div>
      {card.duplicateCandidates.length > 0 && <div data-testid="duplicate-candidate-warning" class="mt-2 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-200">Possible duplicate ({card.duplicateCandidates.length}) — review before merging. Distinct parcels remain separate.</div>}
      <div class="mt-2 flex items-center gap-1 text-[10.5px] text-[var(--color-text-muted)]"><ArrowRight size={11} class="text-[var(--color-accent)]" />Open Lead Workspace</div>
    </button>
    <div class="border-t border-[var(--color-border)] px-3 py-2">{moving ? <div class="flex items-center gap-1.5"><select aria-label={`Business stage for ${card.title}`} value={card.pipelineStage} onChange={(event) => onMove((event.target as HTMLSelectElement).value)} class="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-[10.5px]">{statuses.map((stage) => <option value={stage}>{STAGE_LABEL[stage] ?? stage}</option>)}</select><button type="button" onClick={onMoveCancel} class="text-[10px] text-[var(--color-text-faint)]">Cancel</button></div> : <button type="button" onClick={onMoveStart} class="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">Move business stage →</button>}</div>
  </article>;
}
