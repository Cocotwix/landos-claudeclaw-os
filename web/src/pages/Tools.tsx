import { useState } from 'preact/hooks';
import { Landmark, Map, Search, Wrench } from 'lucide-preact';

import { apiPost } from '@/lib/api';

interface ResolutionResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    identityBasis?: string;
    canonicalIdentity?: Record<string, unknown>;
    candidates?: Array<Record<string, unknown>>;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface AssessorTaxRecord {
  field: string;
  value: string;
  classification: 'official_record' | 'recorded_instrument';
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
}

interface AssessorTaxResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    recordStatus: 'official_record_retrieved' | 'retained_record_only' | 'not_retrieved';
    jurisdiction: string | null;
    assessor: Record<string, unknown>;
    tax: Record<string, unknown>;
    improvements: Record<string, unknown>;
    transfer: Record<string, unknown>;
    records: AssessorTaxRecord[];
    sourceAttempts: Array<{ source: string; status: string; note: string }>;
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface LandPortalResearchResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    lane: string;
    executed: boolean;
    outcome: 'record_returned' | 'lane_completed' | 'retained_only' | 'not_available';
    parcel: Record<string, unknown> | null;
    comparables: Array<{ saleYear: string | null; salePrice: number | null; acres: number | null; pricePerAcre: number | null; apn: string | null; location: string | null }>;
    retained: { parcelUrl: string | null; parcelFactCount: number; assetCount: number; comparableCount: number };
    sourceAttempts: Array<{ source: string; status: string; note: string }>;
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

const LANDPORTAL_OUTCOME_LABEL: Record<LandPortalResearchResult['facts']['outcome'], string> = {
  record_returned: 'LandPortal record returned',
  lane_completed: 'LandPortal lane completed',
  retained_only: 'Retained LandPortal evidence only',
  not_available: 'No LandPortal record retrieved',
};

const RECORD_STATUS_LABEL: Record<AssessorTaxResult['facts']['recordStatus'], string> = {
  official_record_retrieved: 'Official record retrieved',
  retained_record_only: 'Retained record only',
  not_retrieved: 'No record retrieved',
};

function value(value: unknown): string {
  if (value == null || value === '') return 'Not established';
  if (Array.isArray(value)) return value.join(', ') || 'Not established';
  return String(value);
}

export function Tools() {
  const [rawInput, setRawInput] = useState('');
  const [result, setResult] = useState<ResolutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assessor, setAssessor] = useState<AssessorTaxResult | null>(null);
  const [assessorRunning, setAssessorRunning] = useState(false);
  const [assessorError, setAssessorError] = useState<string | null>(null);
  const [landPortal, setLandPortal] = useState<LandPortalResearchResult | null>(null);
  const [landPortalRunning, setLandPortalRunning] = useState(false);
  const [landPortalError, setLandPortalError] = useState<string | null>(null);

  const run = async (refresh = false) => {
    if (!rawInput.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: ResolutionResult }>('/api/landos/capabilities/property-resolution/invoke', {
        rawInput: rawInput.trim(),
        entity: 'TY_LAND_BIZ',
        refresh,
      });
      setResult(response.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  // Assessor & Tax runs the shared LandOS Capability. Property Resolution
  // establishes the subject first; this never creates a lead or a Deal Card.
  const runAssessorTax = async (refresh = false) => {
    if (!rawInput.trim() || assessorRunning) return;
    setAssessorRunning(true);
    setAssessorError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult; result: AssessorTaxResult }>(
        '/api/landos/capabilities/assessor-tax/invoke',
        { rawInput: rawInput.trim(), entity: 'TY_LAND_BIZ', refresh },
      );
      setResult(response.resolution);
      setAssessor(response.result);
    } catch (caught) {
      setAssessorError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAssessorRunning(false);
    }
  };

  // LandPortal Research runs the shared LandOS Capability. Property Resolution
  // establishes the subject first; this never creates a lead or a Deal Card.
  const runLandPortalResearch = async (refresh = false) => {
    if (!rawInput.trim() || landPortalRunning) return;
    setLandPortalRunning(true);
    setLandPortalError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult; result: LandPortalResearchResult }>(
        '/api/landos/capabilities/landportal-research/invoke',
        { rawInput: rawInput.trim(), entity: 'TY_LAND_BIZ', refresh },
      );
      setResult(response.resolution);
      setLandPortal(response.result);
    } catch (caught) {
      setLandPortalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLandPortalRunning(false);
    }
  };

  const identity = result?.facts.canonicalIdentity ?? {};
  const parcel = (landPortal?.facts.parcel ?? {}) as Record<string, unknown>;
  return (
    <div class="h-full overflow-y-auto bg-[var(--color-bg)] px-5 py-6 md:px-8" data-testid="tools-page">
      <div class="mx-auto max-w-5xl space-y-5">
        <header>
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            <Wrench size={15} /> Tools
          </div>
          <h1 class="mt-2 text-3xl font-semibold text-[var(--color-text)]">Property Research</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            Resolve a property reference without creating a lead. LandOS keeps the result in a temporary research session unless it matches an existing canonical property.
          </p>
        </header>

        <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-resolver-tool">
          <div class="flex items-center gap-2 font-semibold"><Search size={17} /> Property Resolver</div>
          <label class="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" for="property-resolver-input">
            Raw property reference
          </label>
          <textarea
            id="property-resolver-input"
            data-testid="property-resolver-input"
            value={rawInput}
            onInput={(event) => setRawInput(event.currentTarget.value)}
            rows={5}
            class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            placeholder={'Address, APN, owner + county, coordinates, or a messy reference such as “Map 042 Parcel 123, Fairview, Tennessee”'}
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" data-testid="property-resolver-run" disabled={running || !rawInput.trim()} onClick={() => void run(false)} class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {running ? 'Resolving…' : 'Resolve property'}
            </button>
            {result && <button type="button" disabled={running} onClick={() => void run(true)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">Refresh sources</button>}
            <button type="button" data-testid="assessor-tax-run" disabled={assessorRunning || !rawInput.trim()} onClick={() => void runAssessorTax(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {assessorRunning ? 'Reading assessor record…' : 'Run Assessor & Tax'}
            </button>
            <button type="button" data-testid="landportal-research-run" disabled={landPortalRunning || !rawInput.trim()} onClick={() => void runLandPortalResearch(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {landPortalRunning ? 'Reading LandPortal record…' : 'Run LandPortal Research'}
            </button>
          </div>
          <p class="mt-2 text-xs text-[var(--color-text-muted)]">
            Assessor &amp; Tax resolves the subject first, then reads the assessor and taxing-jurisdiction record.
            LandPortal Research resolves the subject first, then reads the LandPortal record for that exact parcel.
            Nothing here creates a lead or a Deal Card.
          </p>
          {error && <div class="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</div>}
        </section>

        {result && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-resolver-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Resolution result</div>
                <div class="mt-1 text-2xl font-semibold" data-testid="property-resolution-status">{result.subjectResolution.replace('_', ' ')}</div>
              </div>
              <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                {result.execution.reused ? 'Reused persisted result' : `${result.execution.mode} · ${result.execution.durationMs} ms`}
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{result.facts.identityBasis || 'LandOS did not establish one exact parcel.'}</p>
            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Address', identity.address], ['APN / Parcel', identity.apn], ['County', identity.county],
                ['State', identity.state], ['Owner', identity.owner], ['Acres', identity.acres],
                ['FIPS', identity.fips], ['LandPortal property ID', identity.landPortalPropertyId], ['Aliases', identity.parcelNotations],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            {result.facts.candidates && result.facts.candidates.length > 0 && (
              <div class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div class="font-semibold text-amber-200">Multiple credible candidates remain</div>
                {result.facts.candidates.map((candidate) => <div class="mt-2 text-sm">{value(candidate.apn)} · {value(candidate.county)}, {value(candidate.state)}</div>)}
              </div>
            )}

            {result.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Needed next:</b> {result.missingInformation.join('; ')}</div>}
            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {result.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No source established the parcel. The result remains unresolved.</div>
                : <ul class="mt-2 space-y-2">{result.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace('_', ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>
            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Research session: {result.canonicalSubject?.id ?? 'not created'} · Invocation: {result.invocationId}</div>
          </section>
        )}

        {assessorError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{assessorError}</div>}

        {assessor && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="assessor-tax-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <Landmark size={14} /> Assessor &amp; Tax
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="assessor-tax-status">{RECORD_STATUS_LABEL[assessor.facts.recordStatus]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">{assessor.facts.jurisdiction ?? 'Jurisdiction not established'}</div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {assessor.execution.reused ? 'Reused persisted result' : `${assessor.execution.mode} · ${assessor.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="assessor-tax-refresh" disabled={assessorRunning} onClick={() => void runAssessorTax(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh record</button>
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{assessor.facts.summary}</p>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Owner of record', assessor.facts.assessor.ownerOfRecord],
                ['Owner mailing address', assessor.facts.assessor.ownerMailingAddress],
                ['Situs address', assessor.facts.assessor.situsAddress],
                ['APN / Parcel', assessor.facts.assessor.apn],
                ['Assessed acreage', assessor.facts.assessor.assessedAcres],
                ['Land use class', assessor.facts.assessor.landUseClass],
                ['Appraised value (land)', assessor.facts.assessor.landAppraisedValue],
                ['Total appraised value', assessor.facts.assessor.totalAppraisedValue],
                ['Taxable value', assessor.facts.assessor.taxableValue],
                ['Annual property tax', assessor.facts.tax.annualTaxAmount],
                ['Tax year', assessor.facts.tax.taxYear],
                ['Tax standing', assessor.facts.tax.standingLabel],
                ['Improvement / structure', assessor.facts.improvements.structureType],
                ['Year built', assessor.facts.improvements.yearBuilt],
                ['Last recorded sale', assessor.facts.transfer.lastSaleDate],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            <div class="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm" data-testid="assessor-tax-standing">
              {String(assessor.facts.tax.statement ?? '')}
            </div>

            {assessor.facts.records.length > 0 && (
              <div class="mt-5" data-testid="assessor-tax-records">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Record fields retained</div>
                <ul class="mt-2 space-y-1">
                  {assessor.facts.records.map((record) => (
                    <li class="text-sm">
                      <b>{record.field}:</b> {record.value}
                      {record.source && <span class="text-[var(--color-text-muted)]"> · {record.source}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {assessor.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Not established:</b> {assessor.missingInformation.join('; ')}</div>}

            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {assessor.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No assessor or tax source has been retrieved for this subject.</div>
                : <ul class="mt-2 space-y-2">{assessor.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace(/_/g, ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>

            {assessor.facts.sourceAttempts.length > 0 && (
              <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="assessor-tax-attempts">
                <b>Sources attempted:</b> {assessor.facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
              </div>
            )}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {assessor.canonicalSubject?.id ?? 'not established'} · Invocation: {assessor.invocationId}</div>
          </section>
        )}

        {landPortalError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{landPortalError}</div>}

        {landPortal && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="landportal-research-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <Map size={14} /> LandPortal Research
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="landportal-research-status">{LANDPORTAL_OUTCOME_LABEL[landPortal.facts.outcome]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">Subject {landPortal.subjectResolution}</div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {landPortal.execution.reused ? 'Reused persisted result' : `${landPortal.execution.mode} · ${landPortal.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="landportal-research-refresh" disabled={landPortalRunning} onClick={() => void runLandPortalResearch(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh record</button>
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{landPortal.facts.summary}</p>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['APN / Parcel', parcel.apn], ['Situs address', parcel.situsAddress], ['Owner', parcel.owner],
                ['Acres', parcel.acres], ['Road frontage (ft)', parcel.roadFrontageFeet], ['Land locked', parcel.landLocked],
                ['Wetlands %', parcel.wetlandsPct], ['FEMA flood %', parcel.femaPct], ['Buildable acres', parcel.buildabilityAcres],
                ['Average slope (deg)', parcel.slopeAvgDegrees], ['Average elevation (ft)', parcel.elevationAvgFeet], ['Building area (sqft)', parcel.buildingAreaSqft],
                ['Land use', parcel.landUse], ['Assessed total', parcel.assessedTotal], ['Market total', parcel.marketTotal],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            {landPortal.facts.comparables.length > 0 && (
              <div class="mt-5" data-testid="landportal-research-comps">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">LandPortal comparable sales</div>
                <ul class="mt-2 space-y-1">
                  {landPortal.facts.comparables.map((comp) => (
                    <li class="text-sm">
                      {value(comp.location)} · {value(comp.saleYear)} · {value(comp.acres)} ac
                      {comp.pricePerAcre != null && <span class="text-[var(--color-text-muted)]"> · ${comp.pricePerAcre}/ac</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div class="mt-4 text-sm" data-testid="landportal-research-retained">
              <b>Retained LandPortal evidence:</b> {landPortal.facts.retained.parcelFactCount} parcel fact(s),{' '}
              {landPortal.facts.retained.assetCount} visual(s), {landPortal.facts.retained.comparableCount} comparable(s)
            </div>

            {landPortal.warnings.length > 0 && <div class="mt-4 text-sm"><b>Reported:</b> {landPortal.warnings.join('; ')}</div>}
            {landPortal.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Not established:</b> {landPortal.missingInformation.join('; ')}</div>}

            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {landPortal.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No LandPortal source has been retrieved for this subject.</div>
                : <ul class="mt-2 space-y-2">{landPortal.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace(/_/g, ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>

            {landPortal.facts.sourceAttempts.length > 0 && (
              <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="landportal-research-attempts">
                <b>Sources attempted:</b> {landPortal.facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
              </div>
            )}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {landPortal.canonicalSubject?.id ?? 'not established'} · Invocation: {landPortal.invocationId}</div>
          </section>
        )}
      </div>
    </div>
  );
}
