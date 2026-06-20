import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, Check } from 'lucide-preact';

// Registry-driven, facts-only model picker for the LandOS neutral model system.
// It lists ALL registered models with their OBJECTIVE facts (runtime, open/
// closed source, cost_per_token, availability) — no ranking, no "best" label.
// Selecting a model sets a sticky override for the scope; "Reset to suggestion"
// clears it. Data comes from /api/landos/models; this component renders props
// only (it is intentionally NOT placed on any surface yet — that is D/E).

export interface LandModelEntry {
  id: string;
  provider: string;
  runtime: 'local' | 'cloud';
  open_source: boolean;
  cost_per_token: number;
  availability: 'available' | 'not_available';
}

interface Props {
  /** All registered models (registry facts from /api/landos/models). */
  models: LandModelEntry[];
  /** Effective model id (sticky override if set, else the suggestion). */
  value?: string | null;
  /** Facts-based suggested model id. */
  suggestionId?: string | null;
  /** Factual reason for the suggestion (no quality words). */
  reason?: string;
  /** Whether the current value is a sticky user override. */
  isOverride?: boolean;
  /** Set a sticky override for this scope. */
  onSelect: (modelId: string) => void;
  /** Reset to suggestion (clears the sticky override). */
  onReset?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

function facts(m: LandModelEntry): string {
  const src = m.open_source ? 'open-source' : 'closed-source';
  const cost = m.cost_per_token === 0 ? '$0/token' : `$${m.cost_per_token}/token`;
  return `${m.provider} · ${m.runtime} · ${src} · ${cost}`;
}

export function LandModelPicker({
  models,
  value,
  suggestionId,
  reason,
  isOverride,
  onSelect,
  onReset,
  disabled,
  size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const padCls = size === 'md' ? 'px-2.5 py-1.5 text-[12px]' : 'px-1.5 py-0.5 text-[10px]';

  return (
    <div ref={ref} class="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        class={[
          'inline-flex items-center gap-1 rounded font-medium border transition-colors',
          padCls,
          disabled
            ? 'bg-[var(--color-elevated)] text-[var(--color-text-faint)] border-[var(--color-border)] cursor-not-allowed'
            : 'bg-[var(--color-elevated)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
        ].join(' ')}
      >
        {current?.id || value || 'default'}
        {isOverride && <span class="text-[var(--color-accent)]">·override</span>}
        {!disabled && <ChevronDown size={size === 'md' ? 12 : 10} />}
      </button>
      {open && (
        <div
          class="absolute top-full left-0 mt-1 z-30 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden min-w-[260px]"
          onClick={(e) => e.stopPropagation()}
        >
          {(suggestionId || reason) && (
            <div class="px-3 py-1.5 border-b border-[var(--color-border)] text-[10px] text-[var(--color-text-faint)]">
              Suggested: <span class="text-[var(--color-text-muted)]">{suggestionId || 'none'}</span>
              {reason && <div class="mt-0.5 leading-snug">{reason}</div>}
            </div>
          )}
          {models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { onSelect(m.id); setOpen(false); }}
              class="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-elevated)] transition-colors"
            >
              <span class="flex-1">
                <span class="text-[12px] text-[var(--color-text)]">{m.id}</span>
                <span class="block text-[10px] text-[var(--color-text-faint)]">
                  {facts(m)}
                  {m.availability === 'not_available' && ' · not wired'}
                </span>
              </span>
              {m.id === value && <Check size={12} class="mt-0.5 text-[var(--color-accent)]" />}
            </button>
          ))}
          {isOverride && onReset && (
            <button
              type="button"
              onClick={() => { onReset(); setOpen(false); }}
              class="w-full px-3 py-1.5 text-left text-[11px] text-[var(--color-text-muted)] border-t border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors"
            >
              Reset to suggestion
            </button>
          )}
        </div>
      )}
    </div>
  );
}
