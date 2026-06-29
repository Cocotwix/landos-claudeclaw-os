import { useEffect, useRef, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { useDebouncedValue } from '@/lib/useDebounce';

// SmartIntake — the Universal LandOS intake input. As the operator types an
// address / partial address / APN / owner, it suggests normalized matches from
// FREE/open providers (Photon, US Census) via /api/landos/address/suggest. The
// operator can pick a suggestion (keyboard or click) or submit the raw text as
// typed. This is the permanent intake surface; today it feeds Property
// Resolution. Suggestions are a SEARCH aid only — parcel identity is still
// established by named sources downstream, never by a suggestion's coordinates.

const MIN_CHARS = 3;
const DEBOUNCE_MS = 220;

interface Suggestion {
  label: string;
  line1?: string; city?: string; state?: string; zip?: string; county?: string;
  source: string; confidence: number;
}
interface SuggestResponse { query: string; suggestions: Suggestion[]; source: string; cached: boolean; note?: string }

// Per-session cache so re-typing the same prefix doesn't refetch.
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
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // True right after the operator selects/submits, to suppress an immediate refetch.
  const justChosen = useRef(false);
  const debounced = useDebouncedValue(value, DEBOUNCE_MS);

  useEffect(() => {
    const q = debounced.trim();
    if (justChosen.current) { justChosen.current = false; return; }
    if (q.length < MIN_CHARS) { setSuggestions([]); setOpen(false); setNote(null); return; }
    const cached = sessionCache.get(q.toLowerCase());
    if (cached) { setSuggestions(cached.suggestions); setNote(cached.note ?? null); setOpen(cached.suggestions.length > 0); setActive(-1); return; }
    let cancelled = false;
    setLoading(true);
    apiGet<SuggestResponse>(`/api/landos/address/suggest?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (cancelled) return;
        sessionCache.set(q.toLowerCase(), res);
        setSuggestions(res.suggestions);
        setNote(res.note ?? null);
        setOpen(res.suggestions.length > 0);
        setActive(-1);
      })
      .catch(() => { if (!cancelled) { setSuggestions([]); setOpen(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  function choose(s: Suggestion) {
    justChosen.current = true;
    onInput(s.label);
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (open && suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); return; }
      if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(suggestions[active]); return; }
      if (e.key === 'Escape') { setOpen(false); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      justChosen.current = true;
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
        placeholder={placeholder ?? 'Address, partial address, APN, or owner + county. Pick a suggestion or submit as typed. County/FIPS is resolved internally — identity is verified from named sources, never a suggestion’s coordinates.'}
        class="w-full h-20 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px] text-[var(--color-text)]"
      />
      {loading && <div class="absolute right-2 top-2 text-[10px] text-[var(--color-text-faint)]">searching…</div>}
      {open && suggestions.length > 0 && (
        <ul class="absolute z-20 left-0 right-0 mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg max-h-56 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li
              key={s.label + i}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              onMouseEnter={() => setActive(i)}
              class={`px-3 py-2 cursor-pointer text-[12px] ${i === active ? 'bg-[var(--color-elevated)]' : ''}`}
            >
              <div class="text-[var(--color-text)]">{s.label}</div>
              <div class="text-[10px] text-[var(--color-text-faint)]">
                {[s.county && `${s.county} County`, s.source].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && !suggestions.length && value.trim().length >= MIN_CHARS && (
        <div class="mt-1 text-[10px] text-[var(--color-text-faint)]">{note}</div>
      )}
    </div>
  );
}
