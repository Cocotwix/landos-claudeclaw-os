import { useState } from 'preact/hooks';
import { apiPost } from '@/lib/api';
import { BrowserIntelControl } from '@/components/BrowserIntelControl';

// Resolution view — shown INSTEAD of a half-populated Deal Card while the subject
// parcel is a Candidate or Unresolved. It shows exactly what LandOS understood,
// which sources were searched, which candidates were found and why each was
// accepted/rejected, what is missing, and the single smallest next identifier
// needed to confirm the parcel. No Property Intelligence / comps / strategy /
// offer range / Market Pulse / Discovery Report appears until the parcel is
// confirmed. Confirm actions re-run Property Resolution (which uses the Browser
// Agent / LandPortal / named-source verification) — on success the normal Deal
// Card opens.

interface ResolutionParsed {
  address?: string; city?: string; county?: string; state?: string; zip?: string;
  apn?: string; apnAlternates?: string[]; owner?: string; fips?: string;
}
interface ResolutionLaneView { lane: string; status: string; ran: boolean; contributed: boolean; note: string; }
interface ResolutionBrowserView { service: string; status: string; note: string; factCount: number; }
export interface ResolutionSnapshotView {
  rawInput: string;
  parsed: ResolutionParsed;
  state: 'unresolved' | 'candidate' | 'confirmed';
  confidence: number;
  basis: string;
  matchedReason: string;
  lanes: ResolutionLaneView[];
  browser: ResolutionBrowserView[];
  acceptedSources: string[];
  missing: string[];
  smallestNextIdentifier: string;
  guidance?: string;
  identityConflict?: {
    requestedApn: string;
    resolvedApn: string;
    source: string;
    resolvedContext?: string;
  };
  capturedAt: string;
}
export interface ParcelIdentityView {
  state: 'unresolved' | 'candidate' | 'confirmed';
  basis: string;
  confidence: number;
  evidenceRefs: string[];
}

const STATE_LABEL: Record<string, string> = {
  unresolved: 'Unresolved', candidate: 'Candidate', confirmed: 'Confirmed',
};
const STATE_HELP: Record<string, string> = {
  unresolved: 'No credible subject yet — provide a stronger identifier.',
  candidate: 'Strong hypothesis, but the exact parcel is NOT yet confirmed. A geocoder proves where an address is, not which parcel it is.',
  confirmed: 'The exact parcel is confirmed.',
};

/** A source lane is "accepted" when it contributed identity evidence; "no match"
 *  / "error" / "parked" are honest non-contributions. */
function laneVerdict(l: ResolutionLaneView): { label: string; tone: string } {
  if (l.contributed) return { label: 'accepted', tone: 'text-[var(--color-status-ok,#3aa675)]' };
  if (!l.ran || l.status === 'parked') return { label: 'not run', tone: 'text-[var(--color-text-faint)]' };
  if (l.status === 'error') return { label: 'error', tone: 'text-[var(--color-status-failed,#c2564e)]' };
  return { label: 'rejected', tone: 'text-[var(--color-text-muted)]' };
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div class="flex flex-col">
      <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <span class="text-[12px] text-[var(--color-text)]">{value && String(value).trim() ? value : <span class="text-[var(--color-text-faint)]">—</span>}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{title}</div>
      {children}
    </div>
  );
}

export function ResolutionView({
  snapshot, identity, entity, onConfirmed,
}: {
  snapshot: ResolutionSnapshotView;
  identity: ParcelIdentityView | null;
  entity: 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';
  onConfirmed: () => void;
}) {
  const [rechecking, setRechecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const state = identity?.state ?? snapshot.state;
  const basis = identity?.basis || snapshot.basis;
  const confidence = identity?.confidence ?? snapshot.confidence;
  const p = snapshot.parsed;

  // Re-run Property Resolution with the original intake. If a parcel-level source
  // (Browser Agent on LandPortal, official county record, or a named source) now
  // confirms the exact parcel, the normal Deal Card opens.
  async function recheck() {
    setRechecking(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { text: snapshot.rawInput, rawInput: snapshot.rawInput };
      if (entity === 'LAND_ALLY' || entity === 'TY_LAND_BIZ') body.entity = entity;
      const res = await apiPost<{ identityEstablished?: boolean; status?: string; message?: string }>('/api/landos/acquire/run', body);
      if (res.identityEstablished === true || res.status === undefined) {
        onConfirmed();
        return;
      }
      setMsg(res.message || 'Still not confirmed. Provide the smallest next identifier below, or confirm the parcel on LandPortal via the Browser Agent.');
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setRechecking(false);
    }
  }

  const conflict = snapshot.identityConflict;

  return (
    <div class="space-y-4">
      {/* HARD wrong-parcel conflict — loud, unmissable, no downstream ran. */}
      {conflict && (
        <div class="rounded-lg border-2 border-[var(--color-status-failed,#c2564e)] bg-[color-mix(in_srgb,var(--color-status-failed,#c2564e)_12%,var(--color-card))] p-4">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[13px] font-bold text-[var(--color-status-failed,#c2564e)]">⛔ WRONG PARCEL — HARD STOP</span>
          </div>
          <div class="text-[12px] text-[var(--color-text)] mt-1.5 leading-relaxed">
            You asked for APN <span class="font-mono font-semibold">{conflict.requestedApn}</span>, but {conflict.source} resolved a <span class="font-semibold">different parcel</span> — APN <span class="font-mono font-semibold">{conflict.resolvedApn}</span>
            {conflict.resolvedContext ? <span class="text-[var(--color-text-muted)]"> ({conflict.resolvedContext})</span> : null}.
          </div>
          <div class="text-[11px] text-[var(--color-text-muted)] mt-1.5 border-t border-[var(--color-border)] pt-2">
            The resolved parcel was <span class="font-semibold">NOT</span> accepted as the subject. No Property Intelligence, Land Score, valuation, offer range, strategy, comps, Market Pulse, or seller brief ran. Re-check the APN, or provide a corrected parcel identifier (APN + county) below.
          </div>
        </div>
      )}
      {/* Status banner */}
      <div class="rounded-lg border border-[var(--color-status-warn,var(--color-border))] bg-[var(--color-elevated)] p-4">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[13px] font-semibold">Parcel Resolution</span>
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
            {STATE_LABEL[state] ?? state}
          </span>
          <span class="text-[10px] text-[var(--color-text-faint)]">confidence {Math.round(confidence * 100)}%</span>
        </div>
        <div class="text-[12px] text-[var(--color-text-muted)] mt-1">{STATE_HELP[state]}</div>
        <div class="text-[11px] text-[var(--color-text-faint)] mt-1">{basis}</div>
        <div class="text-[11px] text-[var(--color-text-faint)] mt-2 border-t border-[var(--color-border)] pt-2">
          Property Intelligence, comps, strategy, offer range, Market Pulse, and the Discovery Report are on hold until the parcel is confirmed.
        </div>
      </div>

      {/* What LandOS understood from the intake */}
      <Card title="What LandOS understood">
        <div class="text-[12px] text-[var(--color-text-muted)] italic mb-2">"{snapshot.rawInput}"</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Road / address" value={p.address} />
          <Field label="County" value={p.county} />
          <Field label="State" value={p.state} />
          <Field label="Nearby city" value={p.city} />
          <Field label="ZIP" value={p.zip} />
          <Field label="APN" value={p.apn} />
          <Field label="Owner" value={p.owner} />
          <Field label="FIPS" value={p.fips} />
          <Field label="APN variants" value={(p.apnAlternates ?? []).join(', ')} />
        </div>
      </Card>

      {/* The single smallest next identifier + confirm actions */}
      <Card title="Smallest next identifier needed">
        <div class="text-[13px] text-[var(--color-text)]">{snapshot.smallestNextIdentifier}</div>
        {snapshot.guidance && <div class="text-[11px] text-[var(--color-text-faint)]">{snapshot.guidance}</div>}
        <div class="border-t border-[var(--color-border)] pt-2 mt-1 space-y-2">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Confirm the parcel</div>
          <BrowserIntelControl />
          <div class="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void recheck()}
              disabled={rechecking}
              class="px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40"
            >
              {rechecking ? 'Re-checking…' : 'Re-run resolution / confirm parcel'}
            </button>
            <span class="text-[10px] text-[var(--color-text-faint)]">
              Confirms via the Browser Agent reading the exact parcel on LandPortal, an official county assessor/tax/recorder record, or a named source. A marketplace property page (Zillow/Redfin/Realtor) also confirms.
            </span>
          </div>
          {msg && <div class="text-[11px] text-[var(--color-text-muted)]">{msg}</div>}
        </div>
      </Card>

      {/* What is missing */}
      {snapshot.missing.length > 0 && (
        <Card title="What is missing">
          <ul class="space-y-1">
            {snapshot.missing.map((m) => (
              <li key={m} class="text-[12px] text-[var(--color-text-muted)] flex items-center gap-2">
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)]" /> {m}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Sources searched — candidates + why each was accepted/rejected */}
      <Card title="Sources searched">
        <div class="space-y-1.5">
          {snapshot.lanes.length === 0 && <div class="text-[11px] text-[var(--color-text-faint)]">No lanes recorded.</div>}
          {snapshot.lanes.map((l, i) => {
            const v = laneVerdict(l);
            return (
              <div key={`${l.lane}-${i}`} class="flex items-start gap-2 text-[11px]">
                <span class={`font-semibold w-16 shrink-0 ${v.tone}`}>{v.label}</span>
                <span class="font-mono text-[10px] text-[var(--color-text-muted)] w-32 shrink-0 truncate">{l.lane}</span>
                <span class="text-[var(--color-text-muted)]">{l.note}</span>
              </div>
            );
          })}
        </div>
        {snapshot.browser.length > 0 && (
          <div class="border-t border-[var(--color-border)] pt-2 mt-1 space-y-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Browser Intelligence</div>
            {snapshot.browser.map((b, i) => (
              <div key={`${b.service}-${i}`} class="flex items-start gap-2 text-[11px]">
                <span class="font-mono text-[10px] text-[var(--color-text-muted)] w-32 shrink-0">{b.service}:{b.status}</span>
                <span class="text-[var(--color-text-muted)]">{b.note} {b.factCount > 0 ? `(${b.factCount} facts)` : ''}</span>
              </div>
            ))}
          </div>
        )}
        {snapshot.acceptedSources.length > 0 && (
          <div class="text-[11px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2 mt-1">
            Contributing sources: {snapshot.acceptedSources.join(', ')}
          </div>
        )}
      </Card>
    </div>
  );
}
