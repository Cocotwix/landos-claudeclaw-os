import { useState } from 'preact/hooks';
import { Trash2 } from 'lucide-preact';
import { apiDelete } from '@/lib/api';

// One shared manual-delete control for every surface that renders a Deal Card
// (pipeline board, Deal Library rows and header, Lead Workspace). Delete is the
// existing SOFT delete: the card moves to Deal Library -> Trash with its
// research, evidence, and documents preserved, and stays restorable. Nothing
// here purges data.
//
// Two-step by design: the first click arms the control, the second commits, so
// a stray click on a dense board can never drop a lead. Card surfaces often
// make the whole row/body clickable, so every handler stops propagation to keep
// the delete from also opening the card.

type Variant = 'icon' | 'labelled';

export function TrashCardButton({
  dealCardId,
  title,
  variant = 'icon',
  disabled = false,
  label: labelText = 'Delete',
  testId = 'deal-card-trash-action',
  confirmTestId = 'deal-card-trash-confirm',
  onDeleted,
  onError,
}: {
  dealCardId: number;
  title?: string;
  variant?: Variant;
  disabled?: boolean;
  /** Visible text for the `labelled` variant. Ignored by the icon variant. */
  label?: string;
  /** Surfaces with an existing QA contract keep their established test ids. */
  testId?: string;
  confirmTestId?: string;
  onDeleted?: (dealCardId: number) => void;
  onError?: (message: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = title ? `Move ${title} to Trash` : 'Move this Deal Card to Trash';

  function stop(event: Event) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function commit(event: Event) {
    stop(event);
    if (busy) return;
    setBusy(true);
    try {
      await apiDelete(`/api/landos/deal-cards/${dealCardId}`);
      setArmed(false);
      onDeleted?.(dealCardId);
    } catch (err) {
      onError?.(`Could not move this Deal Card to Trash: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (armed) {
    return (
      <span data-testid="deal-card-trash-confirm-row" class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-status-failed)] bg-[color-mix(in_srgb,var(--color-status-failed)_10%,transparent)] px-1.5 py-0.5">
        <span class="text-[10.5px] font-semibold text-[var(--color-status-failed)]">Move to Trash?</span>
        <button
          type="button"
          data-testid={confirmTestId}
          disabled={busy}
          onClick={(event) => void commit(event)}
          class="rounded bg-[var(--color-status-failed)] px-1.5 py-0.5 text-[10.5px] font-semibold text-white disabled:opacity-45"
        >
          {busy ? 'Moving…' : 'Yes'}
        </button>
        <button
          type="button"
          data-testid="deal-card-trash-cancel"
          disabled={busy}
          onClick={(event) => { stop(event); setArmed(false); }}
          class="text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={(event) => { stop(event); setArmed(true); }}
      class={
        variant === 'labelled'
          ? 'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-status-failed)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-status-failed)] hover:bg-[color-mix(in_srgb,var(--color-status-failed)_10%,transparent)] disabled:opacity-40'
          : 'inline-flex items-center justify-center rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] hover:text-[var(--color-status-failed)] disabled:opacity-40'
      }
    >
      <Trash2 size={variant === 'labelled' ? 14 : 13} />
      {variant === 'labelled' ? labelText : null}
    </button>
  );
}
