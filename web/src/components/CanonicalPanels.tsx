// Canonical shared-record panels — comp registry, strategy readiness, document
// viewer, research mission, and the Reconcile action. Every panel renders the
// backend's canonical records (deal-card-canonical.ts); nothing re-derives a
// business conclusion client-side.

import { useEffect, useState } from 'preact/hooks';
import { apiPost } from '../lib/api';

// ── Types (mirror the canonical backend records) ──────────────────────────────

export interface UniqueCompView {
  key: string;
  matchedBy: string;
  address: string | null;
  apn: string | null;
  state: string | null;
  acres: number | null;
  acresDisplay?: number | null;
  transactions: Array<{ kind: string; price: number | null; pricePerAcre: number | null; dateIso: string | null; providers: string[]; sourceUrls: string[]; mergedCandidates: number }>;
  primary: { kind: string; price: number | null; pricePerAcre: number | null; dateIso: string | null; providers: string[] };
  providers: string[];
  providersDisplay?: string[];
  sourceConfidence: string;
  comparability?: string;
  comparabilityWhy?: string;
}

export interface CompClusterView {
  id: string;
  label: string;
  acreageRange: { min: number; max: number };
  closedSales: number;
  totalSoldAcres: number;
  totalSoldPrice: number;
  weightedPricePerAcre: number | null;
  medianPricePerAcre: number | null;
  subjectPosition: string;
  geography: string;
  inclusionRationale: string;
  confidence: string;
  limitations: string[];
  compKeys: string[];
}

export interface CompRegistryView {
  uniqueComps: UniqueCompView[];
  validatedSold: UniqueCompView[];
  validatedActive: UniqueCompView[];
  rejected: Array<{ provider: string; address: string | null; price: number | null; reason: string }>;
  duplicateMerges: Array<{ keptAddress: string | null; matchedBy: string; providers: string[]; mergedCount: number }>;
  providerCoverage: Array<{ provider: string; candidates: number; validated: number; rejected: number }>;
  counts: { rawCandidates: number; uniqueProperties: number; validatedSold: number; validatedActive: number; rejected: number; duplicatesMerged: number };
  valuationReady: boolean;
  valuationBlockers: string[];
  clusterAnalysis?: {
    clusters: CompClusterView[];
    primaryClusterId: string | null;
    thinMarketSupported: boolean;
    excludedSegments: string[];
    note: string;
  } | null;
  summaryLine: string;
}

const COMPARABILITY_META: Record<string, { label: string; color: string }> = {
  direct_comparable: { label: 'Direct comparable', color: '#2fbf71' },
  secondary_local_comparable: { label: 'Secondary local', color: '#4aa8ff' },
  small_lot_context: { label: 'Small-lot context', color: '#c792ea' },
  large_acreage_context: { label: 'Large-acreage context', color: '#f0a52e' },
  weak_context: { label: 'Weak context', color: '#7d838f' },
};

export interface StrategyReadinessView {
  strategies: Array<{ strategy: string; status: string; why: string; blockers: string[]; requiredEvidence: string[] }>;
  pricingAllowed: boolean;
  pricingBlockers: string[];
  decision: string;
  decisionWhy: string;
  summaryLine: string;
}

export interface UnifiedReadinessView {
  dimensions: Array<{ key: string; label: string; state: string; stateLabel: string; tone: 'good' | 'caution' | 'risk' | 'unknown'; why: string; blockers: string[] }>;
  materiality: Array<{ factor: string; status: string; effect: string }>;
  blockedStrategyCount: number;
  strategyTotal: number;
  allStrategiesBlocked: boolean;
  summaryLine: string;
  consistencyIssues: string[];
}

export interface DocumentRegistryView {
  documents: Array<{
    id: string; category: string; title: string; docType: string; source: string; officialUrl: string | null;
    pages: Array<{ pageNumber: number; file: string }>; pageCount: number;
    captureDate: string | null; documentDate: string | null; reviewState: string; ocrState: string;
    extractionConfidence?: string | null;
    findings: Array<{ label: string; detail: string; sourceUrl: string | null; pageNumber?: number | null; pageNumbers?: number[] }>;
    legalLimitation: string; superseded: boolean;
    uploaded?: boolean;
  }>;
  researchTasks: Array<{ title: string; why: string; owner: string; state: string }>;
  summaryLine: string;
}

export interface MissionViewT {
  current: {
    startedAt: number | null; endedAt: number | null; status: string;
    accepted: MissionEvent[]; rejected: MissionEvent[]; superseded: MissionEvent[]; failed: MissionEvent[]; pending: MissionEvent[];
  };
  history: MissionEvent[];
  counts: Record<string, number>;
}
interface MissionEvent { id: number; kind: string; kindLabel: string; summary: string; agentId: string; createdAt: number; classification: string; occurrences: number }

export interface ModelVersionView { current: number; card: number; needsReconcile: boolean; reasons: string[] }

const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toLocaleString()}` : '—');
const dateShort = (iso: string | null) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : iso;
};

// ── Comp registry (Market tab) ────────────────────────────────────────────────

export function CompRegistryPanel({ registry, sharedValue }: { registry: CompRegistryView | null; sharedValue?: { state: string; stateLabel: string; why: string } | null }) {
  const [showRejected, setShowRejected] = useState(false);
  if (!registry) return null;
  const c = registry.counts;
  // The Market chip renders the SHARED value readiness when supplied — the
  // registry count gate alone (a computable median) never reads "Valuation
  // ready" while the shared record says value readiness is not ready.
  const chipReady = sharedValue ? sharedValue.state === 'ready' : registry.valuationReady;
  const chipLabel = sharedValue
    ? (chipReady ? 'Valuation ready' : `Value readiness: ${sharedValue.stateLabel.toLowerCase()}`)
    : (registry.valuationReady ? 'Valuation ready' : 'Valuation not ready');
  const chipTitle = sharedValue
    ? `${sharedValue.why}${registry.valuationReady && !chipReady ? ' (The sold-count gate is met, but a computable median is preliminary context only.)' : ''}`
    : '';
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Unique comparable registry</div>
        <span class={`text-[11.5px] px-2 py-0.5 rounded-full font-semibold border ${chipReady ? 'text-[#2fbf71] border-[#2fbf7155]' : 'text-[#f0a52e] border-[#f0a52e55]'}`} title={chipTitle}>
          {chipLabel}
        </span>
      </div>
      <p class="text-[13.5px] leading-relaxed text-[var(--color-text)]">{registry.summaryLine}</p>
      {!registry.valuationReady && registry.valuationBlockers.length > 0 && (
        <ul class="space-y-1">
          {registry.valuationBlockers.map((b) => (
            <li class="text-[12.5px] leading-relaxed text-[#f0a52e] pl-4 relative">
              <span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#f0a52e]" />{b}
            </li>
          ))}
        </ul>
      )}

      {/* Validated unique comps */}
      {registry.uniqueComps.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-[12.5px]">
            <thead>
              <tr class="text-left text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-text-faint)]">
                <th class="pr-3 pb-1.5 font-semibold">Property</th>
                <th class="pr-3 pb-1.5 font-semibold">Status</th>
                <th class="pr-3 pb-1.5 font-semibold">Price</th>
                <th class="pr-3 pb-1.5 font-semibold">Acres</th>
                <th class="pr-3 pb-1.5 font-semibold">$/ac</th>
                <th class="pr-3 pb-1.5 font-semibold">Date</th>
                  <th class="text-left py-1.5">Source confidence</th>
                <th class="pr-3 pb-1.5 font-semibold" title="Subject comparability — separate from source confidence">Comparability</th>
                <th class="pb-1.5 font-semibold">Sources</th>
              </tr>
            </thead>
            <tbody>
              {registry.uniqueComps.map((comp) => (
                <tr key={comp.key} class="border-t border-[var(--color-border)] align-top">
                  <td class="pr-3 py-1.5 text-[var(--color-text)] max-w-[260px]">
                    {comp.transactions[0]?.sourceUrls?.[0]
                      ? <a href={comp.transactions[0].sourceUrls[0]} target="_blank" rel="noreferrer" class="hover:underline">{comp.address ?? comp.apn ?? 'Unnamed parcel'}</a>
                      : (comp.address ?? comp.apn ?? 'Unnamed parcel')}
                  </td>
                  <td class="pr-3 py-1.5">
                    <span class={`text-[10.5px] font-bold px-1.5 py-0.5 rounded ${comp.primary.kind === 'sold' ? 'bg-[#2fbf7122] text-[#2fbf71]' : 'bg-[#4aa8ff22] text-[#4aa8ff]'}`}>
                      {comp.primary.kind === 'sold' ? 'SOLD' : 'ACTIVE'}
                    </span>
                  </td>
                  <td class="pr-3 py-1.5 text-[var(--color-text)]">{money(comp.primary.price)}</td>
                  <td class="pr-3 py-1.5 text-[var(--color-text-muted)]">{comp.acresDisplay ?? (comp.acres != null ? Math.round(comp.acres * 100) / 100 : '—')}</td>
                  <td class="pr-3 py-1.5 text-[var(--color-text-muted)]">{comp.primary.pricePerAcre != null ? `$${Math.round(comp.primary.pricePerAcre).toLocaleString()}` : '—'}</td>
                  <td class="pr-3 py-1.5 text-[var(--color-text-muted)]">{dateShort(comp.primary.dateIso)}</td>
                  <td class="pr-3 py-1.5">
                    {comp.comparability && (
                      <span
                        class="text-[10.5px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                        style={`background:${(COMPARABILITY_META[comp.comparability] ?? COMPARABILITY_META.weak_context).color}22;color:${(COMPARABILITY_META[comp.comparability] ?? COMPARABILITY_META.weak_context).color}`}
                        title={comp.comparabilityWhy ?? ''}
                      >
                        {(COMPARABILITY_META[comp.comparability] ?? COMPARABILITY_META.weak_context).label}
                      </span>
                    )}
                  </td>
                  <td class="py-1.5 text-[var(--color-text-muted)]">{comp.sourceConfidence}</td>
                  <td class="py-1.5 text-[var(--color-text-muted)]">
                    {(comp.providersDisplay ?? comp.providers).join(' + ')}
                    {comp.transactions.some((t) => t.mergedCandidates > 1) && (
                      <span class="ml-1 text-[10px] text-[var(--color-text-faint)]" title="Duplicate provider rows merged into one transaction">(merged)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Thin-market acreage clusters over the validated closed sales — the
          honest local pricing patterns; materially different acreage segments
          are never blended into one average. */}
      {registry.clusterAnalysis && registry.clusterAnalysis.clusters.length > 0 && (
        <div class="rounded-md border border-[var(--color-border)] p-3 space-y-2">
          <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Local acreage clusters (closed sales)</div>
          <div class="text-[12.5px] leading-relaxed text-[var(--color-text)]">{registry.clusterAnalysis.note}</div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {registry.clusterAnalysis.clusters.map((cl) => {
              const primary = cl.id === registry.clusterAnalysis!.primaryClusterId;
              const confColor = cl.confidence === 'supported' ? '#2fbf71' : cl.confidence === 'thin' ? '#f0a52e' : '#ff5f56';
              return (
                <div key={cl.id} class="rounded-md border border-[var(--color-border)] p-2.5" style={primary ? 'border-left:4px solid #4aa8ff' : ''}>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[12.5px] font-semibold text-[var(--color-text)]">{cl.label}</span>
                    {primary && <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#4aa8ff22] text-[#4aa8ff]">PRIMARY</span>}
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style={`background:${confColor}22;color:${confColor}`}>{cl.confidence}</span>
                  </div>
                  <div class="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--color-text-muted)]">
                    <span>Closed sales: <span class="text-[var(--color-text)]">{cl.closedSales}</span></span>
                    <span>Total sold: <span class="text-[var(--color-text)]">{money(cl.totalSoldPrice)}</span></span>
                    <span>Total acreage: <span class="text-[var(--color-text)]">{cl.totalSoldAcres} ac</span></span>
                    <span>Weighted $/ac: <span class="text-[var(--color-text)]">{cl.closedSales >= 3 && cl.weightedPricePerAcre != null ? money(cl.weightedPricePerAcre) : 'Insufficient sample'}</span></span>
                    <span>Median $/ac: <span class="text-[var(--color-text)]">{cl.closedSales >= 3 && cl.medianPricePerAcre != null ? money(cl.medianPricePerAcre) : 'Insufficient sample'}</span></span>
                    <span>Subject position: <span class="text-[var(--color-text)]">{cl.subjectPosition}</span></span>
                  </div>
                  <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-faint)]">{cl.inclusionRationale}</div>
                  {cl.limitations.map((lim) => (
                    <div class="mt-0.5 text-[11px] leading-relaxed text-[#f0a52e]">• {lim}</div>
                  ))}
                </div>
              );
            })}
          </div>
          {registry.clusterAnalysis.excludedSegments.length > 0 && (
            <div class="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              Kept as separate context (never blended): {registry.clusterAnalysis.excludedSegments.join(' ')}
            </div>
          )}
        </div>
      )}

      {/* Provider coverage */}
      <div class="flex flex-wrap gap-1.5">
        {registry.providerCoverage.map((p) => (
          <span key={p.provider} class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)]" title={`${p.candidates} candidates, ${p.validated} validated, ${p.rejected} rejected`}>
            {p.provider}: {p.validated}/{p.candidates}{p.rejected ? ` (${p.rejected} rejected)` : ''}
          </span>
        ))}
      </div>

      {/* Rejected audit */}
      {registry.rejected.length > 0 && (
        <div>
          <button type="button" class="text-[12px] text-[var(--color-accent)]" onClick={() => setShowRejected(!showRejected)}>
            {showRejected ? 'Hide' : 'Show'} {registry.rejected.length} rejected candidate(s) + reasons
          </button>
          {showRejected && (
            <ul class="mt-2 space-y-1">
              {registry.rejected.map((r, i) => (
                <li key={i} class="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  <span class="text-[#ff8a84] font-semibold">{r.provider}</span> — {r.address ?? 'no address'} {r.price != null ? `(${money(r.price)})` : ''}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {registry.duplicateMerges.length > 0 && (
        <div class="text-[11.5px] text-[var(--color-text-faint)]">
          {registry.counts.duplicatesMerged} duplicate provider row(s) merged across {registry.duplicateMerges.length} propert{registry.duplicateMerges.length === 1 ? 'y' : 'ies'} — the same sale seen through multiple providers counts once.
        </div>
      )}
    </div>
  );
}

// ── Unified readiness strip (every tab renders the SAME shared record) ────────

const READINESS_TONE_COLOR: Record<string, string> = {
  good: '#2fbf71',
  caution: '#f0a52e',
  risk: '#ff5f56',
  unknown: '#7d838f',
};

export function UnifiedReadinessStrip({ readiness, context }: { readiness: UnifiedReadinessView | null; context?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!readiness) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-card)] p-3.5 space-y-2.5">
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Readiness (shared record)</span>
        {context && <span class="text-[10.5px] text-[var(--color-text-faint)]">{context}</span>}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        {readiness.dimensions.map((d) => {
          const color = READINESS_TONE_COLOR[d.tone] ?? READINESS_TONE_COLOR.unknown;
          const expanded = open === d.key;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => setOpen(expanded ? null : d.key)}
              class="text-left rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-strong)] p-2.5"
              style={`border-left:4px solid ${color}`}
              title={d.why}
            >
              <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)]">{d.label}</div>
              <div class="mt-0.5 text-[12.5px] font-semibold" style={`color:${color}`}>{d.stateLabel}</div>
              <div class={`mt-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)] ${expanded ? '' : 'line-clamp-2'}`}>{d.why}</div>
              {expanded && d.blockers.length > 0 && (
                <ul class="mt-1.5 space-y-0.5">
                  {d.blockers.map((b) => <li class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">• {b}</li>)}
                </ul>
              )}
            </button>
          );
        })}
      </div>
      {readiness.materiality.length > 0 && (
        <div>
          <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)] mb-1">Material facts lowering readiness</div>
          <ul class="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-0.5">
            {readiness.materiality.map((m) => (
              <li class="text-[11.5px] leading-relaxed text-[var(--color-text-muted)] pl-3 relative">
                <span class="absolute left-0 top-[7px] w-1 h-1 rounded-full bg-[#f0a52e]" />
                <span class="font-semibold text-[var(--color-text)]">{m.factor.replace(/_/g, ' ')}</span> ({m.status}): {m.effect}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Strategy readiness (Strategy tab) ─────────────────────────────────────────

const STRATEGY_STATUS_META: Record<string, { label: string; color: string }> = {
  blocked: { label: 'Blocked', color: '#f0a52e' },
  provisional: { label: 'Provisional', color: '#4aa8ff' },
  viable: { label: 'Viable', color: '#2fbf71' },
  weak: { label: 'Weak', color: '#c792ea' },
  not_viable: { label: 'Not viable', color: '#ff5f56' },
};

export function StrategyReadinessPanel({ readiness }: { readiness: StrategyReadinessView | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!readiness) return null;
  const decisionLabel = readiness.decision === 'continue_research' ? 'Continue research' : readiness.decision === 'tyler_review' ? 'Tyler review' : 'Archive';
  return (
    <div class="space-y-3">
      <div class="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-card)] p-4">
        <div class="flex flex-wrap items-center gap-2 mb-1.5">
          <span class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Current decision</span>
          <span class="text-[12px] px-2 py-0.5 rounded-full font-semibold border border-[var(--color-accent)] text-[var(--color-accent)]">{decisionLabel}</span>
          {!readiness.pricingAllowed && (
            <span class="text-[12px] px-2 py-0.5 rounded-full font-semibold border border-[#f0a52e55] text-[#f0a52e]">Pricing gated — no offer numbers yet</span>
          )}
        </div>
        <p class="text-[13.5px] leading-relaxed text-[var(--color-text)]">{readiness.decisionWhy}</p>
        {!readiness.pricingAllowed && readiness.pricingBlockers.length > 0 && (
          <ul class="mt-2 space-y-1">
            {readiness.pricingBlockers.map((b) => (
              <li class="text-[12.5px] leading-relaxed text-[#f0a52e] pl-4 relative">
                <span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#f0a52e]" />{b}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
        {readiness.strategies.map((s) => {
          const meta = STRATEGY_STATUS_META[s.status] ?? STRATEGY_STATUS_META.blocked;
          const expanded = open === s.strategy;
          return (
            <button
              key={s.strategy}
              type="button"
              onClick={() => setOpen(expanded ? null : s.strategy)}
              class="text-left rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] p-3"
              style={`border-left:4px solid ${meta.color}`}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-[12.5px] font-semibold text-[var(--color-text)]">{s.strategy}</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={`background:${meta.color}22;color:${meta.color}`}>{meta.label}</span>
              </div>
              <div class={`mt-1.5 text-[12px] leading-relaxed text-[var(--color-text-muted)] ${expanded ? '' : 'line-clamp-3'}`}>{s.why}</div>
              {expanded && (
                <div class="mt-2 space-y-1.5">
                  {s.blockers.length > 0 && (
                    <div>
                      <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[#f0a52e]">Blockers</div>
                      <ul class="mt-0.5 space-y-0.5">{s.blockers.map((b) => <li class="text-[11.5px] text-[var(--color-text-muted)]">• {b}</li>)}</ul>
                    </div>
                  )}
                  <div>
                    <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)]">Required evidence</div>
                    <ul class="mt-0.5 space-y-0.5">{s.requiredEvidence.map((e) => <li class="text-[11.5px] text-[var(--color-text-muted)]">• {e}</li>)}</ul>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Document registry + county deed page viewer (Documents tab) ───────────────

export function DocumentRegistryPanel({ registry, dealId, token }: { registry: DocumentRegistryView | null; dealId: number; token: string }) {
  const [viewer, setViewer] = useState<{ docId: string; page: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setZoom(1); }, [viewer?.docId, viewer?.page]);
  if (!registry) return null;
  const pageSrc = (file: string) => `/api/landos/deal-cards/${dealId}/document-page/${encodeURIComponent(file)}?token=${encodeURIComponent(token)}`;
  const viewerDoc = viewer ? registry.documents.find((d) => d.id === viewer.docId) ?? null : null;
  const viewerPage = viewerDoc?.pages.find((p) => p.pageNumber === viewer!.page) ?? null;

  return (
    <div class="space-y-3">
      <p class="text-[13.5px] leading-relaxed text-[var(--color-text)]">{registry.summaryLine}</p>

      {registry.documents.map((doc) => (
        <div key={doc.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="text-[14.5px] font-semibold text-[var(--color-text)]">{doc.title}</span>
            <span class="text-[11.5px] px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)] uppercase tracking-[0.05em]">{doc.category}</span>
            <span class={`text-[11.5px] px-2 py-0.5 rounded-full border ${doc.reviewState === 'reviewed' ? 'text-[#2fbf71] border-[#2fbf7155]' : 'text-[#f0a52e] border-[#f0a52e55]'}`}>
              {doc.reviewState === 'reviewed' ? 'Scanned for findings' : 'Pending review'}
            </span>
            <span class="text-[11.5px] px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)]" title="OCR / text extraction status">
              OCR: {doc.ocrState === 'scanned_for_findings' ? `scanned${doc.extractionConfidence ? ` (${doc.extractionConfidence} extraction confidence)` : ''}` : 'not processed'}
            </span>
            {doc.uploaded && <span class="text-[11.5px] px-2 py-0.5 rounded-full border border-[#c792ea55] text-[#c792ea]">Operator upload</span>}
            {doc.pageCount > 0 && <span class="text-[12px] text-[var(--color-text-muted)]">{doc.pageCount} official page{doc.pageCount === 1 ? '' : 's'} captured</span>}
            {doc.documentDate && <span class="text-[12px] text-[var(--color-text-faint)]">Recorded {doc.documentDate}</span>}
            {doc.officialUrl && (
              <a href={doc.officialUrl} target="_blank" rel="noreferrer" class="text-[12px] text-[var(--color-accent)] hover:underline">Open official source ↗</a>
            )}
          </div>

          {/* Page previews */}
          {doc.pages.length > 0 && (
            <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {doc.pages.map((p) => (
                <button
                  key={p.file}
                  type="button"
                  onClick={() => setViewer({ docId: doc.id, page: p.pageNumber })}
                  class="rounded-md overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-accent)] bg-white"
                  title={`Open page ${p.pageNumber} full-screen`}
                >
                  <img src={pageSrc(p.file)} alt={`Deed page ${p.pageNumber}`} class="w-full aspect-[3/4] object-cover object-top" loading="lazy" />
                  <div class="text-[10.5px] py-0.5 text-center bg-[var(--color-card)] text-[var(--color-text-muted)]">p. {p.pageNumber}</div>
                </button>
              ))}
            </div>
          )}

          {/* Findings linked to the actual document */}
          {doc.findings.length > 0 && (
            <div>
              <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-1.5">Exact findings from this document</div>
              <ul class="space-y-1.5">
                {doc.findings.map((f, i) => (
                  <li key={i} class="text-[12.5px] leading-relaxed text-[var(--color-text)]">
                    <span class="font-semibold">{f.label}:</span> <span class="text-[var(--color-text-muted)]">{f.detail}</span>
                    {(f.pageNumbers?.length ? f.pageNumbers : f.pageNumber != null ? [f.pageNumber] : []).filter((n) => doc.pages.some((p) => p.pageNumber === n)).map((n) => (
                      <button
                        key={n}
                        type="button"
                        class="ml-1.5 text-[11px] text-[var(--color-accent)] underline"
                        onClick={() => setViewer({ docId: doc.id, page: n })}
                        title={`Open cited page ${n} full-screen`}
                      >
                        p. {n} ↗
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div class="text-[11.5px] leading-relaxed text-[var(--color-text-faint)]">{doc.legalLimitation}</div>
        </div>
      ))}

      {/* Open document-research tasks */}
      {registry.researchTasks.length > 0 && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2">Open document research</div>
          <ul class="space-y-2">
            {registry.researchTasks.map((t, i) => (
              <li key={i} class="text-[12.5px] leading-relaxed">
                <div class="flex items-center gap-2">
                  <span class={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.owner === 'tyler' ? 'bg-[#c792ea22] text-[#c792ea]' : 'bg-[#4aa8ff22] text-[#4aa8ff]'}`}>
                    {t.owner === 'tyler' ? 'TYLER DECISION' : 'LANDOS'}
                  </span>
                  <span class="font-medium text-[var(--color-text)]">{t.title}</span>
                </div>
                <div class="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{t.why}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Full-screen viewer with zoom + page navigation */}
      {viewer && viewerDoc && viewerPage && (
        <div class="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setViewer(null)}>
          <div class="flex items-center justify-between px-4 py-2.5 bg-[var(--color-card)] border-b border-[var(--color-border)]" onClick={(e) => e.stopPropagation()}>
            <div class="text-[13.5px] font-semibold text-[var(--color-text)]">
              {viewerDoc.title} — page {viewer.page} of {viewerDoc.pageCount}
            </div>
            <div class="flex items-center gap-2">
              <button type="button" class="px-2.5 py-1 text-[13px] rounded border border-[var(--color-border-strong)] text-[var(--color-text)] disabled:opacity-40" disabled={viewer.page <= 1} onClick={() => setViewer({ ...viewer, page: viewer.page - 1 })}>← Prev</button>
              <button type="button" class="px-2.5 py-1 text-[13px] rounded border border-[var(--color-border-strong)] text-[var(--color-text)] disabled:opacity-40" disabled={viewer.page >= viewerDoc.pageCount} onClick={() => setViewer({ ...viewer, page: viewer.page + 1 })}>Next →</button>
              <button type="button" class="px-2.5 py-1 text-[13px] rounded border border-[var(--color-border-strong)] text-[var(--color-text)]" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>−</button>
              <span class="text-[12px] text-[var(--color-text-muted)] w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button type="button" class="px-2.5 py-1 text-[13px] rounded border border-[var(--color-border-strong)] text-[var(--color-text)]" onClick={() => setZoom(Math.min(4, zoom + 0.25))}>+</button>
              <button type="button" class="px-2.5 py-1 text-[13px] rounded border border-[var(--color-border-strong)] text-[var(--color-text)]" onClick={() => setViewer(null)}>Close ✕</button>
            </div>
          </div>
          <div class="flex-1 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={pageSrc(viewerPage.file)}
              alt={`Deed page ${viewer.page}`}
              class="mx-auto bg-white"
              style={`width:${Math.round(zoom * 800)}px;max-width:none`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Research mission (Activity tab) ───────────────────────────────────────────

const CLASSIFICATION_META: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Accepted', color: '#2fbf71' },
  rejected: { label: 'Rejected', color: '#ff5f56' },
  superseded: { label: 'Superseded', color: '#7d838f' },
  failed: { label: 'Failed', color: '#f0a52e' },
  pending: { label: 'Pending', color: '#4aa8ff' },
};

function MissionEventRow({ e }: { e: MissionEvent }) {
  const meta = CLASSIFICATION_META[e.classification] ?? CLASSIFICATION_META.pending;
  return (
    <li class="flex items-start gap-2 text-[12.5px] leading-relaxed">
      <span class="mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={`background:${meta.color}22;color:${meta.color}`}>{meta.label}</span>
      <div class="min-w-0">
        <span class="font-medium text-[var(--color-text)]">{e.kindLabel}</span>
        <span class="text-[var(--color-text-muted)]"> — {e.summary}</span>
        {e.occurrences > 1 && <span class="ml-1 text-[10.5px] text-[var(--color-text-faint)]">×{e.occurrences} runs grouped</span>}
        <span class="ml-1.5 text-[10.5px] text-[var(--color-text-faint)]">{new Date(e.createdAt * 1000).toLocaleString()}</span>
      </div>
    </li>
  );
}

export function MissionPanel({ mission }: { mission: MissionViewT | null }) {
  const [showHistory, setShowHistory] = useState(false);
  if (!mission) return null;
  const cur = mission.current;
  const buckets: Array<{ key: keyof typeof cur; label: string }> = [
    { key: 'accepted', label: 'Accepted' }, { key: 'rejected', label: 'Rejected' },
    { key: 'superseded', label: 'Superseded' }, { key: 'failed', label: 'Failed' }, { key: 'pending', label: 'Pending' },
  ];
  return (
    <div class="space-y-3">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <span class="text-[11.5px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)]">Current research mission</span>
          <span class={`text-[11.5px] px-2 py-0.5 rounded-full font-semibold border ${cur.status === 'in_progress' ? 'text-[#4aa8ff] border-[#4aa8ff55]' : cur.status === 'complete' ? 'text-[#2fbf71] border-[#2fbf7155]' : 'text-[var(--color-text-faint)] border-[var(--color-border-strong)]'}`}>
            {cur.status === 'in_progress' ? 'In progress' : cur.status === 'complete' ? 'Complete' : 'No mission yet'}
          </span>
          {cur.startedAt && <span class="text-[11.5px] text-[var(--color-text-faint)]">{new Date(cur.startedAt * 1000).toLocaleString()} → {cur.endedAt ? new Date(cur.endedAt * 1000).toLocaleTimeString() : '…'}</span>}
        </div>
        {buckets.map(({ key, label }) => {
          const rows = cur[key] as MissionEvent[];
          if (!Array.isArray(rows) || rows.length === 0) return null;
          return (
            <div key={key} class="mb-2.5">
              <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold mb-1" style={`color:${CLASSIFICATION_META[key as string]?.color ?? 'inherit'}`}>{label} ({rows.length})</div>
              <ul class="space-y-1.5">{rows.map((e) => <MissionEventRow key={e.id} e={e} />)}</ul>
            </div>
          );
        })}
      </div>
      {mission.history.length > 0 && (
        <div>
          <button type="button" class="text-[12px] text-[var(--color-accent)]" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide' : 'Show'} {mission.history.length} historical result group(s)
          </button>
          {showHistory && (
            <div class="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div class="text-[10.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)] mb-1.5">
                Historical results — preserved as audit trail; they do not drive the current tabs
              </div>
              <ul class="space-y-1.5">{mission.history.map((e) => <MissionEventRow key={e.id} e={e} />)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reconcile action + model-version chip (header) ────────────────────────────

export function ReconcileBar({ dealId, modelVersion, onDone }: { dealId: number; modelVersion: ModelVersionView | null; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!modelVersion) return null;
  const run = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const res = await apiPost<{ note: string; compStatusFixes: number }>(`/api/landos/deal-cards/${dealId}/reconcile`, {});
      setMsg(res.note);
      onDone();
    } catch (err: unknown) {
      setMsg(`Reconcile failed: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span
        class={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${modelVersion.needsReconcile ? 'text-[#f0a52e] border-[#f0a52e55]' : 'text-[#2fbf71] border-[#2fbf7155]'}`}
        title={modelVersion.reasons.join(' ') || 'Card is on the current Deal Card model.'}
      >
        {modelVersion.needsReconcile ? `Model v${modelVersion.card} → v${modelVersion.current} available` : `Deal Card model v${modelVersion.current}`}
      </span>
      {modelVersion.needsReconcile && (
        <button
          type="button"
          disabled={running}
          onClick={run}
          class="text-[12px] px-2.5 py-1 rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50"
          title="Revalidate stored evidence against the current model in place. Preserves CRM/seller data; never creates a duplicate card; safe to re-run."
        >
          {running ? 'Reconciling…' : 'Reconcile Deal Card'}
        </button>
      )}
      {msg && <span class="text-[11.5px] text-[var(--color-text-muted)]">{msg}</span>}
    </div>
  );
}
