// LandOS — when two URLs are the SAME published document.
//
// A government publishes one document; a website serves it at more than one
// address. Fairview's adopted subdivision regulations answer at both
// `/content/uploads/docs/…` and `/wp-content/uploads/docs/…` — the WordPress
// asset root and the alias the same server also honours. Compared as raw
// strings those are two documents, so the retained set grew a second copy of
// three articles, every run paid an extra fetch for each one, and the operator's
// card listed thirteen documents where the government publishes ten.
//
// The comparison is the defect, not the discovery. Everything that decides
// "have I already got this document" — the within-run merge, the series walk,
// the retained set, the carried-rule lookup — asks this one function instead of
// comparing URL text, so a document is counted, fetched and retained once
// however the site spells its address.
//
// It is an IDENTITY, never a fetch target: the URL that was actually read stays
// exactly as read, because that is the address the operator clicks and the one
// the server is known to answer.

/**
 * The canonical identity of a published document, or `''` when the value is not
 * a usable http(s) URL.
 *
 * Same document, same key:
 *   - scheme is dropped — one file served over http and https is one file
 *   - host is lowercased and a leading `www.` removed
 *   - the WordPress asset root is one root: any `/wp-content/` path segment
 *     reads as `/content/`
 *   - a trailing slash and the fragment are dropped
 *
 * Path case and the query string are PRESERVED. Most servers treat a path as
 * case-sensitive, and a query is routinely what selects one document from many,
 * so folding either would merge documents that genuinely differ.
 */
export function documentUrlIdentity(url: string | null | undefined): string {
  const raw = (url ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname
    .replace(/\/wp-content\//g, '/content/')
    .replace(/\/+$/, '');
  return `${host}${path}${parsed.search}`;
}

/** True when both URLs name the same published document. */
export function sameDocumentUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = documentUrlIdentity(a);
  return !!left && left === documentUrlIdentity(b);
}
