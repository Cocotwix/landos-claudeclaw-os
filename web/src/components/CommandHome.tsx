import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { Landmark, ExternalLink, FileText, AlertCircle } from 'lucide-preact';
import { PageState } from '@/components/PageState';
import { apiGet } from '@/lib/api';

// LandOS Command home foundation. Renders the department leg status tiles from
// the read-only structure summary (/api/landos/structure) and additive quick
// links to Deal Cards and the EXISTING War Room page. Money KPI / Action Center
// / exit-strategy / performance sections are intentionally light shells in v1.
//
// LandOS Command is the only orchestrator. This is a surface, not a department.

type LegStatus = 'active' | 'shell' | 'planned';

interface LegTile {
  id: string;
  displayName: string;
  status: LegStatus;
  summaryMetricLabel: string;
  dashboardRoute: string | null;
  canAlert: boolean;
}

interface StructureResponse {
  legs: LegTile[];
}

// Live counts we can serve HONESTLY from existing endpoints today. Anything not
// here stays "No live count yet" rather than a fabricated number.
interface LiveCounts {
  dealCards: number | null;
  propertyCards: number | null;
}

// Status-only Live Comps readiness (booleans + zeros). Mirrors the safe payload
// from GET /api/landos/live-comps/preflight. No secret values, no actor names.
interface LiveCompsStatus {
  liveCompsEnabled: boolean;
  apifyTokenPresent: boolean;
  redfinSearchActorPresent: boolean;
  redfinDetailActorPresent: boolean;
  redfinCompsReady: boolean;
  providerCallsMade: number;
  spendUsd: number;
}

function statusClass(status: LegStatus): string {
  if (status === 'active') return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
  if (status === 'shell') return 'text-[var(--color-text-muted)] border-[var(--color-border)]';
  return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
}

// Map a leg id to a live count ONLY where a real endpoint already backs it.
// Returns null when there is no honest live count for that leg yet.
function legLiveCount(legId: string, counts: LiveCounts): number | null {
  if (legId === 'due-diligence-research') return counts.propertyCards;
  return null;
}

export function CommandHome({ onOpenDealCards }: { onOpenDealCards?: () => void }) {
  const [, setLocation] = useLocation();
  const [legs, setLegs] = useState<LegTile[] | null>(null);
  const [counts, setCounts] = useState<LiveCounts>({ dealCards: null, propertyCards: null });
  const [liveComps, setLiveComps] = useState<LiveCompsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiGet<StructureResponse>('/api/landos/structure');
        if (alive) setLegs(res.legs);
      } catch (err: any) {
        if (alive) setError(err?.message || String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    // Best-effort live counts. Failures leave counts null ("No live count yet"),
    // never a fabricated number, and never block the page.
    (async () => {
      try {
        const [deals, props] = await Promise.all([
          apiGet<{ dealCards: unknown[] }>('/api/landos/deal-cards'),
          apiGet<{ cards: unknown[] }>('/api/landos/property-cards'),
        ]);
        if (alive) setCounts({
          dealCards: Array.isArray(deals.dealCards) ? deals.dealCards.length : null,
          propertyCards: Array.isArray(props.cards) ? props.cards.length : null,
        });
      } catch {
        /* leave counts null */
      }
    })();
    // Best-effort Live Comps readiness (status-only booleans). Failure leaves it
    // null ("No status yet"); it never blocks the page and never shows a value.
    (async () => {
      try {
        const s = await apiGet<LiveCompsStatus>('/api/landos/live-comps/preflight');
        if (alive) setLiveComps(s);
      } catch {
        /* leave liveComps null */
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <PageState error={error} />;
  if (loading && !legs) return <PageState loading />;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      {/* Top entry + quick links. War Room is the EXISTING page, linked additively. */}
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex-1 min-w-[200px]">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">LandOS Command</div>
          <div class="text-[12px] text-[var(--color-text-muted)] mt-0.5">
            The orchestrator surface. Route a request, open a Deal Card, or jump into the War Room.
          </div>
        </div>
        <button
          type="button"
          onClick={() => (onOpenDealCards ? onOpenDealCards() : setLocation('/properties'))}
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
        >
          <FileText size={13} /> Deal Cards{counts.dealCards !== null ? ` (${counts.dealCards})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setLocation('/warroom')}
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
        >
          <ExternalLink size={13} /> War Room
        </button>
      </div>

      {/* Money KPI row shell */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['Pipeline value', 'Deals in progress', 'Projected net', 'Cash committed'].map((label) => (
          <div key={label} class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-3">
            <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
            <div class="text-[12px] text-[var(--color-text-muted)] mt-1">Not captured yet</div>
          </div>
        ))}
      </div>

      {/* Action Center shell — urgent items from department legs */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Action Center</h2>
        <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
          Urgent items surfaced by department legs will appear here. No live alerts yet.
        </div>
      </div>

      {/* Live Comps Status — status-only readiness (no secrets, no provider call) */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Live Comps Status</h2>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 max-w-md">
          {liveComps === null ? (
            <div class="text-[12px] text-[var(--color-text-faint)]">No status yet</div>
          ) : (
            <>
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-medium">Live Redfin Comps</span>
                <span class={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${liveComps.redfinCompsReady ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-text-muted)] border-[var(--color-border)]'}`}>
                  {liveComps.redfinCompsReady ? 'Ready' : 'Not Ready'}
                </span>
              </div>
              <div class="mt-2 space-y-1">
                {[
                  ['Live comps enabled', liveComps.liveCompsEnabled],
                  ['Apify token present', liveComps.apifyTokenPresent],
                  ['Redfin search actor present', liveComps.redfinSearchActorPresent],
                  ['Redfin detail actor present', liveComps.redfinDetailActorPresent],
                ].map(([label, ok]) => (
                  <div key={label as string} class="flex items-center justify-between text-[12px]">
                    <span class="text-[var(--color-text-muted)]">{label}</span>
                    <span class={ok ? 'text-[var(--color-status-done)]' : 'text-[var(--color-text-faint)]'}>{ok ? 'yes' : 'no'}</span>
                  </div>
                ))}
              </div>
              <div class="mt-2 pt-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-faint)] flex gap-4">
                <span>Provider calls: {liveComps.providerCallsMade}</span>
                <span>Spend: ${liveComps.spendUsd.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Department leg status tiles — the real, data-driven section */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Department Legs</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(legs ?? []).map((leg) => {
            const lc = legLiveCount(leg.id, counts);
            return (
            <div key={leg.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <div class="flex items-center gap-2">
                <Landmark size={14} class="text-[var(--color-text-faint)]" />
                <span class="text-[13px] font-medium">{leg.displayName}</span>
                {leg.canAlert && <AlertCircle size={12} class="text-[var(--color-text-faint)]" />}
                <span class={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${statusClass(leg.status)}`}>
                  {leg.status}
                </span>
              </div>
              {lc !== null ? (
                <div class="text-[18px] font-semibold tabular-nums mt-2">{lc}</div>
              ) : (
                <div class="text-[12px] text-[var(--color-text-faint)] mt-2">No live count yet</div>
              )}
              <div class="text-[11px] text-[var(--color-text-muted)] mt-0.5">{leg.summaryMetricLabel}</div>
              {leg.dashboardRoute && (
                <div class="text-[10px] text-[var(--color-text-faint)] mt-2 font-mono truncate">{leg.dashboardRoute}</div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Exit strategy lanes + performance trends shells */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Exit Strategy Lanes</div>
          <div class="text-[12px] text-[var(--color-text-muted)] mt-1">Quick flip · Subdivide · Land-home · Value-add · Pass. Not populated yet.</div>
        </div>
        <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Performance Trends</div>
          <div class="text-[12px] text-[var(--color-text-muted)] mt-1">Trend charts will appear here. Not captured yet.</div>
        </div>
      </div>
    </div>
  );
}
