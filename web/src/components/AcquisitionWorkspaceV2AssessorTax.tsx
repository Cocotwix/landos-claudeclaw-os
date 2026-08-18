// Acquisition Workspace V2 — Deal Card → Assessor & Tax.
//
// The same LandOS Capability that Tools and New Lead invoke, run against the
// subject this Deal Card ALREADY has. It reads the assessor and taxing
// jurisdiction record; it never resolves, replaces, or reassigns property
// identity, and the panel states plainly what the record did not publish.
//
// This control lives in its own component for the same reason the run-status
// control does: the workspace page, the Property Intelligence section and the
// Overview section stay free of mutation calls, so switching sections can
// never trigger research.
import { useState } from 'preact/hooks';

import { apiPost } from '@/lib/api';

interface AssessorTaxRunResult {
  subjectResolution: string;
  facts: {
    recordStatus?: string;
    jurisdiction?: string | null;
    summary?: string;
    assessor?: Record<string, unknown>;
    tax?: Record<string, unknown>;
    transfer?: Record<string, unknown>;
    sourceAttempts?: Array<{ source: string; status: string; note: string }>;
  };
  missingInformation: string[];
}

const ASSESSOR_TAX_STATUS_LABEL: Record<string, string> = {
  official_record_retrieved: 'Official record retrieved',
  retained_record_only: 'Retained record only',
  not_retrieved: 'No record retrieved',
};

const assessorText = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  return String(value);
};

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">Not published by the record</span>}
    </>
  );
}

export function AssessorTaxRun({ dealId }: { dealId?: number }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AssessorTaxRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!dealId) return null;

  const invoke = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: AssessorTaxRunResult }>(
        `/api/landos/deal-cards/${dealId}/assessor-tax`,
        { refresh: true },
      );
      setResult(response.result);
    } catch (caught) {
      setError((caught as Error)?.message ?? 'Assessor & Tax could not run.');
    } finally {
      setRunning(false);
    }
  };

  const facts = result?.facts ?? {};
  const assessor = (facts.assessor ?? {}) as Record<string, unknown>;
  const tax = (facts.tax ?? {}) as Record<string, unknown>;
  const transfer = (facts.transfer ?? {}) as Record<string, unknown>;

  return (
    <div class="awv2-pi-note awv2-assessor-tax" data-testid="awv2-assessor-tax">
      <button
        type="button"
        data-testid="awv2-assessor-tax-run"
        disabled={running}
        onClick={() => { void invoke(); }}
      >
        {running ? 'Reading the assessor record…' : 'Run Assessor & Tax'}
      </button>
      {' '}Reads the county assessor and taxing-jurisdiction record for this Deal Card&apos;s
      existing canonical parcel. It never changes which parcel this card is about.
      {error && <div class="awv2-pi-note" role="alert">{error}</div>}
      {result && (
        <div class="awv2-assessor-tax-result" data-testid="awv2-assessor-tax-result">
          <div>
            <b>{ASSESSOR_TAX_STATUS_LABEL[String(facts.recordStatus)] ?? String(facts.recordStatus ?? 'No result')}</b>
            {facts.jurisdiction ? ` · ${facts.jurisdiction}` : ''} · subject {result.subjectResolution}
          </div>
          <div class="awv2-kv">
            <Row k="Owner of record" v={assessorText(assessor.ownerOfRecord)} />
            <Row k="Owner mailing address" v={assessorText(assessor.ownerMailingAddress)} />
            <Row k="Assessed acreage" v={assessorText(assessor.assessedAcres)} />
            <Row k="Total appraised value" v={assessorText(assessor.totalAppraisedValue)} />
            <Row k="Taxable value" v={assessorText(assessor.taxableValue)} />
            <Row k="Annual property tax" v={assessorText(tax.annualTaxAmount)} />
            <Row k="Tax year" v={assessorText(tax.taxYear)} />
            <Row k="Tax standing" v={assessorText(tax.standingLabel)} />
            <Row k="Last recorded sale" v={assessorText(transfer.lastSaleDate)} />
          </div>
          {facts.summary && <div>{facts.summary}</div>}
          {assessorText(tax.statement) && <div><b>Tax payment status:</b> {assessorText(tax.statement)}</div>}
          {!!facts.sourceAttempts?.length && (
            <div data-testid="awv2-assessor-tax-attempts">
              <b>Sources attempted:</b>{' '}
              {facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
            </div>
          )}
          {!!result.missingInformation.length && (
            <div><b>Not established:</b> {result.missingInformation.join('; ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
