// LandOS — shared text transport for government property/GIS pages.
//
// ArcGIS answers a plain server-side request happily. Several vendor-hosted
// portals do not: their edge rejects a non-browser client on TLS and header
// FINGERPRINT, so a correct user agent is not enough and never will be. That is
// a transport fact, not a failure of the adapter, and LandOS has to be able to
// tell the two apart — otherwise a blocked fetch reads as "the county has no
// data" and the operator is told something false.
//
// So every text retrieval returns a `blocked` verdict alongside the body, and
// adapters branch on it: a blocked source escalates to the background browser,
// an empty source is reported as empty.

export interface GovTextResponse {
  status: number;
  body: string;
  /** URL after redirects. */
  url: string;
  contentType: string;
  /** True when an edge/bot protection refused the client, not the request. */
  blocked: boolean;
  /** How the body was obtained, so the operator sees the real retrieval route. */
  via: 'server_fetch' | 'background_browser';
}

export interface GovFetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export type GovFetchText = (url: string, options?: GovFetchOptions) => Promise<GovTextResponse>;

/**
 * Markers of a page that IS a challenge, not a page that merely loads one.
 *
 * The distinction matters and getting it wrong is expensive in both
 * directions. Several government portals preload a challenge widget on every
 * page so it is ready if needed — the script tag is present on perfectly good
 * content. Treating that as a block would send every successful read down the
 * fallback path and then report the county as unreachable.
 */
const BLOCK_MARKERS = [
  /Attention Required!/i,
  /cf-browser-verification/i,
  /Just a moment\.\.\./i,
  /Checking your browser before accessing/i,
  /Access (denied|to this page has been denied)/i,
  /Request blocked/i,
  /Incapsula incident/i,
  /__cf_chl_(f|jschl|opt)/i,
  /Enable JavaScript and cookies to continue/i,
];

/** A real challenge page is small. Real content is not. */
const CHALLENGE_BODY_CEILING = 60_000;

/**
 * Whether a response is an edge refusal. A 403 whose body is a challenge page,
 * or a 200 that is nothing but a challenge, both count.
 */
export function looksBlocked(status: number, body: string, contentType: string): boolean {
  if (status === 403 || status === 429 || status === 503) {
    // A short HTML body at these statuses is an edge page, not content.
    if (/html/i.test(contentType) || body.trimStart().startsWith('<')) return true;
  }
  if (!BLOCK_MARKERS.some((marker) => marker.test(body.slice(0, 8000)))) return false;
  // A marker inside a large document is a widget on a real page, not a wall.
  return body.length <= CHALLENGE_BODY_CEILING;
}

const BROWSER_LIKE_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
};

/**
 * Plain server-side retrieval. Sends browser-like headers because many county
 * web adaptors reject an empty user agent, while being explicit that headers
 * alone will not defeat fingerprint-based edge protection.
 */
export const defaultGovFetchText: GovFetchText = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(options.timeoutMs ?? 20_000, 60_000)));
  try {
    const response = await fetch(url, {
      headers: { ...BROWSER_LIKE_HEADERS, ...(options.headers ?? {}) },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      body,
      url: response.url || url,
      contentType,
      blocked: looksBlocked(response.status, body, contentType),
      via: 'server_fetch',
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Read a JSON payload out of a response body, whether it arrived raw or
 * wrapped.
 *
 * A direct request to a JSON endpoint returns JSON. The SAME endpoint read
 * through a browser returns Chrome's JSON viewer: the payload sits inside a
 * `<pre>` with its entities escaped. A caller that only accepts a body starting
 * with `{` would silently treat every browser-fetched API as unavailable —
 * which is exactly the path taken for hosts that force the browser in the first
 * place. Returns null when there is no JSON to be had.
 */
export function readJsonBody(body: string): unknown {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return null;

  const attempt = (candidate: string): unknown => {
    try { return JSON.parse(candidate); } catch { return undefined; }
  };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const direct = attempt(trimmed);
    if (direct !== undefined) return direct;
  }

  // Chrome's JSON viewer, and any other <pre>-wrapped rendering.
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(trimmed);
  if (pre) {
    const decoded = htmlToTextPreservingJson(pre[1]);
    const parsed = attempt(decoded);
    if (parsed !== undefined) return parsed;
  }

  // Last resort: the outermost brace span in the document.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = attempt(htmlToTextPreservingJson(trimmed.slice(start, end + 1)));
    if (parsed !== undefined) return parsed;
  }
  return null;
}

/** Entity-decode without collapsing whitespace, which would corrupt JSON strings. */
function htmlToTextPreservingJson(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

/* ───────────────────── minimal HTML value extraction ─────────────────── */

/** Strip tags and decode the entities that actually appear in county markup. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LabeledValue {
  label: string;
  value: string;
}

/**
 * Read label/value pairs out of a two-column facts table.
 *
 * Deliberately structural rather than label-driven: which labels a deployment
 * prints is governed by state law and the local CAMA vendor, so a fixed label
 * map would be wrong on most sites. LandOS reads whatever pairs exist and lets
 * the caller decide which it recognises.
 */
export function extractLabeledPairs(html: string, rowPattern: RegExp): LabeledValue[] {
  const out: LabeledValue[] = [];
  for (const match of html.matchAll(rowPattern)) {
    const label = htmlToText(match[1] ?? '');
    const value = htmlToText(match[2] ?? '');
    if (label) out.push({ label, value });
  }
  return out;
}

/** `<th>Label</th><td class="value-column">Value</td>` — the Schneider report shape. */
export const TH_TD_ROW = /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;

/** `<td class="DataletSideHeading">Label</td><td class="DataletData">Value</td>` — the iasWorld shape. */
export const DATALET_ROW = /<td[^>]*class="[^"]*DataletSideHeading[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="[^"]*DataletData[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;

/** First value whose label matches, comparing case- and punctuation-insensitively. */
export function findLabeledValue(pairs: readonly LabeledValue[], patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const hit = pairs.find((pair) => pattern.test(pair.label));
    if (hit?.value) return hit.value;
  }
  return null;
}

/** Absolute URLs for every `href` in the markup, resolved against the page. */
export function extractLinks(html: string, baseUrl: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let resolved: string;
    try { resolved = new URL(match[1], baseUrl).toString(); } catch { continue; }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const label = htmlToText(match[2] ?? '');
    if (label) out.push({ label, url: resolved });
  }
  return out;
}
