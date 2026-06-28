import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { ModelControl } from '@/components/ModelControl';

// Acquire — ONE normal action: Run Property Analysis. A single click runs the
// CURRENT production DD pipeline server-side (runDealCardReport): Realie-first
// parcel identity + locality validation -> property/DD facts -> FEMA/NWI/USGS gov
// DD -> Realie sold comps + Zillow supplemental -> browser market intelligence ->
// Pre-Call Intelligence -> Acquisitions, all persisted on a Deal Card. On success
// it OPENS the Deal Card (which renders every current section). The old two-step
// Verify/Create controls remain as a collapsed developer fallback. Parcel
// identity is verified only from named sources, never imagery/coordinates.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

const PROGRESS_STAGES = [
  'Verifying parcel identity (Realie-first)', 'Collecting property + DD facts',
  'Running gov DD (FEMA / NWI / USGS)', 'Collecting Realie sold comps',
  'Adding Zillow supplemental listings', 'Building Pre-Call Intelligence',
  'Opening Deal Card', 'Complete',
];

function entityLabel(e: EntityFilter): string {
  if (e === 'LAND_ALLY') return 'Land Ally';
  if (e === 'TY_LAND_BIZ') return 'Solo Biz';
  return 'all entities';
}

export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── The single normal action — PRODUCTION DD pipeline ──────────────────────
  // Runs the current Deal Card DD report (Realie-first identity + locality
  // validation, Realie sold comps + Zillow supplemental, FEMA/NWI/USGS, Pre-Call
  // Intelligence, Acquisitions) and opens the resulting Deal Card, which renders
  // every current section. (The legacy /property-analysis result view is retired.)
  async function runPropertyAnalysis() {
    if (!text.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { text };
      if (entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ') body.entity = entity;
      const res = await apiPost<{ dealCardId: number; pipeline: string; parcelVerified: boolean }>('/api/landos/acquire/run', body);
      if (res.dealCardId && onOpenDealCard) onOpenDealCard(res.dealCardId);
      else setError('No Deal Card was returned.');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Acquire — Property Analysis</div>
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="routing" orientation="task_oriented" label="Intake model" size="sm" />
        </div>
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="Enter a full address, APN, or owner + county. One click runs the whole analysis — county/FIPS is resolved internally. Identity is verified from named sources, never imagery or coordinates."
          class="w-full h-20 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void runPropertyAnalysis()}
            disabled={running || !text.trim()}
            class="px-4 py-2 rounded-md text-[13px] font-semibold border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40"
          >
            {running ? 'Running Property Analysis…' : 'Run Property Analysis'}
          </button>
          <span class="text-[10px] text-[var(--color-text-faint)]">
            Tagging: <span class="text-[var(--color-text-muted)]">{entityLabel(entity)}</span>. A verified Deal Card is created automatically on success.
          </span>
        </div>
      </div>

      {running && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Working…</div>
          <ul class="space-y-1">
            {PROGRESS_STAGES.slice(0, -1).map((s) => (
              <li key={s} class="text-[12px] text-[var(--color-text-muted)] flex items-center gap-2">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-pulse" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">{error}</div>}

      {/* Demoted developer fallback — the OLD two-step Verify/Create flow. */}
      <details class="rounded-lg border border-dashed border-[var(--color-border)] p-2">
        <summary class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] cursor-pointer">Developer fallback — manual Verify / Create (not the normal flow)</summary>
        <DeveloperFallback entity={entity} onOpenDealCard={onOpenDealCard} />
      </details>
    </div>
  );
}

// The previous two-button workflow, retained only as an explicit developer tool.
function DeveloperFallback({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canCreate = entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ';
  async function verifyOnly() {
    if (!text.trim()) return; setBusy(true); setMsg(null);
    try { const res = await apiPost<{ verification: { parcelVerified: boolean; status: string } }>('/api/landos/intake/duke-verification', { text }); setMsg(`verify: ${res.verification.status}`); }
    catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  }
  async function createOnly() {
    if (!canCreate || !text.trim()) return; setBusy(true); setMsg(null);
    try { const res = await apiPost<{ created: boolean; dealCardId?: number }>('/api/landos/deal-cards/from-verification', { text, entity }); setMsg(res.created ? `created #${res.dealCardId}` : 'not created (unverified)'); if (res.created && res.dealCardId && onOpenDealCard) onOpenDealCard(res.dealCardId); }
    catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  }
  return (
    <div class="mt-2 space-y-2">
      <textarea value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="address / APN (developer)" class="w-full h-12 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1 text-[11px]" />
      <div class="flex items-center gap-2">
        <button type="button" onClick={() => void verifyOnly()} disabled={busy} class="px-2 py-1 rounded-md text-[11px] border border-[var(--color-border)] disabled:opacity-40">Verify only</button>
        <button type="button" onClick={() => void createOnly()} disabled={busy || !canCreate} class="px-2 py-1 rounded-md text-[11px] border border-[var(--color-border)] disabled:opacity-40">Create only</button>
        {msg && <span class="text-[10px] text-[var(--color-text-faint)]">{msg}</span>}
      </div>
    </div>
  );
}
