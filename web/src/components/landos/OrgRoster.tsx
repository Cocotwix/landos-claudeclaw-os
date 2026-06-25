import { useEffect, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { PageState } from '@/components/PageState';

// LandOS Org / Agents view — represents the operating system structure:
// Executive Agent (orchestrator) -> 14-agent department roster -> the Discovery
// workflow. Read-only metadata from /api/landos/org. No secrets, no model calls.
// LandOS is the OS; Duke is the Due Diligence Specialist lane, not the center.

type Group = 'orchestrator' | 'acquisitions' | 'operations' | 'intelligence';

interface RosterAgent {
  key: string; name: string; group: Group; role: string;
  defaultTier: string; attachment: 'property' | 'business' | 'conditional';
  status: 'active' | 'scaffold' | 'planned'; orchestrator?: boolean; implemented: boolean;
}
interface OrgResponse {
  executive: { key: string; name: string; role: string };
  roster: RosterAgent[];
  groups: Record<Group, string[]>;
  workflow: { primary: string[]; alternate: string[] };
}

const GROUP_LABEL: Record<Group, string> = {
  orchestrator: 'Orchestrator',
  acquisitions: 'Acquisitions Pipeline',
  operations: 'Operations & Dispositions',
  intelligence: 'Intelligence & Research',
};

function statusClass(s: RosterAgent['status']): string {
  if (s === 'active') return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
  if (s === 'scaffold') return 'text-[var(--color-text-muted)] border-[var(--color-border)]';
  return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
}
function attachLabel(a: RosterAgent['attachment']): string {
  return a === 'property' ? 'Deal Card output' : a === 'conditional' ? 'Deal Card if property-scoped' : 'Knowledge layer (not Deal Card)';
}

export function OrgRoster() {
  const [org, setOrg] = useState<OrgResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiGet<OrgResponse>('/api/landos/org');
        if (alive) setOrg(res);
      } catch (err: any) {
        if (alive) setError(err?.message || String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <PageState error={error} />;
  if (loading && !org) return <PageState loading />;
  if (!org) return null;

  const byKey = (k: string) => org.roster.find((a) => a.key === k)!;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      {/* Executive Agent */}
      <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4">
        <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Executive Agent — Orchestrator</div>
        <div class="text-[14px] font-semibold mt-0.5">{org.executive.name}</div>
        <div class="text-[12px] text-[var(--color-text-muted)] mt-1">{org.executive.role}</div>
        <div class="text-[10px] text-[var(--color-text-faint)] mt-1">Single point of contact → routes to a department → returns the result.</div>
      </div>

      {/* Workflow */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Discovery Workflow</h2>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-1">
          <div class="text-[12px] text-[var(--color-text)]">{org.workflow.primary.join('  →  ')}</div>
          <div class="text-[11px] text-[var(--color-text-faint)]">alternate: {org.workflow.alternate.join('  →  ')}</div>
        </div>
      </div>

      {/* Department roster, grouped */}
      {(['acquisitions', 'operations', 'intelligence'] as Group[]).map((g) => (
        <div key={g}>
          <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">{GROUP_LABEL[g]}</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {org.groups[g].map((k) => {
              const a = byKey(k);
              return (
                <div key={k} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[13px] font-medium">{a.name}</span>
                    <span class="text-[10px] font-mono text-[var(--color-text-faint)]">{a.key}</span>
                    <span class={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${statusClass(a.status)}`}>{a.status}</span>
                  </div>
                  <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{a.role}</div>
                  <div class="text-[10px] text-[var(--color-text-faint)] mt-2 flex flex-wrap gap-x-3">
                    <span>tier: {a.defaultTier.replace('tier', 'T')}</span>
                    <span>{attachLabel(a.attachment)}</span>
                    <span>{a.implemented ? 'wired' : 'scaffold'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
