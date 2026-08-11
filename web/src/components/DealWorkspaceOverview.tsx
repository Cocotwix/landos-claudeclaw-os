import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  PropertyIntelligenceDueDiligence,
  PropertyIntelligenceProperty,
  type PiOperatorAnalysis,
  type PiOperatorScore,
  type PiSnapshot,
} from '@/components/PropertyIntelligencePanel';
import { apiPost, dashboardToken } from '@/lib/api';
import { DealImageGallery } from '@/components/DealImageGallery';
import { formatRelativeTime } from '@/lib/format';

export type DealWorkspaceTab = 'overview' | 'market' | 'strategy' | 'seller' | 'documents' | 'intake';

export interface DealWorkspacePerson {
  name?: string | null;
  role?: string | null;
  authority_status?: string | null;
  phone?: string | null;
  email?: string | null;
  mailing_address?: string | null;
}

export interface DealWorkspaceCrmStatus {
  stageLabel: string;
  nextOperationalStep: string;
  followUpDate: string | null;
  taskOwner: string | null;
  offerStatus: string;
  latestActivity: { label: string; summary: string; createdAt: number } | null;
}

export interface DealWorkspaceAcquisition {
  stage: string;
  profile: {
    name?: string;
    role?: string;
    phone?: string;
    email?: string;
    mailingAddress?: string;
    assignedOwner?: string;
    primaryContact?: boolean;
    preferredChannel?: 'call' | 'text' | 'email' | 'voicemail' | 'in_person' | 'other';
    relationshipToProperty?: string;
    motivation?: string;
    timeline?: string;
    askingPrice?: string;
    priceFlexibility?: string;
    decisionMakers?: string;
    personalityNotes?: string;
    nextFollowUpDate?: string;
  };
  commLog: Array<{
    at: string;
    channel: string;
    direction: 'inbound' | 'outbound';
    summary: string;
    notes?: string;
    outcome?: string;
    followUpDate?: string;
    followUpNeeded?: boolean;
    createdAt: string;
  }>;
}

type ScoreView = PiOperatorScore;
type OperatorAnalysisView = PiOperatorAnalysis;

interface WorkspaceProps {
  snapshot: PiSnapshot | null;
  title: string;
  stage: string;
  askingPrice: number | null;
  sellerNotes: string;
  people: DealWorkspacePerson[];
  crmStatus: DealWorkspaceCrmStatus | null;
  onNavigate: (tab: DealWorkspaceTab) => void;
  onEdit: () => void;
  onRunResearch: () => void;
  onStartOffer: () => void;
  researchRunning: boolean;
}

const money = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `$${Math.round(value).toLocaleString()}` : '—';

const range = (band: { low: number; high: number } | null | undefined): string =>
  band ? `${money(band.low)} – ${money(band.high)}` : 'Not established';

function analystFrom(snapshot: PiSnapshot | null): OperatorAnalysisView | null {
  return snapshot?.operatorAnalysis ?? null;
}

function tokenized(url: string | null): string | null {
  if (!url) return null;
  if (!url.startsWith('/api/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  primary = false,
  type = 'button',
}: {
  children: any;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      class={`rounded-lg border px-3 py-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
        primary
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-sm'
          : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text)] hover:border-[var(--color-accent)] hover:bg-[var(--color-elevated)]'
      }`}
    >
      {children}
    </button>
  );
}

function ScoreCard({
  label,
  score,
  accent,
  pending = false,
  pendingExplanation,
}: {
  label: string;
  score?: ScoreView;
  accent: string;
  pending?: boolean;
  pendingExplanation?: string;
}) {
  const display = pending || score?.score == null ? null : Math.max(0, Math.min(100, Math.round(score.score)));
  return (
    <article class="group relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
      <div class={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-faint)]">{label}</div>
          <div class="mt-1 text-[13px] font-semibold text-[var(--color-text)]">{pending ? 'Pending' : score?.rating || 'Analysis pending'}</div>
        </div>
        <div class="text-right">
          <span class="text-[30px] font-black leading-none tabular-nums text-[var(--color-text)]">{display ?? '—'}</span>
          {display != null && <span class="text-[10px] text-[var(--color-text-faint)]">/100</span>}
        </div>
      </div>
      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-elevated)]">
        <div class={`h-full rounded-full ${accent}`} style={{ width: `${display ?? 0}%` }} />
      </div>
      <p class="mt-3 min-h-[34px] text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        {pending
          ? pendingExplanation || 'Not enough seller information is available to score motivation, flexibility, timing, authority, or responsiveness.'
          : score?.explanation || 'LandOS will score this independently when the current evidence review finishes.'}
      </p>
      {score && !pending && (
        <details class="mt-3 border-t border-[var(--color-border)] pt-2">
          <summary class="cursor-pointer text-[10px] font-semibold text-[var(--color-accent)]">Why this score</summary>
          <div class="mt-2 grid gap-2 text-[10.5px] leading-relaxed sm:grid-cols-3">
            <ScoreList label="Strengths" rows={score.strongestPositiveFactors} tone="text-emerald-400" />
            <ScoreList label="Deductions" rows={score.mainDeductions} tone="text-amber-400" />
            <ScoreList label="Could change" rows={score.materiallyChangeWith} tone="text-sky-400" />
          </div>
        </details>
      )}
    </article>
  );
}

function ScoreList({ label, rows, tone }: { label: string; rows: string[]; tone: string }) {
  return (
    <div>
      <div class={`mb-1 font-bold uppercase tracking-wide ${tone}`}>{label}</div>
      {rows.length ? <ul class="space-y-1">{rows.slice(0, 3).map((row, index) => <li key={index}>• {row}</li>)}</ul> : <span class="text-[var(--color-text-faint)]">None recorded</span>}
    </div>
  );
}

function ValueCard({ label, value, emphasis = false, note }: { label: string; value: string; emphasis?: boolean; note?: string }) {
  return (
    <div class={`rounded-xl border p-3 ${emphasis ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] bg-[var(--color-card)]'}`}>
      <div class="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">{label}</div>
      <div class={`mt-1 text-[18px] font-bold tabular-nums ${emphasis ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>{value}</div>
      {note && <div class="mt-1 text-[9.5px] leading-relaxed text-[var(--color-text-faint)]">{note}</div>}
    </div>
  );
}

function CrmStatusFact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div class={`min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt class="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">{label}</dt>
      <dd class="mt-1 break-words text-[11.5px] font-semibold leading-relaxed text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function BulletPanel({ title, rows, tone }: { title: string; rows: string[]; tone: string }) {
  return (
    <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <h3 class={`text-[11px] font-bold uppercase tracking-[0.12em] ${tone}`}>{title}</h3>
      {rows.length ? (
        <ul class="mt-3 space-y-2">
          {rows.slice(0, 5).map((row, index) => (
            <li key={index} class="flex gap-2 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              <span class={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tone.replace('text-', 'bg-')}`} />
              <span>{row}</span>
            </li>
          ))}
        </ul>
      ) : <p class="mt-3 text-[11px] text-[var(--color-text-faint)]">Nothing material recorded yet.</p>}
    </section>
  );
}

function factFor(snapshot: PiSnapshot | null, pattern: RegExp): { value: string; note: string | null; source: string | null } | null {
  const fact = [...(snapshot?.facts ?? []), ...(snapshot?.governmentRecords ?? [])].find((item) =>
    item.value
    && item.grade !== 'unresolved_question'
    && item.grade !== 'unavailable_public_record'
    && pattern.test(`${item.key} ${item.label}`),
  );
  return fact?.value ? { value: fact.value, note: fact.note, source: fact.source } : null;
}

function screeningFor(snapshot: PiSnapshot | null, pattern: RegExp): { value: string; detail: string | null } | null {
  const item = snapshot?.dueDiligence.find((row) => pattern.test(`${row.key} ${row.label}`));
  if (!item || item.grade === 'unresolved_question' || item.grade === 'unavailable_public_record') return null;
  return { value: item.headline, detail: item.detail };
}

function evidenceNote(value: { note?: string | null; detail?: string | null } | null): string | null {
  return value?.detail ?? value?.note ?? null;
}

function cleanJurisdiction(value: string | null | undefined): string | null {
  return value?.replace(/\b(County|Parish|Borough)(\s+\1)+\b/gi, '$1') ?? null;
}

function conciseSepticSummary(value: string | null | undefined): string {
  if (!value) return 'Not established';
  const lead = value.split(/\s+SSURGO evidence:/i)[0].trim();
  return `${lead || 'Preliminary septic outlook is retained.'} Site-specific perc and utility feasibility remain pending.`;
}

function addApproximateAcres(value: string, totalAcres: number | null | undefined): string {
  if (!totalAcres || /\bac(?:re)?s?\b/i.test(value)) return value;
  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return value;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent)) return value;
  return `${value} · approximately ${((totalAcres * percent) / 100).toFixed(1)} acres`;
}

function Characteristic({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | null;
}) {
  return (
    <div class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div class="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">{label}</div>
      <div class="mt-1 break-words text-[12.5px] font-semibold leading-relaxed text-[var(--color-text)]">{value}</div>
      {note && <div class="mt-1 break-words text-[9.5px] leading-relaxed text-[var(--color-text-faint)]">{note}</div>}
    </div>
  );
}

function PropertyCharacteristics({ snapshot }: { snapshot: PiSnapshot | null }) {
  const acres = snapshot?.identity.acres ?? null;
  const subdivision = snapshot?.operatorAnalysis?.subdivision;
  const frontage = factFor(snapshot, /road[_\s-]*frontage|frontage feet/i) ?? (subdivision?.observedFrontageFeet != null
    ? { value: `Approximately ${Math.round(subdivision.observedFrontageFeet).toLocaleString()} feet`, note: 'Observed parcel geometry; confirm legal road frontage and access.' }
    : null);
  const landlocked = factFor(snapshot, /landlocked|land locked/i);
  const roads = factFor(snapshot, /roads? serving|road count|number of roads/i);
  const entrances = factFor(snapshot, /entrance|driveway/i);
  const shape = factFor(snapshot, /parcel shape|shape description/i);
  const wetlands = factFor(snapshot, /wetland/) ?? screeningFor(snapshot, /wetland/);
  const flood = factFor(snapshot, /flood|fema/) ?? screeningFor(snapshot, /flood|fema/);
  const measuredSlope = factFor(snapshot, /measured.*slope|parcel.*average slope|average.*parcel slope|under 12% slope|slope band/i);
  const underTen = factFor(snapshot, /under 10%|below 10%|slope.*10/i);
  const underTwelve = underTen ?? factFor(snapshot, /under 12%|below 12%|slope.*12/i);
  const buildable = factFor(snapshot, /estimated buildable|buildability\b|buildable acres/i);
  const wooded = factFor(snapshot, /wooded acreage|wooded area|tree cover/i);
  const cleared = factFor(snapshot, /cleared acreage|cleared area|open area/i);
  const water = factFor(snapshot, /water feature|creek|stream|pond/i);
  const utilities = factFor(snapshot, /utilities|public water|public sewer|electric/i) ?? screeningFor(snapshot, /utilities/);
  const zoning = factFor(snapshot, /zoning district|land use|governing zoning/i) ?? screeningFor(snapshot, /zoning|land use/);
  const streetView = snapshot?.evidence.some((item) => /street\s*view/i.test(`${item.label} ${item.sourceType}`) && item.viewUrl)
    ? 'Position-proven Street View retained'
    : snapshot?.operatorAnalysis?.researchAttempts.some((attempt) => /street\s*view/i.test(`${attempt.label} ${attempt.source}`))
      ? 'Attempted; no position-proven image retained'
      : 'Not yet established';
  const rows = [
    { label: 'Total acreage', value: acres == null ? 'Not established' : `${acres.toLocaleString()} acres`, note: snapshot?.identity.acreageBasis },
    { label: 'Landlocked', value: landlocked?.value ?? 'Not established', note: landlocked?.note },
    { label: 'Road frontage', value: frontage?.value ?? 'Not established', note: frontage?.note },
    { label: 'Roads serving parcel', value: roads?.value ?? 'Not established', note: roads?.note },
    { label: 'Apparent entrances', value: entrances?.value ?? 'Not established', note: entrances?.note },
    { label: 'Parcel shape', value: shape?.value ?? 'Review retained parcel imagery', note: shape?.note },
    { label: 'Mapped wetlands', value: wetlands ? addApproximateAcres(wetlands.value, acres) : 'Not established', note: 'Screening only; mapped wetlands do not establish buildable acreage.' },
    { label: 'Flood indication', value: flood?.value ?? 'Not established', note: evidenceNote(flood) },
    { label: 'Measured parcel slope', value: measuredSlope?.value ?? 'Not measured parcel-wide', note: measuredSlope?.note ?? 'A soil map-unit slope range is not a parcel-wide measured slope.' },
    { label: underTen ? 'Under 10% slope' : 'Under 12% slope', value: underTwelve ? addApproximateAcres(underTwelve.value, acres) : 'Not measured', note: underTwelve?.note },
    { label: 'Estimated buildable area', value: buildable ? addApproximateAcres(buildable.value, acres) : 'Not established', note: buildable?.note ?? 'Withheld until terrain, access, soils, flood, and wetlands evidence reconcile.' },
    { label: 'Wooded area', value: wooded ? addApproximateAcres(wooded.value, acres) : 'Not quantified', note: wooded?.note },
    { label: 'Cleared area', value: cleared ? addApproximateAcres(cleared.value, acres) : 'Not quantified', note: cleared?.note },
    { label: 'Water features', value: water?.value ?? 'Not established', note: water?.note },
    { label: 'Utilities', value: utilities?.value ?? 'Parcel-level service not established', note: evidenceNote(utilities) },
    { label: 'Street View', value: streetView },
    { label: 'Zoning & land use', value: cleanJurisdiction(zoning?.value ?? subdivision?.governingJurisdiction) ?? 'Governing rules not established', note: evidenceNote(zoning) },
  ];
  return (
    <section class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
      <div>
        <h2 class="text-[14px] font-bold text-[var(--color-text)]">Property characteristics</h2>
        <p class="mt-0.5 text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">The current decision-grade property read. Missing measurements stay explicit and do not silently affect value or strategy.</p>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((row) => <Characteristic key={row.label} {...row} />)}
      </div>
    </section>
  );
}

function MinorSubdivisionCard({ snapshot }: { snapshot: PiSnapshot | null }) {
  const subdivision = snapshot?.operatorAnalysis?.subdivision;
  if (!subdivision) return null;
  const approvalText = subdivision.approvalPath.join(' ');
  const flagLot = approvalText.match(/[^.]*flag lot[^.]*/i)?.[0] ?? 'Not established';
  const sharedAccess = approvalText.match(/[^.]*(?:shared access|shared driveway)[^.]*/i)?.[0] ?? 'Not established';
  const currentFit = subdivision.signalExplanation
    || subdivision.mainRisks[0]
    || 'A practical fit has not been established.';
  return (
    <section class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-[14px] font-bold text-[var(--color-text)]">Minor subdivision</h2>
          <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">A concise operating summary—not a substitute for survey, ordinance, access, or septic confirmation.</p>
        </div>
        <span class="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{subdivision.status}</span>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Characteristic label="Governing jurisdiction" value={cleanJurisdiction(subdivision.governingJurisdiction) ?? 'Not established'} />
        <Characteristic label="Minimum lot size" value={subdivision.minimumLotSize ?? 'Not established'} />
        <Characteristic label="Minimum road frontage" value={subdivision.minimumFrontage ?? 'Not established'} />
        <Characteristic label="Minor split limit" value={subdivision.minorSubdivisionThreshold ?? 'Not established'} />
        <Characteristic label="Major-review threshold" value={subdivision.approvalPath.find((row) => /major subdivision|major review/i.test(row)) ?? 'Not established'} />
        <Characteristic label="Flag-lot rules" value={flagLot} />
        <Characteristic label="Shared-access rules" value={sharedAccess} />
        <Characteristic label="Private-road standards" value={subdivision.roadRequirements ?? 'Not established'} />
        <Characteristic label="Survey & plat" value={subdivision.surveyAndPlatRequirements ?? 'Not established'} />
        <Characteristic label="Septic & utilities" value={conciseSepticSummary(subdivision.septicAndUtilityConditions)} />
        <div class="sm:col-span-2"><Characteristic label="Current subject fit" value={currentFit} /></div>
      </div>
    </section>
  );
}

function HeroViewer({
  snapshot,
  title,
}: {
  snapshot: PiSnapshot | null;
  title: string;
}) {
  const visuals = useMemo(
    () => snapshot?.evidence.filter((item) => (item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay') && item.viewUrl) ?? [],
    [snapshot],
  );
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const selected = visuals[index] ?? null;

  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const select = (next: number) => {
    setIndex((next + visuals.length) % visuals.length);
    resetView();
  };
  const pointerDown = (event: PointerEvent) => {
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag.current || scale <= 1) return;
    setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
  };
  const pointerUp = () => { drag.current = null; };

  return (
    <>
      <button
        type="button"
        disabled={!selected}
        onClick={() => { setOpen(true); resetView(); }}
        class="group relative block min-h-[300px] w-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-elevated)] text-left shadow-lg disabled:cursor-default"
      >
        {selected ? (
          <>
            <img src={tokenized(selected.viewUrl)!} alt={selected.label} class="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/15" />
            <div class="absolute inset-x-0 bottom-0 p-4 text-white">
              <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Property imagery</div>
              <div class="mt-1 flex items-end justify-between gap-3">
                <div>
                  <div class="text-[14px] font-semibold">{selected.label}</div>
                  <div class="mt-1 text-[10px] text-white/70">{selected.sourceType}{selected.retrievedAt ? ` · ${selected.retrievedAt.slice(0, 10)}` : ''}</div>
                </div>
                <span class="rounded-full border border-white/40 bg-black/30 px-3 py-1.5 text-[10px] font-semibold backdrop-blur">Expand image</span>
              </div>
            </div>
          </>
        ) : (
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_35%,rgba(36,142,96,.16),transparent_55%)] p-6 text-center">
            <div class="text-[13px] font-semibold text-[var(--color-text)]">Property image is being assembled</div>
            <div class="max-w-sm text-[11px] leading-relaxed text-[var(--color-text-muted)]">The strongest retained parcel, aerial, or overlay image will appear here automatically.</div>
          </div>
        )}
      </button>

      {open && selected && (
        <div role="dialog" aria-modal="true" aria-label={`${title} image viewer`} class="fixed inset-0 z-[100] flex flex-col bg-black/95">
          <div class="flex flex-wrap items-center gap-2 border-b border-white/15 bg-black/60 px-4 py-3 text-white">
            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] font-semibold">{selected.label}</div>
              <div class="text-[10px] text-white/60">{selected.sourceType}{selected.retrievedAt ? ` · captured ${selected.retrievedAt.slice(0, 10)}` : ''} · {index + 1} of {visuals.length}</div>
            </div>
            <ActionButton onClick={() => setScale((value) => Math.max(1, value - 0.25))}>−</ActionButton>
            <span class="w-12 text-center text-[11px] tabular-nums">{Math.round(scale * 100)}%</span>
            <ActionButton onClick={() => setScale((value) => Math.min(5, value + 0.25))}>+</ActionButton>
            <ActionButton onClick={resetView}>Fit</ActionButton>
            {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" class="rounded-lg border border-white/20 px-3 py-2 text-[11px] font-semibold text-white">Source ↗</a>}
            <ActionButton onClick={() => setOpen(false)}>Close</ActionButton>
          </div>
          <div
            class={`relative min-h-0 flex-1 overflow-hidden ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onWheel={(event) => {
              event.preventDefault();
              setScale((value) => Math.max(1, Math.min(5, value + (event.deltaY < 0 ? 0.2 : -0.2))));
            }}
          >
            <img
              src={tokenized(selected.viewUrl)!}
              alt={selected.label}
              draggable={false}
              class="h-full w-full select-none object-contain"
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            />
            {visuals.length > 1 && (
              <>
                <button type="button" aria-label="Previous image" onClick={() => select(index - 1)} class="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/50 px-4 py-3 text-xl text-white backdrop-blur">‹</button>
                <button type="button" aria-label="Next image" onClick={() => select(index + 1)} class="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-black/50 px-4 py-3 text-xl text-white backdrop-blur">›</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function DealWorkspaceOverview({
  snapshot,
  title,
  stage,
  askingPrice,
  sellerNotes,
  people,
  crmStatus,
  onNavigate,
  onEdit,
  onRunResearch,
  onStartOffer,
  researchRunning,
}: WorkspaceProps) {
  const analysis = analystFrom(snapshot);
  const identity = snapshot?.identity;
  const seller = people.find((person) => person.role === 'seller') ?? people[0];
  const opportunity = analysis?.overall.mainOpportunity || snapshot?.headline.keyOpportunity || 'Research is still forming the investment case.';
  const risks = analysis?.overall.mainRisks ?? snapshot?.headline.topRisks ?? [];
  const questions = analysis?.overall.unansweredQuestions ?? snapshot?.missingInformation ?? [];
  const actions = analysis?.overall.nextBestActions ?? snapshot?.nextActions ?? [];
  const target = analysis?.values.targetAcquisitionRange ?? snapshot?.recommendation.targetBuyRange;
  const openingPosition = analysis?.values.openingPosition ?? null;
  const practicalMaximum = analysis?.values.practicalMaximumAcquisitionPrice ?? null;
  const walkAwayLevel = analysis?.values.walkAwayLevel ?? null;
  const visuals = snapshot?.evidence.filter((item) => item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay') ?? [];
  const hasSellerEvidence = Boolean(
    askingPrice != null
    || sellerNotes.trim()
    || seller?.phone
    || seller?.email
    || seller?.authority_status,
  );

  return (
    <div data-testid="deal-workspace-overview" class="space-y-4">
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)]">
        <DealImageGallery items={visuals} title={title} mode="hero" />
        <aside class="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">{stage.replace(/_/g, ' ')}</span>
            <span class="text-[10px] text-[var(--color-text-faint)]">{identity?.county && identity.state_ ? `${identity.county}, ${identity.state_}` : 'Location pending'}</span>
            {snapshot?.subjectParcelUrl && <a data-testid="landportal-subject-link-overview" href={snapshot.subjectParcelUrl} target="_blank" rel="noreferrer" class="text-[10px] font-semibold text-[var(--color-accent)] underline">Open subject in LandPortal ↗</a>}
          </div>
          <h2 class="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-faint)]">Current recommendation</h2>
          <div class="mt-2 text-[24px] font-black leading-tight text-[var(--color-text)]">{analysis?.overall.bestCurrentStrategy || snapshot?.recommendation.preferredStrategy || 'Keep researching'}</div>
          <p class="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            {analysis?.overall.recommendation || snapshot?.recommendation.postureWhy || 'LandOS will form an acquisition posture as the current research finishes.'}
          </p>
          <div class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <div class="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">Acquisition posture</div>
            <div class="mt-1 text-[14px] font-bold uppercase text-[var(--color-accent)]">{analysis?.overall.posture || snapshot?.recommendation.posture || 'Undetermined'}</div>
          </div>
          <div class="mt-auto grid grid-cols-2 gap-2 pt-4">
            <ActionButton disabled={!seller?.phone} onClick={() => seller?.phone && window.open(`tel:${seller.phone}`, '_self')}>Call seller</ActionButton>
            <ActionButton disabled={!seller?.phone} onClick={() => seller?.phone && window.open(`sms:${seller.phone}`, '_self')}>Text seller</ActionButton>
            <ActionButton onClick={() => onNavigate('seller')}>Add communication</ActionButton>
            <ActionButton onClick={() => onNavigate('seller')}>Add task</ActionButton>
            <button
              type="button"
              aria-label="Refresh research"
              disabled={researchRunning}
              onClick={onRunResearch}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-[11px] font-semibold text-[var(--color-text)] transition hover:border-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {researchRunning ? 'Researching…' : 'Run research'}
            </button>
            <ActionButton primary onClick={onStartOffer}>Start offer</ActionButton>
          </div>
          <button type="button" onClick={onEdit} class="mt-3 self-start text-[10.5px] font-semibold text-[var(--color-text-muted)] underline decoration-[var(--color-border-strong)] underline-offset-4 hover:text-[var(--color-text)]">Edit property details</button>
        </aside>
      </div>

      <section class="grid gap-3 sm:grid-cols-3">
        <ValueCard label="Working value" value={money(analysis?.values.workingUnderwritingValue ?? snapshot?.valuation.workingValue)} note={analysis?.values.explanation ?? snapshot?.valuation.primaryBasis ?? undefined} />
        <ValueCard label="Expected retail" value={range(analysis?.values.retailAskingRange ?? snapshot?.valuation.likelyRetail ?? snapshot?.valuation.range)} />
        <ValueCard label="Quick-sale range" value={range(analysis?.values.quickSaleDispositionRange ?? snapshot?.valuation.dispositionRange)} />
      </section>

      <PropertyCharacteristics snapshot={snapshot} />
      <MinorSubdivisionCard snapshot={snapshot} />

      <section class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
        <div>
          <h2 class="text-[14px] font-bold text-[var(--color-text)]">Acquisition guidance</h2>
          <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">Use each threshold for its specific negotiation decision; these are not interchangeable.</p>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <ValueCard label="Opening position" value={openingPosition == null ? 'Pending' : money(openingPosition)} note="A credible first position that leaves room to negotiate." />
          <ValueCard label="Target negotiation range" value={target ? range(target) : 'Pending'} emphasis note={target?.basis ?? 'The preferred range for an acceptable acquisition.'} />
          <ValueCard label="Maximum supported acquisition" value={practicalMaximum == null ? 'Pending' : money(practicalMaximum)} note="The highest price currently supported by the modeled exit." />
          <ValueCard label="Walk-away level" value={walkAwayLevel == null ? 'Pending' : money(walkAwayLevel)} note="Do not exceed without materially better evidence or economics." />
        </div>
      </section>

      <section class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
        <div>
          <h2 class="text-[14px] font-bold text-[var(--color-text)]">CRM status</h2>
          <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">Where this lead stands and the next operational move.</p>
        </div>
        <dl class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CrmStatusFact label="Lead stage" value={crmStatus?.stageLabel || 'Pending'} />
          <CrmStatusFact label="Next operational step" value={crmStatus?.nextOperationalStep || 'Pending'} wide />
          <CrmStatusFact label="Follow-up date" value={crmStatus?.followUpDate || 'Not scheduled'} />
          <CrmStatusFact label="Task owner" value={crmStatus?.taskOwner || 'Unassigned'} />
          <CrmStatusFact label="Offer status" value={crmStatus?.offerStatus || 'Not started'} />
          <CrmStatusFact
            label="Latest meaningful activity"
            value={crmStatus?.latestActivity
              ? `${crmStatus.latestActivity.label}: ${crmStatus.latestActivity.summary} · ${formatRelativeTime(crmStatus.latestActivity.createdAt)}`
              : 'No meaningful activity yet'}
            wide
          />
        </dl>
      </section>

      <section>
        <div class="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 class="text-[14px] font-bold text-[var(--color-text)]">Deal scores</h2>
            <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">Property quality, resale environment, and seller opportunity are judged separately.</p>
          </div>
        </div>
        <div class="grid gap-3 lg:grid-cols-3">
          <ScoreCard label="Property score" score={analysis?.scores.property} accent="bg-emerald-500" />
          <ScoreCard label="Market score" score={analysis?.scores.market} accent="bg-sky-500" />
          <ScoreCard
            label="Seller score"
            score={analysis?.scores.seller}
            accent="bg-amber-500"
            pending={!hasSellerEvidence}
            pendingExplanation="Not enough information. Capture price, motivation, responsiveness, timing, decision authority, or flexibility before scoring the seller."
          />
        </div>
      </section>

      <section class="grid gap-3 lg:grid-cols-2">
        <BulletPanel title="Main opportunity" rows={[opportunity]} tone="text-emerald-400" />
        <BulletPanel title="Main risks" rows={risks} tone="text-rose-400" />
        <BulletPanel title="Questions for the seller" rows={analysis?.seller.discoveryCallQuestions ?? questions} tone="text-sky-400" />
        <BulletPanel title="Next best actions" rows={actions} tone="text-[var(--color-accent)]" />
      </section>

      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
        <div class="grid divide-y divide-[var(--color-border)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <details class="group p-4">
            <summary class="cursor-pointer list-none">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-[12px] font-bold text-[var(--color-text)]">Property & public records</div>
                  <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Parcel identity, owner, acreage, and retained public-record facts</div>
                </div>
                <span class="text-[var(--color-accent)] group-open:rotate-180">⌄</span>
              </div>
            </summary>
            <div class="mt-4"><PropertyIntelligenceProperty snapshot={snapshot} /></div>
          </details>
          <details class="group p-4">
            <summary class="cursor-pointer list-none">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-[12px] font-bold text-[var(--color-text)]">Property screening</div>
                  <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Access, terrain, flood, wetlands, utilities, zoning, and septic</div>
                </div>
                <span class="text-[var(--color-accent)] group-open:rotate-180">⌄</span>
              </div>
            </summary>
            <div class="mt-4"><PropertyIntelligenceDueDiligence snapshot={snapshot} /></div>
          </details>
        </div>
      </section>

      <section class="grid gap-3 md:grid-cols-3">
        <button type="button" onClick={() => onNavigate('market')} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left hover:border-[var(--color-accent)]">
          <div class="text-[11px] font-bold text-[var(--color-text)]">Comps & market →</div>
          <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">{snapshot?.comps.sold.length ?? 0} sold comps · {snapshot?.comps.active.length ?? 0} active competitors{(snapshot?.comps.askingReferences?.length ?? 0) > 0 ? ` · ${snapshot!.comps.askingReferences!.length} asking references` : ''}</div>
        </button>
        <button type="button" onClick={() => onNavigate('seller')} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left hover:border-[var(--color-accent)]">
          <div class="text-[11px] font-bold text-[var(--color-text)]">Seller & communications →</div>
          <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">{seller?.name || 'Seller not captured'}{askingPrice != null ? ` · asking ${money(askingPrice)}` : ''}</div>
        </button>
        <button type="button" onClick={() => onNavigate('documents')} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-left hover:border-[var(--color-accent)]">
          <div class="text-[11px] font-bold text-[var(--color-text)]">Documents & screenshots →</div>
          <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">{snapshot?.evidence.length ?? 0} retained evidence item(s)</div>
        </button>
      </section>

      {sellerNotes && (
        <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <summary class="cursor-pointer text-[11px] font-bold text-[var(--color-text)]">Seller notes</summary>
          <p class="mt-3 whitespace-pre-wrap text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{sellerNotes}</p>
        </details>
      )}
    </div>
  );
}

export function SellerWorkspace({
  snapshot,
  people,
  askingPrice,
  sellerNotes,
  dealCardId,
  propertyCardId,
  acquisition,
  onEdit,
  onTaskSaved,
}: {
  snapshot: PiSnapshot | null;
  people: DealWorkspacePerson[];
  askingPrice: number | null;
  sellerNotes: string;
  dealCardId: number;
  propertyCardId: number | null;
  acquisition: DealWorkspaceAcquisition | null;
  onEdit: () => void;
  onTaskSaved: () => void;
}) {
  const analysis = analystFrom(snapshot);
  const seller = people.find((person) => person.role === 'seller') ?? people[0];
  const sellerRecord = {
    name: acquisition?.profile.name || seller?.name,
    role: acquisition?.profile.role || seller?.role,
    phone: acquisition?.profile.phone || seller?.phone,
    email: acquisition?.profile.email || seller?.email,
    mailingAddress: acquisition?.profile.mailingAddress || seller?.mailing_address,
    authority: acquisition?.profile.decisionMakers || seller?.authority_status,
  };
  const hasSellerEvidence = Boolean(
    askingPrice != null
    || sellerNotes.trim()
    || sellerRecord.phone
    || sellerRecord.email
    || sellerRecord.authority,
  );
  const [taskText, setTaskText] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profile, setProfile] = useState(() => ({ ...(acquisition?.profile ?? {}) }));
  const [stage, setStage] = useState(acquisition?.stage ?? 'new_lead');
  const communicationButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    setProfile({ ...(acquisition?.profile ?? {}) });
    setStage(acquisition?.stage ?? 'new_lead');
  }, [acquisition]);
  const closeCommunication = () => {
    setCommunicationOpen(false);
    window.setTimeout(() => communicationButton.current?.focus(), 0);
  };
  const saveTask = async (event: Event) => {
    event.preventDefault();
    const action = taskText.trim();
    if (!propertyCardId || !action || taskBusy) return;
    setTaskBusy(true);
    setTaskStatus(null);
    try {
      await apiPost(`/api/landos/property-cards/${propertyCardId}/next-action`, {
        action,
        createdBy: 'landos/deal-card',
      });
      setTaskText('');
      setTaskStatus('Task added to this Deal Card.');
      onTaskSaved();
    } catch {
      setTaskStatus('Task could not be added. Try again.');
    } finally {
      setTaskBusy(false);
    }
  };
  const saveProfile = async (event: Event) => {
    event.preventDefault();
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileStatus(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealCardId}/acquisition/profile`, { profile });
      setProfileStatus('Seller and CRM details saved.');
      setProfileOpen(false);
      onTaskSaved();
    } catch {
      setProfileStatus('Seller details could not be saved. Your entries are still here.');
    } finally {
      setProfileBusy(false);
    }
  };
  const saveStage = async () => {
    if (profileBusy || stage === acquisition?.stage) return;
    setProfileBusy(true);
    setProfileStatus(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealCardId}/acquisition/stage`, { stage });
      setProfileStatus('CRM stage advanced.');
      onTaskSaved();
    } catch {
      setProfileStatus('CRM stage could not be changed.');
    } finally {
      setProfileBusy(false);
    }
  };
  const profileValue = (key: keyof DealWorkspaceAcquisition['profile']): string =>
    typeof profile[key] === 'string' ? String(profile[key]) : '';
  const setProfileValue = (key: keyof DealWorkspaceAcquisition['profile'], value: string | boolean) =>
    setProfile((current) => ({ ...current, [key]: value }));
  return (
    <div data-testid="seller-workspace" class="space-y-3">
      <section class="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">Seller snapshot</div>
              <h2 class="mt-1 text-[20px] font-bold text-[var(--color-text)]">{sellerRecord.name || 'Seller not captured'}</h2>
              <div class="mt-1 text-[11px] text-[var(--color-text-muted)]">{sellerRecord.role || 'Lead contact'}{sellerRecord.authority ? ` · ${sellerRecord.authority}` : ''}</div>
            </div>
            <ActionButton onClick={() => setProfileOpen((value) => !value)}>Edit seller</ActionButton>
          </div>
          <dl class="mt-4 grid gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2">
            <ContactFact label="Phone" value={sellerRecord.phone} />
            <ContactFact label="Email" value={sellerRecord.email} />
            <ContactFact label="Asking price" value={acquisition?.profile.askingPrice || (askingPrice == null ? null : money(askingPrice))} />
            <ContactFact label="Mailing address" value={sellerRecord.mailingAddress} />
          </dl>
          <div class="mt-4 flex flex-wrap gap-2">
            <ActionButton disabled={!sellerRecord.phone} onClick={() => sellerRecord.phone && window.open(`tel:${sellerRecord.phone}`, '_self')}>Call</ActionButton>
            <ActionButton disabled={!sellerRecord.phone} onClick={() => sellerRecord.phone && window.open(`sms:${sellerRecord.phone}`, '_self')}>Text</ActionButton>
            <button
              ref={communicationButton}
              type="button"
              onClick={() => setCommunicationOpen(true)}
              class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-white shadow-sm"
            >
              Add communication
            </button>
          </div>
        </div>
        <ScoreCard
          label="Seller score"
          score={analysis?.scores.seller}
          accent="bg-amber-500"
          pending={!hasSellerEvidence}
          pendingExplanation="Not enough information. Capture motivation, price, responsiveness, timing, authority, or flexibility before scoring the seller."
        />
      </section>
      {profileOpen && (
        <form onSubmit={saveProfile} class="rounded-xl border border-[var(--color-accent)]/50 bg-[var(--color-card)] p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[12px] font-bold text-[var(--color-text)]">Seller and CRM details</div>
              <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]">Keep the relationship record and next operational move on this Deal Card.</div>
            </div>
            <button type="button" onClick={() => setProfileOpen(false)} class="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[12px]" aria-label="Close seller editor">×</button>
          </div>
          <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SellerInput label="Seller name" value={profileValue('name')} onInput={(value) => setProfileValue('name', value)} />
            <SellerInput label="Role" value={profileValue('role')} onInput={(value) => setProfileValue('role', value)} placeholder="Owner, trustee, heir…" />
            <SellerInput label="Assigned owner" value={profileValue('assignedOwner')} onInput={(value) => setProfileValue('assignedOwner', value)} placeholder="Who owns this lead?" />
            <SellerInput label="Phone" value={profileValue('phone')} onInput={(value) => setProfileValue('phone', value)} />
            <SellerInput label="Email" value={profileValue('email')} onInput={(value) => setProfileValue('email', value)} />
            <SellerInput label="Mailing address" value={profileValue('mailingAddress')} onInput={(value) => setProfileValue('mailingAddress', value)} />
            <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
              Preferred method
              <select value={profileValue('preferredChannel')} onChange={(event) => setProfileValue('preferredChannel', (event.currentTarget as HTMLSelectElement).value)} class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]">
                <option value="">Not captured</option>
                <option value="call">Call</option>
                <option value="text">Text</option>
                <option value="email">Email</option>
                <option value="voicemail">Voicemail</option>
                <option value="in_person">In person</option>
              </select>
            </label>
            <SellerInput label="Decision authority" value={profileValue('decisionMakers')} onInput={(value) => setProfileValue('decisionMakers', value)} />
            <SellerInput label="Relationship to owner" value={profileValue('relationshipToProperty')} onInput={(value) => setProfileValue('relationshipToProperty', value)} />
            <SellerInput label="Asking price" value={profileValue('askingPrice')} onInput={(value) => setProfileValue('askingPrice', value)} />
            <SellerInput label="Motivation" value={profileValue('motivation')} onInput={(value) => setProfileValue('motivation', value)} />
            <SellerInput label="Timeline" value={profileValue('timeline')} onInput={(value) => setProfileValue('timeline', value)} />
            <SellerInput label="Price flexibility" value={profileValue('priceFlexibility')} onInput={(value) => setProfileValue('priceFlexibility', value)} />
            <SellerInput label="Follow-up date" type="date" value={profileValue('nextFollowUpDate')} onInput={(value) => setProfileValue('nextFollowUpDate', value)} />
            <label class="flex items-center gap-2 self-end rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[11px] text-[var(--color-text)]">
              <input type="checkbox" checked={profile.primaryContact === true} onChange={(event) => setProfileValue('primaryContact', (event.currentTarget as HTMLInputElement).checked)} />
              Primary contact
            </label>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <ActionButton onClick={() => setProfileOpen(false)}>Cancel</ActionButton>
            <ActionButton type="submit" primary disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save seller details'}</ActionButton>
          </div>
        </form>
      )}
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
            CRM stage
            <select value={stage} onChange={(event) => setStage((event.currentTarget as HTMLSelectElement).value)} class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]">
              <option value="new_lead">New lead</option>
              <option value="needs_discovery">Needs discovery</option>
              <option value="discovery_complete">Discovery complete</option>
              <option value="needs_follow_up">Needs follow-up</option>
              <option value="ready_for_offer_prep">Ready for offer prep</option>
              <option value="offer_sent">Offer sent</option>
              <option value="stalled">Stalled</option>
              <option value="paused">Paused</option>
              <option value="pass">Pass</option>
            </select>
          </label>
          <ActionButton primary onClick={() => void saveStage()} disabled={profileBusy || stage === acquisition?.stage}>Advance stage</ActionButton>
        </div>
        {profileStatus && <div role="status" class="mt-2 text-[10.5px] text-[var(--color-text-muted)]">{profileStatus}</div>}
      </section>
      <form onSubmit={saveTask} class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">Add task</div>
        <div class="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="New Deal Card task"
            value={taskText}
            onInput={(event) => setTaskText((event.currentTarget as HTMLInputElement).value)}
            placeholder="Next action for this deal…"
            class="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"
          />
          <ActionButton type="submit" primary disabled={!propertyCardId || !taskText.trim() || taskBusy}>
            {taskBusy ? 'Adding…' : 'Add task'}
          </ActionButton>
        </div>
        {taskStatus && <div role="status" class="mt-2 text-[10.5px] text-[var(--color-text-muted)]">{taskStatus}</div>}
      </form>
      <section class="grid gap-3 lg:grid-cols-2">
        <BulletPanel title="Discovery-call questions" rows={analysis?.seller.discoveryCallQuestions ?? snapshot?.missingInformation ?? []} tone="text-sky-400" />
        <BulletPanel title="Next contact action" rows={analysis?.seller.nextContactAction ? [analysis.seller.nextContactAction] : snapshot?.nextActions ?? []} tone="text-[var(--color-accent)]" />
      </section>
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">Seller notes & negotiation context</div>
        <p class="mt-3 whitespace-pre-wrap text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{sellerNotes || 'No seller notes have been captured yet.'}</p>
      </section>
      <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-text-faint)]">Communication timeline</div>
        {(acquisition?.commLog.length ?? 0) > 0 ? (
          <ol class="mt-3 space-y-2">
            {acquisition!.commLog.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                <div class="flex flex-wrap items-center gap-2 text-[9.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
                  <span class="font-bold text-[var(--color-text)]">{entry.direction} {entry.channel}</span>
                  <span>{new Date(entry.at).toLocaleString()}</span>
                  {entry.followUpDate && <span class="rounded-full border border-[var(--color-border)] px-2 py-0.5">Follow up {entry.followUpDate}</span>}
                </div>
                <div class="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-text)]">{entry.summary}</div>
                {entry.outcome && <div class="mt-1 text-[10.5px] text-[var(--color-text-muted)]"><strong>Outcome:</strong> {entry.outcome}</div>}
              </li>
            ))}
          </ol>
        ) : <p class="mt-3 text-[11px] text-[var(--color-text-faint)]">No calls, texts, emails, or notes have been recorded yet.</p>}
      </section>
      {communicationOpen && (
        <CommunicationDialog
          dealCardId={dealCardId}
          onClose={closeCommunication}
          onSaved={() => {
            closeCommunication();
            onTaskSaved();
          }}
        />
      )}
    </div>
  );
}

type CommunicationType = 'call_transcript' | 'text' | 'email' | 'note' | 'intake_update' | 'uploaded_transcript';

const COMMUNICATION_TYPE_LABELS: Record<CommunicationType, string> = {
  call_transcript: 'Call transcript',
  text: 'Text',
  email: 'Email',
  note: 'Note',
  intake_update: 'Intake update',
  uploaded_transcript: 'Uploaded transcript or script',
};

function CommunicationDialog({
  dealCardId,
  onClose,
  onSaved,
}: {
  dealCardId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<CommunicationType>('call_transcript');
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [outcome, setOutcome] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textArea = useRef<HTMLTextAreaElement | null>(null);
  const dirty = Boolean(text.trim() || fileName || outcome.trim() || followUpDate);

  const requestClose = () => {
    if (dirty && !window.confirm('Discard this unsaved communication?')) return;
    onClose();
  };

  useEffect(() => {
    textArea.current?.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [dirty]);

  const save = async (event: Event) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    const channel = type === 'text' ? 'text' : type === 'email' ? 'email' : type === 'call_transcript' ? 'call' : 'other';
    try {
      await apiPost(`/api/landos/deal-cards/${dealCardId}/acquisition/comm`, {
        at: new Date().toISOString(),
        channel,
        direction,
        summary: content.slice(0, 500),
        notes: content,
        outcome: outcome.trim() || undefined,
        followUpDate: followUpDate || undefined,
        sentiment: 'unknown',
        followUpNeeded: Boolean(followUpDate),
      });
      if (followUpDate) {
        await apiPost(`/api/landos/deal-cards/${dealCardId}/acquisition/profile`, {
          profile: { nextFollowUpDate: followUpDate },
        });
      }
      onSaved();
    } catch {
      setError('Communication could not be saved. Your text is still here; try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="communication-dialog-title" class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
        <header class="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
          <div>
            <h2 id="communication-dialog-title" class="text-[15px] font-bold text-[var(--color-text)]">Add communication</h2>
            <p class="mt-1 text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">Record an interaction or internal note. Nothing is sent to the seller.</p>
          </div>
          <button type="button" aria-label="Close add communication" onClick={requestClose} class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[17px] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">×</button>
        </header>
        <form onSubmit={save} class="min-h-0 overflow-y-auto p-4 sm:p-5">
          <div class="grid gap-3 sm:grid-cols-[1fr_180px]">
            <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
              Communication type
              <select value={type} onChange={(event) => setType((event.currentTarget as HTMLSelectElement).value as CommunicationType)} class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]">
                {(Object.keys(COMMUNICATION_TYPE_LABELS) as CommunicationType[]).map((value) => <option key={value} value={value}>{COMMUNICATION_TYPE_LABELS[value]}</option>)}
              </select>
            </label>
            <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
              Direction
              <select value={direction} onChange={(event) => setDirection((event.currentTarget as HTMLSelectElement).value as 'inbound' | 'outbound')} class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]">
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </label>
          </div>
          <label class="mt-4 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
            {type === 'call_transcript' || type === 'uploaded_transcript' ? 'Transcript or script' : 'Details'}
            <textarea
              ref={textArea}
              rows={10}
              value={text}
              onInput={(event) => setText((event.currentTarget as HTMLTextAreaElement).value)}
              placeholder={type === 'call_transcript' ? 'Paste the seller call transcript…' : 'Paste or type the communication details…'}
              class="mt-1.5 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-[12px] font-normal normal-case leading-relaxed tracking-normal text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-accent)]"
            />
          </label>
          {(type === 'call_transcript' || type === 'uploaded_transcript') && (
            <label class="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[11px] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]">
              <span class="min-w-0 truncate">{fileName || 'Upload a .txt, .md, .csv, or .json transcript/script'}</span>
              <span class="shrink-0 font-semibold text-[var(--color-accent)]">Choose file</span>
              <input
                type="file"
                accept=".txt,.md,.csv,.json,text/plain,text/markdown,application/json"
                class="sr-only"
                onChange={(event) => {
                  const file = (event.currentTarget as HTMLInputElement).files?.[0];
                  if (!file) return;
                  setFileName(file.name);
                  const reader = new FileReader();
                  reader.onload = () => setText(String(reader.result ?? ''));
                  reader.onerror = () => setError('That file could not be read. Paste its contents instead.');
                  reader.readAsText(file);
                }}
              />
            </label>
          )}
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
              Outcome
              <input value={outcome} onInput={(event) => setOutcome((event.currentTarget as HTMLInputElement).value)} placeholder="Reached seller, left voicemail, agreed next step…" class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
            </label>
            <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
              Follow-up date
              <input type="date" value={followUpDate} onInput={(event) => setFollowUpDate((event.currentTarget as HTMLInputElement).value)} class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
            </label>
          </div>
          {error && <div role="alert" class="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{error}</div>}
          <footer class="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={requestClose} class="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold text-[var(--color-text)]">Cancel</button>
            <button type="submit" disabled={!text.trim() || busy} class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Saving…' : 'Save communication'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SellerInput({
  label,
  value,
  onInput,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'date';
}) {
  return (
    <label class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
      {label}
      <input type={type} value={value} placeholder={placeholder} onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)} class="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-[var(--color-text)]" />
    </label>
  );
}

function ContactFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">{label}</dt>
      <dd class="mt-1 text-[12px] font-semibold text-[var(--color-text)]">{value || 'Not captured'}</dd>
    </div>
  );
}
