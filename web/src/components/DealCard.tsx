import { useEffect, useState } from 'preact/hooks';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

// Deal Card panel — section coverage PLUS approval-gated create/edit/save of the
// deal-level fields. Data comes from /api/landos/deal-cards/:id (detail); writes
// go to POST /api/landos/deal-cards (create) and PATCH /api/landos/deal-cards/:id
// (update). After any write we re-load the same id from the API, which both
// proves persistence/reload and guarantees we update one record (no duplicates).
//
// Deal-level fields only live here (title, stage, seller notes, asking price,
// strategy, package notes). Parcel identity/verification is never edited here.
// Fields the data model does not yet carry render an explicit "not captured yet"
// placeholder rather than fabricated values. No external CRM/GHL mutation, no
// fake sync, and imagery never drives parcel identity (exact-source only).

const MIN_NET_BASELINE_USD = 10_000;

// Deal Card stages (mirrors DEAL_CARD_STATUSES in src/landos/db.ts). The backend
// re-validates, so this is just the picker surface.
const DEAL_STAGES = [
  'new', 'researching', 'discovery', 'underwriting', 'offer_ready',
  'offer_sent', 'follow_up', 'under_contract', 'closed', 'dead', 'archived',
] as const;

interface DealForm {
  entity: 'LAND_ALLY' | 'TY_LAND_BIZ';
  title: string;
  status: string;
  sellerNotes: string;
  askingPrice: string;
  combinedStrategy: string;
  packageNotes: string;
}

const EMPTY_FORM: DealForm = {
  entity: 'TY_LAND_BIZ', title: '', status: 'new', sellerNotes: '',
  askingPrice: '', combinedStrategy: '', packageNotes: '',
};

interface PropertyCardLite {
  id: number;
  active_input_address?: string | null;
  apn?: string | null;
  county?: string | null;
  state?: string | null;
  acres?: number | null;
  zoning?: string | null;
  verification_status?: string | null;
  open_risks?: string | null;
  lp_url?: string | null;
}

interface PersonLite {
  name?: string | null;
  role?: string | null;
  authority_status?: string | null;
  phone?: string | null;
  email?: string | null;
  mailing_address?: string | null;
}

interface DealCardDetail {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  seller_notes: string;
  asking_price: number | null;
  combined_strategy: string;
  package_notes: string;
  combined_acreage: number | null;
  propertyCards?: PropertyCardLite[];
  people?: PersonLite[];
}

function entityBadge(entity: string | null): string {
  if (entity === 'LAND_ALLY') return 'Land Ally';
  if (entity === 'TY_LAND_BIZ') return 'My Business';
  return 'Unknown';
}

function Placeholder({ text = 'Not captured yet' }: { text?: string }) {
  return <span class="text-[12px] text-[var(--color-text-faint)] italic">{text}</span>;
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="flex justify-between gap-3 py-0.5">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      {has ? <span class="text-[12px] text-[var(--color-text)] text-right">{value}</span> : <Placeholder />}
    </div>
  );
}

export function DealCard({ dealCardId }: { dealCardId?: number }) {
  const [idInput, setIdInput] = useState<string>(dealCardId ? String(dealCardId) : '');
  const [deal, setDeal] = useState<DealCardDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create/edit state. mode 'view' renders the read-only panels; 'create' and
  // 'edit' render the deal-level form. saving/saveError gate the Save button.
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [form, setForm] = useState<DealForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load(id: number) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<{ dealCard: DealCardDetail }>(`/api/landos/deal-cards/${id}`);
      setDeal(res.dealCard);
    } catch (err: any) {
      setError(err?.message || String(err));
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (dealCardId) void load(dealCardId); }, [dealCardId]);

  function setField<K extends keyof DealForm>(key: K, value: DealForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startCreate() {
    setSaveError(null);
    setForm(EMPTY_FORM);
    setMode('create');
  }

  function startEdit() {
    if (!deal) return;
    setSaveError(null);
    setForm({
      entity: deal.entity === 'LAND_ALLY' ? 'LAND_ALLY' : 'TY_LAND_BIZ',
      title: deal.title ?? '',
      status: deal.status ?? 'new',
      sellerNotes: deal.seller_notes ?? '',
      askingPrice: deal.asking_price != null ? String(deal.asking_price) : '',
      combinedStrategy: deal.combined_strategy ?? '',
      packageNotes: deal.package_notes ?? '',
    });
    setMode('edit');
  }

  function cancelForm() {
    setSaveError(null);
    setMode('view');
  }

  // Build a write payload. Entity is only set on create (immutable after). An
  // empty asking price is omitted, never sent as 0.
  function payloadFromForm(isCreate: boolean): Record<string, unknown> {
    const askingNum = form.askingPrice.trim() === '' ? undefined : Number(form.askingPrice);
    const p: Record<string, unknown> = {
      title: form.title,
      status: form.status,
      sellerNotes: form.sellerNotes,
      combinedStrategy: form.combinedStrategy,
      packageNotes: form.packageNotes,
    };
    if (isCreate) p.entity = form.entity;
    if (askingNum !== undefined && Number.isFinite(askingNum)) p.askingPrice = askingNum;
    return p;
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'create') {
        const res = await apiPost<{ dealCard: DealCardDetail }>('/api/landos/deal-cards', payloadFromForm(true));
        // Re-load the same id from the API: proves the record persisted and is
        // recoverable, and keeps us on the one record (no duplicate creation).
        await load(res.dealCard.id);
      } else if (mode === 'edit' && deal) {
        await apiPatch<{ dealCard: DealCardDetail }>(`/api/landos/deal-cards/${deal.id}`, payloadFromForm(false));
        await load(deal.id);
      }
      setMode('view');
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const prop = deal?.propertyCards?.[0];
  const owner = deal?.people?.find((p) => p.role === 'owner');
  const seller = deal?.people?.find((p) => p.role === 'seller');

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Toolbar: load-by-id + create a new Deal Card. */}
      <div class="flex flex-wrap items-center gap-2">
        {!dealCardId && (
          <>
            <input
              type="text"
              value={idInput}
              onInput={(e) => setIdInput((e.target as HTMLInputElement).value)}
              placeholder="Deal Card id"
              class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] w-32 outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              onClick={() => { const n = Number(idInput); if (Number.isFinite(n) && n > 0) void load(n); }}
              class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
            >
              Load
            </button>
          </>
        )}
        {mode === 'view' && (
          <>
            <button
              type="button"
              onClick={startCreate}
              class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)]"
            >
              New Deal Card
            </button>
            {deal && (
              <button
                type="button"
                onClick={startEdit}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
              >
                Edit
              </button>
            )}
          </>
        )}
      </div>

      {/* Create / edit form for the deal-level fields. */}
      {mode !== 'view' && (
        <DealForm
          mode={mode}
          form={form}
          setField={setField}
          onSave={() => void save()}
          onCancel={cancelForm}
          saving={saving}
          saveError={saveError}
        />
      )}

      {mode === 'view' && error && <PageState error={error} />}
      {mode === 'view' && loading && !deal && <PageState loading />}
      {mode === 'view' && !deal && !loading && !error && (
        <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
          Load a Deal Card by id, or create a New Deal Card.
        </div>
      )}

      {mode === 'view' && deal && (
        <>
          {/* 1. Sticky / header area */}
          <div class="sticky top-0 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[14px] font-semibold">
                {prop?.active_input_address || deal.title || 'Untitled Deal'}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {entityBadge(deal.entity)}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                Stage: {deal.status}
              </span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-[var(--color-text-muted)]">
              <span>County/State: {[prop?.county, prop?.state].filter(Boolean).join(', ') || '—'}</span>
              <span>APN: {prop?.apn || '—'}</span>
              <span>Exit strategy: {deal.combined_strategy || '—'}</span>
              <span>Verification: {prop?.verification_status || 'unverified'}</span>
            </div>
          </div>

          {/* 2. Imagery panel — supporting context only, never parcel identity */}
          <Section title="Imagery">
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
              {['Satellite', 'Street', 'Terrain', 'Plat', 'Survey'].map((kind) => (
                <div key={kind} class="rounded border border-dashed border-[var(--color-border)] p-3 text-center">
                  <div class="text-[11px] text-[var(--color-text-muted)]">{kind}</div>
                  <div class="text-[10px] text-[var(--color-text-faint)] mt-1">Visual/source image not captured yet</div>
                </div>
              ))}
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">Imagery is supporting context only; it never verifies parcel identity.</div>
          </Section>

          {/* 3. Deal Economics */}
          <Section title="Deal Economics">
            <Field label="Estimated value (low)" />
            <Field label="Estimated value (mid)" />
            <Field label="Estimated value (high)" />
            <Field label="Current / last offer" />
            <Field label="Max offer" />
            <Field label="Projected net profit" />
            <Field label="Seller asking (negotiation context only)" value={deal.asking_price ?? undefined} />
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              Target-clear baseline: minimum ${MIN_NET_BASELINE_USD.toLocaleString()} net. Economics stay blocked until parcel is verified.
            </div>
          </Section>

          {/* 4. Land Data / DD Facts */}
          <Section title="Land Data / DD Facts">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <Field label="Acreage" value={prop?.acres ?? deal.combined_acreage ?? undefined} />
              <Field label="Zoning" value={prop?.zoning ?? undefined} />
              <Field label="Access" />
              <Field label="Utilities" />
              <Field label="Flood" />
              <Field label="Slope / topography" />
              <Field label="Wetlands / environmental" />
              <Field label="Taxes / liens" />
              <Field label="Soil / perc" />
              <Field label="Subdivision potential" />
            </div>
            <div class="mt-2">
              <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Data gaps</div>
              {prop?.open_risks ? <span class="text-[12px] text-[var(--color-text)]">{prop.open_risks}</span> : <Placeholder text="No data gaps recorded yet" />}
            </div>
          </Section>

          {/* 5. Owner / Seller */}
          <Section title="Owner / Seller">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <Field label="Owner name" value={owner?.name ?? undefined} />
              <Field label="Seller / lead name" value={seller?.name ?? undefined} />
              <Field label="Owner type" value={owner?.authority_status ?? undefined} />
              <Field label="Mailing address" value={owner?.mailing_address ?? seller?.mailing_address ?? undefined} />
              <Field label="Phone" value={owner?.phone ?? seller?.phone ?? undefined} />
              <Field label="Email" value={owner?.email ?? seller?.email ?? undefined} />
              <Field label="Motivation" />
              <Field label="Lead source" />
              <Field label="Ownership duration" />
            </div>
          </Section>

          {/* 6. Communication Summary — no external CRM mutation; GHL not connected */}
          <Section title="Communication Summary">
            <Field label="Last contact" />
            <Field label="Sentiment" />
            <Field label="Next follow-up" />
            <Field label="Timeline summary" />
            <div class="mt-2">
              <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Key quotes</div>
              <Placeholder text="No quotes captured yet" />
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              CRM / GHL link: not connected. No external CRM read or write in this view.
            </div>
          </Section>

          {/* 7. Exit Strategy Analysis */}
          <Section title="Exit Strategy Analysis">
            <Field label="Recommended strategy" value={deal.combined_strategy || undefined} />
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {['Quick flip', 'Subdivide', 'Land-home package', 'Improved / value-add', 'Pass / no-offer'].map((s) => (
                <div key={s} class="rounded border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)]">{s}</div>
              ))}
            </div>
            <div class="mt-2"><div class="text-[11px] text-[var(--color-text-muted)] mb-1">Blockers</div><Placeholder text="None recorded yet" /></div>
            <div class="mt-2"><div class="text-[11px] text-[var(--color-text-muted)] mb-1">Next confirmations</div><Placeholder /></div>
          </Section>

          {/* 8. Documents / Activity / Quick Actions */}
          <Section title="Documents / Activity / Quick Actions">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Documents</div>
            <Placeholder text="No documents attached yet" />
            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-1">Activity log</div>
            <Placeholder text="No activity recorded yet" />
            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-2">Quick actions (approval-gated)</div>
            <div class="flex flex-wrap gap-2">
              {['Make Offer', 'Schedule Follow-Up', 'Run Full Report', 'Change Stage', 'Push to CRM', 'Generate PDF'].map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled
                  title="Approval-gated / not enabled in this view"
                  class="px-2.5 py-1 rounded-md text-[11px] border border-[var(--color-border)] text-[var(--color-text-faint)] opacity-60 cursor-not-allowed"
                >
                  {a}
                </button>
              ))}
            </div>
          </Section>

          {/* 9. Pre-Call Brief */}
          <Section title="Pre-Call Brief">
            <Field label="What the seller wants" />
            <Field label="Current max / walk-away" />
            <Field label="Motivation" />
            <Field label="Last thing the seller said" />
            <Field label="Critical data gaps" />
            <Field label="Best current strategy" value={deal.combined_strategy || undefined} />
            <Field label="Questions to ask next" />
            <Field label="What not to mention yet" />
          </Section>
        </>
      )}
    </div>
  );
}

// ── Create/edit form for the deal-level fields ──────────────────────────────
// Generic deal-level inputs only. Entity is fixed once a card exists. Parcel
// identity, verification, comps, and any CRM/GHL push are NOT editable here.
function DealForm({
  mode, form, setField, onSave, onCancel, saving, saveError,
}: {
  mode: 'create' | 'edit';
  form: DealForm;
  setField: <K extends keyof DealForm>(key: K, value: DealForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';
  return (
    <section class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
          {mode === 'create' ? 'New Deal Card' : 'Edit Deal Card'}
        </h3>
        <span class="text-[10px] text-[var(--color-text-faint)]">Deal-level fields only · saved to local LandOS store</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Entity</span>
          <select
            value={form.entity}
            disabled={mode === 'edit'}
            onChange={(e) => setField('entity', (e.target as HTMLSelectElement).value as DealForm['entity'])}
            class={`${inputCls} ${mode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="TY_LAND_BIZ">My Business</option>
            <option value="LAND_ALLY">Land Ally</option>
          </select>
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Stage</span>
          <select
            value={form.status}
            onChange={(e) => setField('status', (e.target as HTMLSelectElement).value)}
            class={inputCls}
          >
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Title / label</span>
          <input
            type="text"
            value={form.title}
            placeholder="e.g. Sample seller lead (generic)"
            onInput={(e) => setField('title', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller asking (negotiation context only)</span>
          <input
            type="number"
            value={form.askingPrice}
            placeholder="optional"
            onInput={(e) => setField('askingPrice', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Combined / exit strategy</span>
          <input
            type="text"
            value={form.combinedStrategy}
            placeholder="optional"
            onInput={(e) => setField('combinedStrategy', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller notes</span>
          <textarea
            value={form.sellerNotes}
            rows={2}
            onInput={(e) => setField('sellerNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Package notes</span>
          <textarea
            value={form.packageNotes}
            rows={2}
            onInput={(e) => setField('packageNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      {saveError && <div class="text-[11px] text-[var(--color-status-failed)]">{saveError}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
        <span class="text-[10px] text-[var(--color-text-faint)]">CRM / GHL push is not connected and stays approval-gated.</span>
      </div>
    </section>
  );
}
