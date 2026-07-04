import { useEffect, useMemo, useState } from 'preact/hooks';
import { Map as MapIcon, Search, Trophy, Grid3x3, Sparkles, Trash2, Database, X } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost, apiDelete } from '@/lib/api';

// ── Types (mirror the Market Matrix API) ────────────────────────────────
type Metric =
  | 'salesCount' | 'listingCount' | 'medianPrice' | 'medianPricePerAcre' | 'daysOnMarket'
  | 'sellThroughRate' | 'absorptionRate' | 'monthsOfSupply' | 'population'
  | 'populationDensity' | 'populationGrowth' | 'salesDensity';
type Side = 'sold' | 'for_sale';
type Band = 'all' | '2-5' | '5-10' | '10-20' | '20-50' | '50+';
type Op = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';

interface Threshold { metric: Metric; op: Op; value: number }
interface MarketQuery {
  name?: string; side: Side; acreageBand: Band; period?: string;
  scope: { states?: string[]; counties?: string[]; zips?: string[] };
  thresholds: Threshold[]; sort: { metric: Metric; direction: 'asc' | 'desc' }; limit?: number;
}
interface RankedCounty {
  fips: string; countyName: string; state: string; rank: number; sortValue: number;
  period: string; confidence: string; metrics: Record<Metric, number | null>;
  qualifyingMetrics: Array<{ metric: Metric; value: number }>;
}
interface ExcludedCounty { fips: string; countyName: string; state: string; reasons: string[]; missingMetrics: Metric[] }
interface QueryResult { query: MarketQuery; results: RankedCounty[]; excluded: ExcludedCounty[]; analyzedCount: number; includedCount: number; excludedCount: number }
interface Explanation { headline: string; perCounty: Array<{ fips: string; rank: number; why: string }>; excludedSummary: string; method: string }
interface NlParse { query: MarketQuery; recognized: string[]; unrecognized: string[] }
interface Coverage { snapshotCount: number; countyWithDataCount: number; refCountyCount: number; seededStates: string[]; periods: string[]; reviewQueueOpen: number; flaggedSnapshotCount?: number; savedQueryCount: number; latestPeriod: string | null }
interface SavedQuery { id: number; name: string; description: string; query: MarketQuery; createdAt: number; updatedAt: number }
interface Overview { coverage: Coverage; savedQueries: SavedQuery[]; dimensions: { acreageBands: Band[]; metrics: Metric[]; sides: Side[] } }
interface HeatCell { fips: string; countyName: string; state: string; value: number | null; confidence: string | null; period: string | null; hasData: boolean }
interface HeatData { state: string; metric: Metric; side: Side; acreageBand: Band; cells: HeatCell[]; min: number | null; max: number | null; knownCount: number; unknownCount: number }
interface Drilldown { fips: string; countyName: string; state: string; periods: string[]; snapshots: Array<{ period: string; side: Side; acreageBand: Band; metrics: Record<Metric, number | null>; confidence: string; provider: string; sourceRef: string; extractionTs: string }> }

const METRIC_LABEL: Record<Metric, string> = {
  salesCount: 'Sales count', listingCount: 'Listing count', medianPrice: 'Median price',
  medianPricePerAcre: 'Median $/acre', daysOnMarket: 'Days on Market', sellThroughRate: 'Sell-through %',
  absorptionRate: 'Absorption %', monthsOfSupply: 'Months of supply', population: 'Population',
  populationDensity: 'Pop. density', populationGrowth: 'Pop. growth %', salesDensity: 'Sales density',
};
const BAND_LABEL: Record<Band, string> = { all: 'All acreage', '2-5': '2–5 ac', '5-10': '5–10 ac', '10-20': '10–20 ac', '20-50': '20–50 ac', '50+': '50+ ac' };
const OP_LABEL: Record<Op, string> = { gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=' };
const ALL_METRICS = Object.keys(METRIC_LABEL) as Metric[];
const ALL_BANDS: Band[] = ['all', '2-5', '5-10', '10-20', '20-50', '50+'];

function fmtMetric(m: Metric, v: number | null): string {
  if (v === null || v === undefined) return '—';
  if (m === 'medianPrice' || m === 'medianPricePerAcre') return `$${Math.round(v).toLocaleString()}`;
  if (m === 'sellThroughRate' || m === 'absorptionRate' || m === 'populationGrowth') return `${v}%`;
  if (m === 'daysOnMarket') return `${Math.round(v)}d`;
  if (m === 'monthsOfSupply') return `${v}mo`;
  return Math.round(v).toLocaleString();
}

type View = 'selection' | 'rankings' | 'heatmap' | 'search';

export function MarketIntelligence() {
  const [view, setView] = useState<View>('selection');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drill, setDrill] = useState<Drilldown | null>(null);

  async function loadOverview() {
    try {
      setLoading(true); setError(null);
      setOverview(await apiGet<Overview>('/api/landos/market/matrix/overview'));
    } catch (e: any) { setError(e?.message || String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { void loadOverview(); }, []);

  async function ingestFixture() {
    setBusy(true);
    try { await apiPost('/api/landos/market/matrix/ingest-fixture'); await loadOverview(); }
    catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
  }
  async function openDrill(fips: string) {
    try { setDrill(await apiGet<Drilldown>(`/api/landos/market/matrix/county/${fips}`)); }
    catch (e: any) { setError(e?.message || String(e)); }
  }

  const cov = overview?.coverage;
  const noData = cov && cov.snapshotCount === 0;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Market Intelligence"
        actions={
          <div class="flex items-center gap-2">
            {cov && (
              <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                {cov.countyWithDataCount}/{cov.refCountyCount} counties · {cov.snapshotCount} snapshots · {cov.latestPeriod ?? 'no period'}
                {cov.flaggedSnapshotCount ? ` · ${cov.flaggedSnapshotCount} flagged` : ''}
                {cov.reviewQueueOpen > 0 ? ` · ${cov.reviewQueueOpen} in review` : ''}
              </span>
            )}
            <button type="button" disabled={busy} onClick={ingestFixture}
              class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
              <Database size={12} /> {busy ? 'Ingesting…' : 'Ingest fixture'}
            </button>
          </div>
        }
        tabs={
          <>
            <Tab label="Market Selection" active={view === 'selection'} onClick={() => setView('selection')} />
            <Tab label="County Rankings" active={view === 'rankings'} onClick={() => setView('rankings')} />
            <Tab label="Heatmap" active={view === 'heatmap'} onClick={() => setView('heatmap')} />
            <Tab label="Market Search" active={view === 'search'} onClick={() => setView('search')} />
          </>
        }
      />

      {loading && !overview && <PageState loading />}
      {error && <PageState error={error} />}

      {overview && (
        <div class="flex-1 overflow-y-auto px-6 py-4">
          {noData && (
            <div class="mb-4 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[12px] text-[var(--color-text-muted)]">
              The Market Matrix is empty. Click <span class="text-[var(--color-text)] font-medium">Ingest fixture</span> to load the captured
              browser extraction (6 counties across GA/SC/TN) through the ingestion pipeline, then run a query.
            </div>
          )}
          {view === 'selection' && <MarketSelection overview={overview} onReload={loadOverview} onDrill={openDrill} />}
          {view === 'rankings' && <CountyRankings overview={overview} onDrill={openDrill} />}
          {view === 'heatmap' && <Heatmap overview={overview} onDrill={openDrill} />}
          {view === 'search' && <MarketSearch overview={overview} onDrill={openDrill} />}
        </div>
      )}

      {drill && <DrilldownModal drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

// ── Shared results rendering ─────────────────────────────────────────────
function ResultsTable({ result, explanation, onDrill }: { result: QueryResult; explanation?: Explanation; onDrill: (fips: string) => void }) {
  const sortMetric = result.query.sort.metric;
  const whyByFips = useMemo(() => Object.fromEntries((explanation?.perCounty ?? []).map((p) => [p.fips, p.why])), [explanation]);
  return (
    <div class="space-y-3">
      {explanation && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <div class="text-[12px] text-[var(--color-text)]">{explanation.headline}</div>
          <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{explanation.excludedSummary}</div>
          <div class="text-[10px] text-[var(--color-text-faint)] mt-1">{explanation.method}</div>
        </div>
      )}
      {result.results.length === 0 ? (
        <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
          No counties matched the filters. {result.excludedCount > 0 && `${result.excludedCount} excluded for missing data (see below).`}
        </div>
      ) : (
        <div class="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table class="w-full text-[12px]">
            <thead>
              <tr class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] border-b border-[var(--color-border)]">
                <th class="text-left px-3 py-2">#</th>
                <th class="text-left px-3 py-2">County</th>
                <th class="text-left px-3 py-2">State</th>
                <th class="text-right px-3 py-2">{METRIC_LABEL[sortMetric]}</th>
                <th class="text-left px-3 py-2">Qualified with</th>
                <th class="text-left px-3 py-2">Period</th>
                <th class="text-left px-3 py-2">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.fips} class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] cursor-pointer" onClick={() => onDrill(r.fips)} title={whyByFips[r.fips]}>
                  <td class="px-3 py-2 tabular-nums text-[var(--color-text-faint)]">{r.rank}</td>
                  <td class="px-3 py-2 text-[var(--color-text)]">{r.countyName}</td>
                  <td class="px-3 py-2">{r.state}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{fmtMetric(sortMetric, r.sortValue)}</td>
                  <td class="px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
                    {r.qualifyingMetrics.map((q) => `${METRIC_LABEL[q.metric]} ${fmtMetric(q.metric, q.value)}`).join(' · ')}
                  </td>
                  <td class="px-3 py-2 text-[11px] tabular-nums">{r.period || '—'}</td>
                  <td class="px-3 py-2 text-[11px]">{r.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.excluded.length > 0 && (
        <details class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <summary class="text-[11px] text-[var(--color-text-muted)] cursor-pointer">
            Excluded: {result.excludedCount} of {result.analyzedCount} counties in scope (missing required data — never counted as zero)
          </summary>
          <div class="mt-2 space-y-1">
            {result.excluded.map((e) => (
              <div key={e.fips} class="flex items-center gap-2 text-[11px]">
                <button class="text-[var(--color-text)] hover:underline" onClick={() => onDrill(e.fips)}>{e.countyName}, {e.state}</button>
                <span class="text-[var(--color-text-faint)]">— {e.reasons.join(', ')}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Tab 1: Market Selection (natural-language query engine) ──────────────
function MarketSelection({ overview, onReload, onDrill }: { overview: Overview; onReload: () => void; onDrill: (f: string) => void }) {
  const [nl, setNl] = useState('Top 20 counties for 2-5 acre flips with low price per acre');
  const [parse, setParse] = useState<NlParse | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');

  async function run() {
    setBusy(true); setErr(null);
    try {
      const res = await apiPost<{ query: MarketQuery; parse?: NlParse; result: QueryResult; explanation: Explanation }>('/api/landos/market/matrix/query', { nl });
      setParse(res.parse ?? null); setResult(res.result); setExplanation(res.explanation);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (!result || !saveName.trim()) return;
    await apiPost('/api/landos/market/matrix/saved', { name: saveName.trim(), description: nl, query: result.query });
    setSaveName(''); onReload();
  }
  async function runSaved(id: number) {
    setBusy(true); setErr(null);
    try {
      const res = await apiPost<{ result: QueryResult; explanation: Explanation }>(`/api/landos/market/matrix/saved/${id}/run`);
      setResult(res.result); setExplanation(res.explanation); setParse(null);
    } catch (e: any) { setErr(e?.message || String(e)); } finally { setBusy(false); }
  }
  async function delSaved(id: number) { await apiDelete(`/api/landos/market/matrix/saved/${id}`); onReload(); }

  const examples = [
    'Top 100 counties for 2-5 acre flips',
    'Counties with STR above 45% and DOM under 60',
    'Counties in Tennessee with strong population growth',
    'Lowest price per acre in Georgia',
  ];

  return (
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
      <div class="space-y-3">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
          <div class="flex items-center gap-2 text-[11px] text-[var(--color-text-faint)] uppercase tracking-wider"><Sparkles size={12} /> Ask the Market Matrix</div>
          <textarea value={nl} onInput={(e) => setNl((e.target as HTMLTextAreaElement).value)} rows={2}
            class="w-full rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text)] resize-none"
            placeholder="e.g. Top 100 counties for 2-5 acre flips with STR above 45%" />
          <div class="flex flex-wrap gap-1">
            {examples.map((x) => (
              <button key={x} onClick={() => setNl(x)} class="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]">{x}</button>
            ))}
          </div>
          <div class="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={run} class="px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-elevated)] border border-[var(--color-border)] hover:bg-[var(--color-card)] disabled:opacity-40">{busy ? 'Running…' : 'Run query'}</button>
            {parse && (
              <div class="text-[10px] text-[var(--color-text-muted)]">
                {parse.recognized.length > 0 && <span>Read: {parse.recognized.join(' · ')}. </span>}
                {parse.unrecognized.length > 0 && <span class="text-[var(--color-text-faint)]">Ignored: {parse.unrecognized.join(', ')}.</span>}
              </div>
            )}
          </div>
        </div>
        {err && <div class="text-[12px] text-[var(--color-status-failed)]">{err}</div>}
        {result && <ResultsTable result={result} explanation={explanation ?? undefined} onDrill={onDrill} />}
        {result && (
          <div class="flex items-center gap-2">
            <input value={saveName} onInput={(e) => setSaveName((e.target as HTMLInputElement).value)} placeholder="Save this query as…"
              class="flex-1 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px]" />
            <button disabled={!saveName.trim()} onClick={save} class="px-2 py-1 rounded-md text-[11px] border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">Save</button>
          </div>
        )}
      </div>
      <div class="space-y-2">
        <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Saved MarketQueries</div>
        {overview.savedQueries.length === 0 ? (
          <div class="text-[11px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3">Saved queries become reusable business assets other departments consume.</div>
        ) : overview.savedQueries.map((s) => (
          <div key={s.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-2">
            <div class="flex items-center gap-1">
              <button class="flex-1 text-left text-[12px] text-[var(--color-text)] hover:underline" onClick={() => runSaved(s.id)}>{s.name}</button>
              <button onClick={() => delSaved(s.id)} class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)]"><Trash2 size={12} /></button>
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{BAND_LABEL[s.query.acreageBand]} · {s.query.side} · sort {METRIC_LABEL[s.query.sort.metric]} {s.query.sort.direction}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab 2: County Rankings (structured query builder) ────────────────────
function CountyRankings({ overview, onDrill }: { overview: Overview; onDrill: (f: string) => void }) {
  const [side, setSide] = useState<Side>('sold');
  const [band, setBand] = useState<Band>('2-5');
  const [sortMetric, setSortMetric] = useState<Metric>('medianPricePerAcre');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [states, setStates] = useState<string>('');
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [limit, setLimit] = useState(50);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [busy, setBusy] = useState(false);

  function addThreshold() { setThresholds([...thresholds, { metric: 'sellThroughRate', op: 'gte', value: 40 }]); }
  function updThreshold(i: number, patch: Partial<Threshold>) { setThresholds(thresholds.map((t, j) => j === i ? { ...t, ...patch } : t)); }
  function rmThreshold(i: number) { setThresholds(thresholds.filter((_, j) => j !== i)); }

  async function run() {
    setBusy(true);
    const query: MarketQuery = {
      side, acreageBand: band,
      scope: { states: states.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) },
      thresholds, sort: { metric: sortMetric, direction: sortDir }, limit,
    };
    try {
      const res = await apiPost<{ result: QueryResult; explanation: Explanation }>('/api/landos/market/matrix/query', { query });
      setResult(res.result); setExplanation(res.explanation);
    } finally { setBusy(false); }
  }
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);

  const sel = 'rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px]';
  return (
    <div class="space-y-3">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Side
          <select class={sel} value={side} onChange={(e) => setSide((e.target as HTMLSelectElement).value as Side)}><option value="sold">Sold</option><option value="for_sale">For sale</option></select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Acreage
          <select class={sel} value={band} onChange={(e) => setBand((e.target as HTMLSelectElement).value as Band)}>{ALL_BANDS.map((b) => <option value={b}>{BAND_LABEL[b]}</option>)}</select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Sort by
          <select class={sel} value={sortMetric} onChange={(e) => setSortMetric((e.target as HTMLSelectElement).value as Metric)}>{ALL_METRICS.map((m) => <option value={m}>{METRIC_LABEL[m]}</option>)}</select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Dir
          <select class={sel} value={sortDir} onChange={(e) => setSortDir((e.target as HTMLSelectElement).value as 'asc' | 'desc')}><option value="asc">Lowest first</option><option value="desc">Highest first</option></select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">States (CSV)
          <input class={sel} value={states} placeholder="GA, SC, TN" onInput={(e) => setStates((e.target as HTMLInputElement).value)} /></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Limit
          <input type="number" class={`${sel} w-20`} value={limit} onInput={(e) => setLimit(Number((e.target as HTMLInputElement).value) || 50)} /></label>
        <button disabled={busy} onClick={run} class="px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-elevated)] border border-[var(--color-border)] hover:bg-[var(--color-card)] disabled:opacity-40">{busy ? 'Running…' : 'Rank'}</button>
      </div>

      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Threshold filters</span>
          <button onClick={addThreshold} class="text-[11px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)]">+ Add threshold</button>
        </div>
        {thresholds.length === 0 ? <div class="text-[11px] text-[var(--color-text-muted)]">No thresholds. Add one to filter (e.g. sell-through ≥ 45%).</div> : (
          <div class="space-y-2">
            {thresholds.map((t, i) => (
              <div key={i} class="flex items-center gap-2">
                <select class={sel} value={t.metric} onChange={(e) => updThreshold(i, { metric: (e.target as HTMLSelectElement).value as Metric })}>{ALL_METRICS.map((m) => <option value={m}>{METRIC_LABEL[m]}</option>)}</select>
                <select class={sel} value={t.op} onChange={(e) => updThreshold(i, { op: (e.target as HTMLSelectElement).value as Op })}>{(['gte', 'lte', 'gt', 'lt', 'eq'] as Op[]).map((o) => <option value={o}>{OP_LABEL[o]}</option>)}</select>
                <input type="number" class={`${sel} w-28`} value={t.value} onInput={(e) => updThreshold(i, { value: Number((e.target as HTMLInputElement).value) })} />
                <button onClick={() => rmThreshold(i)} class="text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)]"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {result && <ResultsTable result={result} explanation={explanation ?? undefined} onDrill={onDrill} />}
    </div>
  );
}

// ── Tab 3: Heatmap (county choropleth heat grid; grey = Unknown) ──────────
function heatColor(value: number | null, min: number | null, max: number | null): string {
  if (value === null || min === null || max === null) return 'var(--color-elevated)'; // grey = Unknown
  const t = max === min ? 0.5 : (value - min) / (max - min);
  // teal ramp: low = faint, high = saturated
  const light = 22 + Math.round(t * 34);
  return `hsl(180 55% ${light}%)`;
}

function Heatmap({ overview, onDrill }: { overview: Overview; onDrill: (f: string) => void }) {
  const seeded = overview.coverage.seededStates;
  const [state, setState] = useState<string>(seeded[0] ?? 'GA');
  const [metric, setMetric] = useState<Metric>('medianPricePerAcre');
  const [side, setSide] = useState<Side>('sold');
  const [band, setBand] = useState<Band>('2-5');
  const [data, setData] = useState<HeatData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try { setData(await apiGet<HeatData>(`/api/landos/market/matrix/heatmap?state=${state}&metric=${metric}&side=${side}&band=${band}`)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [state, metric, side, band]);

  const sel = 'rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px]';
  return (
    <div class="space-y-3">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">State
          <select class={sel} value={state} onChange={(e) => setState((e.target as HTMLSelectElement).value)}>{seeded.map((s) => <option value={s}>{s}</option>)}</select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Metric
          <select class={sel} value={metric} onChange={(e) => setMetric((e.target as HTMLSelectElement).value as Metric)}>{ALL_METRICS.map((m) => <option value={m}>{METRIC_LABEL[m]}</option>)}</select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Side
          <select class={sel} value={side} onChange={(e) => setSide((e.target as HTMLSelectElement).value as Side)}><option value="sold">Sold</option><option value="for_sale">For sale</option></select></label>
        <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Acreage
          <select class={sel} value={band} onChange={(e) => setBand((e.target as HTMLSelectElement).value as Band)}>{ALL_BANDS.map((b) => <option value={b}>{BAND_LABEL[b]}</option>)}</select></label>
        {data && <span class="text-[11px] text-[var(--color-text-muted)] ml-auto">{data.knownCount} with data · {data.unknownCount} grey (Unknown)</span>}
      </div>

      {busy && !data ? <PageState loading /> : data && (
        <>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {data.cells.map((cell) => (
              <button key={cell.fips} onClick={() => onDrill(cell.fips)}
                class="rounded-lg border border-[var(--color-border)] p-2 text-left hover:ring-1 hover:ring-[var(--color-border)] transition-shadow"
                style={{ background: heatColor(cell.value, data.min, data.max) }}
                title={cell.hasData ? `${cell.countyName}: ${METRIC_LABEL[metric]} ${fmtMetric(metric, cell.value)} (${cell.period}, ${cell.confidence})` : `${cell.countyName}: Unknown (no data)`}>
                <div class="text-[11px] font-medium text-[var(--color-text)] truncate">{cell.countyName}</div>
                <div class="text-[13px] tabular-nums text-[var(--color-text)]">{cell.hasData ? fmtMetric(metric, cell.value) : <span class="text-[var(--color-text-faint)]">Unknown</span>}</div>
              </button>
            ))}
          </div>
          <div class="flex items-center gap-2 text-[10px] text-[var(--color-text-faint)]">
            <span>Low</span>
            <div class="h-2 w-32 rounded" style={{ background: 'linear-gradient(90deg, hsl(180 55% 22%), hsl(180 55% 56%))' }} />
            <span>High</span>
            <span class="ml-3 inline-flex items-center gap-1"><span class="h-3 w-3 rounded" style={{ background: 'var(--color-elevated)' }} /> Grey = Unknown (never zero)</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 4: Market Search (NL question + county lookup) ────────────────────
function MarketSearch({ overview, onDrill }: { overview: Overview; onDrill: (f: string) => void }) {
  const [nl, setNl] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [countyQ, setCountyQ] = useState('');
  const [busy, setBusy] = useState(false);
  const cov = overview.coverage;

  async function run() {
    if (!nl.trim()) return;
    setBusy(true);
    try {
      const res = await apiPost<{ result: QueryResult; explanation: Explanation }>('/api/landos/market/matrix/query', { nl });
      setResult(res.result); setExplanation(res.explanation);
    } finally { setBusy(false); }
  }

  return (
    <div class="space-y-3">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
        <div class="flex items-center gap-2">
          <Search size={14} class="text-[var(--color-text-faint)]" />
          <input value={nl} onInput={(e) => setNl((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="Ask anything: 'cheapest 2-5 acre land in SC', 'fastest selling counties in TN'…"
            class="flex-1 bg-transparent text-[13px] text-[var(--color-text)] outline-none" />
          <button disabled={busy} onClick={run} class="px-3 py-1 rounded-md text-[12px] border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">Search</button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Coverage</div>
          <div class="text-[12px] text-[var(--color-text)] mt-1">{cov.countyWithDataCount} counties with data</div>
          <div class="text-[11px] text-[var(--color-text-muted)]">{cov.snapshotCount} snapshots · {cov.seededStates.join(', ') || 'no'} seeded · periods {cov.periods.join(', ') || '—'}</div>
        </div>
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 md:col-span-2">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Look up a county (FIPS)</div>
          <div class="flex items-center gap-2 mt-1">
            <input value={countyQ} onInput={(e) => setCountyQ((e.target as HTMLInputElement).value)} placeholder="5-digit FIPS, e.g. 13089"
              class="flex-1 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px]" />
            <button disabled={!/^\d{5}$/.test(countyQ)} onClick={() => onDrill(countyQ)} class="px-2 py-1 rounded-md text-[11px] border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">Open</button>
          </div>
        </div>
      </div>

      {result && <ResultsTable result={result} explanation={explanation ?? undefined} onDrill={onDrill} />}
    </div>
  );
}

// ── County drilldown modal ───────────────────────────────────────────────
function DrilldownModal({ drill, onClose }: { drill: Drilldown; onClose: () => void }) {
  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div class="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4" onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center gap-2 mb-3">
          <MapIcon size={16} class="text-[var(--color-text-faint)]" />
          <h2 class="text-[14px] font-semibold text-[var(--color-text)]">{drill.countyName} County, {drill.state}</h2>
          <span class="text-[11px] text-[var(--color-text-faint)] font-mono">FIPS {drill.fips}</span>
          <button onClick={onClose} class="ml-auto text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={16} /></button>
        </div>
        {drill.snapshots.length === 0 ? (
          <div class="text-[12px] text-[var(--color-text-muted)]">No Market Matrix snapshots for this county yet. It is a Browser Agent ingestion candidate (Unknown, not zero).</div>
        ) : (
          <div class="space-y-3">
            {drill.snapshots.map((s, i) => (
              <div key={i} class="rounded-lg border border-[var(--color-border)] p-3">
                <div class="flex items-center gap-2 text-[12px] mb-2">
                  <span class="font-medium">{s.period}</span>
                  <span class="text-[var(--color-text-muted)]">{s.side} · {BAND_LABEL[s.acreageBand]}</span>
                  <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">{s.provider} · conf {s.confidence}</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {ALL_METRICS.map((m) => (
                    <div key={m} class="text-[11px]">
                      <div class="text-[var(--color-text-faint)]">{METRIC_LABEL[m]}</div>
                      <div class="tabular-nums text-[var(--color-text)]">{fmtMetric(m, s.metrics[m])}</div>
                    </div>
                  ))}
                </div>
                {s.extractionTs && <div class="text-[10px] text-[var(--color-text-faint)] mt-2">Extracted {s.extractionTs}{s.sourceRef ? ` · ${s.sourceRef}` : ''}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
