import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { RefreshCw, MapPin, ArrowRight } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { apiGet, apiPatch } from '@/lib/api';

// Property Board — PIPELINE OVERVIEW ONLY. Every card is a CONCISE summary of a
// Deal Card: where the deal sits in the pipeline and just enough to prioritise
// it. It never renders department intelligence (public records, due diligence,
// market analytics, exit strategies, comps, the property report) — that is the
// Deal Card's job, the
// single operator workspace. Clicking a card ALWAYS opens the corresponding
// Deal Card (/landos?deal=<id>). There is never a second property intelligence
// surface here. Display + pipeline moves only; parcel identity is never inferred.

interface Card {
  id: number;
  entity: string;
  verification_status: string;
  kanban_status: string;
  active_input_address: string;
  county: string;
  state: string;
  city: string;
  apn: string;
  owner: string;
  acres: number | null;
  lp_url: string;
  summary: string;
  open_risks: string; // JSON array string from the board payload (may be '[]')
  updated_at: number;
  // Board-summary enrichment (server): the linked Deal Card (nullable — a click
  // resolves/creates one) and the latest open next-action.
  deal_card_id: number | null;
  next_action: string | null;
  // Workspace-readiness summary: what intelligence this property already has, so
  // the operator can prioritise from the board without opening each one.
  workspace_has_inspection?: boolean;
  workspace_visual_count?: number;
  workspace_comp_count?: number;
  workspace_seller_question_count?: number;
}

interface BoardResponse { columns: Record<string, Card[]>; statuses: string[]; }

// Stage -> primary owner role lane. Display only; mirrors the backend routing
// map in src/landos/routing-map.ts (KANBAN_ROUTING). Keep these keys in sync
// with the kanban_status values; a missing key falls back to no owner label.
const STAGE_OWNER: Record<string, string> = {
  new_lead: 'Marketing / Lead Gen',
  needs_parcel_verification: 'Due Diligence',
  needs_seller_discovery: 'Acquisitions',
  researching: 'Due Diligence',
  underwriting: 'Valuation / Comps',
  offer_ready: 'Command Center',
  offer_sent: 'Acquisitions',
  follow_up: 'Acquisitions',
  under_contract: 'Transaction Coordination',
  due_diligence: 'Due Diligence',
  disposition: 'Dispositions',
  closed: 'Transaction Coordination',
  dead: 'Command Center',
  archived: 'Command Center',
};

// Parse a card's open_risks JSON array safely; never throws. Used only to show
// a blocker indicator from data already on the card — no new fetch, no schema.
function parseRisks(openRisks: string | undefined): string[] {
  if (!openRisks) return [];
  try {
    const arr = JSON.parse(openRisks);
    return Array.isArray(arr) ? arr.filter((r) => typeof r === 'string' && r.trim()) : [];
  } catch {
    return [];
  }
}

const ENTITIES = [
  { id: 'all', label: 'All' },
  { id: 'TY_LAND_BIZ', label: "Ty's Land Biz" },
  { id: 'LAND_ALLY', label: 'Land Ally' },
];

// `onOpenDeal`, when provided (e.g. by the Acquisitions workspace), opens the
// Deal Card in-place instead of navigating to the LandOS spine. Default behavior
// (standalone /board) still deep-links to /landos?deal=<id> so old links work.
// `embedded` drops the page-level header when hosted inside a department
// workspace that already provides its own header + sub-nav.
export function PropertyBoard({ onOpenDeal, embedded = false }: { onOpenDeal?: (dealCardId: number) => void; embedded?: boolean } = {}) {
  const [, navigate] = useLocation();
  const [entity, setEntity] = useState('all');
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The card whose stage select is being changed inline; keeps the board a pure
  // pipeline surface (no modal, no intelligence) while still allowing stage moves.
  const [movingCardId, setMovingCardId] = useState<number | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<BoardResponse>(`/api/landos/board?entity=${encodeURIComponent(entity)}`);
      setBoard(res);
    } catch (e: any) {
      // The board endpoint may be briefly unavailable (e.g. a backend still
      // rolling out). Degrade to a clean empty board — show "No property cards
      // yet" rather than a red error banner — instead of breaking the page.
      console.warn('Property Board load failed; showing empty board:', e?.message || e);
      setBoard({ columns: {}, statuses: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [entity]);

  // A card click ALWAYS opens the canonical Deal Card — the single operator
  // workspace. If the property has no linked Deal Card yet, the ensure endpoint
  // resolves/creates one (no identity/verification/facts change) so the board
  // never dead-ends and never renders a competing intelligence surface itself.
  async function openDealCard(card: Card) {
    if (card.deal_card_id) {
      if (onOpenDeal) { onOpenDeal(card.deal_card_id); return; }
      navigate(`/landos?deal=${card.deal_card_id}`);
      return;
    }
    setOpeningId(card.id);
    setError(null);
    try {
      const res = await apiGet<{ dealCardId: number }>(`/api/landos/property-cards/${card.id}/deal-card`);
      if (onOpenDeal) onOpenDeal(res.dealCardId);
      else navigate(`/landos?deal=${res.dealCardId}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setOpeningId(null);
    }
  }

  async function moveCard(id: number, status: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/landos/property-cards/${id}`, { kanbanStatus: status });
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      setMovingCardId(null);
    }
  }

  const statuses = board?.statuses ?? [];
  const nonEmpty = statuses.filter((s) => (board?.columns[s]?.length ?? 0) > 0);
  const columnsToShow = nonEmpty.length ? nonEmpty : statuses.slice(0, 6);

  const entityTabs = ENTITIES.map((e) => (
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
  ));
  const refreshBtn = (
    <button type="button" onClick={() => void load()} class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
      <RefreshCw size={12} /> Refresh
    </button>
  );

  return (
    <div class="h-full flex flex-col">
      {embedded ? (
        <div class="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-[var(--color-border)]">
          {entityTabs}
          <div class="ml-auto">{refreshBtn}</div>
        </div>
      ) : (
        <PageHeader
          title="Property Board"
          breadcrumb="Pipeline"
          tabs={entityTabs}
          actions={refreshBtn}
        />
      )}

      <div class="flex-1 overflow-auto p-4">
        {error && <div class="text-[12px] text-[var(--color-status-failed)] mb-3">{error}</div>}
        {loading && <PageState loading />}
        {!loading && columnsToShow.every((s) => (board?.columns[s]?.length ?? 0) === 0) && (
          <PageState empty emptyTitle="No property cards yet" emptyDescription="Run Acquire on a property (LandOS → Acquire) to create the first Deal Card. It shows up here as a pipeline card." />
        )}
        {!loading && (
          <div class="flex gap-3 min-w-max">
            {columnsToShow.map((status) => (
              <div key={status} class="w-72 flex-shrink-0">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2 flex items-center justify-between">
                  <span>{status.replace(/_/g, ' ')}</span>
                  <span>{board?.columns[status]?.length ?? 0}</span>
                </div>
                {STAGE_OWNER[status] && (
                  <div class="text-[9.5px] text-[var(--color-text-faint)] mb-2 -mt-1.5">owner: {STAGE_OWNER[status]}</div>
                )}
                <div class="space-y-2">
                  {(board?.columns[status] ?? []).map((card) => (
                    <PipelineCard
                      key={card.id}
                      card={card}
                      opening={openingId === card.id}
                      moving={movingCardId === card.id}
                      busy={busy}
                      statuses={statuses}
                      onOpen={() => void openDealCard(card)}
                      onStartMove={() => setMovingCardId(card.id)}
                      onCancelMove={() => setMovingCardId(null)}
                      onMove={(s) => void moveCard(card.id, s)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// A single pipeline card — a CONCISE summary of a Deal Card. Seller/owner,
// address or APN, city/county/state, acreage, verification + blocker indicators,
// next action, and the workspace-readiness chips. Clicking the body opens the
// Deal Card; the footer offers an inline stage move without leaving the board.
function PipelineCard({
  card, opening, moving, busy, statuses, onOpen, onStartMove, onCancelMove, onMove,
}: {
  card: Card;
  opening: boolean;
  moving: boolean;
  busy: boolean;
  statuses: string[];
  onOpen: () => void;
  onStartMove: () => void;
  onCancelMove: () => void;
  onMove: (status: string) => void;
}) {
  const risks = parseRisks(card.open_risks);
  const verified = card.verification_status === 'verified_property';
  const mismatch = card.verification_status === 'rejected_mismatch';
  const place = [card.city, card.county, card.state].filter(Boolean).join(', ');
  const primary = card.active_input_address || (card.apn ? `APN ${card.apn}` : '(no address)');
  const chips = [
    card.workspace_has_inspection ? { label: 'Inspection', title: 'This property has an inspection on file' } : null,
    card.workspace_visual_count ? { label: `${card.workspace_visual_count} visual${card.workspace_visual_count === 1 ? '' : 's'}`, title: 'Captured visuals (satellite / street / overlays)' } : null,
    card.workspace_comp_count ? { label: `${card.workspace_comp_count} comp${card.workspace_comp_count === 1 ? '' : 's'}`, title: 'Comparable sales collected' } : null,
    card.workspace_seller_question_count ? { label: `${card.workspace_seller_question_count} seller Q${card.workspace_seller_question_count === 1 ? '' : 's'}`, title: 'Seller/discovery questions prepared' } : null,
  ].filter((x): x is { label: string; title: string } => !!x);

  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)] transition-colors">
      {/* Body opens the Deal Card. This is the ONLY property surface — the board
          shows a summary, the Deal Card is where the deal is worked. */}
      <button
        type="button"
        onClick={onOpen}
        disabled={opening}
        class="w-full text-left p-2.5 disabled:opacity-60"
        title="Open Deal Card"
      >
        <div class="flex items-center gap-1.5 mb-1 flex-wrap">
          <Pill tone={verified ? 'done' : mismatch ? 'failed' : 'neutral'}>
            {verified ? 'verified' : card.verification_status === 'unverified_lead' ? 'unverified' : card.verification_status}
          </Pill>
          {risks.length > 0 && (
            <Pill tone="failed">⚠ {risks.length} blocker{risks.length === 1 ? '' : 's'}</Pill>
          )}
          {opening && <span class="text-[10px] text-[var(--color-text-faint)]">opening…</span>}
        </div>

        <div class="text-[12.5px] text-[var(--color-text)] truncate font-medium">{primary}</div>
        {place && (
          <div class="text-[10px] text-[var(--color-text-faint)] truncate flex items-center gap-1">
            <MapPin size={9} /> {place}
          </div>
        )}

        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--color-text-muted)]">
          {card.owner && <span class="truncate max-w-[10rem]" title={`Record owner: ${card.owner}`}>{card.owner}</span>}
          {typeof card.acres === 'number' && card.acres > 0 && <span>{card.acres} ac</span>}
          {card.apn && card.active_input_address && <span class="truncate max-w-[8rem]">APN {card.apn}</span>}
        </div>

        {card.next_action && (
          <div class="mt-1.5 text-[10.5px] text-[var(--color-text-muted)] flex items-start gap-1">
            <ArrowRight size={11} class="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            <span class="line-clamp-2">{card.next_action}</span>
          </div>
        )}

        {chips.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-1">
            {chips.map((chip) => (
              <span key={chip.label} class="text-[9.5px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]" title={chip.title}>{chip.label}</span>
            ))}
          </div>
        )}
      </button>

      {/* Pipeline move — inline, no modal. Keeps the board a pure pipeline tool. */}
      <div class="border-t border-[var(--color-border)] px-2.5 py-1.5">
        {moving ? (
          <div class="flex items-center gap-1.5">
            <select
              value={card.kanban_status}
              disabled={busy}
              onChange={(e) => onMove((e.target as HTMLSelectElement).value)}
              class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--color-text)]"
            >
              {statuses.map((s) => <option value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <button type="button" onClick={onCancelMove} class="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">cancel</button>
          </div>
        ) : (
          <button type="button" onClick={onStartMove} class="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">Move stage →</button>
        )}
      </div>
    </div>
  );
}
