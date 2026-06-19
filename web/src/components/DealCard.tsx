import { useEffect, useState } from 'preact/hooks';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost, apiPatch, apiPut } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

// Deal Card panel — a usable list/open/create/edit/save/reload flow over the
// deal-level fields. Data comes from /api/landos/deal-cards (list) and
// /api/landos/deal-cards/:id (detail); writes go to POST /api/landos/deal-cards
// (create) and PATCH /api/landos/deal-cards/:id (update). After any write we
// re-load the same id from the API (proves persistence + keeps us on one record,
// no duplicate) AND refresh the list so a saved card is visible to open again.
//
// Deal-level fields only live here (title, stage, seller notes, asking price,
// strategy, package notes). Parcel identity/verification is never edited here.
// Fields the data model does not yet carry render an explicit "not captured yet"
// placeholder rather than fabricated values. No external CRM/GHL mutation, no
// fake sync, and imagery never drives parcel identity (exact-source only).

const MIN_NET_BASELINE_USD = 10_000;

// Deal Card stages (mirrors DEAL_CARD_STATUSES in src/landos/db.ts). The backend
// re-validates, so this is just the picker surface.
const DEAL_STAGES = [
  'new', 'researching', 'discovery', 'underwriting', 'offer_ready',
  'offer_sent', 'follow_up', 'under_contract', 'closed', 'dead', 'archived',
] as const;

interface DealForm {
  entity: 'LAND_ALLY' | 'TY_LAND_BIZ';
  title: string;
  status: string;
  sellerNotes: string;
  askingPrice: string;
  combinedStrategy: string;
  packageNotes: string;
}

const EMPTY_FORM: DealForm = {
  entity: 'TY_LAND_BIZ', title: '', status: 'new', sellerNotes: '',
  askingPrice: '', combinedStrategy: '', packageNotes: '',
};

// DD/Research worksheet confidence labels + identity statuses (mirror
// DD_FIELD_LABELS / DD_PARCEL_IDENTITY_STATUSES in src/landos/db.ts; the backend
// re-validates and enforces the "Verified needs a source" guardrail).
const DD_FIELD_LABELS = [
  'Verified', 'Seller stated', 'Assumed', 'Unknown', 'Needs verification',
  'Local Area Context, Not Parcel Verified',
] as const;
const DD_IDENTITY_STATUSES = [
  'local_area_context_not_verified', 'seller_stated', 'address_only',
  'apn_provided', 'source_verified', 'unknown',
] as const;

interface DdSourceLink { label: string; url: string }

interface DdView {
  exists: boolean;
  parcelIdentityStatus: string;
  apn: string; apnLabel: string;
  county: string; state: string; locationLabel: string;
  acreage: number | null; acreageLabel: string;
  zoning: string; zoningLabel: string;
  accessStatus: string; accessLabel: string;
  utilitiesStatus: string; utilitiesLabel: string;
  floodStatus: string; floodLabel: string;
  wetlandsStatus: string; wetlandsLabel: string;
  roadFrontageNotes: string;
  sourceLinks: DdSourceLink[];
  dataGaps: string[]; riskFlags: string[];
  notes: string; updatedBy: string; updatedAt: number | null;
}

interface DdForm {
  parcelIdentityStatus: string;
  apn: string; apnLabel: string;
  county: string; state: string; locationLabel: string;
  acreage: string; acreageLabel: string;
  zoning: string; zoningLabel: string;
  accessStatus: string; accessLabel: string;
  utilitiesStatus: string; utilitiesLabel: string;
  floodStatus: string; floodLabel: string;
  wetlandsStatus: string; wetlandsLabel: string;
  roadFrontageNotes: string;
  sourceLinksText: string;
  dataGapsText: string;
  riskFlagsText: string;
  notes: string;
}

// Strategy worksheet offer-readiness labels (mirror STRATEGY_OFFER_READINESS in
// src/landos/db.ts; the backend re-validates). Strategy defaults to 'not_reviewed'
// and is never auto-advanced.
const STRATEGY_READINESS = [
  'not_reviewed', 'needs_confirmation', 'blocked', 'ready_for_offer', 'pass',
] as const;

interface StrategyView {
  exists: boolean;
  offerReadiness: string;
  strategyCandidates: string[];
  blockers: string[];
  nextConfirmations: string[];
  currentRecommendation: string;
  mostViableStrategy: string;
  preCallStrategyNotes: string;
  quickFlipNotes: string;
  subdivideNotes: string;
  landHomePackageNotes: string;
  improvedValueAddNotes: string;
  teardownLandOnlyNotes: string;
  passNoOfferReason: string;
  riskAdjustedNotes: string;
  targetProfitNote: string;
  notes: string;
  updatedBy: string;
  updatedAt: number | null;
}

interface StrategyForm {
  offerReadiness: string;
  strategyCandidatesText: string;
  blockersText: string;
  nextConfirmationsText: string;
  currentRecommendation: string;
  mostViableStrategy: string;
  preCallStrategyNotes: string;
  quickFlipNotes: string;
  subdivideNotes: string;
  landHomePackageNotes: string;
  improvedValueAddNotes: string;
  teardownLandOnlyNotes: string;
  passNoOfferReason: string;
  riskAdjustedNotes: string;
  targetProfitNote: string;
  notes: string;
}

// Market Research demand labels + source-confidence labels (mirror
// MARKET_DEMAND_LABELS / MARKET_SOURCE_CONFIDENCE in src/landos/db.ts; the
// backend re-validates and enforces the honest-conclusion guardrails). Demand
// defaults to 'not_reviewed' and is never auto-advanced.
const MARKET_DEMAND_LABELS = [
  'not_reviewed', 'needs_research', 'weak_demand', 'moderate_demand',
  'strong_demand', 'mixed_uncertain',
] as const;
const MARKET_SOURCE_CONFIDENCE = [
  'unknown', 'low', 'medium', 'high', 'needs_research',
] as const;

interface MarketView {
  exists: boolean;
  marketReviewStatus: string;
  targetAreaLabel: string;
  countyCityRegionNotes: string;
  buyerDemandNotes: string; buyerDemandLabel: string;
  activeListingNotes: string;
  soldCompContextNotes: string;
  daysOnMarketNotes: string;
  manufacturedHomeDemandNotes: string; manufacturedHomeDemandLabel: string;
  subdivisionDemandNotes: string; subdivisionDemandLabel: string;
  infillLotDemandNotes: string; infillLotDemandLabel: string;
  ruralAcreageDemandNotes: string; ruralAcreageDemandLabel: string;
  countyGrowthPlanningNotes: string;
  exitStrategySupportNotes: string;
  sourceLinks: DdSourceLink[];
  sourceConfidence: string;
  dataGaps: string[]; riskFlags: string[];
  notes: string; updatedBy: string; updatedAt: number | null;
}

interface MarketForm {
  marketReviewStatus: string;
  targetAreaLabel: string;
  countyCityRegionNotes: string;
  buyerDemandNotes: string; buyerDemandLabel: string;
  activeListingNotes: string;
  soldCompContextNotes: string;
  daysOnMarketNotes: string;
  manufacturedHomeDemandNotes: string; manufacturedHomeDemandLabel: string;
  subdivisionDemandNotes: string; subdivisionDemandLabel: string;
  infillLotDemandNotes: string; infillLotDemandLabel: string;
  ruralAcreageDemandNotes: string; ruralAcreageDemandLabel: string;
  countyGrowthPlanningNotes: string;
  exitStrategySupportNotes: string;
  sourceLinksText: string;
  sourceConfidence: string;
  dataGapsText: string;
  riskFlagsText: string;
  notes: string;
}

interface PropertyCardLite {
  id: number;
  active_input_address?: string | null;
  apn?: string | null;
  county?: string | null;
  state?: string | null;
  acres?: number | null;
  zoning?: string | null;
  verification_status?: string | null;
  open_risks?: string | null;
  lp_url?: string | null;
}

interface PersonLite {
  name?: string | null;
  role?: string | null;
  authority_status?: string | null;
  phone?: string | null;
  email?: string | null;
  mailing_address?: string | null;
}

interface DealCardDetail {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  seller_notes: string;
  asking_price: number | null;
  combined_strategy: string;
  package_notes: string;
  combined_acreage: number | null;
  propertyCards?: PropertyCardLite[];
  people?: PersonLite[];
}

// A row in the saved-cards list (the list route returns the flat deal row).
interface DealCardListItem {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  asking_price: number | null;
  updated_at: number;
}

function entityBadge(entity: string | null): string {
  if (entity === 'LAND_ALLY') return 'Land Ally';
  if (entity === 'TY_LAND_BIZ') return 'My Business';
  return 'Unknown';
}

function Placeholder({ text = 'Not captured yet' }: { text?: string }) {
  return <span class="text-[12px] text-[var(--color-text-faint)] italic">{text}</span>;
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="flex justify-between gap-3 py-0.5">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      {has ? <span class="text-[12px] text-[var(--color-text)] text-right">{value}</span> : <Placeholder />}
    </div>
  );
}

// Human-readable parcel identity status + the verification color cue.
function identityStatusText(status?: string): string {
  switch (status) {
    case 'source_verified': return 'Source verified';
    case 'apn_provided': return 'APN provided (needs source)';
    case 'address_only': return 'Address only (needs source)';
    case 'seller_stated': return 'Seller stated';
    case 'unknown': return 'Unknown';
    case 'local_area_context_not_verified':
    default: return 'Local Area Context, Not Parcel Verified';
  }
}

function DdIdentityBadge({ status }: { status?: string }) {
  const verified = status === 'source_verified';
  const cls = verified
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>
      Identity: {identityStatusText(status)}
    </span>
  );
}

// A small confidence-label pill. 'Verified' is the only "trusted" cue; every
// other label reads as not-yet-verified so research data never looks verified.
function DdLabelPill({ label }: { label?: string }) {
  if (!label) return null;
  const verified = label === 'Verified';
  const cls = verified
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-text-faint)]';
  return <span class={`ml-2 text-[9px] px-1 py-0.5 rounded-full border ${cls} whitespace-nowrap`}>{label}</span>;
}

// A DD field row: value (or a missing placeholder) plus its confidence label.
function LabeledField({ label, value, confidence }: { label: string; value?: string | number | null; confidence?: string }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="flex justify-between items-center gap-3 py-0.5">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <span class="flex items-center text-right">
        {has ? <span class="text-[12px] text-[var(--color-text)]">{value}</span> : <Placeholder text="Missing" />}
        <DdLabelPill label={confidence} />
      </span>
    </div>
  );
}

// Human-readable offer-readiness label.
function readinessText(status?: string): string {
  switch (status) {
    case 'ready_for_offer': return 'Ready for offer';
    case 'needs_confirmation': return 'Needs confirmation';
    case 'blocked': return 'Blocked';
    case 'pass': return 'Pass';
    case 'not_reviewed':
    default: return 'Not reviewed';
  }
}

// Offer-readiness badge. Only 'ready_for_offer' reads as an accent (advanced)
// state; every other label reads as not-yet-ready so strategy never looks
// offer-ready until Tyler advances it.
function StrategyReadinessBadge({ status }: { status?: string }) {
  const ready = status === 'ready_for_offer';
  const blocked = status === 'blocked' || status === 'pass';
  const cls = ready
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : blocked
      ? 'border-[var(--color-status-failed)] text-[var(--color-status-failed)]'
      : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>
      Offer readiness: {readinessText(status)}
    </span>
  );
}

// A read-only strategy note row. Renders an honest placeholder when empty so a
// blank strategy lane never looks analyzed.
function StrategyNote({ label, value }: { label: string; value?: string }) {
  return (
    <div class="mt-2">
      <div class="text-[11px] text-[var(--color-text-muted)] mb-1">{label}</div>
      {value ? <span class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{value}</span> : <Placeholder text="Not reviewed" />}
    </div>
  );
}

// Human-readable market demand label.
function demandText(label?: string): string {
  switch (label) {
    case 'weak_demand': return 'Weak demand';
    case 'moderate_demand': return 'Moderate demand';
    case 'strong_demand': return 'Strong demand';
    case 'mixed_uncertain': return 'Mixed / uncertain';
    case 'needs_research': return 'Needs research';
    case 'not_reviewed':
    default: return 'Not reviewed';
  }
}

// Human-readable source-confidence label.
function sourceConfidenceText(label?: string): string {
  switch (label) {
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    case 'needs_research': return 'Needs research';
    case 'unknown':
    default: return 'Unknown';
  }
}

// A demand pill. Only 'strong_demand' reads as an accent (positive) cue; every
// other label reads as neutral so an unreviewed lane never looks like a verified
// market conclusion. Market demand is never a comp, price, or value.
function MarketDemandBadge({ label, prefix }: { label?: string; prefix?: string }) {
  const strong = label === 'strong_demand';
  const cls = strong
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls} whitespace-nowrap`}>
      {prefix ? `${prefix}: ` : ''}{demandText(label)}
    </span>
  );
}

// A market demand lane: a note (or honest placeholder) plus its demand label.
function MarketDemandLane({ label, note, demand }: { label: string; note?: string; demand?: string }) {
  return (
    <div class="mt-2">
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <MarketDemandBadge label={demand} />
      </div>
      {note ? <span class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{note}</span> : <Placeholder text="Needs research" />}
    </div>
  );
}

// A read-only market context note row (listing / sold / days-on-market / growth /
// region). Renders an honest placeholder when empty so a blank lane never looks
// like a fabricated market fact.
function MarketNote({ label, value }: { label: string; value?: string }) {
  return (
    <div class="mt-2">
      <div class="text-[11px] text-[var(--color-text-muted)] mb-1">{label}</div>
      {value ? <span class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{value}</span> : <Placeholder text="Not reviewed" />}
    </div>
  );
}

function DdList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div class="mt-3">
      <div class="text-[11px] text-[var(--color-text-muted)] mb-1">{title}</div>
      {items.length === 0 ? (
        <Placeholder text={empty} />
      ) : (
        <ul class="list-disc pl-4 space-y-0.5">
          {items.map((it) => <li key={it} class="text-[12px] text-[var(--color-text)] break-words">{it}</li>)}
        </ul>
      )}
    </div>
  );
}

export function DealCard({ dealCardId }: { dealCardId?: number }) {
  const [deal, setDeal] = useState<DealCardDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved-cards list state. The list is the primary open flow: fetched on mount
  // (unless we were handed a specific dealCardId) and refreshed after any write.
  const [cards, setCards] = useState<DealCardListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Create/edit state. mode 'view' renders the list + read-only panels; 'create'
  // and 'edit' render the deal-level form. saving/saveError gate the Save button.
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [form, setForm] = useState<DealForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // DD/Research worksheet state. Loaded alongside the open deal; edited inline
  // via a separate sub-form (independent of the deal-level create/edit form).
  const [dd, setDd] = useState<DdView | null>(null);
  const [ddEditing, setDdEditing] = useState(false);
  const [ddForm, setDdForm] = useState<DdForm | null>(null);
  const [ddSaving, setDdSaving] = useState(false);
  const [ddError, setDdError] = useState<string | null>(null);
  const [ddWarnings, setDdWarnings] = useState<string[]>([]);

  // Strategy worksheet state. Loaded alongside the open deal; edited inline via a
  // separate sub-form (independent of the deal-level and DD forms).
  const [strategy, setStrategy] = useState<StrategyView | null>(null);
  const [strategyEditing, setStrategyEditing] = useState(false);
  const [strategyForm, setStrategyForm] = useState<StrategyForm | null>(null);
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [strategyWarnings, setStrategyWarnings] = useState<string[]>([]);

  // Market Research worksheet state. Loaded alongside the open deal; edited inline
  // via a separate sub-form (independent of the deal-level, DD, and Strategy forms).
  const [market, setMarket] = useState<MarketView | null>(null);
  const [marketEditing, setMarketEditing] = useState(false);
  const [marketForm, setMarketForm] = useState<MarketForm | null>(null);
  const [marketSaving, setMarketSaving] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketWarnings, setMarketWarnings] = useState<string[]>([]);

  async function loadMarket(id: number) {
    try {
      const res = await apiGet<{ market: MarketView }>(`/api/landos/deal-cards/${id}/market`);
      setMarket(res.market);
    } catch {
      setMarket(null);
    }
  }

  async function loadDd(id: number) {
    try {
      const res = await apiGet<{ dd: DdView }>(`/api/landos/deal-cards/${id}/dd`);
      setDd(res.dd);
    } catch {
      setDd(null);
    }
  }

  async function loadStrategy(id: number) {
    try {
      const res = await apiGet<{ strategy: StrategyView }>(`/api/landos/deal-cards/${id}/strategy`);
      setStrategy(res.strategy);
    } catch {
      setStrategy(null);
    }
  }

  async function load(id: number) {
    try {
      setLoading(true);
      setError(null);
      setDdEditing(false);
      setDdWarnings([]);
      setStrategyEditing(false);
      setStrategyWarnings([]);
      setMarketEditing(false);
      setMarketWarnings([]);
      const res = await apiGet<{ dealCard: DealCardDetail }>(`/api/landos/deal-cards/${id}`);
      setDeal(res.dealCard);
      await loadDd(id);
      await loadStrategy(id);
      await loadMarket(id);
    } catch (err: any) {
      setError(err?.message || String(err));
      setDeal(null);
      setDd(null);
      setStrategy(null);
      setMarket(null);
    } finally {
      setLoading(false);
    }
  }

  function startDdEdit() {
    const d = dd;
    setDdError(null);
    setDdWarnings([]);
    setDdForm({
      parcelIdentityStatus: d?.parcelIdentityStatus ?? 'local_area_context_not_verified',
      apn: d?.apn ?? '', apnLabel: d?.apnLabel ?? 'Unknown',
      county: d?.county ?? '', state: d?.state ?? '', locationLabel: d?.locationLabel ?? 'Unknown',
      acreage: d?.acreage != null ? String(d.acreage) : '', acreageLabel: d?.acreageLabel ?? 'Unknown',
      zoning: d?.zoning ?? '', zoningLabel: d?.zoningLabel ?? 'Unknown',
      accessStatus: d?.accessStatus ?? '', accessLabel: d?.accessLabel ?? 'Unknown',
      utilitiesStatus: d?.utilitiesStatus ?? '', utilitiesLabel: d?.utilitiesLabel ?? 'Unknown',
      floodStatus: d?.floodStatus ?? '', floodLabel: d?.floodLabel ?? 'Unknown',
      wetlandsStatus: d?.wetlandsStatus ?? '', wetlandsLabel: d?.wetlandsLabel ?? 'Unknown',
      roadFrontageNotes: d?.roadFrontageNotes ?? '',
      sourceLinksText: (d?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n'),
      dataGapsText: (d?.dataGaps ?? []).join('\n'),
      riskFlagsText: (d?.riskFlags ?? []).join('\n'),
      notes: d?.notes ?? '',
    });
    setDdEditing(true);
  }

  function setDdField<K extends keyof DdForm>(key: K, value: DdForm[K]) {
    setDdForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function saveDd() {
    if (!deal || !ddForm) return;
    setDdSaving(true);
    setDdError(null);
    try {
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const sourceLinks = lines(ddForm.sourceLinksText).map((line) => {
        const i = line.indexOf('|');
        return i >= 0
          ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() }
          : { label: '', url: line };
      }).filter((l) => l.url);
      const payload = {
        parcelIdentityStatus: ddForm.parcelIdentityStatus,
        apn: ddForm.apn, apnLabel: ddForm.apnLabel,
        county: ddForm.county, state: ddForm.state, locationLabel: ddForm.locationLabel,
        acreage: ddForm.acreage.trim() === '' ? null : Number(ddForm.acreage),
        acreageLabel: ddForm.acreageLabel,
        zoning: ddForm.zoning, zoningLabel: ddForm.zoningLabel,
        accessStatus: ddForm.accessStatus, accessLabel: ddForm.accessLabel,
        utilitiesStatus: ddForm.utilitiesStatus, utilitiesLabel: ddForm.utilitiesLabel,
        floodStatus: ddForm.floodStatus, floodLabel: ddForm.floodLabel,
        wetlandsStatus: ddForm.wetlandsStatus, wetlandsLabel: ddForm.wetlandsLabel,
        roadFrontageNotes: ddForm.roadFrontageNotes,
        sourceLinks,
        dataGaps: lines(ddForm.dataGapsText),
        riskFlags: lines(ddForm.riskFlagsText),
        notes: ddForm.notes,
      };
      const res = await apiPut<{ dd: DdView; warnings: string[] }>(`/api/landos/deal-cards/${deal.id}/dd`, payload);
      // Re-load from the API so what we show is exactly what persisted.
      await loadDd(deal.id);
      setDdWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setDdEditing(false);
    } catch (err: any) {
      setDdError(err?.message || String(err));
    } finally {
      setDdSaving(false);
    }
  }

  function startStrategyEdit() {
    const s = strategy;
    setStrategyError(null);
    setStrategyWarnings([]);
    setStrategyForm({
      offerReadiness: s?.offerReadiness ?? 'not_reviewed',
      strategyCandidatesText: (s?.strategyCandidates ?? []).join('\n'),
      blockersText: (s?.blockers ?? []).join('\n'),
      nextConfirmationsText: (s?.nextConfirmations ?? []).join('\n'),
      currentRecommendation: s?.currentRecommendation ?? '',
      mostViableStrategy: s?.mostViableStrategy ?? '',
      preCallStrategyNotes: s?.preCallStrategyNotes ?? '',
      quickFlipNotes: s?.quickFlipNotes ?? '',
      subdivideNotes: s?.subdivideNotes ?? '',
      landHomePackageNotes: s?.landHomePackageNotes ?? '',
      improvedValueAddNotes: s?.improvedValueAddNotes ?? '',
      teardownLandOnlyNotes: s?.teardownLandOnlyNotes ?? '',
      passNoOfferReason: s?.passNoOfferReason ?? '',
      riskAdjustedNotes: s?.riskAdjustedNotes ?? '',
      targetProfitNote: s?.targetProfitNote ?? '',
      notes: s?.notes ?? '',
    });
    setStrategyEditing(true);
  }

  function setStrategyFieldFn<K extends keyof StrategyForm>(key: K, value: StrategyForm[K]) {
    setStrategyForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function saveStrategy() {
    if (!deal || !strategyForm) return;
    setStrategySaving(true);
    setStrategyError(null);
    try {
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const payload = {
        offerReadiness: strategyForm.offerReadiness,
        strategyCandidates: lines(strategyForm.strategyCandidatesText),
        blockers: lines(strategyForm.blockersText),
        nextConfirmations: lines(strategyForm.nextConfirmationsText),
        currentRecommendation: strategyForm.currentRecommendation,
        mostViableStrategy: strategyForm.mostViableStrategy,
        preCallStrategyNotes: strategyForm.preCallStrategyNotes,
        quickFlipNotes: strategyForm.quickFlipNotes,
        subdivideNotes: strategyForm.subdivideNotes,
        landHomePackageNotes: strategyForm.landHomePackageNotes,
        improvedValueAddNotes: strategyForm.improvedValueAddNotes,
        teardownLandOnlyNotes: strategyForm.teardownLandOnlyNotes,
        passNoOfferReason: strategyForm.passNoOfferReason,
        riskAdjustedNotes: strategyForm.riskAdjustedNotes,
        targetProfitNote: strategyForm.targetProfitNote,
        notes: strategyForm.notes,
      };
      const res = await apiPut<{ strategy: StrategyView; warnings: string[] }>(`/api/landos/deal-cards/${deal.id}/strategy`, payload);
      // Re-load from the API so what we show is exactly what persisted.
      await loadStrategy(deal.id);
      setStrategyWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setStrategyEditing(false);
    } catch (err: any) {
      setStrategyError(err?.message || String(err));
    } finally {
      setStrategySaving(false);
    }
  }

  function startMarketEdit() {
    const m = market;
    setMarketError(null);
    setMarketWarnings([]);
    setMarketForm({
      marketReviewStatus: m?.marketReviewStatus ?? 'not_reviewed',
      targetAreaLabel: m?.targetAreaLabel ?? '',
      countyCityRegionNotes: m?.countyCityRegionNotes ?? '',
      buyerDemandNotes: m?.buyerDemandNotes ?? '', buyerDemandLabel: m?.buyerDemandLabel ?? 'not_reviewed',
      activeListingNotes: m?.activeListingNotes ?? '',
      soldCompContextNotes: m?.soldCompContextNotes ?? '',
      daysOnMarketNotes: m?.daysOnMarketNotes ?? '',
      manufacturedHomeDemandNotes: m?.manufacturedHomeDemandNotes ?? '', manufacturedHomeDemandLabel: m?.manufacturedHomeDemandLabel ?? 'not_reviewed',
      subdivisionDemandNotes: m?.subdivisionDemandNotes ?? '', subdivisionDemandLabel: m?.subdivisionDemandLabel ?? 'not_reviewed',
      infillLotDemandNotes: m?.infillLotDemandNotes ?? '', infillLotDemandLabel: m?.infillLotDemandLabel ?? 'not_reviewed',
      ruralAcreageDemandNotes: m?.ruralAcreageDemandNotes ?? '', ruralAcreageDemandLabel: m?.ruralAcreageDemandLabel ?? 'not_reviewed',
      countyGrowthPlanningNotes: m?.countyGrowthPlanningNotes ?? '',
      exitStrategySupportNotes: m?.exitStrategySupportNotes ?? '',
      sourceLinksText: (m?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n'),
      sourceConfidence: m?.sourceConfidence ?? 'unknown',
      dataGapsText: (m?.dataGaps ?? []).join('\n'),
      riskFlagsText: (m?.riskFlags ?? []).join('\n'),
      notes: m?.notes ?? '',
    });
    setMarketEditing(true);
  }

  function setMarketFieldFn<K extends keyof MarketForm>(key: K, value: MarketForm[K]) {
    setMarketForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function saveMarket() {
    if (!deal || !marketForm) return;
    setMarketSaving(true);
    setMarketError(null);
    try {
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const sourceLinks = lines(marketForm.sourceLinksText).map((line) => {
        const i = line.indexOf('|');
        return i >= 0
          ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() }
          : { label: '', url: line };
      }).filter((l) => l.url);
      const payload = {
        marketReviewStatus: marketForm.marketReviewStatus,
        targetAreaLabel: marketForm.targetAreaLabel,
        countyCityRegionNotes: marketForm.countyCityRegionNotes,
        buyerDemandNotes: marketForm.buyerDemandNotes, buyerDemandLabel: marketForm.buyerDemandLabel,
        activeListingNotes: marketForm.activeListingNotes,
        soldCompContextNotes: marketForm.soldCompContextNotes,
        daysOnMarketNotes: marketForm.daysOnMarketNotes,
        manufacturedHomeDemandNotes: marketForm.manufacturedHomeDemandNotes, manufacturedHomeDemandLabel: marketForm.manufacturedHomeDemandLabel,
        subdivisionDemandNotes: marketForm.subdivisionDemandNotes, subdivisionDemandLabel: marketForm.subdivisionDemandLabel,
        infillLotDemandNotes: marketForm.infillLotDemandNotes, infillLotDemandLabel: marketForm.infillLotDemandLabel,
        ruralAcreageDemandNotes: marketForm.ruralAcreageDemandNotes, ruralAcreageDemandLabel: marketForm.ruralAcreageDemandLabel,
        countyGrowthPlanningNotes: marketForm.countyGrowthPlanningNotes,
        exitStrategySupportNotes: marketForm.exitStrategySupportNotes,
        sourceLinks,
        sourceConfidence: marketForm.sourceConfidence,
        dataGaps: lines(marketForm.dataGapsText),
        riskFlags: lines(marketForm.riskFlagsText),
        notes: marketForm.notes,
      };
      const res = await apiPut<{ market: MarketView; warnings: string[] }>(`/api/landos/deal-cards/${deal.id}/market`, payload);
      // Re-load from the API so what we show is exactly what persisted.
      await loadMarket(deal.id);
      setMarketWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setMarketEditing(false);
    } catch (err: any) {
      setMarketError(err?.message || String(err));
    } finally {
      setMarketSaving(false);
    }
  }

  // Refresh the saved-cards list. Failures surface as a list error but never
  // block the detail/create flow, and never fabricate rows.
  async function refreshList() {
    try {
      setListError(null);
      const res = await apiGet<{ dealCards: DealCardListItem[] }>('/api/landos/deal-cards');
      setCards(Array.isArray(res.dealCards) ? res.dealCards : []);
    } catch (err: any) {
      setListError(err?.message || String(err));
      setCards([]);
    }
  }

  useEffect(() => {
    if (dealCardId) void load(dealCardId);
    else void refreshList();
  }, [dealCardId]);

  function setField<K extends keyof DealForm>(key: K, value: DealForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startCreate() {
    setSaveError(null);
    setForm(EMPTY_FORM);
    setMode('create');
  }

  function startEdit() {
    if (!deal) return;
    setSaveError(null);
    setForm({
      entity: deal.entity === 'LAND_ALLY' ? 'LAND_ALLY' : 'TY_LAND_BIZ',
      title: deal.title ?? '',
      status: deal.status ?? 'new',
      sellerNotes: deal.seller_notes ?? '',
      askingPrice: deal.asking_price != null ? String(deal.asking_price) : '',
      combinedStrategy: deal.combined_strategy ?? '',
      packageNotes: deal.package_notes ?? '',
    });
    setMode('edit');
  }

  function cancelForm() {
    setSaveError(null);
    setMode('view');
  }

  // Return to the saved-cards list (deselect the open card). Refreshes the list
  // so any just-saved edits to title/stage are reflected in the row.
  function backToList() {
    setDeal(null);
    setError(null);
    setMode('view');
    void refreshList();
  }

  // Build a write payload. Entity is only set on create (immutable after). An
  // empty asking price is omitted, never sent as 0.
  function payloadFromForm(isCreate: boolean): Record<string, unknown> {
    const askingNum = form.askingPrice.trim() === '' ? undefined : Number(form.askingPrice);
    const p: Record<string, unknown> = {
      title: form.title,
      status: form.status,
      sellerNotes: form.sellerNotes,
      combinedStrategy: form.combinedStrategy,
      packageNotes: form.packageNotes,
    };
    if (isCreate) p.entity = form.entity;
    if (askingNum !== undefined && Number.isFinite(askingNum)) p.askingPrice = askingNum;
    return p;
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'create') {
        const res = await apiPost<{ dealCard: DealCardDetail }>('/api/landos/deal-cards', payloadFromForm(true));
        // Re-load the same id from the API: proves the record persisted and is
        // recoverable, and keeps us on the one record (no duplicate creation).
        await load(res.dealCard.id);
        // Refresh the list so the new card is openable again later.
        await refreshList();
      } else if (mode === 'edit' && deal) {
        await apiPatch<{ dealCard: DealCardDetail }>(`/api/landos/deal-cards/${deal.id}`, payloadFromForm(false));
        await load(deal.id);
        await refreshList();
      }
      setMode('view');
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const prop = deal?.propertyCards?.[0];
  const owner = deal?.people?.find((p) => p.role === 'owner');
  const seller = deal?.people?.find((p) => p.role === 'seller');

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Toolbar: back-to-list (when a card is open) + create a new Deal Card. */}
      <div class="flex flex-wrap items-center gap-2">
        {mode === 'view' && deal && !dealCardId && (
          <button
            type="button"
            onClick={backToList}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
          >
            ← Deal Cards
          </button>
        )}
        {mode === 'view' && (
          <>
            <button
              type="button"
              onClick={startCreate}
              class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)]"
            >
              New Deal Card
            </button>
            {deal && (
              <button
                type="button"
                onClick={startEdit}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
              >
                Edit
              </button>
            )}
          </>
        )}
      </div>

      {/* Create / edit form for the deal-level fields. */}
      {mode !== 'view' && (
        <DealForm
          mode={mode}
          form={form}
          setField={setField}
          onSave={() => void save()}
          onCancel={cancelForm}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Saved Deal Cards list — the primary open flow. Shown in view mode when no
          specific card is open and we are not embedded against a single id. */}
      {mode === 'view' && !dealCardId && !deal && (
        <Section title="Saved Deal Cards">
          {listError && <div class="text-[11px] text-[var(--color-status-failed)]">{listError}</div>}
          {cards === null && !listError && <div class="text-[12px] text-[var(--color-text-muted)]">Loading…</div>}
          {cards !== null && cards.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
              No Deal Cards yet. Click <span class="text-[var(--color-accent)]">New Deal Card</span> to create your first one. It saves to the local LandOS store and will show up here.
            </div>
          )}
          {cards !== null && cards.length > 0 && (
            <div class="space-y-1.5">
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void load(c.id)}
                  class={`w-full text-left rounded-md border px-3 py-2 hover:bg-[var(--color-elevated)] ${
                    deal?.id === c.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
                  }`}
                >
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-medium truncate">{c.title || `Deal #${c.id}`}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {entityBadge(c.entity)}
                    </span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {c.status}
                    </span>
                    <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">#{c.id} · {formatRelativeTime(c.updated_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {mode === 'view' && error && <PageState error={error} />}
      {mode === 'view' && loading && !deal && <PageState loading />}

      {mode === 'view' && deal && (
        <>
          {/* 1. Sticky / header area */}
          <div class="sticky top-0 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[14px] font-semibold">
                {prop?.active_input_address || deal.title || 'Untitled Deal'}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {entityBadge(deal.entity)}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                Stage: {deal.status}
              </span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-[var(--color-text-muted)]">
              <span>County/State: {[prop?.county, prop?.state].filter(Boolean).join(', ') || '—'}</span>
              <span>APN: {prop?.apn || '—'}</span>
              <span>Exit strategy: {deal.combined_strategy || '—'}</span>
              <span>Verification: {prop?.verification_status || 'unverified'}</span>
            </div>
          </div>

          {/* 2. Imagery panel — supporting context only, never parcel identity */}
          <Section title="Imagery">
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
              {['Satellite', 'Street', 'Terrain', 'Plat', 'Survey'].map((kind) => (
                <div key={kind} class="rounded border border-dashed border-[var(--color-border)] p-3 text-center">
                  <div class="text-[11px] text-[var(--color-text-muted)]">{kind}</div>
                  <div class="text-[10px] text-[var(--color-text-faint)] mt-1">Visual/source image not captured yet</div>
                </div>
              ))}
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">Imagery is supporting context only; it never verifies parcel identity.</div>
          </Section>

          {/* 3. Deal Economics */}
          <Section title="Deal Economics">
            <Field label="Estimated value (low)" />
            <Field label="Estimated value (mid)" />
            <Field label="Estimated value (high)" />
            <Field label="Current / last offer" />
            <Field label="Max offer" />
            <Field label="Projected net profit" />
            <Field label="Seller asking (negotiation context only)" value={deal.asking_price ?? undefined} />
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              Target-clear baseline: minimum ${MIN_NET_BASELINE_USD.toLocaleString()} net. Economics stay blocked until parcel is verified.
            </div>
          </Section>

          {/* 4. Land Data / DD Facts */}
          <Section title="Land Data / DD Facts">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <Field label="Acreage" value={prop?.acres ?? deal.combined_acreage ?? undefined} />
              <Field label="Zoning" value={prop?.zoning ?? undefined} />
              <Field label="Access" />
              <Field label="Utilities" />
              <Field label="Flood" />
              <Field label="Slope / topography" />
              <Field label="Wetlands / environmental" />
              <Field label="Taxes / liens" />
              <Field label="Soil / perc" />
              <Field label="Subdivision potential" />
            </div>
            <div class="mt-2">
              <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Data gaps</div>
              {prop?.open_risks ? <span class="text-[12px] text-[var(--color-text)]">{prop.open_risks}</span> : <Placeholder text="No data gaps recorded yet" />}
            </div>
          </Section>

          {/* 4b. Due Diligence / Research worksheet — manual/local, labeled */}
          <Section title="Due Diligence / Research">
            {!ddEditing && (
              <>
                <div class="flex items-center justify-between mb-2">
                  <DdIdentityBadge status={dd?.parcelIdentityStatus} />
                  <button
                    type="button"
                    onClick={startDdEdit}
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
                  >
                    {dd?.exists ? 'Edit DD/Research' : 'Add DD/Research'}
                  </button>
                </div>
                {ddWarnings.length > 0 && (
                  <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                    {ddWarnings.map((w) => (
                      <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                    ))}
                  </div>
                )}
                {!dd?.exists && (
                  <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3 mb-2">
                    No DD/Research data captured yet. Click <span class="text-[var(--color-accent)]">Add DD/Research</span> to enter parcel identity, land data, source links, data gaps, and risk flags. Saved to the local LandOS store.
                  </div>
                )}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  <LabeledField label="APN / Parcel ID" value={dd?.apn} confidence={dd?.apnLabel} />
                  <LabeledField label="County / State" value={[dd?.county, dd?.state].filter(Boolean).join(', ')} confidence={dd?.locationLabel} />
                  <LabeledField label="Acreage" value={dd?.acreage ?? undefined} confidence={dd?.acreageLabel} />
                  <LabeledField label="Zoning / land use" value={dd?.zoning} confidence={dd?.zoningLabel} />
                  <LabeledField label="Access" value={dd?.accessStatus} confidence={dd?.accessLabel} />
                  <LabeledField label="Utilities" value={dd?.utilitiesStatus} confidence={dd?.utilitiesLabel} />
                  <LabeledField label="Flood" value={dd?.floodStatus} confidence={dd?.floodLabel} />
                  <LabeledField label="Wetlands" value={dd?.wetlandsStatus} confidence={dd?.wetlandsLabel} />
                </div>
                <div class="mt-3">
                  <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Road / frontage notes</div>
                  {dd?.roadFrontageNotes ? <span class="text-[12px] text-[var(--color-text)]">{dd.roadFrontageNotes}</span> : <Placeholder />}
                </div>
                <DdList title="Source links" items={(dd?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} — ${l.url}` : l.url))} empty="No source links yet" />
                <DdList title="Data gaps" items={dd?.dataGaps ?? []} empty="No data gaps recorded yet" />
                <DdList title="Risk flags" items={dd?.riskFlags ?? []} empty="No risk flags recorded yet" />
                {dd?.notes && (
                  <div class="mt-3">
                    <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Notes</div>
                    <span class="text-[12px] text-[var(--color-text)]">{dd.notes}</span>
                  </div>
                )}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-3">
                  DD/Research is manual/local. Every fact carries a confidence label and is never shown as verified without a named source. Parcel identity comes from exact-source records only, never from imagery or coordinates.
                  {dd?.exists && dd.updatedAt ? <> Last updated {formatRelativeTime(dd.updatedAt)}{dd.updatedBy ? ` by ${dd.updatedBy}` : ''}.</> : null}
                </div>
              </>
            )}
            {ddEditing && ddForm && (
              <DdEditForm
                form={ddForm}
                setField={setDdField}
                onSave={() => void saveDd()}
                onCancel={() => { setDdEditing(false); setDdError(null); }}
                saving={ddSaving}
                error={ddError}
              />
            )}
          </Section>

          {/* 5. Owner / Seller */}
          <Section title="Owner / Seller">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <Field label="Owner name" value={owner?.name ?? undefined} />
              <Field label="Seller / lead name" value={seller?.name ?? undefined} />
              <Field label="Owner type" value={owner?.authority_status ?? undefined} />
              <Field label="Mailing address" value={owner?.mailing_address ?? seller?.mailing_address ?? undefined} />
              <Field label="Phone" value={owner?.phone ?? seller?.phone ?? undefined} />
              <Field label="Email" value={owner?.email ?? seller?.email ?? undefined} />
              <Field label="Motivation" />
              <Field label="Lead source" />
              <Field label="Ownership duration" />
            </div>
          </Section>

          {/* 6. Communication Summary — no external CRM mutation; GHL not connected */}
          <Section title="Communication Summary">
            <Field label="Last contact" />
            <Field label="Sentiment" />
            <Field label="Next follow-up" />
            <Field label="Timeline summary" />
            <div class="mt-2">
              <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Key quotes</div>
              <Placeholder text="No quotes captured yet" />
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              CRM / GHL link: not connected. No external CRM read or write in this view.
            </div>
          </Section>

          {/* 7. Exit Strategy Analysis */}
          <Section title="Exit Strategy Analysis">
            <Field label="Recommended strategy" value={deal.combined_strategy || undefined} />
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {['Quick flip', 'Subdivide', 'Land-home package', 'Improved / value-add', 'Pass / no-offer'].map((s) => (
                <div key={s} class="rounded border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)]">{s}</div>
              ))}
            </div>
            <div class="mt-2"><div class="text-[11px] text-[var(--color-text-muted)] mb-1">Blockers</div><Placeholder text="None recorded yet" /></div>
            <div class="mt-2"><div class="text-[11px] text-[var(--color-text-muted)] mb-1">Next confirmations</div><Placeholder /></div>
          </Section>

          {/* 7b. Strategy worksheet — manual/local, honest offer-readiness, distinct exits */}
          <Section title="Strategy">
            {!strategyEditing && (
              <>
                <div class="flex items-center justify-between mb-2">
                  <StrategyReadinessBadge status={strategy?.offerReadiness} />
                  <button
                    type="button"
                    onClick={startStrategyEdit}
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
                  >
                    {strategy?.exists ? 'Edit Strategy' : 'Add Strategy'}
                  </button>
                </div>
                {strategyWarnings.length > 0 && (
                  <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                    {strategyWarnings.map((w) => (
                      <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                    ))}
                  </div>
                )}
                {!strategy?.exists && (
                  <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3 mb-2">
                    Strategy not reviewed yet. Click <span class="text-[var(--color-accent)]">Add Strategy</span> to capture candidates, a recommendation, the most viable exit, blockers, next confirmations, and per-strategy notes. Saved to the local LandOS store.
                  </div>
                )}
                <StrategyNote label="Current recommendation" value={strategy?.currentRecommendation} />
                <StrategyNote label="Most viable strategy" value={strategy?.mostViableStrategy} />
                <DdList title="Strategy candidates" items={strategy?.strategyCandidates ?? []} empty="No strategy candidates yet" />
                <DdList title="Blockers" items={strategy?.blockers ?? []} empty="No blockers recorded yet" />
                <DdList title="Next confirmations" items={strategy?.nextConfirmations ?? []} empty="No confirmations recorded yet" />
                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Distinct exit notes</div>
                <StrategyNote label="Quick flip" value={strategy?.quickFlipNotes} />
                <StrategyNote label="Subdivide" value={strategy?.subdivideNotes} />
                <StrategyNote label="Land-home package" value={strategy?.landHomePackageNotes} />
                <StrategyNote label="Improved-property / mobile-home value-add" value={strategy?.improvedValueAddNotes} />
                <StrategyNote label="Teardown / land-only fallback" value={strategy?.teardownLandOnlyNotes} />
                <StrategyNote label="Pass / no-offer reason" value={strategy?.passNoOfferReason} />
                <StrategyNote label="Pre-call strategy notes" value={strategy?.preCallStrategyNotes} />
                <StrategyNote label="Risk-adjusted notes" value={strategy?.riskAdjustedNotes} />
                <StrategyNote label="Target profit note" value={strategy?.targetProfitNote} />
                {strategy?.notes && <StrategyNote label="Notes" value={strategy.notes} />}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-3">
                  Strategy is manual/local analysis, never a verified fact and never a final offer. Exits stay distinct and no offer, comp, or EV is calculated here. Offer readiness defaults to Not reviewed until Tyler or a future strategy workflow advances it.
                  {strategy?.exists && strategy.updatedAt ? <> Last updated {formatRelativeTime(strategy.updatedAt)}{strategy.updatedBy ? ` by ${strategy.updatedBy}` : ''}.</> : null}
                </div>
              </>
            )}
            {strategyEditing && strategyForm && (
              <StrategyEditForm
                form={strategyForm}
                setField={setStrategyFieldFn}
                onSave={() => void saveStrategy()}
                onCancel={() => { setStrategyEditing(false); setStrategyError(null); }}
                saving={strategySaving}
                error={strategyError}
              />
            )}
          </Section>

          {/* 7c. Market Research worksheet — manual/local, market-level only, honest demand */}
          <Section title="Market Research">
            {!marketEditing && (
              <>
                <div class="flex items-center justify-between mb-2 gap-2">
                  <MarketDemandBadge label={market?.marketReviewStatus} prefix="Market review" />
                  <button
                    type="button"
                    onClick={startMarketEdit}
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
                  >
                    {market?.exists ? 'Edit Market Research' : 'Add Market Research'}
                  </button>
                </div>
                {marketWarnings.length > 0 && (
                  <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                    {marketWarnings.map((w) => (
                      <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                    ))}
                  </div>
                )}
                {!market?.exists && (
                  <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3 mb-2">
                    Market not reviewed yet. Click <span class="text-[var(--color-accent)]">Add Market Research</span> to capture target area, demand notes, active/sold/days-on-market context, county growth notes, source links, data gaps, and risk flags. Market-level context only, saved to the local LandOS store.
                  </div>
                )}
                <MarketNote label="Target market / area" value={market?.targetAreaLabel} />
                <MarketNote label="County / city / region notes" value={market?.countyCityRegionNotes} />

                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Demand (manual; never a comp or price)</div>
                <MarketDemandLane label="Local buyer demand" note={market?.buyerDemandNotes} demand={market?.buyerDemandLabel} />
                <MarketDemandLane label="Manufactured-home demand" note={market?.manufacturedHomeDemandNotes} demand={market?.manufacturedHomeDemandLabel} />
                <MarketDemandLane label="Subdivision demand" note={market?.subdivisionDemandNotes} demand={market?.subdivisionDemandLabel} />
                <MarketDemandLane label="Infill-lot demand" note={market?.infillLotDemandNotes} demand={market?.infillLotDemandLabel} />
                <MarketDemandLane label="Rural acreage demand" note={market?.ruralAcreageDemandNotes} demand={market?.ruralAcreageDemandLabel} />

                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Listing / sold context (notes only; no comps computed)</div>
                <MarketNote label="Active listing notes" value={market?.activeListingNotes} />
                <MarketNote label="Sold comp context notes" value={market?.soldCompContextNotes} />
                <MarketNote label="Days-on-market notes" value={market?.daysOnMarketNotes} />

                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Growth / planning &amp; exit support</div>
                <MarketNote label="County growth / planning notes" value={market?.countyGrowthPlanningNotes} />
                <MarketNote label="Exit strategy support notes" value={market?.exitStrategySupportNotes} />

                <div class="mt-3 flex items-center gap-2">
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                    Source confidence: {sourceConfidenceText(market?.sourceConfidence)}
                  </span>
                </div>
                <DdList title="Source links" items={(market?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} — ${l.url}` : l.url))} empty="No source links yet" />
                <DdList title="Data gaps" items={market?.dataGaps ?? []} empty="No data gaps recorded yet" />
                <DdList title="Risk flags" items={market?.riskFlags ?? []} empty="No risk flags recorded yet" />
                {market?.notes && <MarketNote label="Notes" value={market.notes} />}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-3">
                  Market Research is manual/local, market-level context only. It is separate from property-level DD and never verifies parcel identity. No comps, actives, solds, days-on-market, demand, or pricing are computed or fabricated; every demand level is a manual conclusion or stays Not reviewed / Needs research.
                  {market?.exists && market.updatedAt ? <> Last updated {formatRelativeTime(market.updatedAt)}{market.updatedBy ? ` by ${market.updatedBy}` : ''}.</> : null}
                </div>
              </>
            )}
            {marketEditing && marketForm && (
              <MarketEditForm
                form={marketForm}
                setField={setMarketFieldFn}
                onSave={() => void saveMarket()}
                onCancel={() => { setMarketEditing(false); setMarketError(null); }}
                saving={marketSaving}
                error={marketError}
              />
            )}
          </Section>

          {/* 8. Documents / Activity / Quick Actions */}
          <Section title="Documents / Activity / Quick Actions">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Documents</div>
            <Placeholder text="No documents attached yet" />
            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-1">Activity log</div>
            <Placeholder text="No activity recorded yet" />
            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-2">Quick actions (approval-gated)</div>
            <div class="flex flex-wrap gap-2">
              {['Make Offer', 'Schedule Follow-Up', 'Run Full Report', 'Change Stage', 'Push to CRM', 'Generate PDF'].map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled
                  title="Approval-gated / not enabled in this view"
                  class="px-2.5 py-1 rounded-md text-[11px] border border-[var(--color-border)] text-[var(--color-text-faint)] opacity-60 cursor-not-allowed"
                >
                  {a}
                </button>
              ))}
            </div>
          </Section>

          {/* 9. Pre-Call Brief */}
          <Section title="Pre-Call Brief">
            <Field label="What the seller wants" />
            <Field label="Current max / walk-away" />
            <Field label="Motivation" />
            <Field label="Last thing the seller said" />
            <Field label="Critical data gaps" />
            <Field label="Best current strategy" value={deal.combined_strategy || undefined} />
            <Field label="Questions to ask next" />
            <Field label="What not to mention yet" />
          </Section>
        </>
      )}
    </div>
  );
}

// ── Create/edit form for the deal-level fields ──────────────────────────────
// Generic deal-level inputs only. Entity is fixed once a card exists. Parcel
// identity, verification, comps, and any CRM/GHL push are NOT editable here.
function DealForm({
  mode, form, setField, onSave, onCancel, saving, saveError,
}: {
  mode: 'create' | 'edit';
  form: DealForm;
  setField: <K extends keyof DealForm>(key: K, value: DealForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';
  return (
    <section class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
          {mode === 'create' ? 'New Deal Card' : 'Edit Deal Card'}
        </h3>
        <span class="text-[10px] text-[var(--color-text-faint)]">Deal-level fields only · saved to local LandOS store</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Entity</span>
          <select
            value={form.entity}
            disabled={mode === 'edit'}
            onChange={(e) => setField('entity', (e.target as HTMLSelectElement).value as DealForm['entity'])}
            class={`${inputCls} ${mode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="TY_LAND_BIZ">My Business</option>
            <option value="LAND_ALLY">Land Ally</option>
          </select>
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Stage</span>
          <select
            value={form.status}
            onChange={(e) => setField('status', (e.target as HTMLSelectElement).value)}
            class={inputCls}
          >
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Title / label</span>
          <input
            type="text"
            value={form.title}
            placeholder="e.g. Sample seller lead (generic)"
            onInput={(e) => setField('title', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller asking (negotiation context only)</span>
          <input
            type="number"
            value={form.askingPrice}
            placeholder="optional"
            onInput={(e) => setField('askingPrice', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Combined / exit strategy</span>
          <input
            type="text"
            value={form.combinedStrategy}
            placeholder="optional"
            onInput={(e) => setField('combinedStrategy', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller notes</span>
          <textarea
            value={form.sellerNotes}
            rows={2}
            onInput={(e) => setField('sellerNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Package notes</span>
          <textarea
            value={form.packageNotes}
            rows={2}
            onInput={(e) => setField('packageNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      {saveError && <div class="text-[11px] text-[var(--color-status-failed)]">{saveError}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
        <span class="text-[10px] text-[var(--color-text-faint)]">CRM / GHL push is not connected and stays approval-gated.</span>
      </div>
    </section>
  );
}

// ── DD/Research worksheet edit form ─────────────────────────────────────────
// Manual/local entry only. Every parcel fact picks a confidence label; the
// backend downgrades any 'Verified' field that has no source link. Parcel
// identity comes from exact-source records only, never imagery. No CRM/GHL.
function DdEditForm({
  form, setField, onSave, onCancel, saving, error,
}: {
  form: DdForm;
  setField: <K extends keyof DdForm>(key: K, value: DdForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';
  const labelCls =
    'bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-1.5 py-1.5 text-[11px] outline-none focus:border-[var(--color-accent)]';

  // A value input paired with its confidence-label picker.
  function FieldWithLabel({
    label, valueKey, labelKey, type = 'text', placeholder,
  }: {
    label: string;
    valueKey: keyof DdForm;
    labelKey: keyof DdForm;
    type?: string;
    placeholder?: string;
  }) {
    return (
      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <div class="flex gap-1.5">
          <input
            type={type}
            value={form[valueKey] as string}
            placeholder={placeholder}
            onInput={(e) => setField(valueKey, (e.target as HTMLInputElement).value as DdForm[typeof valueKey])}
            class={inputCls}
          />
          <select
            value={form[labelKey] as string}
            onChange={(e) => setField(labelKey, (e.target as HTMLSelectElement).value as DdForm[typeof labelKey])}
            class={labelCls}
            title="Confidence label"
          >
            {DD_FIELD_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </label>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-muted)]">Manual DD/Research entry · saved to local LandOS store</span>
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Parcel identity status</span>
        <select
          value={form.parcelIdentityStatus}
          onChange={(e) => setField('parcelIdentityStatus', (e.target as HTMLSelectElement).value)}
          class={inputCls}
        >
          {DD_IDENTITY_STATUSES.map((s) => <option key={s} value={s}>{identityStatusText(s)}</option>)}
        </select>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldWithLabel label="APN / Parcel ID" valueKey="apn" labelKey="apnLabel" placeholder="e.g. 000-000-000" />
        <FieldWithLabel label="County / State" valueKey="county" labelKey="locationLabel" placeholder="county" />
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">State</span>
          <input
            type="text"
            value={form.state}
            placeholder="ST"
            onInput={(e) => setField('state', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>
        <FieldWithLabel label="Acreage" valueKey="acreage" labelKey="acreageLabel" type="number" placeholder="optional" />
        <FieldWithLabel label="Zoning / land use" valueKey="zoning" labelKey="zoningLabel" placeholder="optional" />
        <FieldWithLabel label="Access" valueKey="accessStatus" labelKey="accessLabel" placeholder="e.g. road frontage / easement / unknown" />
        <FieldWithLabel label="Utilities" valueKey="utilitiesStatus" labelKey="utilitiesLabel" placeholder="e.g. power at road / none / unknown" />
        <FieldWithLabel label="Flood" valueKey="floodStatus" labelKey="floodLabel" placeholder="e.g. Zone X / partial / unknown" />
        <FieldWithLabel label="Wetlands" valueKey="wetlandsStatus" labelKey="wetlandsLabel" placeholder="e.g. none mapped / present / unknown" />
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Road / frontage notes</span>
        <textarea
          value={form.roadFrontageNotes}
          rows={2}
          onInput={(e) => setField('roadFrontageNotes', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
      </label>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Source links (one per line · optional "label | url")</span>
        <textarea
          value={form.sourceLinksText}
          rows={2}
          placeholder={'County GIS | https://...\nAssessor | https://...'}
          onInput={(e) => setField('sourceLinksText', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
        <span class="text-[10px] text-[var(--color-text-faint)]">A field can only stay "Verified" when at least one source link is present.</span>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Data gaps (one per line)</span>
          <textarea
            value={form.dataGapsText}
            rows={3}
            onInput={(e) => setField('dataGapsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Risk flags (one per line)</span>
          <textarea
            value={form.riskFlagsText}
            rows={3}
            onInput={(e) => setField('riskFlagsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Notes</span>
        <textarea
          value={form.notes}
          rows={2}
          onInput={(e) => setField('notes', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
      </label>

      {error && <div class="text-[11px] text-[var(--color-status-failed)]">{error}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save DD/Research'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Strategy worksheet edit form ────────────────────────────────────────────
// Manual/local strategy analysis only. Distinct exit strategies keep distinct
// note fields and are never collapsed into one generic offer range. Offer
// readiness is an honest status label, never an offer. No offer/comp/EV math and
// no CRM/GHL.
function StrategyEditForm({
  form, setField, onSave, onCancel, saving, error,
}: {
  form: StrategyForm;
  setField: <K extends keyof StrategyForm>(key: K, value: StrategyForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';

  // A labeled multi-line note field bound to one form key.
  function NoteField({ label, valueKey, placeholder, rows = 2 }: { label: string; valueKey: keyof StrategyForm; placeholder?: string; rows?: number }) {
    return (
      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <textarea
          value={form[valueKey] as string}
          rows={rows}
          placeholder={placeholder}
          onInput={(e) => setField(valueKey, (e.target as HTMLTextAreaElement).value as StrategyForm[typeof valueKey])}
          class={inputCls}
        />
      </label>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-muted)]">Manual strategy entry · saved to local LandOS store</span>
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Offer readiness</span>
        <select
          value={form.offerReadiness}
          onChange={(e) => setField('offerReadiness', (e.target as HTMLSelectElement).value)}
          class={inputCls}
        >
          {STRATEGY_READINESS.map((s) => <option key={s} value={s}>{readinessText(s)}</option>)}
        </select>
        <span class="text-[10px] text-[var(--color-text-faint)]">Strategy is never auto-ready. This is an honest status, not an offer.</span>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="Current recommendation" valueKey="currentRecommendation" placeholder="best current read; not a final offer" />
        <NoteField label="Most viable strategy" valueKey="mostViableStrategy" placeholder="single most viable exit" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NoteField label="Strategy candidates (one per line)" valueKey="strategyCandidatesText" rows={3} placeholder={'Quick flip\nSubdivide'} />
        <NoteField label="Blockers (one per line)" valueKey="blockersText" rows={3} />
        <NoteField label="Next confirmations (one per line)" valueKey="nextConfirmationsText" rows={3} />
      </div>

      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Distinct exit notes</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="Quick flip notes" valueKey="quickFlipNotes" />
        <NoteField label="Subdivide notes" valueKey="subdivideNotes" />
        <NoteField label="Land-home package notes" valueKey="landHomePackageNotes" />
        <NoteField label="Improved-property / mobile-home value-add notes" valueKey="improvedValueAddNotes" />
        <NoteField label="Teardown / land-only fallback notes" valueKey="teardownLandOnlyNotes" />
        <NoteField label="Pass / no-offer reason" valueKey="passNoOfferReason" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="Pre-call strategy notes" valueKey="preCallStrategyNotes" />
        <NoteField label="Risk-adjusted notes" valueKey="riskAdjustedNotes" />
      </div>

      <NoteField label="Target profit note (free-text note, not a calculated offer)" valueKey="targetProfitNote" />
      <NoteField label="Notes" valueKey="notes" />

      {error && <div class="text-[11px] text-[var(--color-status-failed)]">{error}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Strategy'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Market Research worksheet edit form ─────────────────────────────────────
// Manual/local, market-level entry only. This is separate from property-level DD
// and never verifies parcel identity. No comps, actives, solds, days-on-market,
// demand, or pricing are computed or fabricated: demand is a manual label that
// the backend downgrades to needs_research without a supporting note. No CRM/GHL.
function MarketEditForm({
  form, setField, onSave, onCancel, saving, error,
}: {
  form: MarketForm;
  setField: <K extends keyof MarketForm>(key: K, value: MarketForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';

  // A labeled multi-line note field bound to one form key.
  function NoteField({ label, valueKey, placeholder, rows = 2 }: { label: string; valueKey: keyof MarketForm; placeholder?: string; rows?: number }) {
    return (
      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <textarea
          value={form[valueKey] as string}
          rows={rows}
          placeholder={placeholder}
          onInput={(e) => setField(valueKey, (e.target as HTMLTextAreaElement).value as MarketForm[typeof valueKey])}
          class={inputCls}
        />
      </label>
    );
  }

  // A demand note paired with its honest demand-label picker. The backend
  // downgrades a concrete rating to Needs research when its note is empty.
  function DemandField({ label, noteKey, labelKey, placeholder }: { label: string; noteKey: keyof MarketForm; labelKey: keyof MarketForm; placeholder?: string }) {
    return (
      <label class="block">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
          <select
            value={form[labelKey] as string}
            onChange={(e) => setField(labelKey, (e.target as HTMLSelectElement).value as MarketForm[typeof labelKey])}
            class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-1.5 py-1 text-[11px] outline-none focus:border-[var(--color-accent)]"
            title="Demand label"
          >
            {MARKET_DEMAND_LABELS.map((l) => <option key={l} value={l}>{demandText(l)}</option>)}
          </select>
        </div>
        <textarea
          value={form[noteKey] as string}
          rows={2}
          placeholder={placeholder}
          onInput={(e) => setField(noteKey, (e.target as HTMLTextAreaElement).value as MarketForm[typeof noteKey])}
          class={inputCls}
        />
      </label>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-muted)]">Manual market-level entry · saved to local LandOS store</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Market review status</span>
          <select
            value={form.marketReviewStatus}
            onChange={(e) => setField('marketReviewStatus', (e.target as HTMLSelectElement).value)}
            class={inputCls}
          >
            {MARKET_DEMAND_LABELS.map((l) => <option key={l} value={l}>{demandText(l)}</option>)}
          </select>
          <span class="text-[10px] text-[var(--color-text-faint)]">Market context only. Never a comp, price, or value.</span>
        </label>
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Target market / area label</span>
          <input
            type="text"
            value={form.targetAreaLabel}
            placeholder="e.g. county / submarket label"
            onInput={(e) => setField('targetAreaLabel', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      <NoteField label="County / city / region notes" valueKey="countyCityRegionNotes" />

      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Demand (manual conclusions only)</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DemandField label="Local buyer demand" noteKey="buyerDemandNotes" labelKey="buyerDemandLabel" placeholder="what you actually know; blank stays Needs research" />
        <DemandField label="Manufactured-home demand" noteKey="manufacturedHomeDemandNotes" labelKey="manufacturedHomeDemandLabel" />
        <DemandField label="Subdivision demand" noteKey="subdivisionDemandNotes" labelKey="subdivisionDemandLabel" />
        <DemandField label="Infill-lot demand" noteKey="infillLotDemandNotes" labelKey="infillLotDemandLabel" />
        <DemandField label="Rural acreage demand" noteKey="ruralAcreageDemandNotes" labelKey="ruralAcreageDemandLabel" />
      </div>
      <span class="text-[10px] text-[var(--color-text-faint)]">A demand rating without a note for that lane is downgraded to Needs research. Conclusions are never fabricated.</span>

      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Listing / sold context (notes only)</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NoteField label="Active listing notes" valueKey="activeListingNotes" rows={3} />
        <NoteField label="Sold comp context notes" valueKey="soldCompContextNotes" rows={3} />
        <NoteField label="Days-on-market notes" valueKey="daysOnMarketNotes" rows={3} />
      </div>
      <span class="text-[10px] text-[var(--color-text-faint)]">These are manual notes only. No comps, actives, solds, or days-on-market are computed.</span>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="County growth / planning notes" valueKey="countyGrowthPlanningNotes" />
        <NoteField label="Exit strategy support notes" valueKey="exitStrategySupportNotes" />
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Source confidence</span>
        <select
          value={form.sourceConfidence}
          onChange={(e) => setField('sourceConfidence', (e.target as HTMLSelectElement).value)}
          class={inputCls}
        >
          {MARKET_SOURCE_CONFIDENCE.map((l) => <option key={l} value={l}>{sourceConfidenceText(l)}</option>)}
        </select>
        <span class="text-[10px] text-[var(--color-text-faint)]">High confidence requires at least one source link, or it is downgraded to Needs research.</span>
      </label>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Source links (one per line · optional "label | url")</span>
        <textarea
          value={form.sourceLinksText}
          rows={2}
          placeholder={'County planning | https://...\nMarket report | https://...'}
          onInput={(e) => setField('sourceLinksText', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Data gaps (one per line)</span>
          <textarea
            value={form.dataGapsText}
            rows={3}
            onInput={(e) => setField('dataGapsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Risk flags (one per line)</span>
          <textarea
            value={form.riskFlagsText}
            rows={3}
            onInput={(e) => setField('riskFlagsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      <NoteField label="Notes" valueKey="notes" />

      {error && <div class="text-[11px] text-[var(--color-status-failed)]">{error}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Market Research'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
