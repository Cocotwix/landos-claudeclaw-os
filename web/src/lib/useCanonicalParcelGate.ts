import { useEffect, useState } from 'preact/hooks';

import { apiGet } from '@/lib/api';

interface ReadinessGateResponse {
  canonicalSubject?: {
    propertyCardId: number | null;
    subjectResolved: boolean;
    officiallyVerified: boolean;
    basis: string;
  };
}

/** Read-only mirror of the server's canonical `parcel` prerequisite. Controls
 * stay fail-closed while the state loads; official verification is displayed
 * separately and never substitutes for research-grade resolution. */
export function useCanonicalParcelGate(dealId?: number) {
  const [state, setState] = useState<{ loading: boolean; resolved: boolean; reason: string }>({
    loading: !!dealId,
    resolved: false,
    reason: 'Waiting for Canonical Subject State.',
  });

  useEffect(() => {
    if (!dealId) {
      setState({ loading: false, resolved: false, reason: 'No Deal Card subject is available.' });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    void apiGet<ReadinessGateResponse>(`/api/landos/deal-cards/${dealId}/research-readiness`)
      .then((response) => {
        if (cancelled) return;
        const subject = response.canonicalSubject;
        setState({
          loading: false,
          resolved: subject?.subjectResolved === true,
          reason: subject?.subjectResolved
            ? subject.basis || 'Canonical subject established.'
            : subject?.basis || 'Waiting for Property Resolution to establish one exact parcel.',
        });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, resolved: false, reason: 'Canonical Subject State is unavailable; refresh the Deal Card.' });
      });
    return () => { cancelled = true; };
  }, [dealId]);

  return { ...state, blocked: state.loading || !state.resolved };
}
