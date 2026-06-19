import { useEffect, useState } from 'preact/hooks';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';

// Deal Card panel — read-only UI coverage of the required layout sections.
// Data comes from the existing /api/landos/deal-cards/:id detail route. Fields
// the data model does not yet carry render an explicit "not captured yet"
// placeholder rather than fabricated values. No external CRM/GHL mutation, no
// fake sync, and imagery never drives parcel identity (exact-source only).
//
// Create/edit/save/reload/update is proven by the backend persistence tests;
// this panel is the section coverage surface.

const MIN_NET_BASELINE_USD = 10_000;

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

  const prop = deal?.propertyCards?.[0];
  const owner = deal?.people?.find((p) => p.role === 'owner');
  const seller = deal?.people?.find((p) => p.role === 'seller');

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Load-by-id control (no create/edit write path wired in this panel) */}
      {!dealCardId && (
        <div class="flex items-center gap-2">
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
        </div>
      )}

      {error && <PageState error={error} />}
      {loading && !deal && <PageState loading />}
      {!deal && !loading && !error && (
        <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
          Load a Deal Card by id to view its panels.
        </div>
      )}

      {deal && (
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
