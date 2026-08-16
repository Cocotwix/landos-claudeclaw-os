// Tiny formatters used across pages.

// Accepts unix SECONDS (number), unix MILLISECONDS, or an ISO/parseable date
// string. Never emits "NaN… ago" — invalid input returns "—".
export function formatRelativeTime(input: number | string | null | undefined): string {
  let unixSeconds: number;
  if (typeof input === 'number') unixSeconds = input;
  else if (typeof input === 'string' && input.trim()) {
    const n = Number(input);
    unixSeconds = Number.isFinite(n) ? n : Date.parse(input) / 1000;
  } else return '—';
  if (!Number.isFinite(unixSeconds)) return '—';
  if (unixSeconds > 1e12) unixSeconds = unixSeconds / 1000; // milliseconds → seconds
  const now = Date.now() / 1000;
  const diff = now - unixSeconds;
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60) return Math.max(0, Math.floor(diff)) + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  if (diff < 86400 * 30) return Math.floor(diff / 86400 / 7) + 'w ago';
  if (diff < 86400 * 365) return Math.floor(diff / 86400 / 30) + 'mo ago';
  return Math.floor(diff / 86400 / 365) + 'y ago';
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return (seconds / 3600).toFixed(1) + 'h';
  return (seconds / 86400).toFixed(1) + 'd';
}

export function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(2);
}

// A section citation, ready to print.
//
// LandOS stores the citation VERBATIM — whatever the document prints above the
// rule. Most publish a bare number ("4 - 110.2"), some print the word
// ("Section 6 - 108"), a few print the sign itself. Every surface then added its
// own "§ ", which read back as "§ Section 6 - 108": LandOS labelling the
// document's own label. The marker is added only when the citation does not
// already carry one, so what the operator sees is the reference as published.
const SECTION_MARKER = /^\s*(?:§|sec\b|sec\.|sections?\b|art\b|art\.|articles?\b|chapters?\b|ch\.|titles?\b|parts?\b|rules?\b)/i;

export function sectionCitationLabel(citation: string | null | undefined): string {
  const text = (citation ?? '').trim();
  if (!text) return '';
  return SECTION_MARKER.test(text) ? text : `§ ${text}`;
}

// Try to JSON.parse, fall back to empty array. Memory rows return tags as
// JSON-encoded strings (per the contract notes in the ecosystem TLDR).
export function safeJsonArray<T = unknown>(s: string | null | undefined): T[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
