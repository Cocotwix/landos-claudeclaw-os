// Canonical Deal Card records — the shared assembly + reconcile action.
//
// One place builds the shared records every operator tab consumes:
//   • unique comparable registry (validated / rejected / merged, all providers)
//   • document asset registry (county-sourced deed pages + research tasks)
//   • strategy-readiness record (five approved strategies + the pricing gate)
//   • model version (whether the card has been reconciled to the current model)
//
// It also implements the operator "Reconcile Deal Card" action: an idempotent,
// in-place revalidation of the persisted evidence (no duplicate cards, CRM and
// seller data untouched, no external calls, no paid providers).

import fs from 'node:fs';
import path from 'node:path';
import { getLandosDb } from './db.js';
import { landosArtifactPath } from './storage-profile.js';
import { listComps, type CompRow } from './comps.js';
import { buildCompRegistry, addressStateCode, type CompRegistry, type CompRegistryCandidate, type SubjectMarket } from './comp-registry.js';
import { buildDocumentRegistry, type DocumentRegistry, type DocumentEvidenceRow, type UploadedDocumentRow } from './document-registry.js';
import { listDocumentUploads } from './document-uploads.js';
import { buildStrategyReadiness, type StrategyReadinessRecord } from './strategy-readiness.js';
import { buildUnifiedReadiness, type UnifiedReadinessRecord } from './unified-readiness.js';
import { computeResearchCompleteness } from './research-completeness.js';
import { providerDisplayName } from './comp-providers.js';
import { buildResearchMissionView, type ResearchMissionView } from './research-mission.js';
import { attachCardActivity, getCardActivity, getPropertyCard } from './property-card.js';
import type { OperatorPropertyRecord } from './operator-property-record.js';

/** Bump when the canonical Deal Card model changes shape/semantics. */
export const DEAL_CARD_MODEL_VERSION = 2;

export interface DealCardModelVersion {
  current: number;
  card: number;
  needsReconcile: boolean;
  reasons: string[];
}

// ── Comp candidate assembly ───────────────────────────────────────────────────

interface MarketCompLite {
  price?: number | null;
  saleDateIso?: string | null;
  acres?: number | null;
  pricePerAcre?: number | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  addressDesc?: string | null;
  lat?: number | null;
  lng?: number | null;
  compClass?: string | null;
}

export interface ReportCompLanes {
  sold?: MarketCompLite[] | null;
  supplementalSold?: MarketCompLite[] | null;
  active?: MarketCompLite[] | null;
  valuation?: MarketCompLite[] | null;
  landportalComps?: { rows?: MarketCompLite[] | null } | null;
}

function laneCandidates(rows: MarketCompLite[] | null | undefined, lane: CompRegistryCandidate['lane'], fallbackProvider: string): CompRegistryCandidate[] {
  return (rows ?? []).map((r) => ({
    provider: (r.sourceLabel && r.sourceLabel.trim()) || fallbackProvider,
    lane,
    addressDesc: r.addressDesc ?? null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    price: typeof r.price === 'number' ? r.price : null,
    priceKind: lane === 'sold' || lane === 'supplemental' ? 'sold' : lane === 'active' ? 'list' : null,
    saleOrListDate: r.saleDateIso ?? null,
    acres: r.acres ?? null,
    pricePerAcre: r.pricePerAcre ?? null,
    sourceUrl: r.sourceUrl ?? null,
    compClass: r.compClass ?? null,
  }));
}

function persistedCandidates(rows: CompRow[]): CompRegistryCandidate[] {
  return rows.map((r) => ({
    id: r.id,
    provider: r.source_label || 'Unknown',
    lane: (r.price_kind === 'sold' ? 'sold' : 'active') as CompRegistryCandidate['lane'],
    addressDesc: r.address_desc || null,
    apn: r.apn || null,
    state: r.state || null,
    price: typeof r.price === 'number' ? r.price : null,
    priceKind: r.price_kind || null,
    saleOrListDate: r.sale_or_list_date || null,
    acres: typeof r.acres === 'number' ? r.acres : null,
    pricePerAcre: typeof r.price_per_acre === 'number' ? r.price_per_acre : null,
    sourceUrl: r.source_url || null,
    persistedStatus: r.status || null,
  }));
}

/** Build the unique comp registry for a deal from every persisted + report lane. */
export function compRegistryForDeal(dealCardId: number, subject: SubjectMarket, reportLanes: ReportCompLanes | null): CompRegistry {
  const candidates: CompRegistryCandidate[] = [
    ...persistedCandidates(listComps({ dealCardId })),
    ...laneCandidates(reportLanes?.sold, 'sold', 'Realie'),
    ...laneCandidates(reportLanes?.supplementalSold, 'supplemental', 'Zillow'),
    ...laneCandidates(reportLanes?.active, 'active', 'Realie'),
    ...laneCandidates(reportLanes?.valuation, 'valuation', 'Realie'),
    ...laneCandidates(reportLanes?.landportalComps?.rows, 'landportal', 'LandPortal visible'),
  ];
  return buildCompRegistry(subject, candidates);
}

// ── Document registry assembly ────────────────────────────────────────────────

function visualsDir(): string {
  return landosArtifactPath('visuals');
}

export function documentRegistryForCard(cardId: number | null, opts: { acreageConflict?: boolean; dealCardId?: number | null } = {}): DocumentRegistry {
  if (cardId == null) return { documents: [], researchTasks: [], summaryLine: 'No property card resolved yet — document research runs after parcel identity.' };
  const card = getPropertyCard(cardId);
  const evidenceRows: DocumentEvidenceRow[] = ((card?.sourceEvidence ?? []) as Array<Record<string, unknown>>).map((row) => ({
    fact: String(row.fact ?? ''),
    sourceUrl: String(row.source_url ?? ''),
    sourceType: String(row.source_type ?? ''),
    dateAccessed: String(row.date_accessed ?? ''),
    note: String(row.note ?? ''),
  }));
  let files: string[] = [];
  try { files = fs.readdirSync(visualsDir()); } catch { files = []; }
  let uploads: UploadedDocumentRow[] = [];
  if (opts.dealCardId != null) {
    try { uploads = listDocumentUploads(opts.dealCardId); } catch { uploads = []; }
  }
  return buildDocumentRegistry({ cardId, evidenceRows, visualFileNames: files, acreageConflict: opts.acreageConflict, uploads });
}

// ── Strategy readiness assembly ───────────────────────────────────────────────

export function strategyReadinessForDeal(input: {
  parcelVerified: boolean;
  registry: CompRegistry;
  operatorRecord: OperatorPropertyRecord | null;
  valuationConflict: boolean;
  improved: boolean;
  hardRisks?: string[] | null;
}): StrategyReadinessRecord {
  const rec = input.operatorRecord;
  const wetlandsCard = rec?.decisionCards.find((c) => c.key === 'wetlands');
  const wetlandsPct = wetlandsCard?.headline.match(/(\d+(?:\.\d+)?)%/) ? Number(wetlandsCard.headline.match(/(\d+(?:\.\d+)?)%/)![1]) : null;
  const floodCard = rec?.decisionCards.find((c) => c.key === 'flood');
  const sfhaPct = floodCard?.headline.match(/(\d+(?:\.\d+)?)%\s*in SFHA/) ? Number(floodCard.headline.match(/(\d+(?:\.\d+)?)%/)![1]) : null;
  return buildStrategyReadiness({
    parcelVerified: input.parcelVerified,
    validatedSoldComps: input.registry.counts.validatedSold,
    valuationReady: input.registry.valuationReady,
    valuationConflict: input.valuationConflict,
    // The operator record's gate (when present) is authoritative so the two
    // surfaces can never disagree about whether pricing is open.
    prebuiltGate: rec?.pricingGate ?? null,
    acres: rec?.identity.mappedAcres ?? rec?.identity.assessedAcres ?? null,
    acreageConflict: rec?.identity.acreageConflict ?? false,
    wetlandsPct,
    floodSfhaPct: sfhaPct,
    septicOutlook: rec?.septicOutlook.outlook ?? 'unknown',
    accessStatus: rec?.accessStatus.status ?? 'unknown',
    legalAccessConfirmed: false, // recorded-instrument confirmation is never inferred
    zoningKnown: !!rec?.decisionCards.find((c) => c.key === 'zoning' && c.verdict !== 'unknown'),
    utilitiesKnown: !!rec?.decisionCards.find((c) => c.key === 'utilities' && c.verdict !== 'unknown'),
    improved: input.improved,
    hardRisks: input.hardRisks ?? rec?.risks ?? [],
    trustAuthorityUnresolved: (rec?.identity.ownerWarnings?.length ?? 0) > 0,
    legalAcreageUnresolved: rec?.identity.acreageConflict ?? false,
    thinMarketClusterSupported: input.registry.clusterAnalysis?.thinMarketSupported ?? false,
  });
}

// ── Unified readiness assembly ────────────────────────────────────────────────
// ONE readiness record composed from the records already built above. Every tab,
// report, executive summary, and RAG doc reads THIS — no consumer derives its
// own readiness from the registry count gate or a legacy per-report label.

export function unifiedReadinessForDeal(input: {
  parcelVerified: boolean;
  registry: CompRegistry;
  strategyReadiness: StrategyReadinessRecord;
  operatorRecord: OperatorPropertyRecord | null;
  valuationConflict: boolean;
  deedRetrieved: boolean;
}): UnifiedReadinessRecord {
  const rec = input.operatorRecord;
  const research = rec?.researchCompleteness ?? computeResearchCompleteness([]);
  const pricingGate = rec?.pricingGate ?? {
    pricingAllowed: input.strategyReadiness.pricingAllowed,
    pricingBlockers: input.strategyReadiness.pricingBlockers,
  };
  // Material physical constraints from the reconciled decision cards (risk verdicts
  // on physical lanes) — the same reconciled facts, never a re-derivation.
  const physicalConstraints = (rec?.decisionCards ?? [])
    .filter((c) => ['wetlands', 'flood', 'septic'].includes(c.key) && c.verdict === 'risk')
    .map((c) => `${c.label}: ${c.headline}.`);
  return buildUnifiedReadiness({
    parcelVerified: input.parcelVerified,
    pricingGate,
    research,
    strategy: input.strategyReadiness,
    valueReadiness: rec?.valueReadiness ?? { state: 'not_ready', why: 'No reconciled operator record yet — value readiness cannot be assessed.' },
    offerReadiness: rec?.offerReadiness ?? { state: 'researching', why: 'No reconciled operator record yet — research has not produced an offer basis.' },
    registryValuationReady: input.registry.valuationReady,
    validatedSoldComps: input.registry.counts.validatedSold,
    valuationConflict: input.valuationConflict,
    acreageConflict: rec?.identity.acreageConflict ?? false,
    legalAccessConfirmed: false, // recorded-instrument confirmation is never inferred
    titleUnresolved: (rec?.identity.ownerWarnings?.length ?? 0) > 0,
    deedReviewed: input.deedRetrieved,
    zoningKnown: !!rec?.decisionCards.find((c) => c.key === 'zoning' && c.verdict !== 'unknown'),
    physicalConstraints,
  });
}

// ── Model version + reconcile action ─────────────────────────────────────────

const RECONCILE_KIND = 'deal_card_reconcile';
const RECONCILE_VERSION_RE = /model v(\d+)/;

export function modelVersionForCard(cardId: number | null, registry: CompRegistry): DealCardModelVersion {
  const reasons: string[] = [];
  let cardVersion = 1;
  if (cardId != null) {
    const events = getCardActivity(cardId, 200).filter((e) => e.kind === RECONCILE_KIND);
    for (const e of events) {
      const m = e.summary.match(RECONCILE_VERSION_RE);
      if (m) cardVersion = Math.max(cardVersion, Number(m[1]));
    }
  }
  if (cardVersion < DEAL_CARD_MODEL_VERSION) reasons.push(`Card was last reconciled at model v${cardVersion}; current model is v${DEAL_CARD_MODEL_VERSION}.`);
  // Misclassified persisted rows are a concrete reconcile trigger regardless of version.
  const pendingRejections = countPendingWrongMarketRows(registry);
  if (pendingRejections > 0) reasons.push(`${pendingRejections} persisted comp row(s) fail current validation but are not marked rejected.`);
  return { current: DEAL_CARD_MODEL_VERSION, card: cardVersion, needsReconcile: reasons.length > 0, reasons };
}

function countPendingWrongMarketRows(registry: CompRegistry): number {
  // Rejected for wrong-market by the CURRENT validator (not the persisted status).
  return registry.rejected.filter((r) => /^wrong market/i.test(r.reason)).length;
}

export interface ReconcileResult {
  dealCardId: number;
  cardId: number | null;
  modelVersion: number;
  compStatusFixes: number;
  registry: { validatedSold: number; validatedActive: number; rejected: number; duplicatesMerged: number };
  changed: boolean;
  note: string;
}

/**
 * Reconcile an existing Deal Card in place. Idempotent: running twice makes no
 * further changes and creates no duplicates. Never touches CRM/seller fields,
 * never creates cards, never calls providers, never spends money.
 */
export function reconcileDealCard(input: {
  dealCardId: number;
  cardId: number | null;
  subject: SubjectMarket;
  reportLanes: ReportCompLanes | null;
}): ReconcileResult {
  const db = getLandosDb();

  // 1. Revalidate every persisted comp row against the current validator and
  //    mark newly failing rows rejected (audit trail preserved — never deleted).
  const persisted = listComps({ dealCardId: input.dealCardId });
  const subjState = (input.subject.state ?? '').trim().toUpperCase();
  let compStatusFixes = 0;
  if (subjState) {
    const mark = db.prepare("UPDATE landos_comp SET status = 'rejected' WHERE id = ? AND status != 'rejected'");
    for (const row of persisted) {
      if ((row.status ?? '') === 'rejected') continue;
      const rowState = (row.state ?? '').trim().toUpperCase() || addressStateCode(row.address_desc);
      if (rowState && rowState !== subjState) {
        const res = mark.run(row.id);
        if ((res.changes ?? 0) > 0) compStatusFixes += 1;
      }
    }
  }

  // 2. Rebuild the registry from the corrected rows.
  const registry = compRegistryForDeal(input.dealCardId, input.subject, input.reportLanes);

  // 3. Stamp the model version as an activity event — only when something
  //    changed or the version advanced (idempotent re-runs stay silent).
  let changed = compStatusFixes > 0;
  let stamped = false;
  if (input.cardId != null) {
    const events = getCardActivity(input.cardId, 200).filter((e) => e.kind === RECONCILE_KIND);
    const alreadyCurrent = events.some((e) => (e.summary.match(RECONCILE_VERSION_RE)?.[1] ?? '0') === String(DEAL_CARD_MODEL_VERSION));
    if (!alreadyCurrent || compStatusFixes > 0) {
      attachCardActivity({
        cardId: input.cardId,
        agentId: 'landos/reconcile',
        kind: RECONCILE_KIND,
        summary: `Reconciled to Deal Card model v${DEAL_CARD_MODEL_VERSION}: ${compStatusFixes} comp row(s) re-marked rejected; registry now ${registry.counts.validatedSold} validated sold / ${registry.counts.validatedActive} active unique, ${registry.counts.rejected} rejected, ${registry.counts.duplicatesMerged} duplicate rows merged. CRM, seller data, and accepted evidence preserved.`,
      });
      stamped = true;
      changed = true;
    }
  }

  return {
    dealCardId: input.dealCardId,
    cardId: input.cardId,
    modelVersion: DEAL_CARD_MODEL_VERSION,
    compStatusFixes,
    registry: {
      validatedSold: registry.counts.validatedSold,
      validatedActive: registry.counts.validatedActive,
      rejected: registry.counts.rejected,
      duplicatesMerged: registry.counts.duplicatesMerged,
    },
    changed,
    note: changed
      ? `Reconciled in place${compStatusFixes ? ` (${compStatusFixes} comp fix(es))` : ''}${stamped ? `; card stamped model v${DEAL_CARD_MODEL_VERSION}` : ''}. No duplicate card created.`
      : 'Already reconciled at the current model — no changes needed.',
  };
}

/** Research-mission view for a card's activity feed. */
export function missionViewForCard(cardId: number | null): ResearchMissionView {
  const events = cardId != null ? getCardActivity(cardId, 200) : [];
  return buildResearchMissionView(events);
}

// ── Comp state from the registry ─────────────────────────────────────────────
// The compState every tab shows must carry VALIDATED UNIQUE counts, never raw
// provider attempts. Provider attempt/rejection detail lives in the registry's
// providerCoverage (Market tab audit), not in the headline counts.

export interface RegistryCompState {
  soldCount: number;
  activeCount: number;
  landportalVisibleCount: number;
  fallbackCount: number;
  totalUsable: number;
  anyRetrieved: boolean;
  sources: Array<{ source: string; label: string; status: 'retrieved' | 'none' | 'not_run' | 'unavailable'; count: number; note: string }>;
  summaryLine: string;
  strategyLine: string;
}

export function compStateFromRegistry(registry: CompRegistry, marketStatus?: string): RegistryCompState {
  const sold = registry.counts.validatedSold;
  const active = registry.counts.validatedActive;
  const lpCoverage = registry.providerCoverage.find((p) => /landportal/i.test(p.provider));
  const sources = registry.providerCoverage.map((p) => ({
    source: p.provider.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    label: providerDisplayName(p.provider),
    status: (p.validated > 0 ? 'retrieved' : p.candidates > 0 ? 'none' : 'not_run') as 'retrieved' | 'none' | 'not_run',
    count: p.validated,
    note: p.validated > 0
      ? `${p.validated} validated of ${p.candidates} candidate row(s)${p.rejected ? ` (${p.rejected} rejected)` : ''}.`
      : p.candidates > 0
        ? `${p.candidates} candidate row(s), none validated${p.rejected ? ` (${p.rejected} rejected)` : ''}.`
        : 'Not run.',
  }));
  const anyRetrieved = sold + active > 0;
  const summaryLine = anyRetrieved
    ? `Validated unique comps: ${sold} sold, ${active} active (from ${registry.counts.rawCandidates} raw candidates; ${registry.counts.rejected} rejected, ${registry.counts.duplicatesMerged} duplicates merged).`
    : marketStatus === 'not_run'
      ? 'Comps not run yet.'
      : `No validated comps yet (${registry.counts.rawCandidates} raw candidates were screened; ${registry.counts.rejected} rejected).`;
  const strategyLine = sold >= 3
    ? `Validated sold comps retrieved (${sold}) — value on the sold band.`
    : sold > 0
      ? `${sold} validated sold comp(s) — below the 3 needed for a defensible band; comp research continues.`
      : anyRetrieved
        ? `${active} validated active listing(s) but no closed sales yet — no pricing basis.`
        : 'No validated comps yet — comp research continues.';
  return {
    soldCount: sold,
    activeCount: active,
    landportalVisibleCount: lpCoverage?.validated ?? 0,
    fallbackCount: 0,
    totalUsable: sold + (lpCoverage?.validated ?? 0),
    anyRetrieved,
    sources,
    summaryLine,
    strategyLine,
  };
}
