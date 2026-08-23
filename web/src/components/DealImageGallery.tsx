import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export interface DealImageItem {
  id: string;
  label: string;
  sourceType: string;
  sourceUrl: string | null;
  viewUrl: string | null;
  retrievedAt: string | null;
  supports?: string;
}

function tokenized(url: string | null): string | null {
  if (!url) return null;
  return url;
}

function heroScore(item: DealImageItem): number {
  const text = `${item.label} ${item.sourceType} ${item.supports ?? ''}`.toLowerCase();
  let score = 0;
  if (/hero/.test(text)) score += 100;
  // The primary hero is the clean default LandPortal satellite framing of the
  // full parcel with its immediate context (close parcel aerial / parcel
  // context). The road-frontage aerial is the strong second.
  if (/close.?parcel.?aerial|parcel.?context/.test(text)) score += 120;
  if (/road.?frontage.?aerial|frontage.?aerial/.test(text)) score += 100;
  if (/parcel|boundary/.test(text)) score += 40;
  if (/aerial|satellite/.test(text)) score += 30;
  if (/frontage|road/.test(text)) score += 18;
  if (/subject/.test(text)) score += 12;
  if (/comp map|soil|wetland|fema|contour/.test(text)) score -= 18;
  return score;
}

function orderedImages(items: DealImageItem[]): DealImageItem[] {
  return items
    .filter((item) => Boolean(item.viewUrl))
    .map((item, index) => ({ item, index, score: heroScore(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

export function DealImageGallery({
  items,
  title,
  mode = 'gallery',
}: {
  items: DealImageItem[];
  title: string;
  mode?: 'hero' | 'gallery';
}) {
  const visuals = useMemo(() => orderedImages(items), [items]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const selected = visuals[index] ?? null;

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };
  const select = (next: number) => {
    if (!visuals.length) return;
    setIndex((next + visuals.length) % visuals.length);
    resetView();
  };
  const launch = (next: number, event: Event) => {
    opener.current = event.currentTarget as HTMLElement;
    setIndex(next);
    resetView();
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    resetView();
    window.setTimeout(() => opener.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return undefined;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowLeft' && visuals.length > 1) {
        event.preventDefault();
        select(index - 1);
      } else if (event.key === 'ArrowRight' && visuals.length > 1) {
        event.preventDefault();
        select(index + 1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setScale((value) => Math.min(5, value + 0.25));
      } else if (event.key === '-') {
        event.preventDefault();
        setScale((value) => Math.max(1, value - 0.25));
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, index, visuals.length]);

  if (!visuals.length) {
    return (
      <div class={`${mode === 'hero' ? 'min-h-[360px]' : 'min-h-[220px]'} flex items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-elevated)] p-6 text-center`}>
        <div>
          <div class="text-[13px] font-semibold text-[var(--color-text)]">Property imagery is not available yet</div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">Clean parcel, aerial, terrain, soil, and street-level captures will appear here when retained.</div>
        </div>
      </div>
    );
  }

  const primary = visuals[0];
  const supporting = visuals.slice(1, mode === 'hero' ? 4 : visuals.length);

  return (
    <>
      {mode === 'hero' ? (
        <div class="grid min-w-0 gap-3">
          <button
            type="button"
            onClick={(event) => launch(0, event)}
            aria-label={`Open full-screen image: ${primary.label}`}
            class="group relative block min-h-[360px] w-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-elevated)] text-left shadow-lg sm:min-h-[430px]"
          >
            <img src={tokenized(primary.viewUrl)!} alt={primary.label} class="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]" />
            <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/10" />
            <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white sm:p-5">
              <div class="min-w-0">
                <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Property overview</div>
                <div class="mt-1 text-[15px] font-semibold leading-snug">{primary.label}</div>
                <div class="mt-1 text-[10px] text-white/70">{primary.sourceType}{primary.retrievedAt ? ` · ${primary.retrievedAt.slice(0, 10)}` : ''}</div>
              </div>
              <span class="shrink-0 rounded-full border border-white/40 bg-black/35 px-3 py-1.5 text-[10px] font-semibold backdrop-blur">View full screen</span>
            </div>
          </button>
          {supporting.length > 0 && (
            <div class="grid gap-3 sm:grid-cols-3">
              {supporting.map((item, supportIndex) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={(event) => launch(supportIndex + 1, event)}
                  class="group min-w-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-left shadow-sm hover:border-[var(--color-accent)]"
                >
                  <img src={tokenized(item.viewUrl)!} alt={item.label} loading="lazy" class="h-32 w-full object-cover transition group-hover:scale-[1.02] sm:h-36" />
                  <div class="min-w-0 p-2.5">
                    <div class="line-clamp-2 text-[10.5px] font-semibold leading-snug text-[var(--color-text)]">{item.label}</div>
                    <div class="mt-1 text-[9.5px] text-[var(--color-text-faint)]">{item.sourceType}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div class="grid gap-3 md:grid-cols-2">
          {visuals.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              onClick={(event) => launch(itemIndex, event)}
              aria-label={`Open full-screen image: ${item.label}`}
              class="group min-w-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-left shadow-sm hover:border-[var(--color-accent)]"
            >
              <img src={tokenized(item.viewUrl)!} alt={item.label} loading="lazy" class="h-56 w-full object-cover transition group-hover:scale-[1.015] xl:h-72" />
              <div class="flex items-start justify-between gap-3 p-3">
                <div class="min-w-0">
                  <div class="break-words text-[11.5px] font-semibold leading-snug text-[var(--color-text)]">{item.label}</div>
                  <div class="mt-1 text-[10px] text-[var(--color-text-faint)]">{item.sourceType}{item.retrievedAt ? ` · ${item.retrievedAt.slice(0, 10)}` : ''}</div>
                </div>
                <span class="shrink-0 text-[10px] font-semibold text-[var(--color-accent)]">Expand</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && selected && (
        <div role="dialog" aria-modal="true" aria-label={`${title} image viewer`} class="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white">
          <div class="flex flex-wrap items-center gap-2 border-b border-white/15 bg-black/75 px-3 py-2.5 sm:px-5">
            <div class="min-w-[180px] flex-1">
              <div class="break-words text-[12px] font-semibold sm:text-[13px]">{selected.label}</div>
              <div class="mt-0.5 text-[10px] text-white/60">{index + 1} of {visuals.length} · {selected.sourceType}</div>
            </div>
            <button type="button" aria-label="Zoom out" disabled={scale <= 1} onClick={() => setScale((value) => Math.max(1, value - 0.25))} class="rounded-lg border border-white/25 px-3 py-2 text-[12px] disabled:opacity-35">−</button>
            <span class="w-12 text-center text-[11px] tabular-nums">{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="Zoom in" disabled={scale >= 5} onClick={() => setScale((value) => Math.min(5, value + 0.25))} class="rounded-lg border border-white/25 px-3 py-2 text-[12px] disabled:opacity-35">+</button>
            <button type="button" onClick={resetView} class="rounded-lg border border-white/25 px-3 py-2 text-[11px] font-semibold">Fit</button>
            {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" class="rounded-lg border border-white/25 px-3 py-2 text-[11px] font-semibold">Source ↗</a>}
            <button
              ref={closeButton}
              type="button"
              aria-label="Close image viewer"
              onClick={close}
              class="rounded-lg border border-white/30 bg-white px-3 py-2 text-[11px] font-bold"
              style={{ color: '#111827' }}
            >
              Close ✕
            </button>
          </div>
          <div
            class={`relative min-h-0 flex-1 overflow-hidden touch-none ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onPointerDown={(event) => {
              drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current || scale <= 1) return;
              setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onWheel={(event) => {
              event.preventDefault();
              setScale((value) => Math.max(1, Math.min(5, value + (event.deltaY < 0 ? 0.2 : -0.2))));
            }}
          >
            <img
              src={tokenized(selected.viewUrl)!}
              alt={selected.label}
              draggable={false}
              class="h-full w-full select-none object-contain"
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            />
            {visuals.length > 1 && (
              <>
                <button type="button" aria-label="Previous image" onClick={() => select(index - 1)} class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/60 px-4 py-3 text-2xl backdrop-blur sm:left-5">‹</button>
                <button type="button" aria-label="Next image" onClick={() => select(index + 1)} class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/60 px-4 py-3 text-2xl backdrop-blur sm:right-5">›</button>
              </>
            )}
          </div>
          <div class="border-t border-white/10 px-4 py-2 text-center text-[9.5px] text-white/55">
            Scroll or +/− to zoom · drag to pan · arrow keys to browse · Esc to close
          </div>
        </div>
      )}
    </>
  );
}
