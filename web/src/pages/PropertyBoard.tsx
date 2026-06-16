import { useEffect, useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

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
  open_risks: string; // JSON array string from the board payload (may be '[]')
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

interface DealReview {
  id: number;
  title: string;
  status: string;
  package_notes: string;
  propertyCount: number;
  hasVerifiedProperty: boolean;
  hasUnverifiedProperty: boolean;
  risks: string[];
  nextActions: any[];
  compCount: number;
  latestWriteback: string | null;
  combinedAcreage: { acres: number; verified: boolean; label: string };
  propertyCards: any[];
}

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

// Comp source labels / kinds / statuses (mirror the backend model).
const COMP_SOURCE_LABELS = ['LandPortal', 'Zillow', 'Redfin', 'Land.com', 'LandWatch', 'LandsOfAmerica', 'Realtor', 'County', 'Other'] as const;
const COMP_PRICE_KINDS = ['sale', 'list', 'unknown'] as const;
const COMP_STATUSES = ['manual_unverified', 'market_reference', 'verified_sale', 'rejected'] as const;

interface Comp {
  id: number;
  source_label: string;
  source_url: string;
  address_desc: string;
  apn: string;
  county: string;
  state: string;
  price: number | null;
  price_kind: string;
  sale_or_list_date: string;
  acres: number | null;
  price_per_acre: number | null;
  notes: string;
  status: string;
}

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
  const [comps, setComps] = useState<Comp[]>([]);
  const [dealReview, setDealReview] = useState<DealReview | null>(null);
  const [showCompForm, setShowCompForm] = useState(false);
  const [compBusy, setCompBusy] = useState(false);
  const emptyComp = {
    sourceLabel: 'Zillow', sourceUrl: '', addressDesc: '', apn: '', county: '', state: '',
    price: '', priceKind: 'sale', saleOrListDate: '', acres: '', notes: '', status: 'manual_unverified',
  };
  const [compForm, setCompForm] = useState<Record<string, string>>({ ...emptyComp });

  function compField(k: string, v: string) {
    setCompForm((f) => ({ ...f, [k]: v }));
  }

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

  async function openCard(id: number) {
    try {
      const res = await apiGet<{ card: CardDetail }>(`/api/landos/property-cards/${id}`);
      setSelected(res.card);
      setShowCompForm(false);
      setCompForm({ ...emptyComp });
      await loadComps(id);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function loadComps(cardId: number) {
    try {
      const res = await apiGet<{ dealCardId: number | null; comps: Comp[] }>(`/api/landos/property-cards/${cardId}/comps`);
      setComps(res.comps || []);
      if (res.dealCardId) {
        try {
          const dr = await apiGet<{ dealCard: DealReview }>(`/api/landos/deal-cards/${res.dealCardId}`);
          setDealReview(dr.dealCard);
        } catch {
          setDealReview(null);
        }
      } else {
        setDealReview(null);
      }
    } catch {
      setComps([]);
      setDealReview(null);
    }
  }

  // Save a manual comp to the selected property card's Deal Card. Never changes
  // verification status, identity, owner, contiguity, or facts.
  async function saveComp() {
    if (!selected) return;
    setCompBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        sourceLabel: compForm.sourceLabel,
        sourceUrl: compForm.sourceUrl.trim(),
        addressDesc: compForm.addressDesc.trim(),
        apn: compForm.apn.trim(),
        county: compForm.county.trim(),
        state: compForm.state.trim(),
        priceKind: compForm.priceKind,
        saleOrListDate: compForm.saleOrListDate.trim(),
        notes: compForm.notes.trim(),
        status: compForm.status,
        addedBy: 'tyler/manual',
      };
      const price = parseFloat(compForm.price);
      if (Number.isFinite(price)) payload.price = price;
      const acres = parseFloat(compForm.acres);
      if (Number.isFinite(acres)) payload.acres = acres;
      await apiPost(`/api/landos/property-cards/${selected.id}/comps`, payload);
      setShowCompForm(false);
      setCompForm({ ...emptyComp });
      await loadComps(selected.id);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCompBusy(false);
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
                {STAGE_OWNER[status] && (
                  <div class="text-[9.5px] text-[var(--color-text-faint)] mb-2 -mt-1.5">owner: {STAGE_OWNER[status]}</div>
                )}
                <div class="space-y-2">
                  {(board?.columns[status] ?? []).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => void openCard(card.id)}
                      class="w-full text-left bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-2.5 hover:border-[var(--color-accent)] transition-colors"
                    >
                      <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                        <Pill tone={card.verification_status === 'verified_property' ? 'done' : card.verification_status === 'rejected_mismatch' ? 'failed' : 'neutral'}>
                          {card.verification_status === 'verified_property' ? 'verified' : card.verification_status === 'unverified_lead' ? 'unverified' : card.verification_status}
                        </Pill>
                        {parseRisks(card.open_risks).length > 0 && (
                          <Pill tone="failed">⚠ {parseRisks(card.open_risks).length} blocker{parseRisks(card.open_risks).length === 1 ? '' : 's'}</Pill>
                        )}
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

            {dealReview && (
              <div class="border border-[var(--color-border)] rounded-lg p-3 space-y-2 bg-[var(--color-bg)]">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Deal Review</span>
                  <span class="text-[12.5px] text-[var(--color-text)] font-medium">{dealReview.title || `Deal ${dealReview.id}`}</span>
                  <Pill tone={dealReview.hasVerifiedProperty && !dealReview.hasUnverifiedProperty ? 'done' : 'neutral'}>
                    {dealReview.hasVerifiedProperty && !dealReview.hasUnverifiedProperty ? 'verified' : 'research / unverified'}
                  </Pill>
                  <span class="text-[10px] text-[var(--color-text-faint)]">
                    {dealReview.propertyCount} propert{dealReview.propertyCount === 1 ? 'y' : 'ies'}/APN · {dealReview.compCount} comp{dealReview.compCount === 1 ? '' : 's'}
                  </span>
                </div>

                {dealReview.hasUnverifiedProperty && (
                  <div class="text-[11px] text-[var(--color-status-failed)] bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] rounded-md px-2 py-1.5">
                    Research / unverified parcel(s) present. Confirm APN + county/state/FIPS, or LandPortal property ID + FIPS, before scoring, valuing, or offer guidance.
                  </div>
                )}

                <div class="space-y-1">
                  <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Properties / APNs</div>
                  <ul class="space-y-1">
                    {dealReview.propertyCards.map((p: any) => (
                      <li key={p.id} class="text-[11.5px] flex items-center gap-2 flex-wrap">
                        <Pill tone={p.verification_status === 'verified_property' ? 'done' : 'neutral'}>
                          {p.verification_status === 'verified_property' ? 'verified' : 'research'}
                        </Pill>
                        <span class="text-[var(--color-text)]">{p.apn || p.active_input_address || '(no APN)'}</span>
                        <span class="text-[var(--color-text-faint)]">{[p.county, p.state].filter(Boolean).join(', ')}</span>
                        {typeof p.acres === 'number' && <span class="text-[var(--color-text-muted)]">{p.acres} ac</span>}
                        {p.owner && <span class="text-[var(--color-text-muted)]">owner: {p.owner}</span>}
                        {p.lp_url && <a href={p.lp_url} target="_blank" rel="noopener noreferrer" class="text-[var(--color-accent)] hover:underline">LandPortal ↗</a>}
                      </li>
                    ))}
                  </ul>
                </div>

                {dealReview.risks.length > 0 && (
                  <DetailList title="Risks / anomaly flags" items={dealReview.risks} />
                )}
                {dealReview.nextActions.length > 0 && (
                  <DetailList title="Next actions" items={dealReview.nextActions.map((n: any) => `${n.action} (${n.status})`)} />
                )}
                {dealReview.latestWriteback && (
                  <div class="text-[11px] text-[var(--color-text-muted)]">
                    <span class="uppercase tracking-wider text-[10px] text-[var(--color-text-faint)]">Latest Duke writeback</span>
                    <div>{dealReview.latestWriteback}</div>
                  </div>
                )}
              </div>
            )}

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

            {/* Comps — manual entry. A comp never verifies the parcel or changes
                identity/owner/contiguity/verification; source + status stay visible. */}
            <div class="border-t border-[var(--color-border)] pt-3 space-y-2">
              <div class="flex items-center justify-between">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Comps</div>
                <button
                  type="button"
                  onClick={() => setShowCompForm((v) => !v)}
                  class="text-[11px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
                >
                  {showCompForm ? 'Cancel' : 'Add Manual Comp'}
                </button>
              </div>

              {comps.length === 0 && !showCompForm && (
                <div class="text-[11.5px] text-[var(--color-text-muted)]">No comps yet.</div>
              )}

              {comps.length > 0 && (
                <ul class="space-y-1.5">
                  {comps.map((cp) => (
                    <li key={cp.id} class="text-[11.5px] border border-[var(--color-border)] rounded-md p-2">
                      <div class="flex items-center gap-2 flex-wrap">
                        <Pill tone="neutral">{cp.source_label}</Pill>
                        {typeof cp.price === 'number' && (
                          <span class="text-[var(--color-text)]">{formatMoney(cp.price)} <span class="text-[var(--color-text-faint)]">({cp.price_kind})</span></span>
                        )}
                        {typeof cp.acres === 'number' && <span class="text-[var(--color-text-muted)]">{cp.acres} ac</span>}
                        {typeof cp.price_per_acre === 'number' && (
                          <span class="text-[var(--color-text-muted)]">{formatMoney(cp.price_per_acre)}/ac</span>
                        )}
                        {cp.sale_or_list_date && <span class="text-[var(--color-text-faint)]">{cp.sale_or_list_date}</span>}
                        <Pill tone={cp.status === 'verified_sale' ? 'done' : cp.status === 'rejected' ? 'failed' : 'neutral'}>{cp.status}</Pill>
                        {cp.source_url && (
                          <a href={cp.source_url} target="_blank" rel="noopener noreferrer" class="text-[var(--color-accent)] hover:underline">source ↗</a>
                        )}
                      </div>
                      {(cp.address_desc || cp.notes) && (
                        <div class="text-[var(--color-text-muted)] mt-0.5">{[cp.address_desc, cp.notes].filter(Boolean).join(' — ')}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {showCompForm && (
                <div class="border border-[var(--color-border)] rounded-md p-2.5 space-y-2 bg-[var(--color-bg)]">
                  <div class="grid grid-cols-2 gap-2">
                    <CompSelect label="Source" value={compForm.sourceLabel} options={COMP_SOURCE_LABELS as readonly string[]} onChange={(v) => compField('sourceLabel', v)} />
                    <CompSelect label="Price kind" value={compForm.priceKind} options={COMP_PRICE_KINDS as readonly string[]} onChange={(v) => compField('priceKind', v)} />
                    <CompInput label="Price" value={compForm.price} onChange={(v) => compField('price', v)} placeholder="42000" type="number" />
                    <CompInput label="Acres" value={compForm.acres} onChange={(v) => compField('acres', v)} placeholder="5" type="number" />
                    <CompInput label="Sale/List date" value={compForm.saleOrListDate} onChange={(v) => compField('saleOrListDate', v)} placeholder="2026-03-01" />
                    <CompSelect label="Status" value={compForm.status} options={COMP_STATUSES as readonly string[]} onChange={(v) => compField('status', v)} />
                    <CompInput label="APN" value={compForm.apn} onChange={(v) => compField('apn', v)} />
                    <CompInput label="County" value={compForm.county} onChange={(v) => compField('county', v)} />
                    <CompInput label="State" value={compForm.state} onChange={(v) => compField('state', v)} />
                    <CompInput label="Source URL" value={compForm.sourceUrl} onChange={(v) => compField('sourceUrl', v)} placeholder="https://..." />
                  </div>
                  <CompInput label="Address / description" value={compForm.addressDesc} onChange={(v) => compField('addressDesc', v)} />
                  <CompInput label="Notes" value={compForm.notes} onChange={(v) => compField('notes', v)} />
                  {parsedPpaPreview(compForm.price, compForm.acres) && (
                    <div class="text-[11px] text-[var(--color-text-muted)]">Price per acre: {parsedPpaPreview(compForm.price, compForm.acres)}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveComp()}
                    disabled={compBusy}
                    class="text-[12px] px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
                  >
                    {compBusy ? 'Saving…' : 'Save comp'}
                  </button>
                </div>
              )}
            </div>

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

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Preview price-per-acre in the form ONLY when both price and acreage parse to
// positive numbers. Never fabricates a value when either is missing.
function parsedPpaPreview(priceStr: string, acresStr: string): string | null {
  const price = parseFloat(priceStr);
  const acres = parseFloat(acresStr);
  if (!Number.isFinite(price) || !Number.isFinite(acres) || acres <= 0) return null;
  return formatMoney(price / acres) + '/ac';
}

const fieldCls =
  'mt-0.5 w-full bg-[var(--color-card)] border border-[var(--color-border)] rounded px-2 py-1 text-[11.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]';

function CompInput({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label class="block">
      <span class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <input type={type || 'text'} value={value} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLInputElement).value)} class={fieldCls} />
    </label>
  );
}

function CompSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <label class="block">
      <span class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)} class={fieldCls}>
        {options.map((o) => <option value={o}>{o}</option>)}
      </select>
    </label>
  );
}
