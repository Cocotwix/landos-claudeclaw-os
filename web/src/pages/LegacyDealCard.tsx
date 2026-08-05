import { DealCard } from '@/components/DealCard';
import { dealWorkspaceHref } from '@/lib/workspace-v2-nav';

// Hidden rollback/comparison route: /legacy/deal/:id renders Deal Card V1
// exactly as it was. It is intentionally absent from all normal operator
// navigation — every normal route opens Acquisition Workspace V2 — and only
// an intentionally typed URL lands here.
export function LegacyDealCard({ id }: { id: string }) {
  const dealCardId = Number(id);
  if (!Number.isInteger(dealCardId) || dealCardId <= 0) {
    return (
      <div class="px-6 py-6 text-[13px] text-[var(--color-text-muted)]">
        This legacy route needs a numeric deal id, e.g. /legacy/deal/81.
      </div>
    );
  }
  return (
    <div class="flex h-full flex-col">
      <div class="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[11.5px] text-[var(--color-text)]">
        Legacy Deal Card V1 — kept for rollback and comparison only. The current workspace for this
        deal is{' '}
        <a class="underline text-[var(--color-accent)]" href={dealWorkspaceHref(dealCardId)}>
          Acquisition Workspace V2
        </a>.
      </div>
      <DealCard dealCardId={dealCardId} entity="all" key={dealCardId} />
    </div>
  );
}
