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

function statusClass(status: LegStatus): string {
  if (status === 'active') return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
  if (status === 'shell') return 'text-[var(--color-text-muted)] border-[var(--color-border)]';
  return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
}

export function CommandHome({ onOpenDealCards }: { onOpenDealCards?: () => void }) {
  const [, setLocation] = useLocation();
  const [legs, setLegs] = useState<LegTile[] | null>(null);
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
          <FileText size={13} /> Deal Cards
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

      {/* Department leg status tiles — the real, data-driven section */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Department Legs</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(legs ?? []).map((leg) => (
            <div key={leg.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <div class="flex items-center gap-2">
                <Landmark size={14} class="text-[var(--color-text-faint)]" />
                <span class="text-[13px] font-medium">{leg.displayName}</span>
                {leg.canAlert && <AlertCircle size={12} class="text-[var(--color-text-faint)]" />}
                <span class={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${statusClass(leg.status)}`}>
                  {leg.status}
                </span>
              </div>
              <div class="text-[18px] font-semibold tabular-nums mt-2">—</div>
              <div class="text-[11px] text-[var(--color-text-muted)] mt-0.5">{leg.summaryMetricLabel}</div>
              {leg.dashboardRoute && (
                <div class="text-[10px] text-[var(--color-text-faint)] mt-2 font-mono truncate">{leg.dashboardRoute}</div>
              )}
            </div>
          ))}
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
