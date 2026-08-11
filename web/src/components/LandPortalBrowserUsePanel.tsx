// Browser Use LandPortal research — the operator read for the pilot lane.
//
// One launch control and one honest result view. The lane operates the normal
// LandPortal site through the paired authenticated Chrome; everything shown
// here is the persisted, schema-validated result for THIS deal card only.
//
// Honesty rules:
//   • Fields the runner could not see are listed as unavailable, never blank.
//   • A failed step is shown with its reason; a failure never hides older runs.
//   • Structured-versus-visual conflicts render both sides, side by side.
//   • The comp section shows the attempt outcome even when no comp was found.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { apiGet, apiPost, dashboardToken } from '../lib/api';

interface BrowserUseCapture { label: string; file: string; pageUrl: string; capturedAt: string }
interface BrowserUseCompCandidate {
  address: string | null; distance: string | null; sale_date: string | null; sale_price: string | null;
  acreage: number | null; price_per_acre: string | null; property_type: string | null;
  source_context: string; relevance: string;
}
interface BrowserUseFindings {
  subject_identity: {
    address_queried: string; landportal_address: string | null; apn: string | null;
    county: string | null; state: string | null; parcel_match: string; match_reasoning: string;
  };
  property_facts: {
    acreage: number | null; owner_shown: string | null; coordinates: string | null;
    property_type: string | null; roads_serving: string[]; other_characteristics: string[];
    unavailable_fields: string[];
  };
  visual_observations: {
    parcel_shape: string | null; apparent_road_frontage: string | null;
    apparent_access: string | null; surroundings: string | null; notes: string[];
  };
  conflicts: Array<{ structured_field: string; structured_value: string; visual_observation: string; explanation: string }>;
  comp_attempt: { attempted: boolean; outcome: string; candidates: BrowserUseCompCandidate[] };
  failed_actions: Array<{ action: string; reason: string }>;
  auth_required: boolean;
  paid_feature_encountered: string | null;
  confidence: string;
  confidence_reasoning: string;
}
interface BrowserUseRunView {
  dealCardId: number;
  result: {
    runnerVersion: string; startedAt: string | null; finishedAt: string;
    findings: BrowserUseFindings | null; captures: BrowserUseCapture[];
    agentErrors: string[]; urlsVisited: string[]; complete: boolean;
  };
  schemaValid: boolean;
  persistedAt: string;
}
interface BrowserUseStatus { state: 'idle' | 'queued' | 'running' | 'completed' | 'failed'; startedAt: string | null; error: string | null }

interface StageView {
  stage: string;
  status: 'completed' | 'failed' | 'unavailable';
  provider: string;
  finishedAt: string;
  modelCalls: number;
  data: Record<string, unknown>;
  error: string | null;
}

interface SoilDetailView {
  symbol: string | null;
  name: string | null;
  fields: Record<string, string>;
}

function useBrowserUse(dealId: number | null | undefined) {
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [run, setRun] = useState<BrowserUseRunView | null>(null);
  const [stages, setStages] = useState<StageView[]>([]);
  const [directSoilDetails, setDirectSoilDetails] = useState<SoilDetailView[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!dealId) return;
    try {
      const response = await apiGet<{ status: BrowserUseStatus; run: BrowserUseRunView | null; stages?: StageView[]; soilDetails?: SoilDetailView[] }>(`/api/landos/deal-cards/${dealId}/browseruse`);
      setStatus(response.status);
      setRun(response.run);
      setStages(response.stages ?? []);
      setDirectSoilDetails(response.soilDetails ?? []);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not load Browser Use research.');
    }
  }, [dealId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const running = status?.state === 'running' || status?.state === 'queued';
  useEffect(() => {
    if (!dealId || !running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { void refresh(); }, 4000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [dealId, running, refresh]);

  const launch = useCallback(async () => {
    if (!dealId) return;
    setLaunching(true);
    setError(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/browseruse/run`, {});
      await refresh();
    } catch (err) {
      setError((err as Error)?.message ?? 'Browser Use research could not start.');
    } finally {
      setLaunching(false);
    }
  }, [dealId, refresh]);

  return { status, run, stages, directSoilDetails, launching, error, launch };
}

const STAGE_LABELS: Record<string, string> = {
  subject_parcel: 'Confirm subject parcel',
  property_facts: 'Extract property facts',
  imagery: 'Capture imagery',
  frontage_access: 'Road frontage & access',
  comp_screen: 'Open comp screen',
  comp_rows: 'Extract comp rows',
  comp_relevance: 'Judge comp relevance',
  synthesis: 'Synthesize evidence',
};

function StageChips({ stages }: { stages: StageView[] }) {
  if (!stages.length) return null;
  const color = (s: StageView['status']) =>
    s === 'completed' ? 'text-[var(--color-success,#4a4)] border-[var(--color-success,#4a4)]'
    : s === 'failed' ? 'text-[var(--color-danger,#a44)] border-[var(--color-danger,#a44)]'
    : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <div data-testid="browseruse-stages">
      <div class={label}>Staged workflow (latest run · {stages[0]?.provider})</div>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        {stages.map((s) => (
          <span key={s.stage} title={s.error ?? undefined} class={`px-2 py-0.5 rounded-full border text-[10px] ${color(s.status)}`}>
            {STAGE_LABELS[s.stage] ?? s.stage}: {s.status}{s.modelCalls ? ` · ${s.modelCalls} model call${s.modelCalls > 1 ? 's' : ''}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

const label = 'text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]';
const body = 'text-[11px] leading-relaxed text-[var(--color-text-muted)]';
const box = 'rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3';

function captureUrl(dealId: number, file: string): string {
  return `/api/landos/deal-cards/${dealId}/browseruse/image/${encodeURIComponent(file)}?token=${encodeURIComponent(dashboardToken)}`;
}

function FactRow({ name, value }: { name: string; value: string | null }) {
  return (
    <div class="flex gap-2 text-[11px]">
      <span class="min-w-[110px] shrink-0 text-[var(--color-text-faint)]">{name}</span>
      <span class="break-words text-[var(--color-text)]">{value ?? <span class="text-[var(--color-text-faint)] italic">not shown</span>}</span>
    </div>
  );
}

function CompCandidates({ findings }: { findings: BrowserUseFindings }) {
  const attempt = findings.comp_attempt;
  return (
    <div class="space-y-2">
      <div class={body}>
        {attempt.attempted
          ? <>Comp workflow attempted — {attempt.outcome}</>
          : <>The visible comp workflow was not attempted this run.</>}
      </div>
      {attempt.candidates.length === 0 && attempt.attempted && (
        <div class={`${body} italic`}>No usable visible comp candidate was found; the attempt itself is recorded above.</div>
      )}
      {attempt.candidates.map((comp, index) => (
        <div key={index} class="rounded-md border border-[var(--color-border)] p-2 space-y-1">
          <div class="text-[12px] font-medium text-[var(--color-text)]">{comp.address ?? 'Address not shown'}</div>
          <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--color-text-muted)]">
            {comp.distance && <span>{comp.distance}</span>}
            {comp.sale_date && <span>sold {comp.sale_date}</span>}
            {comp.sale_price && <span>{comp.sale_price}</span>}
            {comp.acreage !== null && <span>{comp.acreage} ac</span>}
            {comp.price_per_acre && <span>{comp.price_per_acre}/ac</span>}
            {comp.property_type && <span>{comp.property_type}</span>}
          </div>
          <div class={body}>{comp.relevance}</div>
          <div class="text-[10px] text-[var(--color-text-faint)]">Source: {comp.source_context}</div>
        </div>
      ))}
    </div>
  );
}

/** Market synthesis persisted on the synthesis stage (native LandOS Market
 *  Research data). Rendered in Comps & Market when present; absent fields and
 *  empty bands are omitted rather than shown as blank rows. */
interface MarketBandMetrics { salesCount: number; daysOnMarket: number | null; sellThroughRate: number | null; absorptionRate: number | null; monthsOfSupply: number | null; medianPrice: number | null; medianPricePerAcre: number | null }
interface MarketSynthesisData {
  marketResearch?: {
    source?: string;
    county?: { name?: string; bands?: Record<string, MarketBandMetrics | null> };
    zip?: { zip?: string; bands?: Record<string, MarketBandMetrics | null> };
    investorRead?: { county?: string; zip?: string; label?: string };
  };
  conclusions?: Record<string, string>;
}

function MarketReading({ synthesis }: { synthesis: StageView }) {
  const data = synthesis.data as MarketSynthesisData;
  const mr = data.marketResearch;
  const conclusions = data.conclusions;
  if (!mr || !conclusions) return null;
  const bands = mr.county?.bands ?? {};
  const bandRows = Object.entries(bands).filter(([b, m]) => b !== 'all' && m && m.salesCount > 0) as Array<[string, MarketBandMetrics]>;
  const zipAll = mr.zip?.bands?.['all'] ?? null;
  const fmtN = (v: number | null | undefined) => (v == null ? '—' : String(v));
  return (
    <div class="space-y-2" data-testid="browseruse-market-reading">
      <div class={label}>Market reading · {mr.county?.name ?? 'county'} + ZIP {mr.zip?.zip ?? ''}</div>
      {mr.source && <div class="text-[10px] text-[var(--color-text-faint)]">{mr.source}</div>}
      {['overallCounty', 'subjectBand', 'strongestBand', 'subdivisionSignal', 'acquisitionNote'].map((k) =>
        conclusions[k] ? <div key={k} class={body}>{conclusions[k]}</div> : null)}
      {bandRows.length > 0 && (
        <div class="overflow-x-auto">
          <table class="text-[10.5px] text-[var(--color-text-muted)] border-collapse">
            <thead>
              <tr class="text-[var(--color-text-faint)]">
                {['Band', 'Sold', 'DOM', 'STR %', 'Absorption %', 'MoS', 'Median $', '$/ac'].map((h) => (
                  <th key={h} class="pr-3 pb-1 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bandRows.map(([band, m]) => (
                <tr key={band}>
                  <td class="pr-3 py-0.5 text-[var(--color-text)]">{band} ac</td>
                  <td class="pr-3">{m.salesCount}</td>
                  <td class="pr-3">{fmtN(m.daysOnMarket)}</td>
                  <td class="pr-3">{fmtN(m.sellThroughRate)}</td>
                  <td class="pr-3">{fmtN(m.absorptionRate)}</td>
                  <td class="pr-3">{fmtN(m.monthsOfSupply)}</td>
                  <td class="pr-3">{m.medianPrice == null ? '—' : `$${m.medianPrice.toLocaleString()}`}</td>
                  <td class="pr-3">{m.medianPricePerAcre == null ? '—' : `$${Math.round(m.medianPricePerAcre).toLocaleString()}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {zipAll && (
        <div class={body}>
          ZIP {mr.zip?.zip} · All Acreage: {zipAll.salesCount} sold, DOM {fmtN(zipAll.daysOnMarket)}, STR {fmtN(zipAll.sellThroughRate)}%, MoS {fmtN(zipAll.monthsOfSupply)}.
        </div>
      )}
      {mr.investorRead?.zip && <div class={body}>{mr.investorRead.zip}</div>}
      {mr.investorRead?.label && <div class="text-[10px] italic text-[var(--color-text-faint)]">{mr.investorRead.label}</div>}
    </div>
  );
}

/**
 * variant 'evidence' — the full result (Documents & Visuals workspace).
 * variant 'comps' — the comp attempt + market reading view (Comps & Market workspace).
 */
export function LandPortalBrowserUsePanel({ dealId, variant = 'evidence' }: { dealId: number | null | undefined; variant?: 'evidence' | 'comps' }) {
  const { status, run, stages, directSoilDetails, launching, error, launch } = useBrowserUse(dealId);
  const findings = run?.result.findings ?? null;
  const running = status?.state === 'running';
  const synthesis = stages.find((s) => s.stage === 'synthesis' && s.status === 'completed') ?? null;
  const imagery = stages.find((s) => s.stage === 'imagery' && s.status === 'completed')?.data;
  const stagedSoilDetails = Array.isArray(imagery?.soilDetails)
    ? imagery.soilDetails.filter((detail): detail is SoilDetailView => !!detail && typeof detail === 'object' && typeof (detail as SoilDetailView).fields === 'object')
    : [];
  const soilDetails = stagedSoilDetails.length > 0 ? stagedSoilDetails : directSoilDetails;

  if (variant === 'comps') {
    if (!run || !findings) return null; // comp view only appears once a result exists
    return (
      <details class={box} data-testid="browseruse-comps">
        <summary class="cursor-pointer text-[11px] font-semibold text-[var(--color-text)]">Additional LandPortal candidates not used in valuation · {findings.comp_attempt.candidates.length}</summary>
        <div class="mt-1 text-[10px] text-[var(--color-text-faint)]">Retained raw candidates and relevance decisions; the canonical sold-comp lane above is the valuation basis.</div>
        <div class="mt-2"><CompCandidates findings={findings} /></div>
        {synthesis && <div class="mt-3"><MarketReading synthesis={synthesis} /></div>}
      </details>
    );
  }

  return (
    <div class={box} data-testid="browseruse-panel">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div class={label}>LandPortal research (Browser Use)</div>
          <div class={`${body} mt-0.5`}>Adaptive research on the normal LandPortal site through the paired authenticated browser. No paid feature is ever used.</div>
        </div>
        <button
          type="button"
          disabled={running || launching || !dealId}
          onClick={() => void launch()}
          class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)] disabled:opacity-50"
          data-testid="browseruse-run"
        >
          {running ? 'Researching…' : run ? 'Run again' : 'Run LandPortal research'}
        </button>
      </div>

      {running && (
        <div class={`${body} mt-2`}>
          {status?.state === 'queued'
            ? 'Queued behind another live-browser mission; it starts as soon as the paired browser is free.'
            : `Browser Use is operating LandPortal now (started ${status?.startedAt ?? 'just now'}).`}{' '}
          This view refreshes automatically.
        </div>
      )}
      {status?.state === 'failed' && status.error && (
        <div class="mt-2 rounded-md border border-[var(--color-danger,#a33)] p-2 text-[11px] text-[var(--color-text)]">
          Last run failed: {status.error} Earlier persisted research below remains untouched.
        </div>
      )}
      {error && <div class={`${body} mt-2`}>{error}</div>}

      {!run && !running && status?.state !== 'failed' && soilDetails.length === 0 && (
        <div class={`${body} mt-2 italic`}>No Browser Use research has been persisted for this deal card yet.</div>
      )}

      {stages.length > 0 && <div class="mt-3"><StageChips stages={stages} /></div>}

      {directSoilDetails.length > 0 && stagedSoilDetails.length === 0 && (
        <div class="mt-3">
          <div class={label}>Soil Overlay details</div>
          <div class="mt-1.5 space-y-2">
            {soilDetails.map((detail, index) => (
              <div key={`${detail.symbol ?? detail.name ?? 'soil'}-${index}`} class="rounded-md border border-[var(--color-border)] p-2">
                <div class="text-[11px] font-semibold text-[var(--color-text)]">{[detail.symbol, detail.name].filter(Boolean).join(' Â· ') || 'Soil map unit'}</div>
                <div class="mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                  {Object.entries(detail.fields).map(([field, value]) => <FactRow key={field} name={field} value={value} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {run && (
        <div class="mt-3 space-y-3">
          <div class="text-[10px] text-[var(--color-text-faint)]">
            Source: LandPortal (visible site) via {run.result.runnerVersion} · captured {run.result.finishedAt} · persisted {run.persistedAt}
          </div>

          {/* Evidence captured is shown even when the run's structured findings
              failed — a partial run's completed work is never hidden. */}
          {run.result.captures.length > 0 && dealId && (
            <div>
              <div class={label}>Visual evidence</div>
              <div class="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {run.result.captures.map((capture) => (
                  <a key={capture.file} href={captureUrl(dealId, capture.file)} target="_blank" rel="noreferrer" class="block rounded-md border border-[var(--color-border)] overflow-hidden">
                    <img src={captureUrl(dealId, capture.file)} alt={capture.label} class="w-full h-36 object-cover" loading="lazy" />
                    <div class="px-2 py-1 text-[10px] text-[var(--color-text-muted)]">{capture.label.replaceAll('_', ' ')} · {capture.capturedAt}</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {stagedSoilDetails.length > 0 && (
            <div>
              <div class={label}>Soil Overlay details</div>
              <div class="mt-1.5 space-y-2">
                {soilDetails.map((detail, index) => (
                  <div key={`${detail.symbol ?? detail.name ?? 'soil'}-${index}`} class="rounded-md border border-[var(--color-border)] p-2">
                    <div class="text-[11px] font-semibold text-[var(--color-text)]">{[detail.symbol, detail.name].filter(Boolean).join(' · ') || 'Soil map unit'}</div>
                    <div class="mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                      {Object.entries(detail.fields).map(([field, value]) => <FactRow key={field} name={field} value={value} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {findings ? (
            <>
              <div class="grid gap-3 lg:grid-cols-2">
                <div class="space-y-1.5">
                  <div class={label}>Subject identity</div>
                  <FactRow name="Parcel match" value={`${findings.subject_identity.parcel_match} — ${findings.subject_identity.match_reasoning}`} />
                  <FactRow name="LandPortal address" value={findings.subject_identity.landportal_address} />
                  <FactRow name="APN" value={findings.subject_identity.apn} />
                  <FactRow name="County / State" value={[findings.subject_identity.county, findings.subject_identity.state].filter(Boolean).join(', ') || null} />
                </div>
                <div class="space-y-1.5">
                  <div class={label}>LandPortal facts</div>
                  <FactRow name="Acreage" value={findings.property_facts.acreage === null ? null : String(findings.property_facts.acreage)} />
                  <FactRow name="Owner shown" value={findings.property_facts.owner_shown} />
                  <FactRow name="Coordinates" value={findings.property_facts.coordinates} />
                  <FactRow name="Property type" value={findings.property_facts.property_type} />
                  <FactRow name="Roads serving" value={findings.property_facts.roads_serving.join(', ') || null} />
                  {findings.property_facts.other_characteristics.map((item, index) => <FactRow key={index} name="Also visible" value={item} />)}
                </div>
              </div>

              <div>
                <div class={label}>Visual inspection</div>
                <div class="mt-1.5 space-y-1.5">
                  <FactRow name="Parcel shape" value={findings.visual_observations.parcel_shape} />
                  <FactRow name="Road frontage" value={findings.visual_observations.apparent_road_frontage} />
                  <FactRow name="Apparent access" value={findings.visual_observations.apparent_access} />
                  <FactRow name="Surroundings" value={findings.visual_observations.surroundings} />
                  {findings.visual_observations.notes.map((note, index) => <FactRow key={index} name="Note" value={note} />)}
                </div>
              </div>

              {findings.conflicts.length > 0 && (
                <div>
                  <div class={label}>Structured vs visual conflicts</div>
                  <div class="mt-1.5 space-y-2">
                    {findings.conflicts.map((conflict, index) => (
                      <div key={index} class="rounded-md border border-[var(--color-warning,#b80)] p-2 text-[11px] space-y-0.5">
                        <div class="text-[var(--color-text)]">Structured “{conflict.structured_field}” says: {conflict.structured_value}</div>
                        <div class="text-[var(--color-text)]">Imagery shows: {conflict.visual_observation}</div>
                        <div class={body}>{conflict.explanation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div class={label}>Comp attempt</div>
                <div class="mt-1.5"><CompCandidates findings={findings} /></div>
              </div>

              {(findings.property_facts.unavailable_fields.length > 0 || findings.failed_actions.length > 0 || findings.paid_feature_encountered) && (
                <div>
                  <div class={label}>Honest gaps</div>
                  <ul class="mt-1.5 space-y-1">
                    {findings.property_facts.unavailable_fields.map((field, index) => (
                      <li key={`u${index}`} class={body}>• Unavailable: {field}</li>
                    ))}
                    {findings.failed_actions.map((failure, index) => (
                      <li key={`f${index}`} class={body}>• Failed: {failure.action} — {failure.reason}</li>
                    ))}
                    {findings.paid_feature_encountered && (
                      <li class={body}>• Paid feature encountered (not used): {findings.paid_feature_encountered}</li>
                    )}
                  </ul>
                </div>
              )}

              <div class="text-[10px] text-[var(--color-text-faint)]">Confidence: {findings.confidence} — {findings.confidence_reasoning}</div>
            </>
          ) : (
            <div class={body}>
              <div>The last run did not produce findings.</div>
              {run.result.agentErrors.length > 0 && (
                <ul class="mt-1 space-y-1">
                  {[...new Set(run.result.agentErrors.map((err) => err.slice(0, 160)))].slice(0, 4).map((err, index) => (
                    <li key={index} class="break-words">• {err}…</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
