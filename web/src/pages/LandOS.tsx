import { useEffect, useState } from 'preact/hooks';
import { Check, X, Landmark } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

interface Approval {
  id: number;
  entity: string | null;
  action_type: string;
  title: string;
  requested_by: string;
  status: string;
  created_at: number;
}

interface DepartmentAgent {
  agentId: string;
  name: string;
  role: string;
  status: 'active' | 'planned';
}

interface Department {
  id: string;
  label: string;
  status: 'active' | 'planned';
  description: string;
  agents: DepartmentAgent[];
}

interface Overview {
  entity: string | null;
  counts: Record<string, number>;
  pendingApprovals: number;
  modelCostUsd: number;
  costRecordsUsd: number;
  departments: Department[];
  pendingApprovalList: Approval[];
}

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

// Module sections of the OS spine. count keys map to getOverview() output.
const SECTIONS: Array<{ label: string; keys: string[]; hint: string }> = [
  { label: 'Leads',             keys: ['lead'],                       hint: 'Pipeline intake' },
  { label: 'Deals',             keys: ['deal'],                       hint: 'Active and historical deals' },
  { label: 'Due Diligence',     keys: ['parcel', 'fact'],             hint: 'Parcels + labeled facts' },
  { label: 'Sellers & Contacts', keys: ['seller', 'contact'],         hint: 'People records' },
  { label: 'Tasks',             keys: ['task'],                       hint: 'Open work items' },
  { label: 'Rules',             keys: ['rule'],                       hint: 'Draft / approved / deprecated / experimental' },
  { label: 'Playbooks',         keys: ['playbook'],                   hint: 'Training lifecycle registry' },
  { label: 'Research Queue',    keys: ['research_item'],              hint: 'Market / industry / AI change' },
  { label: 'Security Reviews',  keys: ['security_review'],            hint: 'Repo / package / MCP reviews' },
  { label: 'Agent Runs',        keys: ['agent_run'],                  hint: 'Workflow telemetry' },
  { label: 'Audit Log',         keys: ['audit_log'],                  hint: 'Every gated action and decision' },
];

export function LandOS() {
  const [entity, setEntity] = useState<EntityFilter>('all');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const overview = await apiGet<Overview>(`/api/landos/overview?entity=${entity}`);
      setData(overview);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [entity]);

  async function decide(id: number, action: 'approve' | 'reject') {
    try {
      setBusyId(id);
      await apiPost(`/api/landos/approvals/${id}/${action}`, { decidedBy: 'tyler' });
      await load();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  }

  const counts = data?.counts ?? {};
  const sum = (keys: string[]) => keys.reduce((s, k) => s + (counts[k] ?? 0), 0);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="LandOS"
        actions={
          <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            {data ? `${data.pendingApprovals} pending approval${data.pendingApprovals === 1 ? '' : 's'}` : ''}
          </span>
        }
        tabs={
          <>
            <Tab label="All entities" active={entity === 'all'} onClick={() => setEntity('all')} />
            <Tab label="Land Ally" active={entity === 'LAND_ALLY'} onClick={() => setEntity('LAND_ALLY')} />
            <Tab label="Ty's Land Biz" active={entity === 'TY_LAND_BIZ'} onClick={() => setEntity('TY_LAND_BIZ')} />
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}

      {data && (
        <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Module section cards */}
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {SECTIONS.map((s) => (
              <div key={s.label} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">{s.label}</div>
                <div class="text-xl font-semibold tabular-nums mt-1">{sum(s.keys)}</div>
                <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{s.hint}</div>
              </div>
            ))}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Model Costs</div>
              <div class="text-xl font-semibold tabular-nums mt-1">
                ${(data.modelCostUsd + data.costRecordsUsd).toFixed(2)}
              </div>
              <div class="text-[11px] text-[var(--color-text-muted)] mt-1">
                {counts.model_call ?? 0} model calls · {counts.cost_record ?? 0} cost records
              </div>
            </div>
          </div>

          {/* Approvals — the central gate */}
          <div>
            <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
              Pending Approvals
            </h2>
            {data.pendingApprovalList.length === 0 ? (
              <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
                No gated actions waiting. Gated actions (seller messages, paid credits, offers, deletions,
                installs, config changes, exports, external connections) appear here and block until decided.
              </div>
            ) : (
              <div class="space-y-2">
                {data.pendingApprovalList.map((a) => (
                  <div key={a.id} class="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2">
                    <div class="flex-1 min-w-0">
                      <div class="text-[12px] text-[var(--color-text)] truncate">{a.title}</div>
                      <div class="text-[11px] text-[var(--color-text-muted)] font-mono">
                        {a.action_type}{a.entity ? ` · ${a.entity}` : ''} · {a.requested_by} · {formatRelativeTime(a.created_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => decide(a.id, 'approve')}
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-[var(--color-status-done)] border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                    >
                      <Check size={12} /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => decide(a.id, 'reject')}
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-[var(--color-status-failed)] border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                    >
                      <X size={12} /> Reject
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Department registry */}
          <div>
            <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
              Departments
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.departments.map((d) => (
                <div key={d.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div class="flex items-center gap-2">
                    <Landmark size={14} class="text-[var(--color-text-faint)]" />
                    <span class="text-[13px] font-medium">{d.label}</span>
                    <span
                      class={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${
                        d.status === 'active'
                          ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
                          : 'text-[var(--color-text-faint)] border-[var(--color-border)]'
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>
                  <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{d.description}</div>
                  {d.agents.length > 0 && (
                    <div class="text-[11px] text-[var(--color-text-faint)] mt-2">
                      {d.agents.map((ag) => `${ag.name} (${ag.status})`).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
