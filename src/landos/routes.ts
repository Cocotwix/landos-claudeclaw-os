// LandOS dashboard API routes — OS Spine v1.
//
// Mounted into the existing dashboard Hono app (src/dashboard.ts) behind the
// existing token auth middleware, before the SPA catch-all. Everything here
// is repo-safe metadata and counts: no secrets, no LP tokens, no paid calls.

import type { Hono } from 'hono';

import { logger } from '../logger.js';
import { DEPARTMENTS } from './departments.js';
import {
  GATED_ACTION_TYPES,
  LANDOS_ENTITIES,
  PLAYBOOK_STAGES,
  countRows,
  createApproval,
  decideApproval,
  getLandosDb,
  getOverview,
  getModelPreferences,
  setModelPreference,
  resetModelPreference,
  landosAudit,
  listApprovals,
  listLandosAudit,
  listRows,
  type ModelPreferenceScopeKind,
} from './db.js';
import {
  MODEL_REGISTRY,
  getModel,
  suggestModelForOrientation,
} from './model-providers.js';
import { computeLandScoreFromPropertyData, computeLandScore } from './land-score.js';
import { buildParcelFactSheet } from './landportal-facts.js';
import { captureImagery } from './imagery-capture.js';
import {
  preflightLiveData,
  resolveLiveDataEnv,
  LIVE_DATA_ENV_KEYS,
  type LiveDataPreflight,
} from './live-data-preflight.js';
import { runPropertyAnalysis } from './property-analysis.js';
import { savePropertyAnalysisReport } from './property-analysis-report.js';
import { rosterSummary, getAgentDef } from './agent-roster.js';
import { knowledgeStoreStatus, resolveKnowledgeStore } from './knowledge-store-r2.js';
import { DataProviderRegistry, DEFAULT_DATA_SOURCES, REALIE_ENV_KEY } from './providers/data-registry.js';
import { listAgentKnowledge } from './knowledge-ingestion.js';
import { loadScorecard } from './market-research.js';
import { orgChart } from './executive-orchestrator.js';
import { routeByCapability, type JobRequirements } from './capability-router.js';
import { MODEL_CAPABILITIES, CAPABILITY_DIMENSIONS, getCapabilityEntry } from './model-capabilities.js';
import { sourcedProfileFor } from './capability-scoring.js';
import { buildProviderRegistry } from './provider-registry.js';
import { buildRegistryFromConfig } from './model-router-service.js';
import { resolveLiveRouting, resolveOllamaHost, setLiveRouting, setOllamaHost } from './router-runtime-config.js';
import { GRUNT_HELPERS } from './grunt-helpers.js';
import { computeDealLane, type DealLaneSnapshot } from './deal-lane.js';
import { underwriteConfirmedParcel, blockedUnderwriting, type UnderwritingStrategyLane } from './underwriting-agent.js';
import { DashboardSettingsOverrideStore, resolveOverride, setOverride, resetOverride, type OverrideScope } from './model-override.js';
import { PROVIDER_PRESENCE } from '../config.js';
import { getDashboardSetting, setDashboardSetting } from '../db.js';
import { RUBRIC_FACTORS, RUBRIC_SOURCE, RUBRIC_STATUS, VERDICT_TIERS } from './rubric.js';
import { STRATEGIES, evaluateStrategies } from './offer-engine.js';
import { buildPursuitDecision } from './deal-card-pursuit.js';
import { auditDealCardCoherence } from './deal-card-audit.js';
import { runMarketScan, type ScanFinding, type ScanSearchFn, type MarketScanResult } from './market-scan.js';
import { saveMarketScan, loadMarketScan } from './db.js';
import { buildIntakeConversation, type IntakeMessage } from './intake-conversation.js';
import {
  CARD_VERIFICATION_STATUSES,
  KANBAN_STATUSES,
  LEAD_JOB_STATUSES,
  type CardVerificationStatus,
  type KanbanStatus,
  type LandosEntity,
  type LeadJobStatus,
} from './db.js';
import {
  upsertCardFromDukeRun,
  getPropertyCard,
  listPropertyCards,
  setCardKanbanStatus,
  setCardVerificationStatus,
  attachCardSourceEvidence,
  attachCardActivity,
  addCardNextAction,
  attachNearbySearchReference,
  createLeadJobs,
  listLeadJobs,
  updateLeadJob,
  loadCardVisualCapture,
  loadEligibleCardVisualCapture,
  loadPropertyInspection,
  saveVisualIntelligence,
  loadVisualIntelligence,
  getPropertyCardRow,
  getCardActivity,
} from './property-card.js';
import { captureAndPersistCardVisuals } from './visual-capture-workflow.js';
import { resolveGoogleVisualEnv, VISUAL_SERVICES } from './providers/google-visual.js';
import fs from 'fs';
import path from 'path';
import { routeDukeRequest } from './duke-router.js';
import { LANDPORTAL_VERIFICATION_TIMEOUT_MS } from './duke-report-lanes.js';
import { runDukeVerification, mapResolveToVerification, type DukeVerificationResult } from './duke-verification-bridge.js';
import { resolveParcelIdentityResult } from './parcel-capability.js';
import { fetchZillowLandComps } from './zillow-land-comps.js';
import { fetchRedfinLandComps } from './redfin-land-comps.js';
import { extractPropertyArgs } from './duke-preflight.js';
import { suggestAddresses } from './address-suggest.js';
import { classifySmartIntake, listIntakeIntents, type ParsedIntakeFields } from './intake-router.js';
import { extractZipCandidate, extractApnCandidates } from './intake-normalize.js';
import { buildSmartIntake } from './smart-intake.js';
import { planResolver, type IntakeFields } from './resolver-planner.js';
import { buildDiscoveryCallReport, buildConfirmedParcelDiscoveryReport, buildAreaDiscoveryReport, type DiscoveryIntake } from './discovery-call-report.js';
import { resolveProperty, type ResolutionDeps } from './property-resolution-engine.js';
import { browserLaneStatus } from './browser-retrieval.js';
import { makeLandPortalBrowser } from './landportal-browser.js';
import { listNavigationModels } from './browser-navigation-model.js';
import { listSitePlaybooks } from './browser-learning.js';
import { makeCountyRecordsBrowser } from './county-records-browser.js';
import { routeBrowserQuestion, type BrowserEvidence } from './browser-intelligence.js';
import { makeLiveBrowserDriver, ensureBrowserSession, browserSessionHealth, startBrowserSession, openLandPortalInSession, withWorkingPage, ensureLandPortalAuthenticated, readLandPortalCreds } from './browser-session.js';
import { getCountySources } from './county-source-map.js';
import { CountyCapabilityRegistry } from './county-capability-registry.js';
import { runPublicPropertyIntelligence, type PublicIntelligenceRun } from './public-property-intelligence.js';
import { lookupOfficialParcel, officialParcelPatch, publicSubjectFromOfficialParcel, makeLivePublicIntelligenceAdapters } from './public-property-intelligence-live.js';
import { PublicIntelligenceStore } from './public-intelligence-store.js';
import { ManagedIdentityRepository, EnvironmentManagedEmailProvider, managedIdentityStatus } from './managed-identity.js';
import { WindowsCredentialVault } from './windows-credential-vault.js';
import { SqliteGovernmentAccountRepository } from './government-account-manager.js';
import { writeBrowserFact, listBrowserFacts, requestCancel, isCancelled, clearCancel, markStoppedByOperator } from './browser-fact-store.js';
import { assessSellerAuthority } from './seller-authority.js';
import type { BrowserFact, BrowserSearchMode } from './browser-intelligence.js';
import { deriveCounty } from './providers/county-geocode.js';
import { buildDealCardUpdatePlan } from './deal-card-memory.js';
import { buildMarketPulseV1 } from './market-pulse.js';
import { fetchConfirmedParcelMarketPulse, fetchAreaMarketContext, type PulseComp } from './market-pulse-read.js';
import { buildPublicRecordsResearchPlan, researchPlanNextActions } from './public-records-research.js';
import { buildDukeAnalysis } from './duke-analysis.js';
import { buildAcePrep } from './ace-prep.js';
import {
  parseMarketQuery, defaultMarketQuery, ACREAGE_BANDS, MARKET_METRICS, MARKET_SIDES,
  isAcreageBand, isMarketSide, isMarketMetric,
  type MarketQuery, type AcreageBand, type MarketSide, type MarketMetric,
} from './market-matrix.js';
import {
  ingestMarketSnapshots, runMarketQueryWithExplanation, getMatrixCoverage,
  saveMarketQuery, listMarketQueries, getMarketQueryById, deleteMarketQuery,
  getHeatmapData, getCountyDrilldown, listReviewQueue, listCountyRef, listFlaggedSnapshots,
} from './market-matrix-store.js';
import { makeFixtureMarketProvider, makeLiveBrowserMarketProvider, delegateMarketResearchToBrowserAgent, pickMarketResearchBackend } from './market-browser-provider.js';
import { resolveMarketMatrix, resolveMarketMatrixSection } from './market-matrix-read.js';
import { playbookInfo, listBrowserAgentRuns } from './browser-agent.js';
import {
  landportalMarketResearchPlaybook, DRILL_DEEP_ACREAGE_LABEL, isSupportedBand,
  LANDPORTAL_MARKET_PLAYBOOK_ID, LANDPORTAL_MARKET_ALLOWED_SCOPE,
} from './browser-playbook-landportal-market.js';
import { extractAreaSignals } from './source-adapters.js';
import {
  startSession, endSession, recordBrowserEvent, synthesizePlaybook, extractKnowledge,
  usageRollup, listTrainingSessions, listTrainingEvents, getTrainingSession,
  listKnowledge as listTrainingKnowledge,
} from './browser-training.js';
import {
  listLatestPlaybooks, listPlaybookVersions, editPlaybook, decidePlaybook, setKnowledgeStatus,
  getPlaybook as getTrainingPlaybook, listTrainingExecutions,
} from './browser-training-db.js';
import { replayPlaybook } from './browser-training-replay.js';
import { runTrainedPlaybook } from './trained-playbook-runner.js';
import { planLandosIntake } from './intake-planner.js';
import { departmentRegistrySummary } from './department-registry.js';
import {
  landosStructureSummary,
  SHARED_SURFACES,
  SHARED_RECORDS,
  INTERFACE_LAYERS,
  WAR_ROOM_ROUTING_CONTRACT,
  warRoomPreservation,
} from './landos-structure.js';
import { INTAKE_TRANSPORTS, type IntakeTransport, type LandOSIntake, type ResponseMode } from './intake-types.js';
import { evaluateFact, evaluateComp, evaluateZoning } from './source-evidence.js';
import { listDealCards, getDealCard, createDealCard, updateDealCard, ensureDealCardForProperty, getDealCardIdForPropertyCard, listTrashedDealCards, softDeleteDealCard, restoreDealCard, hardDeleteDealCard } from './deal-card.js';
import { assembleBusinessObjects, whatBlocksThisDeal } from './business-object-spine.js';
import { persistParcelIdentityFromResolution, confirmParcelForDeal, readParcelIdentity, writeParcelIdentity } from './parcel-identity.js';
import { resolveParcelParallel, type ParallelResolution } from './parallel-resolution.js';
import { officialResolutionLane, landPortalResolutionLane } from './parallel-resolution-lanes.js';
import { buildCompMapView } from './comp-map.js';
import { buildResolutionSnapshot, writeResolutionSnapshot, readResolutionSnapshot } from './resolution-snapshot.js';
import { getDealCardDd, upsertDealCardDd, type DealCardDdPatch, type DealCardSourceLink } from './deal-card-dd.js';
import { getDealCardStrategy, upsertDealCardStrategy, type DealCardStrategyPatch } from './deal-card-strategy.js';
import { getDealCardMarket, upsertDealCardMarket, type DealCardMarketPatch } from './deal-card-market.js';
import { getDealCardReport, getDealCardReportSummary, runDealCardReport, buildPersistedResolver, buildIdentityText, landFactsForScore } from './deal-card-report.js';
import { computeDealCardReadiness } from './deal-card-readiness.js';
import { govDdProvidersStatus } from './providers/gov-dd-providers.js';
import { addSellerStatedFact, loadSellerStatedFacts, summarizeSellerFacts, SELLER_FACT_KINDS, isSellerFactKind } from './seller-stated-facts.js';
import {
  COUNTY_VERIFICATION_TASKS, planCountyVerification, saveCountyVerificationRecord, loadCountyVerificationRecords,
  type CountyVerificationTask, type CountyTaskResult, type CountyTaskStatus,
} from './county-records-tasks.js';
import { buildUnderwritingPrep } from './underwriting-prep.js';
import { buildDiscoveryBriefing } from './discovery-briefing.js';
import { buildExecutiveSummary } from './deal-card-executive-summary.js';
import { buildOperatorPropertyRecord, type OperatorPropertyRecord } from './operator-property-record.js';
import { buildLeadWorkspace } from './lead-workspace.js';
import { buildAcreageBasis, pinOverlayAcresToGeometry } from './acreage-basis.js';
import { acreageFactFromBasis } from './deal-card-reconciliation.js';
import {
  compRegistryForDeal, strategyReadinessForDeal, unifiedReadinessForDeal, documentRegistryForCard, modelVersionForCard,
  missionViewForCard, reconcileDealCard, compStateFromRegistry, DEAL_CARD_MODEL_VERSION,
  type ReportCompLanes,
} from './deal-card-canonical.js';
import { isServableDocumentPage, type RegisteredDocument } from './document-registry.js';
import { buildDdBusinessStatus } from './dd-business-status.js';
import { saveDocumentUpload, listDocumentUploads, servableUploadPath, UPLOAD_CATEGORIES } from './document-uploads.js';
import { retrieveRagChunks, buildAgentRagContext, ingestRagDocument, ragIndexStats, htmlToText, RAG_DOC_TYPES, type RagAgentKind, type RagDocType } from './rag-knowledge.js';
import { ingestCanonicalDealKnowledge, ingestCardEvidence, ingestRepoPlaybooks } from './rag-ingest.js';
import type { CompRegistry } from './comp-registry.js';
import type { StrategyReadinessRecord } from './strategy-readiness.js';
import type { UnifiedReadinessRecord } from './unified-readiness.js';
import { parseAcresValue } from './fact-format.js';
import {
  valuationFromRegistry, applyPricingGate, registryValuationStats,
  refreshMarketSummary, refreshStrategySummary, bestCompsFromRegistry, classifyReportReadiness,
} from './deal-card-projection.js';
import type { DocumentRegistry } from './document-registry.js';
import { getOrBuildParcelOverlay, PARCEL_OVERLAY_KINDS, PARCEL_OVERLAY_LABELS, type ParcelOverlayKind } from './parcel-overlay-visuals.js';
import {
  getAcquisition, upsertSellerProfile, addCommLogEntry, addDiscoveryNote, setAcquisitionStage,
  extractDiscoveryNotes, acquisitionNextAction, sellerStrategySummary, isAcquisitionStage,
  COMM_CHANNELS, ACQUISITION_STAGE_LABEL, type CommChannel, type AcquisitionStage,
} from './acquisitions.js';
import { buildCallPrep, buildFollowUpDraft, acquisitionPlaybook, acquisitionTrainingReadiness, type FollowUpFormat, type DealContextForPrep } from './acquisition-prep.js';
import {
  registerAsset, listAssets, addKnowledge, listKnowledge, approveKnowledge, rejectKnowledge,
  generatePlaybookSection, publishPlaybookSection, getPublishedPlaybookSection, listPlaybook, coachingLookup,
  isSourceType, isKnowledgeCategory, isPlaybookSection,
  type CoachingMode, type AipSourceType, type AipKnowledgeCategory, type AipPlaybookSection,
} from './aip.js';
import { buildPreCallIntelligence, inferPropertyType, type ParcelFacts } from './pre-call-intelligence.js';
import { collectBrowserMarketIntelligence, makeNewsResearchBackend } from './browser-market-intelligence.js';
import { googleVisualStatus, googleVisualConfiguredResolved } from './providers/google-visual.js';
import { DD_FIELD_LABELS, DD_PARCEL_IDENTITY_STATUSES, STRATEGY_OFFER_READINESS, MARKET_DEMAND_LABELS, MARKET_SOURCE_CONFIDENCE, isLeadType, LEAD_TYPE_LABEL, type DdFieldLabel, type DdParcelIdentityStatus, type StrategyOfferReadiness, type MarketDemandLabel, type MarketSourceConfidence, type LeadType } from './db.js';
import { addComp, listComps, recommendCompSources, evaluateCompRecency } from './comps.js';
import { persistPropertyInspection, runPropertyInspection } from './property-inspection.js';
import {
  DEAL_CARD_STATUSES,
  type DealCardStatus,
  type CompSourceLabel,
  type CompPriceKind,
  type CompStatus,
} from './db.js';

const isEntity = (v: unknown): v is LandosEntity =>
  v === 'LAND_ALLY' || v === 'TY_LAND_BIZ';
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function entityParam(raw: string | undefined): string | undefined {
  if (!raw || raw === 'all') return undefined;
  return (LANDOS_ENTITIES as readonly string[]).includes(raw) ? raw : undefined;
}
/** A persisted public-intelligence run is the stronger full-parcel screening source.
 * Project it deterministically at read time so older report snapshots cannot revive
 * a point-query "none mapped" result after a polygon overlay has been retrieved. */
function projectPublicScreening(report: ReturnType<typeof getDealCardReport>, run: PublicIntelligenceRun | null | undefined): ReturnType<typeof getDealCardReport> {
  if (!run?.tasks?.length) return report;
  const wetland = run.tasks.find((task) => task.task === 'wetlands')?.finding;
  const flood = run.tasks.find((task) => task.task === 'fema_flood')?.finding;
  const reconciliation = { ...report.reconciliation };
  const govDd = { ...report.govDd };
  // Mapped GIS geometry acreage — the single basis every spatial overlay is pinned
  // to, so the reconciliation flood facts and govDd can never state an overlay
  // acreage larger than the mapped parcel (or diverge from the operator record).
  const mappedAcresForOverlays = (() => {
    const cf = run.tasks.find((task) => task.task === 'county_records')?.finding;
    if (cf?.kind !== 'county_records') return null;
    const row = cf.facts.find((entry) => entry.field.toLowerCase() === 'gis mapped acreage');
    const n = row != null ? Number(row.value) : NaN;
    return Number.isFinite(n) ? n : null;
  })();

  if (wetland?.kind === 'wetlands' && wetland.intersects) {
    const classes = wetland.areas.map((area) => area.classification).filter(Boolean).join('; ') || 'Mapped wetland feature';
    const wetlandAreaUnavailable = wetland.approximateTotalAcres == null || (wetland.approximateTotalAcres <= 0 && (wetland.approximateParcelPercentage ?? 0) <= 0);
    const wetlandText = wetlandAreaUnavailable
      ? `Mapped NWI wetland feature (${classes}) intersects the parcel; reliable affected acreage is not yet available.`
      : `${classes}: ${wetland.approximateTotalAcres} ac (${wetland.approximateParcelPercentage ?? 'unknown'}%)`;
    const previous = reconciliation.wetlands;
    reconciliation.wetlands = { ...previous, primary: wetlandText, primarySource: 'USFWS NWI full-parcel screening overlay', primaryTier: 'official', status: wetlandAreaUnavailable ? 'needs_confirmation' : 'reconciled', alternates: [], conflict: false, conflictNote: 'The full-parcel overlay supersedes the earlier point query; the point result is historical and is not current support.' };
    govDd.wetlands = { ...govDd.wetlands, status: 'screening', type: classes, note: wetland.summary, source: wetland.evidenceMapRef ?? govDd.wetlands.source, timestamp: run.completedAt };
  }

  if (flood?.kind === 'fema_flood' && flood.zones.length) {
    // Pin flood overlay acreage to the mapped geometry before composing any text.
    const pinnedZones = pinOverlayAcresToGeometry(flood.zones, mappedAcresForOverlays);
    const zoneText = pinnedZones.map((zone) => `Zone ${zone.zone}: ${zone.approximateAcres} ac (${zone.parcelPercentage}%)`).join('; ');
    const floodNote = `Flood zones cover the parcel: ${pinnedZones.map((zone) => `${zone.zone} ${zone.parcelPercentage}% (${zone.approximateAcres} ac)`).join(', ')}${flood.baseFloodElevation ? `; BFE ${flood.baseFloodElevation}` : ''}.`;
    const previous = reconciliation.flood;
    reconciliation.flood = { ...previous, primary: `FEMA NFHL ${zoneText}`, primarySource: 'FEMA NFHL full-parcel screening overlay', primaryTier: 'official', status: 'reconciled', alternates: previous.primary ? [{ value: previous.primary, num: null, source: previous.primarySource ?? 'Prior FEMA screening', tier: previous.primaryTier }] : [], conflict: false, conflictNote: null };
    govDd.flood = { ...govDd.flood, status: 'screening', zone: pinnedZones.map((zone) => zone.zone).join(', '), note: floodNote, source: flood.evidenceMapRef ?? govDd.flood.source, timestamp: run.completedAt };
  }

  const degreeMatch = /^~?\s*([0-9.]+)\s*(?:°|degrees?)/i.exec(reconciliation.slope.primary ?? '');
  if (degreeMatch) {
    const degrees = Number(degreeMatch[1]);
    const percent = Math.tan(degrees * Math.PI / 180) * 100;
    const previous = reconciliation.slope;
    reconciliation.slope = { ...previous, primary: `~${percent.toFixed(1)}% slope at one sampled point (${degrees.toFixed(1)}°)`, status: 'needs_confirmation', conflict: false, conflictNote: 'A single elevation point is screening context only; no parcel-wide slope-band acreage is calculated.', alternates: [] };
  }

  // Acreage: the county record can carry BOTH an assessed acreage and a GIS
  // mapped-geometry acreage. When they materially disagree the reconciled fact
  // must STAY conflicted — mapped geometry is the spatial-screening basis, the
  // assessed figure is preserved as an alternate, and only a survey/plat
  // resolves the legal acreage. Never collapsed to one silently "verified" number.
  const countyFinding = run.tasks.find((task) => task.task === 'county_records')?.finding;
  if (countyFinding?.kind === 'county_records') {
    const factNum = (field: string): number | null => {
      const row = countyFinding.facts.find((entry) => entry.field.toLowerCase() === field.toLowerCase());
      const n = row != null ? Number(row.value) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const mapped = factNum('GIS mapped acreage');
    const assessed = factNum('Assessed acreage');
    // Reconciliation consumes the SHARED canonical acreage basis (same 5% / 0.1 ac
    // materiality the operator record and audit use) — never a private 15% gate
    // that let a 13% assessed-vs-mapped gap read as "reconciled" on one tab while
    // the header and audit flagged a conflict.
    const acreageBasis = buildAcreageBasis({
      assessed: { value: assessed, source: 'County assessor record' },
      gisGeometry: { value: mapped, source: 'County GIS parcel geometry' },
    });
    const acreageFact = acreageFactFromBasis(acreageBasis);
    if (mapped != null && assessed != null && acreageBasis.disputed && acreageFact) {
      reconciliation.acreage = {
        ...reconciliation.acreage,
        ...acreageFact,
        primary: `${mapped} ac (mapped geometry — spatial screening basis)`,
        primarySource: 'County GIS parcel geometry',
      };
      const note = reconciliation.acreage.conflictNote
        ?? `Acreage sources disagree: assessor ${assessed} ac vs mapped ${mapped} ac. Spatial calculations use the mapped geometry; the legal acreage is unresolved until a recorded plat or survey controls.`;
      reconciliation.acreage.conflictNote = note;
      if (!reconciliation.conflicts.includes(note)) {
        reconciliation.conflicts = [...reconciliation.conflicts, note];
      }
      // The DD checklist must quote the SAME conflicted basis — never a lone
      // assessed number presented as the acreage.
      const checklist = (report.ddFactChecklist ?? []).map((row) =>
        row.key === 'acres'
          ? { ...row, value: `${mapped} ac mapped (assessed ${assessed} ac — conflicted; survey/plat controls)`, source: 'County GIS geometry + assessor (conflicted)' }
          : row,
      );
      return { ...report, reconciliation, govDd, ddFactChecklist: checklist };
    }
  }

  return { ...report, reconciliation, govDd };
}

/** Mapped GIS geometry acreage from a run's county-records finding. */
function mappedAcresFromRun(run: PublicIntelligenceRun | null | undefined): number | null {
  const cf = run?.tasks?.find((task) => task.task === 'county_records')?.finding;
  if (cf?.kind !== 'county_records') return null;
  const row = cf.facts.find((entry) => entry.field.toLowerCase() === 'gis mapped acreage');
  const n = row != null ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Pin a persisted run's flood overlay to the mapped GIS geometry at read time, so
 * EVERY endpoint that serves the raw run (e.g. /public-intelligence feeding the DD
 * Public Property Intelligence panel) reports the same geometry-consistent acreage
 * as /report — an overlay can never state more acres than the mapped parcel.
 */
function pinRunOverlaysToGeometry<T extends PublicIntelligenceRun>(run: T | null | undefined): T | null | undefined {
  if (!run?.tasks?.length) return run;
  const mappedAcres = mappedAcresFromRun(run);
  if (mappedAcres == null) return run;
  const tasks = run.tasks.map((task) => {
    if (task.task !== 'fema_flood' || task.finding?.kind !== 'fema_flood' || !task.finding.zones?.length) return task;
    const flood = task.finding;
    const zones = pinOverlayAcresToGeometry(flood.zones, mappedAcres);
    const summary = `Flood zones cover the parcel: ${zones.map((z) => `${z.zone} ${z.parcelPercentage}% (${z.approximateAcres} ac)`).join(', ')}${flood.baseFloodElevation ? `; BFE ${flood.baseFloodElevation}` : ''}.`;
    return { ...task, finding: { ...flood, zones, summary } };
  });
  return { ...run, tasks };
}

/** City/state fallback for land-comp searches from the persisted public run. */
function publicLocalityFallback(dealCardId: number, input: { city?: string; state?: string; county?: string }): { city?: string; state?: string; county?: string } {
  if (input.city && input.state) return input;
  try {
    const run = new PublicIntelligenceStore().load(dealCardId)?.run;
    const finding = run?.tasks?.find((task) => task.task === 'county_records')?.finding;
    if (!finding || finding.kind !== 'county_records') return input;
    const fact = (field: string) => {
      const row = finding.facts.find((entry) => entry.field === field);
      return row != null ? String(row.value) : undefined;
    };
    const locality = fact('Situs locality (Census county subdivision)');
    const state = finding.jurisdiction?.split(',').pop()?.trim();
    return { county: input.county, city: input.city ?? locality, state: input.state ?? state };
  } catch {
    return input;
  }
}

const fmtMoney = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : 'Unavailable');
const fmtText = (v: unknown, fallback = 'Unavailable'): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

export function propertyIntelligenceMarkdown(input: {
  deal: unknown;
  report: ReturnType<typeof getDealCardReport>;
  executiveSummary: ReturnType<typeof buildExecutiveSummary>;
  discoveryReport?: ReturnType<typeof buildDiscoveryCallReport>;
  briefing?: ReturnType<typeof buildDiscoveryBriefing>;
  /** The shared records — when present, the download renders THESE for strategy
   *  and readiness, never the legacy discovery ranking's favorable labels. */
  unifiedReadiness?: UnifiedReadinessRecord | null;
  strategyReadiness?: StrategyReadinessRecord | null;
  /** The validated unique comp registry — when present, Comparable Sales lists
   *  each unique property exactly once, never a legacy list with duplicates. */
  compRegistry?: CompRegistry | null;
}): string {
  const { deal, report, executiveSummary, discoveryReport, briefing, unifiedReadiness, strategyReadiness, compRegistry } = input;
  const dealTitle = fmtText((deal as { title?: string }).title, `Deal Card #${(report as { dealCardId?: number }).dealCardId ?? ''}`);
  const dcr = discoveryReport;
  const inspection = report.landportalInspection;
  const factRows = report.ddFactChecklist ?? [];
  const fact = (key: string) => factRows.find((r) => r.key === key)?.value ?? null;
  const score = report.landScore;
  const offer = dcr?.roughOfferRange;
  const strategyRows = dcr?.strategyEvaluation ?? [];
  const comps = dcr?.comparableIntelligence?.selectedComparables?.length
    ? dcr.comparableIntelligence.selectedComparables
    : inspection?.comparables ?? [];
  const market = dcr?.marketIntelligence;
  const marketPulse = market?.marketPulse ?? executiveSummary.marketPulse.interpretation ?? report.marketSummary;
  const lines: string[] = [];
  lines.push(`# Property Intelligence Report`);
  lines.push('');
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(`Property: ${dealTitle}`);
  lines.push(`Status: ${report.reportStatus} | ${report.parcelVerificationStatus}`);
  lines.push('');
  lines.push(`## Executive Summary`);
  lines.push(dcr?.headline ?? executiveSummary.headline ?? report.ddSummary);
  lines.push(dcr?.disclaimer ?? 'Property intelligence assembled from existing LandOS due diligence, browser inspection, market, score, and strategy workflows.');
  lines.push('');
  lines.push(`## Parcel Overview`);
  lines.push(`- Owner: ${fact('owner') ?? fmtText(inspection?.parcelFacts?.['Owner Name'] ?? inspection?.parcelFacts?.Owner)}`);
  lines.push(`- APN / Parcel ID: ${fact('apn') ?? fmtText(inspection?.parcelFacts?.['Parcel ID'] ?? inspection?.parcelFacts?.APN)}`);
  lines.push(`- Acreage: ${fact('acres') ?? fmtText(inspection?.parcelFacts?.Acres ?? inspection?.parcelFacts?.['Calc Acres'])}`);
  lines.push(`- County / State: ${fact('county') ?? fmtText(inspection?.parcelFacts?.County)} / ${fact('state') ?? fmtText(inspection?.parcelFacts?.State)}`);
  lines.push(`- Address: ${fact('situsAddress') ?? fmtText(inspection?.parcelFacts?.['Parcel Address'] ?? inspection?.parcelFacts?.Address)}`);
  lines.push('');
  lines.push(`## Property Information`);
  for (const row of factRows) lines.push(`- ${row.label}: ${row.value ?? 'Unavailable'} (${row.status}${row.source ? `, ${row.source}` : ''})`);
  lines.push('');
  lines.push(`## Due Diligence Screening`);
  lines.push(inspection?.parcelUrl ? `Parcel source: ${inspection.parcelUrl}` : 'Parcel source: Unavailable');
  lines.push('- Access: Road proximity screening does not establish frontage, parcel-road or ROW contact, physical access, legal access, or maintenance. Independent verification remains required.');
  lines.push('');
  lines.push(`## Slope`);
  lines.push(fmtText(inspection?.parcelFacts?.['Slope Avg'] ?? report.govDd?.slope?.note, 'Unavailable from current visible data.'));
  lines.push('');
  lines.push(`## Wetlands`);
  lines.push(fmtText(inspection?.factSheet?.environment?.wetlandsPct ?? report.govDd?.wetlands?.note, 'Unavailable from current visible data.'));
  lines.push('');
  lines.push(`## Flood`);
  lines.push(fmtText(inspection?.factSheet?.environment?.femaFloodZone ?? report.govDd?.flood?.note, 'Unavailable from current visible data.'));
  lines.push('');
  lines.push(`## Google Visual Context`);
  for (const asset of report.visualContext?.assets ?? []) lines.push(`- ${String(asset.service).replace(/_/g, ' ')}: ${asset.status}${asset.note ? ` - ${asset.note}` : ''}`);
  lines.push('');
  lines.push(`## Comparable Sales`);
  if (compRegistry) {
    // The validated unique registry — each property exactly once, duplicates
    // merged; never the legacy raw comp list with repeated rows.
    if (compRegistry.uniqueComps.length === 0) lines.push('No validated unique comps yet.');
    for (const c of compRegistry.uniqueComps.slice(0, 20)) {
      lines.push(`- ${c.primary.kind === 'sold' ? 'SOLD' : 'ACTIVE'}${c.address ? ` | ${c.address}` : ''}${c.apn ? ` | APN ${c.apn}` : ''}${c.acres != null ? ` | ${Math.round(c.acres * 100) / 100} ac` : ''}${c.primary.price != null ? ` | ${fmtMoney(c.primary.price)}` : ''}${c.primary.pricePerAcre != null ? ` | ${fmtMoney(c.primary.pricePerAcre)}/ac` : ''} | ${c.providers.join(' + ')}`);
    }
    lines.push(`Validated unique: ${compRegistry.counts.validatedSold} sold, ${compRegistry.counts.validatedActive} active (${compRegistry.counts.duplicatesMerged} duplicate provider row(s) merged, ${compRegistry.counts.rejected} rejected).`);
  } else {
    if (comps.length === 0) lines.push('No comparable rows were extracted in the current run.');
    for (const c of comps.slice(0, 20) as Array<Record<string, unknown>>) {
      lines.push(`- ${fmtText(c.status, 'unknown')}${c.address ? ` | ${c.address}` : ''}${c.apn ? ` | APN ${c.apn}` : ''}${c.acres ? ` | ${c.acres} ac` : ''}${c.price ? ` | ${fmtMoney(c.price)}` : ''}${c.pricePerAcre ? ` | ${fmtMoney(c.pricePerAcre)}/ac` : ''}${c.distanceMiles ? ` | ${c.distanceMiles} mi` : ''}`);
    }
  }
  lines.push('');
  lines.push(`## Market Pulse`);
  lines.push(marketPulse);
  if (market) {
    if (market.opportunities.length) lines.push(`Opportunities: ${market.opportunities.join('; ')}`);
    if (market.risks.length) lines.push(`Risks: ${market.risks.join('; ')}`);
  }
  lines.push('');
  lines.push(`## Screening Status`);
  lines.push(score ? `Screening-only score: ${score.score}/${score.maxScore} (${score.confidence}). This is not a PASS, approval, valuation, or offer recommendation. ${score.note}` : 'Screening score unavailable because parcel identity or required facts are incomplete.');
  lines.push('');
  lines.push(`## Strategy`);
  if (strategyReadiness) {
    // The SHARED five-strategy record — the same statuses the Strategy tab
    // shows. Legacy "High Potential" discovery labels never reach a download.
    for (const s of strategyReadiness.strategies) lines.push(`- ${s.strategy}: ${s.status.replace(/_/g, ' ')}. ${s.why}${s.blockers.length ? ` Blockers: ${s.blockers.join('; ')}.` : ''}`);
    lines.push(strategyReadiness.pricingAllowed
      ? `Primary strategy: ${report.mostViableStrategy || 'Pending Tyler review of the scoreable strategies.'}`
      : `Primary strategy: none — the pricing gate is closed (${strategyReadiness.pricingBlockers.join(' ')}). No strategy may be promoted or priced yet.`);
  } else {
    for (const s of strategyRows) lines.push(`- ${s.strategy}: ${s.potential ?? s.verdict}. ${s.reason} Risk: ${s.mainRisk}`);
    lines.push(`Primary strategy: ${report.mostViableStrategy || 'Unavailable'}`);
  }
  lines.push('');
  lines.push(`## Readiness (shared record)`);
  if (unifiedReadiness) {
    lines.push(unifiedReadiness.summaryLine);
    for (const d of unifiedReadiness.dimensions) lines.push(`- ${d.label}: ${d.stateLabel}. ${d.why}`);
    if (unifiedReadiness.materiality.length) {
      lines.push('Material facts lowering readiness:');
      for (const m of unifiedReadiness.materiality) lines.push(`- ${m.factor.replace(/_/g, ' ')} (${m.status}): ${m.effect}`);
    }
  } else {
    lines.push('This legacy download does not produce offer guidance. Use the live canonical Seller guardrails only after at least three validated comparable closed sales support pricing.');
  }
  lines.push('');
  lines.push(`## Red Flags`);
  for (const item of [...(report.riskFlags ?? []), ...(market?.risks ?? [])].slice(0, 12)) lines.push(`- ${item}`);
  if (!(report.riskFlags ?? []).length && !(market?.risks ?? []).length) lines.push('- None captured.');
  lines.push('');
  lines.push(`## Green Flags`);
  for (const item of [...(inspection?.visualObservations?.map((o) => `${o.label}: ${o.detail}`) ?? []), ...(market?.opportunities ?? [])].slice(0, 12)) lines.push(`- ${item}`);
  if (!(inspection?.visualObservations?.length) && !(market?.opportunities ?? []).length) lines.push('- None captured.');
  lines.push('');
  lines.push(`## Discovery Call Preparation`);
  for (const q of [...(briefing?.questionsToAsk ?? []), ...(inspection?.discoveryQuestions ?? [])].slice(0, 12)) lines.push(`- ${q}`);
  lines.push('');
  lines.push(`## Due Diligence Opinion`);
  lines.push(report.parcelVerified ? 'Parcel identity is source-verified. Use this as a pre-discovery due diligence report; confirm title, access, zoning, utilities, and environmental constraints before a firm offer.' : 'Parcel identity is not verified. Treat all market and strategy output as local-area context until APN/owner/county evidence verifies the parcel.');
  lines.push('');
  lines.push(`## Screenshots`);
  for (const a of inspection?.assets ?? []) lines.push(`- ${a.label}: ${a.kind}${a.note ? ` - ${a.note}` : ''}`);
  return lines.join('\n');
}

async function buildPropertyIntelligencePdf(markdown: string, imagePaths: string[]): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ margin: 42, size: 'LETTER' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(18).text('Property Intelligence Report', { underline: true });
  doc.moveDown();
  for (const raw of markdown.split('\n').slice(2)) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) {
      doc.moveDown(0.8).fontSize(14).text(line.slice(3), { underline: true }).moveDown(0.2).fontSize(10);
    } else if (line.startsWith('### ')) {
      doc.moveDown(0.5).fontSize(12).text(line.slice(4)).fontSize(10);
    } else {
      doc.fontSize(9).text(line || ' ', { width: 520 });
    }
  }
  if (imagePaths.length) {
    doc.addPage().fontSize(14).text('Screenshots', { underline: true }).moveDown();
    for (const imagePath of imagePaths.slice(0, 12)) {
      try {
        if (!fs.existsSync(imagePath)) continue;
        if (doc.y > 560) doc.addPage();
        doc.image(imagePath, { fit: [520, 280], align: 'center' });
        doc.moveDown();
      } catch { /* skip unreadable image */ }
    }
  }
  doc.end();
  return done;
}

/** At-a-glance "workspace readiness" summary for each property card so the
 *  operator can see, on the board, which properties already have real intelligence
 *  (inspection, visuals, comps, seller questions) without opening each one.
 *
 *  Counts reflect the CURRENT persisted state, not activity history: inspection
 *  visuals + seller questions come from the latest inspection (loadPropertyInspection
 *  — deduped, LIMIT 1), plus persisted Google captures; comps are the actual
 *  landos_comp rows. Earlier this summed every inspection re-run and inflated the
 *  numbers (e.g. 79 "visuals" = ~8 counted 10×); those inflated counts were noise,
 *  not real signal. No fabrication, no artificial gaps — a card with no data reads 0. */
export function withPropertyWorkspaceSummary<T extends { id: number }>(cards: T[]): Array<T & {
  workspace_has_inspection: boolean;
  workspace_visual_count: number;
  workspace_comp_count: number;
  workspace_seller_question_count: number;
}> {
  const db = getLandosDb();
  const compCount = db.prepare('SELECT COUNT(1) AS n FROM landos_comp WHERE card_id = ?');
  // Presence is an existence check (robust to a malformed latest ref); the visual
  // and seller-question counts come from the latest PARSEABLE inspection.
  const hasInspectionRow = db.prepare("SELECT 1 FROM landos_card_activity WHERE card_id = ? AND kind IN ('property_inspection','landportal_inspection') LIMIT 1");
  return cards.map((card) => {
    const inspection = loadPropertyInspection(card.id); // latest parseable, deduped (or null)
    const googleVisuals = Object.keys(loadCardVisualCapture(card.id)).length; // persisted captures
    const comps = compCount.get(card.id) as { n: number } | undefined;
    return {
      ...card,
      workspace_has_inspection: !!hasInspectionRow.get(card.id),
      // Inspection screenshots/overlays (current set) + distinct Google captures.
      workspace_visual_count: (inspection?.assets.length ?? 0) + googleVisuals,
      workspace_comp_count: comps?.n ?? 0,
      workspace_seller_question_count: inspection?.discoveryQuestions.length ?? 0,
    };
  });
}

/** Board-summary enrichment: attach the two fields the redesigned Property Board
 *  needs that are NOT on the property-card row — the linked Deal Card id (so a
 *  card click always opens the canonical Deal Card, never a second intelligence
 *  surface) and the latest open next-action (concise pipeline signal). Both are
 *  read-only batch lookups; neither mutates a card or creates a Deal Card. Cards
 *  with no linked Deal Card yet resolve to null and are handled at click time by
 *  the ensure endpoint. */
export function withBoardSummary<T extends { id: number }>(cards: T[]): Array<T & {
  deal_card_id: number | null;
  next_action: string | null;
}> {
  const db = getLandosDb();
  const dealIdStmt = db.prepare('SELECT deal_card_id FROM landos_deal_card_property WHERE card_id = ? ORDER BY id ASC LIMIT 1');
  const nextActionStmt = db.prepare("SELECT action FROM landos_card_next_action WHERE card_id = ? AND status = 'open' ORDER BY created_at DESC, id DESC LIMIT 1");
  return cards.map((card) => {
    const dealRow = dealIdStmt.get(card.id) as { deal_card_id: number } | undefined;
    const naRow = nextActionStmt.get(card.id) as { action: string } | undefined;
    return { ...card, deal_card_id: dealRow?.deal_card_id ?? null, next_action: naRow?.action ?? null };
  });
}

function suppressWeakerDuplicatePropertyCards<T extends { id: number; address_key?: string | null; verification_status?: string | null }>(cards: T[]): T[] {
  const erroneousIds = new Set((getLandosDb().prepare(
    `SELECT erroneous_card_id FROM landos_property_correction_link WHERE relationship='erroneous_duplicate'`,
  ).all() as Array<{ erroneous_card_id: number }>).map((row) => row.erroneous_card_id));
  const verifiedAddressKeys = new Set(cards
    .filter((card) => card.verification_status === 'verified_property' && (card.address_key ?? '').trim())
    .map((card) => (card.address_key ?? '').trim()));
  if (!verifiedAddressKeys.size) return cards.filter((card) => !erroneousIds.has(card.id));
  return cards.filter((card) => {
    if (erroneousIds.has(card.id)) return false;
    const key = (card.address_key ?? '').trim();
    return !(key && verifiedAddressKeys.has(key) && card.verification_status !== 'verified_property');
  });
}

// ── Property Resolution Engine: live lane adapters ──────────────────────────
// The engine is pure; these wire the existing tested providers (Realie/LandPortal
// exact resolve, free US Census county derivation, free Photon/Census address
// suggest). Browser lanes are parked (visual stack not installed) but recorded.
function pifToIntakeFields(f: ParsedIntakeFields): IntakeFields {
  return { address: f.address, city: f.city, state: f.state, zip: f.zip, county: f.county, fips: f.fips, apn: f.apn, owner: f.owner, propertyId: f.propertyId };
}
function pifToText(f: ParsedIntakeFields): string {
  return [f.lpUrl, f.address, f.city, f.county ? `${f.county} County` : undefined, f.state, f.zip,
    f.apn ? `APN: ${f.apn}` : undefined, f.owner ? `Owner: ${f.owner}` : undefined].filter(Boolean).join('\n');
}

/** Named-source verification built from parsed fields (so the engine can retry
 *  with a derived county). Reuses the canonical resolver-planner → exact resolve
 *  → mapResolveToVerification path. Never a comp credit. */
async function verifyFromFields(fields: ParsedIntakeFields, timeoutMs: number): Promise<DukeVerificationResult> {
  const text = pifToText(fields);
  const plan = planResolver(pifToIntakeFields(fields));
  if (plan.path === 'none') {
    return mapResolveToVerification({ text, hasIdentifierInput: false, resolve: null, unavailable: false });
  }
  try {
    const resolve = await resolveParcelIdentityResult(plan.args, timeoutMs);
    return mapResolveToVerification({ text, hasIdentifierInput: true, resolve, unavailable: false });
  } catch {
    return mapResolveToVerification({ text, hasIdentifierInput: true, resolve: null, unavailable: true });
  }
}

/** Operator-facing browser evidence: status, provenance-labeled facts, the
 *  official sources routed, and a clean note — never a raw log/field dump. */
function redactEvidence(ev: { service: string; mode: string; status: string; facts: unknown[]; sourcesUsed: unknown[]; screenshots: unknown[]; blocked: unknown[]; note: string }): Record<string, unknown> {
  return {
    service: ev.service, mode: ev.mode, status: ev.status,
    facts: ev.facts, sourcesUsed: ev.sourcesUsed,
    screenshotCount: ev.screenshots.length, blocked: ev.blocked, note: ev.note,
  };
}

/** Live deps for the Property Resolution Engine. Free providers (Census/Photon)
 *  and the budgeted Realie exact resolve only; browser lanes parked. */
function liveResolutionDeps(timeoutMs: number): ResolutionDeps {
  return {
    verify: async () => ({ status: 'unverified', parcelVerified: false, sourceAttempts: [{ source: 'Optional parcel provider', status: 'skipped', reason: 'Public-first resolution defers optional provider lookup.', truthLabel: 'attempted_lookup' }], dataGaps: ['needs_county_or_fips'], marketPulseEligible: false, strategyUnderwritingBlocked: true, summary: 'Public county and government sources are being attempted before optional parcel providers.', executionMode: 'duke_verification_read_only' }),
    officialParcel: async (fields, lookupTimeoutMs) => {
      const result = await lookupOfficialParcel(fields, Math.min(lookupTimeoutMs, 25_000));
      const parcel = result.parcel;
      return {
        patch: parcel ? officialParcelPatch(parcel) : null,
        source: parcel?.provider ?? 'Official public parcel lookup',
        sourceUrl: parcel?.sourceUrl,
        note: result.attempted.map((attempt) => `${attempt.source}: ${attempt.note}`).join(' ') || 'No official public parcel result.',
      };
    },
    deriveCounty: (f) => deriveCounty({ address: f.address, city: f.city, state: f.state, zip: f.zip }),
    suggest: (q) => suggestAddresses(q),
    // Browser Intelligence: LandPortal-first, then County gap-fill, backed by the
    // live persistent-session driver. configured() is true only when the operator's
    // Chrome session is connected; otherwise the services report parked (honest).
    // Never stores a credential; never prints cookies/tokens.
    landPortalBrowser: undefined,
    countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
    timeoutMs,
  };
}

/**
 * Run Tyler's two PARALLEL primary parcel-evidence lanes concurrently:
 *   Lane A — official public record (structured county/state adapters).
 *   Lane B — LandPortal parcel page (live read-only browser session).
 * Neither lane blocks the other; a missing adapter or an unauthenticated
 * LandPortal session is an honest `unavailable`, never a dead end. The verdict
 * is reconciled into one confirmation + visible reconciliation issues.
 */
// The persistent Chrome session has ONE working tab. Two live-browser missions
// running concurrently collide on it (observed live: a second parallel-resolve
// stalls the first's CDP protocol until "Network.enable timed out"). Serialize
// every parallel-resolution mission through this in-process gate — later calls
// queue instead of colliding. The gate never rejects (each link swallows its
// predecessor's error) so one failed mission never poisons the queue.
let parallelResolutionGate: Promise<unknown> = Promise.resolve();

async function runParallelParcelResolution(
  fields: ParsedIntakeFields,
  timeoutMs: number,
): Promise<ParallelResolution> {
  const run = parallelResolutionGate.then(
    () => runParallelParcelResolutionInner(fields, timeoutMs),
    () => runParallelParcelResolutionInner(fields, timeoutMs),
  );
  parallelResolutionGate = run.catch(() => undefined);
  return run;
}

async function runParallelParcelResolutionInner(
  fields: ParsedIntakeFields,
  timeoutMs: number,
): Promise<ParallelResolution> {
  // "No live session" must attempt the supported persistent Chrome/CDP
  // attachment + automatic LandPortal login BEFORE parking Lane B. Best-effort:
  // an unavailable browser degrades the lane honestly, never throws.
  try {
    const readiness = await ensureLandPortalAuthenticated();
    logger.info({ event: 'parallel_lane_b_readiness', phase: readiness.phase, authenticated: readiness.authenticated, hasReason: !!readiness.reason }, 'parallel_lane_b_readiness');
  } catch (err) { logger.warn({ err }, 'parallel_lane_b_attach_failed'); }
  const lp = makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') });
  const searchKey = {
    address: fields.address, apn: fields.apn, owner: fields.owner,
    city: fields.city, county: fields.county, state: fields.state, zip: fields.zip,
  };
  return resolveParcelParallel({ fields }, {
    officialLane: (input) => officialResolutionLane(input.fields, Math.min(timeoutMs, 25_000)),
    landPortalLane: () => landPortalResolutionLane(lp, searchKey, timeoutMs),
    // Hard stop slightly above the lane's own timeout so a browser workflow
    // that ignores its budget cannot hold the verdict (or an operator HTTP
    // request) hostage.
    laneTimeoutMs: timeoutMs + 30_000,
  });
}

/**
 * Apply a parallel-resolution verdict to a card: record the attempt + every
 * hard reconciliation issue, and either PROMOTE a previously unresolved lead to
 * a confirmed parcel or — when the verdict contradicts an already-ACCEPTED
 * APN — preserve the accepted record, record the contradiction, and route it to
 * Tyler (operator-confirmation rule). Shared by the manual endpoint and the
 * autonomous acquire/run escalation so both behave identically.
 */
function applyParallelResolution(args: {
  dealCardId: number;
  cardId: number;
  entity: LandosEntity;
  resolution: ParallelResolution;
  acceptedApn: string | null;
  alreadyVerified: boolean;
  activeInputAddress: string | null;
  city: string | null;
}): { promoted: boolean; operatorConfirmationRequired: boolean } {
  const { dealCardId, cardId, resolution } = args;
  try {
    attachCardActivity({
      cardId, agentId: 'parallel-resolution', kind: 'parcel_resolution',
      summary: `Parallel parcel resolution — ${resolution.lanes.map((l) => `${l.lane}:${l.status}`).join(', ')}. ${resolution.confirmationBasis}`,
      ref: JSON.stringify({
        confirmed: resolution.confirmed, laneAgreement: resolution.laneAgreement,
        reconciliation: resolution.reconciliation, identityConflict: resolution.identityConflict ?? null,
        lanes: resolution.lanes.map((l) => ({ lane: l.lane, status: l.status, note: l.note })),
      }),
    });
  } catch { /* activity history is best-effort */ }

  for (const issue of resolution.reconciliation) {
    if (issue.severity !== 'conflict') continue;
    try { addCardNextAction({ cardId, action: `Reconcile ${issue.field}: ${issue.values.map((v) => `${v.value} (${v.source})`).join(' vs ')}. ${issue.note}`, createdBy: 'parallel-resolution' }); } catch { /* best-effort */ }
  }

  let promoted = false;
  let operatorConfirmationRequired = false;
  const parcel = resolution.confirmedParcel;
  if (resolution.confirmed && parcel && !resolution.identityConflict) {
    const resolvedApnKey = String(parcel.apn ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    const acceptedApnKey = String(args.acceptedApn ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    const contradictsAccepted = args.alreadyVerified && acceptedApnKey && resolvedApnKey && acceptedApnKey !== resolvedApnKey;
    if (contradictsAccepted) {
      operatorConfirmationRequired = true;
      try {
        attachCardActivity({
          cardId, agentId: 'parallel-resolution', kind: 'reconciliation_contradiction',
          summary: `Parallel lanes resolved APN ${parcel.apn} but this card's ACCEPTED APN is ${args.acceptedApn}. Accepted record preserved; awaiting Tyler's confirmation before any change.`,
          ref: JSON.stringify({ acceptedApn: args.acceptedApn, resolvedApn: parcel.apn, source: parcel.source }),
        });
      } catch { /* best-effort */ }
      try { addCardNextAction({ cardId, action: `⚠ Parallel resolution disagrees with the accepted APN (accepted ${args.acceptedApn} vs resolved ${parcel.apn} from ${parcel.source}). Accepted record kept unchanged — confirm with Tyler before changing.`, createdBy: 'parallel-resolution' }); } catch { /* best-effort */ }
    } else if (!args.alreadyVerified) {
      try {
        writeParcelIdentity(dealCardId, {
          subjectCardId: cardId, state: 'confirmed', confidence: resolution.laneAgreement === 'agree' ? 1 : 0.9,
          basis: resolution.confirmationBasis, confirmedBy: 'parallel-resolution',
          evidenceRefs: resolution.lanes.filter((l) => l.parcel?.sourceUrl).map((l) => l.parcel!.sourceUrl!),
        }, 'parallel-resolution');
        const subjectAddress = args.activeInputAddress ?? parcel.address ?? '';
        // LandOS convention stores the bare county name ("Pickens", not
        // "Pickens County") — providers echo the suffixed form and the UI
        // appends "County" itself (live QA caught "Pickens County County").
        const countyName = parcel.county ? parcel.county.replace(/\s+county$/i, '').trim() : undefined;
        upsertCardFromDukeRun({
          entity: args.entity, agentId: 'parallel-resolution', cardId,
          activeInputAddress: subjectAddress,
          city: parcel.county ? args.city ?? undefined : undefined,
          state: parcel.state ?? undefined, county: countyName,
          apn: parcel.apn ?? undefined, owner: parcel.owner ?? undefined,
          acres: typeof parcel.acres === 'number' ? parcel.acres : undefined,
          lat: parcel.coordinates?.lat ?? null, lng: parcel.coordinates?.lng ?? null,
          verified: true, verificationSource: parcel.source,
          summary: 'Parcel confirmed via parallel resolution (official public + LandPortal).',
        });
        if (parcel.sourceUrl) {
          try {
            attachCardSourceEvidence({
              cardId, fact: 'Parcel identity', value: parcel.apn ?? undefined,
              sourceUrl: parcel.sourceUrl, sourceLabel: parcel.source,
              note: 'Parcel-level identity confirmed by a parallel resolution lane. Public/GIS records are screening evidence, not a deed, title commitment, survey, or legal-boundary determination.',
              parcelVerified: true,
            });
          } catch { /* evidence attach is best-effort */ }
        }
        try { addCardNextAction({ cardId, action: 'Parcel confirmed via parallel resolution — run the Deal Card report to continue Property Intelligence, comps, and Market Pulse.', createdBy: 'parallel-resolution' }); } catch { /* best-effort */ }
        promoted = true;
      } catch (err) { logger.warn({ err, cardId }, 'parallel_resolve_promote_failed'); }
    }
  }
  return { promoted, operatorConfirmationRequired };
}

function hasCriticalParcelGaps(p: {
  parcelVerified?: boolean;
  owner?: string;
  apn?: string;
  acres?: number;
  coordinates?: { lat: number; lng: number };
}): boolean {
  return p.parcelVerified !== true || !p.owner || !p.apn || !(typeof p.acres === 'number' && p.acres > 0) || !p.coordinates;
}

function landPortalBrowserProof(evidence: BrowserEvidence[] | undefined, p: {
  apn?: string;
  county?: string;
  state?: string;
  fips?: string;
}): { verified: boolean; sourceUrl?: string; source: string; screenshotCount: number } {
  const lp = (evidence ?? []).find((ev) => ev.service === 'landportal' && ev.status === 'retrieved');
  if (!lp) return { verified: false, source: '', screenshotCount: 0 };
  const apn = str(lp.patch.apn) ?? p.apn;
  const county = str(lp.patch.county) ?? p.county;
  const state = str(lp.patch.state) ?? p.state;
  const fips = str(lp.patch.fips) ?? p.fips;
  const sourceUrl = lp.sourceUrls.find((u) => /^https?:\/\//i.test(u)) ?? lp.sourcesUsed.find((s) => /^https?:\/\//i.test(s.url))?.url;
  const verified = !!(apn && (county || state || fips) && sourceUrl);
  return {
    verified,
    sourceUrl,
    source: verified ? 'LandPortal Map Search parcel panel (browser read-only)' : '',
    screenshotCount: lp.screenshots.length,
  };
}

/**
 * Status-only, dashboard-safe view of Live Comps readiness. Pure: maps the
 * existing preflight output to BOOLEANS only. It NEVER returns or contains a
 * secret value, actor slug, env key name, reason string, or the missing array —
 * each *Present field is derived purely from preflight missing-key MEMBERSHIP.
 * providerCallsMade and spendUsd are always 0 by construction (this path never
 * calls a provider and never spends).
 */
export interface LiveCompsReadinessStatus {
  liveCompsEnabled: boolean;
  apifyTokenPresent: boolean;
  redfinSearchActorPresent: boolean;
  redfinDetailActorPresent: boolean;
  redfinCompsReady: boolean;
  providerCallsMade: 0;
  spendUsd: 0;
}

export function liveCompsReadinessStatus(preflight: LiveDataPreflight): LiveCompsReadinessStatus {
  const missing = preflight.comps.missing;
  // A key is "present" when it is NOT named in the preflight missing list. The
  // flag's missing entry is suffixed (e.g. "LANDOS_LIVE_COMPS (set to 1 ...)"),
  // so match an exact key OR a "<key> " prefix. No value is ever read here.
  const present = (key: string): boolean => !missing.some((m) => m === key || m.startsWith(key + ' '));
  return {
    liveCompsEnabled: present(LIVE_DATA_ENV_KEYS.liveComps),
    apifyTokenPresent: present(LIVE_DATA_ENV_KEYS.apifyToken),
    redfinSearchActorPresent: present(LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor),
    redfinDetailActorPresent: present(LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor),
    redfinCompsReady: preflight.comps.ready,
    providerCallsMade: 0,
    spendUsd: 0,
  };
}

export function registerLandosRoutes(app: Hono): void {
  app.get('/api/landos/overview', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const overview = getOverview(entity);
    return c.json({
      ...overview,
      departments: DEPARTMENTS,
      pendingApprovalList: listApprovals('pending', 20),
    });
  });

  app.get('/api/landos/entities', (c) => {
    const rows = getLandosDb().prepare('SELECT * FROM landos_business_entity ORDER BY id').all();
    return c.json({ entities: rows });
  });

  app.get('/api/landos/departments', (c) => c.json({ departments: DEPARTMENTS }));

  // ── Org chart: Executive Agent + 14-agent roster + workflow (read-only) ─────
  // Source-of-truth roster for the dashboard Org/Agents view. No secrets, no
  // model calls. Business metadata only.
  app.get('/api/landos/org', (c) => {
    const org = orgChart();
    return c.json({
      executive: { key: org.executive.key, name: org.executive.name, role: org.executive.role },
      roster: rosterSummary(),
      groups: Object.fromEntries(
        Object.entries(org.groups).map(([g, list]) => [g, list.map((a) => a.key)]),
      ),
      workflow: {
        primary: ['Lead', 'DD Report', 'Discovery Call', 'Underwriting', 'Offer'],
        alternate: ['Lead', 'DD Report', 'Discovery Call', 'Deeper DD', 'Underwriting', 'Offer'],
      },
    });
  });

  // ── Live Comps readiness (status-only; NO secrets, NO provider call) ──────
  // Lets Tyler confirm from the dashboard whether local Live Comps is configured
  // and ready. Returns BOOLEANS only via liveCompsReadinessStatus(); it never
  // reads/returns a token, actor id, key name, length, or reason. preflightLiveData
  // makes no external call, instantiates no Apify client, and spends nothing.
  app.get('/api/landos/live-comps/preflight', async (c) => {
    // Resolve config from the APPROVED source (.env via readEnvFile, exported
    // process.env wins) WITHOUT putting secrets into process.env. Status-only.
    const preflight = await preflightLiveData({ env: resolveLiveDataEnv() });
    return c.json(liveCompsReadinessStatus(preflight));
  });

  // ── Neutral model registry + facts-based suggestions + sticky overrides ──
  // Read-only metadata: registry facts, the current per-orientation suggestion,
  // and the user's stored sticky overrides. No model call, no secrets.
  const MODEL_SCOPE_KINDS: readonly ModelPreferenceScopeKind[] = ['task_type', 'department', 'sub_agent'];

  app.get('/api/landos/models', (c) => {
    const entity = entityParam(c.req.query('entity'));
    return c.json({
      registry: MODEL_REGISTRY,
      suggestions: {
        task_oriented: suggestModelForOrientation('task_oriented'),
        reasoning_oriented: suggestModelForOrientation('reasoning_oriented'),
      },
      preferences: getModelPreferences(entity),
    });
  });

  // Set a sticky override. The model id MUST be a registered model (never an
  // arbitrary/invented id). The override always wins for its scope until reset.
  app.post('/api/landos/models/override', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const scopeKind = str(body.scopeKind);
    const scopeKey = str(body.scopeKey);
    const modelId = str(body.modelId);
    const taskType = str(body.taskType) ?? '';
    const entity = entityParam(str(body.entity));
    if (!scopeKind || !(MODEL_SCOPE_KINDS as readonly string[]).includes(scopeKind)) {
      return c.json({ error: `scopeKind must be one of ${MODEL_SCOPE_KINDS.join(', ')}` }, 400);
    }
    if (!scopeKey) return c.json({ error: 'scopeKey is required' }, 400);
    if (!modelId || !getModel(modelId)) {
      return c.json({ error: 'modelId must be a registered model id' }, 400);
    }
    setModelPreference({ entity, scopeKind: scopeKind as ModelPreferenceScopeKind, scopeKey, taskType, modelId });
    return c.json({ ok: true, preference: { entity: entity ?? '', scopeKind, scopeKey, taskType, modelId } });
  });

  // Reset a sticky override (one-click "reset to suggestion").
  app.post('/api/landos/models/override/reset', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const scopeKind = str(body.scopeKind);
    const scopeKey = str(body.scopeKey);
    const taskType = str(body.taskType) ?? '';
    const entity = entityParam(str(body.entity));
    if (!scopeKind || !(MODEL_SCOPE_KINDS as readonly string[]).includes(scopeKind)) {
      return c.json({ error: `scopeKind must be one of ${MODEL_SCOPE_KINDS.join(', ')}` }, 400);
    }
    if (!scopeKey) return c.json({ error: 'scopeKey is required' }, 400);
    const removed = resetModelPreference({ entity, scopeKind: scopeKind as ModelPreferenceScopeKind, scopeKey, taskType });
    return c.json({ ok: true, removed });
  });

  // Capability-based model router (read-only scaffold). Exposes capability
  // profiles + dimensions, and a DETERMINISTIC routing preview. No model call,
  // no secrets, no .env. Availability for the preview comes from the request
  // (defaulting to all profiled models) so the operator can see how routing
  // would resolve a job's required capabilities.
  app.get('/api/landos/model-router/capabilities', (c) =>
    c.json({
      dimensions: CAPABILITY_DIMENSIONS,
      models: MODEL_CAPABILITIES,
      // Provenance: every capability traces to its sources (seeded baseline here;
      // provider-metadata / benchmark / observed / override layer on later).
      provenance: MODEL_CAPABILITIES.map((m) => ({ modelId: m.modelId, sourced: sourcedProfileFor(m.modelId, m.profile) })),
    }));

  // Execution-environment -> provider -> model tree with status (read-only).
  // No credentials are injected here, so providers show as not-installed/
  // not-configured — the structure + the shared registry are what's exposed.
  // No .env, no secrets, no network probe.
  app.get('/api/landos/model-router/environments', (c) => {
    const registry = buildProviderRegistry();
    return c.json({ environments: registry.describe() });
  });

  // Live model-router status: safe-mode flag, provider presence (booleans only —
  // no secrets), and the EE->provider->model tree with REAL configured status
  // from the config-built registry. Read-only; no .env values exposed.
  app.get('/api/landos/model-router/status', (c) => {
    const registry = buildRegistryFromConfig();
    const live = resolveLiveRouting();
    const ollama = resolveOllamaHost();
    return c.json({
      liveRouting: live.enabled,
      liveRoutingSource: live.source,
      safeMode: !live.enabled,
      highStakesDefault: 'claude',
      // Effective provider presence: ollama reflects the RESOLVED host (setting or
      // env), not just the boot-time env const, so the dashboard matches reality.
      providerPresence: { ...PROVIDER_PRESENCE, ollama: !!ollama.host },
      ollamaHostConfigured: !!ollama.host,
      ollamaHostSource: ollama.source,
      environments: registry.describe(),
      helpers: GRUNT_HELPERS,
    });
  });

  // Operator controls for live routing + the local Ollama host (persisted via
  // dashboard_settings; survives restart — this is the durable enable path that
  // .env-only config lacked). No secrets; booleans/host only.
  app.post('/api/landos/model-router/live-routing', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled (boolean) is required' }, 400);
    setLiveRouting(body.enabled);
    return c.json({ ok: true, liveRouting: resolveLiveRouting() });
  });
  app.post('/api/landos/model-router/ollama-host', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.host !== 'string') return c.json({ error: 'host (string) is required' }, 400);
    const host = body.host.trim();
    if (host && !/^https?:\/\//i.test(host)) return c.json({ error: 'host must be an http(s) URL or empty to clear' }, 400);
    setOllamaHost(host);
    return c.json({ ok: true, ollamaHost: resolveOllamaHost() });
  });

  // Manual override controls (persistent via dashboard_settings). modelId must be
  // a known model. Scopes: global | agent | task_type (one-time is per-request).
  const overrideStore = () => new DashboardSettingsOverrideStore({ getDashboardSetting, setDashboardSetting });
  app.get('/api/landos/model-router/override', (c) => {
    const resolved = resolveOverride({ agentId: c.req.query('agentId'), taskType: c.req.query('taskType') }, overrideStore());
    return c.json({ override: resolved });
  });
  app.post('/api/landos/model-router/override', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = str(body.scope);
    const key = str(body.key);
    const modelId = str(body.modelId);
    if (!scope || !['global', 'agent', 'task_type'].includes(scope)) return c.json({ error: 'scope must be global | agent | task_type' }, 400);
    if (scope !== 'global' && !key) return c.json({ error: 'key (agentId or taskType) is required for this scope' }, 400);
    if (!modelId || !getCapabilityEntry(modelId)) return c.json({ error: 'modelId must be a known model' }, 400);
    setOverride(overrideStore(), scope as OverrideScope, key, modelId);
    return c.json({ ok: true, override: { scope, key: key ?? null, modelId } });
  });
  app.post('/api/landos/model-router/override/reset', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = str(body.scope);
    const key = str(body.key);
    if (!scope || !['global', 'agent', 'task_type'].includes(scope)) return c.json({ error: 'scope must be global | agent | task_type' }, 400);
    resetOverride(overrideStore(), scope as OverrideScope, key);
    return c.json({ ok: true });
  });

  app.post('/api/landos/model-router/preview', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const needs = (body.needs && typeof body.needs === 'object') ? (body.needs as JobRequirements['needs']) : {};
    const availableModelIds = Array.isArray(body.availableModelIds)
      ? (body.availableModelIds as string[])
      : MODEL_CAPABILITIES.map((m) => m.modelId);
    const req: JobRequirements = {
      needs,
      stakes: str(body.stakes) as JobRequirements['stakes'],
      ambiguity: str(body.ambiguity) as JobRequirements['ambiguity'],
      estimatedConfidence: typeof body.estimatedConfidence === 'number' ? body.estimatedConfidence : undefined,
      modality: str(body.modality) as JobRequirements['modality'],
      nuanceSensitive: body.nuanceSensitive === true,
      inputQuality: str(body.inputQuality) as JobRequirements['inputQuality'],
      operatorOverrideModelId: str(body.operatorOverrideModelId),
    };
    const decision = routeByCapability(req, { available: (id) => availableModelIds.includes(id) });
    return c.json({ decision });
  });

  // LandOS-wide structure: department leg tiles + shared surfaces/records/
  // interface layers + War Room preservation/routing contract. Read-only
  // metadata from the structure spine; no DB, no secrets, no external calls.
  app.get('/api/landos/structure', (c) =>
    c.json({
      legs: landosStructureSummary(),
      sharedSurfaces: SHARED_SURFACES,
      sharedRecords: SHARED_RECORDS,
      interfaceLayers: INTERFACE_LAYERS,
      warRoom: warRoomPreservation(),
      warRoomRouting: WAR_ROOM_ROUTING_CONTRACT,
    }),
  );

  // ── Record lists (entity filterable) ───────────────────────────────
  app.get('/api/landos/leads', (c) => {
    const entity = entityParam(c.req.query('entity'));
    return c.json({ leads: listRows('landos_lead', { entity }) });
  });

  app.get('/api/landos/deals', (c) => {
    const entity = entityParam(c.req.query('entity'));
    return c.json({ deals: listRows('landos_deal', { entity }) });
  });

  app.get('/api/landos/dd-queue', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const db = getLandosDb();
    const parcelSql = entity
      ? 'SELECT * FROM landos_parcel WHERE verified = 0 AND entity = ? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM landos_parcel WHERE verified = 0 ORDER BY created_at DESC LIMIT 100';
    const dealSql = entity
      ? `SELECT * FROM landos_deal WHERE status IN ('evaluating','due_diligence') AND entity = ? ORDER BY created_at DESC LIMIT 100`
      : `SELECT * FROM landos_deal WHERE status IN ('evaluating','due_diligence') ORDER BY created_at DESC LIMIT 100`;
    return c.json({
      unverifiedParcels: entity ? db.prepare(parcelSql).all(entity) : db.prepare(parcelSql).all(),
      ddDeals: entity ? db.prepare(dealSql).all(entity) : db.prepare(dealSql).all(),
    });
  });

  app.get('/api/landos/offer-queue', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const db = getLandosDb();
    const dealSql = entity
      ? `SELECT * FROM landos_deal WHERE status IN ('offer_pending','offer_made') AND entity = ? ORDER BY created_at DESC LIMIT 100`
      : `SELECT * FROM landos_deal WHERE status IN ('offer_pending','offer_made') ORDER BY created_at DESC LIMIT 100`;
    const offerApprovals = db
      .prepare(`SELECT * FROM landos_approval WHERE action_type = 'offer_price' AND status = 'pending' ORDER BY created_at DESC LIMIT 100`)
      .all();
    return c.json({
      offerDeals: entity ? db.prepare(dealSql).all(entity) : db.prepare(dealSql).all(),
      pendingOfferApprovals: offerApprovals,
    });
  });

  // ── Approvals ───────────────────────────────────────────────────────
  app.get('/api/landos/approvals', (c) => {
    const status = c.req.query('status');
    return c.json({
      approvals: listApprovals(status && status !== 'all' ? status : undefined),
      gatedActionTypes: GATED_ACTION_TYPES,
    });
  });

  app.post('/api/landos/approvals', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { actionType, title, payload, requestedBy, entity } = body as Record<string, unknown>;
    if (typeof actionType !== 'string' || typeof title !== 'string' || !actionType || !title) {
      return c.json({ error: 'actionType and title are required' }, 400);
    }
    const id = createApproval({
      actionType,
      title,
      payload,
      requestedBy: typeof requestedBy === 'string' ? requestedBy : 'dashboard',
      entity: entityParam(typeof entity === 'string' ? entity : undefined) as never,
    });
    return c.json({ id, status: 'pending' });
  });

  app.post('/api/landos/approvals/:id/approve', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const row = decideApproval(id, 'approved', (body as Record<string, string>).decidedBy || 'tyler', (body as Record<string, string>).note || '');
    if (!row) return c.json({ error: 'Approval not found or not pending' }, 404);
    return c.json({ approval: row });
  });

  app.post('/api/landos/approvals/:id/reject', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const row = decideApproval(id, 'rejected', (body as Record<string, string>).decidedBy || 'tyler', (body as Record<string, string>).note || '');
    if (!row) return c.json({ error: 'Approval not found or not pending' }, 404);
    return c.json({ approval: row });
  });

  // ── Rules & playbooks ───────────────────────────────────────────────
  app.get('/api/landos/rules', (c) => c.json({ rules: listRows('landos_rule') }));

  app.post('/api/landos/rules', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, body: ruleBody, scope, entity, source } = body as Record<string, unknown>;
    if (typeof name !== 'string' || !name) return c.json({ error: 'name is required' }, 400);
    // New rules always enter as draft. Promotion to approved goes through
    // Tyler (raw training never auto-becomes approved behavior).
    const result = getLandosDb().prepare(
      `INSERT INTO landos_rule (entity, scope, name, body, status, source)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
    ).run(
      entityParam(typeof entity === 'string' ? entity : undefined) ?? null,
      typeof scope === 'string' && ['global', 'entity', 'strategy', 'deal'].includes(scope) ? scope : 'global',
      name,
      typeof ruleBody === 'string' ? ruleBody : '',
      typeof source === 'string' ? source : '',
    );
    const id = result.lastInsertRowid as number;
    landosAudit('dashboard', 'rule_created_draft', name, { refTable: 'landos_rule', refId: id });
    return c.json({ id, status: 'draft' });
  });

  app.get('/api/landos/playbooks', (c) => c.json({
    playbooks: listRows('landos_playbook'),
    lifecycle: PLAYBOOK_STAGES,
  }));

  app.post('/api/landos/playbooks', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, body: pbBody, stage, entity, sourceRef } = body as Record<string, unknown>;
    if (typeof name !== 'string' || !name) return c.json({ error: 'name is required' }, 400);
    const stageVal = typeof stage === 'string' && (PLAYBOOK_STAGES as readonly string[]).includes(stage)
      ? stage
      : 'raw_training';
    const result = getLandosDb().prepare(
      `INSERT INTO landos_playbook (entity, name, stage, body, source_ref) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      entityParam(typeof entity === 'string' ? entity : undefined) ?? null,
      name,
      stageVal,
      typeof pbBody === 'string' ? pbBody : '',
      typeof sourceRef === 'string' ? sourceRef : '',
    );
    const id = result.lastInsertRowid as number;
    landosAudit('dashboard', 'playbook_created', `${name} (${stageVal})`, { refTable: 'landos_playbook', refId: id });
    return c.json({ id, stage: stageVal });
  });

  // ── Research & security ─────────────────────────────────────────────
  app.get('/api/landos/research', (c) => {
    const kind = c.req.query('kind');
    const db = getLandosDb();
    const rows = kind && ['market', 'industry', 'ai_change'].includes(kind)
      ? db.prepare('SELECT * FROM landos_research_item WHERE kind = ? ORDER BY created_at DESC LIMIT 200').all(kind)
      : listRows('landos_research_item', { limit: 200 });
    return c.json({ research: rows });
  });

  app.post('/api/landos/research', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { kind, title, body: rBody, sourceUrl, entity } = body as Record<string, unknown>;
    if (typeof title !== 'string' || !title) return c.json({ error: 'title is required' }, 400);
    if (typeof kind !== 'string' || !['market', 'industry', 'ai_change'].includes(kind)) {
      return c.json({ error: 'kind must be market | industry | ai_change' }, 400);
    }
    const result = getLandosDb().prepare(
      `INSERT INTO landos_research_item (kind, entity, title, body, source_url) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      kind,
      entityParam(typeof entity === 'string' ? entity : undefined) ?? null,
      title,
      typeof rBody === 'string' ? rBody : '',
      typeof sourceUrl === 'string' ? sourceUrl : '',
    );
    return c.json({ id: result.lastInsertRowid as number });
  });

  app.get('/api/landos/security-reviews', (c) => c.json({
    reviews: listRows('landos_security_review'),
  }));

  app.post('/api/landos/security-reviews', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { subjectType, subject, verdict, notes, reviewer } = body as Record<string, unknown>;
    if (typeof subject !== 'string' || !subject) return c.json({ error: 'subject is required' }, 400);
    const result = getLandosDb().prepare(
      `INSERT INTO landos_security_review (subject_type, subject, verdict, notes, reviewer) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      typeof subjectType === 'string' ? subjectType : '',
      subject,
      typeof verdict === 'string' ? verdict : 'pending',
      typeof notes === 'string' ? notes : '',
      typeof reviewer === 'string' ? reviewer : '',
    );
    const id = result.lastInsertRowid as number;
    landosAudit('dashboard', 'security_review_created', subject, { refTable: 'landos_security_review', refId: id });
    return c.json({ id });
  });

  // ── Costs & audit ───────────────────────────────────────────────────
  app.get('/api/landos/costs', (c) => {
    const db = getLandosDb();
    const modelCalls = listRows('landos_model_call', { limit: 100 });
    const costRecords = listRows('landos_cost_record', { limit: 100 });
    const modelTotal = db.prepare('SELECT COALESCE(SUM(est_cost_usd), 0) AS s, COUNT(*) AS n FROM landos_model_call').get() as { s: number; n: number };
    const costTotal = db.prepare('SELECT COALESCE(SUM(amount_usd), 0) AS s, COUNT(*) AS n FROM landos_cost_record').get() as { s: number; n: number };
    return c.json({
      modelCalls,
      costRecords,
      totals: {
        modelCalls: modelTotal.n,
        modelCostUsd: modelTotal.s,
        costRecords: costTotal.n,
        costRecordsUsd: costTotal.s,
      },
    });
  });

  app.get('/api/landos/audit', (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
    return c.json({ audit: listLandosAudit(limit), total: countRows('landos_audit_log') });
  });

  // ── Read-only config surfaces (rubric + offer strategies) ──────────
  app.get('/api/landos/rubric', (c) => c.json({
    source: RUBRIC_SOURCE,
    status: RUBRIC_STATUS,
    factors: RUBRIC_FACTORS,
    verdictTiers: VERDICT_TIERS,
  }));

  app.get('/api/landos/strategies', (c) => c.json({ strategies: STRATEGIES }));

  // ── Property Card / Property Memory ─────────────────────────────────
  // The property-centered source of truth. Every Duke property-address run
  // creates or updates a card. Identity is never inferred from coordinates.

  app.get('/api/landos/property-cards', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const ks = c.req.query('kanbanStatus');
    const vs = c.req.query('verificationStatus');
    const cards = withPropertyWorkspaceSummary(suppressWeakerDuplicatePropertyCards(listPropertyCards({
      entity,
      kanbanStatus: (KANBAN_STATUSES as readonly string[]).includes(ks ?? '') ? (ks as KanbanStatus) : undefined,
      verificationStatus: (CARD_VERIFICATION_STATUSES as readonly string[]).includes(vs ?? '') ? (vs as CardVerificationStatus) : undefined,
    })));
    return c.json({
      cards,
    });
  });

  // Kanban board: cards grouped by status column (property-centered). Each card
  // is a CONCISE pipeline summary of a Deal Card — never a second property
  // intelligence surface. deal_card_id lets a click open the canonical Deal Card.
  app.get('/api/landos/board', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const cards = withBoardSummary(withPropertyWorkspaceSummary(suppressWeakerDuplicatePropertyCards(listPropertyCards({ entity, limit: 500 }))));
    const columns: Record<string, unknown[]> = {};
    for (const s of KANBAN_STATUSES) columns[s] = [];
    for (const card of cards) columns[(card as { kanban_status: string }).kanban_status]?.push(card);
    return c.json({ columns, statuses: KANBAN_STATUSES });
  });

  // Resolve-or-create the canonical Deal Card for a property card. The Property
  // Board calls this on click so it ALWAYS lands on the single Deal Card
  // workspace. Creating/linking a Deal Card never changes the property's
  // identity, verification status, or facts (see ensureDealCardForProperty).
  app.get('/api/landos/property-cards/:id/deal-card', (c) => {
    const id = Number(c.req.param('id'));
    const card = getPropertyCard(id);
    if (!card) return c.json({ error: 'not found' }, 404);
    const dealCardId = ensureDealCardForProperty({ cardId: id, entity: card.entity as LandosEntity, title: card.active_input_address });
    return c.json({ dealCardId });
  });

  app.get('/api/landos/property-cards/:id', (c) => {
    const card = getPropertyCard(Number(c.req.param('id')));
    if (!card) return c.json({ error: 'not found' }, 404);
    return c.json({ card });
  });

  // Create/update a card from a Duke property-address run. Body carries the
  // identity + verification the agent established. No live LP call here.
  app.post('/api/landos/property-cards', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = body.entity;
    if (!isEntity(entity)) return c.json({ error: 'entity must be LAND_ALLY or TY_LAND_BIZ' }, 400);
    const activeInputAddress = str(body.activeInputAddress);
    if (!activeInputAddress || !activeInputAddress.trim()) {
      return c.json({ error: 'activeInputAddress required' }, 400);
    }
    try {
      const result = upsertCardFromDukeRun({
        entity,
        agentId: str(body.agentId),
        activeInputAddress,
        city: str(body.city),
        county: str(body.county),
        state: str(body.state),
        apn: str(body.apn),
        lpPropertyId: str(body.lpPropertyId),
        fips: str(body.fips),
        lpUrl: str(body.lpUrl),
        owner: str(body.owner),
        acres: num(body.acres),
        lat: num(body.lat),
        lng: num(body.lng),
        verified: body.verified === true,
        verificationSource: str(body.verificationSource),
        summary: str(body.summary),
        priorInputAddress: str(body.priorInputAddress),
        cardId: num(body.cardId),
      });
      return c.json({ card: result.card, created: result.created, warnings: result.warnings }, result.created ? 201 : 200);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'upsert failed' }, 400);
    }
  });

  // PATCH handles WORKFLOW changes only. It can move the kanban status freely,
  // and it can reject/archive a card (with a reason, audited). It can NEVER
  // directly promote a card to verified_property — that requires strong parcel
  // identity evidence through POST /property-cards — and it never downgrades a
  // verified card to a non-terminal status or erases identity evidence.
  app.patch('/api/landos/property-cards/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    let updated;
    if (body.kanbanStatus !== undefined) {
      if (!(KANBAN_STATUSES as readonly string[]).includes(String(body.kanbanStatus))) {
        return c.json({ error: 'invalid kanbanStatus' }, 400);
      }
      updated = setCardKanbanStatus(id, body.kanbanStatus as KanbanStatus);
      if (!updated) return c.json({ error: 'not found' }, 404);
    }
    if (body.verificationStatus !== undefined) {
      const vs = String(body.verificationStatus);
      if (vs === 'verified_property' || vs === 'unverified_lead' || vs === 'address_matched') {
        return c.json({
          error: 'verification_status cannot be promoted or downgraded via PATCH. Provide strong parcel identity evidence (APN + county/state/FIPS, or LandPortal property id + FIPS) via POST /api/landos/property-cards.',
        }, 400);
      }
      // Only rejected_mismatch / archived are allowed here, with a reason.
      const incomingLat = num(body.incomingLat);
      const incomingLng = num(body.incomingLng);
      const result = setCardVerificationStatus(id, vs as CardVerificationStatus, str(body.actor) ?? 'tyler', str(body.reason) ?? '', {
        instruction: str(body.instruction) ?? str(body.reason) ?? '',
        incomingAddress: str(body.incomingAddress),
        incomingApn: str(body.incomingApn),
        incomingCounty: str(body.incomingCounty),
        incomingState: str(body.incomingState),
        incomingCoordinates: incomingLat != null && incomingLng != null ? { lat: incomingLat, lng: incomingLng } : null,
        incomingParcelGeometryKey: str(body.incomingParcelGeometryKey),
        externalNormalizedAddress: str(body.externalNormalizedAddress),
        operatorCorrection: body.operatorCorrection === true,
      });
      if (result.error) {
        return c.json({ error: result.error }, result.error === 'not found' ? 404 : 400);
      }
      updated = result.card;
    }
    if (!updated) return c.json({ error: 'no valid field (use kanbanStatus, or verificationStatus=rejected_mismatch|archived with a reason)' }, 400);
    return c.json({ card: updated });
  });

  // Attach a Nearby Search Reference (verified subject parcel only). Never
  // identity/offer-usable; never the subject parcel address.
  app.post('/api/landos/property-cards/:id/nearby-reference', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(body.address)) return c.json({ error: 'address required' }, 400);
    const result = attachNearbySearchReference({
      cardId: id,
      address: str(body.address)!,
      relationship: str(body.relationship) as never,
      sourceLink: str(body.sourceLink),
      note: str(body.note),
      dateAccessed: str(body.dateAccessed),
    });
    if (result.error) {
      return c.json({ error: result.error, label: result.label }, result.error === 'card not found' ? 404 : 400);
    }
    return c.json(result, 201);
  });

  app.post('/api/landos/property-cards/:id/source-evidence', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(body.fact)) return c.json({ error: 'fact required' }, 400);
    const res = attachCardSourceEvidence({
      cardId: id,
      fact: str(body.fact)!,
      value: str(body.value),
      sourceUrl: str(body.sourceUrl),
      sourceLabel: str(body.sourceLabel),
      dateAccessed: str(body.dateAccessed),
      note: str(body.note),
      parcelVerified: body.parcelVerified === true,
    });
    return c.json(res, 201);
  });

  app.post('/api/landos/property-cards/:id/activity', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const evId = attachCardActivity({
      cardId: id,
      agentId: str(body.agentId) ?? 'tyler',
      kind: str(body.kind) ?? 'note',
      summary: str(body.summary) ?? '',
      ref: str(body.ref),
    });
    return c.json({ id: evId }, 201);
  });

  // Deal Card activity timeline — the real recorded events for this card (report
  // runs, visual intelligence/capture, comp research, inspections, notes, stage
  // moves), newest first. Resolves the property card behind the deal. Never faked.
  app.get('/api/landos/deal-cards/:id/activity', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    const events = cardId ? getCardActivity(cardId) : [];
    return c.json({ dealId: id, cardId: cardId ?? null, events });
  });

  app.post('/api/landos/property-cards/:id/next-action', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(body.action)) return c.json({ error: 'action required' }, 400);
    const naId = addCardNextAction({ cardId: id, action: str(body.action)!, createdBy: str(body.createdBy) });
    return c.json({ id: naId }, 201);
  });

  // ── Batch lead intake ───────────────────────────────────────────────
  app.post('/api/landos/lead-jobs', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = body.entity;
    if (!isEntity(entity)) return c.json({ error: 'entity must be LAND_ALLY or TY_LAND_BIZ' }, 400);
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const { batchId, jobs } = createLeadJobs({ entity, text, agentId: str(body.agentId) });
    return c.json({ batchId, jobs, count: jobs.length }, 201);
  });

  app.get('/api/landos/lead-jobs', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const status = c.req.query('status');
    const batchId = c.req.query('batchId') || undefined;
    return c.json({
      jobs: listLeadJobs({
        entity,
        batchId,
        status: (LEAD_JOB_STATUSES as readonly string[]).includes(status ?? '') ? (status as LeadJobStatus) : undefined,
      }),
    });
  });

  app.patch('/api/landos/lead-jobs/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.status !== undefined && !(LEAD_JOB_STATUSES as readonly string[]).includes(String(body.status))) {
      return c.json({ error: 'invalid status' }, 400);
    }
    const updated = updateLeadJob(id, {
      status: body.status as LeadJobStatus | undefined,
      cardId: num(body.cardId),
      resultSummary: str(body.resultSummary),
      nextAction: str(body.nextAction),
      error: str(body.error),
    });
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ job: updated });
  });

  // ── Deal Cards (the user-facing object) ─────────────────────────────
  app.get('/api/landos/deal-cards', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const status = c.req.query('status');
    const dealCards = listDealCards({
      entity,
      status: (DEAL_CARD_STATUSES as readonly string[]).includes(status ?? '') ? (status as DealCardStatus) : undefined,
    });
    // Attach a lightweight DD report summary per row (completeness chip on the
    // list/board). Read-only; no provider call.
    const withSummary = dealCards.map((d) => ({
      ...(d as unknown as Record<string, unknown>),
      reportSummary: getDealCardReportSummary((d as { id: number }).id),
    }));
    return c.json({ dealCards: withSummary });
  });

  // Trash / Deleted Deal Cards view. Registered BEFORE '/deal-cards/:id' so the
  // literal 'trash' segment is not captured as an id. Soft-deleted cards only.
  app.get('/api/landos/deal-cards/trash', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const dealCards = listTrashedDealCards({ entity }).map((d) => ({
      ...(d as unknown as Record<string, unknown>),
      reportSummary: getDealCardReportSummary((d as { id: number }).id),
    }));
    return c.json({ dealCards });
  });

  app.get('/api/landos/deal-cards/:id', (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    // Canonical Business Object Spine projection (authoritative decision-grade
    // header). Guarded so a projection issue can never break the Deal Card read.
    let businessSpine: ReturnType<typeof assembleBusinessObjects> | undefined;
    try { businessSpine = assembleBusinessObjects(id); } catch { businessSpine = undefined; }
    return c.json({ dealCard: deal, businessSpine, header: businessSpine?.header });
  });

  // Executive Command / Jarvis-Neo: "What is blocking this deal, and who owns
  // the next action?" — answered from the canonical objects, not a report.
  app.get('/api/landos/deal-cards/:id/blockers', (c) => {
    const answer = whatBlocksThisDeal(Number(c.req.param('id')));
    if (!answer) return c.json({ error: 'not found' }, 404);
    return c.json({ blockers: answer });
  });

  // Market Pulse v1 — concise real read: is the area growing/stable/declining
  // (Census growth when the free key is configured), what land goes for per acre
  // in the county / near the ZIP (from retained comps), and a plain-English read.
  // Area-level context: works even when the parcel is unverified. No paid call.
  app.get('/api/landos/deal-cards/:id/market-pulse', async (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const cards = (Array.isArray(deal.propertyCards) ? deal.propertyCards : []) as Array<Record<string, unknown>>;
    const subj = (cards.find((x) => x.role === 'subject') ?? cards[0]) as Record<string, unknown> | undefined;
    const dd = getDealCardDd(id);
    const addr = str(subj?.active_input_address) ?? '';
    // Single-truth comps: prefer the persisted report's sold band (the same 17
    // comps the valuation uses) so the pulse's county $/ac can never quote a
    // different number than the Preliminary Valuation panel. Fall back to the
    // retained landos_comp rows only when no report comps exist.
    const persistedReport = getDealCardReport(id);
    // ONLY the sold band rows — the exact set the valuation's median is computed
    // from — so the pulse's county $/ac equals the valuation's $/ac.
    const reportSold = persistedReport.marketComps?.sold ?? [];
    const comps: PulseComp[] = reportSold.length
      ? reportSold.map((r) => ({
          pricePerAcre: r.pricePerAcre ?? null, price: r.price ?? null, acres: r.acres ?? null,
          zip: extractZipCandidate(String(r.addressDesc || '')) ?? null,
        }))
      : listComps({ dealCardId: id }).map((r) => ({
          pricePerAcre: r.price_per_acre, price: r.price, acres: r.acres,
          zip: extractZipCandidate(String(r.address_desc || '')) ?? null,
        }));
    // The parcel-attributed ("Parcel Verified") pulse is gated on the AUTHORITATIVE
    // ConfirmedParcel capability, not the legacy card flag. A Candidate parcel still
    // gets honest, clearly-labeled AREA context (usable unresolved leads), never
    // parcel-attributed market data.
    const areaInput = {
      city: str(subj?.city) || undefined,
      county: str(subj?.county) || dd.county || undefined,
      state: str(subj?.state) || dd.state || undefined,
      zip: extractZipCandidate(addr),
      fips: str(subj?.fips) || undefined,
      comps,
    };
    const confirmed = confirmParcelForDeal(id);
    const marketPulse = confirmed
      ? await fetchConfirmedParcelMarketPulse(confirmed, areaInput)
      : await fetchAreaMarketContext(areaInput);
    // Single valuation story: when the report computed a sold-band median (the
    // basis of the Preliminary Valuation), the pulse quotes THAT number — never
    // a different median recomputed over a wider comp set.
    const bandMedian = persistedReport.marketComps?.metrics?.soldMedianPpa ?? null;
    const bandCount = persistedReport.marketComps?.soldCount ?? 0;
    // "Land is generally going for" is a market claim — never quoted from fewer
    // than 3 closed sales. A thin band is stated as thin, not as a market price.
    if (bandMedian != null && bandCount >= 3) {
      const before = marketPulse.countyPricePerAcre?.medianPpa;
      marketPulse.countyPricePerAcre = {
        status: 'measured',
        medianPpa: bandMedian,
        sampleSize: bandCount,
        source: 'Sold land comps (valuation band)',
        note: `County: median $${bandMedian.toLocaleString('en-US')}/acre from ${bandCount} retained closed sales — market context only. Whether any valuation basis exists is decided by the Deal Card's shared pricing gate and value readiness, never by a computable median alone.`,
      };
      if (before != null && before !== bandMedian) {
        marketPulse.plainEnglish = marketPulse.plainEnglish.replace(
          /Land is generally going for about \$[\d,]+\/acre in the county \(median of \d+ comps?\)\./,
          `Land is generally going for about $${bandMedian.toLocaleString('en-US')}/acre in the county (median of ${bandCount} retained closed sales — market context only; the shared value readiness on this card decides whether any valuation exists).`,
        );
      }
    } else if (bandMedian != null && bandCount > 0) {
      marketPulse.plainEnglish = marketPulse.plainEnglish.replace(
        /Land is generally going for about \$[\d,]+\/acre in the county \(median of \d+ comps?\)\./,
        `Only ${bandCount} closed land sale(s) validated so far — not enough to quote a county price; comp research continues.`,
      );
    }
    return c.json({ marketPulse, parcelConfirmed: !!confirmed });
  });

  // ── Market Scan: Data Center Watch + land-relevant growth signals ─────────
  // Auto-run existence check (never a deep investigation), cached per card for
  // 7 days so opening the Market tab never re-spends a search. Uses the
  // configured Gemini key with Google Search grounding when present; degrades
  // honestly (not_run + no fabrication) when no search source is configured.
  const groundedScanSearch = (): ScanSearchFn | null => {
    if (!PROVIDER_PRESENCE.google) return null;
    return async (query: string): Promise<ScanFinding[]> => {
      const { generateGroundedContent, parseJsonResponse } = await import('../gemini.js');
      const prompt =
        `Search the web for: ${query}\n\n` +
        'Return ONLY a JSON array (no prose, no markdown fences) of up to 8 findings from the search results: ' +
        '[{"title": string, "summary": string (1-2 sentences, factual), "url": string|null, "year": number|null (publication year)}]. ' +
        'Only include findings that actually appeared in the search results; return [] when nothing relevant exists. Never invent a finding.';
      const text = await generateGroundedContent(prompt);
      const parsed = parseJsonResponse<ScanFinding[]>(text);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((f) => f && typeof f.title === 'string');
    };
  };

  app.get('/api/landos/deal-cards/:id/market-scan', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const cards = (Array.isArray(deal.propertyCards) ? deal.propertyCards : []) as Array<Record<string, unknown>>;
    const subj = (cards.find((x) => x.role === 'subject') ?? cards[0]) as Record<string, unknown> | undefined;
    const dd = getDealCardDd(id);
    const county = str(subj?.county) || dd.county || undefined;
    const state = str(subj?.state) || dd.state || undefined;
    const MAX_AGE_S = 7 * 24 * 3600;
    const cached = loadMarketScan<MarketScanResult>(id, 'market_scan');
    const refresh = c.req.query('refresh') === '1';
    const isAnswered = (p?: MarketScanResult | null) =>
      !!p && ['found', 'none_found'].some((s) => p.dataCenterWatch?.status === s || p.growthSignals?.status === s);
    const fresh = !!cached && Math.floor(Date.now() / 1000) - cached.createdAt < MAX_AGE_S && isAnswered(cached.payload);
    if (cached && fresh && !refresh) return c.json({ marketScan: cached.payload, cached: true });
    let scan: MarketScanResult;
    try {
      scan = await runMarketScan({ county, state, search: groundedScanSearch() });
    } catch (err) {
      logger.warn({ err, dealCardId: id }, 'market_scan_failed');
      return c.json({ marketScan: cached?.payload ?? null, cached: !!cached, error: 'market scan failed' });
    }
    // Persist ONLY real answers (found / none_found). An unavailable scan (e.g.
    // search quota) is returned honestly but never cached — the next open
    // retries instead of pinning "unavailable" for a week.
    const answered = (s: string) => s === 'found' || s === 'none_found';
    const ran = answered(scan.dataCenterWatch.status) || answered(scan.growthSignals.status);
    if (ran) {
      saveMarketScan(id, 'market_scan', scan);
      return c.json({ marketScan: scan, cached: false });
    }
    // Not answered this time — serve any prior REAL answer; else the honest
    // unavailable/not_run result (uncached).
    const cachedAnswered = cached && (answered((cached.payload as MarketScanResult).dataCenterWatch?.status) || answered((cached.payload as MarketScanResult).growthSignals?.status));
    return c.json({ marketScan: cachedAnswered ? cached!.payload : scan, cached: !!cachedAnswered });
  });

  // Resolution view data — the Property Resolution trace for a NOT-yet-confirmed
  // parcel. Returns the persisted ParcelIdentity state + the resolution snapshot
  // (what LandOS understood, sources searched, candidates + accept/reject, what's
  // missing, smallest next identifier). The UI shows this INSTEAD of a
  // half-populated Deal Card until the parcel is confirmed.
  app.get('/api/landos/deal-cards/:id/resolution', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const subject = (deal.propertyCards?.[0] ?? {}) as { verification_status?: string | null };
    const identity = readParcelIdentity(id);
    const snapshot = readResolutionSnapshot(id);
    const confirmed = subject.verification_status === 'verified_property'
      && ((identity?.state === 'confirmed') || (assembleBusinessObjects(id)?.confirmedParcel != null));
    return c.json({ parcelIdentity: identity, snapshot, confirmed });
  });

  // Public-records research plan — the prioritized official county sources to
  // check (GIS / assessor / appraisal district / tax / NETR) + the next
  // verification action. Sources to CHECK, never facts.
  app.get('/api/landos/deal-cards/:id/research-plan', (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const cards = (Array.isArray(deal.propertyCards) ? deal.propertyCards : []) as Array<Record<string, unknown>>;
    const subj = (cards.find((x) => x.role === 'subject') ?? cards[0]) as Record<string, unknown> | undefined;
    const dd = getDealCardDd(id);
    const spine = assembleBusinessObjects(id);
    const pkt = spine?.propertyIntelligence;
    const researchPlan = buildPublicRecordsResearchPlan({
      county: str(subj?.county) || dd.county || undefined,
      state: str(subj?.state) || dd.state || undefined,
      city: str(subj?.city) || undefined,
      apn: str(subj?.apn) || dd.apn || undefined,
      owner: str(subj?.owner) || undefined,
      address: str(subj?.active_input_address) || undefined,
      known: pkt ? { owner: pkt.owner.known, apn: pkt.apn.known, acreage: pkt.acreage.known, parcelIdentity: pkt.parcelIdentityVerified } : undefined,
    });
    return c.json({ researchPlan });
  });

  // Acquisition lane (Lead -> DD Report -> Discovery Call -> [Deeper DD] ->
  // Underwriting -> Offer). Derived read-only from existing Deal Card state; no
  // schema change. Discovery/underwriting/offer signals that aren't yet persisted
  // can be previewed via query params; otherwise they show as pending.
  app.get('/api/landos/deal-cards/:id/lane', (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id) as (Record<string, unknown> | undefined);
    if (!deal) return c.json({ error: 'not found' }, 404);
    let reportReady = false;
    try { reportReady = !!getDealCardReport(id); } catch { reportReady = false; }
    const snap: DealLaneSnapshot = {
      hasCard: true,
      ddReportReady: reportReady,
      parcelVerified: deal.hasVerifiedProperty === true,
      discoveryCallSummary: c.req.query('discoveryCallSummary') ?? null,
      usingDeeperDd: c.req.query('usingDeeperDd') === '1',
      deeperDdComplete: c.req.query('deeperDdComplete') === '1',
      offerRecorded: c.req.query('offerRecorded') === '1',
    };
    return c.json({ lane: computeDealLane(snap) });
  });

  // Run operational underwriting for a Deal Card (post-discovery offer approver).
  // Deterministic gate — NO model approves an offer; no paid calls. Server supplies
  // parcelVerified; the operator/dashboard supplies post-call inputs in the body.
  // Returns the decision + an underwriting_snapshot event (caller persists/attaches).
  app.post('/api/landos/deal-cards/:id/underwrite', async (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id) as (Record<string, unknown> | undefined);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // Underwriting (the offer approver) runs ONLY from the AUTHORITATIVE
    // ConfirmedParcel the Property Intelligence packet mints — never the legacy
    // hasVerifiedProperty card flag.
    const confirmedParcel = assembleBusinessObjects(id)?.confirmedParcel ?? null;
    const uwInput = {
      apn: String(id),
      expectedValueUsd: typeof body.expectedValueUsd === 'number' ? body.expectedValueUsd : null,
      strategyLanes: Array.isArray(body.strategyLanes) ? (body.strategyLanes as UnderwritingStrategyLane[]) : [],
      discoveryCallSummary: str(body.discoveryCallSummary) ?? null,
      newDisclosures: Array.isArray(body.newDisclosures) ? (body.newDisclosures as string[]) : [],
      sellerNotes: str(body.sellerNotes) ?? null,
      knownConstraints: Array.isArray(body.knownConstraints) ? (body.knownConstraints as string[]) : [],
      compsAttached: body.compsAttached === true,
      marketFactsAttached: body.marketFactsAttached === true,
    };
    const decision = confirmedParcel
      ? underwriteConfirmedParcel(confirmedParcel, uwInput)
      : blockedUnderwriting(uwInput);
    return c.json({ decision });
  });

  // Create a Deal Card (operator-facing). Local file-backed SQLite only: no
  // external CRM/GHL write, no paid calls, no parcel identity (that lives on
  // Property Cards). Returns the full detail so the UI can render it directly.
  app.post('/api/landos/deal-cards', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = body.entity;
    if (!isEntity(entity)) return c.json({ error: 'entity must be LAND_ALLY or TY_LAND_BIZ' }, 400);
    const statusRaw = str(body.status);
    if (statusRaw !== undefined && !(DEAL_CARD_STATUSES as readonly string[]).includes(statusRaw)) {
      return c.json({ error: 'invalid status' }, 400);
    }
    const leadTypeRaw = str(body.leadType);
    const created = createDealCard({
      entity,
      title: str(body.title),
      status: statusRaw as DealCardStatus | undefined,
      sellerNotes: str(body.sellerNotes),
      askingPrice: num(body.askingPrice),
      combinedStrategy: str(body.combinedStrategy),
      packageNotes: str(body.packageNotes),
      leadType: isLeadType(leadTypeRaw) ? leadTypeRaw : undefined,
    });
    return c.json({ dealCard: getDealCard(created.id) }, 201);
  });

  // Update an EXISTING Deal Card's deal-level fields. Same record (never a
  // duplicate). Deal-level only — parcel identity/verification is untouched.
  app.patch('/api/landos/deal-cards/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const statusRaw = str(body.status);
    if (statusRaw !== undefined && !(DEAL_CARD_STATUSES as readonly string[]).includes(statusRaw)) {
      return c.json({ error: 'invalid status' }, 400);
    }
    const updated = updateDealCard(id, {
      title: str(body.title),
      status: statusRaw as DealCardStatus | undefined,
      sellerNotes: str(body.sellerNotes),
      askingPrice: num(body.askingPrice),
      combinedStrategy: str(body.combinedStrategy),
      packageNotes: str(body.packageNotes),
    });
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ dealCard: getDealCard(id) });
  });

  // Soft delete → move a Deal Card to Trash. It disappears from normal boards/lists
  // but is fully restorable from the Trash view. Reversible; nothing is purged.
  app.delete('/api/landos/deal-cards/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const row = softDeleteDealCard(id);
    if (!row) return c.json({ error: 'not found' }, 404);
    landosAudit('dashboard', 'deal_card_trashed', `deal ${id}`, { refTable: 'landos_deal_card', refId: id });
    return c.json({ ok: true, dealCardId: id, deletedAt: row.deleted_at });
  });

  // Restore a Deal Card from Trash (clears the soft delete).
  app.post('/api/landos/deal-cards/:id/restore', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const row = restoreDealCard(id);
    if (!row) return c.json({ error: 'not found' }, 404);
    landosAudit('dashboard', 'deal_card_restored', `deal ${id}`, { refTable: 'landos_deal_card', refId: id });
    return c.json({ ok: true, dealCard: getDealCard(id) });
  });

  // PERMANENT delete — irreversible. Only allowed from Trash (the card must already
  // be soft-deleted); the operator confirms a second time in the UI. Removes the
  // deal card and all deal-scoped rows. Never auto-invoked.
  app.delete('/api/landos/deal-cards/:id/permanent', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const existing = getDealCard(id);
    if (!existing) return c.json({ error: 'not found' }, 404);
    if ((existing as { deleted_at?: number | null }).deleted_at == null) {
      return c.json({ error: 'move the card to Trash before deleting it permanently' }, 409);
    }
    const removed = hardDeleteDealCard(id);
    if (!removed) return c.json({ error: 'not found' }, 404);
    landosAudit('dashboard', 'deal_card_permanently_deleted', `deal ${id} (irreversible)`, { refTable: 'landos_deal_card', refId: id });
    return c.json({ ok: true, dealCardId: id, permanentlyDeleted: true });
  });

  // ── Deal Card DD/Research worksheet (manual/local; labeled confidence) ──
  // A safe local landing place for the Due Diligence + Research leg. Every
  // parcel fact carries a confidence label; parcel identity defaults to
  // local-area-context and is never inferred from coordinates/proximity. No
  // external CRM/GHL, no paid/LandPortal calls.
  app.get('/api/landos/deal-cards/:id/dd', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    return c.json({
      dd: getDealCardDd(id),
      fieldLabels: DD_FIELD_LABELS,
      parcelIdentityStatuses: DD_PARCEL_IDENTITY_STATUSES,
    });
  });

  app.put('/api/landos/deal-cards/:id/dd', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ddLabel = (v: unknown): DdFieldLabel | undefined =>
      (DD_FIELD_LABELS as readonly string[]).includes(str(v) ?? '') ? (v as DdFieldLabel) : undefined;
    const identity = (v: unknown): DdParcelIdentityStatus | undefined =>
      (DD_PARCEL_IDENTITY_STATUSES as readonly string[]).includes(str(v) ?? '') ? (v as DdParcelIdentityStatus) : undefined;
    const strList = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const linkList = (v: unknown): DealCardSourceLink[] | undefined =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).url === 'string')
            .map((x) => ({ label: str(x.label) ?? '', url: String(x.url) }))
        : undefined;
    // acreage may be explicitly cleared (null) or set to a number.
    const acreage =
      'acreage' in body ? (body.acreage === null ? null : num(body.acreage) ?? null) : undefined;
    const patch: DealCardDdPatch = {
      parcelIdentityStatus: identity(body.parcelIdentityStatus),
      apn: str(body.apn),
      apnLabel: ddLabel(body.apnLabel),
      county: str(body.county),
      state: str(body.state),
      locationLabel: ddLabel(body.locationLabel),
      acreage,
      acreageLabel: ddLabel(body.acreageLabel),
      zoning: str(body.zoning),
      zoningLabel: ddLabel(body.zoningLabel),
      accessStatus: str(body.accessStatus),
      accessLabel: ddLabel(body.accessLabel),
      utilitiesStatus: str(body.utilitiesStatus),
      utilitiesLabel: ddLabel(body.utilitiesLabel),
      floodStatus: str(body.floodStatus),
      floodLabel: ddLabel(body.floodLabel),
      wetlandsStatus: str(body.wetlandsStatus),
      wetlandsLabel: ddLabel(body.wetlandsLabel),
      roadFrontageNotes: str(body.roadFrontageNotes),
      sourceLinks: linkList(body.sourceLinks),
      dataGaps: strList(body.dataGaps),
      riskFlags: strList(body.riskFlags),
      notes: str(body.notes),
      updatedBy: str(body.updatedBy),
    };
    const result = upsertDealCardDd(id, patch);
    if (!result) return c.json({ error: 'deal card not found' }, 404);
    return c.json(result);
  });

  // ── Deal Card Strategy worksheet (manual/local; honest readiness) ──────
  // A safe local landing place for the Strategy leg. Manual/local strategy
  // analysis only: candidates, recommendation, most viable exit, blockers, next
  // confirmations, distinct per-strategy notes, and an honest offer-readiness
  // label that defaults to 'not_reviewed'. Computes no offer/comp/EV and keeps
  // every exit strategy distinct. No external CRM/GHL, no paid/LandPortal calls.
  app.get('/api/landos/deal-cards/:id/strategy', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    return c.json({
      strategy: getDealCardStrategy(id),
      offerReadinessLabels: STRATEGY_OFFER_READINESS,
    });
  });

  app.put('/api/landos/deal-cards/:id/strategy', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const readiness = (v: unknown): StrategyOfferReadiness | undefined =>
      (STRATEGY_OFFER_READINESS as readonly string[]).includes(str(v) ?? '') ? (v as StrategyOfferReadiness) : undefined;
    const strList = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const patch: DealCardStrategyPatch = {
      offerReadiness: readiness(body.offerReadiness),
      strategyCandidates: strList(body.strategyCandidates),
      blockers: strList(body.blockers),
      nextConfirmations: strList(body.nextConfirmations),
      currentRecommendation: str(body.currentRecommendation),
      mostViableStrategy: str(body.mostViableStrategy),
      preCallStrategyNotes: str(body.preCallStrategyNotes),
      quickFlipNotes: str(body.quickFlipNotes),
      subdivideNotes: str(body.subdivideNotes),
      landHomePackageNotes: str(body.landHomePackageNotes),
      improvedValueAddNotes: str(body.improvedValueAddNotes),
      teardownLandOnlyNotes: str(body.teardownLandOnlyNotes),
      passNoOfferReason: str(body.passNoOfferReason),
      riskAdjustedNotes: str(body.riskAdjustedNotes),
      targetProfitNote: str(body.targetProfitNote),
      notes: str(body.notes),
      updatedBy: str(body.updatedBy),
    };
    const result = upsertDealCardStrategy(id, patch);
    if (!result) return c.json({ error: 'deal card not found' }, 404);
    return c.json(result);
  });

  // ── Deal Card Market Research worksheet (manual/local; market-level only) ──
  // A safe local landing place for the Market Research leg. MARKET-LEVEL context
  // only: target area, county/city/region notes, demand notes (with honest
  // demand labels), active/sold/days-on-market context notes, county growth /
  // planning notes, exit-strategy support notes, source links + confidence, data
  // gaps, and risk flags. This is NOT property-level DD and never verifies parcel
  // identity. No comps, actives, solds, days-on-market, demand, or pricing are
  // computed or fabricated. No external CRM/GHL, no paid/LandPortal calls.
  app.get('/api/landos/deal-cards/:id/market', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    return c.json({
      market: getDealCardMarket(id),
      demandLabels: MARKET_DEMAND_LABELS,
      sourceConfidenceLabels: MARKET_SOURCE_CONFIDENCE,
    });
  });

  app.put('/api/landos/deal-cards/:id/market', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const demand = (v: unknown): MarketDemandLabel | undefined =>
      (MARKET_DEMAND_LABELS as readonly string[]).includes(str(v) ?? '') ? (v as MarketDemandLabel) : undefined;
    const confidence = (v: unknown): MarketSourceConfidence | undefined =>
      (MARKET_SOURCE_CONFIDENCE as readonly string[]).includes(str(v) ?? '') ? (v as MarketSourceConfidence) : undefined;
    const strList = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const linkList = (v: unknown): DealCardSourceLink[] | undefined =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).url === 'string')
            .map((x) => ({ label: str(x.label) ?? '', url: String(x.url) }))
        : undefined;
    const patch: DealCardMarketPatch = {
      marketReviewStatus: demand(body.marketReviewStatus),
      targetAreaLabel: str(body.targetAreaLabel),
      countyCityRegionNotes: str(body.countyCityRegionNotes),
      buyerDemandNotes: str(body.buyerDemandNotes),
      buyerDemandLabel: demand(body.buyerDemandLabel),
      activeListingNotes: str(body.activeListingNotes),
      soldCompContextNotes: str(body.soldCompContextNotes),
      daysOnMarketNotes: str(body.daysOnMarketNotes),
      manufacturedHomeDemandNotes: str(body.manufacturedHomeDemandNotes),
      manufacturedHomeDemandLabel: demand(body.manufacturedHomeDemandLabel),
      subdivisionDemandNotes: str(body.subdivisionDemandNotes),
      subdivisionDemandLabel: demand(body.subdivisionDemandLabel),
      infillLotDemandNotes: str(body.infillLotDemandNotes),
      infillLotDemandLabel: demand(body.infillLotDemandLabel),
      ruralAcreageDemandNotes: str(body.ruralAcreageDemandNotes),
      ruralAcreageDemandLabel: demand(body.ruralAcreageDemandLabel),
      countyGrowthPlanningNotes: str(body.countyGrowthPlanningNotes),
      exitStrategySupportNotes: str(body.exitStrategySupportNotes),
      sourceLinks: linkList(body.sourceLinks),
      sourceConfidence: confidence(body.sourceConfidence),
      dataGaps: strList(body.dataGaps),
      riskFlags: strList(body.riskFlags),
      notes: str(body.notes),
      updatedBy: str(body.updatedBy),
    };
    const result = upsertDealCardMarket(id, patch);
    if (!result) return c.json({ error: 'deal card not found' }, 404);
    return c.json(result);
  });

  // ── Deal Card DD + Market + Strategy operational report ─────────────────
  // The operational workflow: from one Deal Card action it runs the EXISTING
  // safe, non-credit LandPortal exact resolve (NEVER a comp credit, NEVER a comp
  // report tool), structures Market Research source targets, applies the existing
  // Strategy logic, updates the three worksheets (non-destructively), and
  // persists a practical local report that survives reload. No fabricated parcel
  // facts/comps/demand/pricing/EVs/offers; no external CRM/GHL; no secret read.
  // Synthesize Pre-Call Intelligence (identity tier + property-type/strategy
  // inference + readiness) from the persisted report. Derived; never fabricated.
  const factsFromReport = (report: Record<string, unknown>, deal: Record<string, unknown>): ParcelFacts => {
    const rows = (report.ddFactChecklist ?? []) as Array<{ label: string; value: string | null; status: string }>;
    const v = (needle: string) => rows.find((r) => r.label.toLowerCase().includes(needle) && r.status === 'verified')?.value ?? null;
    const numv = (s: string | null) => { if (!s) return null; const n = Number(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
    const card = ((deal.propertyCards as Array<Record<string, unknown>> | undefined)?.[0] ?? {}) as Record<string, unknown>;
    return {
      verified: !!report.parcelVerified,
      localityOk: !!report.parcelVerified,
      acres: numv(v('acre')),
      zoning: v('zoning'),
      landUse: v('land use'),
      buildingAreaSqft: numv(v('building')),
      inputAddress: (card.active_input_address as string) ?? (deal.title as string) ?? null,
      owner: (card.owner as string) ?? null,
      city: (card.city as string) ?? null,
      county: (card.county as string) ?? null,
      state: (card.state as string) ?? null,
    };
  };
  const synthPreCall = (report: Record<string, unknown>, deal: Record<string, unknown>, cardId: number | undefined) => {
    const facts = factsFromReport(report, deal);
    const propertyType = inferPropertyType(facts);
    const liveSold = (report.marketComps as { soldCount?: number } | undefined)?.soldCount ?? 0;
    const compsCount = liveSold > 0 ? liveSold : (cardId ? listComps({ dealCardId: deal.id as number }).length : 0);
    const visualsCaptured = ((report.visualContext as { assets?: Array<{ status: string }> })?.assets ?? []).filter((a) => a.status === 'captured').length;
    const gov = report.govDd as { flood?: { status?: string }; wetlands?: { status?: string }; slope?: { status?: string } } | undefined;
    const sig = (s?: string) => (s === 'verified' ? 'verified' as const : 'needs_verification' as const);
    const demoStatus = (report.demographics as { status?: string } | undefined)?.status as ('verified' | 'not_configured' | 'no_geography' | 'error' | 'not_run' | undefined);
    // Browser evidence feeds pre-call only when a discovery backend actually
    // returned items; 0 until then (honest).
    const browserEvidenceCount = 0;
    const preCallIntelligence = buildPreCallIntelligence(facts, {
      identityVerified: !!report.parcelVerified,
      visualsCaptured,
      compsCount,
      marketPulse: !!report.marketSummary,
      browserEvidenceCount,
      flood: sig(gov?.flood?.status), wetlands: sig(gov?.wetlands?.status), slope: sig(gov?.slope?.status),
      demographics: demoStatus,
    });
    return { preCallIntelligence, propertyType };
  };

  // Browser Market Intelligence area from the deal's subject card (honest status
  // when no browser model backend is wired).
  const browserResearchBackend = makeNewsResearchBackend();
  const browserIntelFor = (deal: Record<string, unknown>) => {
    const card = ((deal.propertyCards as Array<Record<string, unknown>> | undefined)?.[0] ?? {}) as Record<string, unknown>;
    return collectBrowserMarketIntelligence({ city: card.city as string, county: card.county as string, state: card.state as string }, { backend: browserResearchBackend });
  };

  // Build the Discovery Call Intelligence Report intake (Section 1) from the
  // deal's subject Property Card + the resolver plan. Pure — no provider call.
  const buildDiscoveryIntake = (deal: unknown): DiscoveryIntake => {
    const d = deal as { title?: string; propertyCards?: Array<Record<string, unknown>> };
    const pc = d.propertyCards?.[0] ?? {};
    const sv = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const address = sv(pc.active_input_address) ?? sv(d.title);
    // APN-safe: "002-07637-000" must never yield ZIP "07637".
    const zip = extractZipCandidate(address);
    const acres = typeof pc.acres === 'number' && pc.acres > 0 ? pc.acres : null;
    const fields: IntakeFields = {
      address, city: sv(pc.city), state: sv(pc.state), zip, county: sv(pc.county),
      apn: sv(pc.apn), owner: sv(pc.owner), fips: sv(pc.fips), propertyId: sv(pc.lp_property_id),
    };
    const plan = planResolver(fields);
    return {
      rawInput: sv(pc.active_input_address) ?? sv(d.title) ?? '',
      address, city: fields.city, county: fields.county, state: fields.state, zip,
      apn: fields.apn, owner: fields.owner, acres,
      resolverPathReason: plan.reason,
    };
  };

  // Resolve the deal's geography against the master Market Matrix (single source
  // of truth). The Property Card AND the Discovery Call Report both render this.
  const marketMatrixFor = (deal: unknown) => {
    const d = deal as { title?: string; propertyCards?: Array<Record<string, unknown>> };
    const pc = d.propertyCards?.[0] ?? {};
    const sv = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const zip = sv(pc.zip) ?? extractZipCandidate(sv(pc.active_input_address) ?? sv(d.title));
    const acres = typeof pc.acres === 'number' && pc.acres > 0 ? pc.acres : null;
    return resolveMarketMatrixSection({ state: sv(pc.state), county: sv(pc.fips) ?? sv(pc.county), zip, acres, side: 'sold' });
  };

  // Pursuit decision (Strategy's ONE question) + the Executive Orchestrator
  // coherence audit — computed from the SAME reconciled report objects every tab
  // reads, so the answer can never disagree with the card.
  // Canonical shared records for a deal: unique comp registry, strategy
  // readiness (pricing gate), document registry, model version. Every consumer
  // (report GET, report/run, reconcile) builds them the same way.
  interface CanonicalBundle {
    compRegistry: CompRegistry;
    strategyReadiness: StrategyReadinessRecord;
    /** ONE readiness record every tab/report/RAG doc consumes. */
    unifiedReadiness: UnifiedReadinessRecord;
    documentRegistry: DocumentRegistry | null;
    operatorRecord: OperatorPropertyRecord | null;
    deedRetrieved: boolean;
  }
  const canonicalForDeal = (input: {
    dealCardId: number;
    deal: unknown;
    cardId: number | null;
    report: unknown;
    operatorRecord: OperatorPropertyRecord | null;
    deedRetrieved?: boolean;
    /** Registry already built by the caller (single build per request). */
    prebuiltRegistry?: CompRegistry;
  }): CanonicalBundle => {
    const r = input.report as { parcelVerified?: boolean; marketComps?: ReportCompLanes | null; valuation?: { conflict?: boolean } | null; riskFlags?: string[]; ddFactChecklist?: Array<{ key: string; value?: string | null }> };
    const dealRec = input.deal as { propertyCards?: Array<Record<string, unknown>> };
    const prop = dealRec.propertyCards?.[0];
    const compRegistry = input.prebuiltRegistry ?? compRegistryForDeal(input.dealCardId, {
      state: str(prop?.state) ?? input.operatorRecord?.identity.state ?? null,
      county: str(prop?.county) ?? input.operatorRecord?.identity.county ?? null,
      zip: input.operatorRecord?.identity.zip ?? null,
      acres: input.operatorRecord?.identity.mappedAcres ?? input.operatorRecord?.identity.assessedAcres ?? null,
    }, r.marketComps ?? null);
    const buildingArea = Number(((r.ddFactChecklist ?? []).find((f) => f.key === 'buildingArea')?.value ?? '').replace(/[^0-9.]/g, '')) || 0;
    const strategyReadiness = strategyReadinessForDeal({
      parcelVerified: !!r.parcelVerified,
      registry: compRegistry,
      operatorRecord: input.operatorRecord,
      valuationConflict: !!r.valuation?.conflict,
      improved: buildingArea > 0,
      hardRisks: r.riskFlags ?? null,
    });
    const documentRegistry = documentRegistryForCard(input.cardId, { acreageConflict: input.operatorRecord?.identity.acreageConflict, dealCardId: input.dealCardId });
    const unifiedReadiness = unifiedReadinessForDeal({
      parcelVerified: !!r.parcelVerified,
      registry: compRegistry,
      strategyReadiness,
      operatorRecord: input.operatorRecord,
      valuationConflict: !!r.valuation?.conflict,
      deedRetrieved: input.deedRetrieved ?? false,
    });
    return {
      compRegistry,
      strategyReadiness,
      unifiedReadiness,
      documentRegistry,
      operatorRecord: input.operatorRecord,
      deedRetrieved: input.deedRetrieved ?? false,
    };
  };

  const synthPursuitAndAudit = (input: {
    report: unknown;
    executiveSummary?: unknown;
    discoveryReport?: unknown;
    deal: unknown;
    cardId?: number | null;
    canonical?: CanonicalBundle;
  }) => {
    const r = input.report as {
      parcelVerified?: boolean; valuation?: never; compState?: never; riskFlags?: string[];
      strategyBlockers?: string[]; nextConfirmations?: string[];
    };
    const es = input.executiveSummary as {
      verifyBeforeOffer?: string[]; strategyRanking?: never; strongestStrategy?: never;
    } | undefined;
    const dcr = input.discoveryReport as { strategyEvaluation?: never } | undefined;
    const dealRec = input.deal as { asking_price?: number | null; propertyCards?: Array<Record<string, unknown>> };
    const prop = dealRec.propertyCards?.[0];
    const pursuit = buildPursuitDecision({
      parcelVerified: !!r.parcelVerified,
      valuation: (r.valuation as never) ?? null,
      compState: (r.compState as never) ?? null,
      riskFlags: r.riskFlags ?? [],
      blockers: r.strategyBlockers ?? [],
      verifyBeforeOffer: [...(es?.verifyBeforeOffer ?? []), ...(r.nextConfirmations ?? [])],
      strategyRanking: (es?.strategyRanking as never) ?? (dcr?.strategyEvaluation as never) ?? null,
      strongestStrategy: (es?.strongestStrategy as never) ?? null,
      askingPrice: typeof dealRec.asking_price === 'number' ? dealRec.asking_price : null,
      // The shared pricing gate: closed unless the canonical strategy-readiness
      // record proves a defensible value basis. Default closed.
      pricingAllowed: input.canonical?.strategyReadiness.pricingAllowed ?? false,
      pricingBlockers: input.canonical?.strategyReadiness.pricingBlockers ?? null,
    });
    const orchestration = auditDealCardCoherence({
      report: input.report as never,
      executiveSummary: (input.executiveSummary as never) ?? null,
      pursuit: pursuit as never,
      subjectCardId: input.cardId ?? null,
      subject: { county: str(prop?.county) ?? null, state: str(prop?.state) ?? null },
      // Association-proven Google visuals for the subject card — the audit fails
      // any rendered visual outside this set (filenames are not proof).
      eligibleVisualServices: input.cardId != null ? Object.keys(loadEligibleCardVisualCapture(input.cardId)) : null,
      compRegistry: input.canonical ? { counts: input.canonical.compRegistry.counts, valuationReady: input.canonical.compRegistry.valuationReady } : null,
      strategyReadiness: input.canonical ? { strategies: input.canonical.strategyReadiness.strategies, pricingAllowed: input.canonical.strategyReadiness.pricingAllowed } : null,
      unifiedReadiness: input.canonical?.unifiedReadiness ?? null,
      reportOfferReadiness: (input.report as { offerReadiness?: string }).offerReadiness ?? null,
      operatorRecord: input.canonical?.operatorRecord ? {
        identity: {
          acreageConflict: input.canonical.operatorRecord.identity.acreageConflict,
          assessedAcres: input.canonical.operatorRecord.identity.assessedAcres,
          mappedAcres: input.canonical.operatorRecord.identity.mappedAcres,
        },
        description: input.canonical.operatorRecord.description,
        decisionCards: input.canonical.operatorRecord.decisionCards,
        offerReadiness: input.canonical.operatorRecord.offerReadiness,
        valueReadiness: input.canonical.operatorRecord.valueReadiness,
        pricingGate: input.canonical.operatorRecord.pricingGate,
        researchCompleteness: input.canonical.operatorRecord.researchCompleteness,
        landScore: { available: input.canonical.operatorRecord.landScore.available, verdict: input.canonical.operatorRecord.landScore.verdict, unavailableReason: input.canonical.operatorRecord.landScore.unavailableReason },
      } : null,
      documentRegistry: input.canonical?.documentRegistry ? {
        documentCount: input.canonical.documentRegistry.documents.length,
        pageCount: input.canonical.documentRegistry.documents.reduce((n, d) => n + d.pageCount, 0),
      } : null,
      deedRetrieved: input.canonical?.deedRetrieved ?? false,
    });
    return { pursuit, orchestration };
  };

  // ── Multi-parcel roster ────────────────────────────────────────────────────
  // A lead can reference several APNs ("002-07637-000 and 002-07579-000 …").
  // Each parcel is its own subject: Parcel B never inherits Parcel A's imagery
  // or facts. The roster reports, per APN: resolved w/ verified imagery,
  // resolved w/o imagery, or unresolved + the exact next action. No fake or
  // generic imagery is ever created to fill a missing state.
  const parcelRosterFor = (deal: unknown): Array<{
    apn: string; label: string; cardId: number | null;
    status: 'resolved_verified_imagery' | 'resolved_no_imagery' | 'unresolved';
    nextAction: string | null;
  }> => {
    const d = deal as { title?: string; propertyCards?: Array<Record<string, unknown>> };
    const cards = (d.propertyCards ?? []) as Array<Record<string, unknown>>;
    const rawText = [d.title ?? '', ...(cards.map((pc) => String(pc.active_input_address ?? '')))].join('\n');
    const apns = extractApnCandidates(rawText).parcels ?? [];
    if (!apns.length) return [];
    return apns.map((apn, i) => {
      const digits = apn.replace(/\D/g, '');
      const card = cards.find((pc) => String(pc.apn ?? '').replace(/\D/g, '') === digits);
      const cardId = typeof card?.id === 'number' ? (card.id as number) : null;
      const verified = !!card && String(card.verification_status ?? '').startsWith('verified');
      let hasImagery = false;
      if (cardId != null) {
        try {
          hasImagery =
            Object.keys(loadEligibleCardVisualCapture(cardId)).length > 0 ||
            (loadPropertyInspection(cardId)?.assets ?? []).length > 0;
        } catch { hasImagery = false; }
      }
      return {
        apn,
        label: `Parcel ${String.fromCharCode(65 + i)}`,
        cardId,
        status: verified ? (hasImagery ? 'resolved_verified_imagery' as const : 'resolved_no_imagery' as const) : 'unresolved' as const,
        nextAction: verified
          ? (hasImagery ? null : `Run Property Intelligence for APN ${apn} to capture verified parcel imagery.`)
          : `Awaiting parcel resolution — run Property Resolution for APN ${apn}. No imagery or facts can attach to this parcel until it is resolved.`,
      };
    });
  };

  const terminalParcelStatus = (deal: unknown): string | null => {
    const status = String(((deal as { propertyCards?: Array<{ verification_status?: unknown }> }).propertyCards?.[0]?.verification_status ?? '')).toLowerCase();
    return ['rejected_mismatch', 'archived'].includes(status) ? status : null;
  };
  const terminalParcelError = (status: string) => ({
    error: `downstream property intelligence is disabled for terminal parcel status: ${status}`,
    evidenceStatus: status,
  });

  // ── Canonical report projection — the ONE derivation chain every report
  //    consumer runs (interactive GET *and* the downloadable report). It
  //    mutates `report` in place with the registry-projected counts, gated
  //    valuation, refreshed narratives, and clamped legacy offer label, and
  //    returns the canonical shared records. A consumer that skips this
  //    projection is exactly how a stale favorable download contradicted the
  //    live card (WS3 finding F8).
  const projectCanonicalReport = (input: {
    id: number;
    deal: NonNullable<ReturnType<typeof getDealCard>>;
    report: ReturnType<typeof getDealCardReport>;
    publicRun: PublicIntelligenceRun | null | undefined;
    cardId: number | null;
    growthSummary: unknown;
  }) => {
    const { id, deal, report, publicRun, cardId, growthSummary } = input;
    const fact = (key: string) => report.ddFactChecklist?.find((row) => row.key === key)?.value ?? null;
    const inspectionForVisuals = cardId ? loadPropertyInspection(cardId) : null;
    const dealRecord = deal as unknown as Record<string, unknown>;
    const prop0 = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;

    // ── Canonical order: registry → valuation projection → operator record
    //    (with the SHARED pricing gate) → gated narratives/exec summary. ──────
    const subjectAcres = parseAcresValue(report.reconciliation?.acreage?.primary)
      ?? (typeof prop0.acres === 'number' && (prop0.acres as number) > 0 ? (prop0.acres as number) : null);
    const registry = compRegistryForDeal(id, {
      state: str(prop0.state) ?? null,
      county: str(prop0.county) ?? null,
      zip: extractZipCandidate(str(prop0.active_input_address) ?? str(dealRecord.title as string | undefined)) ?? null,
      acres: subjectAcres,
    }, (report.marketComps as unknown as ReportCompLanes) ?? null);
    // Valuation is recomputed from the VALIDATED UNIQUE registry so the basis it
    // cites can never disagree with the comp counts every tab shows.
    const projectedValuation = valuationFromRegistry(registry, subjectAcres, report.valuation);

    const operatorRecord = buildOperatorPropertyRecord(publicRun, {
      situsAddress: String(fact('situsAddress') ?? dealRecord.title ?? ''),
      county: (fact('county') as string | null) ?? (dealRecord.county as string | null),
      state: (fact('state') as string | null) ?? (dealRecord.state as string | null),
      apn: (fact('apn') as string | null) ?? (dealRecord.apn as string | null),
      owner: (fact('owner') as string | null) ?? (dealRecord.owner as string | null),
      // Shared acreage parser: "1.15 ac" is a value, never NaN → "? ac".
      assessedAcres: parseAcresValue(fact('acres')) ?? subjectAcres,
      acreageDisputed: !!report.reconciliation?.acreage?.conflict,
      coordinates: (() => {
        const first = (deal as { propertyCards?: unknown[] }).propertyCards?.[0] as { lat?: unknown; lng?: unknown } | undefined;
        return typeof first?.lat === 'number' && typeof first?.lng === 'number' ? { lat: first.lat, lng: first.lng } : null;
      })(),
      parcelVerified: report.parcelVerified,
      verificationSource: report.parcelVerificationStatus,
      compCount: registry.counts.validatedSold,
      valuationReady: registry.valuationReady,
      valuationConflict: projectedValuation.conflict,
      thinMarketClusterSupported: registry.clusterAnalysis?.thinMarketSupported ?? false,
      marketPulseAvailable: !!growthSummary,
      visualsCaptured: (inspectionForVisuals?.assets ?? []).length,
      landPortalCaptured: !!report.landportalInspection?.parcelUrl,
      deedRetrieved: !!cardId && ((getPropertyCard(cardId)?.sourceEvidence ?? []) as Array<{ fact?: string }>).some((row) => /vesting deed/i.test(String(row.fact ?? ''))),
    });
    // Recorded-document evidence (deed/easement research) for the Documents tab.
    const recordedEvidence = cardId
      ? ((getPropertyCard(cardId)?.sourceEvidence ?? []) as Array<Record<string, unknown>>)
          .filter((row) => /deed|easement|recorded|trustee succession|legal description \(deed\)/i.test(String(row.fact ?? '')))
          .map((row) => ({
            fact: String(row.fact ?? ''),
            sourceUrl: String(row.source_url ?? ''),
            sourceType: String(row.source_type ?? ''),
            dateAccessed: String(row.date_accessed ?? ''),
            note: String(row.note ?? ''),
          }))
      : [];
    // ── Canonical shared records: every tab reads these, never its own derivation ──
    const canonical = canonicalForDeal({
      dealCardId: id,
      deal,
      cardId: cardId ?? null,
      report,
      operatorRecord,
      deedRetrieved: recordedEvidence.some((row) => /vesting deed/i.test(row.fact)),
      prebuiltRegistry: registry,
    });
    // Legacy per-report offer label may never read more advanced than the shared
    // unified readiness record — a generator-derived "ready_for_offer" cannot
    // outrank the reconciled offer state (legacy fields never override it).
    if (report.offerReadiness === 'ready_for_offer' && canonical.unifiedReadiness.offer.state !== 'ready') {
      report.offerReadiness = 'needs_confirmation';
    }
    // Project the validated unique registry counts + registry-derived $/acre
    // stats back into the legacy report shape before regenerating all narrative
    // consumers, so no tab can cite a different count or a stale lane median.
    const registryStats = registryValuationStats(registry);
    if (report.marketComps) {
      report.marketComps.soldCount = registryStats.soldCount;
      report.marketComps.activeCount = registryStats.activeCount;
      Object.assign(report.marketComps.metrics, {
        soldMedianPpa: registryStats.soldMedianPpa,
        ppaMin: registryStats.ppaMin,
        ppaMax: registryStats.ppaMax,
      });
    }
    // ONE pricing gate (the operator record computes the same gate strategy
    // readiness uses) decides whether ANY valuation may display. Gate closed →
    // primary/range suppressed, observations preserved, reasons stated.
    report.valuation = applyPricingGate(projectedValuation, operatorRecord.pricingGate);
    if (!operatorRecord.pricingGate.pricingAllowed && report.marketComps && !canonical.compRegistry.valuationReady) {
      Object.assign(report.marketComps.metrics, { soldMedianPpa: null, ppaMin: null, ppaMax: null, soldAvgPpa: null });
    }
    // The compState every tab shows carries VALIDATED UNIQUE counts, never raw
    // provider attempts (those live in the registry's provider coverage audit).
    const registryCompState = compStateFromRegistry(canonical.compRegistry, report.marketComps?.status);
    (report as unknown as Record<string, unknown>).compState = registryCompState;
    // Narrative currency: the market summary regenerates from the registry comp
    // state (it can never deny comps that were validated), and the strategy
    // narrative can never promote a "most viable" exit while the gate is closed.
    report.marketSummary = refreshMarketSummary({
      county: str(prop0.county) ?? operatorRecord.identity.county,
      state: str(prop0.state) ?? operatorRecord.identity.state,
      compSummaryLine: registryCompState.summaryLine,
      anyRetrieved: registryCompState.anyRetrieved,
      persistedSummary: report.marketSummary,
    });
    {
      const refreshed = refreshStrategySummary({
        gate: operatorRecord.pricingGate,
        strategySummaryLine: canonical.strategyReadiness.summaryLine,
        persistedSummary: report.strategySummary,
        persistedMostViable: report.mostViableStrategy,
      });
      report.strategySummary = refreshed.strategySummary;
      report.mostViableStrategy = refreshed.mostViableStrategy;
    }
    // The memo shortlist comes from the validated unique registry's CLOSED sales
    // (never raw lanes, never padded with active listings), with straight-line
    // distance where coordinates are known.
    {
      const normAddr = (a: string | null | undefined) => (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      const coordsByAddress = new Map<string, { lat: number; lng: number }>();
      try {
        for (const row of listComps({ dealCardId: id })) {
          if (typeof row.lat === 'number' && typeof row.lng === 'number' && normAddr(row.address_desc)) {
            coordsByAddress.set(normAddr(row.address_desc), { lat: row.lat, lng: row.lng });
          }
        }
        const cacheGet = getLandosDb().prepare('SELECT lat, lng FROM landos_geocode_cache WHERE address_key = ?');
        for (const comp of [...registry.validatedSold, ...registry.validatedActive]) {
          const key = normAddr(comp.address);
          if (!key || coordsByAddress.has(key)) continue;
          const cached = cacheGet.get(key) as { lat: number | null; lng: number | null } | undefined;
          if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') coordsByAddress.set(key, { lat: cached.lat, lng: cached.lng });
        }
      } catch { /* coordinates are enrichment; the shortlist works without them */ }
      report.bestComps = bestCompsFromRegistry(registry, subjectAcres, {
        subjectCoords: operatorRecord.identity.coordinates,
        coordsByAddress,
      });
    }
    return { registry, projectedValuation, operatorRecord, recordedEvidence, canonical, subjectAcres };
  };

  /** The gate-aware executive summary every report consumer builds — pricing
   *  suppressed while the shared gate is closed, seller questions from the
   *  operator record, and the unified readiness record mirrored verbatim. */
  const gatedExecutiveSummaryFor = (
    report: ReturnType<typeof getDealCardReport>,
    growthSummary: Parameters<typeof buildExecutiveSummary>[1],
    publicRun: PublicIntelligenceRun | null | undefined,
    projection: ReturnType<typeof projectCanonicalReport>,
  ) => buildExecutiveSummary(report, growthSummary, publicRun, {
    pricingAllowed: projection.operatorRecord.pricingGate.pricingAllowed,
    pricingBlockers: projection.operatorRecord.pricingGate.pricingBlockers,
    researchComplete: projection.operatorRecord.researchCompleteness.complete,
    researchMissing: projection.operatorRecord.researchCompleteness.missing,
    sellerQuestions: projection.operatorRecord.sellerQuestions,
    unifiedReadiness: {
      summaryLine: projection.canonical.unifiedReadiness.summaryLine,
      offer: { state: projection.canonical.unifiedReadiness.offer.state, why: projection.canonical.unifiedReadiness.offer.why },
      value: { state: projection.canonical.unifiedReadiness.value.state, why: projection.canonical.unifiedReadiness.value.why },
      strategyActionability: { stateLabel: projection.canonical.unifiedReadiness.strategyActionability.stateLabel, why: projection.canonical.unifiedReadiness.strategyActionability.why },
    },
  });

  // Read-only composition of existing canonical records. This route deliberately
  // does not invoke browser or provider lanes, or independently derive WS1-WS3.
  app.get('/api/landos/lead-workspace/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal) ?? null;
    const publicRun = new PublicIntelligenceStore().load(id)?.run;
    const report = getDealCardReport(id);
    const projection = projectCanonicalReport({ id, deal, report, publicRun, cardId, growthSummary: null });
    const acquisition = getAcquisition(id);
    const nextAction = acquisitionNextAction(acquisition, { ddParcelVerified: report.parcelVerified });
    return c.json(buildLeadWorkspace({
      deal: deal as unknown as Record<string, unknown>,
      report: report as unknown as Record<string, unknown>,
      acquisition: acquisition as unknown as Record<string, unknown>,
      nextAction: nextAction as unknown as Record<string, unknown>,
      operatorRecord: projection.operatorRecord as unknown as Record<string, unknown>,
      canonical: projection.canonical as unknown as Record<string, unknown>,
      compRegistry: projection.canonical.compRegistry as unknown as Record<string, unknown>,
      documents: (projection.canonical.documentRegistry ?? {}) as unknown as Record<string, unknown>,
      mission: (missionViewForCard(cardId) ?? {}) as unknown as Record<string, unknown>,
      activity: cardId ? getCardActivity(cardId) : [],
      marketPulse: null,
      marketMatrix: marketMatrixFor(deal),
    }));
  });

  app.get('/api/landos/deal-cards/:id/report', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const publicRun = new PublicIntelligenceStore().load(id)?.run;
    const terminalStatus = terminalParcelStatus(deal);
    if (terminalStatus) return c.json(terminalParcelError(terminalStatus), 409);
    const report = projectPublicScreening(getDealCardReport(id), publicRun);
    const cardId = subjectCardId(deal);
    const sellerSummary = summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []);
    const { preCallIntelligence, propertyType } = synthPreCall(report as unknown as Record<string, unknown>, deal as unknown as Record<string, unknown>, cardId);
    const leadTypeRaw = (deal as unknown as { lead_type?: string }).lead_type;
    const leadType: LeadType = isLeadType(leadTypeRaw) ? leadTypeRaw : 'actual';
    const browserMarketIntel = await browserIntelFor(deal as unknown as Record<string, unknown>);
    const { summarizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = summarizeGrowthDrivers(browserMarketIntel as never);
    const confirmedForDiscovery = confirmParcelForDeal(id);
    const marketMatrix = marketMatrixFor(deal);

    // ── The ONE canonical projection (shared with the report download). ──────
    const projection = projectCanonicalReport({ id, deal, report, publicRun, cardId: cardId ?? null, growthSummary });
    const { registry, operatorRecord, recordedEvidence, canonical } = projection;
    void registry;
    // Legacy workflow readiness derives from the projected report AFTER the
    // shared records constrained it, so "offer prep ready" can never appear
    // while the unified record says the offer is researching or blocked.
    const readiness = computeDealCardReadiness(report, {
      dealUpdatedAt: (deal as { updated_at?: number }).updated_at,
      sellerFacts: sellerSummary,
      hasCountyVerification: !!cardId && loadCountyVerificationRecords(cardId).length > 0,
    });
    const briefing = buildDiscoveryBriefing(report, readiness, sellerSummary);
    const executiveSummary = gatedExecutiveSummaryFor(report, growthSummary, publicRun, projection);
    const discoveryReport = confirmedForDiscovery
      ? buildConfirmedParcelDiscoveryReport(confirmedForDiscovery, report, executiveSummary, buildDiscoveryIntake(deal))
      : buildAreaDiscoveryReport(report, executiveSummary, buildDiscoveryIntake(deal));
    discoveryReport.marketMatrix = marketMatrix;
    // Honest report classification: the generator finishing ≠ completed research
    // ≠ decision readiness.
    const reportReadiness = classifyReportReadiness({
      parcelVerified: report.parcelVerified,
      researchComplete: operatorRecord.researchCompleteness.complete,
      researchMissing: operatorRecord.researchCompleteness.missing,
      pricingAllowed: operatorRecord.pricingGate.pricingAllowed,
    });
    // Land Score currency: once the public-intelligence evidence model exists for
    // this card, a LandPortal-era score is stale by definition — replace it with
    // the reconciled score (exact accepted evidence per factor) or honest absence.
    if (publicRun) {
      const rls = operatorRecord.landScore;
      (report as unknown as Record<string, unknown>).landScore = rls.available
        ? {
            score: rls.score, maxScore: rls.maxScore, verdict: rls.verdict, factors: rls.factors,
            dataGaps: rls.factors.filter((f) => f.dataGap).map((f) => f.label),
            flags: rls.flags, rubricSource: 'Reconciled operator record (current accepted evidence)',
            confidence: rls.confidence, note: rls.note,
          }
        : null;
      (report as unknown as Record<string, unknown>).landScoreNote = rls.available ? rls.note : rls.unavailableReason;
    }
    const { pursuit, orchestration } = synthPursuitAndAudit({ report, executiveSummary, discoveryReport, deal, cardId, canonical });
    const modelVersion = modelVersionForCard(cardId ?? null, canonical.compRegistry);
    const mission = missionViewForCard(cardId ?? null);
    // Per-category DD business status: provider execution ≠ business
    // completeness ≠ evidence strength — three separate axes for every lane.
    const ddBusinessStatus = buildDdBusinessStatus({
      run: publicRun,
      acreageConflict: operatorRecord.identity.acreageConflict,
      deedRetrieved: canonical.deedRetrieved,
    });
    return c.json({
      report, executiveSummary, discoveryReport, marketMatrix, growthSummary, readiness, briefing, preCallIntelligence, propertyType, leadType, leadTypeLabel: LEAD_TYPE_LABEL[leadType], govDd: report.govDd, browserMarketIntel, pursuit, orchestration, parcelRoster: parcelRosterFor(deal), operatorRecord, recordedEvidence,
      compRegistry: canonical.compRegistry,
      strategyReadiness: canonical.strategyReadiness,
      unifiedReadiness: canonical.unifiedReadiness,
      documentRegistry: canonical.documentRegistry,
      ddBusinessStatus,
      reportReadiness,
      modelVersion,
      mission,
    });
  });

  app.get('/api/landos/deal-cards/:id/report/download', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const publicRun = new PublicIntelligenceStore().load(id)?.run;
    const terminalStatus = terminalParcelStatus(deal);
    if (terminalStatus) return c.json(terminalParcelError(terminalStatus), 409);
    const report = projectPublicScreening(getDealCardReport(id), publicRun);
    if (!report.exists) return c.json({ error: 'run Property Intelligence before downloading a report' }, 400);
    const cardId = subjectCardId(deal);
    const sellerSummary = summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []);
    const browserMarketIntel = await browserIntelFor(deal as unknown as Record<string, unknown>);
    const { summarizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = summarizeGrowthDrivers(browserMarketIntel as never);
    // The downloadable report runs the SAME canonical projection + gated
    // executive summary as the live card — a download can never carry a more
    // favorable strategy/valuation story than the dashboard (WS3 finding F8).
    const projection = projectCanonicalReport({ id, deal, report, publicRun, cardId: cardId ?? null, growthSummary });
    const readiness = computeDealCardReadiness(report, {
      dealUpdatedAt: (deal as { updated_at?: number }).updated_at,
      sellerFacts: sellerSummary,
      hasCountyVerification: !!cardId && loadCountyVerificationRecords(cardId).length > 0,
    });
    const briefing = buildDiscoveryBriefing(report, readiness, sellerSummary);
    const executiveSummary = gatedExecutiveSummaryFor(report, growthSummary, publicRun, projection);
    const confirmedForDiscovery = confirmParcelForDeal(id);
    const discoveryReport = confirmedForDiscovery
      ? buildConfirmedParcelDiscoveryReport(confirmedForDiscovery, report, executiveSummary, buildDiscoveryIntake(deal))
      : buildAreaDiscoveryReport(report, executiveSummary, buildDiscoveryIntake(deal));
    const marketMatrix = marketMatrixFor(deal);
    discoveryReport.marketMatrix = marketMatrix;
    const markdown = propertyIntelligenceMarkdown({
      deal, report, executiveSummary, discoveryReport, briefing,
      unifiedReadiness: projection.canonical.unifiedReadiness,
      strategyReadiness: projection.canonical.strategyReadiness,
      compRegistry: projection.canonical.compRegistry,
    });
    const inspection = cardId ? loadPropertyInspection(cardId) : null;
    const imagePaths = (inspection?.assets ?? []).map((a) => a.storedPath).filter((p) => {
      const resolved = path.resolve(p);
      const root = path.resolve(process.cwd(), 'store', 'visuals');
      return resolved.startsWith(root + path.sep);
    });
    const format = (c.req.query('format') ?? 'pdf').toLowerCase();
    const baseName = `property-intelligence-${id}`;
    if (format === 'md' || format === 'markdown') {
      return new Response(markdown, {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="${baseName}.md"`,
          'cache-control': 'private, max-age=60',
        },
      });
    }
    const pdf = await buildPropertyIntelligencePdf(markdown, imagePaths);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${baseName}.pdf"`,
        'cache-control': 'private, max-age=60',
      },
    });
  });

  app.post('/api/landos/deal-cards/:id/report/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const dealBeforeRun = getDealCard(id);
    const terminalStatus = terminalParcelStatus(dealBeforeRun);
    if (terminalStatus) return c.json(terminalParcelError(terminalStatus), 409);
    if (!dealBeforeRun) return c.json({ error: 'deal card not found' }, 404);
    const cardIdBeforeRun = subjectCardId(dealBeforeRun);
    if (cardIdBeforeRun) {
      const prop = (dealBeforeRun.propertyCards?.[0] ?? {}) as {
        active_input_address?: string | null;
        apn?: string | null;
        county?: string | null;
        state?: string | null;
        city?: string | null;
        owner?: string | null;
      };
      await ensureBrowserSession();
      const inspectionResult = await runPropertyInspection({
        cardId: cardIdBeforeRun,
        searchKey: {
          address: str(prop.active_input_address ?? undefined),
          apn: str(prop.apn ?? undefined),
          county: str(prop.county ?? undefined),
          state: str(prop.state ?? undefined),
          city: str(prop.city ?? undefined),
          owner: str(prop.owner ?? undefined),
        },
        mode: 'deep_record',
        existingEvidence: [],
        timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      }, {
        landPortalBrowser: undefined,
        countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
        googleVisualConfigured: false,
      });
      persistPropertyInspection(cardIdBeforeRun, inspectionResult.inspection);
      // Browser Intelligence Vision: look at the screenshots we just captured
      // (LandPortal parcel/overlays/comps + Google satellite/Street View) and write
      // land-investor visual observations onto the card. Best-effort, never blocks
      // the report; degrades honestly when the vision model has no quota.
      try {
        const { runBrowserVisionForCard } = await import('./browser-vision.js');
        const vres = await runBrowserVisionForCard(cardIdBeforeRun);
        logger.info({ event: 'browser_vision', cardId: cardIdBeforeRun, ok: vres.ok, merged: vres.merged, analyzed: vres.analysis.analyzed.length, skipped: vres.analysis.skipped.length }, 'browser_vision_run');
      } catch (err) { logger.warn({ err, cardId: cardIdBeforeRun }, 'browser_vision_failed'); }
    }
    // Wire the REAL bounded non-credit LandPortal exact resolver. This is the
    // same safe path the Duke verification route uses — not a comp tool/credit.
    const reportRunOptions = {
      resolve: resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      actor: str(body.actor) ?? 'tyler/report',
      googleVisualConfigured: googleVisualConfiguredResolved(),
      // Reuse persisted verified data by default (no Realie credit). Operator can
      // force a fresh provider re-verification with { reverify: true }.
      reverify: body.reverify === true,
      // Zillow + Redfin public land comps via ISOLATED disposable browser profiles
      // (self-gate on live-browser mode; never the LandPortal session; never block
      // the report). Each source has its own throwaway profile + debug port.
      // Locality fallback: the persisted public-intelligence run knows the Census
      // county-subdivision locality (e.g. "St. Helena Island") when the LandPortal
      // fact sheet has no city — without it the land-comp search silently disables.
      captureZillowComps: (input: Parameters<typeof fetchZillowLandComps>[0]) => fetchZillowLandComps({ ...publicLocalityFallback(id, input), subjectAcres: input.subjectAcres }),
      captureRedfinComps: (input: Parameters<typeof fetchRedfinLandComps>[0]) => fetchRedfinLandComps({ ...input, ...publicLocalityFallback(id, input) }),
      compResearchDriver: makeLiveBrowserDriver('comp_research'),
    };
    let result = await runDealCardReport(id, reportRunOptions);
    if (!result) return c.json({ error: 'deal card not found' }, 404);
    // Confirmation continues downstream automatically: queue the full public
    // intelligence mission when no screening evidence exists yet.
    if (result.report.parcelVerified) ensurePublicIntelligenceMission(id, 'report run');
    const deal = getDealCard(id);
    const cardId = deal ? subjectCardId(deal) : undefined;
    const sellerSummary = summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []);
    const readiness = computeDealCardReadiness(result.report, {
      dealUpdatedAt: (deal as { updated_at?: number } | undefined)?.updated_at,
      sellerFacts: sellerSummary,
      hasCountyVerification: !!cardId && loadCountyVerificationRecords(cardId).length > 0,
    });
    const briefing = buildDiscoveryBriefing(result.report, readiness, sellerSummary);
    const { preCallIntelligence, propertyType } = synthPreCall(result.report as unknown as Record<string, unknown>, (deal ?? {}) as unknown as Record<string, unknown>, cardId);
    const browserMarketIntel = await browserIntelFor((deal ?? {}) as unknown as Record<string, unknown>);
    const { synthesizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = await synthesizeGrowthDrivers(browserMarketIntel as never);
    const executiveSummary = buildExecutiveSummary(result.report, growthSummary, new PublicIntelligenceStore().load(id)?.run);
    const confirmedForDiscovery = deal ? confirmParcelForDeal(deal.id) : null;
    const discoveryReport = deal
      ? (confirmedForDiscovery
          ? buildConfirmedParcelDiscoveryReport(confirmedForDiscovery, result.report, executiveSummary, buildDiscoveryIntake(deal))
          : buildAreaDiscoveryReport(result.report, executiveSummary, buildDiscoveryIntake(deal)))
      : undefined;
    const marketMatrix = deal ? marketMatrixFor(deal) : undefined;
    if (discoveryReport && marketMatrix) discoveryReport.marketMatrix = marketMatrix;

    // ── Executive Orchestrator gate ─────────────────────────────────────────
    // The Deal Card is not finished until every tab tells the same story. Audit
    // the coherence of what just ran; a repairable failure triggers ONE bounded
    // automatic re-run (recompute reconciliation/valuation/comps from the same
    // persisted evidence), then re-audit. Never an unbounded loop.
    const canonicalRun = canonicalForDeal({ dealCardId: id, deal: deal ?? {}, cardId: cardId ?? null, report: result.report, operatorRecord: null });
    let { pursuit, orchestration } = synthPursuitAndAudit({ report: result.report, executiveSummary, discoveryReport, deal: deal ?? {}, cardId, canonical: canonicalRun });
    let repairAttempted = false;
    if (!orchestration.passed && orchestration.checks.some((ch) => !ch.pass && ch.repairable)) {
      repairAttempted = true;
      logger.info({ dealCardId: id, failed: orchestration.checks.filter((ch) => !ch.pass).map((ch) => ch.id) }, 'orchestrator_repair_rerun');
      const repaired = await runDealCardReport(id, reportRunOptions);
      if (repaired) {
        result = repaired;
        const executiveSummary2 = buildExecutiveSummary(repaired.report, growthSummary, new PublicIntelligenceStore().load(id)?.run);
        const discoveryReport2 = deal
          ? (confirmedForDiscovery
              ? buildConfirmedParcelDiscoveryReport(confirmedForDiscovery, repaired.report, executiveSummary2, buildDiscoveryIntake(deal))
              : buildAreaDiscoveryReport(repaired.report, executiveSummary2, buildDiscoveryIntake(deal)))
          : undefined;
        if (discoveryReport2 && marketMatrix) discoveryReport2.marketMatrix = marketMatrix;
        const canonical2 = canonicalForDeal({ dealCardId: id, deal: deal ?? {}, cardId: cardId ?? null, report: repaired.report, operatorRecord: null });
        const second = synthPursuitAndAudit({ report: repaired.report, executiveSummary: executiveSummary2, discoveryReport: discoveryReport2, deal: deal ?? {}, cardId, canonical: canonical2 });
        pursuit = second.pursuit;
        orchestration = second.orchestration;
        const readiness2 = computeDealCardReadiness(repaired.report, {
          dealUpdatedAt: (deal as { updated_at?: number } | undefined)?.updated_at,
          sellerFacts: sellerSummary,
          hasCountyVerification: !!cardId && loadCountyVerificationRecords(cardId).length > 0,
        });
        const briefing2 = buildDiscoveryBriefing(repaired.report, readiness2, sellerSummary);
        return c.json({ ...repaired, executiveSummary: executiveSummary2, discoveryReport: discoveryReport2, marketMatrix, growthSummary, readiness: readiness2, briefing: briefing2, preCallIntelligence, propertyType, govDd: repaired.report.govDd, browserMarketIntel, pursuit, orchestration: { ...orchestration, repairAttempted }, parcelRoster: parcelRosterFor(deal ?? {}) });
      }
    }
    return c.json({ ...result, executiveSummary, discoveryReport, marketMatrix, growthSummary, readiness, briefing, preCallIntelligence, propertyType, govDd: result.report.govDd, browserMarketIntel, pursuit, orchestration: { ...orchestration, repairAttempted }, parcelRoster: parcelRosterFor(deal ?? {}) });
  });

  // ── Reconcile Deal Card (in-place, idempotent migration) ─────────────────
  // Operates on the EXISTING card: preserves the card id, CRM/seller data, and
  // accepted evidence; revalidates persisted comps against the current model;
  // stamps the model version; never creates duplicates; never calls providers.
  app.post('/api/landos/deal-cards/:id/reconcile', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal) ?? null;
    const prop = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const report = getDealCardReport(id);
    const terminalStatus = terminalParcelStatus(deal);
    if (terminalStatus) return c.json(terminalParcelError(terminalStatus), 409);
    const result = reconcileDealCard({
      dealCardId: id,
      cardId,
      subject: {
        state: str(prop.state) ?? null,
        county: str(prop.county) ?? null,
        acres: typeof prop.acres === 'number' ? (prop.acres as number) : null,
      },
      reportLanes: (report.marketComps as unknown as ReportCompLanes) ?? null,
    });
    const registry = compRegistryForDeal(id, { state: str(prop.state) ?? null, county: str(prop.county) ?? null }, (report.marketComps as unknown as ReportCompLanes) ?? null);
    const modelVersion = modelVersionForCard(cardId, registry);
    // Refresh the RAG index from the card's accepted evidence (idempotent —
    // content-hash keyed, no external calls, no paid providers).
    let ragSynced = 0;
    try { ragSynced = ingestCardEvidence({ dealCardId: id, cardId, county: str(prop.county) ?? null, state: str(prop.state) ?? null, apn: str(prop.apn) ?? null, address: str(prop.active_input_address) ?? null }).length; } catch { ragSynced = 0; }
    landosAudit('landos/reconcile', 'deal_card_reconciled', `deal ${id}: ${result.note}`, { refTable: 'landos_deal_card', refId: id });
    return c.json({ ...result, modelVersion, ragSynced });
  });

  // ── Embedded LandOS comp map (final deduplicated registry, every property) ──
  // The interactive map + comp table payload: subject marker, unified registry
  // markers with labeled PPA + provider links + selection scores + exclusion
  // reasons. Coordinates are enrichment: persisted provider coords first, then a
  // BOUNDED cached Census geocode fill (free, keyless; results cached onto the
  // comp rows so repeat loads make zero external calls). Never a paid map API.
  app.get('/api/landos/deal-cards/:id/comp-map', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const prop = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const report = getDealCardReport(id);
    const registry = compRegistryForDeal(
      id,
      { state: str(prop.state) ?? null, county: str(prop.county) ?? null, acres: typeof prop.acres === 'number' ? (prop.acres as number) : null },
      (report?.marketComps as unknown as ReportCompLanes) ?? null,
    );

    // Coordinates: persisted provider coords → shared geocode cache → a BOUNDED
    // fresh Census fill over the REGISTRY's unique comp addresses (report-lane
    // comps included, not just persisted rows). Misses are cached too so a bad
    // address is never re-queried every load; each map load fills a little more.
    const db = getLandosDb();
    const norm = (a: string | null | undefined) => (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const coordsByAddress = new Map<string, { lat: number; lng: number }>();
    for (const r of listComps({ dealCardId: id })) {
      if (typeof r.lat === 'number' && typeof r.lng === 'number' && norm(r.address_desc)) {
        coordsByAddress.set(norm(r.address_desc), { lat: r.lat, lng: r.lng });
      }
    }
    const geocodeCandidates: string[] = [];
    const missCache = new Set<string>();
    const cacheGet = db.prepare('SELECT lat, lng FROM landos_geocode_cache WHERE address_key = ?');
    const cachePut = db.prepare('INSERT OR REPLACE INTO landos_geocode_cache (address_key, lat, lng) VALUES (?, ?, ?)');
    for (const c of [...registry.validatedSold, ...registry.validatedActive]) {
      const key = norm(c.address);
      if (!key || coordsByAddress.has(key) || missCache.has(key)) continue;
      const cached = cacheGet.get(key) as { lat: number | null; lng: number | null } | undefined;
      if (cached) {
        if (typeof cached.lat === 'number' && typeof cached.lng === 'number') coordsByAddress.set(key, { lat: cached.lat, lng: cached.lng });
        else missCache.add(key); // known miss — don't re-query
        continue;
      }
      // Only real one-line street addresses (needs a leading street number).
      if (/^\d+\s+\S+/.test(c.address!.trim())) geocodeCandidates.push(c.address!);
    }
    const GEOCODE_CAP = 15;
    for (const address of geocodeCandidates.slice(0, GEOCODE_CAP)) {
      const key = norm(address);
      try {
        const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue; // transient — retry on a later load, don't cache the miss
        const body = (await res.json()) as { result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> } };
        const m = body?.result?.addressMatches?.[0]?.coordinates;
        const lat = Number(m?.y), lng = Number(m?.x);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordsByAddress.set(key, { lat, lng });
          try { cachePut.run(key, lat, lng); } catch { /* cache write is best-effort */ }
        } else {
          try { cachePut.run(key, null, null); } catch { /* cache the miss */ }
        }
      } catch { /* one failed geocode never blocks the map */ }
    }

    const view = buildCompMapView({
      subject: {
        address: str(prop.active_input_address) ?? null,
        apn: str(prop.apn) ?? null,
        acres: typeof prop.acres === 'number' ? (prop.acres as number) : null,
        lat: typeof prop.lat === 'number' ? (prop.lat as number) : null,
        lng: typeof prop.lng === 'number' ? (prop.lng as number) : null,
      },
      registry,
      coords: { get: (address) => coordsByAddress.get(norm(address)) ?? null },
    });
    return c.json({ compMap: view });
  });

  // ── RAG knowledge layer (local-first FTS; canonical records stay authoritative) ──
  app.get('/api/landos/rag/stats', (c) => c.json(ragIndexStats()));

  app.get('/api/landos/rag/search', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ error: 'q is required' }, 400);
    const dealId = Number(c.req.query('dealId'));
    const types = (c.req.query('types') ?? '').split(',').map((t) => t.trim()).filter((t): t is RagDocType => (RAG_DOC_TYPES as readonly string[]).includes(t));
    const hits = retrieveRagChunks({
      query: q,
      dealCardId: Number.isInteger(dealId) && dealId > 0 ? dealId : null,
      county: c.req.query('county') || null,
      state: c.req.query('state') || null,
      docTypes: types.length ? types : null,
      includeHistorical: c.req.query('historical') === '1',
      limit: Number(c.req.query('limit')) || 10,
      agent: 'operator',
      purpose: 'manual_search',
    });
    return c.json({ query: q, hits });
  });

  // Per-agent retrieval bundle: canonical snapshot + long-form chunks. The
  // agent reads this BEFORE acting; its output still goes through the
  // validator/reconciler — retrieval never mutates the Deal Card.
  app.get('/api/landos/deal-cards/:id/rag-context/:agent', (c) => {
    const id = Number(c.req.param('id'));
    const agent = c.req.param('agent') as RagAgentKind;
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!['access', 'zoning', 'documents', 'market', 'qa', 'general'].includes(agent)) return c.json({ error: 'unknown agent' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const prop = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const ctx = buildAgentRagContext({
      agent,
      dealCardId: id,
      county: str(prop.county) ?? null,
      state: str(prop.state) ?? null,
      focus: c.req.query('focus') || null,
    });
    return c.json(ctx);
  });

  // Manual text/markdown/html ingestion (ordinances, plans, procedures, research).
  app.post('/api/landos/rag/ingest', async (c) => {
    const body = await c.req.json<{ docKey?: string; title?: string; docType?: string; source?: string; text?: string; html?: string; pages?: Array<{ pageNumber: number; text: string; section?: string }>; dealCardId?: number; county?: string; state?: string; officialUrl?: string; evidenceStatus?: string }>();
    const text = body.html ? htmlToText(body.html) : (body.text ?? '');
    const pages = (body.pages ?? []).filter((p) => Number.isInteger(p.pageNumber) && p.pageNumber > 0 && p.text?.trim());
    if (!body.docKey || !body.title || (!text.trim() && !pages.length)) return c.json({ error: 'docKey, title, and text/html or page text are required' }, 400);
    const docType = (RAG_DOC_TYPES as readonly string[]).includes(body.docType ?? '') ? body.docType as RagDocType : 'other';
    const res = ingestRagDocument({
      docKey: body.docKey, title: body.title, docType, source: body.source ?? 'manual',
      officialUrl: body.officialUrl ?? null, dealCardId: body.dealCardId ?? null,
      county: body.county ?? null, state: body.state ?? null,
      evidenceStatus: (['accepted', 'rejected', 'superseded', 'pending', 'failed'].includes(body.evidenceStatus ?? '') ? body.evidenceStatus : 'accepted') as never,
      text: pages.length ? undefined : text,
      pages: pages.length ? pages : undefined,
    });
    return c.json(res);
  });

  // One-shot local sync: card evidence, canonical records, and repo playbooks.
  app.post('/api/landos/rag/sync', async (c) => {
    const body = await c.req.json<{ dealCardId?: number }>().catch(() => ({} as { dealCardId?: number }));
    const results = [] as Array<{ docKey: string; chunks: number; skipped: boolean }>;
    results.push(...ingestRepoPlaybooks().map((r) => ({ docKey: r.docKey, chunks: r.chunks, skipped: r.skipped })));
    if (body.dealCardId) {
      const deal = getDealCard(body.dealCardId);
      if (deal) {
        const prop = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
        if (prop.verification_status !== 'verified_property') {
          return c.json({
            error: 'canonical property RAG sync requires an independently verified subject parcel',
            evidenceStatus: prop.verification_status ?? 'unverified_lead',
          }, 409);
        }
        const cardId = subjectCardId(deal) ?? null;
        const subject = {
          dealCardId: body.dealCardId, cardId,
          county: str(prop.county) ?? null, state: str(prop.state) ?? null,
          locality: str(prop.city) ?? str(prop.locality) ?? null,
          apn: str(prop.apn) ?? null, address: str(prop.active_input_address) ?? str((deal as { title?: string }).title) ?? null,
        };
        results.push(...ingestCardEvidence({
          dealCardId: body.dealCardId, cardId,
          county: str(prop.county) ?? null, state: str(prop.state) ?? null,
          apn: str(prop.apn) ?? null, address: str(prop.active_input_address) ?? null,
        }).map((r) => ({ docKey: r.docKey, chunks: r.chunks, skipped: r.skipped })));
        const publicRun = new PublicIntelligenceStore().load(body.dealCardId)?.run;
        const finding = (task: string) => publicRun?.tasks?.find((t) => t.task === task)?.finding ?? null;
        const storedReport = getDealCardReport(body.dealCardId);
        const registry = compRegistryForDeal(body.dealCardId, {
          state: subject.state, county: subject.county, locality: subject.locality,
          acres: typeof prop.acres === 'number' ? prop.acres : null,
        }, (storedReport.marketComps as unknown as ReportCompLanes) ?? null);
        const acceptedComp = (comp: CompRegistry['uniqueComps'][number]) => ({
          address: comp.address, acres: comp.acresDisplay, comparability: comp.comparability,
          comparabilityWhy: comp.comparabilityWhy, sourceConfidence: comp.sourceConfidence,
          transaction: comp.primary, providers: comp.providers,
        });
        // The SAME canonical readiness chain the report GET builds — RAG recall
        // must carry the shared record, never the registry count gate alone.
        const syncDeedRetrieved = !!cardId && ((getPropertyCard(cardId)?.sourceEvidence ?? []) as Array<{ fact?: string }>).some((row) => /vesting deed/i.test(String(row.fact ?? '')));
        const syncFact = (key: string) => storedReport.ddFactChecklist?.find((row) => row.key === key)?.value ?? null;
        const syncOperatorRecord = buildOperatorPropertyRecord(publicRun, {
          situsAddress: subject.address ?? '',
          county: subject.county, state: subject.state, apn: subject.apn,
          owner: (syncFact('owner') as string | null) ?? str(prop.owner) ?? null,
          assessedAcres: parseAcresValue(syncFact('acres')) ?? (typeof prop.acres === 'number' ? prop.acres : null),
          acreageDisputed: !!storedReport.reconciliation?.acreage?.conflict,
          coordinates: null,
          parcelVerified: storedReport.parcelVerified,
          verificationSource: storedReport.parcelVerificationStatus,
          compCount: registry.counts.validatedSold,
          valuationReady: registry.valuationReady,
          valuationConflict: !!storedReport.valuation?.conflict,
          thinMarketClusterSupported: registry.clusterAnalysis?.thinMarketSupported ?? false,
          marketPulseAvailable: false,
          visualsCaptured: 0,
          landPortalCaptured: !!storedReport.landportalInspection?.parcelUrl,
          deedRetrieved: syncDeedRetrieved,
        });
        const syncCanonical = canonicalForDeal({
          dealCardId: body.dealCardId, deal, cardId,
          report: storedReport,
          operatorRecord: syncOperatorRecord,
          deedRetrieved: syncDeedRetrieved,
          prebuiltRegistry: registry,
        });
        const syncReadiness = syncCanonical.unifiedReadiness;
        const canonicalResults = ingestCanonicalDealKnowledge({
          subject,
          accessCurrent: JSON.stringify({
            canonicalGuard: 'Road proximity is not frontage or access. Parcel-road contact, ROW contact, physical access, legal access, and maintenance remain unresolved until independently verified.',
            parcelIdentity: finding('county_records'),
            roadContext: finding('road_frontage'),
            visualContext: finding('imagery'),
            deedContext: cardId ? documentRegistryForCard(cardId, { dealCardId: body.dealCardId }).documents.flatMap((d) => d.findings) : [],
          }, null, 2),
          accessHistorical: 'REJECTED CLAIM HISTORY: Earlier wording that called centerline-buffer proximity mapped frontage or public-road frontage was rejected. It must not support current access conclusions. The current canonical record says frontage, parcel-road contact, right-of-way contact, physical access, and legal access are unresolved.',
          zoningCurrent: JSON.stringify({
            jurisdiction: [subject.locality, subject.county && `${subject.county} County`, subject.state].filter(Boolean).join(', '),
            applicableZoningAndOverlays: finding('zoning_landuse'),
          }, null, 2),
          marketCurrent: JSON.stringify({
            geographyHierarchy: { locality: subject.locality, county: subject.county, state: subject.state },
            counts: registry.counts,
            // The registry count gate is CONTEXT ONLY — the shared readiness
            // record is the only value-readiness authority RAG may recall.
            registryCountGateMet: registry.valuationReady, valuationBlockers: registry.valuationBlockers,
            sharedPricingGate: { pricingAllowed: syncReadiness.strategyScoreability.state === 'scoreable', valueReadiness: syncReadiness.value.state, why: syncReadiness.value.why },
            acceptedSold: registry.validatedSold.map(acceptedComp), acceptedActive: registry.validatedActive.map(acceptedComp),
            clusterAssignments: registry.clusterAnalysis,
            rule: 'Source confidence and subject comparability are separate. Materially different acreage clusters are never blended automatically. A computable median is preliminary context only — it never opens pricing while the shared gate is closed.',
          }, null, 2),
          readinessCurrent: JSON.stringify({
            summaryLine: syncReadiness.summaryLine,
            dimensions: syncReadiness.dimensions.map((d) => ({ key: d.key, state: d.state, stateLabel: d.stateLabel, why: d.why })),
            materiality: syncReadiness.materiality,
            allStrategiesBlocked: syncReadiness.allStrategiesBlocked,
            rule: 'One shared readiness record drives Overview, Market, Strategy, Seller, Reports and Executive review. Strategy readiness is never OK while all strategies are blocked; a bare median never makes value readiness high; offer and contract readiness are separate states with explicit reasons.',
          }, null, 2),
          marketHistorical: JSON.stringify({ status: 'rejected - historical audit only; never current valuation support', rejectedCandidates: registry.rejected, duplicateMerges: registry.duplicateMerges }, null, 2),
          qaCurrent: [
            'Current acceptance checks: road proximity never labeled frontage; no parcel-road touch claims; no parcel-wide slope-band acreage from point samples; non-wetland mapped area is not usable/buildable acreage.',
            'Pricing checks: no one-point median, value band, offer range, or seller pricing; active counts agree; acreage clusters remain separate; source confidence and comparability remain separate.',
            'Safety checks: Land Score is screening-only and never PASS while unresolved; provider execution is separate from business completeness; rejected/superseded material is historical only; RAG candidates cannot bypass canonical validation/reconciliation.',
            'Unsafe phrases include mapped public-road frontage, mapped frontage on Seaside Road, usable acreage from wetland subtraction, ready for use, excellent paved road access, and no blocking items.',
          ].join('\n'),
        });
        results.push(...canonicalResults.map((r) => ({ docKey: r.docKey, chunks: r.chunks, skipped: r.skipped })));
    }
      }
    return c.json({ ingested: results, stats: ragIndexStats() });
  });

  // ── Manual local document upload (Documents tab) ──────────────────────────
  app.get('/api/landos/document-upload/categories', (c) => c.json({ categories: UPLOAD_CATEGORIES }));

  app.post('/api/landos/deal-cards/:id/documents/upload', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'multipart field "file" is required' }, 400);
    const category = String(body.category ?? 'other') as RegisteredDocument['category'];
    const allowed = UPLOAD_CATEGORIES.some((cat) => cat.value === category);
    try {
      const row = saveDocumentUpload({
        dealCardId: id,
        category: allowed ? category : 'other',
        title: String(body.title ?? '') || file.name,
        docType: String(body.docType ?? '') || undefined,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        bytes: Buffer.from(await file.arrayBuffer()),
        documentDate: String(body.documentDate ?? '') || null,
        note: String(body.note ?? '') || null,
      });
      const cardId = subjectCardId(deal);
      if (cardId != null) {
        attachCardActivity({ cardId, agentId: 'landos/documents', kind: 'document_uploaded', summary: `Operator uploaded "${row.title}" (${row.category}, ${row.fileName}).` });
      }
      landosAudit('landos/documents', 'document_uploaded', `deal ${id}: ${row.title} (${row.category})`, { refTable: 'landos_deal_card', refId: id });
      return c.json({ upload: row, uploads: listDocumentUploads(id) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/landos/deal-cards/:id/documents/uploads', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json({ uploads: listDocumentUploads(id) });
  });

  app.get('/api/landos/deal-cards/:id/documents/upload-file/:file', (c) => {
    const id = Number(c.req.param('id'));
    const file = c.req.param('file');
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const abs = servableUploadPath(id, file);
    if (!abs) return c.json({ error: 'document not found' }, 404);
    const bytes = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : /\.(jpg|jpeg)$/.test(ext) ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.txt' || ext === '.md' ? 'text/plain; charset=utf-8' : 'application/octet-stream';
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${file.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // ── County-sourced document pages (Documents tab viewer) ─────────────────
  // Serves the ACTUAL recorder page images captured for the subject card.
  // Card-scoped filename validation only — no traversal, no cross-card reads.
  app.get('/api/landos/deal-cards/:id/document-page/:file', (c) => {
    const id = Number(c.req.param('id'));
    const file = c.req.param('file');
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    if (cardId == null || !isServableDocumentPage(cardId, file)) return c.json({ error: 'document page not found' }, 404);
    const abs = path.join(process.cwd(), 'store', 'visuals', file);
    if (!fs.existsSync(abs)) return c.json({ error: 'document page not found' }, 404);
    const bytes = fs.readFileSync(abs);
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // ── Post-discovery DD layer ─────────────────────────────────────────────
  // Resolve the deal's SUBJECT property card id (seller facts + county records
  // are stored on it). undefined when no property card is linked yet.
  const subjectCardId = (deal: unknown): number | undefined =>
    ((deal as { propertyCards?: Array<Record<string, unknown>> }).propertyCards?.[0]?.id) as number | undefined;

  // Free government DD provider readiness (dormant by default; no live call).
  app.get('/api/landos/dd-providers/status', (c) => c.json(govDdProvidersStatus()));

  // Seller-stated facts (post-discovery). Always labeled Seller-stated, never
  // Verified. Stored on the subject property card; no provider call.
  app.get('/api/landos/deal-cards/:id/seller-facts', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    const facts = cardId ? loadSellerStatedFacts(cardId) : [];
    return c.json({ facts, summary: summarizeSellerFacts(facts), kinds: SELLER_FACT_KINDS });
  });
  app.post('/api/landos/deal-cards/:id/seller-facts', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    if (!cardId) return c.json({ error: 'link a property card to this deal before recording seller-stated facts' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = str(body.kind) ?? '';
    if (!isSellerFactKind(kind)) return c.json({ error: `kind must be one of: ${SELLER_FACT_KINDS.join(', ')}` }, 400);
    const value = str(body.value);
    if (!value || !value.trim()) return c.json({ error: 'value is required' }, 400);
    const fact = addSellerStatedFact(cardId, { kind, value, note: str(body.note), recordedBy: str(body.recordedBy) });
    return c.json({ fact, summary: summarizeSellerFacts(loadSellerStatedFacts(cardId)) }, 201);
  });

  // County Records verification (post-discovery, MANUAL trigger; agent dormant).
  app.get('/api/landos/deal-cards/:id/county-verification', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    return c.json({ availableTasks: COUNTY_VERIFICATION_TASKS, records: cardId ? loadCountyVerificationRecords(cardId) : [] });
  });
  // Plan a targeted, bounded county task (pure — NO browsing happens).
  app.post('/api/landos/deal-cards/:id/county-verification/plan', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const task = str(body.task) ?? '';
    if (!(COUNTY_VERIFICATION_TASKS as readonly string[]).includes(task)) return c.json({ error: `task must be one of: ${COUNTY_VERIFICATION_TASKS.join(', ')}` }, 400);
    const dd = getDealCardDd(id);
    const pc = ((deal as { propertyCards?: Array<Record<string, unknown>> }).propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const plan = planCountyVerification(task as CountyVerificationTask, {
      apn: str(dd.apn) || str(pc.apn) || undefined,
      ownerName: str(pc.owner) || undefined,
      county: str(dd.county) || str(pc.county) || undefined,
      state: str(dd.state) || str(pc.state) || undefined,
      fullAddress: str(pc.active_input_address) || undefined,
    });
    return c.json({ plan, note: 'County Records Browser Agent is dormant — this is a bounded plan only. No browsing performed.' });
  });
  // Manually record a county verification outcome (county call result / conflict).
  app.post('/api/landos/deal-cards/:id/county-verification/mark', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const task = str(body.task) ?? '';
    if (!(COUNTY_VERIFICATION_TASKS as readonly string[]).includes(task)) return c.json({ error: 'invalid task' }, 400);
    const allowedStatus: CountyTaskStatus[] = ['verified', 'conflict', 'needs_human_or_county_call', 'not_found'];
    const status = str(body.status) as CountyTaskStatus;
    if (!allowedStatus.includes(status)) return c.json({ error: `status must be one of: ${allowedStatus.join(', ')}` }, 400);
    const cardId = subjectCardId(deal);
    if (!cardId) return c.json({ error: 'link a property card to this deal before recording county verification' }, 400);
    const result: CountyTaskResult = {
      task: task as CountyVerificationTask,
      fieldUpdated: str(body.fieldUpdated) ?? task,
      status,
      officialSourceUrl: str(body.officialSourceUrl) ?? null,
      sourceTitle: str(body.sourceTitle) ?? null,
      extractedFact: str(body.extractedFact) ?? null,
      confidence: (str(body.confidence) as CountyTaskResult['confidence']) ?? (status === 'verified' ? 'high' : 'none'),
      timestamp: new Date().toISOString(),
      conflictWith: str(body.conflictWith) ?? null,
      evidenceRefs: Array.isArray(body.evidenceRefs) ? (body.evidenceRefs as string[]).filter((x) => typeof x === 'string') : [],
      note: str(body.note) ?? 'Manually recorded county verification outcome.',
    };
    saveCountyVerificationRecord(cardId, result, { by: str(body.by) });
    return c.json({ result, records: loadCountyVerificationRecords(cardId) }, 201);
  });

  // Post-discovery underwriting prep (derived; placeholders + gates, no offer).
  app.get('/api/landos/deal-cards/:id/underwriting-prep', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    const prep = buildUnderwritingPrep(getDealCardReport(id), summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []));
    return c.json({ underwritingPrep: prep });
  });

  // ── Acquisitions department (CRM-independent intelligence; never sends) ─────
  // Build DD/market context for call prep from the persisted report.
  const acqContext = (id: number): DealContextForPrep => {
    const r = getDealCardReport(id);
    const mc = r.marketComps as { metrics?: { ppaMin?: number | null; ppaMax?: number | null } } | undefined;
    const band = mc?.metrics?.ppaMin != null && mc?.metrics?.ppaMax != null ? `$${mc.metrics.ppaMin.toLocaleString()}–$${mc.metrics.ppaMax.toLocaleString()}/ac` : null;
    return {
      ddParcelVerified: r.parcelVerified,
      ddCompletenessLabel: r.ddCompleteness?.label,
      marketBand: band,
      topRiskFlags: (r.riskFlags ?? []).slice(0, 4),
      topMissingDdFacts: (r.ddFactChecklist ?? []).filter((x) => x.status === 'needs_verification' && !x.noConnectedSource).map((x) => x.label).slice(0, 4),
    };
  };
  const acqView = (id: number) => {
    const acq = getAcquisition(id);
    const report = getDealCardReport(id);
    const na = acquisitionNextAction(acq, { ddParcelVerified: report.parcelVerified });
    return {
      acquisition: acq,
      stageLabel: ACQUISITION_STAGE_LABEL[acq.stage],
      nextAction: na,
      strategy: sellerStrategySummary(acq, na),
      callPrep: buildCallPrep(acq, na, acqContext(id)),
      playbook: acquisitionPlaybook(),
      trainingReadiness: acquisitionTrainingReadiness(),
    };
  };
  app.get('/api/landos/deal-cards/:id/acquisition', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    return c.json(acqView(id));
  });
  app.post('/api/landos/deal-cards/:id/acquisition/profile', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    upsertSellerProfile(id, (body.profile ?? body) as Record<string, never>);
    return c.json(acqView(id), 201);
  });
  app.post('/api/landos/deal-cards/:id/acquisition/comm', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const channel = (COMM_CHANNELS as readonly string[]).includes(str(b.channel) ?? '') ? (b.channel as CommChannel) : 'other';
    if (!str(b.summary)) return c.json({ error: 'summary is required' }, 400);
    addCommLogEntry(id, {
      at: str(b.at) ?? new Date().toISOString(), channel,
      direction: b.direction === 'inbound' ? 'inbound' : 'outbound',
      summary: str(b.summary)!, notes: str(b.notes),
      sentiment: (str(b.sentiment) as never) ?? 'unknown',
      keyFacts: Array.isArray(b.keyFacts) ? (b.keyFacts as string[]) : [],
      objections: Array.isArray(b.objections) ? (b.objections as string[]) : [],
      commitments: Array.isArray(b.commitments) ? (b.commitments as string[]) : [],
      followUpNeeded: b.followUpNeeded === true,
    });
    return c.json(acqView(id), 201);
  });
  app.post('/api/landos/deal-cards/:id/acquisition/discovery', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const notes = str(b.notes) ?? str(b.text);
    if (!notes) return c.json({ error: 'notes are required' }, 400);
    addDiscoveryNote(id, extractDiscoveryNotes(notes));
    return c.json(acqView(id), 201);
  });
  app.post('/api/landos/deal-cards/:id/acquisition/stage', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const stage = str(b.stage);
    if (!isAcquisitionStage(stage)) return c.json({ error: 'invalid stage' }, 400);
    setAcquisitionStage(id, stage as AcquisitionStage);
    return c.json(acqView(id), 201);
  });
  // Generate a follow-up DRAFT only — NEVER sends anything.
  app.post('/api/landos/deal-cards/:id/acquisition/followup', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fmt = (['sms', 'email', 'call_script'].includes(str(b.format) ?? '') ? b.format : 'sms') as FollowUpFormat;
    return c.json({ draft: buildFollowUpDraft(getAcquisition(id), fmt) });
  });

  // ── Acquisition Intelligence Platform (AIP) — learning engine (no auto-modify) ──
  app.get('/api/landos/aip/assets', (c) => c.json({ assets: listAssets() }));
  app.post('/api/landos/aip/assets', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isSourceType(b.sourceType)) return c.json({ error: 'invalid sourceType' }, 400);
    if (!str(b.title)) return c.json({ error: 'title required' }, 400);
    return c.json({ asset: registerAsset({ sourceType: b.sourceType as AipSourceType, title: str(b.title)!, author: str(b.author), metadata: (b.metadata as Record<string, never>) ?? {}, ext: str(b.ext) }) }, 201);
  });
  app.get('/api/landos/aip/knowledge', (c) => {
    const cat = c.req.query('category'); const status = c.req.query('status');
    return c.json({ knowledge: listKnowledge({ category: isKnowledgeCategory(cat) ? (cat as AipKnowledgeCategory) : undefined, status: (status === 'proposed' || status === 'approved' || status === 'rejected') ? status : undefined }) });
  });
  app.post('/api/landos/aip/knowledge', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isKnowledgeCategory(b.category)) return c.json({ error: 'invalid category' }, 400);
    if (!str(b.content)) return c.json({ error: 'content required' }, 400);
    return c.json({ knowledge: addKnowledge({ category: b.category as AipKnowledgeCategory, content: str(b.content)!, citations: Array.isArray(b.citations) ? (b.citations as never[]) : [], links: Array.isArray(b.links) ? (b.links as never[]) : [], confidence: (str(b.confidence) as never) ?? 'medium', sourceAssetId: typeof b.sourceAssetId === 'number' ? b.sourceAssetId : null }) }, 201);
  });
  app.post('/api/landos/aip/knowledge/:kid/approve', (c) => { const k = approveKnowledge(Number(c.req.param('kid'))); return k ? c.json({ knowledge: k }) : c.json({ error: 'not found' }, 404); });
  app.post('/api/landos/aip/knowledge/:kid/reject', (c) => { const k = rejectKnowledge(Number(c.req.param('kid'))); return k ? c.json({ knowledge: k }) : c.json({ error: 'not found' }, 404); });
  app.get('/api/landos/aip/playbook', (c) => { const s = c.req.query('section'); return c.json({ playbook: listPlaybook(isPlaybookSection(s) ? (s as AipPlaybookSection) : undefined), published: isPlaybookSection(s) ? getPublishedPlaybookSection(s as AipPlaybookSection) : undefined }); });
  app.post('/api/landos/aip/playbook/generate', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isPlaybookSection(b.section)) return c.json({ error: 'invalid section' }, 400);
    return c.json({ result: generatePlaybookSection(b.section as AipPlaybookSection) }, 201);
  });
  app.post('/api/landos/aip/playbook/:pid/publish', (c) => { const p = publishPlaybookSection(Number(c.req.param('pid'))); return p ? c.json({ playbook: p }) : c.json({ error: 'not found' }, 404); });
  app.post('/api/landos/aip/coaching', async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const modes: CoachingMode[] = ['before_call', 'during_prep', 'after_call_review', 'negotiation_review', 'offer_review'];
    const mode = modes.includes(str(b.mode) as CoachingMode) ? (b.mode as CoachingMode) : 'before_call';
    return c.json(coachingLookup({ mode, query: str(b.query) }));
  });

  // ── Comps (manual + automated). Never verifies parcel identity. ─────
  app.get('/api/landos/deal-cards/:id/comps', (c) => {
    return c.json({ comps: listComps({ dealCardId: Number(c.req.param('id')) }) });
  });

  app.post('/api/landos/deal-cards/:id/comps', async (c) => {
    const dealCardId = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const deal = getDealCard(dealCardId);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    if (!isEntity(deal.entity)) return c.json({ error: 'deal card has no valid entity' }, 400);
    const comp = addComp({
      entity: deal.entity,
      dealCardId,
      cardId: num(body.cardId),
      sourceLabel: str(body.sourceLabel) as CompSourceLabel | undefined,
      sourceUrl: str(body.sourceUrl),
      addressDesc: str(body.addressDesc),
      apn: str(body.apn),
      county: str(body.county),
      state: str(body.state),
      price: num(body.price),
      priceKind: str(body.priceKind) as CompPriceKind | undefined,
      saleOrListDate: str(body.saleOrListDate),
      acres: num(body.acres),
      pricePerAcre: num(body.pricePerAcre),
      notes: str(body.notes),
      addedBy: str(body.addedBy),
      status: str(body.status) as CompStatus | undefined,
    });
    return c.json({ comp }, 201);
  });

  // Property-card-scoped comps for the Property Board UI. A property card may
  // not have a Deal Card yet; GET resolves the linked deal (if any) and POST
  // find-or-creates it. A comp NEVER changes the property's verification status,
  // identity, owner, contiguity, or facts.
  app.get('/api/landos/property-cards/:id/comps', (c) => {
    const cardId = Number(c.req.param('id'));
    const dealCardId = getDealCardIdForPropertyCard(cardId) ?? null;
    return c.json({ dealCardId, comps: listComps({ cardId }) });
  });

  app.post('/api/landos/property-cards/:id/comps', async (c) => {
    const cardId = Number(c.req.param('id'));
    const card = getPropertyCard(cardId);
    if (!card) return c.json({ error: 'property card not found' }, 404);
    if (!isEntity(card.entity)) return c.json({ error: 'property card has no valid entity' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const dealCardId = ensureDealCardForProperty({ cardId, entity: card.entity, title: card.active_input_address });
    const comp = addComp({
      entity: card.entity,
      dealCardId,
      cardId,
      sourceLabel: str(body.sourceLabel) as CompSourceLabel | undefined,
      sourceUrl: str(body.sourceUrl),
      addressDesc: str(body.addressDesc),
      apn: str(body.apn),
      county: str(body.county),
      state: str(body.state),
      price: num(body.price),
      priceKind: str(body.priceKind) as CompPriceKind | undefined,
      saleOrListDate: str(body.saleOrListDate),
      acres: num(body.acres),
      pricePerAcre: num(body.pricePerAcre),
      notes: str(body.notes),
      addedBy: str(body.addedBy),
      status: str(body.status) as CompStatus | undefined,
    });
    return c.json({ comp, dealCardId }, 201);
  });

  // Comp-source recommendation + LP staleness (no paid calls; advice only).
  app.post('/api/landos/comps/recommend', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const recommendation = recommendCompSources({
      acres: num(body.acres),
      lpAvailable: body.lpAvailable === true,
      lpStale: body.lpStale === true,
      niche: body.niche === true,
    });
    const recency = str(body.newestCompDate) || str(body.runDate)
      ? evaluateCompRecency(str(body.newestCompDate) ?? null, str(body.runDate) ?? new Date().toISOString())
      : undefined;
    return c.json({ recommendation, recency });
  });

  // ── Duke capability router (classification only) ────────────────────
  app.post('/api/landos/duke/route', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text) ?? '';
    return c.json({ result: routeDukeRequest(text) });
  });

  // ── LandOS Intake / Main Orchestrator (READ-ONLY planner) ───────────
  // The single entry path for dashboard text/voice, Telegram text/voice, CRM
  // leads, and manual API. Returns a worker dispatch plan only: it runs no
  // agent, writes no DB row, calls no LandPortal/comp tool, and never fakes
  // market data. Duke/Due Diligence stays operational through this path.
  app.post('/api/landos/intake', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const transport = (INTAKE_TRANSPORTS as readonly string[]).includes(str(body.transport) ?? '')
      ? (str(body.transport) as IntakeTransport)
      : 'manual_api';
    const requestedResponseMode = ['text_only', 'text_and_voice_summary', 'voice_briefing_requested'].includes(str(body.responseMode) ?? '')
      ? (str(body.responseMode) as ResponseMode)
      : undefined;
    const ctxRaw = body.context as Record<string, unknown> | undefined;
    const intake: LandOSIntake = {
      transport,
      text,
      voiceTranscriptSource: str(body.voiceTranscriptSource) as LandOSIntake['voiceTranscriptSource'],
      requestedResponseMode,
      entityHint: str(body.entityHint),
      context: ctxRaw
        ? {
            parcelVerified: ctxRaw.parcelVerified === true,
            verifiedFacts: Array.isArray(ctxRaw.verifiedFacts)
              ? (ctxRaw.verifiedFacts as Array<Record<string, unknown>>)
                  .filter((f) => typeof f.fact === 'string' && typeof f.source === 'string')
                  .map((f) => ({ fact: String(f.fact), value: str(f.value), source: String(f.source) }))
              : undefined,
            propertyCardId: num(ctxRaw.propertyCardId),
            dealCardId: num(ctxRaw.dealCardId),
          }
        : undefined,
    };
    return c.json({ plan: planLandosIntake(intake) });
  });

  // ── Duke Execution Bridge (Sprint 6B/6C) ───────────────────────────────
  // Runs Duke's EXISTING safe parcel-verification path (runDukePreflight: a
  // bounded LandPortal exact resolve — NOT a comp credit, NOT the full agent,
  // NOT GIS scraping) for the current intake input, and returns a structured
  // verification result plus a read-only Deal Card Update/Timeline plan. Never
  // verifies via coordinates/proximity, never spends a comp credit, never
  // mutates CRM/external systems, and persists nothing this sprint.
  app.post('/api/landos/intake/duke-verification', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    // Safe instrumentation: prove the route is hit. No secrets/tokens/PII — only
    // a boolean and a length. (The full text is operator input, not logged.)
    logger.info(
      { event: 'duke_verification_request', route: '/api/landos/intake/duke-verification', hasText: !!text, textLen: (text ?? '').length },
      'duke_verification_request',
    );
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const sellerAskUsd = num(body.sellerAskUsd);
    // Parse the parcel identifier and attempt the bounded LandPortal exact
    // lookup (never a comp tool/credit, never coordinates). A full street
    // address is a valid identifier and is mapped truthfully (e.g. needs
    // county/FIPS), never "no parcel identifier".
    const verification = await runDukeVerification(text, {
      resolve: resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
    });
    // Duke first-pass analysis (flags + strategy candidates/readiness) from the
    // verified property data. Unverified -> blocked, no fabricated offers.
    const dukeAnalysis = buildDukeAnalysis({
      parcelVerified: verification.parcelVerified,
      propertyData: verification.propertyData,
      dataGaps: verification.dataGaps,
    });
    // Ace seller discovery prep — questions, never facts.
    const acePrep = buildAcePrep({
      parcelVerified: verification.parcelVerified,
      redFlags: dukeAnalysis.redFlags,
      anomalyFlags: dukeAnalysis.anomalyFlags,
      dataGaps: dukeAnalysis.dataGaps,
    });
    const dealCardUpdatePlan = buildDealCardUpdatePlan({ verification, intakeText: text, sellerAskUsd });
    // Market Pulse v1: labeled local-area context when city/county + state is
    // known, even if the parcel is unverified. No fabricated market numbers.
    // Prefer the county/state returned by verified LandPortal property data
    // (a parcel input like propertyid+FIPS has no area words in the text). This
    // uses the source's county/state name — never coordinates/proximity.
    const area = extractAreaSignals(text);
    const verifiedId = verification.propertyData?.identity;
    const marketPulse = buildMarketPulseV1({
      city: area.city,
      county: verifiedId?.county ?? area.county,
      state: verifiedId?.state ?? area.state,
      parcelVerified: verification.parcelVerified,
    });
    // Land Score (100-pt rubric) from the VERIFIED LandPortal attributes only.
    // Unverified -> null (never scored from unverified/inferred data). Pure +
    // deterministic; missing source fields score 0 as loud data gaps, never faked.
    const landScore =
      verification.parcelVerified && verification.propertyData
        ? computeLandScoreFromPropertyData(verification.propertyData)
        : null;
    // Best-effort SUPPORTING imagery (never identity). Stub returns
    // "visual not captured yet" instantly; live Playwright is install-gated.
    // Never throws out of the endpoint.
    let imagery = null;
    try {
      imagery = await captureImagery({
        address: verifiedId?.situsAddress,
        apn: verifiedId?.apn,
        county: verifiedId?.county ?? area.county,
        state: verifiedId?.state ?? area.state,
      });
    } catch {
      imagery = null;
    }
    logger.info(
      { event: 'duke_verification_result', status: verification.status, parcelVerified: verification.parcelVerified, dataGaps: verification.dataGaps, strategyStatus: dukeAnalysis.strategyStatus, marketPulseEligible: marketPulse.eligible, landScored: !!landScore, imageryCaptured: imagery ? !imagery.notCaptured : false },
      'duke_verification_result',
    );
    return c.json({ verification, dukeAnalysis, acePrep, marketPulse, dealCardUpdatePlan, landScore, imagery });
  });

  // Verified-ONLY Deal Card creation. Re-runs the SAME bounded non-credit
  // verification server-side (never trusts a client 'verified' flag). Creates a
  // property card + Deal Card and populates the worksheets via the existing
  // report workflow ONLY when parcel identity is source-verified; otherwise it
  // returns the "Local Area Context — Not Parcel Verified" result and NO card.
  app.post('/api/landos/deal-cards/from-verification', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const entity = str(body.entity);
    if (!isEntity(entity)) return c.json({ error: 'entity must be LAND_ALLY or TY_LAND_BIZ' }, 400);
    const sellerAskUsd = num(body.sellerAskUsd);

    const verification = await runDukeVerification(text, {
      resolve: resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
    });

    // UNVERIFIED -> local area context only, NO Deal Card (fail loud, never fake).
    if (!verification.parcelVerified || !verification.propertyData) {
      const area = extractAreaSignals(text);
      const idu = verification.propertyData?.identity;
      const marketPulse = buildMarketPulseV1({
        city: area.city,
        county: idu?.county ?? area.county,
        state: idu?.state ?? area.state,
        parcelVerified: false,
      });
      return c.json({
        created: false,
        parcelVerified: false,
        reason: 'Local Area Context — Not Parcel Verified',
        verification,
        marketPulse,
      });
    }

    // VERIFIED -> upsert the property card from the verified identity, then
    // find-or-create its Deal Card. Identity comes ONLY from the verified
    // LandPortal source — never imagery/coordinates.
    const pid = verification.propertyData.identity;
    const acres = verification.propertyData.landFacts.acres;
    const ownerOnRecord = pid.owner;
    const { card } = upsertCardFromDukeRun({
      entity,
      agentId: 'duke-due-diligence',
      activeInputAddress: pid.situsAddress || text.trim(),
      county: pid.county,
      state: pid.state,
      apn: pid.apn,
      lpPropertyId: pid.propertyId,
      fips: pid.fips,
      owner: ownerOnRecord,
      acres: typeof acres === 'number' ? acres : undefined,
      verified: true,
      verificationSource: 'LandPortal exact (non-credit)',
      summary: verification.propertyData.note,
    });
    const dealCardId = ensureDealCardForProperty({
      cardId: card.id,
      entity,
      title: pid.situsAddress || pid.apn || `Deal ${card.id}`,
    });

    // Populate DD/Market/Strategy via the EXISTING safe non-credit report
    // workflow (same path as Run Report). Best-effort: a populate failure never
    // loses the verified Deal Card.
    let reportWarnings: string[] = [];
    try {
      const rep = (await runDealCardReport(dealCardId, {
        resolve: resolveParcelIdentityResult,
        timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
        actor: 'tyler/from-verification',
        googleVisualConfigured: googleVisualConfiguredResolved(),
        captureZillowComps: fetchZillowLandComps,
        captureRedfinComps: fetchRedfinLandComps,
        compResearchDriver: makeLiveBrowserDriver('comp_research'),
      })) as { warnings?: string[] } | null;
      if (rep && Array.isArray(rep.warnings)) reportWarnings = rep.warnings;
    } catch {
      reportWarnings = ['Worksheet population deferred — run the report from the Deal Card.'];
    }
    // Parcel just confirmed → the full public intelligence mission continues
    // automatically (background, guarded, free approved sources only).
    ensurePublicIntelligenceMission(dealCardId, 'verification');

    const landScore = computeLandScoreFromPropertyData(verification.propertyData);

    // Owner-mismatch is a NOTE, not a failure (possible inherited/pre-transfer).
    const lead = str(body.leadName);
    const ownerNote =
      lead && ownerOnRecord && lead.trim().toLowerCase() !== ownerOnRecord.trim().toLowerCase()
        ? `Owner on record: ${ownerOnRecord} / Lead: ${lead} — do not match (possible inherited/pre-transfer).`
        : null;

    return c.json({
      created: true,
      parcelVerified: true,
      dealCardId,
      propertyCardId: card.id,
      landScore,
      ownerNote,
      sellerAskUsd: sellerAskUsd ?? null,
      reportWarnings,
    });
  });

  // ── One-button Property Analysis (the normal dashboard path) ───────────────
  // Tyler enters an address/APN/owner+county and clicks Run Property Analysis.
  // This single click authorizes the approved non-credit LandPortal verification
  // + approved Apify/Redfin comp/market work. It runs the full chain
  // (verify -> DD facts -> Market Pulse -> Live Comps readiness -> Redfin comps ->
  // strategy/underwriting -> verified Deal Card -> Markdown + local PDF), logs
  // actual provider calls + spend, and persists the report under the gitignored
  // store/ dir (never the repo). No cost-confirmation modal for normal runs.
  app.post('/api/landos/property-analysis', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const entity = isEntity(str(body.entity)) ? (str(body.entity) as LandosEntity) : undefined;
    logger.info(
      { event: 'property_analysis_request', hasText: !!text, textLen: text.length, hasEntity: !!entity },
      'property_analysis_request',
    );

    const result = await runPropertyAnalysis(text, { entity }, {
      resolve: resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      // Verified-only Deal Card upsert from the named-source identity (never a
      // client 'verified' flag; identity never from coordinates).
      upsertDealCard: entity
        ? (v, ent, input) => {
            const pid = v.identity ?? {};
            const acres = v.propertyData?.landFacts.acres;
            const { card } = upsertCardFromDukeRun({
              entity: ent,
              agentId: 'duke-due-diligence',
              activeInputAddress: pid.situsAddress || input.trim(),
              county: pid.county,
              state: pid.state,
              apn: pid.apn,
              lpPropertyId: pid.propertyId,
              fips: pid.fips,
              owner: pid.owner,
              acres: typeof acres === 'number' ? acres : undefined,
              verified: true,
              verificationSource: v.verificationSource ?? 'LandPortal exact (non-credit)',
              summary: v.propertyData?.note ?? v.summary,
            });
            const dealCardId = ensureDealCardForProperty({
              cardId: card.id,
              entity: ent,
              title: pid.situsAddress || pid.apn || `Deal ${card.id}`,
            });
            return { dealCardId, propertyCardId: card.id };
          }
        : undefined,
    });

    // Persist Markdown (+ local PDF when pdfkit is installed) under store/.
    let report = { markdownPath: '', pdfPath: null as string | null, pdfReason: '' };
    try {
      report = await savePropertyAnalysisReport(result);
    } catch (err) {
      report = { markdownPath: '', pdfPath: null, pdfReason: `report persistence failed: ${(err as Error)?.message ?? 'unknown'}` };
    }

    logger.info(
      {
        event: 'property_analysis_result',
        verified: result.verified, verdict: result.verdict, offerReadiness: result.offerReadiness,
        providerCalls: result.providerCallCount, spendUsd: result.actualSpendUsd,
        compsRan: result.redfinComps.ran, compCount: result.redfinComps.comps.length,
        pdf: !!report.pdfPath,
      },
      'property_analysis_result',
    );
    return c.json({ result, report });
  });

  // PRODUCTION Mission Control "Run Property Analysis" — drives the CURRENT DD
  // pipeline (runDealCardReport): Realie-first parcel identity + locality
  // validation, Realie premium sold comps + Zillow supplemental, FEMA/NWI/USGS,
  // browser market intelligence, Pre-Call Intelligence, and the Acquisitions
  // layer — all persisted on a Deal Card. Returns the dealCardId so the UI opens
  // the Deal Card (which renders every current section). Replaces the legacy
  // /property-analysis path for the button.
  app.post('/api/landos/acquire/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawInput = str(body.rawInput) ?? str(body.text);
    const selectedSuggestion = body.selectedSuggestion as Record<string, unknown> | undefined;
    const text = rawInput;
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const entity: LandosEntity = isEntity(str(body.entity)) ? (str(body.entity) as LandosEntity) : 'TY_LAND_BIZ';
    const requestedDealCardId = Number(body.dealCardId);
    const existingDeal = Number.isInteger(requestedDealCardId) ? getDealCard(requestedDealCardId) : undefined;
    const existingCardId = existingDeal ? subjectCardId(existingDeal) : undefined;

    // ── PROPERTY-FIRST CONTRACT ─────────────────────────────────────────────
    // Pre-call DD is practical property intelligence, NOT legal-grade title
    // verification. Run the Property Resolution Engine across every practical
    // lane (Realie/LandPortal exact resolve, free Census county derivation +
    // retry, free Photon/Census address suggest, parked browser lanes). Two
    // outcomes only: Matched (run the report; unknown fields become Confirm
    // Before Offer) or Needs Clarification (no card; smallest next identifier).
    const cls = classifySmartIntake(text.trim());
    logger.info({
      event: 'acquire_input',
      rawInput: text.trim(),
      selectedSuggestion: selectedSuggestion ? {
        label: str(selectedSuggestion.label),
        source: str(selectedSuggestion.source),
        confidence: num(selectedSuggestion.confidence),
      } : null,
    }, 'acquire_input');
    // Browser escalation is an employee prerequisite, not an optional panel. Start
    // or reuse the persistent Chrome session before resolution so the resolver's
    // LandPortal-first browser lane can actually run when structured lookup leaves
    // owner/APN/acreage/parcel identity incomplete.
    const browserStart = { status: 'disabled', error: null };
    // AUTOMATIC LandPortal login from env credentials — the operator never signs
    // in by hand. Best-effort: updates the shared session auth state; the exact
    // technical reason is surfaced (never a "Tyler must log in") and never a
    // credential value. If it can't authenticate, LandPortal-backed lanes degrade
    // honestly downstream, exactly as before.
    const lpReadiness = { phase: 'optional_not_requested', authenticated: false, reason: null, missingEnv: [] as string[] };
    logger.info({ event: 'optional_source_readiness', phase: lpReadiness.phase, authenticated: lpReadiness.authenticated, hasReason: !!lpReadiness.reason, missingEnv: lpReadiness.missingEnv }, 'optional_source_readiness');
    const resolution = await resolveProperty(
      { rawText: text.trim(), fields: cls.parsedFields },
      liveResolutionDeps(LANDPORTAL_VERIFICATION_TIMEOUT_MS),
    );
    logger.info({ event: 'acquire_lanes', browserSession: browserStart.status, browserStartError: browserStart.error, lanes: (resolution.lanesAttempted ?? []).map((l) => `${l.lane}:${l.status}:${l.contributed ? 'contrib' : 'nc'}`), browser: (resolution.browserEvidence ?? []).map((b) => `${b.service}:${b.status}:${b.facts?.length ?? 0}f`) }, 'acquire_lanes');

    if (resolution.status === 'needs_clarification') {
      // A competent assistant does not return empty-handed. When the lead carries
      // ANY usable locator (address, county/city + state, APN, or owner), open a
      // RESEARCH Deal Card so the Business Object Spine shows what's found /
      // missing / blocking, and attach a public-records research plan (the exact
      // official county sources + the next verification action). The card is
      // explicitly unverified and NO fact is fabricated.
      const f = cls.parsedFields;
      const enough = !!(f.address || (f.state && (f.city || f.county)) || f.apn || f.owner);
      if (enough) {
        const researchAddr = f.address
          ? [f.address, [[f.city, f.state].filter(Boolean).join(', '), f.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
          : text.trim();
        // Wrong-parcel hard-stop: if a parcel-level source resolved a DIFFERENT
        // parcel than the requested APN, the card must SHOUT it (Property Board +
        // Resolution view), not read as a vanilla "unresolved" lead.
        const conflict = resolution.identityConflict;
        const { card } = upsertCardFromDukeRun({
          entity, agentId: 'acquire', cardId: existingCardId,
          activeInputAddress: researchAddr,
          city: f.city, state: f.state, county: f.county, apn: f.apn, fips: f.fips, owner: f.owner,
          verified: false,
          summary: conflict
            ? `⛔ WRONG PARCEL — hard stop. Requested APN ${conflict.requestedApn} but ${conflict.source} resolved a DIFFERENT parcel (APN ${conflict.resolvedApn}). Parcel NOT confirmed; no downstream intelligence ran.`
            : 'Acquire — research lead (unresolved). Public-records research plan attached; not verified.',
        });
        const dealCardId = ensureDealCardForProperty({ cardId: card.id, entity, title: researchAddr });
        try { attachCardActivity({ cardId: card.id, agentId: 'acquire', kind: 'intake_attempt', summary: 'Property intake preserved for resolution.', ref: JSON.stringify({ rawInput: text, parsed: cls.parsedFields, resolutionStatus: resolution.resolutionStatus }) }); } catch { /* history is best-effort */ }
        // Persist the parcel-identity verdict (Phase 1: written, not yet read).
        try { persistParcelIdentityFromResolution(dealCardId, resolution, { subjectCardId: card.id }); } catch { /* verdict persistence never blocks the card */ }
        // Capture the resolution trace so the Deal Card opens the Resolution view.
        try { writeResolutionSnapshot(dealCardId, buildResolutionSnapshot(text.trim(), cls.parsedFields, resolution)); } catch { /* snapshot never blocks the card */ }
        // On a wrong-parcel conflict the FIRST next action is the hard-stop itself.
        if (conflict) {
          try { addCardNextAction({ cardId: card.id, action: `⛔ Wrong parcel: you entered APN ${conflict.requestedApn} but ${conflict.source} resolved APN ${conflict.resolvedApn}${conflict.resolvedContext ? ` (${conflict.resolvedContext})` : ''}. Re-check the APN or provide a corrected parcel identifier before any intelligence runs.`, createdBy: 'acquire-apn-conflict' }); } catch { /* best-effort */ }
        }
        const plan = buildPublicRecordsResearchPlan({ county: f.county, state: f.state, city: f.city, apn: f.apn, owner: f.owner, address: f.address });
        for (const action of researchPlanNextActions(plan)) {
          try { addCardNextAction({ cardId: card.id, action, createdBy: 'acquire-research' }); } catch { /* one action failing never blocks the card */ }
        }
        // ── AUTONOMOUS PARALLEL ESCALATION ────────────────────────────────
        // Providers/geocoders left the parcel unconfirmed. Before parking as a
        // research card, run the two PARALLEL parcel-evidence lanes (official
        // public + LandPortal). A wrong-parcel hard stop is never escalated
        // past. On confirmation, continue the complete downstream workflow
        // automatically — the operator never presses a second button.
        if (!conflict) {
          try {
            const parallel = await runParallelParcelResolution(cls.parsedFields, LANDPORTAL_VERIFICATION_TIMEOUT_MS);
            const applied = applyParallelResolution({
              dealCardId, cardId: card.id, entity, resolution: parallel,
              acceptedApn: null, alreadyVerified: false,
              activeInputAddress: researchAddr, city: f.city ?? null,
            });
            if (applied.promoted) {
              const result = await runDealCardReport(dealCardId, {
                resolve: resolveParcelIdentityResult,
                timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
                googleVisualConfigured: false,
                captureZillowComps: fetchZillowLandComps,
                captureRedfinComps: fetchRedfinLandComps,
                compResearchDriver: makeLiveBrowserDriver('comp_research'),
              });
              if (result?.report.parcelVerified) ensurePublicIntelligenceMission(dealCardId, 'parallel resolution');
              logger.info({ event: 'acquire_run', ok: true, matched: true, parallelConfirmed: true, dealCardId, pipeline: 'parallel_resolution' }, 'acquire_run_parallel_confirmed');
              return c.json({
                ok: true, matched: true, parcelVerified: result?.report.parcelVerified === true, dealCardId,
                status: 'parallel_confirmed', confidence: 0.9,
                message: `Parcel confirmed by parallel resolution (${parallel.confirmationBasis}). Downstream intelligence ran automatically.`,
                lanesAttempted: resolution.lanesAttempted,
                parallelResolution: { laneAgreement: parallel.laneAgreement, lanes: parallel.lanes.map((l) => ({ lane: l.lane, status: l.status })) },
                reportStatus: result?.report.reportStatus ?? null,
              }, 201);
            }
          } catch (err) { logger.warn({ err, dealCardId }, 'acquire_parallel_escalation_failed'); }
        }
        logger.info({ event: 'acquire_run', ok: true, matched: false, researchCard: true, confidence: resolution.confidence, dealCardId, pipeline: 'property_resolution' }, 'acquire_run_research_card');
        return c.json({
          ok: true, matched: false, researchCardCreated: true, parcelVerified: false, dealCardId,
          status: conflict ? 'apn_conflict' : 'research_card', confidence: resolution.confidence,
          identityConflict: conflict,
          message: resolution.guidance ?? 'Unresolved by providers — opened a research Deal Card with a public-records research plan and the next verification action.',
          guidance: resolution.guidance,
          lanesAttempted: resolution.lanesAttempted,
        }, 201);
      }
      logger.info({ event: 'acquire_run', ok: false, matched: false, confidence: resolution.confidence, pipeline: 'property_resolution' }, 'acquire_run_needs_clarification');
      return c.json({
        ok: false, matched: false, parcelVerified: false, dealCardId: null,
        status: 'needs_clarification', confidence: resolution.confidence,
        message: resolution.guidance ?? 'No practical match could be established. Provide a stronger identifier.',
        guidance: resolution.guidance,
        lanesAttempted: resolution.lanesAttempted,
      }, 200);
    }

    // Matched: persist the resolved Property Card. `verified` reflects whether a
    // NAMED source confirmed identity; a credible-but-unverified match is still
    // Matched (Confirm Before Offer) and is NOT marked verified. Coordinates are
    // enrichment output, never identity.
    const p = resolution.property;
    // Subject address: when the match is NOT source-verified, preserve exactly what
    // the operator typed (house number + ZIP) — a free geocoder's road-segment
    // label (e.g. "State Highway 153, Winters, TX" for a typed "2510 State Highway
    // 153, ... 79567") must never replace it. A named-source VERIFIED address wins.
    const tf = cls.parsedFields;
    const rawTypedInput = text.trim();
    const subjectAddress = p.parcelVerified
      ? (p.normalizedAddress || p.address || rawTypedInput)
      : rawTypedInput;
    const browserProof = landPortalBrowserProof(resolution.browserEvidence, p);
    const browserVerified = !p.parcelVerified && browserProof.verified;
    const propertyVerified = p.parcelVerified || browserVerified;
    const { card } = upsertCardFromDukeRun({
      entity, agentId: 'acquire', cardId: existingCardId,
      activeInputAddress: subjectAddress,
      city: p.city, state: p.state, county: p.county,
      apn: p.apn, lpPropertyId: p.propertyId, fips: p.fips, lpUrl: p.lpUrl ?? browserProof.sourceUrl, owner: p.owner, acres: p.acres,
      lat: p.coordinates?.lat ?? null, lng: p.coordinates?.lng ?? null,
      priorInputAddress: rawTypedInput,
      verified: propertyVerified,
      verificationSource: p.parcelVerified ? (p.verificationSource ?? 'Realie.ai (non-credit)') : (browserVerified ? browserProof.source : undefined),
      summary: propertyVerified ? 'Acquire — verified parcel' : 'Acquire — matched (Confirm Before Offer)',
    });
    const dealCardId = ensureDealCardForProperty({ cardId: card.id, entity, title: subjectAddress });
    try { attachCardActivity({ cardId: card.id, agentId: 'acquire', kind: 'intake_attempt', summary: 'Property intake preserved for resolution.', ref: JSON.stringify({ rawInput: text, parsed: cls.parsedFields, resolutionStatus: resolution.resolutionStatus }) }); } catch { /* history is best-effort */ }
    // Persist the parcel-identity verdict (Phase 1: written, not yet read). This
    // is the single stored state that will replace the two divergent verdicts.
    try { persistParcelIdentityFromResolution(dealCardId, resolution, { subjectCardId: card.id }); } catch { /* verdict persistence never blocks the card */ }

    // ── MANDATORY IDENTITY GATE ─────────────────────────────────────────────
    // Property Resolution is the gatekeeper. A property can be `matched` (credible)
    // without the PARCEL being confirmed — e.g. only the operator's pasted APN /
    // county / road name back it and no source has actually read the parcel. In
    // that case DO NOT populate the Deal Card with downstream intelligence. Create
    // the lead card + a public-records research plan, tell the operator exactly what
    // must confirm the parcel, and hold Property Intelligence / comps / Market Pulse
    // / Strategy / Discovery until the parcel is established. Every downstream
    // department must consume a CONFIRMED parcel identity.
    if (!resolution.identityEstablished) {
      const plan = buildPublicRecordsResearchPlan({ county: p.county, state: p.state, city: p.city, apn: p.apn, owner: p.owner, address: p.address });
      for (const action of researchPlanNextActions(plan)) {
        try { addCardNextAction({ cardId: card.id, action, createdBy: 'acquire-research' }); } catch { /* one action failing never blocks the card */ }
      }
      // ── AUTONOMOUS PARALLEL ESCALATION (matched-but-unconfirmed) ────────
      // Same shared escalation as the research-card path: official public +
      // LandPortal in parallel, promote on confirmation, then continue the
      // complete downstream workflow automatically.
      try {
        const parallel = await runParallelParcelResolution(cls.parsedFields, LANDPORTAL_VERIFICATION_TIMEOUT_MS);
        const applied = applyParallelResolution({
          dealCardId, cardId: card.id, entity, resolution: parallel,
          acceptedApn: null, alreadyVerified: false,
          activeInputAddress: subjectAddress, city: p.city ?? null,
        });
        if (applied.promoted) {
          const result = await runDealCardReport(dealCardId, {
            resolve: resolveParcelIdentityResult,
            timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
            googleVisualConfigured: false,
            captureZillowComps: fetchZillowLandComps,
            captureRedfinComps: fetchRedfinLandComps,
            compResearchDriver: makeLiveBrowserDriver('comp_research'),
          });
          if (result?.report.parcelVerified) ensurePublicIntelligenceMission(dealCardId, 'parallel resolution');
          logger.info({ event: 'acquire_run', ok: true, matched: true, parallelConfirmed: true, dealCardId, pipeline: 'parallel_resolution' }, 'acquire_run_parallel_confirmed');
          return c.json({
            ok: true, matched: true, parcelVerified: result?.report.parcelVerified === true, dealCardId,
            status: 'parallel_confirmed', confidence: 0.9,
            message: `Parcel confirmed by parallel resolution (${parallel.confirmationBasis}). Downstream intelligence ran automatically.`,
            lanesAttempted: resolution.lanesAttempted,
            parallelResolution: { laneAgreement: parallel.laneAgreement, lanes: parallel.lanes.map((l) => ({ lane: l.lane, status: l.status })) },
            reportStatus: result?.report.reportStatus ?? null,
          }, 201);
        }
      } catch (err) { logger.warn({ err, dealCardId }, 'acquire_parallel_escalation_failed'); }
      const gateNote = `Parcel not yet confirmed. ${resolution.identityBasis} Public county and government research remains available; downstream analysis stays on hold until a parcel-level source confirms the subject.`;
      try { addCardNextAction({ cardId: card.id, action: gateNote, createdBy: 'acquire-identity-gate' }); } catch { /* best-effort operator note */ }
      // Capture the resolution trace so the Deal Card opens the Resolution view
      // (candidate parcel) instead of a half-populated Deal Card.
      try { writeResolutionSnapshot(dealCardId, buildResolutionSnapshot(text.trim(), cls.parsedFields, resolution)); } catch { /* snapshot never blocks the card */ }
      logger.info({ event: 'acquire_run', ok: true, matched: true, identityEstablished: false, gated: true, confidence: resolution.confidence, dealCardId, pipeline: 'property_resolution' }, 'acquire_run_identity_gate');
      return c.json({
        ok: true, matched: true, identityEstablished: false, parcelVerified: false, dealCardId,
        status: 'resolution_pending', confidence: resolution.confidence,
        matchedReason: resolution.matchedReason,
        identityBasis: resolution.identityBasis,
        message: `Property matched but the parcel is not yet confirmed. ${resolution.identityBasis} Downstream Property Intelligence, comparables, and Market Pulse are on hold until Property Resolution confirms the parcel.`,
        confirmBeforeOffer: resolution.missing,
        sources: p.sources,
        pipeline: 'property_resolution',
        browserSessionStatus: browserStart.status,
        browserEscalated: (resolution.browserEvidence ?? []).some((b) => b.status !== 'parked'),
      }, 201);
    }

    // ── Auto-surface Browser Intelligence ───────────────────────────────────
    // Property Resolution already continued into Browser Intelligence when Realie
    // could not verify (LandPortal-first, then County Records — see resolveProperty
    // lanes). Persist those retrieved facts to the Deal Card so Browser
    // Intelligence appears AUTOMATICALLY; the operator never has to trigger it.
    try {
      const streamed = new Set<string>();
      for (const bev of resolution.browserEvidence ?? []) {
        for (const f of bev.facts ?? []) {
          const key = `${f.key}|${f.sourceUrl}`;
          if (streamed.has(key)) continue; streamed.add(key);
          try { writeBrowserFact(dealCardId, f); } catch { /* one fact failing never blocks the card */ }
        }
      }
      const inspectionResult = await runPropertyInspection({
        cardId: card.id,
        searchKey: { address: subjectAddress, apn: p.apn, apnAlternates: tf.apnAlternates, owner: p.owner, city: p.city, county: p.county, state: p.state, zip: tf.zip },
        existingEvidence: resolution.browserEvidence ?? [],
        timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      }, {
        landPortalBrowser: undefined,
        countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
        googleVisualConfigured: false,
      });
      persistPropertyInspection(card.id, inspectionResult.inspection);
      if (streamed.size) logger.info({ event: 'acquire_browser_intel', dealCardId, facts: streamed.size }, 'acquire_browser_intel_persisted');
      // Browser Intelligence Vision: LOOK at the screenshots just captured
      // (LandPortal parcel/3D/overlays/comps + Google satellite) and write
      // land-investor visual observations onto the card, so the complete package
      // is assembled by acquire itself — the operator never has to trigger a
      // separate report to get the visual read. Best-effort; never blocks acquire.
      try {
        const { runBrowserVisionForCard } = await import('./browser-vision.js');
        const vres = await runBrowserVisionForCard(card.id);
        logger.info({ event: 'browser_vision', cardId: card.id, ok: vres.ok, merged: vres.merged, analyzed: vres.analysis.analyzed.length, skipped: vres.analysis.skipped.length }, 'acquire_browser_vision_run');
      } catch (err) { logger.warn({ err, cardId: card.id }, 'acquire_browser_vision_failed'); }
    } catch { /* non-fatal surfacing */ }
    // MULTI-PARCEL: a lead can reference more than one parcel. The primary parcel
    // is resolved above; every OTHER parcel is PRESERVED and surfaced as
    // unresolved with an explicit next action — never silently discarded, never
    // treated as the whole lead.
    if (tf.parcels && tf.parcels.length > 1) {
      const resolvedApn = (p.apn || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
      const remaining = tf.parcels.filter((x) => x.replace(/[^0-9a-z]/gi, '').toLowerCase() !== resolvedApn);
      if (remaining.length) {
        try { attachCardActivity({ cardId: card.id, agentId: 'acquire', kind: 'multi_parcel', summary: `Lead references ${tf.parcels.length} parcels (${tf.parcels.join(', ')}). Resolved: ${p.apn || 'primary'}. Unresolved: ${remaining.join(', ')}.` }); } catch { /* best-effort */ }
        try { addCardNextAction({ cardId: card.id, action: `Resolve remaining parcel${remaining.length > 1 ? 's' : ''}: ${remaining.join(', ')} — this lead has ${tf.parcels.length} parcels.`, createdBy: 'acquire-multi-parcel' }); } catch { /* best-effort */ }
      }
    }
    if (hasCriticalParcelGaps(p)) {
      const browserStatuses = (resolution.browserEvidence ?? []).map((b) => `${b.service}:${b.status}`).join(', ') || 'none';
      const note = `Public research completed with gaps (${browserStatuses}). Still needed: ${resolution.missing.join(', ') || 'critical parcel facts'}. Optional sources did not block this result.`;
      try { addCardNextAction({ cardId: card.id, action: note, createdBy: 'acquire-browser-escalation' }); } catch { /* best-effort operator note */ }
    }
    // Run the full production DD report. Property Resolution ALREADY verified the
    // parcel moments ago (Realie/LandPortal) with full land facts; hand that result
    // to the report as prefetchedVerification so it does NOT re-verify — one
    // provider lookup, one source of truth. When the parcel was confirmed by the
    // browser lane instead (no verify result), the report reuses the persisted
    // verified card (no provider call either).
    const result = await runDealCardReport(dealCardId, {
      resolve: resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      prefetchedVerification: resolution.verifiedData,
      googleVisualConfigured: false,
      captureZillowComps: fetchZillowLandComps,
      captureRedfinComps: fetchRedfinLandComps,
      compResearchDriver: makeLiveBrowserDriver('comp_research'),
    });
    const reportVerified = result?.report.parcelVerified === true;
    if (reportVerified) ensurePublicIntelligenceMission(dealCardId, 'acquire run');
    logger.info({ event: 'acquire_run', ok: true, matched: true, parcelVerified: reportVerified, confidence: resolution.confidence, dealCardId, pipeline: 'property_resolution' }, 'acquire_run');
    return c.json({
      ok: true, matched: true,
      parcelVerified: reportVerified,
      dealCardId,
      multiParcel: tf.parcels && tf.parcels.length > 1 ? { count: tf.parcels.length, parcels: tf.parcels, resolved: p.apn ?? null } : null,
      confidence: resolution.confidence,
      matchedReason: resolution.matchedReason,
      // Unknown practical fields surface in the UI as Confirm Before Offer.
      confirmBeforeOffer: resolution.missing,
      sources: p.sources,
      pipeline: 'property_resolution',
      browserSessionStatus: browserStart.status,
      browserEscalated: (resolution.browserEvidence ?? []).some((b) => b.status !== 'parked'),
      landPortalBrowserVerified: browserVerified,
      landPortalScreenshotCount: browserProof.screenshotCount,
      reportStatus: result?.report.reportStatus ?? null,
    }, 201);
  });

  // ── Smart Address Search (free/open providers; no paid dependency) ────────
  // Autocomplete for the Universal Intake. Photon (OSM) then US Census, both
  // free/keyless. Min-chars + caching handled in the module; debounce in the UI.
  app.get('/api/landos/address/suggest', async (c) => {
    const q = str(c.req.query('q')) ?? '';
    const result = await suggestAddresses(q);
    return c.json(result);
  });

  // ── Universal Smart Intake classification (the permanent front door) ──────
  // Classifies raw input and routes it to the owning department's intent. Only
  // property_resolution is operational; others route as registered shells.
  app.post('/api/landos/intake/classify', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    // smartIntake adds the front-door intelligence layer: APN normalization,
    // the identity confidence engine, and deal-intelligence categorization with
    // evidence status. classification stays for backward compatibility.
    return c.json({
      classification: classifySmartIntake(text),
      smartIntake: buildSmartIntake(text),
      registeredIntents: listIntakeIntents(),
    });
  });

  // ── Conversational Smart Intake — New Lead as a conversation ─────────────
  // The operator talks; LandOS extracts structured identity + deal intelligence
  // over the FULL conversation while preserving every raw operator turn. Pure
  // and deterministic — the reply acknowledges what was understood and asks for
  // the single most valuable missing identifier. Never rewrites input.
  app.post('/api/landos/intake/conversation', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const messages = Array.isArray(body.messages) ? (body.messages as IntakeMessage[]) : [];
    const cleaned = messages.filter(
      (m) => m && (m.role === 'operator' || m.role === 'landos') && typeof m.text === 'string',
    );
    return c.json({ conversation: buildIntakeConversation(cleaned) });
  });

  // ── Property Resolution Engine (read-only: resolve identity, write nothing) ─
  // Matched | Needs Clarification with the canonical NormalizedProperty + the
  // lane-by-lane trace. Free Census/Photon + budgeted Realie exact resolve;
  // browser lanes parked. Never opens an empty shell.
  app.post('/api/landos/property/resolve', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const cls = classifySmartIntake(text.trim());
    await ensureBrowserSession();
    const resolution = await resolveProperty(
      { rawText: text.trim(), fields: cls.parsedFields },
      liveResolutionDeps(LANDPORTAL_VERIFICATION_TIMEOUT_MS),
    );
    const session = await browserSessionHealth();
    return c.json({ classification: cls, resolution, browserLanes: browserLaneStatus(), session });
  });

  // Persistent browser session status/health. Reports live / disabled /
  // unreachable / auth_needed. NEVER returns cookies, tokens, or credentials.
  app.get('/api/landos/browser/session', async (c) => {
    return c.json({ session: await browserSessionHealth() });
  });

  // READ-ONLY Browser Intelligence + LandPortal readiness for the New Lead panel.
  // Reports the granular phase, whether env credentials are configured, and the
  // NAMES of any missing credential vars (never values). Does not start/log in.
  app.get('/api/landos/browser/readiness', async (c) => {
    const session = await browserSessionHealth();
    const { creds, missing } = readLandPortalCreds();
    const credentialsConfigured = !!creds;
    const phase =
      session.status === 'live' && session.landportalAuthenticated === true ? 'authenticated'
      : session.status === 'live' || session.status === 'auth_needed' ? 'browser_live'
      : session.status === 'disabled' ? 'disabled'
      : 'not_running';
    const note = phase === 'authenticated' ? 'LandPortal authenticated — ready.'
      : phase === 'browser_live' ? (credentialsConfigured ? 'Browser live — LandPortal will sign in automatically on run.' : `Browser live — LandPortal login needs credentials: set ${missing.join(' and ')} in .env.`)
      : phase === 'disabled' ? 'Live browser disabled — set BROWSER_INTEL_LIVE=1.'
      : (credentialsConfigured ? 'Browser Intelligence not running — it starts automatically on run.' : `Not running; also missing credentials: set ${missing.join(' and ')} in .env.`);
    return c.json({ readiness: { phase, sessionStatus: session.status, ready: phase === 'authenticated', landportalAuthenticated: session.landportalAuthenticated, credentialsConfigured, missingEnv: missing, note }, session });
  });

  // Start Browser Intelligence AND log into LandPortal from env credentials —
  // fully automatic. Returns the granular readiness with an exact technical
  // reason on failure. Never returns/logs credentials.
  app.post('/api/landos/browser/ensure-auth', async (c) => {
    const readiness = await ensureLandPortalAuthenticated();
    return c.json({ readiness, session: await browserSessionHealth() });
  });

  // Browser Intelligence's LEARNED SITE NAVIGATION MODELS — the reusable, task-
  // agnostic "how is this website navigated" knowledge that every department
  // shares. Read-only; describes movement, never page data. Operator-visible on
  // the Browser Agent dashboard so learning is auditable.
  app.get('/api/landos/browser/navigation-models', (c) => {
    const models = listNavigationModels().map((m) => ({
      platform: m.platform,
      version: m.version,
      classification: m.classification,
      searchFunctions: m.searchFunctions,
      searchModes: m.searchModes,
      supportedIdentifiers: m.supportedIdentifiers,
      requiredSelectors: m.requiredSelectors,
      mandatoryFields: m.mandatoryFields,
      fieldOrder: m.fieldOrder,
      resultAccess: m.resultAccess,
      detailAccess: m.detailAccess,
      tabs: m.tabs,
      filters: m.filters,
      layers: m.layers,
      mapTools: m.mapTools,
      documentAccess: m.documentAccess,
      exportAccess: m.exportAccess,
      navigationDependencies: m.navigationDependencies,
      successSignals: m.successSignals,
      failureSignals: m.failureSignals,
      authRequired: m.authRequired,
      timesReused: m.timesReused,
      updatedAt: m.updatedAt,
    }));
    const playbooks = listSitePlaybooks().map((p) => ({ platform: p.platform, taskType: p.taskType, version: p.version, timesReused: p.timesReused, updatedAt: p.updatedAt }));
    return c.json({ navigationModels: models, taskPlaybooks: playbooks });
  });

  // Property Inspection capability: runs independently of Acquisition but uses
  // the same existing providers and persistence surface. Acquisition consumes the
  // resulting package; future departments can reuse the same capability.
  app.post('/api/landos/property-inspection/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const dealCardId = Number(body.dealCardId);
    if (!Number.isInteger(dealCardId)) return c.json({ error: 'dealCardId required' }, 400);
    const deal = getDealCard(dealCardId);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const prop = (deal.propertyCards?.[0] ?? {}) as { id?: number; active_input_address?: string | null; apn?: string | null; county?: string | null; state?: string | null; city?: string | null; owner?: string | null };
    const cardId = Number(prop.id);
    if (!Number.isInteger(cardId)) return c.json({ error: 'subject property card not found' }, 400);
    const searchKey = {
      address: str(prop.active_input_address ?? undefined),
      apn: str(prop.apn ?? undefined),
      county: str(prop.county ?? undefined),
      state: str(prop.state ?? undefined),
      city: str(prop.city ?? undefined),
      owner: str(prop.owner ?? undefined),
    };
    await ensureBrowserSession();
    const landPortalBrowser = makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') });
    const countyRecordsBrowser = makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') });
    const result = await runPropertyInspection({
      cardId,
      searchKey,
      mode: str(body.mode) === 'deep_record' ? 'deep_record' : 'parcel_fact',
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
    }, {
      landPortalBrowser,
      countyRecordsBrowser,
      googleVisualConfigured: googleVisualConfiguredResolved(),
    });
    persistPropertyInspection(cardId, result.inspection);
    const persisted = loadPropertyInspection(cardId);
    const inspection = persisted
      ? {
          ...persisted,
          assets: persisted.assets.map((asset) => ({
            key: asset.key,
            label: asset.label,
            kind: asset.kind,
            timestamp: asset.timestamp,
            overlay: asset.overlay,
            note: asset.note,
            url: `/api/landos/inspection/image?cardId=${cardId}&key=${encodeURIComponent(asset.key)}`,
          })),
        }
      : null;
    return c.json({ dealCardId, cardId, inspection, routes: result.routes, session: await browserSessionHealth() });
  });

  // Start Browser Intelligence: reuse the persistent Chrome session if already
  // running, else launch GOOGLE CHROME (never Edge) with the dedicated LandOS
  // profile + remote debugging, then connect. One profile reused across leads;
  // never stores a credential. Returns status/launch result (no cookies/tokens).
  app.post('/api/landos/browser/start', async (c) => {
    const result = await startBrowserSession();
    return c.json({ start: result });
  });

  // Open LandPortal in the session for a one-time manual login + auth detection
  // (read-only navigation). After login, Refresh Status detects authentication.
  app.post('/api/landos/browser/open-landportal', async (c) => {
    const result = await openLandPortalInSession();
    return c.json({ landportal: result });
  });

  // Read the persistent County Source Map (reusable NETR-routed county sources).
  // Public routing metadata only — no secrets/cookies.
  app.get('/api/landos/county-source-map', (c) => {
    const state = str(c.req.query('state')) ?? '';
    const county = str(c.req.query('county')) ?? '';
    if (!state || !county) return c.json({ error: 'state and county required' }, 400);
    return c.json({ countySourceMap: getCountySources(state, county) });
  });

  app.get('/api/landos/research-access', async (c) => {
    const state = str(c.req.query('state')) ?? '';
    const county = str(c.req.query('county')) ?? '';
    const registry = new CountyCapabilityRegistry();
    const accounts = new SqliteGovernmentAccountRepository().list().map((account) => ({
      accountId: account.accountId,
      siteDomain: account.siteDomain,
      governmentJurisdiction: account.governmentJurisdiction,
      platform: account.platform,
      purpose: account.purpose,
      accountStatus: account.accountStatus,
      emailVerificationStatus: account.emailVerificationStatus,
      recoveryStatus: account.recoveryStatus,
      sessionState: account.sessionState,
      humanActionRequired: account.humanActionRequired,
      humanActionReason: account.humanActionReason,
      failureReason: account.failureReason,
      lastSuccessfulLogin: account.lastSuccessfulLogin,
    }));
    return c.json({
      countyCapability: state && county ? registry.get(state, county) : null,
      accounts,
      identity: (await managedIdentityStatus(new ManagedIdentityRepository(), new EnvironmentManagedEmailProvider())).identity,
      managedEmail: (await managedIdentityStatus(new ManagedIdentityRepository(), new EnvironmentManagedEmailProvider())).managedEmail,
      credentialStorage: {
        available: await new WindowsCredentialVault().isAvailable(),
        reason: (await new WindowsCredentialVault().isAvailable()) ? 'Windows DPAPI credential vault is available.' : 'Windows DPAPI credential vault unavailable.',
      },
    });
  });

  app.get('/api/landos/deal-cards/:id/public-intelligence', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const stored = new PublicIntelligenceStore().load(id);
    // Serve the run with its flood overlay pinned to the mapped GIS geometry, so
    // the DD Public Property Intelligence panel matches /report and the acreage
    // basis (an overlay never exceeds the mapped parcel).
    const publicIntelligence = stored ? { ...stored, run: pinRunOverlaysToGeometry(stored.run) } : stored;
    return c.json({ publicIntelligence });
  });

  // Shared public-intelligence mission runner — the SAME path whether the
  // operator clicks "run" or parcel confirmation auto-continues downstream.
  const runPublicIntelligenceForDealCard = async (id: number): Promise<
    | { ok: true; saved: unknown; parcel: { address: string | null; county: string | null; state: string | null; apn: string | null; acres: number | null; sourceUrl: string | null } }
    | { ok: false; error: string; attempted?: unknown }
  > => {
    const deal = getDealCard(id);
    if (!deal) return { ok: false, error: 'deal card not found' };
    const property = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const rawInput = str(property.active_input_address) ?? str(property.address) ?? '';
    // County backfill: statewide adapters key on the county; when the card lacks
    // one, derive it from the address via the free Census geocoder (context
    // only — never identity).
    let lookupCounty = str(property.county);
    if (!lookupCounty && rawInput) {
      try {
        const { deriveCounty } = await import('./providers/county-geocode.js');
        const g = await deriveCounty({ address: rawInput, city: str(property.city), state: str(property.state) });
        if (g?.county) lookupCounty = g.county;
      } catch { /* county backfill is best-effort */ }
    }
    const lookup = await lookupOfficialParcel({
      address: str(property.active_input_address) ?? str(property.address),
      county: lookupCounty, state: str(property.state), apn: str(property.apn),
    }, 25_000);
    if (!lookup.parcel) {
      return { ok: false, error: 'confirmed official parcel is required before public property intelligence runs', attempted: lookup.attempted };
    }
    const parcel = lookup.parcel;
    const run = await runPublicPropertyIntelligence(
      publicSubjectFromOfficialParcel(parcel, rawInput),
      { adapters: makeLivePublicIntelligenceAdapters(parcel), captureMode: 'live', defaultTimeoutMs: 30_000, maxTimeoutMs: 60_000 },
    );
    const saved = new PublicIntelligenceStore().save(id, parcel.apn, run);
    const cardId = subjectCardId(deal);
    if (cardId) {
      try {
        const officialEvidence = run.tasks.find((task) => task.task === 'county_records')?.evidence.find((item) => item.sourceTier === 'official_county_state');
        if (officialEvidence) {
          const existing = (getPropertyCard(cardId)?.sourceEvidence ?? []) as Array<{ fact?: string; source_url?: string }>;
          const facts = [['Parcel identity', parcel.address], ['Owner', parcel.owner], ['APN', parcel.apn], ['Acreage', parcel.acres == null ? null : `${parcel.acres} ac`]] as const;
          for (const [fact, value] of facts) {
            if (existing.some((row) => row.fact === fact && row.source_url === officialEvidence.sourceUrl)) continue;
            attachCardSourceEvidence({
              cardId,
              fact,
              value: value ?? undefined,
              sourceUrl: officialEvidence.sourceUrl,
              sourceLabel: officialEvidence.sourceName,
              dateAccessed: officialEvidence.retrievedAt,
              note: `Official public parcel record; supports ${fact.toLowerCase()}. Public GIS is not a deed, title commitment, survey, or legal-boundary determination.`,
              parcelVerified: true,
            });
          }
        }
      } catch { /* evidence attachment is best-effort; the saved run remains authoritative */ }
    }
    try {
      attachCardActivity({
        cardId: Number(property.id), agentId: 'public-property-intelligence', kind: 'public_screening',
        summary: `Public property screening completed: ${run.tasks.filter((task) => task.status === 'succeeded').length}/${run.tasks.length} provider tasks succeeded.`,
        ref: JSON.stringify({ status: run.status, parcelKey: parcel.apn }),
      });
    } catch { /* public evidence persistence must not fail because activity history is unavailable */ }
    return { ok: true, saved, parcel: { address: parcel.address, county: parcel.county, state: parcel.state, apn: parcel.apn, acres: parcel.acres ?? null, sourceUrl: parcel.sourceUrl ?? null } };
  };

  // ── Automatic downstream continuation ──────────────────────────────────────
  // Parcel confirmation is the START of Property Intelligence, not the end of
  // the pipeline. Whenever a report run confirms a parcel and no public
  // screening evidence exists yet, the full shared mission is queued in the
  // background: per-lane statuses persist on the run record, one lane's
  // provider failure never blocks the others, and reruns are guarded so a
  // mission is never duplicated. Free approved sources only — no paid call.
  const publicIntelInFlight = new Set<number>();
  const ensurePublicIntelligenceMission = (dealCardId: number, trigger: string): void => {
    try {
      const existing = new PublicIntelligenceStore().load(dealCardId)?.run;
      if (existing && (existing.status === 'complete' || existing.status === 'complete_with_gaps')) return;
      if (publicIntelInFlight.has(dealCardId)) return;
      publicIntelInFlight.add(dealCardId);
      const deal = getDealCard(dealCardId);
      const cardId = deal ? subjectCardId(deal) : null;
      if (cardId) {
        try {
          attachCardActivity({
            cardId, agentId: 'public-property-intelligence', kind: 'public_screening_queued',
            summary: `Public property intelligence mission started automatically after parcel confirmation (${trigger}). Lanes: county records, geometry, FEMA, wetlands, soils/septic, slope, road proximity, zoning, utilities, imagery.`,
          });
        } catch { /* queue visibility is best-effort */ }
      }
      void runPublicIntelligenceForDealCard(dealCardId)
        .then((res) => {
          if (!res.ok && cardId) {
            try {
              attachCardActivity({
                cardId, agentId: 'public-property-intelligence', kind: 'public_screening_blocked',
                summary: `Automatic public screening could not run: ${res.error}. It will retry on the next confirmed report run.`,
              });
            } catch { /* best-effort */ }
          }
        })
        .catch((err) => {
          logger.warn({ err, dealCardId }, 'public_intelligence_auto_run_failed');
          if (cardId) {
            try {
              attachCardActivity({
                cardId, agentId: 'public-property-intelligence', kind: 'public_screening_failed',
                summary: `Automatic public screening errored: ${(err as Error)?.message ?? String(err)}. It will retry on the next confirmed report run.`,
              });
            } catch { /* best-effort */ }
          }
        })
        .finally(() => publicIntelInFlight.delete(dealCardId));
    } catch (err) {
      publicIntelInFlight.delete(dealCardId);
      logger.warn({ err, dealCardId }, 'public_intelligence_ensure_failed');
    }
  };

  app.post('/api/landos/deal-cards/:id/public-intelligence/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const res = await runPublicIntelligenceForDealCard(id);
    if (!res.ok) return c.json({ error: res.error, attempted: res.attempted }, res.error === 'deal card not found' ? 404 : 409);
    return c.json({ publicIntelligence: res.saved, parcel: res.parcel });
  });
  // ── Parallel parcel resolution (Official public + LandPortal, concurrent) ──
  // Tyler's non-negotiable shape: official public sources and LandPortal run as
  // PARALLEL primary evidence lanes, reconciled into one confirmation verdict.
  // System-wide (keyed by card id, no property-specific branch): drives an
  // unresolved lead toward a confirmed parcel without parking on a missing
  // adapter, and records every lane attempt + reconciliation issue on the card.
  // Honors the operator-confirmation rule: it never overwrites an ALREADY
  // accepted APN/owner/etc — a disagreement is recorded and surfaced, not applied.
  app.post('/api/landos/deal-cards/:id/parallel-resolve', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    if (!cardId) return c.json({ error: 'no subject property card' }, 409);
    const property = getPropertyCard(cardId);
    if (!property) return c.json({ error: 'property card not found' }, 404);
    const alreadyVerified = property.verification_status === 'verified_property';
    const acceptedApn = str(property.apn) ?? null;
    const fields: ParsedIntakeFields = {
      address: str(property.active_input_address) ?? undefined,
      apn: acceptedApn ?? undefined,
      county: str(property.county) ?? undefined,
      state: str(property.state) ?? undefined,
      city: str(property.city) ?? undefined,
      owner: str(property.owner) ?? undefined,
      zip: undefined,
    };
    const resolution = await runParallelParcelResolution(fields, LANDPORTAL_VERIFICATION_TIMEOUT_MS);
    const { promoted, operatorConfirmationRequired } = applyParallelResolution({
      dealCardId: id, cardId, entity: deal.entity as LandosEntity, resolution,
      acceptedApn, alreadyVerified,
      activeInputAddress: str(property.active_input_address) ?? null,
      city: str(property.city) ?? null,
    });

    logger.info({ event: 'parallel_resolve', dealCardId: id, confirmed: resolution.confirmed, laneAgreement: resolution.laneAgreement, promoted, operatorConfirmationRequired }, 'parallel_resolve');
    return c.json({
      dealCardId: id,
      parallelResolution: resolution,
      promoted,
      operatorConfirmationRequired,
      alreadyVerified,
    });
  });

  // Parcel overlay evidence maps: self-contained SVGs built from the OFFICIAL
  // parcel geometry over official rasters (county aerial + thematic layers).
  // Cached on disk; every image carries the exact parcel boundary.
  app.get('/api/landos/deal-cards/:id/overlay/:kind', async (c) => {
    const id = Number(c.req.param('id'));
    const kind = c.req.param('kind') as ParcelOverlayKind;
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!PARCEL_OVERLAY_KINDS.includes(kind)) return c.json({ error: 'unknown overlay kind' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const property = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const lookup = await lookupOfficialParcel({
      address: str(property.active_input_address) ?? str(property.address),
      county: str(property.county), state: str(property.state), apn: str(property.apn),
    }, 25_000);
    if (!lookup.parcel) return c.json({ error: 'no confirmed official parcel geometry for this card' }, 409);
    const parcel = lookup.parcel;
    const entry = await getOrBuildParcelOverlay(`card-${id}-${parcel.apn}`, {
      county: parcel.county, state: parcel.state, rings: parcel.geometry.rings, kind,
      title: `${PARCEL_OVERLAY_LABELS[kind]} — ${parcel.address}, ${parcel.county} County, ${parcel.state}`,
      subtitle: `APN ${parcel.apn} · official parcel boundary drawn from ${parcel.provider} · screening evidence, not a survey`,
    });
    if (!entry) return c.json({ error: 'overlay source imagery unavailable for this county' }, 502);
    const svg = fs.readFileSync(entry.filePath, 'utf8');
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=3600' } });
  });

  // Browser Intelligence enrichment for a Deal Card: LandPortal first (operator's
  // logged-in session), then County Records via NETR routing + semantic extraction.
  // Returns provenance-labeled facts + the official sources routed. Read-only; no
  // credentials/paid actions; reuses the persistent Chrome session.
  app.post('/api/landos/deal-cards/:id/browser-intel', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const mode: BrowserSearchMode = str(body.mode) === 'deep_record' ? 'deep_record' : 'parcel_fact';
    const prop = (deal.propertyCards?.[0] ?? {}) as { active_input_address?: string | null; apn?: string | null; county?: string | null; state?: string | null; owner?: string | null; verification_status?: string | null };
    const searchKey = { address: str(prop.active_input_address ?? undefined), apn: str(prop.apn ?? undefined), county: str(prop.county ?? undefined), state: str(prop.state ?? undefined), owner: str(prop.owner ?? undefined) };
    const sellerPerson = (deal.people ?? []).find((p) => { const r = (p as { role?: string }).role; return r === 'seller' || r === 'lead'; }) as { name?: string } | undefined;
    const sellerName = str(sellerPerson?.name);
    const ownerVerified = prop.verification_status === 'verified_property';

    clearCancel(id);
    await ensureBrowserSession();
    // Incremental write: each confidently-found fact lands on the Deal Card now.
    // Never overwrite a verified Realie identity with weaker browser text.
    const verifiedKeys = new Set(ownerVerified ? ['owner', 'apn'] : []);
    const onFact = (f: BrowserFact) => {
      if (verifiedKeys.has(f.key) && f.origin === 'search_fallback') return; // don't override verified with a weaker source
      try { writeBrowserFact(id, f); } catch { /* persist best-effort */ }
    };
    const hooks = { timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS, onFact, isCancelled: () => isCancelled(id) };

    const lp = makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') });
    const county = makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') });
    const landportal = await lp.runWorkflow({ searchKey, mode }, hooks);      // LandPortal first
    const countyRecords = await county.runWorkflow({ searchKey, mode }, hooks); // then County Records
    const cardId = subjectCardId(deal);
    if (cardId) {
      try {
        const inspectionResult = await runPropertyInspection({
          cardId,
          searchKey,
          mode,
          existingEvidence: [landportal, countyRecords],
          timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
        }, {
          landPortalBrowser: lp,
          countyRecordsBrowser: county,
          googleVisualConfigured: googleVisualConfiguredResolved(),
        });
        persistPropertyInspection(cardId, inspectionResult.inspection);
      } catch { /* inspection persistence is best-effort */ }
    }

    // Mark any still-requested items the operator stopped (not Failed/Unknown).
    if (isCancelled(id)) markStoppedByOperator(id, ['owner', 'apn', 'acreage', 'situsAddress', 'landUse', 'assessedValue', 'taxAmount', 'deedRef']);
    clearCancel(id);

    // Inherited / representative seller: a name mismatch NEVER invalidates the
    // parcel. Owner-of-record from official records may be Verified; seller
    // relationship Seller-stated; authority Needs Verification (with tasks).
    const ownerOfRecord = str(prop.owner ?? undefined) ?? (countyRecords.facts.find((f) => f.key === 'owner' && f.status === 'extracted')?.value) ?? (landportal.facts.find((f) => f.key === 'owner')?.value);
    const sellerAuthority = assessSellerAuthority({ sellerName, ownerOfRecord, parcelVerified: ownerVerified, ownerFromOfficialSource: countyRecords.facts.some((f) => f.key === 'owner' && f.status === 'extracted') });

    const session = await browserSessionHealth();
    return c.json({
      dealCardId: id, mode,
      landportal: redactEvidence(landportal),
      countyRecords: redactEvidence(countyRecords),
      sellerAuthority,
      facts: listBrowserFacts(id),
      countySourceMap: searchKey.state && searchKey.county ? getCountySources(searchKey.state, searchKey.county) : null,
      session,
    });
  });

  // Operator cancellation: stop an in-flight browser-intel run. Everything already
  // found stays saved; remaining requested items become "Stopped by Operator".
  app.post('/api/landos/deal-cards/:id/browser-intel/cancel', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    requestCancel(id);
    return c.json({ cancelled: true, dealCardId: id });
  });

  // The incrementally-written browser facts persisted for a Deal Card.
  app.get('/api/landos/deal-cards/:id/browser-facts', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json({ facts: listBrowserFacts(id) });
  });

  // ── Browser Intelligence — Ask Mode (Phase 1) ─────────────────────────────
  // Free-form public-record questions: the layer intelligently determines the
  // workflow (LandPortal vs County Records) — not a fixed command list. Runs the
  // chosen service in read-only ask mode. Parked (honest) until a session exists;
  // never stores a credential, never performs a paid/billing action.
  app.post('/api/landos/browser/ask', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const question = str(body.question) ?? str(body.text);
    if (!question || !question.trim()) return c.json({ error: 'question required' }, 400);
    const ctxRaw = (body.context ?? {}) as Record<string, unknown>;
    const ctx = { address: str(ctxRaw.address), apn: str(ctxRaw.apn), owner: str(ctxRaw.owner), county: str(ctxRaw.county), state: str(ctxRaw.state) };
    const route = routeBrowserQuestion(question.trim(), ctx);
    await ensureBrowserSession();
    const service = route.service === 'landportal'
      ? makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') })
      : makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') });
    const evidence = await service.ask(question.trim(), ctx, { timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS });
    const session = await browserSessionHealth();
    return c.json({ route, evidence, session });
  });

  // On-demand Land Score for a Deal Card's subject parcel. Re-runs the bounded
  // NON-CREDIT LandPortal resolve and scores the 100-pt rubric from the verified
  // attributes. Never spends a comp credit, never scores unverified data.
  app.get('/api/landos/deal-cards/:id/land-score', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    // REUSE the persisted verified Property Card (same as runDealCardReport) so a
    // parcel verified via a persisted browser read scores instead of failing a
    // fresh re-resolve. Only fall back to a live resolve when no verified card is
    // linked. Never scored from unverified data.
    const verifiedCard = (deal.propertyCards as Array<Record<string, unknown>> | undefined)?.find(
      (cd) => cd.verification_status === 'verified_property' &&
        (String(cd.apn ?? '').trim() || String(cd.lp_property_id ?? '').trim() || String(cd.parcel_id ?? '').trim() || String(cd.active_input_address ?? '').trim()),
    );
    const prop = deal.propertyCards?.[0] as { active_input_address?: string | null; apn?: string | null; county?: string | null; state?: string | null } | undefined;
    const identityText = buildIdentityText(deal, getDealCardDd(id));
    const lookup = identityText || prop?.active_input_address || prop?.apn || deal.title;
    if (!lookup) {
      return c.json({ landScore: null, parcelVerified: false, note: 'No parcel identifier on this Deal Card to resolve.' });
    }
    const verification = await runDukeVerification(lookup, {
      resolve: verifiedCard ? buildPersistedResolver(verifiedCard) : resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
    });
    if (!verification.parcelVerified) {
      return c.json({ landScore: null, parcelVerified: false, note: 'Parcel not source-verified — Land Score not computed (never scored from unverified data).' });
    }
    // Consume approved-provider data: verified property data + the LandPortal
    // parcel fact sheet (road frontage, wetlands, FEMA, buildability, acreage,
    // valuation) so LandPortal data is scored, not ignored (2026-07-04 correction).
    const subjectCardId = ((verifiedCard?.id ?? (deal.propertyCards?.[0] as { id?: number } | undefined)?.id)) as number | undefined;
    const inspection = subjectCardId ? loadPropertyInspection(subjectCardId) : null;
    const factSheet = inspection ? buildParcelFactSheet(inspection.parcelFacts) : null;
    // Reuse the persisted live gov-DD (FEMA/NWI/USGS) so Buildability gets the USGS
    // slope cross-check here too (no new fetch; empty gov-DD when no report yet).
    const scoreInputs = landFactsForScore(verification.propertyData, factSheet, getDealCardReport(id).govDd);
    const landScore = computeLandScore(scoreInputs);
    if (landScore && scoreInputs.buildability) {
      const bf = landScore.factors.find((f) => f.id === 'slope_buildability');
      if (bf && !bf.dataGap) {
        bf.basis = scoreInputs.buildability.basis;
        if (scoreInputs.buildability.conflict) landScore.flags.push(`Buildability sources disagree — ${scoreInputs.buildability.basis}.`);
      }
    }
    return c.json({ landScore, parcelVerified: true, note: '' });
  });

  // On-demand SUPPORTING imagery for a Deal Card. Stub returns
  // "visual not captured yet"; live local Playwright is install-gated. Imagery
  // is supporting context only and NEVER verifies parcel identity.
  app.post('/api/landos/deal-cards/:id/imagery', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const prop = deal.propertyCards?.[0] as { active_input_address?: string | null; apn?: string | null; county?: string | null; state?: string | null } | undefined;
    const imagery = await captureImagery({
      address: prop?.active_input_address ?? undefined,
      apn: prop?.apn ?? undefined,
      county: prop?.county ?? undefined,
      state: prop?.state ?? undefined,
    });
    return c.json({ imagery });
  });

  // Cost Control Board: ACTUAL recorded model spend, aggregated by department
  // (workflow), provider, runtime (derived via MODEL_REGISTRY), and model.
  // Numbers only, no labels. Reads recorded spend — never an estimate/suggestion.
  app.get('/api/landos/cost-board', (c) => {
    const rows = getLandosDb()
      .prepare('SELECT agent_id, provider, model, workflow, input_tokens, output_tokens, est_cost_usd FROM landos_model_call')
      .all() as Array<{ agent_id: string; provider: string; model: string; workflow: string; input_tokens: number; output_tokens: number; est_cost_usd: number }>;

    const dept = new Map<string, { usd: number; calls: number }>();
    const prov = new Map<string, { usd: number; calls: number }>();
    const modelAgg = new Map<string, { usd: number; calls: number }>();
    const runtime: Record<'local' | 'cloud' | 'unknown', number> = { local: 0, cloud: 0, unknown: 0 };
    let totalUsd = 0;
    for (const r of rows) {
      const usd = Number(r.est_cost_usd) || 0;
      totalUsd += usd;
      const d = r.workflow || r.agent_id || 'unattributed';
      const dd = dept.get(d) ?? { usd: 0, calls: 0 }; dd.usd += usd; dd.calls += 1; dept.set(d, dd);
      const pp = prov.get(r.provider || 'unknown') ?? { usd: 0, calls: 0 }; pp.usd += usd; pp.calls += 1; prov.set(r.provider || 'unknown', pp);
      const mm = modelAgg.get(r.model || 'unknown') ?? { usd: 0, calls: 0 }; mm.usd += usd; mm.calls += 1; modelAgg.set(r.model || 'unknown', mm);
      const rt = getModel(r.model)?.runtime ?? 'unknown';
      runtime[rt] = (runtime[rt] ?? 0) + usd;
    }
    const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
    const list = (m: Map<string, { usd: number; calls: number }>, key: string) =>
      [...m.entries()].map(([k, v]) => ({ [key]: k, usd: round6(v.usd), calls: v.calls })).sort((a, b) => b.usd - a.usd);
    return c.json({
      totalUsd: round6(totalUsd),
      totalCalls: rows.length,
      byRuntime: { local: round6(runtime.local), cloud: round6(runtime.cloud), unknown: round6(runtime.unknown) },
      byDepartment: list(dept, 'department'),
      byProvider: list(prov, 'provider'),
      byModel: list(modelAgg, 'modelId'),
    });
  });

  // Department registry summary (deeper capability/model-policy registry).
  app.get('/api/landos/department-registry', (c) => c.json({ departments: departmentRegistrySummary() }));

  // ── Knowledge layer + data-provider status (presence-only; NO secrets) ──────
  // Surfaces the selected KnowledgeStore backend (local-fs vs R2) and the active
  // data-provider config so the operator can see live-readiness from the
  // dashboard. r2.missing names only env KEY NAMES, never values; provider
  // `configured` is a boolean derived from key PRESENCE (process.env). No secret
  // value, no network probe, and no connection is made by this endpoint.
  app.get('/api/landos/knowledge/status', (c) => {
    const ks = knowledgeStoreStatus();
    const registry = new DataProviderRegistry();
    const parcelProviders = registry.parcelProviders().map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.configured(), // presence-only boolean
      active: p.id === registry.activeConfig().parcel,
    }));
    return c.json({
      knowledgeStore: { selected: ks.selected, pref: ks.pref, reason: ks.reason, r2: { configured: ks.r2.configured, missing: ks.r2.missing, endpoint: ks.r2.endpoint } },
      dataProviders: { config: DEFAULT_DATA_SOURCES, parcelProviders, realieEnvKey: REALIE_ENV_KEY },
    });
  });

  // Agent knowledge manifest (read-only provenance for the ingestion shell).
  // Validates the agent against the roster; lists raw_training items with their
  // source/type/hash/timestamp — never content, never secrets. Uses the active
  // backend (local-fs today, R2 once configured).
  app.get('/api/landos/knowledge/agents/:agentKey', async (c) => {
    const agentKey = c.req.param('agentKey');
    if (!getAgentDef(agentKey)) return c.json({ error: 'unknown agent (not in roster)' }, 404);
    const { store, backend } = await resolveKnowledgeStore();
    const items = await listAgentKnowledge(agentKey, store);
    return c.json({ agentKey, backend, count: items.length, items });
  });

  // Visual provider readiness (Google). Presence-only (no key, no value, no
  // Google call). Lists the visual services and whether the key is configured.
  app.get('/api/landos/visual/status', (c) => {
    const status = googleVisualStatus({ ...process.env, GOOGLE_MAPS_API_KEY: googleVisualConfiguredResolved() ? 'present' : '' });
    return c.json(status);
  });

  // Serve a captured visual image for a property card (token-gated, read-only).
  // Reads the stored PNG from the gitignored store/visuals; the raw filesystem
  // path is never exposed to the browser. Makes NO Google call. Serves ONLY
  // eligibility-passing assets — an image whose parcel association is missing,
  // ineligible, or superseded is refused even though the file exists.
  app.get('/api/landos/visual/image', (c) => {
    const cardId = Number(c.req.query('cardId'));
    const service = c.req.query('service') ?? '';
    if (!Number.isInteger(cardId)) return c.json({ error: 'invalid cardId' }, 400);
    if (!(VISUAL_SERVICES as readonly string[]).includes(service)) return c.json({ error: 'invalid service' }, 400);
    const asset = loadEligibleCardVisualCapture(cardId)[service];
    if (!asset?.storedPath) return c.json({ error: 'image excluded: parcel association could not be confirmed' }, 404);
    const resolved = path.resolve(asset.storedPath);
    const root = path.resolve(process.cwd(), 'store', 'visuals');
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
    } catch {
      return c.json({ error: 'image not found' }, 404);
    }
  });

  // Serve a persisted LandPortal inspection image for a property card
  // (token-gated, read-only). Stored paths remain server-side only.
  app.get('/api/landos/inspection/image', (c) => {
    const cardId = Number(c.req.query('cardId'));
    const key = c.req.query('key') ?? '';
    if (!Number.isInteger(cardId)) return c.json({ error: 'invalid cardId' }, 400);
    if (!key.trim()) return c.json({ error: 'key required' }, 400);
    const inspection = loadPropertyInspection(cardId);
    const asset = inspection?.assets.find((a) => a.key === key);
    if (!asset?.storedPath) return c.json({ error: 'no captured image' }, 404);
    const resolved = path.resolve(asset.storedPath);
    const root = path.resolve(process.cwd(), 'store', 'visuals');
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
    } catch {
      return c.json({ error: 'image not found' }, 404);
    }
  });

  // Explicit per-property visual capture (the ONLY route that calls Google). One
  // property per call; no bulk, no loop. Captures satellite + Street View, stores
  // locally, persists metadata on the card. Requires GOOGLE_MAPS_API_KEY.
  app.post('/api/landos/property-cards/:id/visual-capture', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!googleVisualConfiguredResolved()) return c.json({ error: 'Google visual not configured (no GOOGLE_MAPS_API_KEY).' }, 400);
    const result = await captureAndPersistCardVisuals(id, { env: resolveGoogleVisualEnv() });
    return c.json(result, result.ok ? 200 : 400);
  });

  // Visual Intelligence — operator-grade multi-source visual workflow. Attempts
  // every source (Google Earth overhead/3D, Street View, LandPortal, LandPortal
  // 3D, County GIS), labels each by source, records an EXACT blocker when a
  // source can't be captured, picks the best hero (static map fallback ONLY),
  // and runs the vision analyzer over the captured imagery. Reuses existing
  // captures/inspection screenshots — makes no paid call, fabricates nothing.
  app.get('/api/landos/property-cards/:id/visual-intelligence', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const raw = loadVisualIntelligence(id);
    if (!raw) return c.json({ cardId: id, record: null });
    // READ-TIME eligibility: a persisted VI record may predate the parcel-
    // association model. Google-derived entries must re-prove association;
    // the hero is recomputed after exclusion. Defense in depth.
    const vi = await import('./visual-intelligence.js');
    const record = vi.sanitizeVisualIntelligenceRecord(
      raw as never,
      { eligibleGoogle: loadEligibleCardVisualCapture(id), rawGoogle: loadCardVisualCapture(id) },
    );
    return c.json({ cardId: id, record });
  });

  app.post('/api/landos/property-cards/:id/visual-intelligence', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const card = getPropertyCardRow(id) as Record<string, unknown> | undefined;
    if (!card) return c.json({ error: 'property card not found' }, 404);
    const inspection = loadPropertyInspection(id);
    const vi = await import('./visual-intelligence.js');
    const { analyzeScreenshots } = await import('./browser-vision.js');
    const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

    const readers = {
      // ELIGIBLE captures only — parcel-association proof required. A raw-intake
      // capture (correct filename, wrong place) never reaches Visual Intelligence.
      loadGoogleVisuals: loadEligibleCardVisualCapture,
      loadInspectionAssets: (cardId: number) =>
        (loadPropertyInspection(cardId)?.assets ?? []).map((a) => ({ key: a.key, label: a.label, kind: a.kind, storedPath: a.storedPath, timestamp: a.timestamp })),
      fileSize: (p: string) => fs.statSync(p).size,
    };

    // Detect a live authenticated Chrome/CDP session; when present, capture live
    // (Google Earth, Street View, LandPortal parcel + 3D) with persistence
    // fallback. When absent, the persistence-derived defaults report the exact
    // per-source blocker (never fabricated).
    let liveCapturers: ReturnType<typeof vi.defaultCapturers> | undefined;
    let sessionStatus = 'unreachable';
    try {
      const session = await import('./browser-session.js');
      sessionStatus = await session.ensureBrowserSession();
      if (sessionStatus === 'live' || sessionStatus === 'auth_needed') {
        const live = await import('./visual-intelligence-live.js');
        const liveDeps = await live.defaultLiveVisualDeps();
        liveCapturers = live.makeLiveVisualCapturers(liveDeps, vi.defaultCapturers(readers));
      }
    } catch { /* live detection failed → defaults report blockers honestly */ }

    const record = await vi.runVisualIntelligenceForCard(
      {
        cardId: id,
        address: (card.active_input_address as string) ?? null,
        lat: numOrNull(card.lat),
        lng: numOrNull(card.lng),
        landPortalUrl: inspection?.parcelUrl ?? (card.lp_url as string) ?? null,
        county: (card.county as string) ?? null,
        state: (card.state as string) ?? null,
      },
      { ...readers, analyze: analyzeScreenshots, persist: saveVisualIntelligence, liveCapturers },
    );
    landosAudit('acquisitions', 'visual_intelligence_run', `card ${id}: hero=${record.hero?.source ?? 'none'}, captured=${record.gallery.length}, session=${sessionStatus}`, { refTable: 'landos_card_activity' });
    return c.json({ cardId: id, sessionStatus, record });
  });

  // Serve a LIVE-captured Visual Intelligence image (Google Earth / Street View /
  // LandPortal live). Reads the stored path from the persisted VI record and only
  // serves files inside the gitignored store/visuals — never an arbitrary path.
  // Eligibility-gated: a source that fails parcel-association is refused here
  // too, even though the file exists.
  app.get('/api/landos/visual-intelligence/image', async (c) => {
    const cardId = Number(c.req.query('cardId'));
    const source = c.req.query('source') ?? '';
    if (!Number.isInteger(cardId)) return c.json({ error: 'invalid cardId' }, 400);
    const rawRec = loadVisualIntelligence(cardId);
    if (!rawRec) return c.json({ error: 'no captured image' }, 404);
    const vi = await import('./visual-intelligence.js');
    const rec = vi.sanitizeVisualIntelligenceRecord(
      rawRec as never,
      { eligibleGoogle: loadEligibleCardVisualCapture(cardId), rawGoogle: loadCardVisualCapture(cardId) },
    ) as { sources?: Array<{ source: string; storedPath?: string; state?: string }> } | null;
    const asset = rec?.sources?.find((s) => s.source === source && s.state === 'captured' && s.storedPath);
    if (!asset?.storedPath) return c.json({ error: 'image excluded: parcel association could not be confirmed' }, 404);
    const resolved = path.resolve(asset.storedPath);
    const root = path.resolve(process.cwd(), 'store', 'visuals');
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
    } catch {
      return c.json({ error: 'image not found' }, 404);
    }
  });

  // County Scorecard (Market Research business intelligence; NOT a Deal Card
  // output). Read-only; metrics are 'unavailable' until a market data source is
  // connected — never fabricated.
  app.get('/api/landos/market/scorecard', async (c) => {
    const { store, backend } = await resolveKnowledgeStore();
    const scorecard = await loadScorecard(store);
    return c.json({ backend, scorecard });
  });

  // ── Market Intelligence — Market Matrix ─────────────────────────────
  // The master market-intelligence database. The database COMPUTES rankings;
  // the AI layer only INTERPRETS. Facts only; unknown is grey, never zero.
  const parseQueryBody = (raw: unknown): MarketQuery => {
    const q = defaultMarketQuery();
    const b = (raw ?? {}) as Partial<MarketQuery>;
    if (isMarketSide(b.side)) q.side = b.side;
    if (isAcreageBand(b.acreageBand)) q.acreageBand = b.acreageBand;
    if (typeof b.period === 'string') q.period = b.period;
    if (b.scope && typeof b.scope === 'object') {
      q.scope = {
        states: Array.isArray(b.scope.states) ? b.scope.states.filter((s): s is string => typeof s === 'string') : undefined,
        counties: Array.isArray(b.scope.counties) ? b.scope.counties.filter((s): s is string => typeof s === 'string') : undefined,
        zips: Array.isArray(b.scope.zips) ? b.scope.zips.filter((s): s is string => typeof s === 'string') : undefined,
      };
    }
    if (Array.isArray(b.thresholds)) {
      q.thresholds = b.thresholds.filter((t) => t && isMarketMetric(t.metric) && ['gte', 'lte', 'gt', 'lt', 'eq'].includes(t.op) && Number.isFinite(t.value));
    }
    if (b.sort && isMarketMetric(b.sort.metric) && (b.sort.direction === 'asc' || b.sort.direction === 'desc')) q.sort = b.sort;
    if (typeof b.limit === 'number' && b.limit > 0) q.limit = Math.floor(b.limit);
    return q;
  };

  app.get('/api/landos/market/matrix/overview', (c) => {
    return c.json({
      coverage: getMatrixCoverage(),
      savedQueries: listMarketQueries(),
      dimensions: { acreageBands: ACREAGE_BANDS, metrics: MARKET_METRICS, sides: MARKET_SIDES },
    });
  });

  // Ingest the captured browser-extraction fixture through the SINGLE pipeline.
  app.post('/api/landos/market/matrix/ingest-fixture', async (c) => {
    const provider = makeFixtureMarketProvider();
    const extraction = await provider.extract();
    const result = ingestMarketSnapshots(extraction.snapshots);
    landosAudit('market-intelligence', 'market_matrix_ingest_fixture', `accepted ${result.accepted} / rejected ${result.rejected}`, { refTable: 'landos_market_snapshot' });
    return c.json({ provider: extraction.provider, status: extraction.status, note: extraction.note, result, coverage: getMatrixCoverage() });
  });

  // Ingest arbitrary payloads (live extraction path + tests use this identical
  // pipeline). Validation rejects invalid records into the review queue.
  app.post('/api/landos/market/matrix/ingest', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const payloads = Array.isArray(body.snapshots) ? body.snapshots : Array.isArray(body) ? body : [];
    const result = ingestMarketSnapshots(payloads);
    landosAudit('market-intelligence', 'market_matrix_ingest', `accepted ${result.accepted} / rejected ${result.rejected}`, { refTable: 'landos_market_snapshot' });
    return c.json({ result, coverage: getMatrixCoverage() });
  });

  // Live Browser Agent extraction → identical ingestion pipeline (honest
  // not_configured until a visual backend is wired; never fabricates rows).
  app.post('/api/landos/market/matrix/extract-live', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = makeLiveBrowserMarketProvider();
    const extraction = await provider.extract({
      state: str(body.state), acreageBand: str(body.acreageBand), side: str(body.side), period: str(body.period),
    });
    const result = extraction.snapshots.length ? ingestMarketSnapshots(extraction.snapshots) : { total: 0, accepted: 0, rejected: 0, items: [] };
    return c.json({ provider: extraction.provider, status: extraction.status, note: extraction.note, result, coverage: getMatrixCoverage() });
  });

  // Execute a MarketQuery (structured OR natural-language). The DB computes the
  // ranking; the explanation reports those exact results (never overrides them).
  app.post('/api/landos/market/matrix/query', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    let query: MarketQuery;
    let parse: ReturnType<typeof parseMarketQuery> | undefined;
    if (typeof body.nl === 'string' && body.nl.trim()) {
      parse = parseMarketQuery(body.nl);
      query = parse.query;
    } else {
      query = parseQueryBody(body.query ?? body);
    }
    const { result, explanation } = runMarketQueryWithExplanation(query);
    return c.json({ query, parse, result, explanation });
  });

  app.get('/api/landos/market/matrix/saved', (c) => c.json({ savedQueries: listMarketQueries() }));

  app.post('/api/landos/market/matrix/saved', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = str(body.name);
    if (!name) return c.json({ error: 'name required' }, 400);
    const query = parseQueryBody(body.query ?? {});
    const id = saveMarketQuery({ name, description: str(body.description) ?? '', query, entity: entityParam(str(body.entity)) ?? null });
    return c.json({ id, savedQueries: listMarketQueries() });
  });

  app.delete('/api/landos/market/matrix/saved/:id', (c) => {
    const ok = deleteMarketQuery(Number(c.req.param('id')));
    return c.json({ deleted: ok, savedQueries: listMarketQueries() });
  });

  app.post('/api/landos/market/matrix/saved/:id/run', (c) => {
    const saved = getMarketQueryById(Number(c.req.param('id')));
    if (!saved) return c.json({ error: 'saved query not found' }, 404);
    const { result, explanation } = runMarketQueryWithExplanation(saved.query);
    return c.json({ saved, query: saved.query, result, explanation });
  });

  app.get('/api/landos/market/matrix/heatmap', (c) => {
    const state = str(c.req.query('state'));
    if (!state) return c.json({ error: 'state required' }, 400);
    const metric = str(c.req.query('metric'));
    const side = str(c.req.query('side'));
    const band = str(c.req.query('band'));
    return c.json(getHeatmapData({
      state,
      metric: (isMarketMetric(metric) ? metric : 'medianPricePerAcre') as MarketMetric,
      side: (isMarketSide(side) ? side : 'sold') as MarketSide,
      acreageBand: (isAcreageBand(band) ? band : '2-5') as AcreageBand,
      period: str(c.req.query('period')),
    }));
  });

  app.get('/api/landos/market/matrix/county/:fips', (c) => {
    const d = getCountyDrilldown(c.req.param('fips'));
    return d ? c.json(d) : c.json({ error: 'county not found in Market Matrix' }, 404);
  });

  app.get('/api/landos/market/matrix/county-ref', (c) => c.json({ counties: listCountyRef(str(c.req.query('state'))) }));

  app.get('/api/landos/market/matrix/review-queue', (c) => c.json({ items: listReviewQueue(str(c.req.query('status')) ?? 'open') }));

  // Flagged snapshots: accepted into the matrix but carrying data-quality flags
  // (e.g. LandPortal STR > 100%) — surfaced for review, never hidden.
  app.get('/api/landos/market/matrix/flagged', (c) => c.json({ flagged: listFlaggedSnapshots() }));

  // Property Card consumption: fallback ZIP → County → County(All) → State.
  app.post('/api/landos/market/matrix/property-resolve', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const band = str(body.acreageBand);
    const side = str(body.side);
    return c.json({
      resolution: resolveMarketMatrix({
        state: str(body.state), county: str(body.county), zip: str(body.zip),
        acreageBand: isAcreageBand(band) ? band : undefined,
        side: isMarketSide(side) ? side : undefined,
      }),
    });
  });

  // ── Browser Agent — its own employee; owns browser automation ───────
  // The Browser Agent EXECUTES Browser Playbooks and returns validated-shape
  // data. Market Intelligence delegates market collection here. The agent never
  // permanently knows any website; LandPortal Market Research is Playbook #1.
  const browserAgentSummary = () => {
    const operationalBackend = pickMarketResearchBackend('operational');
    const info = playbookInfo(landportalMarketResearchPlaybook, operationalBackend);
    const runs = listBrowserAgentRuns(undefined, 50);
    return {
      employee: { id: 'browser_agent', name: 'Web', role: 'Browser automation and Browser Playbook execution' },
      liveVisualNavigation: 'not_wired' as const,
      liveVisualNote: 'No authenticated visual browser backend is wired in this environment. The operational backend is the captured Drill Deep replay (identical pipeline); a real live session would implement the same MarketResearchBackend and fail honestly (awaiting_authentication) until authenticated.',
      playbooks: [{
        ...info,
        acreageBands: Object.entries(DRILL_DEEP_ACREAGE_LABEL).map(([band, label]) => ({ band, uiLabel: label, supported: label !== null })),
        pageState: { status: 'Sold', data: 'Land', time: '1 Year', acreage: '2–5 Acres' },
      }],
      totals: { runs: runs.length, lastRunAt: runs[0]?.createdAt ?? null },
      recentRuns: runs.slice(0, 10),
    };
  };

  app.get('/api/landos/browser-agent/status', (c) => c.json(browserAgentSummary()));

  app.get('/api/landos/browser-agent/runs', (c) => {
    const playbook = str(c.req.query('playbook'));
    return c.json({ runs: listBrowserAgentRuns(playbook, 50) });
  });

  // Run the LandPortal Market Research playbook via the Browser Agent. mode:
  // 'operational' (default) uses the captured Drill Deep replay and flows results
  // through the IDENTICAL ingestion pipeline; 'live' uses a real visual session
  // (parked here → honest not_configured/awaiting_authentication, no fabrication).
  app.post('/api/landos/browser-agent/playbooks/:id/run', async (c) => {
    const id = c.req.param('id');
    if (id !== LANDPORTAL_MARKET_PLAYBOOK_ID) return c.json({ error: `unknown playbook "${id}"` }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const state = (str(body.state) ?? 'GA').toUpperCase();
    const band = str(body.acreageBand);
    const side = str(body.side);
    const mode = str(body.mode) === 'live' ? 'live' as const : 'operational' as const;
    if (band && isAcreageBand(band) && !isSupportedBand(band)) {
      return c.json({ error: `acreage band "${band}" not supported yet (v1: 2–5 acres)` }, 400);
    }
    const delegation = await delegateMarketResearchToBrowserAgent(
      { state, acreageBand: isAcreageBand(band) ? band : undefined, side: isMarketSide(side) ? side : undefined },
      { mode },
    );
    landosAudit('browser-agent', 'browser_playbook_run', `${id} (${mode}) → ${delegation.run.status}; captured ${delegation.run.rowsCaptured} accepted ${delegation.run.rowsAccepted} flagged ${delegation.run.rowsFlagged} rejected ${delegation.run.rowsRejected}`, { refTable: 'landos_browser_agent_run' });
    const ing = delegation.ingest;
    const sample = (cat: string) => (ing?.items ?? []).filter((i) => i.category === cat).slice(0, 3).map((i) => ({ label: i.label, reasons: cat === 'rejected' ? i.errors : i.flags }));
    return c.json({
      run: delegation.run,
      allowedScope: LANDPORTAL_MARKET_ALLOWED_SCOPE,
      note: delegation.extraction.note,
      diagnostics: delegation.extraction.diagnostics ?? null,
      // Data-quality report: counts + WHY records entered each category.
      dataQuality: ing ? {
        total: ing.total, accepted: ing.accepted, flagged: ing.flagged, unknown: ing.unknown, rejected: ing.rejected,
        samples: { flagged: sample('flagged'), rejected: sample('rejected'), unknown: sample('unknown') },
      } : null,
      ingest: ing,
      coverage: getMatrixCoverage(),
    });
  });

  // ── Browser Training Department ─────────────────────────────────────
  // Teach browser agents by demonstration. Sessions are started manually here;
  // the realtime voice/vision loop runs over the /ws/landos/training socket.
  app.get('/api/landos/training/sessions', (c) =>
    c.json({ sessions: listTrainingSessions(50), usage: usageRollup() }),
  );

  app.post('/api/landos/training/sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const surface = str(body.surface);
    const session = startSession({
      title: str(body.title) ?? '',
      website: str(body.website) ?? '',
      surface: surface === 'window' || surface === 'desktop' ? surface : 'tab',
      dealCardId: Number.isFinite(Number(body.dealCardId)) ? Number(body.dealCardId) : null,
    });
    return c.json({ session });
  });

  app.get('/api/landos/training/sessions/:id', (c) => {
    const id = Number(c.req.param('id'));
    const session = getTrainingSession(id);
    if (!session) return c.json({ error: 'not found' }, 404);
    return c.json({ session, events: listTrainingEvents(id), knowledge: listTrainingKnowledge({ sessionId: id }) });
  });

  // Record a browser event from the front-end (security guard runs server-side).
  app.post('/api/landos/training/sessions/:id/events', async (c) => {
    const id = Number(c.req.param('id'));
    if (!getTrainingSession(id)) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = str(body.kind);
    if (kind !== 'nav' && kind !== 'click' && kind !== 'input' && kind !== 'screenshot') {
      return c.json({ error: 'invalid kind' }, 400);
    }
    const res = recordBrowserEvent({
      sessionId: id,
      kind,
      url: str(body.url),
      selector: str(body.selector),
      controlText: str(body.controlText),
      field: (body.field as { name?: string; type?: string; value?: string }) ?? undefined,
    });
    return c.json({ approvalRequired: res.approvalRequired, reason: res.reason, seq: res.stored.seq });
  });

  // End a session, then synthesize a draft playbook + extract knowledge.
  app.post('/api/landos/training/sessions/:id/end', async (c) => {
    const id = Number(c.req.param('id'));
    if (!getTrainingSession(id)) return c.json({ error: 'not found' }, 404);
    endSession(id, 'ended');
    const playbook = await synthesizePlaybook(id);
    const knowledge = await extractKnowledge(id);
    return c.json({ playbook, knowledge });
  });

  // Playbooks: list latest, versions, edit (new version), approve/reject.
  app.get('/api/landos/training/playbooks', (c) => c.json({ playbooks: listLatestPlaybooks(50) }));

  app.get('/api/landos/training/playbooks/:id', (c) => {
    const pb = getTrainingPlaybook(Number(c.req.param('id')));
    if (!pb) return c.json({ error: 'not found' }, 404);
    return c.json({ playbook: pb, versions: listPlaybookVersions(pb.slug) });
  });

  app.post('/api/landos/training/playbooks/:id/edit', async (c) => {
    const id = Number(c.req.param('id'));
    if (!getTrainingPlaybook(id)) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const next = editPlaybook(id, (body.body as Record<string, unknown>) ?? {}, str(body.name));
    return c.json({ playbook: next });
  });

  app.post('/api/landos/training/playbooks/:id/decide', async (c) => {
    const id = Number(c.req.param('id'));
    if (!getTrainingPlaybook(id)) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const decision = str(body.decision) === 'approved' ? 'approved' : 'rejected';
    const pb = decidePlaybook(id, decision, str(body.decidedBy) ?? 'Tyler');
    landosAudit('browser-training', `training_playbook_${decision}`, `${pb.slug} v${pb.version}`, {
      refTable: 'landos_training_playbook',
      refId: pb.id,
    });
    return c.json({ playbook: pb });
  });

  // Replay an approved/draft playbook against a test property via CDP.
  app.post('/api/landos/training/playbooks/:id/replay', async (c) => {
    const id = Number(c.req.param('id'));
    const pb = getTrainingPlaybook(id);
    if (!pb) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const vars = (body.vars as Record<string, string>) ?? {};
    const result = await replayPlaybook(
      pb.body as never,
      async () => {
        const held = await withWorkingPage(async (page) => page);
        if (!held.ok || !held.value) throw new Error(`browser session ${held.status}`);
        return held.value;
      },
      { vars },
    );
    return c.json({ result });
  });

  // Execute an APPROVED trained playbook through the Browser Agent executor.
  // Dry-run by default; live must be explicit. Paid actions auto-stop.
  app.post('/api/landos/training/playbooks/:id/execute', async (c) => {
    const id = Number(c.req.param('id'));
    const pb = getTrainingPlaybook(id);
    if (!pb) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = str(body.mode) === 'live' ? 'live' : 'dry_run';
    const vars = (body.vars as Record<string, string>) ?? {};
    const dealCardId = Number.isFinite(Number(body.dealCardId)) ? Number(body.dealCardId) : undefined;
    const result = await runTrainedPlaybook(id, { mode, vars, dealCardId });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ execution: result.execution, agentRunId: result.agentRunId });
  });

  app.get('/api/landos/training/playbooks/:id/executions', (c) => {
    const id = Number(c.req.param('id'));
    if (!getTrainingPlaybook(id)) return c.json({ error: 'not found' }, 404);
    return c.json({ executions: listTrainingExecutions(id, 25) });
  });

  // Knowledge: confirm/save or discard extracted knowledge at session end.
  app.get('/api/landos/training/knowledge', (c) =>
    c.json({ knowledge: listTrainingKnowledge({ status: 'proposed' }) }),
  );
  app.post('/api/landos/training/knowledge/:id/decide', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const save = str(body.decision) === 'save';
    setKnowledgeStatus(id, save ? 'saved' : 'discarded');
    landosAudit('browser-training', `training_knowledge_${save ? 'saved' : 'discarded'}`, `knowledge ${id}`, {
      refTable: 'landos_training_knowledge',
      refId: id,
    });
    return c.json({ ok: true });
  });

  app.get('/api/landos/training/usage', (c) => c.json({ usage: usageRollup() }));

  // ── Source Evidence Standard check ──────────────────────────────────
  app.post('/api/landos/source-evidence/check', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = str(body.kind) ?? 'fact';
    if (kind === 'comp') return c.json({ result: evaluateComp(body as never) });
    if (kind === 'zoning') return c.json({ result: evaluateZoning(body as never) });
    if (!str(body.fact)) return c.json({ error: 'fact required for kind=fact' }, 400);
    return c.json({ result: evaluateFact(body as never) });
  });

  // Scenario preview: internal underwriting math only. Never seller-facing.
  app.post('/api/landos/strategies/evaluate', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ev = Number((body as Record<string, unknown>).expectedValueUsd);
    if (!Number.isFinite(ev) || ev <= 0) {
      return c.json({ error: 'expectedValueUsd must be a positive number' }, 400);
    }
    const scenarios = evaluateStrategies({
      expectedValueUsd: ev,
      acres: Number((body as Record<string, unknown>).acres) || undefined,
      verifiedManufacturedSalesUsd: Array.isArray((body as Record<string, unknown>).verifiedManufacturedSalesUsd)
        ? ((body as Record<string, unknown>).verifiedManufacturedSalesUsd as number[]).filter((n) => Number.isFinite(n))
        : undefined,
      riskFactors: Array.isArray((body as Record<string, unknown>).riskFactors)
        ? ((body as Record<string, unknown>).riskFactors as string[])
        : undefined,
    });
    return c.json({ scenarios, note: 'Internal underwriting preview. DRAFT scenarios must never be presented as final offers.' });
  });
}
