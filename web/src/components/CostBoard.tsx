import { useEffect, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { PageState } from '@/components/PageState';
import { ModelControl } from '@/components/ModelControl';

// Cost Control Board: ACTUAL recorded model spend, aggregated by department /
// provider / runtime / model. Numbers only, no quality labels. Reads the
// /api/landos/cost-board aggregation (recorded landos_model_call rows + the
// neutral registry for runtime) — never an estimate or a suggestion. This tab is
// also the model-routing CONFIG HOME: sticky overrides for the two task
// orientations live here next to the spend they drive.

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

interface Row { usd: number; calls: number; }
interface DeptRow extends Row { department: string; }
interface ProvRow extends Row { provider: string; }
interface ModelRow extends Row { modelId: string; }
interface CostBoardResponse {
  totalUsd: number;
  totalCalls: number;
  byRuntime: { local: number; cloud: number; unknown: number };
  byDepartment: DeptRow[];
  byProvider: ProvRow[];
  byModel: ModelRow[];
}

function usd(n: number): string {
  return `$${(Math.round(n * 1e6) / 1e6).toFixed(n < 0.01 ? 6 : 2)}`;
}

export function CostBoard({ entity }: { entity: EntityFilter }) {
  const [data, setData] = useState<CostBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet<CostBoardResponse>('/api/landos/cost-board');
      setData(res);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Model routing config home — point-of-action pickers for the two orientations. */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
        <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Model routing (sticky overrides)</div>
        <div class="text-[10px] text-[var(--color-text-faint)]">Resolution order: override &gt; suggestion &gt; configured default. Selecting a model sets a sticky override for that scope.</div>
        <div class="flex flex-col gap-2 mt-1">
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="summarization" taskType="summarization" orientation="task_oriented" label="Task-oriented work" size="md" />
          <ModelControl entity={entity} scopeKind="task_type" scopeKey="strategy_reasoning" taskType="strategy_reasoning" orientation="reasoning_oriented" label="Reasoning-oriented work" size="md" />
        </div>
      </div>

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}

      {data && (
        <>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi label="Total spend" value={usd(data.totalUsd)} />
            <Kpi label="Model calls" value={String(data.totalCalls)} />
            <Kpi label="Local runtime" value={usd(data.byRuntime.local)} />
            <Kpi label="Cloud runtime" value={usd(data.byRuntime.cloud)} />
            <Kpi label="Unattributed runtime" value={usd(data.byRuntime.unknown)} />
          </div>

          <Table title="By department" rows={data.byDepartment.map((r) => ({ key: r.department, usd: r.usd, calls: r.calls }))} keyLabel="Department" />
          <Table title="By provider" rows={data.byProvider.map((r) => ({ key: r.provider, usd: r.usd, calls: r.calls }))} keyLabel="Provider" />
          <Table title="By model" rows={data.byModel.map((r) => ({ key: r.modelId, usd: r.usd, calls: r.calls }))} keyLabel="Model" />

          {data.totalCalls === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
              No model spend recorded yet. The board fills in as models actually run — it records the model that ran, never a suggestion, and never a fabricated number.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      <div class="text-[18px] font-semibold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function Table({ title, rows, keyLabel }: { title: string; rows: Array<{ key: string; usd: number; calls: number }>; keyLabel: string }) {
  return (
    <div>
      <h3 class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">{title}</h3>
      {rows.length === 0 ? (
        <div class="text-[11px] text-[var(--color-text-faint)]">No rows yet</div>
      ) : (
        <div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div class="grid grid-cols-3 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] bg-[var(--color-elevated)] px-3 py-1.5">
            <span>{keyLabel}</span><span class="text-right">Spend</span><span class="text-right">Calls</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} class="grid grid-cols-3 px-3 py-1.5 text-[12px] border-t border-[var(--color-border)]">
              <span class="text-[var(--color-text)] truncate">{r.key}</span>
              <span class="text-right tabular-nums">{usd(r.usd)}</span>
              <span class="text-right tabular-nums">{r.calls}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
