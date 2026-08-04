// Acquisition Workspace V2 — Property Intelligence section.
//
// A usable property-research workspace rendered from the latest accepted
// canonical records each time it loads:
//   GET /api/landos/deal-cards/:id/property-intelligence  (snapshot + marketContext)
//   GET /api/landos/deal-cards/:id/browseruse             (retained soil details)
// Values missing from the canonical data render as honestly missing; nothing
// is fabricated. Market context is labeled as LandOS Market Research and is
// never sourced from LandPortal market panels (SOP 10B).
import { useEffect, useState } from 'preact/hooks';
import { apiGet, dashboardToken } from '@/lib/api';

// ── View types (structural; every field optional and defensive) ────────

export interface PiFact { key: string; value: string; grade: string; label?: string; source?: string; note?: string }
export interface PiDdItem { key: string; label: string; verdict: string; headline: string; detail?: string; missing?: string[] }
export interface PiEvidenceItem { id: string; label: string; viewUrl: string; kind?: string }
export interface PiCompRow {
  key?: string; apn?: string | null; address?: string | null; lane?: string; source?: string;
  sourceUrl?: string | null; status?: string; dateIso?: string | null; price?: number | null;
  acres?: number | null; pricePerAcre?: number | null; thumbnailUrl?: string | null;
}
export interface PiComps {
  conclusion?: string; summaryLine?: string;
  sold?: PiCompRow[]; active?: PiCompRow[]; askingReferences?: PiCompRow[];
  landPortalRowsSeen?: number; totalCollected?: number; duplicatesMerged?: number;
}
export interface PiSnapshot {
  status?: string;
  identity?: {
    displayAddress?: string; normalizedAddress?: string; owner?: string | null;
    ownerMailing?: string | null; county?: string; state_?: string; apn?: string;
    acres?: number | null; acreageBasis?: string; lpPropertyId?: string | null;
    conflicts?: string[]; sourceConfidence?: string; hasParcelGeometry?: boolean;
  };
  facts?: PiFact[];
  dueDiligence?: PiDdItem[];
  evidence?: PiEvidenceItem[];
  comps?: PiComps;
  missingInformation?: unknown[];
  subjectParcelUrl?: string | null;
}

export interface MarketContextMetricsView {
  soldCount: number | null; activeCount: number | null; medianDaysOnMarket: number | null;
  sellThroughRate: number | null; absorptionRate: number | null; monthsOfSupply: number | null;
  medianPrice: number | null; medianPricePerAcre: number | null;
  population: number | null; populationGrowth: number | null;
}
export interface MarketContextRecordView {
  scope: string; label: string; available: boolean;
  acreageBand: string | null; acreageBandLabel: string | null;
  period: string | null; snapshotDate: string | null; provider: string | null;
  metrics: MarketContextMetricsView | null; note: string;
}
export interface MarketContextView {
  source: string;
  geography: { county: string | null; fips: string | null; state: string | null; zip: string | null; acres: number | null; subjectBand: string | null };
  county: MarketContextRecordView; zip: MarketContextRecordView;
  subjectBand: MarketContextRecordView; fastestBand: MarketContextRecordView;
  interpretation: string;
}

interface SoilDetail { symbol?: string; name?: string; fields?: Record<string, string> }
interface BrowseruseResp { soilDetails?: SoilDetail[] }

// ── Helpers ────────────────────────────────────────────────────────────

const tok = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
const num = (s: string | null | undefined, re: RegExp): string | null => {
  const m = s ? s.match(re) : null;
  return m ? m[1] : null;
};
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function fmtMetric(key: keyof MarketContextMetricsView, v: number | null): string | null {
  if (v === null) return null;
  if (key === 'medianPrice' || key === 'medianPricePerAcre') return usd(v);
  if (key === 'sellThroughRate' || key === 'absorptionRate' || key === 'populationGrowth') return `${v}%`;
  if (key === 'medianDaysOnMarket') return `${Math.round(v)} days`;
  if (key === 'monthsOfSupply') return `${v} mo`;
  return Math.round(v).toLocaleString('en-US');
}

/** missingInformation entries arrive as strings or labeled objects. */
function missingLabel(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    for (const k of ['label', 'area', 'summary', 'detail', 'reason']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) return o[k] as string;
    }
  }
  return null;
}

const GALLERY_ORDER = [
  'inspection-close_parcel_aerial', 'inspection-road_frontage_aerial', 'inspection-parcel_context',
  'inspection-front_side_3d', 'inspection-rear_side_3d', 'inspection-wetlands_overlay',
  'inspection-fema_flood_overlay', 'inspection-soil_overlay', 'inspection-contour_terrain_view',
  'inspection-comps_map',
];

function Kv({ k, v, empty }: { k: string; v: string | null | undefined; empty?: string }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">{empty || 'Not retained'}</span>}
    </>
  );
}

function MarketCard({ rec }: { rec: MarketContextRecordView }) {
  const rows: Array<[string, keyof MarketContextMetricsView]> = [
    ['Sold', 'soldCount'], ['Active', 'activeCount'], ['Median DOM', 'medianDaysOnMarket'],
    ['Sell-through', 'sellThroughRate'], ['Absorption', 'absorptionRate'], ['Months of supply', 'monthsOfSupply'],
    ['Median price', 'medianPrice'], ['Median $/acre', 'medianPricePerAcre'],
    ['Population', 'population'], ['Pop. growth', 'populationGrowth'],
  ];
  return (
    <div class={`awv2-mkt-card${rec.available ? '' : ' unavailable'}`}>
      <div class="h">{rec.label}</div>
      <div class="p">{rec.period ? `Period ${rec.period}` : 'No period'}{rec.snapshotDate ? ` · captured ${rec.snapshotDate.slice(0, 10)}` : ''}</div>
      {rec.available && rec.metrics ? (
        <div class="rows">
          {rows.map(([label, key]) => {
            const v = fmtMetric(key, rec.metrics ? rec.metrics[key] : null);
            return (
              <>
                <span class="k">{label}</span>
                {v ? <span class="v">{v}</span> : <span class="v empty">Unknown</span>}
              </>
            );
          })}
        </div>
      ) : (
        <div class="miss">{rec.note}</div>
      )}
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────

export function PropertyIntelligenceSection({ dealId, snap, market }: {
  dealId: number;
  snap: PiSnapshot;
  market: MarketContextView | null;
}) {
  const [soils, setSoils] = useState<SoilDetail[] | null>(null);
  useEffect(() => {
    let dead = false;
    apiGet<BrowseruseResp>(`/api/landos/deal-cards/${dealId}/browseruse`)
      .then((r) => { if (!dead) setSoils(r?.soilDetails ?? null); })
      .catch(() => { if (!dead) setSoils(null); });
    return () => { dead = true; };
  }, [dealId]);

  const id = snap.identity || {};
  const address = id.displayAddress || '';
  const zip = num(address, /\b(\d{5})\s*$/);
  const street = address.split(',')[0]?.trim() || '';
  const roadName = street.replace(/^\d+\s+/, '');

  // Acreage values with source, straight from graded facts.
  const facts = snap.facts || [];
  const fact = (key: string): PiFact | undefined => facts.find((f) => f.key === key);
  const acreageFacts: Array<{ label: string; fact: PiFact | undefined }> = [
    { label: 'Official record', fact: fact('discovery_official_record_acres') },
    { label: 'Verified LandPortal import', fact: fact('acres') },
    { label: 'Operator input', fact: fact('discovery_operator_input_acres') },
    { label: 'LandPortal parcel panel', fact: fact('discovery_marketplace_parcel_panel_acres') },
  ].filter((e) => e.fact);
  const acreNumbers = [...new Set(acreageFacts.map((e) => num(e.fact?.value ?? '', /([\d.]+)/)).filter(Boolean))];
  const acreConflict = acreNumbers.length > 1;

  const dd = new Map<string, PiDdItem>((snap.dueDiligence || []).map((x) => [x.key, x]));
  const access = dd.get('access');
  const terrain = dd.get('terrain');
  const wetlands = dd.get('wetlands');
  const flood = dd.get('flood');
  const utilities = dd.get('utilities');
  const zoning = dd.get('zoning');
  const septic = dd.get('septic');

  const frontageFt = num(access?.headline, /([\d.]+)\s*ft frontage/);
  const landlocked = num(access?.headline, /landlocked flag:\s*(\w+)/);
  const slopePct = num(terrain?.headline, /([\d.]+)%\s*average slope/);
  const buildPct = num(terrain?.headline, /([\d.]+)%\s*buildability/);
  const wetPct = num(wetlands?.headline, /([\d.]+)%/);
  const floodPct = num(flood?.headline, /(\d+(?:\.\d+)?)/);
  const acres = id.acres ?? null;
  const approxAcres = (pct: string | null): string | null => {
    if (!pct || acres == null) return null;
    return (acres * Number(pct) / 100).toFixed(2);
  };
  const usableAcres = buildPct && acres != null ? (acres * Number(buildPct) / 100).toFixed(1) : null;

  const evidence = (snap.evidence || []).filter((e) => e.viewUrl);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const gallery = [
    ...GALLERY_ORDER.map((gid) => byId.get(gid)).filter((e): e is PiEvidenceItem => !!e),
    ...evidence.filter((e) => !GALLERY_ORDER.includes(e.id)),
  ];
  const has3d = byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d');

  const comps = snap.comps || {};
  const activeComps = comps.active || [];
  const asking = comps.askingReferences || [];
  const soldComps = comps.sold || [];
  const finalCompCount = soldComps.length + activeComps.length + asking.length;

  // Missing diligence, grouped once, honestly.
  const missing: string[] = [];
  for (const item of [zoning, utilities, septic]) {
    if (item && (item.verdict === 'unknown' || item.verdict === 'unresolved')) missing.push(item.label);
  }
  for (const m of access?.missing || []) missing.push(m);
  for (const entry of snap.missingInformation || []) {
    const label = missingLabel(entry);
    if (label && !missing.includes(label)) missing.push(label);
  }
  if (!byId.has('inspection-comps_map')) missing.push('Show on Map comparable capture');
  missing.push('Water features', 'Building information', 'Wider-context aerial', 'Street View capture');

  return (
    <>
      {/* ── Subject summary ── */}
      <div class="awv2-grid cols-3-2">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Subject summary</div>
          <div class="awv2-kv">
            <Kv k="Address" v={address} />
            <Kv k="Owner" v={id.owner || null} />
            <Kv k="APN" v={id.apn || null} />
            <Kv k="LandPortal ID" v={id.lpPropertyId || null} />
            <Kv k="County" v={id.county ? `${id.county} County` : null} />
            <Kv k="State" v={id.state_ || null} />
            <Kv k="ZIP" v={zip} />
            <Kv k="Working acreage" v={acres != null ? `${acres} ac (${id.acreageBasis || 'basis not stated'})` : null} />
          </div>
          <div class="awv2-pi-note" style="margin-top:12px">
            {acreageFacts.map((e) => (
              <div>
                <b>{num(e.fact?.value ?? '', /([\d.]+)/) ?? e.fact?.value} ac</b>
                {' '}· {e.label}{e.fact?.source ? ` — ${e.fact.source}` : ''}
              </div>
            ))}
            {acreConflict
              ? <div style="margin-top:6px">Sources disagree ({acreNumbers.join(' vs ')} ac) within the same practical comp band; the working acreage above is the {id.acreageBasis || 'retained'} value.</div>
              : <div style="margin-top:6px">All retained acreage sources agree.</div>}
            {(id.conflicts || []).map((c) => <div>Conflict: {c}</div>)}
          </div>
        </section>

        {/* ── Access & road frontage ── */}
        <section class="awv2-panel">
          <div class="awv2-panel-title">Access &amp; road frontage</div>
          <div class="awv2-kv">
            <Kv k="Road frontage" v={frontageFt ? `${Math.round(Number(frontageFt))} ft (LandPortal parcel panel)` : null} />
            <Kv k="Landlocked" v={landlocked ? landlocked.toUpperCase() : null} />
            <Kv k="Road" v={roadName ? `${roadName} (situs road)` : null} />
            <Kv k="Road relationship" v={byId.has('inspection-road_frontage_aerial') ? 'Frontage visible on the road-frontage aerial below' : null} empty="No frontage capture" />
            <Kv k="Entrance / driveway" v={null} empty="Not confirmed — field or imagery confirmation required" />
          </div>
          {access?.detail && <div class="awv2-pi-note">{access.detail}</div>}
          {(access?.missing || []).length > 0 && (
            <div class="awv2-pi-note">Still required: {(access?.missing || []).slice(0, 4).join('; ')}{(access?.missing || []).length > 4 ? '…' : ''}</div>
          )}
        </section>
      </div>

      {/* ── Terrain + Environmental ── */}
      <div class="awv2-grid cols-3-2">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Terrain &amp; usable area</div>
          <div class="awv2-kv">
            <Kv k="Average slope" v={slopePct ? `${slopePct}%` : null} />
            <Kv k="Slope bands" v={null} empty="Band breakdown not retained" />
            <Kv k="Buildability" v={buildPct ? `${buildPct}% shown${usableAcres ? ` (≈${usableAcres} of ${acres} ac)` : ''}` : null} />
            <Kv k="Terrain" v={terrain?.detail || null} />
            <Kv k="3D evidence" v={has3d ? 'Front and rear 3D views captured (gallery below)' : null} empty="No 3D captures" />
          </div>
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Environmental &amp; soils</div>
          <div class="awv2-kv">
            <Kv k="Wetlands" v={wetPct ? `${wetPct}%${approxAcres(wetPct) ? ` (≈${approxAcres(wetPct)} ac)` : ''} — parcel panel` : null} />
            <Kv k="FEMA flood" v={floodPct ? `${floodPct}%${approxAcres(floodPct) ? ` (≈${approxAcres(floodPct)} ac)` : ''} — zone not retained` : null} />
            <Kv k="Contours" v={byId.has('inspection-contour_terrain_view') ? 'Contour view captured (gallery below)' : null} empty="No contour capture" />
          </div>
          {soils && soils.length > 0 ? (
            <div class="awv2-pi-note">
              {soils.map((s) => (
                <div style="margin-bottom:6px">
                  <b>{[s.symbol, s.name].filter(Boolean).join(' · ')}</b>
                  {s.fields && Object.entries(s.fields)
                    .filter(([k]) => /drainage|farmland|capability/i.test(k))
                    .map(([k, v]) => <div>{k}: {v}</div>)}
                </div>
              ))}
            </div>
          ) : (
            <div class="awv2-pi-note">Soil unit details are not retained for this parcel yet.</div>
          )}
          {wetlands?.detail && <div class="awv2-pi-note">{wetlands.detail}</div>}
        </section>
      </div>

      {/* ── Visual evidence ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">Visual evidence <span class="awv2-src-tag">LandPortal · verified subject</span></div>
        {gallery.length > 0 ? (
          <div class="awv2-gallery">
            {gallery.map((e) => (
              <figure class="awv2-gallery-item" style="margin:0">
                <a href={tok(e.viewUrl)} target="_blank" rel="noopener noreferrer" title={`Open ${e.label} full size (new tab)`}>
                  <img src={tok(e.viewUrl)} alt={e.label} loading="lazy" />
                </a>
                <figcaption class="cap"><span>{e.label}</span>{e.kind && <span class="tag">{e.kind}</span>}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div class="awv2-pi-note">No accepted visual evidence is on file for this parcel.</div>
        )}
      </section>

      {/* ── Market context (LandOS Market Research) ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">
          Market context <span class="awv2-src-tag">{market?.source || 'LandOS Market Research'} — not LandPortal</span>
        </div>
        {market ? (
          <>
            <div class="awv2-mkt-grid">
              <MarketCard rec={market.county} />
              <MarketCard rec={market.zip} />
              <MarketCard rec={market.subjectBand} />
              <MarketCard rec={market.fastestBand} />
            </div>
            {market.interpretation && <div class="awv2-pi-note"><b>Read:</b> {market.interpretation}</div>}
          </>
        ) : (
          <div class="awv2-pi-note">No LandOS Market Research context was returned for this lead.</div>
        )}
      </section>

      {/* ── Comparable research summary ── */}
      <div class="awv2-grid cols-3-2">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Comparable research</div>
          <div class="awv2-kv">
            <Kv k="LandPortal rows seen" v={comps.landPortalRowsSeen != null ? String(comps.landPortalRowsSeen) : null} />
            <Kv k="Collected" v={comps.totalCollected != null ? String(comps.totalCollected) : null} />
            <Kv k="Duplicates merged" v={comps.duplicatesMerged != null ? String(comps.duplicatesMerged) : null} />
            <Kv k="Final records" v={finalCompCount ? `${finalCompCount} (${soldComps.length} sold · ${activeComps.length} active · ${asking.length} asking)` : null} />
            <Kv k="Research status" v={comps.conclusion || null} />
          </div>
          {comps.summaryLine && <div class="awv2-pi-note">{comps.summaryLine}</div>}
          <div class="awv2-pi-note">Full comparable work continues in Comps &amp; Valuation.</div>
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Comparables map</div>
          {byId.has('inspection-comps_map') ? (
            <figure class="awv2-gallery-item awv2-comps-map" style="margin:0">
              <a href={tok(byId.get('inspection-comps_map')!.viewUrl)} target="_blank" rel="noopener noreferrer" title="Open the Show on Map capture full size (new tab)">
                <img src={tok(byId.get('inspection-comps_map')!.viewUrl)} alt="LandPortal Show on Map comparables" />
              </a>
              <figcaption class="cap"><span>Show on Map comparable page</span></figcaption>
            </figure>
          ) : (
            <div class="awv2-pi-note">No Show on Map capture is on file.</div>
          )}
        </section>
      </div>

      {/* ── Missing diligence, one compact section ── */}
      {(() => {
        const uniqueMissing = [...new Set(missing)];
        const shortMissing = uniqueMissing.filter((m) => m.length <= 64);
        const longMissing = uniqueMissing.filter((m) => m.length > 64);
        return (
          <section class="awv2-missing">
            <div class="awv2-panel-title">Missing diligence</div>
            <div class="awv2-missing-chips">
              {shortMissing.map((m) => <span class="awv2-chip">{m}</span>)}
            </div>
            {longMissing.length > 0 && (
              <ul class="awv2-missing-lines">
                {longMissing.map((m) => <li>{m}</li>)}
              </ul>
            )}
          </section>
        );
      })()}
    </>
  );
}
