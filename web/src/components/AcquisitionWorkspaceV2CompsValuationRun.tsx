// Acquisition Workspace V2 — Deal Card → Comps & Valuation Capability.
//
// The same LandOS Capability that Tools and New Lead invoke, run against the
// subject this Deal Card ALREADY has. It reads the comparable evidence and the
// valuation for that exact parcel; it never resolves, replaces, or reassigns
// property identity, and the panel states plainly what the evidence does not
// establish.
//
// This control lives in its own component for the same reason the Assessor &
// Tax and LandPortal Research controls do: the section files stay small and one
// place owns the mutation call.
import { useState } from 'preact/hooks';

import { apiPost } from '@/lib/api';
import { useCanonicalParcelGate } from '@/lib/useCanonicalParcelGate';

interface CompsValuationRunResult {
  invocationId: string;
  subjectResolution: string;
  facts: {
    lane?: string;
    executed?: boolean;
    outcome?: string;
    summary?: string;
    subject?: {
      address?: string | null; apn?: string | null; acres?: number | null;
      improved?: boolean; buildingSqft?: number | null; valuationScopeLabel?: string | null;
    };
    valuation?: {
      statusLabel?: string; basisLabel?: string; confidence?: string;
      landValue?: number | null; medianPricePerAcre?: number | null;
      weightedPricePerAcre?: number | null;
      retailRangeLow?: number | null; retailRangeHigh?: number | null;
      acquisitionLevels?: { pct40: number; pct50: number; pct60: number } | null;
      valuationSetCount?: number; directCount?: number; windowLabel?: string | null;
    } | null;
    split?: {
      applies?: boolean; why?: string;
      landValue?: number | null; houseValue?: number | null; wholePropertyValue?: number | null;
    };
    comps?: {
      canonicalCount?: number; retainedTotal?: number; valuationSetCount?: number;
      activeCount?: number; mapped?: number; unresolvedLocations?: number;
    };
    sourceAttempts?: Array<{ source: string; status: string; note: string }>;
  };
  warnings: string[];
  missingInformation: string[];
  execution: { mode: string; reused: boolean; durationMs: number };
}

const CV_OUTCOME_LABEL: Record<string, string> = {
  valuation_returned: 'Valuation returned',
  lane_completed: 'Lane completed',
  retained_only: 'Retained comp evidence only',
  not_available: 'No valuation established',
};

const usd = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? `$${Math.round(value).toLocaleString('en-US')}` : null;

function CvRow({ k, v }: { k: string; v: string | null }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">Not established</span>}
    </>
  );
}

export function CompsValuationCapabilityRun({ dealId }: { dealId?: number }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CompsValuationRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gate = useCanonicalParcelGate(dealId);

  if (!dealId) return null;

  const invoke = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: CompsValuationRunResult }>(
        `/api/landos/deal-cards/${dealId}/comps-valuation/capability`,
        { refresh: true },
      );
      setResult(response.result);
    } catch (caught) {
      setError((caught as Error)?.message ?? 'Comps & Valuation could not run.');
    } finally {
      setRunning(false);
    }
  };

  const facts = result?.facts ?? {};
  const valuation = facts.valuation ?? null;
  const split = facts.split ?? {};
  const comps = facts.comps ?? {};

  return (
    <div class="awv2-pi-note awv2-comps-valuation-run" data-testid="awv2-comps-valuation-run">
      <button
        type="button"
        data-testid="awv2-comps-valuation-run-button"
        disabled={running || gate.blocked}
        title={gate.blocked ? gate.reason : 'Run Comps & Valuation'}
        onClick={() => { void invoke(); }}
      >
        {running ? 'Reading the comp and valuation evidence…' : 'Run Comps & Valuation'}
      </button>
      {' '}Reads the comparable evidence and the valuation for this Deal Card&apos;s existing canonical
      parcel through the shared LandOS Capability. It never changes which parcel this card is about.
      {gate.blocked && <div class="awv2-pi-note">Waiting for prerequisite: {gate.reason}</div>}
      {error && <div class="awv2-pi-note" role="alert">{error}</div>}
      {result && (
        <div class="awv2-comps-valuation-run-result" data-testid="awv2-comps-valuation-run-result">
          <div>
            <b>{CV_OUTCOME_LABEL[String(facts.outcome)] ?? String(facts.outcome ?? 'No result')}</b>
            {' '}· subject {result.subjectResolution}
            {valuation?.statusLabel ? ` · ${valuation.statusLabel}` : ''}
          </div>
          <div class="awv2-kv">
            <CvRow k="Land Value" v={usd(split.landValue ?? valuation?.landValue)} />
            {split.applies && <CvRow k="House Value" v={usd(split.houseValue)} />}
            {split.applies && <CvRow k="Whole Property Value" v={usd(split.wholePropertyValue)} />}
            <CvRow k="Median $/acre" v={usd(valuation?.medianPricePerAcre)} />
            <CvRow k="Weighted $/acre" v={usd(valuation?.weightedPricePerAcre)} />
            <CvRow k="Confidence" v={valuation?.confidence ?? null} />
            <CvRow k="Valuation set" v={valuation?.valuationSetCount != null ? `${valuation.valuationSetCount} closed sale(s), ${valuation.directCount ?? 0} direct` : null} />
            <CvRow k="Sale window" v={valuation?.windowLabel ?? null} />
            <CvRow k="Acquisition 40 / 50 / 60" v={valuation?.acquisitionLevels
              ? `${usd(valuation.acquisitionLevels.pct40)} / ${usd(valuation.acquisitionLevels.pct50)} / ${usd(valuation.acquisitionLevels.pct60)}`
              : null} />
          </div>
          {/* The accepted acreage rule, in the capability's own words: the three
              components are split out only above one acre. */}
          {split.why && <div data-testid="awv2-comps-valuation-run-split">{split.why}</div>}
          {facts.summary && <div>{facts.summary}</div>}
          <div data-testid="awv2-comps-valuation-run-comps">
            <b>Comparable evidence:</b>{' '}
            {comps.canonicalCount ?? 0} canonical record(s), {comps.valuationSetCount ?? 0} pricing this subject,{' '}
            {comps.activeCount ?? 0} active competitor(s), {comps.mapped ?? 0} placed
            {comps.unresolvedLocations ? `, ${comps.unresolvedLocations} location(s) unresolved` : ''}
          </div>
          {!!facts.sourceAttempts?.length && (
            <div data-testid="awv2-comps-valuation-run-sources">
              <b>Providers behind the evidence:</b>{' '}
              {facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
            </div>
          )}
          {!!result.warnings.length && <div><b>Reported:</b> {result.warnings.join('; ')}</div>}
          {!!result.missingInformation.length && (
            <div><b>Not established:</b> {result.missingInformation.join('; ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
