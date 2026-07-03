import { useEffect, useRef, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { useDebouncedValue } from '@/lib/useDebounce';

// SmartIntake is raw lead intake only. It may show helper hints from free/open
// providers, but submission always uses the operator's exact typed text.

const MIN_CHARS = 3;
const DEBOUNCE_MS = 220;

interface Suggestion {
  label: string;
  line1?: string; city?: string; state?: string; zip?: string; county?: string;
  source: string; confidence: number;
}
interface SuggestResponse { query: string; suggestions: Suggestion[]; source: string; cached: boolean; note?: string }

const sessionCache = new Map<string, SuggestResponse>();

export function SmartIntake({
  value, onInput, onSubmit, placeholder, disabled,
}: {
  value: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const justSubmitted = useRef(false);
  const debounced = useDebouncedValue(value, DEBOUNCE_MS);

  useEffect(() => {
    const q = debounced.trim();
    if (justSubmitted.current) { justSubmitted.current = false; return; }
    if (q.length < MIN_CHARS) { setSuggestions([]); setOpen(false); setNote(null); return; }
    const cached = sessionCache.get(q.toLowerCase());
    if (cached) {
      setSuggestions(cached.suggestions);
      setNote(cached.note ?? null);
      setOpen(cached.suggestions.length > 0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiGet<SuggestResponse>(`/api/landos/address/suggest?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (cancelled) return;
        sessionCache.set(q.toLowerCase(), res);
        setSuggestions(res.suggestions);
        setNote(res.note ?? null);
        setOpen(res.suggestions.length > 0);
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestions([]);
          setOpen(false);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  function onKeyDown(e: KeyboardEvent) {
    if (open && suggestions.length && e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      justSubmitted.current = true;
      setOpen(false);
      onSubmit();
    }
  }

  return (
    <div class="relative">
      <textarea
        value={value}
        onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        placeholder={placeholder ?? 'Address, partial address, APN, or owner + county. Submit the raw lead exactly as typed. Property Resolution handles matching, ambiguity, normalization, and browser fallback.'}
        class="w-full h-20 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"
      />
      {loading && <div class="absolute right-2 top-2 text-[10px] text-[var(--color-text-faint)]">searching...</div>}
      {open && suggestions.length > 0 && (
        <div class="absolute z-20 left-0 right-0 mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg max-h-56 overflow-y-auto">
          <div class="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] border-b border-[var(--color-border)]">
            Helper hints only
          </div>
          <ul>
            {suggestions.map((s, i) => (
              <li key={s.label + i} class="px-3 py-2 text-[12px]">
                <div class="text-[var(--color-text)]">{s.label}</div>
                <div class="text-[10px] text-[var(--color-text-faint)]">
                  {[s.county && `${s.county} County`, s.source].filter(Boolean).join(' - ')}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && !suggestions.length && value.trim().length >= MIN_CHARS && (
        <div class="mt-1 text-[10px] text-[var(--color-text-faint)]">{note}</div>
      )}
    </div>
  );
}
