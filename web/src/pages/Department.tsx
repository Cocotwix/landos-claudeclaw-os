import { Link } from 'wouter-preact';
import type { ComponentChildren } from 'preact';
import { ArrowRight, CircleDot, Clock } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Placeholder } from '@/pages/Placeholder';
import {
  getDepartment,
  DEPARTMENT_STATUS_LABEL,
  type DepartmentDef,
  type DeptStatus,
} from '@/lib/departments';

// The Department workspace. Every business department in the LandOS Vision
// (docs/LANDOS_VISION_AND_ARCHITECTURE.md) renders through here: its purpose,
// the shared company records it owns, the capabilities it provides, and the
// live surfaces that back it today. Operational departments deep-link into the
// real working areas (Property Board, Deal Card, Market Intelligence, Model
// Router). Shell departments describe what will live there without overbuilding.
//
// This is a department workspace, not a tool grid — it speaks business
// language and hides backend/agent/parser detail per the operator-experience
// principle.
export function Department({ slug }: { slug: string }) {
  const dept = getDepartment(slug);
  if (!dept) {
    return (
      <Placeholder
        title="Unknown department"
        description="That department is not part of the LandOS architecture. Use the sidebar or ⌘K to jump somewhere."
        hideRoadmapNote
      />
    );
  }

  const Icon = dept.icon;
  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={dept.label}
        actions={<StatusPill status={dept.status} />}
      />
      <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Purpose + primary question — what this department is for. */}
        <div class="flex items-start gap-3 max-w-3xl">
          <div class="mt-0.5 shrink-0 w-9 h-9 rounded-lg bg-[var(--color-elevated)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)]">
            <Icon size={18} />
          </div>
          <div>
            <p class="text-[14px] text-[var(--color-text)] leading-relaxed">{dept.purpose}</p>
            {dept.primaryQuestion && (
              <p class="text-[12.5px] text-[var(--color-text-muted)] mt-1.5">
                Primary question: <span class="text-[var(--color-text)] italic">“{dept.primaryQuestion}”</span>
              </p>
            )}
          </div>
        </div>

        <Surfaces dept={dept} />

        <TechStack dept={dept} />

        {/* Records + capabilities — the shared company records this department
            enriches and the units of work it provides. */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          <Section title="Business records">
            <div class="flex flex-wrap gap-1.5">
              {dept.records.map((r) => (
                <span
                  key={r}
                  class="inline-flex items-center px-2 py-1 rounded-md text-[11.5px] bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
                >
                  {r}
                </span>
              ))}
            </div>
          </Section>
          <Section title="Capabilities">
            <ul class="space-y-1">
              {dept.capabilities.map((c) => (
                <li key={c} class="flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
                  <CircleDot size={11} class="text-[var(--color-text-faint)] shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {dept.status === 'shell' && dept.surfaces.length === 0 && (
          <div class="max-w-3xl text-[12px] text-[var(--color-text-faint)] border border-dashed border-[var(--color-border)] rounded-lg p-4 leading-relaxed">
            This department is defined in the LandOS architecture and is not built out yet.
            The records and capabilities above describe what will live here. It communicates
            with other departments and enriches shared company records when it comes online.
          </div>
        )}
      </div>
    </div>
  );
}

function Surfaces({ dept }: { dept: DepartmentDef }) {
  if (dept.surfaces.length === 0) return null;
  return (
    <Section title="Workspaces">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {dept.surfaces.map((s) => {
          const inner = (
            <>
              <div class="flex items-center gap-2">
                <span class="text-[13px] font-medium text-[var(--color-text)]">{s.label}</span>
                {s.status === 'planned' ? (
                  <span class="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--color-text-faint)]">
                    <Clock size={10} /> Planned
                  </span>
                ) : (
                  <ArrowRight size={14} class="ml-auto text-[var(--color-text-faint)]" />
                )}
              </div>
              <p class="text-[11.5px] text-[var(--color-text-muted)] mt-1 leading-relaxed">{s.description}</p>
            </>
          );
          const cls =
            'block rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 transition-colors ' +
            (s.status === 'live'
              ? 'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]'
              : 'opacity-70');
          return s.status === 'live' ? (
            <Link key={s.label} href={s.href} class={cls}>{inner}</Link>
          ) : (
            <div key={s.label} class={cls}>{inner}</div>
          );
        })}
      </div>
    </Section>
  );
}

// AI Research owns a visible AI Tech Stack shell: current models, open vs
// closed source, and replacement candidates. Placeholder data until the
// backend tech-stack records are wired.
function TechStack({ dept }: { dept: DepartmentDef }) {
  if (!dept.techStack || dept.techStack.length === 0) return null;
  return (
    <Section title="AI Tech Stack">
      <div class="rounded-lg border border-[var(--color-border)] overflow-hidden max-w-4xl">
        <table class="w-full text-[12px]">
          <thead>
            <tr class="bg-[var(--color-elevated)] text-[var(--color-text-faint)] text-[10.5px] uppercase tracking-wider">
              <th class="text-left font-medium px-3 py-2">Model / Tool</th>
              <th class="text-left font-medium px-3 py-2">Type</th>
              <th class="text-left font-medium px-3 py-2">Role</th>
              <th class="text-left font-medium px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {dept.techStack.map((row) => (
              <tr key={row.name} class="border-t border-[var(--color-border)]">
                <td class="px-3 py-2 text-[var(--color-text)]">{row.name}</td>
                <td class="px-3 py-2 text-[var(--color-text-muted)]">{row.kind}</td>
                <td class="px-3 py-2 text-[var(--color-text-muted)]">{row.role}</td>
                <td class="px-3 py-2 text-[var(--color-text-muted)]">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="text-[11px] text-[var(--color-text-faint)] mt-2">
        Placeholder view. Model router configuration is live under Workspaces above; per-model
        cost and performance records are a follow-up.
      </p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div>
      <h2 class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">{title}</h2>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: DeptStatus }) {
  const tone =
    status === 'operational'
      ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
      : status === 'partial'
      ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
      : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <span class={`text-[10.5px] px-2 py-0.5 rounded-full border ${tone}`}>
      {DEPARTMENT_STATUS_LABEL[status]}
    </span>
  );
}
