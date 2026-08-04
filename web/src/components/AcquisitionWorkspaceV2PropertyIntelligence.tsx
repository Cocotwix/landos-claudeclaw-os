// Acquisition Workspace V2 — Property Intelligence section.
//
// A usable property-research workspace rendered from the latest accepted
// canonical records. The workspace page loads them once (snapshot,
// marketContext, retained soil details) and passes them down, so switching
// sections reuses the already-loaded record instead of refetching.
// Values missing from the canonical data render as honestly missing; nothing
// is fabricated. Market context is labeled as LandOS Market Research and is
// never sourced from LandPortal market panels (SOP 10B).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-preact';
import { dashboardToken } from '@/lib/api';

// ── View types (structural; every field optional and defensive) ────────

export interface PiFact { key: string; value: string; grade: string; label?: string; source?: string; note?: string }
export interface PiDdItem { key: string; label: string; verdict: string; headline: string; detail?: string; missing?: string[] }
export interface PiEvidenceItem { id: string; label: string; viewUrl: string; kind?: string; sourceType?: string; sourceUrl?: string | null }
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

export interface SoilDetail { symbol?: string; name?: string; fields?: Record<string, string> }
export interface BrowseruseResp { soilDetails?: SoilDetail[] }

export interface StreetViewObservationView {
  label: string; detail: string; confidence?: string; evidence?: string;
}
export interface StreetViewView { available: boolean; observations: StreetViewObservationView[] }

export interface MissingDiligenceItemView {
  key: string; label: string; currentFinding: string;
  stillUnresolved: string; whyItMatters: string; nextSource: string;
}
export interface MissingDiligenceView {
  items: MissingDiligenceItemView[];
  evidenceGaps: string[];
  passthrough: string[];
}

export interface VbaObservationView {
  label: string; detail: string; views?: string[]; basis?: string;
}
export interface VisualBuyerAnalysisView {
  generatedAt?: string;
  basedOn?: string[];
  observedFeatures?: VbaObservationView[];
  buyerInterpretation?: VbaObservationView[];
  unresolvedDiligence?: string[];
  buyerPerspective?: {
    strongestAdvantages?: string[]; importantConcerns?: string[];
    bestFitBuyers?: string[]; weakerFitBuyers?: string[];
    preliminaryImpression?: string; materialToValueOrStrategy?: string[];
  };
  evidenceReconciliation?: {
    supportingViews?: string[];
    supersededConclusions?: Array<{ prior: string; reconciled: string; strongerEvidence: string }>;
    remainingUncertain?: string[];
    overallConfidence?: string; confidenceWhy?: string;
  };
  overviewSummary?: { physicalCharacter?: string; mainBuyerAppeal?: string; topConcern?: string };
}

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
  'inspection-default_3d', 'inspection-front_side_3d', 'inspection-rear_side_3d',
  'inspection-street_view', 'inspection-street_view_2', 'inspection-street_view_3',
  'inspection-street_view_4', 'inspection-street_view_5',
  'inspection-buildability', 'inspection-wetlands_overlay',
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

export function PropertyIntelligenceSection({ snap, market, soils, streetView, vba, missingDiligence }: {
  snap: PiSnapshot;
  market: MarketContextView | null;
  soils: SoilDetail[] | null;
  streetView: StreetViewView | null;
  vba: VisualBuyerAnalysisView | null;
  missingDiligence: MissingDiligenceView | null;
}) {
  // Same-page evidence viewer: index into the ordered gallery, or null.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const id = snap.identity || {};
  const address = id.displayAddress || '';
  const zip = num(address, /\b(\d{5})\s*$/);
  const street = address.split(',')[0]?.trim() || '';
  const roadName = street.replace(/^\d+\s+/, '');

  // Acreage values with source, straight from graded facts.
  const facts = snap.facts || [];
  const fact = (key: string): PiFact | undefined => facts.find((f) => f.key === key);
  // Retained LandPortal sidebar values (discovery-stage source, verbatim).
  const sidebar = (name: string): string | null => fact(`lp_sidebar_${name}`)?.value || null;
  const waterFeature = sidebar('water_feature_type');
  const zoningCode = sidebar('zoning_code');
  const femaDescription = sidebar('fema_flood_zone_description');
  const lastSalePrice = sidebar('last_sale_price');
  const lastSaleDate = sidebar('last_sale_date');
  const bookNumber = sidebar('book_number');
  const pageNumber = sidebar('page_number');
  const assessedValue = sidebar('assessed_value');
  const lastSalePriceUsd = lastSalePrice && /^[\d,.]+$/.test(lastSalePrice.trim())
    ? usd(Number(lastSalePrice.replace(/,/g, '')))
    : null;
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
  const hasDefault3d = byId.has('inspection-default_3d');
  const has3d = hasDefault3d || byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d');
  const hasBuildabilityCapture = byId.has('inspection-buildability');
  const hasStreetViewCapture = byId.has('inspection-street_view');

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
  if (!waterFeature) missing.push('Water features');
  missing.push('Building information', 'Wider-context aerial');
  if (!hasStreetViewCapture && streetView?.available !== false) missing.push('Street View capture');
  if (!hasBuildabilityCapture) missing.push('Dedicated buildability capture');

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
            missingDiligence
              ? <div class="awv2-pi-note">Legal access and frontage confirmation is tracked under Missing diligence below.</div>
              : <div class="awv2-pi-note">Still required: {(access?.missing || []).slice(0, 4).join('; ')}{(access?.missing || []).length > 4 ? '…' : ''}</div>
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
            <Kv k="Buildability view" v={hasBuildabilityCapture ? 'Dedicated yellow-overlay capture retained (gallery below)' : null} empty="No dedicated buildability capture" />
            <Kv k="Terrain" v={terrain?.detail || null} />
            <Kv
              k="3D evidence"
              v={has3d
                ? [hasDefault3d ? 'Default 3D view (primary)' : null,
                   byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d') ? 'front/rear 3D views' : null]
                    .filter(Boolean).join(' + ') + ' captured (gallery below)'
                : null}
              empty="No 3D captures"
            />
          </div>
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Environmental &amp; soils</div>
          <div class="awv2-kv">
            <Kv k="Wetlands" v={wetPct ? `${wetPct}%${approxAcres(wetPct) ? ` (≈${approxAcres(wetPct)} ac)` : ''} — parcel panel` : null} />
            <Kv k="FEMA flood" v={floodPct ? `${floodPct}%${approxAcres(floodPct) ? ` (≈${approxAcres(floodPct)} ac)` : ''}${femaDescription ? '' : ' — zone not retained'}` : null} />
            <Kv k="Water feature" v={waterFeature ? `${waterFeature} — LandPortal sidebar` : null} empty="Not retained" />
            <Kv k="Contours" v={byId.has('inspection-contour_terrain_view') ? 'Contour view captured (gallery below)' : null} empty="No contour capture" />
          </div>
          {femaDescription && (
            <div class="awv2-pi-note"><b>FEMA flood zone description (LandPortal):</b> {femaDescription}</div>
          )}
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

      {/* ── Zoning, sale history, and assessment (LandPortal sidebar) ── */}
      <div class="awv2-grid cols-3">
        <section class="awv2-panel">
          <div class="awv2-panel-title">Zoning &amp; land use <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Zoning code" v={zoningCode} empty="Not retained" />
            <Kv k="Official zoning" v={zoning && zoning.verdict !== 'unknown' && zoning.verdict !== 'unresolved' ? zoning.headline : null} empty="Not confirmed — official record pending" />
          </div>
          {zoningCode && (
            <div class="awv2-pi-note">
              Displayed LandPortal sidebar value, stored verbatim. Discovery-stage
              data only; it is not an official zoning determination.
            </div>
          )}
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Sale &amp; deed history <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Last sale price" v={lastSalePrice ? `${lastSalePriceUsd ? `${lastSalePriceUsd} · ` : ''}displayed “${lastSalePrice}”` : null} empty="Not retained" />
            <Kv k="Last sale date" v={lastSaleDate} empty="Not retained" />
            <Kv k="Book number" v={bookNumber} empty="Not retained" />
            <Kv k="Page number" v={pageNumber} empty="Not retained" />
          </div>
          {(lastSalePrice || bookNumber) && (
            <div class="awv2-pi-note">
              Values as displayed on the LandPortal sidebar. The recorded deed
              remains the stronger source once retrieved.
            </div>
          )}
        </section>

        <section class="awv2-panel">
          <div class="awv2-panel-title">Value &amp; assessment <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Assessed value" v={assessedValue} empty="Not retained" />
            <Kv k="LandPortal estimate" v={fact('lpEstimateTotal')?.value || null} empty="Not retained" />
          </div>
          {assessedValue && (
            <div class="awv2-pi-note">
              Assessed value as displayed on the LandPortal sidebar; county
              assessment rolls remain the stronger official source.
            </div>
          )}
        </section>
      </div>

      {/* ── Visual evidence ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">Visual evidence <span class="awv2-src-tag">LandPortal · verified subject</span></div>
        {gallery.length > 0 ? (
          <div class="awv2-gallery">
            {gallery.map((e, index) => (
              <figure class="awv2-gallery-item" style="margin:0">
                <button
                  type="button"
                  class="awv2-gallery-open"
                  onClick={() => setViewerIndex(index)}
                  title={`Open ${e.label} in the evidence viewer`}
                >
                  <img src={tok(e.viewUrl)} alt={e.label} loading="lazy" />
                </button>
                <figcaption class="cap"><span>{e.label}</span>{e.kind && <span class="tag">{e.kind}</span>}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div class="awv2-pi-note">No accepted visual evidence is on file for this parcel.</div>
        )}
      </section>

      {/* ── Street View observations ── */}
      <section class="awv2-panel">
        <div class="awv2-panel-title">
          Street View observations <span class="awv2-src-tag">G Maps Street View via LandPortal</span>
        </div>
        {streetView ? (
          streetView.available ? (
            <>
              <div class="awv2-pi-note">
                {hasStreetViewCapture
                  ? 'Street View was scanned along the subject frontage; captures are in the gallery above.'
                  : 'Street View observations were recorded; no capture is retained yet.'}
              </div>
              {streetView.observations.filter((o) => !/unavailable/i.test(o.label)).map((o) => (
                <div class="awv2-pi-note">
                  <b>{o.label}:</b> {o.detail}
                  {o.evidence && <span class="awv2-sv-basis"> — {o.evidence}</span>}
                </div>
              ))}
            </>
          ) : (
            <div class="awv2-pi-note">
              <b>Street View unavailable.</b>{' '}
              {streetView.observations.find((o) => /unavailable/i.test(o.label))?.detail
                || 'LandPortal Street View was not available for this subject frontage.'}
            </div>
          )
        ) : (
          <div class="awv2-pi-note">No Street View pass has been recorded for this subject yet.</div>
        )}
      </section>

      {/* ── Visual Buyer Analysis (multi-view) ── */}
      <section class="awv2-panel" id="visual-buyer-analysis">
        <div class="awv2-panel-title">
          Visual Buyer Analysis <span class="awv2-src-tag">Multi-view · {vba?.basedOn?.length ?? 0} evidence categories</span>
        </div>
        {vba ? (
          <div class="awv2-vba">
            <div class="awv2-vba-col">
              <div class="h brass">A · Directly observed features</div>
              {(vba.observedFeatures || []).map((o) => (
                <div class="awv2-pi-note"><b>{o.label}:</b> {o.detail}{o.views?.length ? <span class="awv2-sv-basis"> — {o.views.join(', ')}</span> : null}</div>
              ))}
              <div class="h brass" style="margin-top:12px">B · Buyer-oriented interpretation</div>
              {(vba.buyerInterpretation || []).map((o) => (
                <div class="awv2-pi-note"><b>{o.label}:</b> {o.detail}</div>
              ))}
            </div>
            <div class="awv2-vba-col">
              <div class="h rust">C · Unresolved diligence</div>
              <ul>{(vba.unresolvedDiligence || []).map((d) => <li>{d}</li>)}</ul>
              <div class="h brass" style="margin-top:12px">D · Potential buyer perspective</div>
              <div class="awv2-pi-note"><b>Strongest advantages:</b> {(vba.buyerPerspective?.strongestAdvantages || []).join('; ')}</div>
              <div class="awv2-pi-note"><b>Most important concerns:</b> {(vba.buyerPerspective?.importantConcerns || []).join('; ')}</div>
              <div class="awv2-pi-note"><b>Best-fit buyers:</b> {(vba.buyerPerspective?.bestFitBuyers || []).join('; ')}</div>
              <div class="awv2-pi-note"><b>Weaker-fit buyers:</b> {(vba.buyerPerspective?.weakerFitBuyers || []).join('; ')}</div>
              <div class="awv2-pi-note"><b>Preliminary impression:</b> {vba.buyerPerspective?.preliminaryImpression || '—'}</div>
              <div class="awv2-pi-note"><b>Would materially change value or strategy:</b> {(vba.buyerPerspective?.materialToValueOrStrategy || []).join('; ')}</div>
              <div class="h" style="margin-top:12px">E · Confidence &amp; evidence reconciliation</div>
              <div class="awv2-pi-note"><b>Supported by:</b> {(vba.evidenceReconciliation?.supportingViews || []).join(', ')}</div>
              {(vba.evidenceReconciliation?.supersededConclusions || []).map((s) => (
                <div class="awv2-pi-note"><b>Superseded:</b> {s.prior} → <b>{s.reconciled}</b> <span class="awv2-sv-basis">({s.strongerEvidence})</span></div>
              ))}
              <div class="awv2-pi-note"><b>Still uncertain:</b> {(vba.evidenceReconciliation?.remainingUncertain || []).join('; ')}</div>
              <div class="awv2-pi-note"><b>Overall confidence:</b> {vba.evidenceReconciliation?.overallConfidence || '—'} — {vba.evidenceReconciliation?.confidenceWhy || ''}</div>
            </div>
          </div>
        ) : (
          <div class="awv2-pi-note">No multi-view Visual Buyer Analysis has been produced for this subject yet.</div>
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
              <button
                type="button"
                class="awv2-gallery-open"
                onClick={() => setViewerIndex(gallery.findIndex((e) => e.id === 'inspection-comps_map'))}
                title="Open the Show on Map capture in the evidence viewer"
              >
                <img src={tok(byId.get('inspection-comps_map')!.viewUrl)} alt="LandPortal Show on Map comparables" />
              </button>
              <figcaption class="cap"><span>Show on Map comparable page</span></figcaption>
            </figure>
          ) : (
            <div class="awv2-pi-note">No Show on Map capture is on file.</div>
          )}
        </section>
      </div>

      {/* ── Missing diligence: reconciled operator checklist ── */}
      {missingDiligence ? (
        <section class="awv2-missing">
          <div class="awv2-panel-title">
            Missing diligence <span class="awv2-src-tag">Reconciled against accepted research</span>
          </div>
          <div class="awv2-md-grid">
            {missingDiligence.items.map((item) => (
              <div class="awv2-md-item">
                <div class="t">{item.label}</div>
                <div class="row"><span class="k">Current finding</span><span class="v">{item.currentFinding}</span></div>
                <div class="row"><span class="k">Still unresolved</span><span class="v">{item.stillUnresolved}</span></div>
                <div class="row"><span class="k">Why it matters</span><span class="v">{item.whyItMatters}</span></div>
                <div class="row"><span class="k">Next source</span><span class="v">{item.nextSource}</span></div>
              </div>
            ))}
          </div>
          {missingDiligence.evidenceGaps.length > 0 && (
            <div class="awv2-missing-chips" style="margin-top:12px">
              {missingDiligence.evidenceGaps.map((m) => <span class="awv2-chip">{m}</span>)}
            </div>
          )}
          {missingDiligence.passthrough.length > 0 && (
            <ul class="awv2-missing-lines">
              {missingDiligence.passthrough.map((m) => <li>{m}</li>)}
            </ul>
          )}
        </section>
      ) : (() => {
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

      {viewerIndex != null && gallery[viewerIndex] && (
        <EvidenceViewer
          items={gallery}
          index={viewerIndex}
          onNavigate={(next) => setViewerIndex(next)}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}

// ── Same-page evidence viewer ──────────────────────────────────────────
//
// A large in-page lightbox over the workspace: largest retained image at
// natural aspect ratio, zoom in/out/reset, wheel zoom, pointer panning,
// previous/next, category + caption + source, close button and Escape.
// No navigation away, no new tab, no external image library.

const VIEWER_MIN_SCALE = 1;
const VIEWER_MAX_SCALE = 8;
const VIEWER_STEP = 1.4;

function EvidenceViewer({ items, index, onNavigate, onClose }: {
  items: PiEvidenceItem[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Live index for the once-registered keydown listener: rapid successive
  // presses must never hit a stale closure between effect flushes.
  const indexRef = useRef(index);
  indexRef.current = index;

  const clampScale = (value: number) => Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, value));
  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const zoomIn = () => setScale((s) => clampScale(s * VIEWER_STEP));
  const zoomOut = () => setScale((s) => {
    const next = clampScale(s / VIEWER_STEP);
    if (next === VIEWER_MIN_SCALE) setOffset({ x: 0, y: 0 });
    return next;
  });
  const prev = () => { resetView(); onNavigate((indexRef.current - 1 + items.length) % items.length); };
  const next = () => { resetView(); onNavigate((indexRef.current + 1) % items.length); };

  // Keyboard: Escape closes; arrows navigate. Focus starts on the close
  // control so keyboard users are inside the dialog immediately. The page
  // behind the modal stays scroll-locked while the viewer is open.
  useEffect(() => {
    closeRef.current?.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); resetView(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = priorOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  };
  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.baseX + (e.clientX - drag.current.startX),
      y: drag.current.baseY + (e.clientY - drag.current.startY),
    });
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div class="awv2-viewer" role="dialog" aria-modal="true" aria-label={`Evidence viewer: ${item.label}`}>
      <div class="awv2-viewer-backdrop" onClick={onClose} />
      <div class="awv2-viewer-body">
        <div
          class={`awv2-viewer-stage${scale > 1 ? ' zoomed' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={tok(item.viewUrl)}
            alt={item.label}
            draggable={false}
            style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${scale});`}
          />
        </div>

        <div class="awv2-viewer-meta">
          {item.kind && <span class="cat">{item.kind}</span>}
          <span class="cap">{item.label}</span>
          <span class="src">
            {item.sourceType || 'LandPortal · verified subject'}
            {item.sourceUrl ? (
              <>
                {' · '}
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">source</a>
              </>
            ) : null}
          </span>
          <span class="pos">{index + 1} / {items.length}</span>
        </div>

        <div class="awv2-viewer-controls" role="toolbar" aria-label="Evidence viewer controls">
          <button type="button" onClick={prev} title="Previous image (←)" aria-label="Previous image"><ChevronLeft size={18} /></button>
          <button type="button" onClick={zoomOut} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={18} /></button>
          <button type="button" onClick={resetView} title="Reset to fit (0)" aria-label="Reset to fit"><Maximize2 size={18} /></button>
          <button type="button" onClick={zoomIn} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={18} /></button>
          <button type="button" onClick={next} title="Next image (→)" aria-label="Next image"><ChevronRight size={18} /></button>
        </div>

        <button ref={closeRef} type="button" class="awv2-viewer-close" onClick={onClose} title="Close (Esc)" aria-label="Close evidence viewer">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
