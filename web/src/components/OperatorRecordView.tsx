// Operator Property Record UI — the CRM face of a Deal Card.
//
// Everything here renders the backend's reconciled OperatorPropertyRecord
// (src/landos/operator-property-record.ts) — no section re-derives facts.
// Design language: an instrument panel. One signature element (the verdict
// rail with color-keyed edge bars + parcel-cyan evidence imagery); everything
// else quiet, high-contrast, and readable at 30 seconds.

import { useEffect, useState } from 'preact/hooks';

// ── Types (mirror src/landos/operator-property-record.ts) ────────────────────
export type Verdict = 'good' | 'caution' | 'risk' | 'unknown';
export interface OperatorDecisionCardView {
  key: string;
  label: string;
  verdict: Verdict;
  headline: string;
  detail: string;
  basis: string;
}
export interface AgentWorkItemView {
  title: string;
  state: 'completed' | 'researching' | 'blocked' | 'tyler_decision';
  note: string;
}
export interface OperatorRecordView {
  identity: {
    situsAddress: string;
    locality: string | null;
    county: string | null;
    state: string | null;
    zip: string | null;
    apn: string | null;
    owner: string | null;
    ownerRaw: string | null;
    ownerWarnings: string[];
    ownerMailing: string | null;
    assessedAcres: number | null;
    mappedAcres: number | null;
    acreageConflict: boolean;
    acreageBasis?: {
      displayBasis: string | null;
      overlayBasis: string | null;
      valuationBasis: string | null;
      disputed: boolean;
      tylerDecisionRequired: boolean;
      decision: string | null;
      explanation: string;
      entries: Array<{ kind: string; value: number | null; source: string | null; confidence: string; disputed: boolean; operatorAccepted: boolean; permittedUses: string[]; limitation: string }>;
      issues: Array<{ code: string; severity: string; message: string }>;
    };
    coordinates: { lat: number; lng: number } | null;
    parcelConfidence: string;
    landUseClass: string | null;
    taxArea: string | null;
    legalDescription: string | null;
    lastSale: string | null;
    deedReference: string | null;
    appraisedValue: number | null;
  };
  description: string;
  decisionCards: OperatorDecisionCardView[];
  septicOutlook: { outlook: string; why: string; investigateFirst: string | null };
  accessStatus: { status: string; summary: string; concerns: string[]; unresolved?: string[] };
  usableAcreage: { estimateAcres: number | null; note: string };
  offerReadiness: { state: string; why: string };
  valueReadiness: { state: string; why: string };
  risks: string[];
  unknowns: string[];
  tylerDecisions?: string[];
  workStatus: AgentWorkItemView[];
  sellerQuestions: string[];
  landScore: {
    available: boolean;
    unavailableReason: string | null;
    score: number;
    maxScore: number;
    verdict: string | null;
    confidence: string;
    factors: Array<{ id: string; label: string; maxPoints: number; points: number; lowestTier: boolean; dataGap: boolean; basis: string }>;
    flags: string[];
    note: string;
  };
  runCompletedAt: string | null;
}

// ── Verdict palette (theme-agnostic status colors) ───────────────────────────
const VERDICT_COLOR: Record<Verdict, string> = {
  good: '#2fbf71',
  caution: '#f0a52e',
  risk: '#ff5f56',
  unknown: '#7d838f',
};
const VERDICT_TEXT: Record<Verdict, string> = {
  good: 'OK',
  caution: 'Caution',
  risk: 'Risk',
  unknown: 'Unknown',
};

export function verdictColor(verdict: Verdict): string {
  return VERDICT_COLOR[verdict] ?? VERDICT_COLOR.unknown;
}

// ── CRM header ────────────────────────────────────────────────────────────────
function HeaderFact({ label, value, warn }: { label: string; value: string | null | undefined; warn?: boolean }) {
  if (!value) return null;
  return (
    <div class="min-w-0">
      <div class="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-faint)] font-semibold">{label}</div>
      <div class={`text-[13px] leading-snug break-words ${warn ? 'text-[#f0a52e] font-semibold' : 'text-[var(--color-text)]'}`}>{value}</div>
    </div>
  );
}

export function OperatorCrmHeader({ record, stage, heroSrc, heroHref, badges }: {
  record: OperatorRecordView;
  stage: string;
  heroSrc: string | null;
  heroHref?: string | null;
  badges?: preact.ComponentChildren;
}) {
  // Hide the hero when the overlay image cannot be produced for this county —
  // a black placeholder box is worse than no hero.
  const [heroFailed, setHeroFailed] = useState(false);
  useEffect(() => setHeroFailed(false), [heroSrc]);
  const id = record.identity;
  // County names may already carry their suffix — append exactly once.
  const countyLabel = id.county ? (/\b(county|parish|borough)\s*$/i.test(id.county) ? id.county : `${id.county} County`) : null;
  const localityLine = [id.locality, countyLabel, id.state, id.zip].filter(Boolean).join(' · ');
  const acreage = id.acreageConflict
    ? `${id.mappedAcres} ac mapped / ${id.assessedAcres} ac assessed — CONFLICT`
    : id.assessedAcres == null && id.mappedAcres == null
      ? 'Not yet confirmed'
      : `${id.assessedAcres ?? id.mappedAcres} ac${id.mappedAcres != null && id.assessedAcres != null ? ` (mapped ${id.mappedAcres})` : ''}`;
  const offerTone: Verdict = record.offerReadiness.state === 'ready' ? 'good'
    : record.offerReadiness.state === 'needs_confirmation' ? 'caution'
    : record.offerReadiness.state === 'researching' ? 'unknown'
    : 'risk';
  return (
    <div class="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-card)] overflow-hidden">
      <div class="flex flex-col lg:flex-row">
        <div class="flex-1 p-4 space-y-3 min-w-0">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="text-[22px] font-bold tracking-tight text-[var(--color-text)]">{id.situsAddress}</span>
            <span class="text-[13.5px] text-[var(--color-text-muted)]">{localityLine}</span>
            {badges}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={`background:${verdictColor(offerTone)}22;color:${verdictColor(offerTone)};border:1px solid ${verdictColor(offerTone)}55`}>
              Offer: {record.offerReadiness.state.replace(/_/g, ' ')}
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)]">Stage: {stage}</span>
            <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)]" title={id.parcelConfidence}>
              {id.parcelConfidence.startsWith('Verified') ? '✓ Parcel verified' : id.parcelConfidence}
            </span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-2.5">
            <HeaderFact label="APN / Parcel ID" value={id.apn} />
            <HeaderFact label="Owner (working label)" value={id.owner} warn={(id.ownerWarnings?.length ?? 0) > 0} />
            <HeaderFact label="Acreage" value={acreage} warn={id.acreageConflict} />
            <HeaderFact label="Owner mailing" value={id.ownerMailing} />
            <HeaderFact label="Coordinates" value={id.coordinates ? `${id.coordinates.lat.toFixed(5)}, ${id.coordinates.lng.toFixed(5)}` : null} />
            <HeaderFact label="Land class" value={id.landUseClass} />
            <HeaderFact label="Last sale" value={id.lastSale} />
            <HeaderFact label="Deed" value={id.deedReference} />
            <HeaderFact label="Appraised (county)" value={id.appraisedValue != null ? `$${id.appraisedValue.toLocaleString()}` : null} />
            <HeaderFact label="Tax area" value={id.taxArea} />
          </div>
          {(id.ownerWarnings?.length ?? 0) > 0 && (
            <div class="rounded-md border border-[#f0a52e55] bg-[#f0a52e11] p-2.5 space-y-1">
              {id.ownerRaw && (
                <div class="text-[11.5px] text-[var(--color-text-muted)]">
                  Official owner text (verbatim): <span class="font-mono text-[var(--color-text)]">{id.ownerRaw}</span>
                </div>
              )}
              {id.ownerWarnings.map((w) => (
                <div class="text-[12px] leading-relaxed text-[#f0a52e]">⚠ {w}</div>
              ))}
            </div>
          )}
          {record.description && (
            <p class="text-[13.5px] leading-relaxed text-[var(--color-text-muted)] max-w-[760px]">{record.description}</p>
          )}
        </div>
        {heroSrc && !heroFailed && (
          <a
            href={heroHref ?? heroSrc}
            target="_blank"
            rel="noreferrer"
            class="block lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--color-border)] bg-black"
            title="Open full-size parcel evidence image"
          >
            <img src={heroSrc} alt="Official aerial with parcel boundary" class="w-full h-full max-h-[300px] object-cover" loading="lazy" onError={() => setHeroFailed(true)} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Verdict rail ──────────────────────────────────────────────────────────────
export function DecisionCardRail({ cards }: { cards: OperatorDecisionCardView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
      {cards.map((card) => {
        const color = verdictColor(card.verdict);
        const expanded = open === card.key;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => setOpen(expanded ? null : card.key)}
            class="text-left rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] p-3 relative overflow-hidden"
            style={`border-left:4px solid ${color}`}
            title={card.basis}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[var(--color-text-faint)]">{card.label}</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style={`background:${color}22;color:${color}`}>{VERDICT_TEXT[card.verdict]}</span>
            </div>
            <div class="mt-1 text-[13.5px] font-semibold leading-snug text-[var(--color-text)]">{card.headline}</div>
            <div class={`mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)] ${expanded ? '' : 'line-clamp-2'}`}>{card.detail}</div>
            {expanded && card.basis && <div class="mt-1.5 text-[10.5px] text-[var(--color-text-faint)]">{card.basis}</div>}
          </button>
        );
      })}
    </div>
  );
}

// ── Acreage basis disclosure (shared canonical acreage & spatial basis) ────────
function labelBasis(kind: string | null): string {
  if (!kind) return 'unresolved';
  return kind.replace(/_/g, ' ');
}
export function AcreageBasisPanel({ record }: { record: OperatorRecordView }) {
  const ab = record.identity.acreageBasis;
  if (!ab) return null;
  const show = ab.explanation || ab.disputed || ab.issues.length > 0;
  if (!show) return null;
  return (
    <div class="rounded-lg border border-[#f0a52e55] bg-[var(--color-card)] p-3.5">
      <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[#f0a52e] mb-2">Acreage basis</div>
      {ab.explanation && <div class="text-[12.5px] leading-relaxed text-[var(--color-text)] mb-2">{ab.explanation}</div>}
      <div class="text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
        <div>Header displays: <span class="text-[var(--color-text)]">{labelBasis(ab.displayBasis)}</span></div>
        <div>Overlays sampled against: <span class="text-[var(--color-text)]">{labelBasis(ab.overlayBasis)}</span></div>
        <div>Valuation basis: <span class="text-[var(--color-text)]">{labelBasis(ab.valuationBasis)}</span>{ab.disputed ? ' (disputed — context only until resolved)' : ''}</div>
      </div>
      {ab.issues.length > 0 && (
        <ul class="mt-2 space-y-1">
          {ab.issues.map((iss) => (
            <li class="text-[12px] leading-relaxed text-[#ff8a84]">{iss.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Risks and unknowns ────────────────────────────────────────────────────────
export function RisksUnknownsPanel({ record }: { record: OperatorRecordView }) {
  const tylerDecisions = record.tylerDecisions ?? [];
  const ab = record.identity.acreageBasis;
  const showAcreage = !!ab && (!!ab.explanation || ab.disputed || ab.issues.length > 0);
  if (!record.risks.length && !record.unknowns.length && !tylerDecisions.length && !showAcreage) return null;
  return (
    <div class="space-y-2">
      {tylerDecisions.length > 0 && (
        <div class="rounded-lg border border-[#c792ea] bg-[var(--color-card)] p-3.5">
          <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[#c792ea] mb-2">Tyler decision required</div>
          <ul class="space-y-1.5">
            {tylerDecisions.map((d) => (
              <li class="text-[12.5px] leading-relaxed text-[var(--color-text)] pl-4 relative">
                <span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#c792ea]" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showAcreage && <AcreageBasisPanel record={record} />}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {record.risks.length > 0 && (
        <div class="rounded-lg border border-[#ff5f5633] bg-[var(--color-card)] p-3.5">
          <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[#ff8a84] mb-2">Top risks</div>
          <ul class="space-y-1.5">
            {record.risks.map((risk) => (
              <li class="text-[12.5px] leading-relaxed text-[var(--color-text)] pl-4 relative">
                <span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[#ff5f56]" />
                {risk}
              </li>
            ))}
          </ul>
        </div>
      )}
      {record.unknowns.length > 0 && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3.5">
          <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2">Still unknown</div>
          <ul class="space-y-1.5">
            {record.unknowns.map((unknown) => (
              <li class="text-[12.5px] leading-relaxed text-[var(--color-text-muted)] pl-4 relative">
                <span class="absolute left-0 top-[7px] w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)]" />
                {unknown}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
    </div>
  );
}

// ── Agent work board ──────────────────────────────────────────────────────────
const WORK_STATE_META: Record<AgentWorkItemView['state'], { label: string; color: string }> = {
  completed: { label: 'LandOS completed', color: '#2fbf71' },
  researching: { label: 'LandOS researching', color: '#4aa8ff' },
  blocked: { label: 'LandOS blocked', color: '#f0a52e' },
  tyler_decision: { label: 'Tyler decision required', color: '#c792ea' },
};

export function WorkStatusBoard({ items, compact }: { items: AgentWorkItemView[]; compact?: boolean }) {
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const states: AgentWorkItemView['state'][] = ['completed', 'researching', 'blocked', 'tyler_decision'];
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3.5">
      <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2.5">Agent work status</div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {states.map((state) => {
          const meta = WORK_STATE_META[state];
          let rows = items.filter((item) => item.state === state);
          const hiddenCount = state === 'completed' && compact && !showAllCompleted && rows.length > 4 ? rows.length - 4 : 0;
          if (hiddenCount > 0) rows = rows.slice(0, 4);
          return (
            <div key={state} class="min-w-0">
              <div class="flex items-center gap-1.5 mb-1.5">
                <span class="w-2 h-2 rounded-full" style={`background:${meta.color}`} />
                <span class="text-[11.5px] font-semibold" style={`color:${meta.color}`}>{meta.label}</span>
                <span class="text-[10.5px] text-[var(--color-text-faint)]">({items.filter((item) => item.state === state).length})</span>
              </div>
              {rows.length === 0 && <div class="text-[11.5px] text-[var(--color-text-faint)]">None</div>}
              <ul class="space-y-1.5">
                {rows.map((item) => (
                  <li class="text-[12px] leading-snug">
                    <div class="font-medium text-[var(--color-text)]">{item.title}</div>
                    <div class="text-[11px] text-[var(--color-text-muted)] line-clamp-2" title={item.note}>{item.note}</div>
                  </li>
                ))}
              </ul>
              {hiddenCount > 0 && (
                <button type="button" class="mt-1 text-[11px] text-[var(--color-accent)]" onClick={() => setShowAllCompleted(true)}>
                  +{hiddenCount} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Evidence gallery (parcel overlay maps + captured visuals) ────────────────
const OVERLAY_KINDS: Array<{ kind: string; label: string; caption: string }> = [
  { kind: 'aerial', label: 'Aerial + boundary', caption: 'Official county aerial, exact parcel boundary' },
  { kind: 'wetlands', label: 'Wetlands', caption: 'NWI wetlands over aerial' },
  { kind: 'flood', label: 'FEMA flood', caption: 'County flood zones (FEMA-derived)' },
  { kind: 'soils', label: 'Soils', caption: 'USDA SSURGO map units' },
  { kind: 'zoning', label: 'Zoning', caption: 'County zoning classification' },
  { kind: 'flu', label: 'Future land use', caption: 'County future land use' },
  { kind: 'roads', label: 'Road proximity & access context', caption: 'County road centerlines near the parcel — proximity screening, not frontage' },
];

export function EvidenceGallery({ dealId, token }: { dealId: number; token: string }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  return (
    <div>
      <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2">
        Parcel evidence maps <span class="normal-case font-normal text-[var(--color-text-faint)]">— official geometry drawn on official rasters; screening evidence, not a survey</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {OVERLAY_KINDS.filter((o) => !failed[o.kind]).map((overlay) => {
          const src = `/api/landos/deal-cards/${dealId}/overlay/${overlay.kind}?token=${encodeURIComponent(token)}`;
          return (
            <a key={overlay.kind} href={src} target="_blank" rel="noreferrer" class="block rounded-lg overflow-hidden border border-[var(--color-border)] bg-black hover:border-[var(--color-border-strong)]">
              <img
                src={src}
                alt={overlay.label}
                class="w-full aspect-square object-cover"
                loading="lazy"
                onError={() => setFailed((prev) => ({ ...prev, [overlay.kind]: true }))}
              />
              <div class="px-2.5 py-1.5 bg-[var(--color-card)]">
                <div class="text-[12px] font-semibold text-[var(--color-text)]">{overlay.label}</div>
                <div class="text-[10.5px] text-[var(--color-text-faint)]">{overlay.caption}</div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Seller questions ──────────────────────────────────────────────────────────
export function SellerQuestionsPanel({ questions }: { questions: string[] }) {
  if (!questions.length) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3.5">
      <div class="text-[11px] uppercase tracking-[0.07em] font-bold text-[var(--color-text-muted)] mb-2">
        Discovery questions for this property <span class="normal-case font-normal text-[var(--color-text-faint)]">— generated from the screening findings</span>
      </div>
      <ol class="space-y-1.5 list-decimal list-inside">
        {questions.map((question) => (
          <li class="text-[12.5px] leading-relaxed text-[var(--color-text)]">{question}</li>
        ))}
      </ol>
    </div>
  );
}

// ── Physical feasibility verdict strip (septic / access / usable acreage) ────
const ACCESS_STATUS_LABEL: Record<string, string> = {
  public_road_proximity: 'Road proximity only — access unresolved',
  private_road_only: 'Non-public road proximity only',
  no_mapped_contact: 'No mapped road proximity',
  unknown: 'Not screened',
};

export function FeasibilityStrip({ record }: { record: OperatorRecordView }) {
  const septicTone: Verdict = record.septicOutlook.outlook === 'poor' ? 'risk' : record.septicOutlook.outlook === 'mixed' ? 'caution' : record.septicOutlook.outlook === 'favorable' ? 'good' : 'unknown';
  const accessTone: Verdict = record.accessStatus.status === 'public_road_proximity' ? 'caution' : record.accessStatus.status === 'unknown' ? 'unknown' : 'risk';
  const rows: Array<{ label: string; tone: Verdict; headline: string; detail: string; items?: string[] }> = [
    { label: 'Septic outlook', tone: septicTone, headline: record.septicOutlook.outlook === 'unknown' ? 'Unknown' : record.septicOutlook.outlook[0].toUpperCase() + record.septicOutlook.outlook.slice(1), detail: record.septicOutlook.why + (record.septicOutlook.investigateFirst ? ` ${record.septicOutlook.investigateFirst}` : '') },
    { label: 'Road proximity & access', tone: accessTone, headline: ACCESS_STATUS_LABEL[record.accessStatus.status] ?? record.accessStatus.status.replace(/_/g, ' '), detail: record.accessStatus.summary, items: record.accessStatus.unresolved },
    { label: 'Non-wetland mapped area', tone: 'caution', headline: record.usableAcreage.estimateAcres != null ? `~${record.usableAcreage.estimateAcres} ac non-wetland — usable acreage unresolved` : 'Unknown', detail: record.usableAcreage.note },
  ];
  return (
    <div class="space-y-2">
      {rows.map((row) => (
        <div key={row.label} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3.5" style={`border-left:4px solid ${verdictColor(row.tone)}`}>
          <div class="flex items-baseline gap-2 flex-wrap">
            <span class="text-[11px] uppercase tracking-[0.07em] font-semibold text-[var(--color-text-faint)]">{row.label}</span>
            <span class="text-[13.5px] font-semibold" style={`color:${verdictColor(row.tone)}`}>{row.headline}</span>
          </div>
          <div class="mt-1 text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">{row.detail}</div>
          {row.items && row.items.length > 0 && (
            <ul class="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
              {row.items.map((item) => (
                <li class="text-[11.5px] leading-relaxed text-[var(--color-text-muted)] pl-3 relative">
                  <span class="absolute left-0 top-[7px] w-1 h-1 rounded-full bg-[var(--color-text-faint)]" />{item}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
