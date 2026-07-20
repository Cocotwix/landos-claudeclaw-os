// Shared cache wrapper for map-topology fetches (Market Research heat map).
//
// A FAILED load must never stay cached: caching a rejected promise left the
// Heat Map stuck on its loading state for the rest of the page session (the
// only way out was a full reload). On failure the cache slot is cleared so the
// next mount retries the fetch; a successful load stays cached across mounts.
export function makeTopoLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    cached ??= load().catch((e: unknown) => { cached = null; throw e; });
    return cached;
  };
}
