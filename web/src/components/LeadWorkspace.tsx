import { useEffect, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';

type RecordValue = Record<string, unknown>;

interface LeadWorkspacePayload {
  contract: { version: string };
  lead: RecordValue;
  property: RecordValue;
  seller: RecordValue;
  market: RecordValue;
  strategies: { entries?: unknown[]; summary?: unknown; pricingAllowed?: boolean; pricingBlockers?: unknown[] };
  evidence: RecordValue;
  work: RecordValue;
  readiness: RecordValue;
}

const asRecord = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function Value({ value, fallback = 'Unavailable' }: { value: unknown; fallback?: string }) {
  if (value === null || value === undefined || value === '') return <span class="text-[var(--color-text-muted)]">{fallback}</span>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return <>{String(value)}</>;
  return <pre class="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-[var(--color-text-muted)]">{JSON.stringify(value, null, 2)}</pre>;
}

function Disclosure({ title, children, open = false }: { title: string; children: any; open?: boolean }) {
  return <details open={open} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
    <summary class="cursor-pointer px-4 py-3 text-[14px] font-semibold text-[var(--color-text)]">{title}</summary>
    <div class="border-t border-[var(--color-border)] px-4 py-3 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{children}</div>
  </details>;
}

function List({ items, empty = 'None recorded.', testId }: { items: unknown; empty?: string; testId?: string }) {
  const values = asArray(items);
  if (!values.length) return <p>{empty}</p>;
  return <ul class="space-y-1.5">{values.map((item, index) => <li key={index} data-testid={testId} class="rounded bg-[var(--color-elevated)] px-2.5 py-2"><Value value={item} /></li>)}</ul>;
}

export function LeadWorkspace({ dealCardId }: { dealCardId: number }) {
  const [workspace, setWorkspace] = useState<LeadWorkspacePayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setWorkspace(null);
    setError('');
    apiGet<LeadWorkspacePayload>(`/api/landos/lead-workspace/${dealCardId}`)
      .then((payload) => { if (active) setWorkspace(payload); })
      .catch(() => { if (active) setError('The Lead Workspace could not be loaded.'); });
    return () => { active = false; };
  }, [dealCardId]);

  if (error) return <div class="flex-1 p-6 text-[13px] text-red-600">{error}</div>;
  if (!workspace) return <div class="flex-1 p-6 text-[13px] text-[var(--color-text-muted)]">Loading Lead Workspaceâ€¦</div>;

  const identity = asRecord(workspace.property.identity);
  const seller = asRecord(workspace.seller);
  const intelligence = asRecord(workspace.property.intelligence);
  const work = asRecord(workspace.work);
  const evidence = asRecord(workspace.evidence);
  const market = asRecord(workspace.market);
  const entries = asArray(workspace.strategies.entries);

  return <div data-testid="lead-workspace-root" class="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
    <div class="mx-auto max-w-7xl space-y-3">
      <header class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <p class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Lead Workspace Â· v{workspace.contract.version}</p>
        <h2 class="mt-1 text-[20px] font-semibold text-[var(--color-text)]"><Value value={workspace.lead.title} fallback="Untitled lead" /></h2>
        <div class="mt-2 grid grid-cols-1 gap-2 text-[12px] text-[var(--color-text-muted)] sm:grid-cols-3">
          <span>Lifecycle: <Value value={workspace.lead.lifecycle} /></span>
          <span>Resolution: <Value value={workspace.property.resolutionState} /></span>
          <span>APN: <Value value={identity.apn} /></span>
        </div>
      </header>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Disclosure title="Identity & resolution" open><Value value={identity} fallback="No canonical identity has been published." /></Disclosure>
        <Disclosure title="Seller ownership & communications" open>
          <p class="mb-2">Owner / contacts</p><List items={seller.people} empty="No seller contacts recorded." />
          <p class="mb-2 mt-3">Seller profile</p><Value value={seller.profile} />
          <p class="mb-2 mt-3">Communications</p><List items={seller.communications} empty="No communications recorded." />
        </Disclosure>
        <Disclosure title="Canonical acreage, research & readiness">
          <p>Acreage basis</p><Value value={workspace.property.canonicalAcreage} />
          <p class="mb-1 mt-3">Research</p><Value value={intelligence.research} />
          <p class="mb-1 mt-3">Readiness</p><Value value={workspace.readiness} />
        </Disclosure>
        <Disclosure title="Market, valuation & comparables">
          <p><Value value={market.summary} fallback="Market context unavailable." /></p>
          <p class="mb-1 mt-3">Market matrix</p><Value value={market.matrix} />
          <p class="mb-1 mt-3">Valuation</p><Value value={market.valuation} />
          <p class="mb-1 mt-3">Comparables</p><Value value={market.comparables} />
        </Disclosure>
        <Disclosure title={`Strategy (${entries.length} canonical entries)`} open>
          <p class="mb-2"><Value value={workspace.strategies.summary} fallback="No strategy summary is available." /></p>
          <List items={entries} testId="lead-workspace-strategy" empty="No canonical strategies were returned." />
          {!workspace.strategies.pricingAllowed && <p class="mt-3 text-amber-700">Pricing is not currently allowed. <Value value={workspace.strategies.pricingBlockers} /></p>}
        </Disclosure>
        <Disclosure title="Evidence & documents">
          <p class="mb-1">Documents</p><Value value={evidence.documents} />
          <p class="mb-1 mt-3">Sources</p><List items={evidence.sources} empty="No sources published." />
        </Disclosure>
        <Disclosure title="Blockers & next action" open>
          <p class="mb-1">Recommended next action</p><Value value={work.recommendedNextAction} />
          <p class="mb-1 mt-3">Blockers</p><List items={work.blockers} empty="No blockers published." />
        </Disclosure>
        <Disclosure title="Agent work & activity">
          <p class="mb-1">Agent work</p><List items={work.agentWork} empty="No agent work published." />
          <p class="mb-1 mt-3">Activity</p><List items={work.activity} empty="No Activity recorded." />
        </Disclosure>
      </div>
    </div>
  </div>;
}
