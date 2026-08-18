// Acquisition Workspace V2 — Deal Card → LandPortal Research.
//
// The same LandOS Capability that Tools and New Lead invoke, run against the
// subject this Deal Card ALREADY has. It reads the LandPortal record for that
// exact parcel; it never resolves, replaces, or reassigns property identity,
// and the panel states plainly what LandPortal did not publish.
//
// This control lives in its own component for the same reason the Assessor &
// Tax control does: the workspace page, the Property Intelligence section and
// the Overview section stay free of mutation calls, so switching sections can
// never trigger research.
import { useState } from 'preact/hooks';

import { apiPost } from '@/lib/api';

interface LandPortalResearchRunResult {
  subjectResolution: string;
  facts: {
    lane?: string;
    executed?: boolean;
    outcome?: string;
    summary?: string;
    parcel?: Record<string, unknown> | null;
    comparables?: Array<{ saleYear?: string | null; salePrice?: number | null; acres?: number | null; pricePerAcre?: number | null; location?: string | null }>;
    retained?: { parcelUrl?: string | null; parcelFactCount?: number; assetCount?: number; comparableCount?: number };
    sourceAttempts?: Array<{ source: string; status: string; note: string }>;
  };
  warnings: string[];
  missingInformation: string[];
}

const LANDPORTAL_OUTCOME_LABEL: Record<string, string> = {
  record_returned: 'LandPortal record returned',
  lane_completed: 'LandPortal lane completed',
  retained_only: 'Retained LandPortal evidence only',
  not_available: 'No LandPortal record retrieved',
};

const lpText = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  return String(value);
};

function LpRow({ k, v }: { k: string; v: string | null }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">Not published by LandPortal</span>}
    </>
  );
}

export function LandPortalResearchRun({ dealId }: { dealId?: number }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LandPortalResearchRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!dealId) return null;

  const invoke = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: LandPortalResearchRunResult }>(
        `/api/landos/deal-cards/${dealId}/landportal-research`,
        { refresh: true },
      );
      setResult(response.result);
    } catch (caught) {
      setError((caught as Error)?.message ?? 'LandPortal Research could not run.');
    } finally {
      setRunning(false);
    }
  };

  const facts = result?.facts ?? {};
  const parcel = (facts.parcel ?? {}) as Record<string, unknown>;
  const retained = facts.retained ?? {};
  const comparables = facts.comparables ?? [];

  return (
    <div class="awv2-pi-note awv2-landportal-research" data-testid="awv2-landportal-research">
      <button
        type="button"
        data-testid="awv2-landportal-research-run"
        disabled={running}
        onClick={() => { void invoke(); }}
      >
        {running ? 'Reading the LandPortal record…' : 'Run LandPortal Research'}
      </button>
      {' '}Reads the LandPortal record for this Deal Card&apos;s existing canonical parcel.
      It never changes which parcel this card is about.
      {error && <div class="awv2-pi-note" role="alert">{error}</div>}
      {result && (
        <div class="awv2-landportal-research-result" data-testid="awv2-landportal-research-result">
          <div>
            <b>{LANDPORTAL_OUTCOME_LABEL[String(facts.outcome)] ?? String(facts.outcome ?? 'No result')}</b>
            {' '}· subject {result.subjectResolution}
          </div>
          <div class="awv2-kv">
            <LpRow k="APN" v={lpText(parcel.apn)} />
            <LpRow k="Situs address" v={lpText(parcel.situsAddress)} />
            <LpRow k="Owner" v={lpText(parcel.owner)} />
            <LpRow k="Acres" v={lpText(parcel.acres)} />
            <LpRow k="Road frontage (ft)" v={lpText(parcel.roadFrontageFeet)} />
            <LpRow k="Land locked" v={lpText(parcel.landLocked)} />
            <LpRow k="Wetlands %" v={lpText(parcel.wetlandsPct)} />
            <LpRow k="FEMA flood %" v={lpText(parcel.femaPct)} />
            <LpRow k="Buildable acres" v={lpText(parcel.buildabilityAcres)} />
            <LpRow k="Average slope (deg)" v={lpText(parcel.slopeAvgDegrees)} />
            <LpRow k="Building area (sqft)" v={lpText(parcel.buildingAreaSqft)} />
            <LpRow k="Assessed total" v={lpText(parcel.assessedTotal)} />
          </div>
          {facts.summary && <div>{facts.summary}</div>}
          <div data-testid="awv2-landportal-research-retained">
            <b>Retained LandPortal evidence:</b>{' '}
            {retained.parcelFactCount ?? 0} parcel fact(s), {retained.assetCount ?? 0} visual(s),{' '}
            {retained.comparableCount ?? 0} comparable(s)
            {retained.parcelUrl ? ' · parcel record on file' : ''}
          </div>
          {!!comparables.length && (
            <div data-testid="awv2-landportal-research-comps">
              <b>LandPortal comparable sales:</b>{' '}
              {comparables.map((comp) => `${comp.location ?? 'Unnamed'} ${comp.saleYear ?? ''} ${comp.pricePerAcre ? `$${comp.pricePerAcre}/ac` : ''}`.trim()).join('; ')}
            </div>
          )}
          {!!facts.sourceAttempts?.length && (
            <div data-testid="awv2-landportal-research-attempts">
              <b>Sources attempted:</b>{' '}
              {facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
            </div>
          )}
          {!!result.warnings.length && (
            <div><b>Reported:</b> {result.warnings.join('; ')}</div>
          )}
          {!!result.missingInformation.length && (
            <div><b>Not established:</b> {result.missingInformation.join('; ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
