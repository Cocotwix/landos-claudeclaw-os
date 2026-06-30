import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { ModelControl } from '@/components/ModelControl';
import { SmartIntake } from '@/components/SmartIntake';
import { BrowserIntelControl } from '@/components/BrowserIntelControl';

// Acquire — Universal Intake → Property Resolution → DD. A single click runs the
// Property Resolution Engine server-side (every practical lane: Realie/LandPortal
// exact resolve, free Census county derivation + retry, free Photon/Census
// address suggest, parked browser lanes) and returns Matched or Needs
// Clarification. On Matched it persists/updates a Property + Deal Card, runs the
// production DD pipeline, and OPENS the Deal Card (which renders every section);
// unknown fields are surfaced as Confirm Before Offer, never suppressed. On Needs
// Clarification it shows practical guidance and opens nothing. Pre-call DD is
// practical property intelligence — parcel identity is still verified only from
// named sources, never imagery or a suggestion's coordinates.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

const PROGRESS_STAGES = [
  'Resolving the property (every practical lane)', 'Verifying parcel identity (named sources)',
  'Collecting property + DD facts', 'Running gov DD (FEMA / NWI / USGS)',
  'Collecting Realie sold comps', 'Adding Zillow supplemental listings',
  'Building Pre-Call Intelligence', 'Opening Deal Card', 'Complete',
];

function entityLabel(e: EntityFilter): string {
  if (e === 'LAND_ALLY') return 'Land Ally';
  if (e === 'TY_LAND_BIZ') return 'Solo Biz';
  return 'all entities';
}

interface AcquireResponse {
  ok: boolean; matched?: boolean; parcelVerified?: boolean; dealCardId: number | null;
  pipeline?: string; status?: string; message?: string; guidance?: string;
  confidence?: number; matchedReason?: string; confirmBeforeOffer?: string[]; sources?: string[];
}

export function Acquire({ entity, onOpenDealCard }: { entity: EntityFilter; onOpenDealCard?: (id: number) => void }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsClarification, setNeedsClarification] = useState<string | null>(null);

  // ── The single normal action — Property Resolution → DD ────────────────────
  // Runs the Property Resolution Engine; on Matched it persists/updates the Deal
  // Card, runs the production DD report, and OPENS the Deal Card (which renders
  // every section). Unknown fields ride along as Confirm Before Offer. On Needs
  // Clarification it shows practical guidance and opens nothing — never an empty
  // shell. The open is gated on res.matched (a credible match), not on legal-grade
  // verification: pre-call DD is practical intelligence, not title work.
  async function runPropertyAnalysis() {
    if (!text.trim()) return;
    setRunning(true);
    setError(null);
    setNeedsClarification(null);
    try {
      const body: Record<string, unknown> = { text };
      if (entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ') body.entity = entity;
      const res = await apiPost<AcquireResponse>('/api/landos/acquire/run', body);
      if (res.ok && res.matched === true && res.dealCardId) {
        if (onOpenDealCard) onOpenDealCard(res.dealCardId);
      } else {
        setNeedsClarification(res.guidance || res.message || 'No practical match could be established. Provide APN + county, owner + city/state, or a corrected address.');
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Browser Intelligence operator control — start/connect the persistent
          Chrome session used for LandPortal/County browser work. */}
      <BrowserIntelControl />

      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Acquire — Universal Intake</div>
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="routing" orientation="task_oriented" label="Intake model" size="sm" />
        </div>
        <SmartIntake
          value={text}
          onInput={setText}
          onSubmit={() => void runPropertyAnalysis()}
          disabled={running}
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
            Tagging: <span class="text-[var(--color-text-muted)]">{entityLabel(entity)}</span>. A Deal Card opens on a credible match; unknown fields ride along as Confirm Before Offer. No practical match returns the smallest next identifier.
          </span>
        </div>
      </div>

      {needsClarification && (
        <div class="rounded-lg border border-[var(--color-status-warn,var(--color-border))] bg-[var(--color-card)] p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Needs clarification</div>
          <div class="text-[12px] text-[var(--color-text-muted)]">{needsClarification}</div>
        </div>
      )}

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
