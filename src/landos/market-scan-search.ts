// LandOS — the market-scan search transport.
//
// The Market Scan used to have exactly one way to reach the web: Gemini
// grounded search. When that key is absent, quota-limited, or simply returns
// nothing for a rural county, the whole growth-signal and data-center lane
// reported "not run" — a transport outcome dressed up as a market answer.
//
// Contract section 9 governs this: a failed source path is not a failed
// research question. So the scan now carries TWO independent transports and
// merges them:
//
//   • Hermes free search — the governed keyless `ddgs` capability LandOS
//     already selected. No browser, no key, no credit.
//   • Gemini grounded search — the existing paid-key transport, unchanged.
//
// Both are optional. Either one answering is a real answer; both failing is the
// only honest "unavailable". Results are merged and deduped on URL identity so
// a story found by both counts once.

import type { ScanFinding, ScanSearchFn } from './market-scan.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

/** Publication year stated in the text, when one plausibly is. Never guessed
 *  from a URL slug that could be an id, and never newer than next year. */
export function statedYear(text: string): number | null {
  const years = [...(text ?? '').matchAll(/\b(20[12]\d)\b/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  const ceiling = new Date().getUTCFullYear() + 1;
  const usable = years.filter((year) => year >= 2015 && year <= ceiling);
  return usable.length ? Math.max(...usable) : null;
}

/** Identity for dedupe: host + path, ignoring scheme, www, query and fragment. */
export function findingKey(finding: ScanFinding): string {
  const url = (finding.url ?? '').trim();
  if (url) {
    try {
      const parsed = new URL(url);
      return `${parsed.host.replace(/^www\./i, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch { /* fall through to the title key */ }
  }
  return `title:${(finding.title ?? '').trim().toLowerCase()}`;
}

/**
 * The governed keyless search, adapted to the Market Scan's finding shape.
 * Returns [] rather than throwing when the capability is unavailable — a
 * transport that cannot search reports no findings, it never fails the scan.
 */
export function hermesScanSearch(
  search: IdentitySearchProvider,
  options: { maxResults?: number; timeoutMs?: number } = {},
): ScanSearchFn {
  return async (query: string): Promise<ScanFinding[]> => {
    const hits = await search(query, {
      maxResults: options.maxResults ?? 10,
      timeoutMs: options.timeoutMs ?? 25_000,
    });
    return hits.map((hit) => ({
      title: (hit.title ?? '').trim(),
      summary: (hit.snippet ?? '').trim(),
      url: hit.url,
      year: statedYear(`${hit.title} ${hit.snippet}`),
    })).filter((finding) => finding.title || finding.summary);
  };
}

/**
 * Merge several search transports into one. Every transport runs concurrently
 * on the same query; a transport that throws contributes nothing and never
 * takes the others down with it. Findings are deduped on URL identity, keeping
 * the first (richest available) copy. Throws only when EVERY transport failed —
 * which is the one case the scan should report as unavailable rather than as an
 * empty market.
 */
export function composeScanSearch(transports: Array<ScanSearchFn | null | undefined>): ScanSearchFn | null {
  const live = transports.filter((transport): transport is ScanSearchFn => typeof transport === 'function');
  if (!live.length) return null;
  return async (query: string): Promise<ScanFinding[]> => {
    const settled = await Promise.allSettled(live.map((transport) => transport(query)));
    if (settled.every((outcome) => outcome.status === 'rejected')) {
      const first = settled.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(`Every market-scan search transport failed: ${first?.reason instanceof Error ? first.reason.message : String(first?.reason ?? 'unknown')}`);
    }
    const merged: ScanFinding[] = [];
    const seen = new Set<string>();
    for (const outcome of settled) {
      if (outcome.status !== 'fulfilled' || !Array.isArray(outcome.value)) continue;
      for (const finding of outcome.value) {
        if (!finding || typeof finding.title !== 'string') continue;
        const key = findingKey(finding);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(finding);
      }
    }
    return merged;
  };
}
