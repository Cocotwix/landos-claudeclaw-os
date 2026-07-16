import { useEffect, useMemo, useState } from 'preact/hooks';
import { CheckCircle2, Copy, Link2, ShieldCheck } from 'lucide-preact';
import { apiPost } from '@/lib/api';

interface BrowserPairing {
  pairingUrl: string;
  expiresAt: string;
  returnTo: string;
}

const DEFAULT_RETURN_TO = '/dept/acquisitions?deal=14';

function returnToFromSearch(): string {
  const requested = new URLSearchParams(window.location.search).get('returnTo') || '';
  if (!requested.startsWith('/') || requested.startsWith('//')) return DEFAULT_RETURN_TO;
  return requested;
}

export function BrowserConnect() {
  const returnTo = useMemo(returnToFromSearch, []);
  const [code, setCode] = useState(() => window.location.hash.slice(1));
  const [pairing, setPairing] = useState<BrowserPairing | null>(null);
  const [status, setStatus] = useState<'idle' | 'creating' | 'claiming' | 'paired' | 'error'>(
    code ? 'claiming' : 'idle',
  );
  const [error, setError] = useState('');

  // A pasted one-time URL may only change the fragment of an already-open
  // pairing tab. Track hashchange so the code is consumed without a reload.
  useEffect(() => {
    const updateCode = () => setCode(window.location.hash.slice(1));
    window.addEventListener('hashchange', updateCode);
    return () => window.removeEventListener('hashchange', updateCode);
  }, []);

  useEffect(() => {
    if (!code) return;
    setStatus('claiming');
    let cancelled = false;

    fetch('/api/dashboard/browser-pairings/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'This browser link is no longer valid.');
      }
      return response.json() as Promise<{ returnTo: string }>;
    }).then((result) => {
      if (cancelled) return;
      setStatus('paired');
      // The code was in a fragment and never reached the server. Remove it
      // before redirecting so it cannot remain in the browser history.
      window.history.replaceState(null, '', result.returnTo || returnTo);
      window.location.replace(result.returnTo || returnTo);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : 'Could not pair this browser.');
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [code, returnTo]);

  async function createPairing(): Promise<void> {
    setStatus('creating');
    setError('');
    try {
      const result = await apiPost<BrowserPairing>('/api/dashboard/browser-pairings', { returnTo });
      setPairing(result);
      setStatus('idle');
    } catch {
      setError('Open this page in a browser where LandOS is already signed in to create a one-time link.');
      setStatus('error');
    }
  }

  async function copyPairingLink(): Promise<void> {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.pairingUrl);
    } catch {
      setError('Copy the one-time link from the field below and open it in the browser you want to pair.');
      setStatus('error');
    }
  }

  const isClaiming = status === 'claiming';
  const isCreating = status === 'creating';

  return (
    <section class="h-full overflow-y-auto p-6 md:p-10">
      <div class="mx-auto max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 md:p-8 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <ShieldCheck size={23} />
          </div>
          <div>
            <h1 class="text-xl font-semibold">Pair this local browser</h1>
            <p class="mt-1 text-sm text-[var(--color-text-muted)]">
              Connect a fresh local browser without sharing the primary dashboard secret.
            </p>
          </div>
        </div>

        {isClaiming && (
          <div class="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] p-4 text-sm">
            Connecting this browser securely?
          </div>
        )}

        {!code && (
          <>
            <div class="mt-7 space-y-3 text-sm leading-6 text-[var(--color-text-muted)]">
              <p>
                In the browser where LandOS already works, create a one-time link. Open that link in the
                browser you want to pair.
              </p>
              <p>
                The code expires after five minutes, is single-use, and stays in the link fragment rather
                than the server request URL.
              </p>
            </div>

            <button
              type="button"
              onClick={createPairing}
              disabled={isCreating}
              class="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Link2 size={16} />
              {isCreating ? 'Creating secure link?' : 'Create one-time browser link'}
            </button>
          </>
        )}

        {pairing && (
          <div class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-medium">One-time local link</div>
              <button
                type="button"
                onClick={copyPairingLink}
                class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-card)]"
              >
                <Copy size={14} /> Copy link
              </button>
            </div>
            <input
              aria-label="One-time local browser link"
              class="mt-3 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 font-mono text-xs text-[var(--color-text)]"
              readOnly
              value={pairing.pairingUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p class="mt-3 text-xs text-[var(--color-text-muted)]">
              Expires {new Date(pairing.expiresAt).toLocaleTimeString()}. It grants a temporary local session,
              not the dashboard?s primary credential.
            </p>
          </div>
        )}

        {status === 'paired' && (
          <div class="mt-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={17} /> Browser paired. Opening the Deal Card?
          </div>
        )}

        {status === 'error' && (
          <div class="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

