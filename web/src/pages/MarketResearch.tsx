// Market Research department workspace — Heat Map + Drill Deep over the
// LandOS-retained quarterly LandPortal market snapshots.
//
// One shared dataset, two views: the map-first Heat Map and the table-first
// Drill Deep. Both read the SAME snapshot / filter / geography state, so a
// selection in one is the selection in the other. Only retained returned
// values render; an uncollected geography is presented as absent, never zero.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { feature } from 'topojson-client';
import {
  Map as MapIcon, BookOpen, ChevronRight, ArrowUpDown,
  ArrowUp, ArrowDown, RefreshCw, X,
} from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost } from '@/lib/api';
import { makeTopoLoader } from '@/lib/topo-loader';
import { MarketHeatMap, type MapFeature } from '@/components/MarketHeatMap';

// ── Types (mirror /api/landos/market-research) ───────────────────────────
type MetricKey =
  | 'salesCount' | 'daysOnMarket' | 'sellThroughRate' | 'absorptionRate' | 'monthsOfSupply'
  | 'population' | 'populationDensity' | 'populationGrowth' | 'medianPrice' | 'medianPricePerAcre';
type Metrics = Record<string, number | null>;

interface Snapshot {
  id: number; quarter: string; filterKey: string;
  filters: { status: string; propertyType: string; lookbackMonths: number; acreageBand: string };
  provider: string; collectedAt: string; status: string;
  counts: { state: number; county: number; zip: number };
}
interface Row {
  geoKey: string; level: 'state' | 'county' | 'zip'; state: string; fips: string; zip: string;
  name: string; parentKey: string; metrics: Metrics;
  countyCount: number | null; zipCount: number | null;
  provider: string; sourceRef: string; observedAt: string;
  prior: { quarter: string; collectedAt: string; metrics: Metrics } | null;
  childCount: number;
}
interface DictEntry { key: string; label: string; plain: string }
interface Overview {
  snapshots: Snapshot[]; dictionary: DictEntry[];
  collection: { running: boolean; lastRun: { status: string; startedAt: number; updatedAt: number } | null };
  bands: Array<{ band: string; retained: boolean }>;
}
interface Summary {
  row: Row;
  snapshot: { id: number; quarter: string; collectedAt: string; filters: Snapshot['filters']; provider: string };
  priorSnapshot: { quarter: string; collectedAt: string } | null;
}

// ── Metric + geography constants ─────────────────────────────────────────
const METRICS: Array<{ key: MetricKey; label: string; kind: 'int' | 'days' | 'pct' | 'months' | 'money' | 'dec' }> = [
  { key: 'salesCount', label: 'Count', kind: 'int' },
  { key: 'daysOnMarket', label: 'DOM', kind: 'days' },
  { key: 'sellThroughRate', label: 'STR', kind: 'pct' },
  { key: 'absorptionRate', label: 'AR', kind: 'pct' },
  { key: 'monthsOfSupply', label: 'MoS', kind: 'months' },
  { key: 'population', label: 'Population', kind: 'int' },
  { key: 'populationDensity', label: 'Density', kind: 'dec' },
  { key: 'populationGrowth', label: 'Growth', kind: 'pct' },
  { key: 'medianPrice', label: 'Median Price', kind: 'money' },
  { key: 'medianPricePerAcre', label: 'PPA', kind: 'money' },
];
const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

function fmtMetric(key: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const kind = METRIC_BY_KEY[key]?.kind ?? 'dec';
  if (kind === 'money') return `$${Math.round(v).toLocaleString()}`;
  if (kind === 'pct') return `${v}%`;
  if (kind === 'days') return `${Math.round(v)}d`;
  if (kind === 'months') return `${v} mo`;
  if (kind === 'int') return Math.round(v).toLocaleString();
  return `${v}`;
}

const STATE_TO_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21',
  LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30',
  NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49',
  VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
};
const FIPS_TO_STATE = Object.fromEntries(Object.entries(STATE_TO_FIPS).map(([a, f]) => [f, a]));

// ── Topology loading (cached across mounts; failures retry, see lib) ─────
const loadStateFeatures = makeTopoLoader<MapFeature[]>(() =>
  fetch('/geo/states-10m.json').then((r) => r.json()).then((topo) => {
    const fc = feature(topo, topo.objects.states) as unknown as { features: Array<{ id: string; properties: { name: string } }> };
    return fc.features
      .filter((f) => FIPS_TO_STATE[String(f.id)])
      .map((f) => ({ key: FIPS_TO_STATE[String(f.id)], name: f.properties.name, feature: f as never }));
  }));
const loadCountyFeatures = makeTopoLoader<Array<MapFeature & { stateFips: string }>>(() =>
  fetch('/geo/counties-10m.json').then((r) => r.json()).then((topo) => {
    const fc = feature(topo, topo.objects.counties) as unknown as { features: Array<{ id: string; properties: { name: string } }> };
    return fc.features.map((f) => ({
      key: String(f.id), stateFips: String(f.id).slice(0, 2),
      name: `${f.properties.name} County`, feature: f as never,
    }));
  }));

// ── Page ─────────────────────────────────────────────────────────────────
type View = 'heatmap' | 'drilldeep';

export function MarketResearch() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('heatmap');

  const [band, setBand] = useState('2-5');
  const [snapshotId, setSnapshotId] = useState<number | null>(null);
  const [metric, setMetric] = useState<MetricKey>('salesCount');
  const [showDict, setShowDict] = useState(false);
  const [collecting, setCollecting] = useState(false);

  // Shared drill state (breadcrumb) + selection — identical for both views.
  const [drillState, setDrillState] = useState<string | null>(null);        // USPS abbr
  const [drillCounty, setDrillCounty] = useState<{ fips: string; name: string } | null>(null);
  const [selectedGeo, setSelectedGeo] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | 'missing' | null>(null);

  const [stateRows, setStateRows] = useState<Row[]>([]);
  const [countyRows, setCountyRows] = useState<Row[]>([]);
  const [zipRows, setZipRows] = useState<Row[]>([]);

  async function loadOverview(): Promise<Overview | null> {
    try {
      setError(null);
      const o = await apiGet<Overview>('/api/landos/market-research/overview');
      setOverview(o);
      return o;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadOverview(); }, []);

  const bandSnapshots = useMemo(
    () => (overview?.snapshots ?? []).filter((s) => s.filters.acreageBand === band),
    [overview, band],
  );
  const snapshot = useMemo(
    () => bandSnapshots.find((s) => s.id === snapshotId) ?? bandSnapshots[0] ?? null,
    [bandSnapshots, snapshotId],
  );

  // Level rows for the shared drill position.
  useEffect(() => {
    if (!snapshot) { setStateRows([]); return; }
    void apiGet<{ rows: Row[] }>(`/api/landos/market-research/snapshots/${snapshot.id}/rows?level=state`)
      .then((r) => setStateRows(r.rows)).catch(() => setStateRows([]));
  }, [snapshot?.id]);
  useEffect(() => {
    if (!snapshot || !drillState) { setCountyRows([]); return; }
    void apiGet<{ rows: Row[] }>(`/api/landos/market-research/snapshots/${snapshot.id}/rows?level=county&parent=state:${drillState}`)
      .then((r) => setCountyRows(r.rows)).catch(() => setCountyRows([]));
  }, [snapshot?.id, drillState]);
  useEffect(() => {
    if (!snapshot || !drillCounty) { setZipRows([]); return; }
    void apiGet<{ rows: Row[] }>(`/api/landos/market-research/snapshots/${snapshot.id}/rows?level=zip&parent=county:${drillCounty.fips}`)
      .then((r) => setZipRows(r.rows)).catch(() => setZipRows([]));
  }, [snapshot?.id, drillCounty?.fips]);

  // Selected geography summary.
  useEffect(() => {
    if (!snapshot || !selectedGeo) { setSummary(null); return; }
    void apiGet<{ summary: Summary }>(`/api/landos/market-research/snapshots/${snapshot.id}/summary?geo=${encodeURIComponent(selectedGeo)}`)
      .then((r) => setSummary(r.summary))
      .catch(() => setSummary('missing'));
  }, [snapshot?.id, selectedGeo]);

  // Collection status polling while a run is active.
  useEffect(() => {
    if (!collecting) return;
    const t = setInterval(async () => {
      try {
        const s = await apiGet<Overview['collection']>('/api/landos/market-research/collect/status');
        if (!s.running) {
          setCollecting(false);
          const o = await loadOverview();
          if (o && snapshot) {
            // refresh the visible level rows with any newly retained results
            const r = await apiGet<{ rows: Row[] }>(`/api/landos/market-research/snapshots/${snapshot.id}/rows?level=state`);
            setStateRows(r.rows);
          }
        }
      } catch { /* next tick */ }
    }, 10000);
    return () => clearInterval(t);
  }, [collecting, snapshot?.id]);

  async function startCollection() {
    try {
      await apiPost('/api/landos/market-research/collect', {});
      setCollecting(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // Navigation helpers keep both views + breadcrumb + selection in sync.
  function goUs() { setDrillState(null); setDrillCounty(null); }
  function goState(abbr: string, select = true) {
    setDrillState(abbr); setDrillCounty(null);
    if (select) setSelectedGeo(`state:${abbr}`);
  }
  function goCounty(fips: string, name: string, select = true) {
    const abbr = FIPS_TO_STATE[fips.slice(0, 2)];
    if (abbr && abbr !== drillState) setDrillState(abbr);
    setDrillCounty({ fips, name });
    if (select) setSelectedGeo(`county:${fips}`);
  }

  const level: 'us' | 'state' | 'county' = drillCounty ? 'county' : drillState ? 'state' : 'us';
  const levelRows = level === 'us' ? stateRows : level === 'state' ? countyRows : zipRows;

  const stateName = (abbr: string) => stateRows.find((r) => r.state === abbr && r.level === 'state')?.name ?? abbr;

  if (loading) return <div class="flex flex-col h-full"><PageHeader title="Market Research" /><PageState loading /></div>;

  const dict = overview?.dictionary ?? [];
  const retainedBands = (overview?.bands ?? []).filter((b) => b.retained || b.band === '2-5');

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Market Research"
        actions={
          <div class="flex items-center gap-2">
            {collecting || overview?.collection.running ? (
              <span class="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                <RefreshCw size={12} class="animate-spin" /> Collecting current LandPortal snapshot…
              </span>
            ) : (
              <button type="button" onClick={startCollection}
                class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]">
                <RefreshCw size={12} /> Collect quarterly snapshot
              </button>
            )}
            <button type="button" onClick={() => setShowDict(true)}
              class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]">
              <BookOpen size={12} /> Metric dictionary
            </button>
          </div>
        }
        tabs={
          <>
            <Tab label="Heat Map" active={view === 'heatmap'} onClick={() => setView('heatmap')} />
            <Tab label="Drill Deep" active={view === 'drilldeep'} onClick={() => setView('drilldeep')} />
          </>
        }
      />

      {error && <PageState error={error} />}

      {!error && !snapshot && (
        <div class="px-6 py-10 max-w-lg">
          <div class="text-[14px] font-medium text-[var(--color-text)]">No retained market research yet</div>
          <p class="text-[12px] text-[var(--color-text-muted)] mt-2">
            Run the quarterly collection to read the current LandPortal Drill Deep market table
            (Sold · Land · trailing 1 year · 2–5 acres) into a retained LandOS snapshot.
          </p>
        </div>
      )}

      {!error && snapshot && (
        <div class="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Shared filter header — identical context for both views. */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label class="flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
              Snapshot
              <select
                class="rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text)]"
                value={snapshot.id}
                onChange={(e) => setSnapshotId(Number((e.target as HTMLSelectElement).value))}
              >
                {bandSnapshots.map((s) => (
                  <option value={s.id}>{s.quarter} · collected {new Date(s.collectedAt).toLocaleDateString()}</option>
                ))}
              </select>
            </label>
            <label class="flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
              Acreage
              <select
                class="rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text)]"
                value={band}
                onChange={(e) => { setBand((e.target as HTMLSelectElement).value); setSnapshotId(null); goUs(); setSelectedGeo(null); }}
              >
                {retainedBands.map((b) => <option value={b.band}>{b.band} acres</option>)}
              </select>
            </label>
            <div class="flex items-center gap-1.5">
              {['Sold', 'Land', 'Trailing 1 year'].map((t) => (
                <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)]">{t}</span>
              ))}
            </div>
            <label class="flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
              Metric
              <select
                class="rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text)]"
                value={metric}
                onChange={(e) => setMetric((e.target as HTMLSelectElement).value as MetricKey)}
              >
                {METRICS.map((m) => <option value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
              {snapshot.provider} · {snapshot.quarter}
            </span>
          </div>

          {/* Breadcrumb — shared by both views. */}
          <nav class="flex items-center gap-1 text-[12px]">
            <button class={`hover:underline ${level === 'us' ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-muted)]'}`} onClick={() => { goUs(); }}>
              United States
            </button>
            {drillState && (
              <>
                <ChevronRight size={12} class="text-[var(--color-text-faint)]" />
                <button class={`hover:underline ${level === 'state' ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-muted)]'}`}
                  onClick={() => goState(drillState)}>
                  {stateName(drillState)}
                </button>
              </>
            )}
            {drillCounty && (
              <>
                <ChevronRight size={12} class="text-[var(--color-text-faint)]" />
                <span class="text-[var(--color-text)] font-medium">{drillCounty.name}</span>
              </>
            )}
          </nav>

          <div class="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
            <div class="min-w-0">
              {view === 'heatmap' ? (
                <HeatMapView
                  level={level} metric={metric}
                  stateRows={stateRows} countyRows={countyRows} zipRows={zipRows}
                  drillState={drillState} drillCounty={drillCounty}
                  selectedGeo={selectedGeo}
                  onPickState={(abbr) => goState(abbr)}
                  onPickCounty={(fips, name) => goCounty(fips, name)}
                  onPickZip={(zip) => setSelectedGeo(`zip:${zip}`)}
                />
              ) : (
                <DrillDeepTable
                  level={level} rows={levelRows} metric={metric}
                  selectedGeo={selectedGeo}
                  onDrillState={(abbr) => goState(abbr, false)}
                  onDrillCounty={(fips, name) => goCounty(fips, name, false)}
                  onSelect={(geoKey) => setSelectedGeo(geoKey)}
                />
              )}
            </div>

            <SummaryPanel summary={summary} onClose={() => { setSelectedGeo(null); setSummary(null); }} />
          </div>
        </div>
      )}

      {showDict && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowDict(false)}>
          <div class="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4" onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center gap-2 mb-3">
              <BookOpen size={15} class="text-[var(--color-text-faint)]" />
              <h2 class="text-[13px] font-semibold text-[var(--color-text)]">Metric dictionary</h2>
              <button onClick={() => setShowDict(false)} class="ml-auto text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={15} /></button>
            </div>
            <div class="space-y-2.5">
              {dict.map((d) => (
                <div>
                  <div class="text-[12px] font-medium text-[var(--color-text)]">{d.label}</div>
                  <div class="text-[11px] text-[var(--color-text-muted)]">{d.plain}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Heat Map view ────────────────────────────────────────────────────────
function HeatMapView(props: {
  level: 'us' | 'state' | 'county';
  metric: MetricKey;
  stateRows: Row[]; countyRows: Row[]; zipRows: Row[];
  drillState: string | null;
  drillCounty: { fips: string; name: string } | null;
  selectedGeo: string | null;
  onPickState: (abbr: string) => void;
  onPickCounty: (fips: string, name: string) => void;
  onPickZip: (zip: string) => void;
}) {
  const { level, metric } = props;
  const [features, setFeatures] = useState<MapFeature[] | null>(null);
  const [projection, setProjection] = useState<'albers-prebaked' | 'mercator-fit'>('albers-prebaked');
  const [geoNote, setGeoNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFeatures(null); setGeoNote(null);
    // Every branch must settle `features` — a load failure shows a plain
    // retryable empty state, never a permanent loading spinner.
    const boundaryFail = () => {
      if (cancelled) return;
      setFeatures([]);
      setGeoNote('Map boundaries failed to load — switch views and back to retry. The retained values remain available in Drill Deep.');
    };
    if (level === 'us') {
      void loadStateFeatures()
        .then((f) => { if (!cancelled) { setFeatures(f); setProjection('albers-prebaked'); } })
        .catch(boundaryFail);
    } else if (level === 'state' && props.drillState) {
      const fips = STATE_TO_FIPS[props.drillState];
      void loadCountyFeatures().then((all) => {
        if (cancelled) return;
        setFeatures(all.filter((f) => f.stateFips === fips));
        setProjection('albers-prebaked');
      }).catch(boundaryFail);
    } else if (level === 'county' && props.drillCounty) {
      const zips = props.zipRows.map((r) => r.zip).filter(Boolean);
      if (zips.length === 0) { setFeatures([]); return; }
      void apiGet<{ features: Array<{ properties: { zip: string }; geometry: unknown }>; unavailable: string[] }>(
        `/api/landos/market-research/zip-geometry?zips=${zips.join(',')}`,
      ).then((fc) => {
        if (cancelled) return;
        setFeatures(fc.features.map((f) => ({ key: f.properties.zip, name: `ZIP ${f.properties.zip}`, feature: { type: 'Feature', geometry: f.geometry } as never })));
        setProjection('mercator-fit');
        if (fc.unavailable.length > 0) setGeoNote(`${fc.unavailable.length} ZIP boundary(ies) have no Census ZCTA polygon and are listed in Drill Deep instead.`);
      }).catch(() => { if (!cancelled) { setFeatures([]); setGeoNote('ZIP boundaries are unavailable right now — the retained values remain in Drill Deep.'); } });
    }
    return () => { cancelled = true; };
  }, [level, props.drillState, props.drillCounty?.fips, props.zipRows]);

  const rows = level === 'us' ? props.stateRows : level === 'state' ? props.countyRows : props.zipRows;
  const valueByKey = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of rows) {
      const key = r.level === 'state' ? r.state : r.level === 'county' ? r.fips : r.zip;
      m.set(key, r.metrics[metric] ?? null);
    }
    return m;
  }, [rows, metric]);

  const selectedKey = useMemo(() => {
    if (!props.selectedGeo) return null;
    const [kind, v] = props.selectedGeo.split(':');
    if (level === 'us' && kind === 'state') return v;
    if (level === 'state' && kind === 'county') return v;
    if (level === 'county' && kind === 'zip') return v;
    return null;
  }, [props.selectedGeo, level]);

  if (!features) return <PageState loading />;

  if (features.length === 0) {
    return (
      <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-6 text-[12px] text-[var(--color-text-muted)]">
        {level === 'county'
          ? (geoNote ?? 'ZIP-level results have not been collected for this county in this snapshot yet.')
          : (geoNote ?? 'No map boundaries available for this level.')}
      </div>
    );
  }

  const metricLabel = METRIC_BY_KEY[metric]?.label ?? metric;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <MarketHeatMap
        features={features}
        projection={projection}
        valueByKey={valueByKey}
        formatValue={(v) => fmtMetric(metric, v)}
        metricLabel={metricLabel}
        selectedKey={selectedKey}
        onSelect={(key) => {
          if (level === 'us') props.onPickState(key);
          else if (level === 'state') {
            const row = props.countyRows.find((r) => r.fips === key);
            props.onPickCounty(key, row?.name ?? (features.find((f) => f.key === key)?.name ?? key));
          } else props.onPickZip(key);
        }}
      />
      {geoNote && <div class="mt-2 text-[10px] text-[var(--color-text-faint)]">{geoNote}</div>}
    </div>
  );
}

// ── Drill Deep table view ────────────────────────────────────────────────
const TABLE_COLUMNS: Array<{ key: string; label: string; get: (r: Row) => number | null }> = [
  { key: 'countyCount', label: '# Counties', get: (r) => r.countyCount },
  { key: 'zipCount', label: '# ZIPs', get: (r) => r.zipCount },
  ...METRICS.map((m) => ({ key: m.key as string, label: m.label, get: (r: Row) => r.metrics[m.key] ?? null })),
];

function DrillDeepTable(props: {
  level: 'us' | 'state' | 'county';
  rows: Row[];
  metric: MetricKey;
  selectedGeo: string | null;
  onDrillState: (abbr: string) => void;
  onDrillCounty: (fips: string, name: string) => void;
  onSelect: (geoKey: string) => void;
}) {
  const [sortKey, setSortKey] = useState<string>('salesCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const col = TABLE_COLUMNS.find((c) => c.key === sortKey);
    const rows = [...props.rows];
    if (sortKey === 'name') {
      rows.sort((a, b) => (sortDir === 'asc' ? 1 : -1) * a.name.localeCompare(b.name));
      return rows;
    }
    if (!col) return rows;
    rows.sort((a, b) => {
      const av = col.get(a); const bv = col.get(b);
      if (av === null && bv === null) return a.name.localeCompare(b.name);
      if (av === null) return 1;  // absent values always sink, regardless of direction
      if (bv === null) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [props.rows, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  const sortIcon = (key: string) =>
    sortKey !== key ? <ArrowUpDown size={10} class="opacity-40" /> : sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />;

  if (props.rows.length === 0) {
    return (
      <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-6 text-[12px] text-[var(--color-text-muted)]">
        {props.level === 'us'
          ? 'No state-level results are retained in this snapshot yet.'
          : props.level === 'state'
            ? 'County-level results have not been collected for this state in this snapshot yet.'
            : 'ZIP-level results have not been collected for this county in this snapshot yet.'}
      </div>
    );
  }

  return (
    // Bounded height so long tables scroll INSIDE this container — required
    // for the sticky metric header to stay visible while scrolling rows.
    <div class="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] rounded-lg border border-[var(--color-border)]">
      <table class="w-full text-[12px] whitespace-nowrap">
        <thead class="sticky top-0 z-20">
          <tr class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] border-b border-[var(--color-border)] bg-[var(--color-card)]">
            <th class="text-left px-3 py-2 sticky left-0 z-30 bg-[var(--color-card)]">
              <button class="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort('name')}>
                Geography {sortIcon('name')}
              </button>
            </th>
            {TABLE_COLUMNS.map((c) => (
              <th class="text-right px-3 py-2 bg-[var(--color-card)]">
                <button class="inline-flex items-center gap-1 hover:text-[var(--color-text)]" onClick={() => toggleSort(c.key)}>
                  {c.label} {sortIcon(c.key)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const selected = props.selectedGeo === r.geoKey;
            const drillable = r.level !== 'zip';
            return (
              <tr
                key={r.geoKey}
                data-geo={r.geoKey}
                class={`border-b border-[var(--color-border)] cursor-pointer ${selected ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-elevated)]'}`}
                onClick={() => props.onSelect(r.geoKey)}
              >
                <td class="px-3 py-2 sticky left-0 bg-inherit">
                  <div class="flex items-center gap-1.5">
                    {drillable ? (
                      <button
                        title={r.level === 'state' ? 'Open county rows' : 'Open ZIP rows'}
                        class="p-0.5 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (r.level === 'state') props.onDrillState(r.state);
                          else props.onDrillCounty(r.fips, r.name);
                        }}
                      >
                        <ChevronRight size={13} />
                      </button>
                    ) : <span class="w-[18px]" />}
                    <span class="text-[var(--color-text)]">{r.name}</span>
                  </div>
                </td>
                {TABLE_COLUMNS.map((c) => {
                  const v = c.get(r);
                  const priorV = r.prior ? (c.key === 'countyCount' || c.key === 'zipCount' ? null : r.prior.metrics[c.key] ?? null) : null;
                  const delta = v !== null && priorV !== null ? v - priorV : null;
                  return (
                    <td class="px-3 py-2 text-right tabular-nums">
                      <span class={c.key === props.metric ? 'font-semibold text-[var(--color-text)]' : ''}>
                        {v === null ? '' : c.key === 'countyCount' || c.key === 'zipCount' ? v.toLocaleString() : fmtMetric(c.key, v)}
                      </span>
                      {delta !== null && c.key === props.metric && (
                        <span class={`ml-1 text-[10px] ${delta > 0 ? 'text-[var(--color-status-done)]' : delta < 0 ? 'text-[var(--color-status-failed)]' : 'text-[var(--color-text-faint)]'}`}>
                          {delta > 0 ? '+' : ''}{fmtMetric(c.key, Math.round(delta * 100) / 100) || delta}
                          <span class="text-[var(--color-text-faint)]"> vs {r.prior!.quarter}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Selected geography summary ───────────────────────────────────────────
function takeaway(m: Metrics, band: string): string {
  const parts: string[] = [];
  if (typeof m.daysOnMarket === 'number') {
    parts.push(m.daysOnMarket <= 90 ? `land is moving quickly (~${Math.round(m.daysOnMarket)} days on market)` : `sales are slow (~${Math.round(m.daysOnMarket)} days on market)`);
  }
  if (typeof m.monthsOfSupply === 'number') {
    parts.push(m.monthsOfSupply <= 12 ? `${m.monthsOfSupply} months of supply keeps sellers competitive` : `${m.monthsOfSupply} months of supply signals a heavy inventory market`);
  }
  if (typeof m.sellThroughRate === 'number') {
    parts.push(`sell-through is ${m.sellThroughRate}%`);
  }
  if (typeof m.medianPricePerAcre === 'number') {
    parts.push(`entry pricing runs ~$${Math.round(m.medianPricePerAcre).toLocaleString()}/acre`);
  }
  if (typeof m.populationGrowth === 'number') {
    parts.push(m.populationGrowth > 0 ? `population is growing (${m.populationGrowth}%)` : `population is flat-to-declining (${m.populationGrowth}%)`);
  }
  if (parts.length === 0) return 'Not enough retained metrics for a read on this geography yet.';
  return `For ${band}-acre sold land: ${parts.join('; ')}.`;
}

function SummaryPanel({ summary, onClose }: { summary: Summary | 'missing' | null; onClose: () => void }) {
  if (!summary) {
    return (
      <div class="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[12px] text-[var(--color-text-muted)]">
        Click a state, county, or ZIP on the map — or a row in Drill Deep — to open its market summary.
      </div>
    );
  }
  if (summary === 'missing') {
    return (
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex items-start gap-2">
          <div class="text-[12px] text-[var(--color-text-muted)]">No retained result for this geography in this snapshot. It has not been collected — that is not a zero.</div>
          <button onClick={onClose} class="ml-auto text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={14} /></button>
        </div>
      </div>
    );
  }

  const { row, snapshot, priorSnapshot } = summary;
  const m = row.metrics;
  const prior = row.prior;

  const line = (label: string, keys: MetricKey[]) => {
    const present = keys.filter((k) => typeof m[k] === 'number');
    if (present.length === 0) return null;
    return (
      <div>
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
        <div class="mt-0.5 space-y-0.5">
          {present.map((k) => {
            const pv = prior?.metrics[k];
            const delta = typeof pv === 'number' && typeof m[k] === 'number' ? (m[k] as number) - pv : null;
            return (
              <div class="flex items-baseline gap-2 text-[12px]">
                <span class="text-[var(--color-text-muted)]">{METRIC_BY_KEY[k].label}</span>
                <span class="ml-auto tabular-nums text-[var(--color-text)] font-medium">{fmtMetric(k, m[k])}</span>
                {delta !== null && prior && (
                  <span class={`text-[10px] tabular-nums ${delta > 0 ? 'text-[var(--color-status-done)]' : delta < 0 ? 'text-[var(--color-status-failed)]' : 'text-[var(--color-text-faint)]'}`}>
                    {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {fmtMetric(k, Math.round(Math.abs(delta) * 100) / 100)} vs {prior.quarter}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center gap-2">
        <MapIcon size={14} class="text-[var(--color-text-faint)]" />
        <h3 class="text-[13px] font-semibold text-[var(--color-text)]">{row.name}</h3>
        <button onClick={onClose} class="ml-auto text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X size={14} /></button>
      </div>

      {line('Sales activity & demand', ['salesCount', 'daysOnMarket', 'sellThroughRate'])}
      {line('Supply & absorption', ['absorptionRate', 'monthsOfSupply'])}
      {line('Pricing', ['medianPrice', 'medianPricePerAcre'])}
      {line('Population & growth', ['population', 'populationDensity', 'populationGrowth'])}

      <div class="rounded-md bg-[var(--color-elevated)] p-2.5">
        <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Investor read</div>
        <div class="text-[12px] text-[var(--color-text)]">{takeaway(m, snapshot.filters.acreageBand)}</div>
      </div>

      <div class="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
        {snapshot.quarter} snapshot · collected {new Date(snapshot.collectedAt).toLocaleDateString()} · Sold · Land · trailing 1 year · {snapshot.filters.acreageBand} acres · {snapshot.provider}
        {prior && priorSnapshot && (
          <> · compared with the {priorSnapshot.quarter} snapshot collected {new Date(priorSnapshot.collectedAt).toLocaleDateString()}</>
        )}
        {!prior && <> · no matching prior snapshot yet, so no trend is shown</>}
      </div>
    </div>
  );
}
